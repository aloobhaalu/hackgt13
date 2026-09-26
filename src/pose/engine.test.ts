import { TargetTracker } from './targetTracker';
import { TARGET } from '../config';
import test from 'node:test';
import assert from 'node:assert/strict';
import { CoachEngine, angle, choosePose, framing } from './engine';
import { demoPose } from './demo';
import type { CameraView, ExerciseId } from '../config';
import type { Pose } from './types';
import { FEEDBACK } from '../config';
import { validationRecord } from './validation';

function curl(ms:number, view:CameraView, bad=false):Pose {
  const p=demoPose('curl',0,false);
  const flex=ms<1800?0:ms<3200?(ms-1800)/1400:ms<4000?1:ms<5600?1-(ms-4000)/1600:0;
  for(const s of [0,1]) {
    const x=view==='front'?.4+s*.2:.48+s*.025;
    p[11+s]={x,y:.24,visibility:.99};p[23+s]={x,y:.5,visibility:.99};
    const drift=bad&&ms>2200?(s===0?.14:0):0;
    p[13+s]={x:x+drift,y:.43,visibility:.99};
    const r=(flex*140+5)*Math.PI/180;
    p[15+s]={x:x+drift+(view==='front'?(s===0?-1:1):1)*Math.sin(r)*.16,y:.43+Math.cos(r)*.16,visibility:.99};
  }
  for(const i of [25,26,27,28,29,30,31,32])p[i].visibility=0;
  return p;
}
function frontSquat(ms:number,bad=false):{p:Pose;world:Pose} {
  const p=demoPose('curl',0,false),flex=ms<2700?0:ms<4300?(ms-2700)/1600:ms<6800?1:ms<8500?1-(ms-6800)/1700:0;
  for(const s of [0,1]) {
    p[11+s]={x:.4+s*.2,y:.2+flex*.16,visibility:.99};
    p[23+s]={x:.44+s*.12,y:.45+flex*.16,visibility:.99};
    p[25+s]={x:.42+s*.16+(bad&&s===0?.09*flex:0),y:.68+flex*.03,visibility:.99};
    p[27+s]={x:.39+s*.22,y:.9,visibility:.99};
    p[29+s]={x:p[27+s].x,y:.89,visibility:.99};
    p[31+s]={x:p[27+s].x+(s===0?-1:1)*.05*Math.sin(Math.PI/9),y:.89+.05*Math.cos(Math.PI/9),visibility:.99};
  }
  const world=p.map(v=>({...v,z:0}));for(const i of [25,26])world[i].z=-flex*.2;
  return {p,world};
}
function frontPlank():{p:Pose;world:Pose} {
  const p=demoPose('plank',0,false);
  for(const s of [0,1]) {
    const sign=s===0?-1:1;
    p[11+s]={x:.5+sign*.12,y:.3,visibility:.99};p[23+s]={x:.5+sign*.07,y:.43,visibility:.99};
    p[25+s]={x:.5+sign*.055,y:.52,visibility:.99};p[27+s]={x:.5+sign*.04,y:.61,visibility:.99};
    p[13+s]={x:.5+sign*.12,y:.47,visibility:.99};p[15+s]={x:.5+sign*.12,y:.64,visibility:.99};
    p[31+s]={x:.5+sign*.04,y:.64,visibility:.99};
  }
  const world=p.map(v=>({...v,z:0}));for(const s of [0,1]){world[23+s].z=.4;world[25+s].z=.7;world[27+s].z=1;}
  return {p,world};
}

