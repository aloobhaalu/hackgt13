import test from 'node:test';
import assert from 'node:assert/strict';
import { drawCorrection, drawPose } from './draw';
import { demoPose } from './demo';
import { emptyAssessment } from './engine';
import type { Correction } from './types';
import { CORRECTION_VISUAL as V } from '../config';

function recorder() {
  const calls: { name: string; args: number[] }[] = [], colors: string[] = [];
  const styles: {name:string;value:number}[]=[];
  const paints:{kind:string;color:string;alpha:number;width:number}[]=[];
  let state={strokeStyle:'#000',fillStyle:'#000',globalAlpha:1,lineWidth:1};
  const stack:typeof state[]=[];
  const context = new Proxy({}, {
    get: (_, name: string) => (...args: number[]) => {
      calls.push({name,args});
      if(name==='save')stack.push({...state});
      if(name==='restore')state=stack.pop()!;
      if(name==='stroke'||name==='fill')paints.push({kind:name,color:name==='stroke'?state.strokeStyle:state.fillStyle,alpha:state.globalAlpha,width:state.lineWidth});
    },
    set: (_, name, value) => { if(name in state)Object.assign(state,{[name]:value});if (name === 'strokeStyle') colors.push(value); if(name==='globalAlpha'||name==='lineWidth')styles.push({name:String(name),value}); return true; },
  }) as CanvasRenderingContext2D;
  return { calls, colors, context, styles, paints };
}
for (const kind of ['translation', 'rotation'] as const) {
  test(`${kind} cue draws a connected direction arrow and a visible target at the desired joint`, () => {
    const { calls, context } = recorder(), pose = demoPose('curl', 1);
    const correction: Correction = { id: 'elbow', label: 'Elbow', kind, joint: 13, anchor: 11, target: { ...pose[13], x: pose[13].x - 0.1 }, severity: 1 };
    drawCorrection(context, pose, correction, 800, 600, 0);
    const x = correction.target.x * 800, y = correction.target.y * 600;
    assert.ok(calls.some(c => c.name === 'arc' && c.args[0] === x && c.args[1] === y), 'target dot must be at target landmark');
    assert.ok(calls.some(c => c.name === 'moveTo' && c.args[0] === pose[13].x * 800 && c.args[1] === pose[13].y * 600), 'arrow must begin at affected joint');
    if (kind === 'rotation') assert.ok(calls.some(c => c.name === 'quadraticCurveTo' && c.args[2] === x && c.args[3] === y));
    else assert.ok(calls.some(c => c.name === 'lineTo' && c.args[0] === x && c.args[1] === y));
    assert.ok(calls.some(c => c.name === 'closePath'), 'arrowhead must be filled');
    assert.ok(calls.every(c => c.args.every(Number.isFinite)));
  });
}
test('confirmation never recolors the detected skeleton green', () => {
  const { colors, context } = recorder();
  drawPose(context, demoPose('curl', 1), 800, 600, { ...emptyAssessment(), ready: true, confirmed: true });
  assert.ok(colors.length > 0); assert.ok(colors.every(color => color === '#f0f5ef'));
});

test('every simultaneous correction draws its own target', () => {
  const { calls, context } = recorder(), pose = demoPose('squat', 2);
  const corrections: Correction[] = [
    { id: 'torso', label: 'Torso', kind: 'rotation', anchor: 23, joint: 11, severity: 1, target: { ...pose[11], x: 0.35 } },
    { id: 'depth', label: 'Depth', kind: 'translation', anchor: 25, joint: 23, severity: 1, target: { ...pose[23], y: 0.65 } },
  ];
  drawPose(context, pose, 800, 600, { ...emptyAssessment(), ready: true, correction: corrections[0], corrections });
  for (const c of corrections) assert.ok(calls.some(call => call.name === 'arc' && call.args[0] === c.target.x * 800 && call.args[1] === c.target.y * 600));
});

