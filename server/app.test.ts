import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { request } from 'node:http';
import { mkdtemp, mkdir, writeFile, rm, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { createProductionServer, productionPort } from './app';
import { SessionMetrics } from '../src/recap/summary';
import { localRecap } from '../src/recap/content';
import { createGeminiPayload } from '../src/recap/payload';
import type { RecapSettings } from './recap';

async function fixture(recap:RecapSettings={}) {
  const directory=await mkdtemp(join(tmpdir(),'repready-server-'));
  const dist=join(directory,'dist');
  await mkdir(join(dist,'assets'),{recursive:true});
  await writeFile(join(dist,'index.html'),'<!doctype html><title>RepReady</title><div id="root"></div>');
  await writeFile(join(dist,'assets','index-a1b2c3d4.js'),'document.title="RepReady";');
  await writeFile(join(dist,'repready-mark.svg'),'<svg xmlns="http://www.w3.org/2000/svg"/>');
  await writeFile(join(directory,'.env.local'),'GEMINI_API_KEY=test-secret-never-public');
  await writeFile(join(dist,'.env'),'test-secret-never-public');
  await writeFile(join(dist,'server.ts'),'test-secret-never-public');
  const server=await createProductionServer({distDirectory:dist,recap});
  server.listen(0,'127.0.0.1');await once(server,'listening');
  const address=server.address() as {port:number;address:string};
  return {directory,dist,server,address,url:`http://127.0.0.1:${address.port}`,close:async()=>{
    await new Promise<void>((resolve,reject)=>server.close(error=>error?reject(error):resolve()));
    assert.equal(dirname(directory),tmpdir());
    await rm(directory,{recursive:true,force:true});
  }};
}

test('production serves built assets, HEAD and SPA navigation with appropriate cache headers',async()=>{
  const f=await fixture();
  try {
    assert.equal(f.address.address,'127.0.0.1');
    for(const path of ['/','/coach/squat','/index.html']) {
      const r=await fetch(f.url+path,{headers:{Accept:'text/html'}});
      assert.equal(r.status,200);assert.match(await r.text(),/<title>RepReady<\/title>/);
      assert.equal(r.headers.get('Cache-Control'),'no-cache');
      assert.equal(r.headers.get('Permissions-Policy'),'camera=(self), microphone=()');
    }
    const asset=await fetch(f.url+'/assets/index-a1b2c3d4.js');
    assert.match(asset.headers.get('Content-Type')!,/javascript/);assert.match(asset.headers.get('Cache-Control')!,/immutable/);
    assert.equal(await asset.text(),'document.title="RepReady";');
    const head=await fetch(f.url+'/repready-mark.svg',{method:'HEAD'});
    assert.equal(head.status,200);assert.equal(await head.text(),'');assert.equal(head.headers.get('Content-Type'),'image/svg+xml');
    for(const path of ['/assets/missing.js','/assets/missing','/api/unknown','/server.ts','/package.json']) {
      assert.equal((await fetch(f.url+path,{headers:{Accept:'text/html'}})).status,404,path);
    }
    assert.equal((await fetch(f.url+'/',{method:'POST'})).status,405);
  }finally{await f.close();}
});

test('health contains no environment, model, session, or key information',async()=>{
  const f=await fixture({apiKey:'test-secret-never-public',model:'private-test-model'});
  try {
    const r=await fetch(f.url+'/health');
    assert.deepEqual(await r.json(),{status:'ok'});assert.equal(r.headers.get('Cache-Control'),'no-store');
    assert.equal((await fetch(f.url+'/health',{method:'POST'})).status,405);
    const head=await fetch(f.url+'/health',{method:'HEAD'});assert.equal(head.status,200);assert.equal(await head.text(),'');
  }finally{await f.close();}
});

test('static boundaries reject encoded traversal, dotfiles and symlinks outside dist',async()=>{
  const f=await fixture();
  try {
    // A directory junction works without Windows symlink privileges as well as on Ubuntu.
    const outside=join(f.directory,'private');await mkdir(outside);await writeFile(join(outside,'secret.json'),'test-secret-never-public');
    await symlink(outside,join(f.dist,'escape'),'junction');
    for(const path of ['/.env','/%2eenv','/../.env.local','/%2e%2e/.env.local','/assets/%2e%2e/%2e%2e/.env.local','/assets%5c..%5c.env','/escape/secret.json','/dist-server/index.mjs']) {
      const result=await new Promise<{status:number;body:string}>((resolve,reject)=>{
        const req=request({hostname:'127.0.0.1',port:f.address.port,path},res=>{let body='';res.on('data',chunk=>body+=chunk);res.on('end',()=>resolve({status:res.statusCode!,body}));});req.on('error',reject);req.end();
      });
      assert.equal(result.status,404,path);assert.ok(!result.body.includes('test-secret-never-public'));
    }
    assert.equal((await fetch(f.url+'/%ZZ')).status,400);
  }finally{await f.close();}
});

test('production recap handles all exercises locally without a key and rejects uploads',async()=>{
  let calls=0;const f=await fixture({fetcher:(async()=>{calls++;throw new Error('Network should not be used');}) as typeof fetch});
  try {
    for(const exercise of ['squat','curl','plank'] as const) {
      const summary=new SessionMetrics(exercise,'front','camera').snapshot();
      const r=await fetch(f.url+'/api/session-recap',{method:'POST',headers:{'Content-Type':'application/json',Origin:f.url},body:JSON.stringify(summary)});
      assert.equal(r.status,200);assert.deepEqual(await r.json(),localRecap(summary));assert.equal(r.headers.get('X-Gemini-Called'),'false');assert.equal(r.headers.get('Cache-Control'),'no-store');
      const invalid=await fetch(f.url+'/api/session-recap',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({...summary,landmarks:[{x:0,y:0}]})});assert.equal(invalid.status,400);
    }
    assert.equal((await fetch(f.url+'/api/session-recap')).status,405);
    assert.equal((await fetch(f.url+'/api/session-recap',{method:'POST',body:'video'})).status,415);
    assert.equal((await fetch(f.url+'/api/session-recap',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({image:'x'.repeat(9000)})})).status,413);
    assert.equal((await fetch(f.url+'/api/session-recap',{method:'POST',headers:{'Content-Type':'application/json',Origin:'https://foreign.example'},body:'{}'})).status,403);
    assert.equal(calls,0);
  }finally{await f.close();}
});