test('angles remain body relative',()=>{
  const p=[{x:1,y:0,visibility:1},{x:0,y:0,visibility:1},{x:0,y:1,visibility:1}];assert.equal(angle(...p as [typeof p[0],typeof p[0],typeof p[0]]),90);
});
for(const view of ['side','front'] as CameraView[]) {
  test(`curl ${view}: upper-body-only frame counts a complete curl`,()=>{
    const engine=new CoachEngine('curl',view);let scored=false,last=engine.interrupt();
    for(let ms=0;ms<6500;ms+=65){last=engine.update(curl(ms,view),ms).assessment;scored ||= last.score!==null;}
    assert.ok(scored);assert.equal(last.reps,1);
    assert.ok(framing(curl(0,view),'curl',view).ok);
  });
  test(`curl ${view}: static bent arms do not score or count`,()=>{
    const engine=new CoachEngine('curl',view);
    for(let ms=0;ms<5000;ms+=65){const a=engine.update(curl(3500,view),ms).assessment;assert.equal(a.score,null);assert.equal(a.reps,0);}
  });
}
test('curl emits simultaneous front-view corrections without side-view torso metrics',()=>{
  const e=new CoachEngine('curl','front');let seen=false;
  for(let ms=0;ms<6000;ms+=65){const a=e.update(curl(ms,'front',true),ms).assessment;seen ||= (a.corrections?.length??0)>1;assert.ok(!a.debug.components.some(c=>c.id==='torso'));}
  assert.ok(seen);
});
test('full-body exercises reject cropped feet; curls ignore legs but require wrists',()=>{
  for(const id of ['squat','plank'] as ExerciseId[]){const p=demoPose(id,0);p[31].y=1.2;p[32].y=1.2;assert.equal(framing(p,id).ok,false);}
  const p=curl(0,'front');assert.ok(framing(p,'curl','front').ok);p[15].visibility=.1;assert.equal(framing(p,'curl','front').ok,false);
});
test('framing needs 500ms and confidence loss immediately clears a score',()=>{
  const e=new CoachEngine('plank');const p=demoPose('plank',0,false);
  assert.equal(e.update(p,0).assessment.ready,false);assert.equal(e.update(p,499).assessment.ready,false);assert.ok(e.update(p,500).assessment.ready);
  for(let ms=565;ms<2200;ms+=65)e.update(p,ms);
  p[15].visibility=0;p[16].visibility=0;const a=e.update(p,2210).assessment;assert.equal(a.score,null);assert.equal(a.correction,null);
});
test('side plank scores a stable hold and marks high or low hips',()=>{
  for(const offset of [-.13,0,.13]){
    const e=new CoachEngine('plank');let scored=false,cue=false;
    for(let ms=0;ms<3500;ms+=65){const p=demoPose('plank',0,false);p[23].y+=offset;p[24].y+=offset;const a=e.update(p,ms).assessment;scored ||= a.score!==null;cue ||= !!a.corrections?.some(c=>c.id==='hip-line');assert.equal(a.reps,0);}
    assert.ok(scored);assert.equal(cue,offset!==0);
  }
});
test('front plank requires depth evidence; front standing cannot score',()=>{
  const {p,world}=frontPlank();
  for(const withWorld of [false,true]){const e=new CoachEngine('plank','front');let scored=false;
    for(let ms=0;ms<3500;ms+=65){const a=e.update(p,ms,1,false,withWorld?world:undefined).assessment;scored ||= a.score!==null;assert.ok(!a.debug.components.some(c=>c.id==='hip-line'));}
    assert.equal(scored,withWorld);
  }
  const e=new CoachEngine('plank','front');for(let ms=0;ms<3500;ms+=65)assert.equal(e.update(demoPose('curl',0,false),ms).assessment.score,null);
});
test('front squat calibrates, descends, holds and returns using front metrics only',()=>{
  for(const bad of [false,true]){const e=new CoachEngine('squat','front');let scored=false,cue=false,reps=0;
    for(let ms=0;ms<10000;ms+=65){const {p,world}=frontSquat(ms,bad);const a=e.update(p,ms,1,false,world).assessment;scored ||= a.score!==null;cue ||= !!a.corrections?.some(c=>c.id==='knee-track-25');reps=a.reps;assert.ok(!a.debug.components.some(c=>['depth','torso'].includes(c.id)));}
    assert.ok(scored);assert.equal(reps,1);assert.equal(cue,bad);
  }
});
test('wrong views and static front crouch never score',()=>{
  for(const [id,p,view] of [['squat',demoPose('squat',0,false),'front'],['curl',curl(0,'front'),'side'],['plank',demoPose('plank',0,false),'front']] as [ExerciseId,Pose,CameraView][]){const e=new CoachEngine(id,view);for(let ms=0;ms<3500;ms+=65)assert.equal(e.update(p,ms).assessment.score,null);}
  const e=new CoachEngine('squat','front'),{p,world}=frontSquat(5000);for(let ms=0;ms<5000;ms+=65){const a=e.update(p,ms,1,false,world).assessment;assert.equal(a.score,null);assert.equal(a.reps,0);}
});
test('aspect correction and scale preserve curl scores',()=>{
  const a=new CoachEngine('curl','side'),b=new CoachEngine('curl','side');
  for(let ms=0;ms<6500;ms+=65){const p=curl(ms,'side'),q=p.map(v=>({...v,x:.1+v.x*.6/1.7,y:.1+v.y*.6}));const x=a.update(p,ms).assessment,y=b.update(q,ms,1.7).assessment;assert.equal(x.score,y.score);assert.equal(x.reps,y.reps);}
});
test('multiple prominent people pause assessment and interruptions clear active state',()=>{
  const p=curl(0,'front');assert.ok(choosePose([p,p],'curl').ambiguous);
  const e=new CoachEngine('plank');for(let ms=0;ms<3000;ms+=65)e.update(demoPose('plank',0,false),ms);
  assert.equal(e.interrupt().score,null);assert.equal(e.update(demoPose('plank',0,false),3010,1,true).assessment.score,null);
});

