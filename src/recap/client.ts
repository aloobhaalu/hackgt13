import { localRecap, parseRecap, type Recap } from './content';
import { parseSummary, type SessionSummary } from './summary';
import { RECAP_REASONS, type RecapDiagnostics, type RecapReason } from './diagnostics';

// Create this when the session ends and reuse the same request
// Live camera frames never trigger a recap
export function endedRecap(summary:SessionSummary,fetcher:typeof fetch=fetch,timeoutMs=3500,report?:(diagnostics:RecapDiagnostics)=>void) {
  const safe=parseSummary(summary),fallback=localRecap(summary);
  type Result={recap:Recap;diagnostics:RecapDiagnostics};
  const local=(reason:RecapReason,geminiCalled:boolean|null=null):Result=>({recap:fallback,diagnostics:{source:'local',geminiCalled,reason}});
  let pending:Promise<Recap>|undefined;
  return ()=>pending??=(async()=>{
    if(!safe||safe.source==='demo'){const result=local(safe?'demo':'invalid_summary',false);report?.(result.diagnostics);return fallback;}
    const abort=new AbortController();let timer:ReturnType<typeof setTimeout>|undefined;
    try {
      const request=fetcher('/api/session-recap',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(safe),signal:abort.signal,credentials:'omit'})
        .then(async response=>{
          if(!response.ok)return local('http_error');
          const recap=parseRecap(await response.json(),safe);
          const source=response.headers.get('X-Recap-Source'),called=response.headers.get('X-Gemini-Called'),reason=response.headers.get('X-Recap-Reason');
          if(!recap)return local('invalid_output',called==='true'?true:called==='false'?false:null);
          if((source==='local'||source==='gemini')&&(called==='true'||called==='false')&&RECAP_REASONS.includes(reason as RecapReason))return {recap,diagnostics:{source,geminiCalled:called==='true',reason:reason as RecapReason}} as Result;
          return local('unknown_server');
        }).catch(()=>local('network_error'));
      const result=await Promise.race([request,new Promise<Result>(resolve=>{timer=setTimeout(()=>{abort.abort();resolve(local('timeout'));},timeoutMs);})]);
      report?.(result.diagnostics);return result.recap;
    } catch {report?.(local('network_error').diagnostics);return fallback;} finally {clearTimeout(timer);}
  })();
}
