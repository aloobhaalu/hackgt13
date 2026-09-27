import HoldTimer from './components/HoldTimer';
import LiveFeedback from './components/LiveFeedback';
import SessionRecap from './components/SessionRecap';
import { SessionMetrics } from './recap/summary';
import { emptyAssessment } from './pose/engine';
import { createGeminiPayload } from './recap/payload';
import { parseSummary } from './recap/summary';
import { localRecap } from './recap/content';
import TargetGuide from './components/TargetGuide';
import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { StrictMode, act } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import { demoPose } from './pose/demo';
import { FilesetResolver, PoseLandmarker } from '@mediapipe/tasks-vision';
import { repFrame, repMotion } from './pose/repFixtures';
import type { Pose } from './pose/types';
import { readFileSync } from 'node:fs';

function setup(query = '') {
  const dom = new JSDOM('<div id="root"></div>', { url: `http://localhost/${query}` });
  const { window } = dom;
  for (const name of ['window', 'document', 'navigator', 'HTMLElement', 'HTMLCanvasElement', 'HTMLVideoElement']) {
    Object.defineProperty(globalThis, name, { configurable: true, value: name === 'window' ? window : (window as unknown as Record<string, unknown>)[name] });
  }
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true, requestAnimationFrame: () => 1, cancelAnimationFrame: () => {} });
  window.scrollTo = () => {};
  window.matchMedia = (() => ({ matches: true })) as unknown as typeof window.matchMedia;
  window.HTMLMediaElement.prototype.pause = () => {};
  window.HTMLCanvasElement.prototype.getContext = (() => ({ clearRect: () => {} })) as unknown as typeof window.HTMLCanvasElement.prototype.getContext;
  let calls = 0;
  let deny!: (error: Error) => void;
  Object.defineProperty(window.navigator, 'mediaDevices', { configurable: true, value: {
    getUserMedia: () => { calls++; return new Promise<MediaStream>((_, reject) => { deny = reject; }); },
  } });
  const root = createRoot(window.document.getElementById('root')!);
  return { dom, window, root, calls: () => calls, deny: () => deny(Object.assign(new Error('Denied'), { name: 'NotAllowedError' })) };
}

test('live text displays concurrent local cues and clears stale corrections when tracking is lost',async()=>{
  const ctx=setup();
  const assessment={...emptyAssessment(),ready:true,score:48,debug:{...emptyAssessment().debug,coachingEnabled:true,viewValid:true},corrections:[
    {id:'elbow-13',label:'',joint:13,anchor:11,target:{x:.4,y:.4,visibility:1},kind:'translation' as const,severity:.5},
    {id:'elbow-motion-0',label:'',joint:13,anchor:11,target:{x:.4,y:.4,visibility:1},kind:'instability' as const,severity:.5},
  ]};
  try {
    await act(async()=>ctx.root.render(<LiveFeedback assessment={assessment} exercise="curl" view="front"/>));
    const feedback=ctx.window.document.querySelector('.live-feedback')!;
    assert.match(feedback.textContent!,/Keep your elbows close to your torso/);
    assert.match(feedback.textContent!,/Keep your elbows still as you curl/);
    assert.equal(feedback.querySelectorAll('li').length,2);assert.equal(feedback.querySelector('button'),null);
    await act(async()=>ctx.root.render(<LiveFeedback assessment={emptyAssessment()} exercise="curl" view="front"/>));
    assert.equal(ctx.window.document.querySelectorAll('.live-feedback li').length,0);
    assert.match(ctx.window.document.querySelector('.live-feedback')!.textContent!,/Keep your head, shoulders, elbows, hands and hips visible/);
  }finally{await act(async()=>ctx.root.unmount());ctx.dom.window.close();}
});

test('a measured squat or curl recap omits average and best alignment statistics',async()=>{
  const ctx=setup();
  try {
    for(const exercise of ['squat','curl'] as const) {
      const summary={...new SessionMetrics(exercise,'front','demo').snapshot(),averageAlignment:82,bestAlignment:90,validScoreSamples:5,enoughValidData:true};
      await act(async()=>ctx.root.render(<SessionRecap summary={summary} recap={{headline:'Session complete',tips:['Keep your movement controlled']}} debug={false} done={()=>{}}/>));
      const modal=ctx.window.document.querySelector('.session-recap')!;
      assert.equal(modal.querySelector('.recap-totals'),null);
      assert.doesNotMatch(modal.textContent!,/Average Form Alignment|Best Form Alignment|82%|90%/);
      assert.match(modal.textContent!,/Session complete/);assert.equal(modal.querySelectorAll('button').length,1);
    }
  }finally{await act(async()=>ctx.root.unmount());ctx.dom.window.close();}
});

