import test from 'node:test';
import assert from 'node:assert/strict';
import { drawCorrection, drawPose } from './draw';
import { demoPose } from './demo';
import { emptyAssessment } from './engine';
import type { Correction } from './types';

function recorder() {
  const calls: { name: string; args: number[] }[] = [], colors: string[] = [];
  const styles: {name:string;value:number}[]=[];
  const context = new Proxy({}, {
    get: (_, name: string) => (...args: number[]) => calls.push({ name, args }),
    set: (_, name, value) => { if (name === 'strokeStyle') colors.push(value); if(name==='globalAlpha'||name==='lineWidth')styles.push({name:String(name),value}); return true; },
  }) as CanvasRenderingContext2D;
  return { calls, colors, context, styles };
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
