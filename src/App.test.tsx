import TargetGuide from './components/TargetGuide';
import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { StrictMode, act } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import { demoPose } from './pose/demo';
import { FilesetResolver, PoseLandmarker } from '@mediapipe/tasks-vision';

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
    assert.equal(guide().getAttribute('data-visible'),'false');assert.equal(ctx.window.document.querySelector('.alignment-indicator')?.textContent,'Ready');
    assert.ok(moves.length>0);assert.ok(moves.every(x=>x<.7*720),'background skeleton is never rendered');
    detections=[background];await advance(2600);
    assert.equal(moves.length,0);assert.equal(ctx.window.document.querySelector('.alignment-indicator'),null);assert.equal(guide().getAttribute('data-visible'),'false');
    for(let now=2665;now<=3575;now+=65)await advance(now);
    assert.equal(guide().getAttribute('data-visible'),'true');assert.equal(moves.length,0);
  }finally{FilesetResolver.forVisionTasks=oldResolver;PoseLandmarker.createFromOptions=oldCreate;await act(async()=>ctx.root.unmount());ctx.dom.window.close();}
});