test('all three complete cards, including canvas/title/arrow, open view selection, then request camera synchronously', async () => {
  const ctx = setup();
  await act(async () => ctx.root.render(<StrictMode><App/></StrictMode>));
  const targets = ['canvas', 'h2', '.card-arrow'];
  for (let index = 0; index < 3; index++) {
    const cards = ctx.window.document.querySelectorAll('.exercise-card');
    assert.equal(cards.length, 3);
    const target = cards[index].querySelector(targets[index])!;
    const before = ctx.calls();
    await act(async () => {
      target.dispatchEvent(new ctx.window.MouseEvent('click', { bubbles: true }));
      assert.equal(ctx.calls(), before, 'card does not request camera');
    });
    assert.ok(ctx.window.document.querySelector('[role=dialog]'));
    await act(async () => { (ctx.window.document.querySelectorAll('.view-choice')[index % 2] as HTMLElement).click(); assert.equal(ctx.calls(),before+1); });
    assert.equal(ctx.window.document.querySelector('[role=dialog]'),null);
    assert.ok(ctx.window.document.querySelector('.camera-stage video'));
    assert.equal(ctx.window.document.querySelectorAll('.motion-diagram').length, 0, 'home animations must unmount');
    assert.equal(ctx.window.document.querySelector('.setup-page'), null);
    assert.doesNotMatch(ctx.window.document.body.textContent!, /Start Camera|100%|Take a look around/);
    assert.equal(ctx.calls(), before + 1, 'StrictMode must not request twice');
    await act(async () => (ctx.window.document.querySelector('.back-button') as HTMLElement).click());
  }
  await act(async () => ctx.root.unmount()); ctx.dom.window.close();
});

test('denied permission has one retry action and retry directly requests again', async () => {
  const ctx = setup();
  await act(async () => ctx.root.render(<App/>));
  await act(async () => (ctx.window.document.querySelector('.exercise-card') as HTMLElement).click());
  await act(async () => (ctx.window.document.querySelector('.view-choice') as HTMLElement).click());
  await act(async () => ctx.deny());
  const retry = ctx.window.document.querySelector('.camera-error button') as HTMLButtonElement;
  assert.equal(retry.textContent, ' Try camera again');
  assert.equal(ctx.window.document.querySelectorAll('.camera-error button').length, 1);
  assert.equal(ctx.window.document.querySelector('.debug-panel'), null);
  await act(async () => retry.click());
  assert.equal(ctx.calls(), 2);
  assert.equal(ctx.window.document.querySelector('.camera-error'), null);
  await act(async () => ctx.root.unmount()); ctx.dom.window.close();
});

test('debug UI is absent by default, toggles with D, and can be enabled by query', async () => {
  for (const query of ['', '?debug=1']) {
    const ctx = setup(query);
    await act(async () => ctx.root.render(<App/>));
    assert.equal(!!ctx.window.document.querySelector('.debug-home'), !!query);
    await act(async () => ctx.window.dispatchEvent(new ctx.window.KeyboardEvent('keydown', { key: 'D' })));
    assert.equal(!!ctx.window.document.querySelector('.debug-home'), !query);
    await act(async () => ctx.root.unmount()); ctx.dom.window.close();
  }
});

