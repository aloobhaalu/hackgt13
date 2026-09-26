import type { RecapDiagnostics } from './diagnostics';
import { createGeminiPayload } from './payload';
import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { ISSUE_KEYS, SessionMetrics, parseSummary } from './summary';
import { localRecap, parseRecap, recapOptions, rankedIssues } from './content';
import { endedRecap } from './client';
import { emptyAssessment } from '../pose/engine';
import { generateRecap, recapHandler } from '../../server/recap';
import type { Assessment } from '../pose/types';

const fixture=()=>new SessionMetrics('curl','side','camera').snapshot();
const response=(data:unknown)=>new Response(JSON.stringify(data),{status:200,headers:{'Content-Type':'application/json'}});
function measured(score=80,ids=['torso','hip-shift']):Assessment {
  const a=emptyAssessment();return {...a,score,reason:'Evaluating measured pose',corrections:ids.map((id,i)=>({id,label:'',joint:11,anchor:23,target:{x:.5,y:.5,visibility:1},severity:.4+i*.2,kind:'translation'})),debug:{...a.debug,exercise:'curl',viewValid:true,coachingEnabled:true,scoringEnabled:true,state:'CURLING_UP',angles:{backwardLean:30},curlPartial:{count:1,severityTotal:.6,maxSeverity:.6}}};
}

test('aggregate summaries count episodes, not frames; average only valid measured phases',()=>{
  const metrics=new SessionMetrics('curl','side','camera');
  for(let at=0;at<1000;at+=50)metrics.observe(measured(),at);
  let s=metrics.snapshot();assert.equal(s.validScoreSamples,5);assert.equal(s.averageAlignment,80);assert.equal(s.bestAlignment,80);
  assert.equal(s.issues.backwardLean.count,1);assert.equal(s.issues.hipDrive.count,1);assert.equal(s.issues.partialRange.count,1);
  const bad=measured(100);bad.debug.scoringEnabled=false;bad.debug.coachingEnabled=false;bad.debug.viewValid=false;
  metrics.observe(bad,1200);assert.equal(metrics.snapshot().validScoreSamples,5);
  metrics.observe(measured(20),1400);s=metrics.snapshot();assert.equal(s.issues.backwardLean.count,2);assert.equal(s.averageAlignment,70);assert.equal(s.issues.partialRange.count,1);
  assert.equal(s.bestAlignment,80);assert.ok(parseSummary(s));
  assert.ok(!JSON.stringify(s).match(/landmarks|target|visibility|image|video|identity/));
});

test('new target segments preserve session totals without duplicating issue episodes',()=>{
  const metrics=new SessionMetrics('curl','front','camera');metrics.observe(measured(),0);metrics.newEvaluator();metrics.observe(measured(),1000);
  const s=metrics.snapshot();assert.equal(s.issues.partialRange.count,2);assert.equal(s.issues.backwardLean.count,0);
});

test('invalid movements count once until a plausible setup returns; uncertain tracking does not count',()=>{
  const metrics=new SessionMetrics('curl','front','camera'),a=measured();a.score=null;a.reason='Arm motion does not follow a standing curl path';
  for(let t=0;t<1000;t+=65)metrics.observe(a,t);
  assert.equal(metrics.snapshot().rejectedMovements,1);
  const unknown=measured();unknown.score=null;unknown.debug.viewValid=false;metrics.observe(unknown,1100);assert.equal(metrics.snapshot().rejectedMovements,1);
  metrics.observe(measured(),1200);metrics.observe(a,1400);assert.equal(metrics.snapshot().rejectedMovements,2);
});

test('fallback picks measured issues deterministically and rejects invented or verbose AI content',()=>{
  const s=fixture();s.issues.incompleteLowering={count:3,averageSeverity:.5,maxSeverity:.7};s.issues.backwardLean={count:2,averageSeverity:.7,maxSeverity:.7};
  const fallback=localRecap(s);assert.equal(fallback.headline,'Focus on full lowering');assert.equal(fallback.tips.length,2);assert.deepEqual(localRecap(s),fallback);assert.deepEqual(parseRecap(fallback,s),fallback);
  for(const v of [{headline:'You have a back injury',tips:[]},{headline:fallback.headline,tips:['You lifted a heavy dumbbell incorrectly.']},{...fallback,score:100},{headline:fallback.headline,tips:[...fallback.tips,'extra']}])assert.equal(parseRecap(v,s),null);
  assert.equal(localRecap(fixture()).headline,'Not enough curl movement to summarize');
});

