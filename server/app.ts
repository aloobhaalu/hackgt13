import { createServer, type ServerResponse } from 'node:http';
import { createReadStream } from 'node:fs';
import { readFile, realpath, stat } from 'node:fs/promises';
import { extname, isAbsolute, relative, resolve, sep } from 'node:path';
import { recapHandler, type RecapSettings } from './recap';

const MIME:Record<string,string>={
  '.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8',
  '.css':'text/css; charset=utf-8','.svg':'image/svg+xml','.ico':'image/x-icon',
  '.png':'image/png','.jpg':'image/jpeg','.jpeg':'image/jpeg','.webp':'image/webp',
  '.gif':'image/gif','.woff':'font/woff','.woff2':'font/woff2',
  '.wasm':'application/wasm','.json':'application/json',
};

export function productionPort(value:string|undefined):number {
  if(!value)return 3000;
  if(!/^\d+$/.test(value)||Number(value)<1||Number(value)>65535)throw new Error('PORT must be between 1 and 65535');
  return Number(value);
}

function json(res:ServerResponse,status:number,body:unknown,head=false) {
  const text=JSON.stringify(body);
  res.writeHead(status,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','Content-Length':Buffer.byteLength(text)});
  res.end(head?undefined:text);
}

// Only serve files from the frontend build
// Keep server code, secrets and repo files outside the public folder
export async function createProductionServer(options:{distDirectory:string;recap?:RecapSettings}) {
  const root=await realpath(options.distDirectory);
  const inside=(file:string)=>{const path=relative(root,file);return path!== '..'&&!path.startsWith(`..${sep}`)&&!isAbsolute(path);};
  const publicFile=async(path:string)=>{
    try {
      const actual=await realpath(resolve(root,`.${path}`));
      if(!inside(actual))return null;
      const info=await stat(actual);
      return info.isFile()?{actual,size:info.size}:null;
    }catch(error){
      if(['ENOENT','ENOTDIR'].includes((error as NodeJS.ErrnoException).code??''))return null;
      throw error;
    }
  };
  const index=await publicFile('/index.html');
  if(!index)throw new Error('Missing frontend build; run npm run build');
  const html=await readFile(index.actual);
  const recap=recapHandler(options.recap??{});
  const server=createServer((req,res)=>{
    res.setHeader('X-Content-Type-Options','nosniff');
    res.setHeader('Referrer-Policy','same-origin');
    res.setHeader('X-Frame-Options','DENY');
    res.setHeader('Permissions-Policy','camera=(self), microphone=()');
    void (async()=>{
      // Decode the path first so traversal attempts and hidden files stay blocked
      let path:string;
      try {path=decodeURIComponent((req.url??'/').split('?')[0]);}
      catch {json(res,400,{error:'Invalid path'});return;}
      if(!path.startsWith('/')||path.includes('\\')||path.includes('\0')||path.includes(':')||path.split('/').some(part=>part.startsWith('.'))) {
        json(res,404,{error:'Not found'});return;
      }
      const head=req.method==='HEAD';
      if(path==='/health') {
        if(req.method!=='GET'&&!head){res.setHeader('Allow','GET, HEAD');json(res,405,{error:'Method not allowed'});return;}
        json(res,200,{status:'ok'},head);return;
      }
      if(path==='/api/session-recap') {
        // Use the same data checks, timeout and local fallback as dev mode
        await recap(req,res,()=>json(res,404,{error:'Not found'}));return;
      }
      if(path==='/api'||path.startsWith('/api/')){json(res,404,{error:'Not found'},head);return;}
      if(req.method!=='GET'&&!head){res.setHeader('Allow','GET, HEAD');json(res,405,{error:'Method not allowed'});return;}
      const extension=extname(path).toLowerCase();
      const file=await publicFile(path);
      if(file&&MIME[extension]) {
        const immutable=/^\/assets\/[^/]+-[\w-]{8,}\.[\w]+$/.test(path);
        res.writeHead(200,{'Content-Type':MIME[extension],'Content-Length':file.size,'Cache-Control':immutable?'public, max-age=31536000, immutable':'no-cache'});
        if(head){res.end();return;}
        const stream=createReadStream(file.actual);
        stream.on('error',()=>res.destroy());res.on('close',()=>stream.destroy());stream.pipe(res);return;
      }
      const navigation=!extension && !path.startsWith('/assets/') && (path==='/'||req.headers.accept?.includes('text/html'));
      if(navigation){res.writeHead(200,{'Content-Type':MIME['.html'],'Content-Length':html.length,'Cache-Control':'no-cache'});res.end(head?undefined:html);return;}
      json(res,404,{error:'Not found'},head);
    })().catch(()=>{
      if(res.headersSent)res.destroy();else json(res,500,{error:'Request unavailable'});
    });
  });
  server.headersTimeout=10000;server.requestTimeout=15000;server.keepAliveTimeout=5000;
  server.on('clientError',(_error,socket)=>socket.destroy());
  return server;
}