test('view picker recommends and focuses the exercise-specific view; Escape opens no camera', async () => {
  const ctx=setup();
  await act(async()=>ctx.root.render(<App/>));
  assert.deepEqual(Array.from(ctx.window.document.querySelectorAll('.card-title h2')).map(n=>n.textContent),['Squat','Dumbbell curl','High plank']);
  for(const [index,view] of ['Side View','Front View','Side View'].entries()) {
    await act(async()=> (ctx.window.document.querySelectorAll('.exercise-card')[index] as HTMLElement).click());
    assert.equal(ctx.window.document.activeElement?.getAttribute('aria-label'),view);
    assert.equal(ctx.window.document.activeElement?.querySelector('small')?.textContent,'Recommended');
    assert.equal(ctx.window.document.querySelectorAll('.view-choice small')[1]?.textContent,'Alternate view');
    await act(async()=>ctx.window.document.activeElement?.dispatchEvent(new ctx.window.KeyboardEvent('keydown',{key:'Escape',bubbles:true})));
    assert.equal(ctx.window.document.querySelector('[role=dialog]'),null);assert.equal(ctx.calls(),0);
  }
  await act(async()=>ctx.root.unmount());ctx.dom.window.close();
});

test('validation logging is opt-in inside debug mode and logs derived data only',async()=>{
  const ctx=setup('?debug=1'),records:unknown[][]=[];const info=console.info;
  console.info=(...args:unknown[])=>{records.push(args);};
  try {
    await act(async()=>ctx.root.render(<App/>));
    await act(async()=> (ctx.window.document.querySelector('.exercise-card') as HTMLElement).click());
    await act(async()=> (ctx.window.document.querySelector('.view-choice') as HTMLElement).click());
    assert.equal(records.length,0);
    const start=Array.from(ctx.window.document.querySelectorAll('.debug-panel button')).find(b=>b.textContent==='Start validation logging')!;
    await act(async()=> (start as HTMLElement).click());
    assert.equal(records.length,1);const record=records[0][1] as Record<string,unknown>;
    assert.equal(record.exercise,'squat');assert.equal(record.view,'side');assert.ok(!('pose' in record));assert.ok(!('video' in record));
    await act(async()=>ctx.window.dispatchEvent(new ctx.window.KeyboardEvent('keydown',{key:'D'})));
    assert.equal(ctx.window.document.querySelector('.debug-panel'),null);
    await act(async()=>ctx.window.dispatchEvent(new ctx.window.KeyboardEvent('keydown',{key:'D'})));
    assert.ok(Array.from(ctx.window.document.querySelectorAll('button')).some(b=>b.textContent==='Start validation logging'));
    assert.equal(records.length,1);
  } finally {console.info=info;await act(async()=>ctx.root.unmount());ctx.dom.window.close();}
});

test('permission success shows video before tracking loads; target guide stays silent until lock', async () => {
  const ctx = setup();
  let stopped = 0, playCalls = 0;
  const track = { enabled: true, onended: null, stop: () => stopped++ };
  const stream = { getTracks: () => [track], getVideoTracks: () => [track] } as unknown as MediaStream;
  Object.defineProperty(ctx.window.navigator, 'mediaDevices', { value: { getUserMedia: () => Promise.resolve(stream) } });
  ctx.window.HTMLMediaElement.prototype.play = async () => { playCalls++; };
  const originalResolver = FilesetResolver.forVisionTasks;
  FilesetResolver.forVisionTasks = () => new Promise(() => {});
  try {
    await act(async () => ctx.root.render(<StrictMode><App/></StrictMode>));
    await act(async () => (ctx.window.document.querySelector('.exercise-card') as HTMLElement).click());
  await act(async () => (ctx.window.document.querySelector('.view-choice') as HTMLElement).click());
    assert.equal(playCalls, 1, 'StrictMode must not attach the stream twice');
    const video = ctx.window.document.querySelector('video') as HTMLVideoElement;
    assert.equal(video.srcObject, stream);
    assert.ok(ctx.window.document.querySelector('.target-guide svg'));
    assert.equal(ctx.window.document.querySelector('.target-guide')?.textContent, '');
    assert.equal(ctx.window.document.querySelector('.stage-overlay'), null, 'model loading must not cover the video');
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 2700)); });
    assert.equal(ctx.window.document.querySelector('.target-guide')?.getAttribute('data-visible'),'true');
    assert.equal(ctx.window.document.querySelector('.tracking-loading'),null);
    assert.equal(ctx.window.document.querySelector('.alignment-indicator'),null);
    assert.equal(ctx.window.document.querySelector('.quick-setup'),null);
    const pause = Array.from(ctx.window.document.querySelectorAll('button')).find(button => button.textContent?.trim() === 'Pause')!;
    await act(async () => pause.click());
    assert.equal(track.enabled, false);
    await act(async () => (ctx.window.document.querySelector('.back-button') as HTMLElement).click());
    assert.ok(stopped >= 1);
  } finally {
    FilesetResolver.forVisionTasks = originalResolver;
    await act(async () => ctx.root.unmount()); ctx.dom.window.close();
  }
});

