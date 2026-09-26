import { FEEDBACK } from '../config';
import { alignmentText, holdTime } from './scoreDisplay';
import { ScoreWindow } from './scoreWindow';
import { emptyAssessment } from './engine';
import test from 'node:test';
import assert from 'node:assert/strict';
import { CoachEngine, distance } from './engine';
import { SquatEvaluator } from './squat';
import { HeelLiftEvaluator } from './heelLift';
import { demoPose } from './demo';
import { squatReference } from './squatVisual';
import type { Pose } from './types';

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
const movement = (ms: number, depth = 1) => ms < 2600 ? 0 : ms < 4200 ? ease((ms - 2600) / 1600) * depth : ms < 7800 ? depth : ms < 9400 ? (1 - ease((ms - 7800) / 1600)) * depth : 0;
function worldPose(image: Pose): Pose {
  const center = { x: (image[23].x + image[24].x) / 2, y: (image[23].y + image[24].y) / 2 };
  return image.map((p, i) => ({ ...p, x: (p.x - center.x) * 2, y: (p.y - center.y) * 2, z: i % 2 === 0 ? 0.12 : 0 }));
}

for (const world of [false, true]) test(`calibrate, descend, hold, and rise using ${world ? 'world' : 'normalized'} geometry`, () => {
  const engine = new CoachEngine('squat'); const states = new Set<string>(); let scored = 0, reps = 0;
  for (let ms = 0; ms < 10400; ms += 65) {
    const p = squatPose(movement(ms));
    const a = engine.update(p, ms, 1, false, world ? worldPose(p) : undefined).assessment;
    const d = a.debug.squat!; states.add(d.state);
    if (a.score !== null) {
      scored++; assert.ok(['DESCENDING','HOLDING','ASCENDING'].includes(d.state)); if(d.state==='HOLDING')assert.ok(d.holdConfirmationMs>=400);
      assert.ok(a.score >= 0 && a.score <= 100); assert.equal(a.squatVisual?.reference.length, 0);
      assert.ok(d.baseline); assert.ok(d.baseline.leg > 0); assert.ok(d.baseline.confidence >= 0.45);
    } else assert.equal(a.corrections?.length ?? 0, 0);
    if (ms < 2000) assert.equal(d.baselineDetected, false);
    if (ms > 10100) assert.equal(a.score, null);
    reps = a.reps;
  }
  assert.ok(scored > 20); assert.equal(reps, 1);
  for (const state of ['CALIBRATING_STANDING', 'DESCENDING', 'HOLDING', 'ASCENDING', 'EXIT']) assert.ok(states.has(state), [...states].join(','));
});

test('shallow and leaning holds show simultaneous body-relative targets', () => {
  const engine = new CoachEngine('squat'); let both = false;
  for (let ms = 0; ms < 7500; ms += 65) {
    const p = squatPose(movement(ms, 0.73), ms > 3100 ? 55 : 2);
    const output = engine.update(p, ms), a = output.assessment;
    if (a.debug.squat?.state !== 'HOLDING') { assert.ok((a.corrections ?? []).every(c => c.id === 'torso')); continue; }
    const depth = a.corrections?.find(c => c.id === 'depth'), torso = a.corrections?.find(c => c.id === 'torso');
    if (depth && torso) {
      both = true; assert.ok(a.score! < 100);
      assert.equal(depth.target.x, output.pose[depth.joint].x); assert.ok(depth.target.y > output.pose[depth.joint].y);
      assert.equal(torso.kind, 'rotation');
      assert.ok(Math.abs(distance(output.pose[torso.anchor], output.pose[torso.joint]) - distance(output.pose[torso.anchor], torso.target)) < 1e-8);
    }
  }
  assert.ok(both);
});

for (const world of [false, true]) test(`torso guidance works before hold confirmation (${world ? 'world' : 'image'})`, () => {
  const engine = new CoachEngine('squat'); let guided = false, cleared = false;
  for (let ms = 0; ms < 7000; ms += 65) {
    const flex = ms < 2600 ? 0 : Math.min(0.5, (ms - 2600) / 3500);
    const p = squatPose(flex, ms > 3100 && ms < 5500 ? 90 : 2);
    const a = engine.update(p, ms, 1, false, world ? worldPose(p) : undefined).assessment;
    assert.equal(a.reps, 0);
    if (a.debug.squat?.state === 'DESCENDING') {
      if (ms < 5500 && a.corrections?.some(c => c.id === 'torso')) {
        guided = true; assert.ok(a.ready); assert.ok(a.debug.squat.activeCorrections.includes('torso'));
      }
      if (ms > 6300) { assert.equal(a.corrections?.length, 0); cleared = true; }
    }
  }
  assert.ok(guided, 'lean must be corrected even when depth never qualifies for a hold');
  assert.ok(cleared, 'straightening removes the torso correction');
});