test('request allowlist rejects extra webcam data, invalid counts and invalid severity',()=>{
  const s=fixture();assert.ok(parseSummary(s));
  for(const extra of ['landmarks','video','images','identity'])assert.equal(parseSummary({...s,[extra]:'private'}),null);
  assert.equal(parseSummary({...s,qualityReps:1}),null);assert.equal(parseSummary({...s,bestAlignment:100}),null);
  const bad=fixture();bad.issues.elbowDrift.maxSeverity=3;assert.equal(parseSummary(bad),null);
});

test('client calls the recap endpoint once and only when the end action invokes it',async()=>{
  let calls=0,body='';const s=fixture();
  const finish=endedRecap(s,(async(_url,init)=>{calls++;body=String(init?.body);return response(localRecap(s));}) as typeof fetch);
  assert.equal(calls,0);const [a,b]=await Promise.all([finish(),finish()]);assert.equal(calls,1);assert.deepEqual(a,b);assert.deepEqual(JSON.parse(body),s);
});

test('offline, error, malformed and indefinitely slow recap endpoints leave the fallback intact',async()=>{
  const s=fixture(),fallback=localRecap(s);
  const fetchers=[async()=>{throw new Error('offline');},async()=>new Response('',{status:500}),async()=>response({headline:'Invented medical diagnosis',tips:[]}),async()=>new Promise<Response>(()=>{})];
  for(const fetcher of fetchers)assert.deepEqual(await endedRecap(s,fetcher as typeof fetch,10)(),fallback);
});

test('server has no Gemini call without a key or for synthetic demos',async()=>{
  let calls=0;const fetcher=(async()=>{calls++;return response({});}) as typeof fetch;
  const s=fixture();assert.deepEqual(await generateRecap(s,{fetcher}),localRecap(s));assert.equal(calls,0);
  s.source='demo';await generateRecap(s,{apiKey:'test-only',fetcher});assert.equal(calls,0);
});

test('Gemini receives only text aggregates, structured response schema, and a server-side header key',async()=>{
  const s=fixture();s.issues.elbowDrift={count:1,averageSeverity:.4,maxSeverity:.4};let calls=0;
  const options=recapOptions(s),expected={headline:options.headlines[0],tips:[options.tips[0]]};
  const fetcher=(async(url,init)=>{
    calls++;assert.match(String(url),/generativelanguage.googleapis.com/);assert.ok(!String(url).includes('test-only'));
    assert.equal((init!.headers as Record<string,string>)['x-goog-api-key'],'test-only');
    const body=JSON.parse(String(init!.body));assert.deepEqual(body,createGeminiPayload(s));assert.ok(body);assert.equal(body.generationConfig.responseMimeType,'application/json');assert.deepEqual(body.generationConfig.responseJsonSchema.required,['headline','tips']);
    assert.deepEqual(Object.keys(body.contents[0].parts[0]),['text']);assert.deepEqual(JSON.parse(body.contents[0].parts[0].text).summary,s);
    assert.ok(!String(init!.body).includes('test-only'));return response({candidates:[{content:{parts:[{text:JSON.stringify(expected)}]}}]});
  }) as typeof fetch;
  assert.deepEqual(await generateRecap(s,{apiKey:'test-only',fetcher}),expected);assert.equal(calls,1);
});

test('Gemini timeout, invalid JSON and unsafe text fail locally without a retry',async()=>{
  const s=fixture();
  for(const run of [async()=>new Promise<Response>(()=>{}),async()=>response({candidates:[{content:{parts:[{text:'not JSON'}]}}]}),async()=>response({candidates:[{content:{parts:[{text:JSON.stringify({headline:'You have an injury',tips:[]})}]}}]})]) {
    let calls=0;const fetcher=(async()=>{calls++;return run();}) as typeof fetch;
    assert.deepEqual(await generateRecap(s,{apiKey:'test-only',fetcher,timeoutMs:10}),localRecap(s));assert.equal(calls,1);
  }
});

test('HTTP boundary works with no API key and rejects extra data before reaching Gemini',async()=>{
  let calls=0;const handler=recapHandler({fetcher:(async()=>{calls++;return response({});}) as typeof fetch});
  const server=createServer((req,res)=>{void handler(req,res,()=>{res.statusCode=404;res.end();});});
  server.listen(0,'127.0.0.1');await once(server,'listening');const address=server.address() as {port:number};
  try {
    const url=`http://127.0.0.1:${address.port}/api/session-recap`,s=fixture();
    const ok=await fetch(url,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(s)});assert.equal(ok.status,200);assert.equal(ok.headers.get('cache-control'),'no-store');assert.deepEqual(await ok.json(),localRecap(s));
    const bad=await fetch(url,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({...s,landmarks:[]})});assert.equal(bad.status,400);
    const foreign=await fetch(url,{method:'POST',headers:{'Content-Type':'application/json',Origin:'https://elsewhere.example'},body:JSON.stringify(s)});assert.equal(foreign.status,403);assert.equal(calls,0);
  } finally {server.close();await once(server,'close');}
});