test('target guide is a text-free thin oval with a 400ms fade and no interaction',async()=>{
  const ctx=setup();
  try{
    await act(async()=>ctx.root.render(<TargetGuide visible={true}/>));
    const guide=ctx.window.document.querySelector('.target-guide') as HTMLElement;
    assert.equal(guide.textContent,'');assert.equal(guide.getAttribute('aria-hidden'),'true');
    assert.equal(guide.style.transitionDuration,'400ms');assert.ok(guide.querySelector('ellipse'));
    assert.equal(guide.querySelectorAll('button, input, text, rect').length,0);
    await act(async()=>ctx.root.render(<TargetGuide visible={false}/>));
    assert.equal(guide.getAttribute('data-visible'),'false');assert.ok(guide.isConnected,'retain the element so the CSS fade can finish');
    await act(async()=>ctx.root.render(<TargetGuide visible={true}/>));
    assert.equal(guide.getAttribute('data-visible'),'true');
  } finally{await act(async()=>ctx.root.unmount());ctx.dom.window.close();}
});

test('camera session locks one target, hides the guide and clears feedback instead of switching to a background person',async()=>{
  const ctx=setup();const oldResolver=FilesetResolver.forVisionTasks,oldCreate=PoseLandmarker.createFromOptions;
  const frames=new Map<number,FrameRequestCallback>();let next=0,videoTime=0,moves:number[]=[];
  const person=demoPose('curl',0,false),background=person.map(p=>({...p,x:p.x+.32}));
  let detections=[background,person];
  Object.assign(globalThis,{requestAnimationFrame:(callback:FrameRequestCallback)=>{frames.set(++next,callback);return next;},cancelAnimationFrame:(id:number)=>frames.delete(id)});
  const drawing=new Proxy({clearRect:()=>{moves=[];},moveTo:(x:number)=>moves.push(x)} as Record<string,unknown>,{get:(object,key:string)=>object[key]??(()=>{})});
  ctx.window.HTMLCanvasElement.prototype.getContext=(()=>drawing) as unknown as typeof ctx.window.HTMLCanvasElement.prototype.getContext;
  ctx.window.HTMLMediaElement.prototype.play=async()=>{};
  for(const [key,value] of [['readyState',4],['videoWidth',720],['videoHeight',720]] as const)Object.defineProperty(ctx.window.HTMLVideoElement.prototype,key,{configurable:true,get:()=>value});
  Object.defineProperty(ctx.window.HTMLVideoElement.prototype,'currentTime',{configurable:true,get:()=>videoTime});
  const track={enabled:true,onended:null,stop:()=>{}};
  Object.defineProperty(ctx.window.navigator,'mediaDevices',{value:{getUserMedia:async()=>({getTracks:()=>[track],getVideoTracks:()=>[track]})}});
  FilesetResolver.forVisionTasks=(async()=>({})) as typeof FilesetResolver.forVisionTasks;
  PoseLandmarker.createFromOptions=(async()=>({detectForVideo:()=>({landmarks:detections,worldLandmarks:[]}),close:()=>{}})) as unknown as typeof PoseLandmarker.createFromOptions;
  const advance=async(now:number)=>{videoTime=now/1000;const queued=[...frames.values()];frames.clear();await act(async()=>{queued.forEach(callback=>callback(now));});};
  try{
    await act(async()=>ctx.root.render(<App/>));
    await act(async()=> (ctx.window.document.querySelectorAll('.exercise-card')[1] as HTMLElement).click());
    await act(async()=> (ctx.window.document.querySelector('.view-choice') as HTMLElement).click());
    const guide=()=>ctx.window.document.querySelector('.target-guide')!;
    assert.equal(guide().getAttribute('data-visible'),'true');
    for(let now=65;now<2600;now+=65){detections=now%2?[person,background]:[background,person];await advance(now);if(now<500){assert.equal(moves.length,0);assert.equal(ctx.window.document.querySelector('.alignment-indicator'),null);}}
    assert.equal(guide().getAttribute('data-visible'),'false');assert.equal(ctx.window.document.querySelector('.alignment-indicator')?.textContent,'Hold still');
    assert.match(ctx.window.document.querySelector('.live-feedback')?.textContent??'',/until Ready appears/);
    assert.ok(moves.length>0);assert.ok(moves.every(x=>x<.7*720),'background skeleton is never rendered');
    detections=[background];await advance(2600);
    assert.equal(moves.length,0);assert.equal(ctx.window.document.querySelector('.alignment-indicator'),null);assert.equal(guide().getAttribute('data-visible'),'false');
    for(let now=2665;now<=3575;now+=65)await advance(now);
    assert.equal(guide().getAttribute('data-visible'),'true');assert.equal(moves.length,0);
  }finally{FilesetResolver.forVisionTasks=oldResolver;PoseLandmarker.createFromOptions=oldCreate;await act(async()=>ctx.root.unmount());ctx.dom.window.close();}
});

