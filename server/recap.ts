import type { RecapDiagnostics, RecapReason } from '../src/recap/diagnostics';
import { createGeminiPayload } from '../src/recap/payload';
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { Plugin } from 'vite';
import { localRecap, parseRecap, type Recap } from '../src/recap/content';
import { parseSummary, type SessionSummary } from '../src/recap/summary';

type Settings={apiKey?:string;model?:string;fetcher?:typeof fetch;timeoutMs?:number;report?:(diagnostics:RecapDiagnostics)=>void};
export async function generateRecap(summary:SessionSummary,settings:Settings):Promise<Recap> {
  const fallback=localRecap(summary);
  type Result={recap:Recap;diagnostics:RecapDiagnostics};
  const local=(reason:RecapReason,geminiCalled=false):Result=>({recap:fallback,diagnostics:{source:'local',geminiCalled,reason}});
  const report=(result:Result)=>{settings.report?.(result.diagnostics);return result.recap;};
  if(summary.source!=='camera')return report(local('demo'));
  if(!settings.apiKey)return report(local('missing_key'));
  const payload=createGeminiPayload(summary);
  if(!payload)return report(local('invalid_summary'));
  const abort=new AbortController();let timer:ReturnType<typeof setTimeout>|undefined;
  const model=settings.model||'gemini-3.8-flash';
  if(!/^[a-zA-Z0-9._-]+$/.test(model))return report(local('invalid_model'));
  try {
    const request=(settings.fetcher??fetch)(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`,{
      method:'POST',headers:{'Content-Type':'application/json','x-goog-api-key':settings.apiKey},signal:abort.signal,body:JSON.stringify(payload),
    }).then(async response=>{
      if(!response.ok)return local(response.status===429?'rate_limited':response.status===404?'model_unavailable':'http_error',true);
      try {
        const data=await response.json();
        const text=data?.candidates?.[0]?.content?.parts?.filter((p:{text?:unknown;thought?:boolean})=>typeof p.text==='string'&&!p.thought).map((p:{text:string})=>p.text).join('');
        const recap=parseRecap(JSON.parse(text),summary);
        return recap?{recap,diagnostics:{source:'gemini',geminiCalled:true,reason:'gemini'}} as Result:local('invalid_output',true);
      }catch{return local('invalid_output',true);}
    }).catch(()=>local('network_error',true));
    const result=await Promise.race([request,new Promise<Result>(resolve=>{timer=setTimeout(()=>{abort.abort();resolve(local('timeout',true));},settings.timeoutMs??2500);})]);
    return report(result);
  } catch {return report(local('network_error',true));} finally {clearTimeout(timer);}
}

export function recapHandler(settings:Settings) {
  return async(req:IncomingMessage,res:ServerResponse,next:()=>void)=>{
    if(req.url?.split('?')[0]!=='/api/session-recap'){next();return;}
    res.setHeader('Cache-Control','no-store');res.setHeader('Content-Type','application/json');
    const reply=(status:number,value:unknown)=>{res.statusCode=status;res.end(JSON.stringify(value));};
    if(req.method!=='POST'){reply(405,{error:'Method not allowed'});return;}
    if(req.headers.origin){try{if(new URL(req.headers.origin).host!==req.headers.host){reply(403,{error:'Origin not allowed'});return;}}catch{reply(403,{error:'Origin not allowed'});return;}}
    if(!req.headers['content-type']?.startsWith('application/json')){reply(415,{error:'JSON required'});return;}
    try {
      let body='';
      for await(const chunk of req){body+=chunk.toString();if(Buffer.byteLength(body)>8192){reply(413,{error:'Summary too large'});return;}}
      const summary=parseSummary(JSON.parse(body));
      if(!summary){reply(400,{error:'Invalid aggregate summary'});return;}
      const recap=await generateRecap(summary,{...settings,report:diagnostics=>{
        // Safe outcome metadata only: never headers containing credentials or model response bodies.
        res.setHeader('X-Recap-Source',diagnostics.source);res.setHeader('X-Gemini-Called',String(diagnostics.geminiCalled));res.setHeader('X-Recap-Reason',diagnostics.reason);
      }});
      reply(200,recap);
    } catch {if(!res.writableEnded)reply(400,{error:'Invalid aggregate summary'});}
  };
}

/** Node-only Vite dev/preview middleware. Nothing here enters the browser bundle. */
export function recapPlugin(settings:Settings):Plugin {
  const handler=recapHandler(settings);
  return {name:'optional-session-recap',configureServer(server){server.middlewares.use(handler);},configurePreviewServer(server){server.middlewares.use(handler);}};
}