test('hold depth quality is continuous and shallow holds score lower', () => {
  const scores: number[] = [];
  for (const depth of [0.73, 0.85, 1]) {
    const engine = new CoachEngine('squat'); let score: number | null = null;
    for (let ms = 0; ms < 7500; ms += 65) score = engine.update(squatPose(movement(ms, depth)), ms).assessment.score;
    assert.notEqual(score, null); scores.push(score!);
  }
  assert.ok(scores[0] < scores[1] && scores[1] <= scores[2], JSON.stringify(scores));
});

test('a prolonged stable hold continues scoring instead of timing out as frozen movement', () => {
  const engine = new CoachEngine('squat');
  for (let ms = 0; ms < 24000; ms += 65) {
    const a = engine.update(squatPose(ms < 4200 ? movement(ms) : 1), ms).assessment;
    if (ms > 6500) { assert.equal(a.debug.squat?.state, 'HOLDING'); assert.notEqual(a.score, null); assert.equal(a.reps, 0); }
  }
});

test('seated, static crouched, dancing, waving, and knee-only motion never produce hold scores', () => {
  for (const kind of ['seated', 'crouched', 'dance', 'wave', 'knee-only']) {
    const engine = new CoachEngine('squat');
    for (let ms = 0; ms < 9000; ms += 65) {
      const p = squatPose(kind === 'crouched' ? 0.75 : 0);
      for (const side of [0, 1]) {
        if (kind === 'seated') { p[23 + side].y = 0.84; p[25 + side].y = 0.86; p[11 + side].y = 0.59; }
        if (ms > 2600) {
          const wave = Math.sin((ms - 2600) / 450);
          if (kind === 'wave') { p[13 + side].y += wave * 0.2; p[15 + side].y += wave * 0.2; }
          if (kind === 'dance') { p[27 + side].x += wave * 0.12; p[25 + side].x -= wave * 0.05; }
          if (kind === 'knee-only') p[25 + side].x += Math.abs(wave) * 0.14;
        }
      }
      const a = engine.update(p, ms).assessment;
      assert.notEqual(a.debug.squat?.state, 'HOLDING', kind); assert.equal(a.score, null, kind); assert.equal(a.reps, 0);
      assert.equal(a.corrections?.length ?? 0, 0); assert.deepEqual(a.squatVisual?.recovery, []);
    }
  }
});

test('a continuous squat scores and counts after returning upright without requiring a bottom pause', () => {
  const engine = new CoachEngine('squat'); let reps=0,scored=false;
  for (let ms = 0; ms < 8500; ms += 65) {
    const f = ms < 2600 ? 0 : ms < 4200 ? ease((ms - 2600) / 1600) : ms < 5800 ? 1 - ease((ms - 4200) / 1600) : 0;
    const a = engine.update(squatPose(f), ms).assessment;
    if(ms<2600)assert.equal(a.score,null);
    if(ms<5800)assert.equal(a.reps,0);
    scored ||= a.score!==null; reps=a.reps;
  }
  assert.ok(scored);assert.equal(reps,1);
});

test('visibility loss hides score and corrections immediately and requires hold reconfirmation', () => {
  const engine = new CoachEngine('squat'); let held = false;
  for (let ms = 0; ms < 7500; ms += 65) {
    const p = squatPose(movement(ms, 0.73));
    if (ms >= 6000 && ms < 6500) { p[27].visibility = 0.05; p[28].visibility = 0.05; }
    const a = engine.update(p, ms).assessment;
    if (ms < 6000) held ||= a.score !== null;
    if (ms >= 6000) { assert.equal(a.score, null); assert.equal(a.corrections?.length ?? 0, 0); }
  }
  assert.ok(held);
});

test('hold evaluation is measured, throttled, and unaffected by tiny landmark noise', () => {
  const engine = new CoachEngine('squat'); let lastEvaluation = -Infinity, lastScore: number | null = null, changes = 0;
  for (let ms = 0; ms < 7600; ms += 65) {
    const p = squatPose(movement(ms, 0.85));
    if (ms > 6000) for (const i of [11, 12, 23, 24, 25, 26]) p[i].x += Math.sin(ms / 150) * 0.0001;
    const a = engine.update(p, ms).assessment, d = a.debug.squat!;
    if (d.evaluatedAt !== null && d.evaluatedAt !== lastEvaluation) {
      if (lastEvaluation > 0) assert.ok(d.evaluatedAt - lastEvaluation >= 600);
      lastEvaluation = d.evaluatedAt; changes++;
    }
    if (ms > 6300 && a.score !== null) { if (lastScore !== null) assert.equal(a.score, lastScore); lastScore = a.score; }
  }
  assert.ok(changes >= 3); assert.notEqual(lastScore, null);
});

