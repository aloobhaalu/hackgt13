import test from 'node:test';
import assert from 'node:assert/strict';
import { CoachEngine, angle, choosePose, framing } from './engine';
import { demoPose } from './demo';
import type { ExerciseId } from '../config';

test('joint angles are body relative and independent of size and translation',()=>{
  const p=[{x:1,y:0,visibility:1},{x:0,y:0,visibility:1},{x:0,y:1,visibility:1}];
  assert.equal(angle(p[0],p[1],p[2]),90);
  const moved=p.map(v=>({...v,x:v.x*2+4,y:v.y*2+8}));
  assert.equal(angle(moved[0],moved[1],moved[2]),90);
});
for(const id of ['squat','curl','row'] as ExerciseId[]) {
  test(`${id}: no scoring before framing is stable; loss immediately clears cues`,()=>{
    const engine=new CoachEngine(id),pose=demoPose(id,0,false);
    assert.equal(engine.update(pose,0).assessment.ready,false);
    assert.equal(engine.update(pose,800).assessment.ready,true);
    const missing=pose.map(p=>({...p}));missing[27].visibility=0;missing[28].visibility=0;
    const bad=engine.update(missing,900).assessment;
    assert.equal(bad.ready,false);assert.equal(bad.score,null);assert.equal(bad.correction,null);
    assert.equal(engine.update(pose,1000).assessment.ready,true,'brief dropout must not restart framing');
  });
  test(`${id}: full synthetic repetitions pass through start, end, and return`,()=>{
    const engine=new CoachEngine(id);
    let result=engine.update(demoPose(id,0,false),0).assessment;
    for(let ms=65;ms<=(id==='squat'?34000:26000);ms+=65) result=engine.update(demoPose(id,ms/1000,false),ms).assessment;
    assert.ok(result.reps>=3,`${id} counted ${result.reps} reps`);
    assert.ok(result.reps<=5,'must not double count');
  });
  test(`${id}: demo includes persistent correction followed by confirmation`,()=>{
    const engine=new CoachEngine(id);let correction=false,confirmation=false;
    for(let ms=0;ms<=(id==='squat'?25000:15000);ms+=65){const a=engine.update(demoPose(id,ms/1000),ms).assessment;correction ||= !!a.correction;confirmation ||= a.confirmed;}
    assert.ok(correction,'demo should demonstrate a correction');if(id !== 'squat') assert.ok(confirmation,'demo should demonstrate recovery');
  });
  test(`${id}: the neutral synthetic movement does not trigger corrections`,()=>{
    const engine=new CoachEngine(id);
    for(let ms=0;ms<11000;ms+=65)assert.equal(engine.update(demoPose(id,ms/1000,false),ms).assessment.correction,null);
  });
}
test('cropped feet fail framing but a small confidently detected body is accepted',()=>{
  const pose=demoPose('curl',0,false);pose[27].y=1.05;
  assert.equal(framing(pose,'curl').ok,false);
  assert.equal(framing(demoPose('curl',0).map(p=>({...p,x:.5+(p.x-.5)*.2,y:.5+(p.y-.5)*.2})),'curl').ok,true);
});
test('multiple similar people pause assessment, while a small background pose does not',()=>{
  const main=demoPose('curl',0),other=main.map(p=>({...p,x:p.x+.1}));
  assert.equal(choosePose([main,other]).ambiguous,true);
  const small=other.map(p=>({...p,x:p.x*.25,y:p.y*.25}));
  assert.equal(choosePose([small,main]).ambiguous,false);
  assert.equal(choosePose([small,main]).pose,main);
  assert.equal(new CoachEngine('curl').update(main,1000,1,true).assessment.score,null);
});
test('pausing cancels an incomplete repetition',()=>{
  const engine=new CoachEngine('curl');
  for(let ms=0;ms<9000;ms+=65)engine.update(demoPose('curl',ms/1000,false),ms);
  const before=engine.interrupt().reps;
  for(let ms=9000;ms<10400;ms+=65)assert.equal(engine.update(demoPose('curl',ms/1000,false),ms).assessment.reps,before);
});
test('correcting video aspect ratio preserves scores and phases',()=>{
  const a=new CoachEngine('curl'),b=new CoachEngine('curl');
  for(let ms=0;ms<14000;ms+=65){
    const p=demoPose('curl',ms/1000);
    const wide=p.map(v=>({...v,x:.5+(v.x-.5)/1.777}));
    const x=a.update(p,ms,1).assessment,y=b.update(wide,ms,1.777).assessment;
    assert.equal(x.score,y.score);assert.equal(x.phase,y.phase);
  }
});