function exerciseFrame(exercise:'squat'|'plank',ids:string[]=[],state='HOLDING',ms=0,score=80):Assessment {
  const a=measured(score,ids);
  return {...a,holdMs:ms,debug:{...a.debug,exercise,state,curlPartial:undefined,angles:{hipLineOffset:-.2}}};
}

test('squat setup and movement issues retain confirmed episodes and real alignment summaries',()=>{
  const metrics=new SessionMetrics('squat','front','camera');
  const setup=exerciseFrame('squat',['stance-wide-27','stance-wide-28','toe-direction-31']);
  setup.score=null;setup.debug.scoringEnabled=false;
  for(let t=0;t<1000;t+=50)metrics.observe(setup,t);
  let s=metrics.snapshot();assert.equal(s.issues.stanceTooWide.count,1);assert.equal(s.issues.toeDirection.count,1);assert.equal(s.validScoreSamples,0);
  metrics.observe(exerciseFrame('squat',['depth','torso','stability-23','stability-25'],'DESCENDING',0,20),1000);
  metrics.observe(exerciseFrame('squat',['depth'],'ASCENDING',0,80),1200);
  s=metrics.snapshot();assert.equal(s.averageAlignment,50);assert.equal(s.bestAlignment,80);
  assert.equal(s.issues.shallowDepth.count,1);assert.equal(s.issues.torsoLean.count,1);assert.equal(s.issues.instability.count,1);
  const unreliable=exerciseFrame('squat',['knee-track-25']);unreliable.debug.viewValid=false;metrics.observe(unreliable,1400);
  assert.equal(metrics.snapshot().issues.kneeTracking.count,0);assert.equal(metrics.snapshot().validScoreSamples,2);
  metrics.newEvaluator();metrics.observe(exerciseFrame('squat'),1600);s=metrics.snapshot();assert.ok(parseSummary(s));
});

test('plank aggregates only confirmed holds, excludes setup scores and never includes reps',()=>{
  const metrics=new SessionMetrics('plank','side','camera');
  metrics.observe(exerciseFrame('plank',['hip-line','hand-stack'],'MOVING_INTO_POSITION',0,100),0);
  let s=metrics.snapshot();assert.equal(s.validScoreSamples,0);assert.equal(s.totalHoldMs,0);assert.equal(s.issues.hipsHigh.count,1);assert.equal(s.issues.handPlacement.count,1);
  for(let t=200;t<=1200;t+=200)metrics.observe(exerciseFrame('plank',[],'HOLDING',t-200,60),t);
  metrics.observe(exerciseFrame('plank',[],'EXITED',0,100),1400);
  for(let t=1600;t<=2200;t+=200)metrics.observe(exerciseFrame('plank',[],'HOLDING',t-1600,80),t);
  s=metrics.snapshot();assert.equal(s.totalHoldMs,1600);assert.equal(s.bestHoldMs,1000);assert.equal(s.averageAlignment,68);assert.equal(s.bestAlignment,80);assert.equal(s.validScoreSamples,10);
  assert.ok(!('completedReps' in s));assert.ok(!('qualityReps' in s));assert.ok(parseSummary(s));
  assert.equal(parseSummary({...s,completedReps:0}),null);assert.equal(parseSummary({...s,bestHoldMs:2000}),null);
});

test('plank pauses, uncertain tracking, reacquisition and missing frames never inflate hold durations',()=>{
  const metrics=new SessionMetrics('plank','side','camera');
  const hold=(at:number,ms:number)=>metrics.observe(exerciseFrame('plank',[],'HOLDING',ms),at);
  hold(0,0);hold(200,200);metrics.interrupt();hold(400,400);hold(600,600);
  const uncertain=exerciseFrame('plank',['hip-line'],'HOLDING',800,100);uncertain.debug.viewValid=false;metrics.observe(uncertain,800);
  hold(1000,1000);hold(1200,1200);hold(2200,2200);hold(2400,2400);
  metrics.newEvaluator();hold(2600,0);hold(2800,200);
  const s=metrics.snapshot();assert.equal(s.totalHoldMs,1000);assert.equal(s.bestHoldMs,200);assert.equal(s.issues.hipsHigh.count,0);assert.equal(s.bestAlignment,80);
});