test('world source changes and stale frames require a new plank hold',()=>{
  const {p,world}=frontPlank(),e=new CoachEngine('plank','front');let score:number|null=null;
  for(let ms=0;ms<3000;ms+=65)score=e.update(p,ms,1,false,world).assessment.score;
  assert.notEqual(score,null);
  assert.equal(e.update(p,3020).assessment.score,null);
  assert.equal(e.update(p,3100,1,false,world).assessment.score,null);
  assert.equal(e.update(p,4000,1,false,world).assessment.score,null);
});

test('plank preview holds still with hands and toes on the same support plane',()=>{
  const a=demoPose('plank',0,false),b=demoPose('plank',2,false);
  assert.deepEqual(a,b);
  for(const s of [0,1]) {
    assert.ok(Math.abs(a[15+s].y-a[31+s].y)<1e-6);
    assert.equal(a[15+s].x,a[11+s].x);
    assert.ok(angle(a[11+s],a[23+s],a[27+s])>179);
  }
});

test('curl preview upper arms remain fixed and squat preview returns to standing',()=>{
  const down=demoPose('curl',0,false),up=demoPose('curl',2.5,false);
  for(const i of [11,12,13,14])assert.deepEqual(down[i],up[i]);
  for(let ms=0;ms<=5000;ms+=100) {
    const pose=demoPose('curl',ms/1000,false);
    for(const s of [0,1]) {
      assert.deepEqual(pose[11+s],down[11+s]);assert.deepEqual(pose[13+s],down[13+s]);
      assert.equal(pose[11+s].x,pose[13+s].x);
      assert.ok(Math.abs(pose[15+s].x-.5)<=Math.abs(pose[13+s].x-.5),'hands stay inside the elbow line throughout the curl');
    }
  }
  for(const s of [0,1]) {
    assert.ok(down[15+s].y>down[13+s].y);
    assert.ok(Math.abs(up[15+s].y-up[11+s].y)<0.04,'top hand is near shoulder height');
  }
  assert.ok(angle(up[11],up[13],up[15])<angle(down[11],down[13],down[15]));
  const stand=demoPose('squat',0,false),bottom=demoPose('squat',5,false);
  assert.ok(bottom[23].y>stand[23].y);assert.deepEqual(stand,demoPose('squat',10,false));
});