test('End stops coaching before one request and keeps every exercise in a modal until Done',async()=>{
  const ctx=setup(),originalFetch=globalThis.fetch,oldResolver=FilesetResolver.forVisionTasks,oldCreate=PoseLandmarker.createFromOptions;
  let calls=0,stopped=0,closed=0,payload:Record<string,unknown>|undefined,reject!:(error:Error)=>void;
  const frames=new Map<number,FrameRequestCallback>();let next=0;
  Object.assign(globalThis,{requestAnimationFrame:(callback:FrameRequestCallback)=>{frames.set(++next,callback);return next;},cancelAnimationFrame:(id:number)=>frames.delete(id)});
  ctx.window.HTMLMediaElement.prototype.play=async()=>{};
  Object.defineProperty(ctx.window.navigator,'mediaDevices',{value:{getUserMedia:async()=>{const track={enabled:true,onended:null,stop:()=>{stopped++;}};return {getTracks:()=>[track],getVideoTracks:()=>[track]};}}});
  FilesetResolver.forVisionTasks=(async()=>({})) as typeof FilesetResolver.forVisionTasks;
  PoseLandmarker.createFromOptions=(async()=>({detectForVideo:()=>{throw new Error('no inference after End');},close:()=>{closed++;}})) as unknown as typeof PoseLandmarker.createFromOptions;
  globalThis.fetch=(async(url,init)=>{assert.equal(url,'/api/session-recap');calls++;assert.ok(stopped>0);assert.equal(closed,calls);assert.equal(frames.size,0);payload=JSON.parse(String(init?.body));return new Promise<Response>((_resolve,no)=>{reject=no;});}) as typeof fetch;
  try {
    await act(async()=>ctx.root.render(<StrictMode><App/></StrictMode>));
    for(const [index,exercise] of ['squat','curl','plank'].entries()) {
      await act(async()=> (ctx.window.document.querySelectorAll('.exercise-card')[index] as HTMLElement).click());
      await act(async()=> (ctx.window.document.querySelector('.view-choice') as HTMLElement).click());
      const stage=ctx.window.document.querySelector('.camera-stage')!;
      const video=stage.querySelector('video') as HTMLVideoElement;assert.ok(video.srcObject);assert.equal(calls,index);
      const end=ctx.window.document.querySelector('.end-button') as HTMLElement;
      await act(async()=>{end.click();end.click();});
      assert.equal(calls,index+1);assert.equal(payload?.exercise,exercise);
      assert.equal(ctx.window.document.querySelector('.camera-stage'),stage,'same coaching screen remains mounted');
      assert.equal(video.srcObject,null);assert.equal(frames.size,0);assert.equal(ctx.window.document.querySelector('.exercise-grid'),null);
      assert.ok(ctx.window.document.querySelector('main')?.hasAttribute('inert'));assert.ok(ctx.window.document.querySelector('header')?.hasAttribute('inert'));
      const modal=ctx.window.document.querySelector('.session-recap[role=dialog]')!;
      assert.equal(modal.getAttribute('aria-modal'),'true');assert.match(modal.textContent!,/Preparing recap/);
      assert.equal(modal.querySelectorAll('button').length,1);assert.equal(modal.querySelector('button')?.textContent,'Done');
      assert.equal(ctx.window.document.activeElement,modal.querySelector('button'));
      assert.equal(modal.querySelector('.recap-payload'),null);
      if(exercise==='plank'){assert.match(modal.textContent!,/Best Hold/);assert.match(modal.textContent!,/Total Hold Time/);assert.doesNotMatch(modal.textContent!,/Reps/);}
      else {assert.equal(modal.querySelector('.recap-totals'),null);assert.doesNotMatch(modal.textContent!,/Average Form Alignment|Best Form Alignment|Reps/);}
      await act(async()=>ctx.window.dispatchEvent(new ctx.window.KeyboardEvent('keydown',{key:'d',bubbles:true})));
      const preview=modal.querySelector('.recap-payload pre')!;assert.ok(preview);
      assert.deepEqual(JSON.parse(preview.textContent!),createGeminiPayload(payload));
      const modelData=JSON.parse(JSON.parse(preview.textContent!).contents[0].parts[0].text);
      assert.deepEqual(modelData.summary,payload);assert.ok(parseSummary(modelData.summary));
      for(const key of ['landmarks','frames','video','screenshots','identity','apiKey','headers'])assert.ok(!(key in modelData.summary));
      await act(async()=>modal.querySelector('button')!.dispatchEvent(new ctx.window.KeyboardEvent('keydown',{key:'Tab',bubbles:true,cancelable:true})));
      assert.equal(ctx.window.document.activeElement,preview);
      await act(async()=>ctx.window.dispatchEvent(new ctx.window.KeyboardEvent('keydown',{key:'d',bubbles:true})));
      await act(async()=>reject(new Error('private API error')));
      assert.equal(ctx.window.document.querySelector('.session-recap'),modal);assert.doesNotMatch(modal.textContent!,/Preparing recap|private API error/);
      const summary=parseSummary(payload)!;assert.equal(modal.querySelector('h2')?.textContent,localRecap(summary).headline);assert.ok(modal.querySelectorAll('li').length<=2);
      await act(async()=> (modal.querySelector('.recap-done') as HTMLElement).click());
      assert.ok(ctx.window.document.querySelector('.exercise-grid'));assert.equal(ctx.window.document.querySelector('.session-recap'),null);assert.equal(ctx.window.document.querySelector('.camera-stage'),null);
      assert.equal(ctx.window.document.body.style.overflow,'');assert.ok(!ctx.window.document.querySelector('main')?.hasAttribute('inert'));
    }
  }finally{globalThis.fetch=originalFetch;FilesetResolver.forVisionTasks=oldResolver;PoseLandmarker.createFromOptions=oldCreate;await act(async()=>ctx.root.unmount());ctx.dom.window.close();}
});

