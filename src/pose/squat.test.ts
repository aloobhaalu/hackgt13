import test from 'node:test';
import assert from 'node:assert/strict';
import { CoachEngine, choosePose, distance } from './engine';
import { SquatEvaluator } from './squat';
import { demoPose } from './demo';
import type { Pose, SquatState } from './types';

// Independent articulated fixture: fixed thigh/shin lengths and planted feet.
function squatPose(flex: number, tilt = 2 + flex * 20): Pose {
  const p = demoPose('squat', 0, false);
  const rad = Math.PI / 180;
  for (const s of [0, 1]) {
    const x = 0.54 + s * 0.025;
    p[27 + s] = { x, y: 0.9, visibility: 0.99 };
    p[25 + s] = { x: x + 0.24 * Math.sin(25 * flex * rad), y: 0.9 - 0.24 * Math.cos(25 * flex * rad), visibility: 0.99 };
    p[23 + s] = { x: p[25 + s].x - 0.24 * Math.sin(80 * flex * rad), y: p[25 + s].y - 0.24 * Math.cos(80 * flex * rad), visibility: 0.99 };
    p[11 + s] = { x: p[23 + s].x + 0.25 * Math.sin(tilt * rad), y: p[23 + s].y - 0.25 * Math.cos(tilt * rad), visibility: 0.99 };
  }
  return p;
}
const ease = (v: number) => (1 - Math.cos(Math.PI * Math.max(0, Math.min(1, v)))) / 2;
const movement = (ms: number) => ms < 1700 ? 0 : ms < 3400 ? ease((ms - 1700) / 1700) : ms < 3850 ? 1 : ms < 5550 ? 1 - ease((ms - 3850) / 1700) : 0;

test('consecutive squats retain calibration and confirm completion without a prior correction', () => {
  const engine = new CoachEngine('squat');
  let reps = 0, confirmations = 0;
  for (let ms = 0; ms < 11000; ms += 65) {
    const cycle = ms < 5950 ? ms : ms - 5950 + 1700;
    const a = engine.update(squatPose(movement(cycle)), ms).assessment;
    if (a.reps > reps) {
      assert.equal(a.confirmed, true);
      assert.equal(a.correction, null);
      confirmations++;
    }
    reps = a.reps;
  }
  assert.equal(reps, 2);
  assert.equal(confirmations, 2);
});
function worldPose(image: Pose): Pose {
  const center = { x: (image[23].x + image[24].x) / 2, y: (image[23].y + image[24].y) / 2 };
  return image.map((p, i) => ({ ...p, x: (p.x - center.x) * 2, y: (p.y - center.y) * 2, z: i % 2 === 0 ? 0.12 : 0 }));
}

for (const world of [false, true]) {
  test(`proper squat traverses every phase with ${world ? 'pelvis-centered world' : 'normalized'} landmarks`, () => {
    const engine = new CoachEngine('squat');
    const states: string[] = []; let reps = 0, scored = 0, perfect = 0;
    for (let ms = 0; ms < 6700; ms += 65) {
      const p = squatPose(movement(ms));
      const a = engine.update(p, ms, 1, false, world ? worldPose(p) : undefined).assessment;
      const s = a.debug.squat!;
      if (!states.length || !states[states.length - 1].startsWith(s.state + ':')) states.push(`${s.state}: ${s.reason}`);
      if (a.score !== null) {
        scored++; assert.ok(['DESCENDING', 'BOTTOM', 'ASCENDING', 'VALID_REP'].includes(s.state));
        if (s.state !== 'VALID_REP') assert.ok(a.score <= 95);
        if (a.score === 100) { perfect++; assert.equal(s.state, 'VALID_REP'); assert.ok(a.debug.stableFrames >= 8); }
      }
      reps = a.reps;
    }
    assert.equal(reps, 1, states.join('\n'));
    for (const state of ['WAITING_FOR_START_POSE', 'DESCENDING', 'BOTTOM', 'ASCENDING', 'VALID_REP']) assert.ok(states.some(s => s.startsWith(state + ':')), states.join('\n'));
    assert.ok(scored > 15); assert.ok(perfect > 0, 'accepted completed sequence should be eligible for 100');
  });
}

test('static crouch, seated floor, and kneeling fixtures never score or show arrows', () => {
  const floor = squatPose(0.6);
  const kneel = squatPose(0.4);
  for (const s of [0, 1]) {
    floor[23 + s] = { ...floor[23 + s], x: 0.32 + s * 0.025, y: 0.84 };
    floor[25 + s] = { ...floor[25 + s], x: 0.63 + s * 0.025, y: 0.86 };
    floor[11 + s] = { ...floor[11 + s], x: 0.34 + s * 0.025, y: 0.59 };
    kneel[25 + s] = { ...kneel[25 + s], y: 0.89 };
  }
  for (const p of [squatPose(0.6), floor, kneel]) {
    const engine = new CoachEngine('squat');
    for (let ms = 0; ms < 5000; ms += 65) {
      const a = engine.update(p, ms).assessment;
      assert.equal(a.score, null); assert.equal(a.correction, null); assert.equal(a.reps, 0);
      assert.equal(a.framingWarning, false);
    }
  }
});