test('correcting only torso lean leaves shallow-depth feedback visible', () => {
  const engine = new CoachEngine('squat'); let both = false, depthOnly = false;
  for (let ms = 0; ms < 7700; ms += 65) {
    const tilt = ms < 3100 ? 2 : ms < 6000 ? 55 : 35;
    const a = engine.update(squatPose(movement(ms, 0.73), tilt), ms).assessment;
    const ids = a.corrections?.map(c => c.id) ?? [];
    both ||= ids.includes('depth') && ids.includes('torso');
    depthOnly ||= both && ids.includes('depth') && !ids.includes('torso');
  }
  assert.ok(both); assert.ok(depthOnly);
});

for (const world of [false, true]) for (const leanDuring of ['descent', 'hold']) {
  test(`near-horizontal torso gets a correction during ${leanDuring} (${world ? 'world' : 'image'})`, () => {
    const engine = new CoachEngine('squat'); let corrected = false;
    const onset = leanDuring === 'descent' ? 3100 : 6000;
    for (let ms = 0; ms < 7700; ms += 65) {
      const f = movement(ms), p = squatPose(f, ms > onset ? 90 : 2 + f * 20);
      const a = engine.update(p, ms, 1, false, world ? worldPose(p) : undefined).assessment;
      if (ms > onset + 1000 && a.debug.squat?.state === 'HOLDING') {
        const torso = a.corrections?.find(c => c.id === 'torso');
        assert.ok(torso, 'poor torso posture must not suppress its own correction');
        assert.equal(torso.kind, 'rotation'); assert.notEqual(a.score, null); assert.ok(a.score! < 100);
        corrected = true;
      }
    }
    assert.ok(corrected);
  });
}

function withFeet(p: Pose, rise = 0) {
  for (const s of [0, 1]) {
    p[29 + s] = { x: p[27 + s].x - 0.03, y: 0.92 - rise, visibility: 0.99 };
    p[31 + s] = { x: p[27 + s].x + 0.08, y: 0.92, visibility: 0.99 };
    p[27 + s].y -= rise * 0.5;
  }
  return p;
}

for (const world of [false, true]) test(`heel lift coexists with torso/depth guidance and clears on landing (${world ? 'world' : 'image'})`, () => {
  const engine = new CoachEngine('squat'); let seen = false, cleared = false;
  for (let ms = 0; ms < 7700; ms += 65) {
    const rise = ms < 5100 ? 0 : ms < 5650 ? (ms - 5100) / 550 * 0.025 : ms < 6400 ? 0.025 : Math.max(0, (6900 - ms) / 500) * 0.025;
    const p = withFeet(squatPose(movement(ms, 0.68), ms > 3100 ? 55 : 2), rise);
    const a = engine.update(p, ms, 1, false, world ? worldPose(p) : undefined).assessment;
    const heel = a.corrections?.find(c => c.id === 'heel-lift');
    if (heel) {
      seen = true; assert.ok(heel.target.y > p[heel.joint].y);
      assert.ok(a.corrections?.some(c => c.id === 'torso'));
      assert.ok(a.corrections?.some(c => c.id === 'depth'));
    }
    if (ms > 7300) { assert.ok(!heel); cleared = true; }
  }
  assert.ok(seen); assert.ok(cleared);
});

test('heel guidance rejects uncertain feet, whole-foot travel, spikes and missing baseline', () => {
  for (const kind of ['hidden-heel', 'hidden-toe', 'hidden-ankle', 'cropped', 'translation', 'spike', 'no-baseline', 'heel-only']) {
    const heel = new HeelLiftEvaluator();
    for (let ms = 0; ms < 2400; ms += 65) {
      const calibration = ms < 1000;
      const p = withFeet(squatPose(0), !calibration && kind !== 'translation' ? 0.025 : 0);
      if (kind === 'no-baseline' && calibration) p[29].visibility = 0.2;
      if (!calibration) {
        if (kind.startsWith('hidden')) p[kind === 'hidden-heel' ? 29 : kind === 'hidden-toe' ? 31 : 27].visibility = 0.2;
        if (kind === 'cropped') p[31].x = 1.1;
        if (kind === 'translation') for (const i of [27, 29, 31]) p[i].y -= 0.025;
        if (kind === 'spike' && ms !== 1040) withFeet(p, 0);
        if (kind === 'heel-only') p[27].y = 0.9;
      }
      assert.equal(heel.update(p, 0, 0.48, ms, calibration, true, !calibration), null, kind);
    }
  }
});