test('slow recap times out inside the same modal and never surfaces an API error',async()=>{
  const ctx=setup(),originalFetch=globalThis.fetch;let calls=0;
  globalThis.fetch=(async()=>{calls++;return new Promise<Response>(()=>{});}) as typeof fetch;
  try {
    await act(async()=>ctx.root.render(<App/>));
    await act(async()=> (ctx.window.document.querySelector('.exercise-card') as HTMLElement).click());
    await act(async()=> (ctx.window.document.querySelector('.view-choice') as HTMLElement).click());
    await act(async()=> (ctx.window.document.querySelector('.end-button') as HTMLElement).click());
    const modal=ctx.window.document.querySelector('.session-recap')!;assert.match(modal.textContent!,/Preparing recap/);
    await act(async()=>{await new Promise(resolve=>setTimeout(resolve,3600));});
    assert.equal(ctx.window.document.querySelector('.session-recap'),modal);assert.equal(calls,1);
    assert.equal(modal.querySelector('h2')?.textContent,'Not enough squat movement to summarize');assert.ok(ctx.window.document.querySelector('.camera-stage'));
    await act(async()=> (modal.querySelector('.recap-done') as HTMLElement).click());assert.equal(ctx.window.document.querySelector('.session-recap'),null);
  }finally{globalThis.fetch=originalFetch;await act(async()=>ctx.root.unmount());ctx.dom.window.close();}
});