test('front squat corrects standing stance on both feet before calibration or scoring',()=>{
  for(const width of [.03,.5]) {
    const e=new CoachEngine('squat','front');let seen=false;
    for(let ms=0;ms<2300;ms+=65) {
      const {p}=frontSquat(0);
      for(const s of [0,1]) {const sign=s===0?-1:1;p[27+s].x=.5+sign*width/2;p[25+s].x=(p[23+s].x+p[27+s].x)/2;p[31+s].x=p[27+s].x;}
      const a=e.update(p,ms).assessment;
      assert.equal(a.score,null);assert.equal(a.reps,0);
      assert.ok(!a.corrections?.some(c=>c.id.startsWith('knee-track-')),'standing stance feedback must not move knees');
      const feet=a.corrections?.filter(c=>c.id.startsWith('stance-'))??[];
      if(feet.length===2) {seen=true;assert.equal(a.debug.coachingEnabled,true);assert.equal(a.debug.scoringEnabled,false);
        for(const c of feet) {
          assert.equal(c.anchor,c.joint,'stance highlights only foot area');assert.equal(c.target.y,p[c.joint].y,'stance arrows are horizontal');
          assert.equal(Math.sign(c.target.x-p[c.joint].x), (c.joint===27?-1:1)*(width<.1?1:-1));}}
    }
    assert.ok(seen);
  }
});

function frontToes(p:Pose,degrees:number) {
  for(const s of [0,1]) {
    const sign=s===0?-1:1,r=degrees*Math.PI/180;
    p[29+s]={...p[27+s],y:.89,visibility:.99};
    p[31+s]={x:p[29+s].x+sign*Math.sin(r)*.05,y:.89+Math.cos(r)*.05,visibility:.99};
  }
  return p;
}

test('straight visible feet get toe-out rotations at the feet, then clear independently',()=>{
  const e=new CoachEngine('squat','front');let both=false,cleared=false;
  for(let ms=0;ms<4200;ms+=65) {
    const p=frontToes(frontSquat(0).p,ms<2400?0:20),output=e.update(p,ms),a=output.assessment;
    assert.equal(a.score,null);assert.equal(a.reps,0);
    assert.ok(!a.corrections?.some(c=>c.id.startsWith('knee-track-')));
    const toes=a.corrections?.filter(c=>c.id.startsWith('toe-direction-'))??[];
    if(toes.length===2) {both=true;for(const c of toes){assert.equal(c.kind,'rotation');assert.ok([29,30].includes(c.anchor));assert.ok([31,32].includes(c.joint));assert.equal(Math.sign(c.target.x-output.pose[c.joint].x),c.joint===31?-1:1);}}
    if(ms>3500){assert.equal(toes.length,0);cleared=true;}
  }
  assert.ok(both);assert.ok(cleared);
});

test('uncertain or foreshortened feet do not invent toe-direction targets',()=>{
  for(const mode of ['heel','toe','short','cropped']) {
    const e=new CoachEngine('squat','front');
    for(let ms=0;ms<2300;ms+=65) {
      const p=frontToes(frontSquat(0).p,0);
      for(const s of [0,1]) {
        if(mode==='heel')p[29+s].visibility=.2;
        if(mode==='toe')p[31+s].visibility=.6;
        if(mode==='short')p[31+s].y=p[29+s].y+.002;
        if(mode==='cropped')p[29+s].y=1.1;
      }
      const a=e.update(p,ms).assessment;
      assert.ok(!a.corrections?.some(c=>c.id.startsWith('toe-direction-')),mode);assert.equal(a.score,null);
    }
  }
});

test('knee tracking begins during descent only after stance width is accepted',()=>{
  for(const wide of [false,true]) {
    const e=new CoachEngine('squat','front');let descentCue=false,stanceCue=false;
    for(let ms=0;ms<6600;ms+=65) {
      const {p,world}=frontSquat(ms,true);frontToes(p,20);
      if(wide)for(const s of [0,1]) {const shift=s===0?-.1:.1;for(const i of [27,29,31])p[i+s].x+=shift;}
      const a=e.update(p,ms,1,false,world).assessment;
      const knee=a.corrections?.find(c=>c.id==='knee-track-25');
      if(a.debug.state==='CALIBRATING_STANDING'||wide)assert.equal(knee,undefined);
      if(knee){assert.equal(knee.joint,25);assert.ok(['DESCENDING','HOLDING','ASCENDING'].includes(a.debug.state!));if(a.debug.state==='DESCENDING')descentCue=true;}
      stanceCue ||= !!a.corrections?.some(c=>c.id.startsWith('stance-'));
    }
    assert.equal(descentCue,!wide);assert.equal(stanceCue,wide);
  }
});