test('heel correction vanishes immediately on foot confidence loss and is scale invariant', () => {
  for (const scale of [0.6, 1]) for (const side of [0, 1]) {
    const heel = new HeelLiftEvaluator(); let seen = false;
    for (let ms = 0; ms < 2400; ms += 65) {
      const p = withFeet(squatPose(0), ms >= 1000 ? 0.025 : 0).map(p => ({ ...p, x: p.x * scale, y: p.y * scale }));
      if (ms >= 1950) p[29 + side].visibility = 0.1;
      const cue = heel.update(p, side, 0.48 * scale, ms, ms < 1000, true, ms >= 1000);
      seen ||= !!cue;
      if (ms >= 1950) assert.equal(cue, null);
    }
    assert.ok(seen);
  }
});

test('a static forward fold still cannot create a squat hold without calibration and descent', () => {
  const engine = new CoachEngine('squat');
  for (let ms = 0; ms < 7000; ms += 65) {
    const a = engine.update(squatPose(1, 90), ms).assessment;
    assert.equal(a.score, null); assert.equal(a.corrections?.length ?? 0, 0); assert.equal(a.reps, 0);
  }
});

test('a slow measured descent can enter a hold without crossing simultaneous velocity gates', () => {
  const engine = new CoachEngine('squat'); let holding = false;
  for (let ms = 0; ms < 18000; ms += 65) {
    const flex = ms < 2600 ? 0 : ms < 14500 ? (ms - 2600) / 11900 : 1;
    const a = engine.update(squatPose(flex), ms).assessment;
    holding ||= a.debug.squat?.state === 'HOLDING' && a.score !== null;
  }
  assert.ok(holding);
});

test('small bottom-position wobble cannot keep restarting hold confirmation', () => {
  const engine = new CoachEngine('squat'); let holding = false;
  for (let ms = 0; ms < 7500; ms += 65) {
    const p = squatPose(movement(ms));
    if (ms > 4200) for (const i of [11, 12, 23, 24]) p[i].y += 0.004 * Math.sin(ms / 110);
    const a = engine.update(p, ms).assessment;
    holding ||= a.debug.squat?.state === 'HOLDING' && a.score !== null;
  }
  assert.ok(holding);
});

test('small hold wobble shows instability markers and clears them when stable', () => {
  const engine = new CoachEngine('squat'); let unstable = false, cleared = false;
  for (let ms = 0; ms < 11000; ms += 65) {
    const p = squatPose(ms < 4200 ? movement(ms) : 1);
    if (ms > 6200 && ms < 8500) for (const joint of [11, 12, 23, 24]) p[joint].y += Math.sin((ms - 6200) / 300) * 0.012;
    const a = engine.update(p, ms).assessment;
    if (ms > 6000) assert.equal(a.debug.squat?.state, 'HOLDING');
    unstable ||= a.corrections?.some(c => c.kind === 'instability') ?? false;
    if (ms > 9800) cleared ||= unstable && !a.corrections?.some(c => c.kind === 'instability');
  }
  assert.ok(unstable); assert.ok(cleared);
});

test('rising out of a hold keeps live scoring but does not count an unfinished ascent', () => {
  const engine = new CoachEngine('squat'); let held = false, exited = false;
  for (let ms = 0; ms < 7600; ms += 65) {
    const f = ms < 6200 ? movement(ms) : 0.3;
    const a = engine.update(squatPose(f), ms).assessment;
    if (ms < 6200) held ||= a.score !== null;
    if (ms > 6500) { exited = true; assert.equal(a.debug.state,'ASCENDING');assert.notEqual(a.score,null);assert.equal(a.reps,0); }
  }
  assert.ok(held); assert.ok(exited);
});

test('front view never scores and far-side knee disagreement does not affect side-view quality', () => {
  const a = new SquatEvaluator(), b = new SquatEvaluator(), front = new CoachEngine('squat');
  for (let ms = 0; ms < 7600; ms += 65) {
    const p = squatPose(movement(ms)), changed = p.map(v => ({ ...v })); changed[26].x += 0.18;
    const x = a.update(p, ms, 1, 0), y = b.update(changed, ms, 1, 0);
    assert.equal(x.score, y.score); assert.equal(x.debug.state, y.debug.state);
    p[11].x -= 0.1; p[12].x += 0.1; p[23].x -= 0.075; p[24].x += 0.075;
    assert.equal(front.update(p, ms).assessment.score, null);
  }
});