test('plank low hips and front-view setup issues use their own supported phrases',()=>{
  const side=new SessionMetrics('plank','side','camera'),low=exerciseFrame('plank',['hip-line']);low.debug.angles.hipLineOffset=.2;side.observe(low,0);
  assert.equal(side.snapshot().issues.hipsLow.count,1);assert.match(localRecap(side.snapshot()).tips[0],/^Lift your hips/);
  const front=new SessionMetrics('plank','front','camera');front.observe(exerciseFrame('plank',['level-15','level-11','balance','stability']),0);
  const s=front.snapshot();for(const key of ['handPlacement','setupSymmetry','hipCentering','instability'] as const)assert.equal(s.issues[key].count,1);
  assert.equal(parseRecap(localRecap(side.snapshot()),s),null,'unsupported low-hip advice is rejected');
});

test('every exercise/view uses a strict aggregate schema and only its own measured phrases',()=>{
  for(const exercise of ['squat','curl','plank'] as const)for(const view of ['front','side'] as const) {
    const s=new SessionMetrics(exercise,view,'camera').snapshot();assert.ok(parseSummary(s));
    for(const key of ['completedReps','qualityReps','reps']) {
      assert.ok(!(key in s));assert.equal(parseSummary({...s,[key]:0}),null);
      assert.ok(!JSON.stringify(createGeminiPayload(s)).includes(key));
    }
    for(const key of ['video','frames','landmarks','identity','poseHistory'])assert.equal(parseSummary({...s,[key]:[]}),null);
    assert.equal(parseSummary({...s,issues:{...s.issues,unknown:{count:1,averageSeverity:.5,maxSeverity:.5}}}),null);
    for(const issue of ISSUE_KEYS[exercise]) {
      const measured=structuredClone(s);Object.assign(measured.issues,{[issue]:{count:2,averageSeverity:.5,maxSeverity:.5}});
      const options=recapOptions(measured);assert.ok(options.headlines.length);assert.ok(options.tips.length);
      for(const headline of options.headlines)assert.ok(headline.split(/\s+/).length<=8);
      for(const tip of options.tips)assert.ok(tip.split(/\s+/).length<=12);
      assert.ok(parseRecap(localRecap(measured),measured));
    }
    if(exercise!=='curl')assert.equal(parseRecap({headline:'Focus on full lowering',tips:['Lower fully before starting the next curl.']},s),null);
  }
});

test('alignment summaries survive reacquisition without needing a completed movement count',()=>{
  for(const exercise of ['squat','curl'] as const)for(const view of ['front','side'] as const) {
    const metrics=new SessionMetrics(exercise,view,'camera');
    const first=measured(20,[]);first.debug.exercise=exercise;first.debug.curlPartial=undefined;
    metrics.observe(first,0);
    assert.equal(metrics.snapshot().enoughValidData,true);
    metrics.newEvaluator();
    const waiting=emptyAssessment();waiting.debug.exercise=exercise;metrics.observe(waiting,1000);
    assert.equal(metrics.snapshot().averageAlignment,20);
    const next=measured(80,[]);next.debug.exercise=exercise;next.debug.curlPartial=undefined;metrics.observe(next,2000);
    const summary=metrics.snapshot();
    assert.equal(summary.validScoreSamples,2);assert.equal(summary.averageAlignment,50);assert.equal(summary.bestAlignment,80);
    assert.ok(parseSummary(summary));assert.match(localRecap(summary).headline,/session complete/);
    assert.equal(waiting.score,null);
  }
});