test('severe corrections use stronger color, opacity and arrow width; unknown severity draws no target',()=>{
  const pose=demoPose('curl',0,false);
  const cue:Correction={id:'elbow',label:'',joint:13,anchor:11,kind:'translation',target:{...pose[13],x:pose[11].x},severity:.1};
  const mild=recorder(),severe=recorder(),unknown=recorder();
  drawCorrection(mild.context,pose,cue,800,600,0,true);
  drawCorrection(severe.context,pose,{...cue,severity:1},800,600,0,true);
  drawCorrection(unknown.context,pose,{...cue,severity:NaN},800,600,0,true);
  assert.ok(mild.colors.includes('#ffa26b'));assert.ok(severe.colors.includes('#ff785e'));
  const firstAlpha=(r:ReturnType<typeof recorder>)=>r.styles.find(s=>s.name==='globalAlpha')!.value;
  assert.ok(firstAlpha(severe)>firstAlpha(mild));
  const widths=(r:ReturnType<typeof recorder>)=>r.styles.filter(s=>s.name==='lineWidth').map(s=>s.value);
  assert.ok(widths(severe)[0]>widths(mild)[0]);assert.equal(unknown.calls.length,0);
});

test('curl down-range ghost keeps its calibrated forearm length while the wrist arrow starts at the current hand',()=>{
  const {calls,context}=recorder(),pose=demoPose('curl',1,false);
  const cue:Correction={id:'bottom-range-0',label:'',joint:15,anchor:13,kind:'translation',severity:.8,
    targetAnchor:{x:.4,y:.55,visibility:1},target:{x:.4,y:.75,visibility:1}};
  drawCorrection(context,pose,cue,800,600,0);
  assert.ok(calls.some(c=>c.name==='moveTo'&&c.args[0]===320&&c.args[1]===330));
  assert.ok(calls.some(c=>c.name==='lineTo'&&c.args[0]===320&&c.args[1]===450));
  assert.ok(calls.some(c=>c.name==='moveTo'&&c.args[0]===pose[15].x*800&&c.args[1]===pose[15].y*600));
});

test('even mild targets stay strong at the pulse trough and have a dark outline',()=>{
  const pose=demoPose('curl',1,false),cue:Correction={id:'elbow',label:'',joint:13,anchor:11,kind:'translation',target:{...pose[13],x:pose[13].x-.08},severity:.05};
  for(const time of [0,V.pulsePeriodMs/4,V.pulsePeriodMs*3/4])for(const subtle of [false,true]) {
    const r=recorder();drawCorrection(r.context,pose,cue,800,600,time,subtle);
    const strokes=r.paints.filter(p=>p.kind==='stroke'&&p.color===V.targetColor&&p.width>=V.arrowWidth);
    assert.ok(strokes.length>=2);assert.ok(strokes.every(p=>p.alpha>=.75));
    assert.ok(strokes.some(p=>p.width>=V.segmentWidth));
    assert.ok(r.paints.some(p=>p.color===V.outlineColor&&p.width>=V.segmentWidth+2*V.outlineWidth&&p.alpha>=.8));
    assert.ok(r.paints.filter(p=>p.kind==='fill'&&p.color===V.targetColor).every(p=>p.alpha>=.75));
    assert.ok(r.calls.some(c=>c.name==='arc'&&c.args[2]===V.targetDotRadius));
  }
});

test('target and outline offer contrasting edges on both light and dark backgrounds',()=>{
  const luminance=(hex:string)=>{
    const rgb=hex.slice(1).match(/../g)!.map(v=>parseInt(v,16)/255).map(v=>v<=.04045?v/12.92:((v+.055)/1.055)**2.4);
    return rgb[0]*.2126+rgb[1]*.7152+rgb[2]*.0722;
  };
  const contrast=(a:number,b:number)=>(Math.max(a,b)+.05)/(Math.min(a,b)+.05);
  for(const background of ['#f5f5f5','#161c19'])assert.ok(Math.max(contrast(luminance(background),luminance(V.targetColor)),contrast(luminance(background),luminance(V.outlineColor)))>4.5);
  assert.ok(contrast(luminance(V.targetColor),luminance(V.outlineColor))>4.5);
});
