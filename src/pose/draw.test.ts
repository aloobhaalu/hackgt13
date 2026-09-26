import test from 'node:test';
import assert from 'node:assert/strict';
import { drawCorrection, drawPose } from './draw';
import { demoPose } from './demo';
import { emptyAssessment } from './engine';
import type { Correction } from './types';

function recorder() {
  const calls: { name: string; args: number[] }[] = [], colors: string[] = [];
  const context = new Proxy({}, {
    get: (_, name: string) => (...args: number[]) => calls.push({ name, args }),
    set: (_, name, value) => { if (name === 'strokeStyle') colors.push(value); return true; },
  }) as CanvasRenderingContext2D;
  return { calls, colors, context };
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