test('curl setup corrects elbows and hands before a curl and removes only corrected issues',()=>{
  const e=new CoachEngine('curl','front');let both=false,remaining=false;
  for(let ms=0;ms<4000;ms+=65) {
    const p=curl(0,'front');
    p[13].x=ms<2200?.27:.4;p[14].x=ms<2200?.73:.6;
    p[15].x=.08;p[16].x=.92;
    const a=e.update(p,ms).assessment,ids=a.corrections?.map(c=>c.id)??[];
    assert.equal(a.score,null);assert.equal(a.reps,0);
    both ||= ids.includes('elbow-13')&&ids.includes('hand-path-15');
    if(ms>3000)remaining ||= ids.includes('hand-path-15')&&!ids.includes('elbow-13');
  }
  assert.ok(both);assert.ok(remaining);
});

for(const view of ['side','front'] as CameraView[])test(`plank ${view} corrects setup before hold confirmation`,()=>{
  const e=new CoachEngine('plank',view);let early=false;
  for(let ms=0;ms<2300;ms+=65) {
    const frame=view==='front'?frontPlank():{p:demoPose('plank',0,false),world:undefined};
    const p=frame.p;
    if(view==='side')for(const s of [0,1]) {p[15+s].x-=.13;p[13+s].x-=.065;p[23+s].y-=.09;}
    else {p[15].y+=.06;p[13].y+=.03;frame.world=p.map((v,i)=>({...v,z:frame.world![i].z}));}
    const a=e.update(p,ms,1,false,frame.world).assessment;
    if(a.debug.state==='MOVING_INTO_POSITION' && a.corrections?.length) {early=true;assert.notEqual(a.score,null);assert.equal(a.holdMs,0);assert.equal(a.debug.state,'MOVING_INTO_POSITION');assert.equal(a.debug.coachingEnabled,true);assert.equal(a.reps,0);}
  }
  assert.ok(early);
});

test('scoring windows freeze displayed values and tracking loss clears both gates immediately',()=>{
  for(const id of ['curl','plank'] as const) {
    const e=new CoachEngine(id,'side');let updated:number|null=null,score:number|null=null,updates=0;
    for(let ms=0;ms<6200;ms+=65) {
      const p=id==='curl'?curl(ms,'side'):demoPose('plank',0,false);
      if(id==='plank')for(const s of [0,1])p[23+s].y+=.07+.015*Math.sin(ms/900);
      const a=e.update(p,ms).assessment,at=a.debug.scoreUpdatedAt??null;
      if(a.score!==null) {
        assert.equal(a.debug.scoringEnabled,true);
        if(updated!==null && at!==updated)assert.ok(at!-updated>=FEEDBACK.scoreIntervalMs[id]);
        if(at===updated)assert.equal(a.score,score);
        if(at!==updated)updates++;
        updated=at;score=a.score;
      } else {updated=null;score=null;}
    }
    assert.ok(updates>0);
    const p=id==='curl'?curl(3500,'side'):demoPose('plank',0,false);p[15].visibility=0;p[16].visibility=0;
    const bad=e.update(p,6250).assessment;
    assert.equal(bad.score,null);assert.equal(bad.corrections?.length??0,0);assert.ok(!bad.debug.coachingEnabled);assert.ok(!bad.debug.scoringEnabled);
  }
});

test('invalid camera view hides setup targets and validation logs only derived summaries',()=>{
  const e=new CoachEngine('curl','side');let a=e.interrupt();
  for(let ms=0;ms<3000;ms+=65)a=e.update(curl(0,'front'),ms).assessment;
  assert.equal(a.score,null);assert.equal(a.corrections?.length??0,0);assert.equal(a.debug.coachingEnabled,false);
  const row=validationRecord(a,'curl','side','camera',1234);
  assert.equal(row.exercise,'curl');assert.equal(row.view,'side');assert.equal(row.source,'camera');assert.equal(row.confidence.viewValid,false);
  assert.ok(!('pose' in row));assert.ok(!('landmarks' in row));assert.ok(!('video' in row));
});