test('scale, translation, and aspect preserve hold recognition and scoring', () => {
  const a = new CoachEngine('squat'), b = new CoachEngine('squat');
  for (let ms = 0; ms < 10000; ms += 65) {
    const p = squatPose(movement(ms));
    const q = p.map(v => ({ ...v, x: 0.1 + v.x * 0.65 / 1.7, y: 0.15 + v.y * 0.65 }));
    const x = a.update(p, ms).assessment, y = b.update(q, ms, 1.7).assessment;
    assert.equal(x.debug.squat?.state, y.debug.squat?.state); assert.equal(x.score, y.score);
  }
});

test('reference preserves measured segments and yields to valid visual coaching', () => {
  const p = squatPose(0.7), ghosts = squatReference(p, 1);
  assert.equal(ghosts.length, 3);
  for (const ghost of ghosts) {
    assert.equal(ghost[27].x, p[27].x); assert.equal(ghost[27].y, p[27].y);
    for (const [a, b] of [[11, 23], [23, 25], [25, 27]]) assert.ok(Math.abs(distance(ghost[a], ghost[b]) - distance(p[a], p[b])) < 1e-8);
  }
  const engine = new CoachEngine('squat');
  for (let ms = 0; ms < 4700; ms += 65) {
    const a = engine.update(squatPose(movement(ms)), ms).assessment;
    if (a.debug.squat?.coachingEnabled) assert.equal(a.squatVisual?.reference.length, 0);
    else if(a.debug.squat?.state!=='FRAME_INVALID') assert.equal(a.squatVisual?.reference.length, 3);
  }
});

test('world source changes, stale frames and interruptions cannot carry a hold score', () => {
  for (const kind of ['world', 'gap', 'pause']) {
    const evaluator = new SquatEvaluator(); let a;
    for (let ms = 0; ms < 6200; ms += 65) { const p = squatPose(movement(ms)); a = evaluator.update(p, ms, 1, 0, kind === 'world' ? worldPose(p) : undefined); }
    assert.notEqual(a!.score, null);
    const p = squatPose(1);
    const result = kind === 'pause' ? evaluator.invalidate('Paused') : evaluator.update(p, kind === 'gap' ? 10000 : 6400, 1, 0);
    assert.equal(result.score, null); assert.equal(result.corrections.length, 0);
  }
});

test('squat live phases precede complete quality reps; poor and interrupted cycles never count',()=>{
  for(const mode of ['good','poor','interrupted','incomplete']) {
    const engine=new CoachEngine('squat');let last=engine.interrupt(),ready=false;const phases=new Set<string>();
    for(let ms=0;ms<10600;ms+=65) {
      const f=mode==='incomplete'?movement(ms,.4):movement(ms);
      const p=squatPose(f,mode==='poor'&&ms>3000&&ms<9200?85:2+20*f);
      if(mode==='interrupted'&&ms>3700&&ms<3900)for(const i of [27,28])p[i].visibility=.1;
      last=engine.update(p,ms).assessment;
      if(ms>2100&&ms<2500){assert.equal(alignmentText(last),'Ready');ready=true;}
      if(last.score!==null)phases.add(last.debug.state!);
      if(ms<9500)assert.equal(last.reps,0);
      if(mode==='interrupted'&&ms>3700&&ms<3900)assert.equal(alignmentText(last),'\u2014');
    }
    assert.ok(ready);
    if(mode==='good'){for(const state of ['DESCENDING','HOLDING','ASCENDING'])assert.ok(phases.has(state));assert.equal(last.reps,1);}
    else assert.equal(last.reps,0,`${mode}: ${last.debug.lastRepScore}`);
    if(mode==='poor'){assert.equal(last.debug.completedCycles,1);assert.ok(last.debug.lastRepScore!<FEEDBACK.qualityRepThreshold);}
  }
});

test('display preserves low measured values including zero and score windows are throttled',()=>{
  const window=new ScoreWindow(),base=emptyAssessment();
  for(const score of [0,20,100]) {
    window.reset();const measured=window.update(score,0,200);
    assert.equal(measured,score);assert.equal(alignmentText({...base,score:measured}),`${score}%`);
    assert.equal(window.update(100-score,100,200),measured);
    assert.equal(window.update(null,110,200),null);
  }
  assert.equal(alignmentText({...base,scoreStatus:'ready'}),'Ready');
  assert.equal(alignmentText(base),'\u2014');
  assert.equal(holdTime(61234),'1:01');
});