test('Done clears pending recap permanently; debug query previews the sanitized body without sending it live',async()=>{
  const ctx=setup('?debug=1'),originalFetch=globalThis.fetch;let calls=0,resolve!:(response:Response)=>void,body:unknown;
  globalThis.fetch=(async(_url,init)=>{calls++;body=JSON.parse(String(init?.body));return new Promise<Response>(yes=>{resolve=yes;});}) as typeof fetch;
  try {
    await act(async()=>ctx.root.render(<App/>));
    await act(async()=> (ctx.window.document.querySelector('.exercise-card') as HTMLElement).click());
    await act(async()=> (ctx.window.document.querySelector('.view-choice') as HTMLElement).click());
    assert.ok(ctx.window.document.querySelector('.recap-payload'));assert.equal(calls,0);
    await act(async()=> (ctx.window.document.querySelector('.end-button') as HTMLElement).click());assert.equal(calls,1);
    assert.deepEqual(JSON.parse(ctx.window.document.querySelector('.session-recap .recap-payload pre')!.textContent!),createGeminiPayload(body));
    await act(async()=> (ctx.window.document.querySelector('.recap-done') as HTMLElement).click());
    await act(async()=>resolve(new Response(JSON.stringify(localRecap(parseSummary(body)!)),{status:200})));
    assert.equal(ctx.window.document.querySelector('.session-recap'),null);assert.ok(ctx.window.document.querySelector('.exercise-grid'));
    await act(async()=> (ctx.window.document.querySelector('.exercise-card') as HTMLElement).click());
    await act(async()=> (ctx.window.document.querySelector('.view-choice') as HTMLElement).click());
    await act(async()=> (ctx.window.document.querySelector('.back-button') as HTMLElement).click());assert.equal(calls,1);
  }finally{globalThis.fetch=originalFetch;await act(async()=>ctx.root.unmount());ctx.dom.window.close();}
});


test('plank keeps its hold timer without repetition statistics',async()=>{
  const ctx=setup();
  try {
    for(const [ms,expected] of [[0,'0:00'],[61000,'1:01']] as const){
      await act(async()=>ctx.root.render(<HoldTimer durationMs={ms}/>));
      const timer=ctx.window.document.querySelector('.hold-timer')!;
      assert.equal(timer.querySelector('strong')?.textContent,expected);
      assert.equal(timer.getAttribute('aria-label'),'Hold duration');assert.doesNotMatch(timer.textContent!,/Reps/);
    }
  }finally{await act(async()=>ctx.root.unmount());ctx.dom.window.close();}
});