test('side curl setup shows torso, upper-arm and backward forearm corrections without scoring',()=>{
  const e=new CoachEngine('curl','side');let seen=false;
  for(let ms=0;ms<2400;ms+=65) {
    const p=curl(0,'side');
    for(const s of [0,1]){p[11+s].x+=.09;p[13+s].x=.75+s*.025;p[15+s].x=.52+s*.025;}
    p[0].x=.59;p[7].x=.55;p[8].x=.55;
    const a=e.update(p,ms).assessment,ids=a.corrections?.map(c=>c.id)??[];
    assert.equal(a.score,null);assert.equal(a.reps,0);
    seen ||= ['torso','upper-arm','forearm-path'].every(id=>ids.includes(id));
  }
  assert.ok(seen);
});

// Live metrics are derived from pose sequences, never from elapsed time alone.
for(const view of ['front','side'] as CameraView[])test(`curl ${view}: Ready, live phases and incomplete/uncertain cycles`,()=>{
  for(const mode of ['complete','partial','lost']) {
    const e=new CoachEngine('curl',view);const phases=new Set<string>();let ready=false,last=e.interrupt();
    for(let ms=0;ms<6500;ms+=65) {
      const t=mode==='partial'&&ms>2600?Math.max(0,2600-(ms-2600)):ms;
      const p=curl(t,view);if(mode==='lost'&&ms>3000&&ms<3200)for(const i of [15,16])p[i].visibility=0;
      last=e.update(p,ms).assessment;
      if(ms>1200&&ms<1700){assert.equal(last.score,null);assert.equal(last.scoreStatus,'ready');ready=true;}
      if(last.score!==null)phases.add(last.debug.state!);
      if(ms<5400)assert.equal(last.reps,0);
      if(mode==='lost'&&ms>3000&&ms<3200){assert.equal(last.score,null);assert.notEqual(last.scoreStatus,'ready');}
    }
    assert.ok(ready);
    if(mode==='complete'){for(const state of ['CURLING_UP','TOP','LOWERING'])assert.ok(phases.has(state));assert.equal(last.reps,1);}
    else assert.equal(last.reps,0);
  }
});

test('curl complete-cycle quality respects the configurable threshold, including poor form',()=>{
  const original=FEEDBACK.qualityRepThreshold;
  const run=(bad=false)=>{
    const e=new CoachEngine('curl','side');let last=e.interrupt();
    for(let ms=0;ms<6500;ms+=65){const p=curl(ms,'side');if(bad&&ms>1800)for(const i of [23,24])p[i].x-=Math.min(1,(ms-1800)/500)*.22;last=e.update(p,ms).assessment;}
    return last;
  };
  try {
    const good=run(),bad=run(true);
    assert.equal(good.debug.completedCycles,1);assert.equal(good.reps,1);
    assert.equal(bad.debug.completedCycles,1);assert.ok(bad.debug.lastRepScore!<original);assert.equal(bad.reps,0);
    FEEDBACK.qualityRepThreshold=bad.debug.lastRepScore!-.01;assert.equal(run(true).reps,1);
    FEEDBACK.qualityRepThreshold=bad.debug.lastRepScore!+.01;assert.equal(run(true).reps,0);
  } finally {FEEDBACK.qualityRepThreshold=original;}
});

for(const view of ['front','side'] as CameraView[])test(`plank ${view}: live setup scoring, hold timer and immediate reset on uncertainty`,()=>{
  const e=new CoachEngine('plank',view);let early=false,held=false,last=e.interrupt();
  for(let ms=0;ms<3300;ms+=65){const {p,world}=view==='front'?frontPlank():{p:demoPose('plank',0,false),world:undefined};last=e.update(p,ms,1,false,world).assessment;
    if(last.debug.state==='MOVING_INTO_POSITION' && last.score!==null){early=true;assert.equal(last.holdMs,0);}
    if(last.debug.state==='HOLDING' && (last.holdMs??0)>1000)held=true;
    assert.equal(last.reps,0);
  }
  assert.ok(early);assert.ok(held);
  const {p,world}=view==='front'?frontPlank():{p:demoPose('plank',0,false),world:undefined};p[15].visibility=0;p[16].visibility=0;
  last=e.update(p,3310,1,false,world).assessment;assert.equal(last.score,null);assert.equal(last.holdMs??0,0);
  assert.equal(e.interrupt().holdMs??0,0);
});