test('arm raises, dance steps, and knee bending without hip descent do not activate scoring', () => {
  for (const kind of ['arms', 'dance', 'knee-only']) {
    const engine = new CoachEngine('squat');
    for (let ms = 0; ms < 5500; ms += 65) {
      const p = squatPose(0), wave = ms < 1700 ? 0 : Math.sin((ms - 1700) / 450);
      for (const s of [0, 1]) {
        if (kind === 'arms') { p[13 + s].y += wave * 0.15; p[15 + s].y += wave * 0.2; }
        if (kind === 'dance') { p[27 + s].x += wave * 0.12; p[25 + s].x -= wave * 0.05; }
        if (kind === 'knee-only') p[25 + s].x += Math.abs(wave) * 0.14;
      }
      const a = engine.update(p, ms).assessment;
      assert.equal(a.score, null, `${kind}: ${JSON.stringify(a.debug.squat)}`);
      assert.equal(a.correction, null); assert.equal(a.framingWarning, false);
    }
  }
});

test('front-facing knee bends are not classified as side-view squats', () => {
  const engine = new CoachEngine('squat');
  for (let ms = 0; ms < 6500; ms += 65) {
    const p = squatPose(movement(ms));
    p[11].x -= 0.1; p[12].x += 0.1; p[23].x -= 0.075; p[24].x += 0.075;
    const a = engine.update(p, ms).assessment;
    assert.equal(a.score, null); assert.equal(a.correction, null); assert.equal(a.framingWarning, false);
  }
});

test('low-confidence loss clears the sequence and cannot resume from a crouch', () => {
  const engine = new CoachEngine('squat'); let scored = false;
  for (let ms = 0; ms < 3400; ms += 65) {
    const p = squatPose(movement(ms));
    if (ms > 2800 && ms < 3200) { p[27].visibility = 0; p[28].visibility = 0; }
    const a = engine.update(p, ms).assessment;
    if (ms < 2800 && a.score !== null) scored = true;
    if (ms > 2800) { assert.equal(a.score, null); assert.equal(a.correction, null); }
  }
  assert.ok(scored);
});

test('world failure falls back safely and source switches discard the old baseline', () => {
  const evaluator = new SquatEvaluator();
  for (let ms = 0; ms < 1800; ms += 65) evaluator.update(squatPose(0), ms, 1, 0, worldPose(squatPose(0)));
  const p = squatPose(0.5), bad = worldPose(p); bad[25].x = NaN;
  const brief = evaluator.update(p, 1820, 1, 0, bad);
  assert.equal(brief.score, null); assert.equal(brief.debug.trackingReliable, false);
  const a = evaluator.update(p, 2080, 1, 0, bad);
  assert.equal(a.debug.source, 'normalized'); assert.equal(a.debug.baselineDetected, false); assert.equal(a.score, null);
});

test('world pose selection preserves the original detection index', () => {
  const main = squatPose(0), small = main.map(p => ({ ...p, x: p.x * 0.3, y: p.y * 0.3 }));
  assert.equal(choosePose([small, main]).index, 1);
});

test('scale, translation, and video aspect ratio do not change squat states or scores', () => {
  const a = new CoachEngine('squat'), b = new CoachEngine('squat');
  for (let ms = 0; ms < 6500; ms += 65) {
    const p = squatPose(movement(ms));
    const transformed = p.map(v => ({ ...v, x: 0.2 + v.x * 0.65 / 1.7, y: 0.15 + v.y * 0.65 }));
    const x = a.update(p, ms).assessment, y = b.update(transformed, ms, 1.7).assessment;
    assert.equal(x.debug.squat?.state, y.debug.squat?.state); assert.equal(x.score, y.score);
  }
});

test('static bottom holds time out instead of retaining a live score indefinitely', () => {
  const engine = new CoachEngine('squat'); let sawBottom = false;
  for (let ms = 0; ms < 10000; ms += 65) {
    const p = squatPose(ms < 3400 ? movement(ms) : 1);
    const output = engine.update(p, ms), a = output.assessment;
    sawBottom ||= a.debug.squat?.state === 'BOTTOM';
    if (ms > 7500) { assert.equal(a.score, null); assert.equal(a.correction, null); }
  }
  assert.ok(sawBottom);
});

test('diagnostic trace for existing squat demo respects upright sequence requirements', () => {
  const engine = new CoachEngine('squat'); const states: string[] = []; let last: SquatState | undefined;
  for (let ms = 0; ms < 16000; ms += 65) {
    const a = engine.update(demoPose('squat', ms / 1000, false), ms).assessment;
    const d = a.debug.squat!;
    if (d.state !== last) { states.push(`${ms}: ${JSON.stringify(d)}`); last = d.state; }
  }
  assert.ok(states.some(s => s.includes('VALID_REP')), states.join('\n'));
});