for(const exercise of ['squat','curl'] as const)for(const view of ['front','side'] as const)
test(`camera pipeline with landmark fixtures: ${view} ${exercise} counts completed movements across brief tracking dips`,async()=>{
  const ctx=setup(),oldResolver=FilesetResolver.forVisionTasks,oldCreate=PoseLandmarker.createFromOptions;
  const frames=new Map<number,FrameRequestCallback>();let next=0,now=0;
  let poses:Pose[]=[],worlds:Pose[]=[];
  Object.assign(globalThis,{requestAnimationFrame:(fn:FrameRequestCallback)=>{frames.set(++next,fn);return next;},cancelAnimationFrame:(id:number)=>frames.delete(id)});
  const drawing=new Proxy({}, {get:()=>()=>{}});
  ctx.window.HTMLCanvasElement.prototype.getContext=(()=>drawing) as unknown as typeof ctx.window.HTMLCanvasElement.prototype.getContext;
  ctx.window.HTMLMediaElement.prototype.play=async()=>{};
  for(const [key,value] of [['readyState',4],['videoWidth',1280],['videoHeight',720]] as const)Object.defineProperty(ctx.window.HTMLVideoElement.prototype,key,{configurable:true,get:()=>value});
  Object.defineProperty(ctx.window.HTMLVideoElement.prototype,'currentTime',{configurable:true,get:()=>now/1000});
  const track={enabled:true,onended:null,stop:()=>{}};
  Object.defineProperty(ctx.window.navigator,'mediaDevices',{value:{getUserMedia:async()=>({getTracks:()=>[track],getVideoTracks:()=>[track]})}});
  FilesetResolver.forVisionTasks=(async()=>({})) as typeof FilesetResolver.forVisionTasks;
  PoseLandmarker.createFromOptions=(async()=>({detectForVideo:()=>({landmarks:poses,worldLandmarks:worlds}),close:()=>{}})) as unknown as typeof PoseLandmarker.createFromOptions;
  try {
    const style=ctx.window.document.createElement('style');style.textContent=readFileSync(new URL('./styles.css',import.meta.url),'utf8');ctx.window.document.head.append(style);
    await act(async()=>ctx.root.render(<App/>));
    await act(async()=> (ctx.window.document.querySelectorAll('.exercise-card')[exercise==='squat'?0:1] as HTMLElement).click());
    const choice=Array.from(ctx.window.document.querySelectorAll('.view-choice')).find(b=>b.textContent!.toLowerCase().includes(`${view} view`))!;
    await act(async()=> (choice as HTMLElement).click());
    for(const selector of ['video','.pose-canvas'])assert.equal(ctx.window.getComputedStyle(ctx.window.document.querySelector(selector)!).transform,'scaleX(-1)');
    let sawScore=false,previousCount=0;
    for(now=65;now<11000;now+=65) {
      const quickSquat=exercise==='squat';
      const depth=quickSquat&&view==='front'?.36:1;
      const f=repFrame(exercise,view,depth*repMotion(quickSquat?now+2600:now));
      const jointDip=now>=5500&&now<5565,targetDip=now>=8500&&now<8565;
      if(quickSquat&&now===2405)for(const i of [25,26])f.world[i].visibility=.1;
      if(jointDip){const i=exercise==='curl'?15:27;f.pose[i].visibility=f.pose[i+1].visibility=.1;}
      poses=targetDip?[]:[f.pose];worlds=targetDip?[]:[f.world];
      const queued=[...frames.values()];frames.clear();await act(async()=>{queued.forEach(fn=>fn(now));});
      const alignment=ctx.window.document.querySelector('.alignment-indicator')?.textContent;
      sawScore ||= !!alignment?.includes('%');
      if(quickSquat&&now>2000&&now<7000)assert.ok(!['Stand tall','Hold still'].includes(alignment??''));
      if(jointDip||targetDip)assert.ok(!alignment?.includes('%'),'no score during uncertain tracking');
      const counter=ctx.window.document.querySelector('.rep-count');
      if(counter){const count=Number(counter.querySelector('strong')!.textContent);assert.ok(count>=previousCount&&count<=2);previousCount=count;assert.doesNotMatch(counter.textContent!,/Quality/);}
    }
    assert.ok(sawScore);assert.equal(previousCount,2);
    const stage=ctx.window.document.querySelector('.camera-stage')!;
    const feedback=ctx.window.document.querySelector('.live-feedback')!;
    assert.ok(feedback);
    assert.equal(stage.previousElementSibling,feedback.parentElement,'coaching text sits above the camera in normal page flow');
    assert.equal(stage.contains(feedback),false,'text does not cover the camera');
    assert.ok(parseFloat(ctx.window.getComputedStyle(feedback).fontSize)>=18,'coaching text is readable at laptop distance');
    assert.ok(stage.querySelector('.alignment-indicator'),'alignment stays in the camera');
    assert.notEqual(ctx.window.getComputedStyle(ctx.window.document.querySelector('.alignment-indicator')!).transform,'scaleX(-1)');
    await act(async()=> (Array.from(ctx.window.document.querySelectorAll('button')).find(b=>b.textContent?.trim()==='Pause') as HTMLElement).click());
    await act(async()=> (Array.from(ctx.window.document.querySelectorAll('button')).find(b=>b.textContent?.trim()==='Resume') as HTMLElement).click());
    for(;now<12000;now+=65){const f=repFrame(exercise,view,0);poses=[f.pose];worlds=[f.world];const queued=[...frames.values()];frames.clear();await act(async()=>queued.forEach(fn=>fn(now)));}
    assert.equal(ctx.window.document.querySelector('.rep-count strong')?.textContent,'02');
  }finally{FilesetResolver.forVisionTasks=oldResolver;PoseLandmarker.createFromOptions=oldCreate;await act(async()=>ctx.root.unmount());ctx.dom.window.close();}
});