test('all real exercise recaps make one end-only request and one text-only Gemini call',async()=>{
  for(const exercise of ['squat','curl','plank'] as const) {
    const s=new SessionMetrics(exercise,'side','camera').snapshot(),fallback=localRecap(s);let calls=0,requests=0;
    const gemini=(async(_url,init)=>{calls++;const body=JSON.parse(String(init!.body));const data=JSON.parse(body.contents[0].parts[0].text);assert.deepEqual(body,createGeminiPayload(s));assert.ok(body);
      assert.deepEqual(data.summary,s);assert.deepEqual(body.generationConfig.responseJsonSchema.properties.headline.enum,recapOptions(s).headlines);
      assert.deepEqual(Object.keys(body.contents[0].parts[0]),['text']);return response({candidates:[{content:{parts:[{text:JSON.stringify(fallback)}]}}]});
    }) as typeof fetch;
    const finish=endedRecap(s,(async(url,init)=>{requests++;assert.equal(url,'/api/session-recap');const summary=parseSummary(JSON.parse(String(init!.body)));assert.ok(summary);return response(await generateRecap(summary,{apiKey:'test-only',fetcher:gemini}));}) as typeof fetch);
    assert.equal(requests,0);assert.equal(calls,0);await Promise.all([finish(),finish()]);assert.equal(requests,1);assert.equal(calls,1);
    assert.deepEqual(await generateRecap(s,{fetcher:gemini}),fallback);assert.equal(calls,1);
    assert.deepEqual(await endedRecap(s,(async()=>{throw new Error('offline');}) as typeof fetch)(),fallback);
    assert.deepEqual(await generateRecap(s,{apiKey:'test-only',fetcher:(async()=>new Promise<Response>(()=>{})) as typeof fetch,timeoutMs:5}),fallback);
    await endedRecap({...s,source:'demo'},(async()=>{throw new Error('demo must not call');}) as typeof fetch)();
  }
});


test('shared payload builder rejects extra sensitive fields rather than forwarding them',()=>{
  for(const exercise of ['squat','curl','plank'] as const) {
    const s=new SessionMetrics(exercise,'side','camera').snapshot();
    for(const key of ['frames','recordings','screenshots','landmarks','identity','apiKey','authorization'])assert.equal(createGeminiPayload({...s,[key]:'private'}),null);
    const body=createGeminiPayload(s)!;
    assert.deepEqual(Object.keys(body),['systemInstruction','contents','generationConfig']);
    assert.deepEqual(Object.keys(JSON.parse(body.contents[0].parts[0].text)),['summary','allowed']);
    assert.equal(createGeminiPayload({...s,issues:{...s.issues,landmarks:[]}}),null);
  }
});


test('squat fallback and Gemini options share ranked measured issues without a torso default',()=>{
  const s=new SessionMetrics('squat','front','camera').snapshot();
  s.issues.stanceTooNarrow={count:4,averageSeverity:.8,maxSeverity:.9};s.issues.torsoLean={count:1,averageSeverity:.2,maxSeverity:.2};
  assert.equal(s.enoughValidData,false);assert.equal(rankedIssues(s)[0].type,'stanceTooNarrow');assert.match(localRecap(s).headline,/more space/);
  assert.equal(parseRecap({headline:'Focus on steadier torso alignment',tips:[]},s),null);
  assert.ok(recapOptions(s).tips.every(t=>/feet|torso/.test(t)));
  s.issues.stanceTooNarrow.count=0;s.issues.torsoLean.count=0;s.issues.stanceTooWide={count:2,averageSeverity:.8,maxSeverity:.8};
  assert.match(localRecap(s).tips[0],/inward/);
  const empty=new SessionMetrics('squat','side','camera').snapshot();assert.deepEqual(localRecap(empty).tips,[]);assert.match(localRecap(empty).headline,/Not enough/);
});

test('debug provenance distinguishes an actual Gemini result, keyless fallback and uncertain client timeout',async()=>{
  const s=fixture();let server:RecapDiagnostics|undefined,client:RecapDiagnostics|undefined;
  await generateRecap(s,{report:d=>{server=d;}});assert.deepEqual(server,{source:'local',geminiCalled:false,reason:'missing_key'});
  await generateRecap(s,{apiKey:'test-only',fetcher:(async()=>response({candidates:[{content:{parts:[{text:JSON.stringify(localRecap(s))}]}}]})) as typeof fetch,report:d=>{server=d;}});
  assert.deepEqual(server,{source:'gemini',geminiCalled:true,reason:'gemini'});
  await endedRecap(s,(async()=>new Response(JSON.stringify(localRecap(s)),{headers:{'X-Recap-Source':'gemini','X-Gemini-Called':'true','X-Recap-Reason':'gemini'}})) as typeof fetch,20,d=>{client=d;})();
  assert.deepEqual(client,server);
  await generateRecap(s,{apiKey:'test-only',fetcher:(async()=>response({candidates:[]})) as typeof fetch,report:d=>{server=d;}});assert.deepEqual(server,{source:'local',geminiCalled:true,reason:'invalid_output'});
  await endedRecap(s,(async()=>new Promise<Response>(()=>{})) as typeof fetch,5,d=>{client=d;})();
  assert.deepEqual(client,{source:'local',geminiCalled:null,reason:'timeout'});
});