test('torso guidance is restricted to recognized phases and uses the current body segment length', () => {
  const engine = new CoachEngine('squat'); let torsoCue = false, recovery = false;
  for (let ms = 0; ms < 6500; ms += 65) {
    const f = movement(ms), p = squatPose(f, ms > 2300 && ms < 4250 ? 55 : 2 + f * 20);
    const output = engine.update(p, ms), a = output.assessment;
    if (a.correction?.id === 'torso') {
      torsoCue = true;
      assert.ok(['DESCENDING', 'BOTTOM', 'ASCENDING'].includes(a.debug.squat!.state));
      assert.equal(a.correction.kind, 'rotation');
      const c = a.correction;
      assert.ok(Math.abs(distance(output.pose[c.anchor], output.pose[c.joint]) - distance(output.pose[c.anchor], c.target)) < 1e-8);
    }
    if (torsoCue && a.confirmed) recovery = true;
    if (!a.debug.validMovement) assert.equal(a.correction, null);
  }
  assert.ok(torsoCue); assert.ok(recovery);
});

test('shallow bottom guidance has one downward arrow and a lower target relative to the rendered hip', () => {
  const engine = new CoachEngine('squat'); let corrected = false;
  for (let ms = 0; ms < 7000; ms += 65) {
    const f = ms < 1700 ? 0 : ms < 3400 ? ease((ms - 1700) / 1700) * 0.73 : ms < 4400 ? 0.73 : Math.max(0, 0.73 * (1 - ease((ms - 4400) / 1700)));
    const p = squatPose(f), output = engine.update(p, ms), a = output.assessment;
    if (a.correction?.id === 'depth') {
      corrected = true; assert.equal(a.debug.squat!.state, 'BOTTOM');
      const c = a.correction;
      assert.equal(c.kind, 'translation');
      assert.equal(c.target.x, output.pose[c.joint].x);
      assert.ok(c.target.y > output.pose[c.joint].y);
    }
  }
  assert.ok(corrected);
});

test('stale frame gaps cannot carry a baseline into an unrelated bent pose', () => {
  const evaluator = new SquatEvaluator();
  for (let ms = 0; ms < 1600; ms += 65) evaluator.update(squatPose(0), ms, 1, 0);
  const result = evaluator.update(squatPose(0.6), 4000, 1, 0);
  assert.equal(result.score, null); assert.equal(result.debug.baselineDetected, false);
});

for (const noise of ['missing', 'facing', 'knee', 'world', 'foot'] as const) {
  test(`one ${noise} outlier does not reset the squat sequence or create extra reps`, () => {
    const engine = new CoachEngine('squat'); let reps = 0;
    for (let ms = 0; ms < 6700; ms += 65) {
      const p = squatPose(movement(ms)), world = noise === 'world' ? worldPose(p) : undefined;
      const outlier = ms === 2665;
      if (outlier) {
        if (noise === 'missing') { p[27].visibility = 0.05; p[28].visibility = 0.05; }
        if (noise === 'facing') { p[11].x -= 0.18; p[12].x += 0.18; p[23].x -= 0.08; p[24].x += 0.08; }
        if (noise === 'knee') { p[25].x += 0.16; p[26].x += 0.16; }
        if (noise === 'foot') { p[29].x += 0.18; p[31].x += 0.18; }
        if (world) world[25].visibility = 0.05;
      }
      const a = engine.update(p, ms, 1, false, world).assessment;
      if (outlier && (noise === 'missing' || noise === 'world')) {
        assert.equal(a.score, null); assert.equal(a.correction, null);
        assert.equal(a.debug.squat!.trackingReliable, false);
      }
      reps = a.reps;
    }
    assert.equal(reps, 1);
  });
}

test('a slightly angled side view is accepted, while a clear front view requests rotation', () => {
  for (const front of [false, true]) {
    const engine = new CoachEngine('squat'); let rotate = false, side = false;
    for (let ms = 0; ms < 1800; ms += 65) {
      const p = squatPose(0);
      p[11].x -= front ? 0.1 : 0.055; p[12].x += front ? 0.1 : 0.055;
      p[23].x -= front ? 0.075 : 0.035; p[24].x += front ? 0.075 : 0.035;
      const a = engine.update(p, ms).assessment;
      rotate = a.debug.squat!.rotateSideways; side = a.debug.squat!.sideOn;
      assert.equal(a.score, null); assert.equal(a.framingWarning, false);
    }
    assert.equal(rotate, front); assert.equal(side, !front);
  }
});

test('heel/toe occlusion is optional, while sustained foot sliding suspends classification', () => {
  for (const slide of [false, true]) {
    const engine = new CoachEngine('squat'); let scored = false, rejected = false;
    for (let ms = 0; ms < 6500; ms += 65) {
      const p = squatPose(movement(ms));
      for (const i of [29, 30, 31, 32]) {
        if (!slide) p[i].visibility = 0.1;
        else if (ms > 3200) p[i].x += 0.15;
      }
      const a = engine.update(p, ms).assessment;
      scored ||= a.score !== null;
      if (slide && ms > 3700 && ms < 5000) {
        assert.equal(a.score, null); assert.equal(a.correction, null); rejected = true;
      }
      assert.equal(a.framingWarning, false);
    }
    assert.ok(scored); if (slide) assert.ok(rejected);
  }
});