test('a prolonged front squat hold keeps live scoring and completes a quality rep after ascent',()=>{
  const e=new CoachEngine('squat','front');let last=e.interrupt();
  for(let ms=0;ms<26000;ms+=65){const t=ms<5000?ms:ms<21000?5000:ms-16000;const {p,world}=frontSquat(t);last=e.update(p,ms,1,false,world).assessment;if(ms>16000&&ms<21000){assert.equal(last.debug.state,'HOLDING');assert.notEqual(last.score,null);}}
  assert.equal(last.reps,1);assert.equal(last.debug.completedCycles,1);
});

function targetPerson(center=.5,scale=1):Pose {
  return curl(0,'front').map(p=>({...p,x:center+(p.x-.5)*scale,y:.5+(p.y-.5)*scale}));
}

test('target acquisition is persistent, ignores detection order and keeps a background person out',()=>{
  const target=new TargetTracker(),person=targetPerson(),background=targetPerson(.82,.65);
  for(let now=0;now<520;now+=65){const s=target.update([background,person],now);assert.equal(s.state,'selecting');assert.equal(s.pose,undefined);}
  const locked=target.update([background,person],520);assert.equal(locked.state,'locked');assert.equal(locked.pose,person);assert.equal(locked.index,1);assert.equal(locked.acquired,true);
  for(let now=585;now<1600;now+=65){const poses=now%2?[person,background]:[background,person],s=target.update(poses,now);assert.equal(s.pose,person);assert.equal(poses[s.index!],person);assert.equal(s.acquired,false);}
  const larger=targetPerson(.78,1.3);assert.equal(target.update([larger,person],1625).pose,person);
});

test('target loss suppresses all pose output immediately and requires sustained loss plus new acquisition to switch people',()=>{
  const target=new TargetTracker(),person=targetPerson(),other=targetPerson(.75);
  for(let now=0;now<=650;now+=65)target.update([person],now);
  for(let now=715;now<650+TARGET.lostMs;now+=65){const s=target.update([other],now);assert.equal(s.state,'occluded');assert.equal(s.pose,undefined);assert.equal(s.index,undefined);}
  let s=target.update([other],1560);assert.equal(s.state,'selecting');assert.equal(s.pose,undefined);
  for(let now=1625;now<=2145;now+=65)s=target.update([other],now);
  assert.equal(s.state,'locked');assert.equal(s.pose,other);
});

test('brief occlusion resumes only the same geometric target; overlap requires fresh acquisition',()=>{
  const target=new TargetTracker(),person=targetPerson();
  for(let now=0;now<=650;now+=65)target.update([person],now);
  assert.equal(target.update([],715).state,'occluded');
  assert.equal(target.update([person],780).state,'locked');
  const overlap=targetPerson(.505);
  assert.equal(target.update([person,overlap],845).state,'occluded');
  assert.equal(target.update([overlap],910).pose,undefined,'do not guess which person emerged from an overlap');
});

test('acquisition rejects ambiguous, small, unreliable or stale evidence and allows upper-body-only curl framing',()=>{
  for(const poses of [[targetPerson(.4),targetPerson(.6)],[targetPerson(.5,.2)],[targetPerson().map(p=>({...p,visibility:.1}))]]) {
    const target=new TargetTracker();for(let now=0;now<2000;now+=65)assert.equal(target.update(poses,now).state,'selecting');
  }
  const target=new TargetTracker(),pose=targetPerson();for(const i of [12,24,25,26,27,28])pose[i].visibility=0;
  for(let now=0;now<520;now+=65)target.update([pose],now);
  assert.equal(target.update([pose],520).pose,pose,'hidden legs or far-side torso must not block target acquisition');
  target.reset();target.update([pose],0);assert.equal(target.update([pose],1000).state,'selecting');
  assert.equal(target.update([],1100).state,'selecting');
});