test('production recap sends the exact aggregate payload once; slow Gemini falls back',async()=>{
  for(const slow of [false,true]) {
    const summary=new SessionMetrics('plank','side','camera').snapshot();let calls=0;
    const f=await fixture({apiKey:'server-only-test-key',timeoutMs:10,fetcher:(async(_url,init)=>{
      calls++;assert.deepEqual(JSON.parse(String(init?.body)),createGeminiPayload(summary));
      assert.equal((init?.headers as Record<string,string>)['x-goog-api-key'],'server-only-test-key');
      if(slow)return new Promise<Response>(()=>{});
      return new Response(JSON.stringify({candidates:[{content:{parts:[{text:JSON.stringify(localRecap(summary))}]}}]}));
    }) as typeof fetch});
    try {
      const r=await fetch(f.url+'/api/session-recap',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(summary)});
      assert.equal(r.status,200);assert.deepEqual(await r.json(),localRecap(summary));assert.equal(calls,1);
      assert.equal(r.headers.get('X-Recap-Source'),slow?'local':'gemini');
      assert.ok(![...r.headers.values()].join().includes('server-only-test-key'));
    }finally{await f.close();}
  }
});

test('local port defaults to 3000 and invalid settings fail rather than exposing another interface',()=>{
  assert.equal(productionPort(undefined),3000);assert.equal(productionPort(''),3000);assert.equal(productionPort('3456'),3456);
  for(const value of ['0','65536','-1','0.0.0.0','3000oops','3000.5'])assert.throws(()=>productionPort(value));
});