for (const id of ['squat', 'curl', 'row'] as ExerciseId[]) {
  test(`${id}: poor face and hand confidence does not trigger framing failure`, () => {
    const pose = demoPose(id, 0, false);
    for (const i of [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 15, 16, 17, 18, 19, 20]) pose[i].visibility = 0.05;
    assert.equal(framing(pose, id).ok, true);
    const engine = new CoachEngine(id);
    engine.update(pose, 0);
    const a = engine.update(pose, 510).assessment;
    assert.equal(a.framingWarning, false);
    assert.equal(a.score, null);
    assert.equal(a.ready, id === 'squat', 'arm occlusion only pauses exercises that need arm metrics');
  });
  test(`${id}: stationary poses never get an alignment score`, () => {
    for (const phaseTime of [0, 1.4, 2.5]) {
      const engine = new CoachEngine(id), pose = demoPose(id, phaseTime, false);
      for (let ms = 0; ms < 4000; ms += 65) {
        const a = engine.update(pose, ms).assessment;
        assert.equal(a.score, null); assert.equal(a.correction, null);
      }
    }
  });
}

test('off-center bodies near the edge are accepted without a centering or size gate', () => {
  const p = demoPose('curl', 0).map(v => ({ ...v, x: 0.12 + (v.x - 0.5) * 0.6 }));
  assert.equal(framing(p, 'curl').ok, true);
});

test('500 ms acquisition, immediate score suppression, delayed crop warning, then recovery', () => {
  const engine = new CoachEngine('curl'), good = demoPose('curl', 0, false);
  engine.update(good, 0);
  assert.equal(engine.update(good, 499).assessment.ready, false);
  assert.equal(engine.update(good, 500).assessment.ready, true);
  const cropped = good.map(p => ({ ...p })); cropped[27].y = 1.1;
  const first = engine.update(cropped, 600).assessment;
  assert.equal(first.score, null); assert.equal(first.framingWarning, false);
  assert.equal(engine.update(cropped, 1099).assessment.framingWarning, false);
  assert.equal(engine.update(cropped, 1101).assessment.framingWarning, true);
  assert.equal(engine.update(good, 1200).assessment.framingWarning, false);
  assert.equal(engine.update(good, 1701).assessment.ready, true);
});

test('uncertain in-frame landmarks stay neutral, including sustained uncertainty', () => {
  const engine = new CoachEngine('curl'), p = demoPose('curl', 0);
  p[27].visibility = 0.1;
  for (let ms = 0; ms < 3000; ms += 65) {
    const a = engine.update(p, ms).assessment;
    assert.equal(a.score, null); assert.equal(a.framingWarning, false);
    assert.match(a.reason, /uncertain/);
  }
});

test('side views tolerate an occluded far side but require one complete visible chain', () => {
  const p = demoPose('squat', 0);
  for (const i of [12, 24, 26, 28]) p[i].visibility = 0.1;
  assert.equal(framing(p, 'squat').ok, true);
  assert.equal(framing(p, 'row').ok, true);
  assert.equal(framing(p, 'curl').ok, false);
  p[27].visibility = 0.1;
  assert.equal(framing(p, 'squat').ok, false);
});

test('score requires movement and 100 requires accepted metrics across stable frames', () => {
  const engine = new CoachEngine('curl');
  let scores = 0, perfect = 0;
  for (let ms = 0; ms < 16000; ms += 65) {
    const a = engine.update(demoPose('curl', ms / 1000), ms).assessment;
    if (a.score !== null) { scores++; assert.equal(a.debug.validMovement, true); }
    if (a.score === 100) {
      perfect++;
      assert.ok(a.debug.stableFrames >= 8);
      assert.ok(a.debug.components.every(c => c.score === 100));
    }
    if (a.phase === 'Ready') assert.equal(a.score, null);
  }
  assert.ok(scores > 20); assert.ok(perfect > 0);
});

test('score comes from measured components before the correction persistence window', () => {
  const engine = new CoachEngine('curl'); let observed = false;
  for (let ms = 0; ms < 12000; ms += 65) {
    const a = engine.update(demoPose('curl', ms / 1000), ms).assessment;
    if (a.debug.rawScore !== null) {
      const components = a.debug.components.filter(c => c.score !== null);
      assert.equal(a.debug.rawScore, components.reduce((sum, c) => sum + c.score!, 0) / components.length);
      if (a.debug.rawScore < 99 && !a.correction) observed = true;
    }
  }
  assert.ok(observed, 'raw score must not be derived from the displayed correction');
});

test('an accepted correction clears in the same evaluated frame, with no extra clear delay', () => {
  const engine = new CoachEngine('curl'); let prior: string | undefined, checked = false;
  for (let ms = 0; ms < 14000; ms += 65) {
    const a = engine.update(demoPose('curl', ms / 1000), ms).assessment;
    if (prior && a.debug.components.find(c => c.id === prior)?.error === 0) {
      assert.notEqual(a.correction?.id, prior); checked = true;
    }
    prior = a.correction?.id;
  }
  assert.ok(checked);
});
