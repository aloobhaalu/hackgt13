import test from 'node:test';
import assert from 'node:assert/strict';
import { CoachEngine, angle, choosePose, framing } from './engine';
import { demoPose } from './demo';
import type { CameraView, ExerciseId } from '../config';
import type { Pose } from './types';

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
    p[31+s]={x:.38+s*.24,y:.93,visibility:.99};
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
