import { SessionMetrics } from '../recap/summary';
import test from 'node:test';
import assert from 'node:assert/strict';
import { CoachEngine } from './engine';
import { demoPose } from './demo';
import { EXERCISES, type CameraView } from '../config';
import type { Pose } from './types';

// Independent fixed-length arm fixture: front flexion travels into depth, not sideways.
function frame(flex:number,view:CameraView,hipShift=0,raise=0,scale=1) {
  const p:Pose=demoPose('curl',0,false);
  for(const side of [0,1]) {
    const x=view==='front'?.39+side*.22:.48+side*.025,sign=side===0?-1:1;
    p[11+side]={x,y:.24,z:0,visibility:.99};p[23+side]={x:x+hipShift,y:.51,z:0,visibility:.99};
    const abduction=raise*Math.PI/180;
    p[13+side]={x:x+sign*.19*Math.sin(abduction),y:.24+.19*Math.cos(abduction),z:0,visibility:.99};
    const r=(5+140*flex)*Math.PI/180,forward=.16*Math.sin(r),e=p[13+side];
    p[15+side]={x:e.x+(view==='front'?-sign*.08*forward:forward),y:e.y+.16*Math.cos(r),z:view==='front'?-forward*Math.sqrt(1-.08**2):0,visibility:.99};
  }
  p[0]={x:view==='side'?.56:.5,y:.15,z:0,visibility:.99};p[7]={x:.51,y:.15,z:0,visibility:.99};p[8]={x:.515,y:.15,z:0,visibility:.99};
  for(const i of [25,26,27,28,29,30,31,32])p[i].visibility=0;
  const pose=p.map(p=>({...p,x:.1+p.x*scale*.8,y:.08+p.y*scale*.8,z:(p.z??0)*scale*.8}));
  return {pose,world:pose.map(p=>({...p}))};
}
const full=(t:number)=>t<3000?0:t<4500?(t-3000)/1500:t<5100?1:t<6800?1-(t-5100)/1700:0;
for(const view of ['front','side'] as const) {
  test(`curl ${view}: calibrates once, completes two full reps and does not fault controlled lowering`,()=>{
    const e=new CoachEngine('curl',view);let last=e.interrupt(),live=false;
    for(let t=0;t<16000;t+=65){const f=frame(full(t<8000?t:t-8000),view);last=e.update(f.pose,t,1,false,f.world).assessment;
      if(t<2000){assert.equal(last.score,null);assert.equal(last.reps,0);}
      if(last.debug.state==='CURLING_UP'){live=true;assert.notEqual(last.score,null);}
      assert.ok(!last.corrections?.some(c=>c.id.startsWith('bottom-range')),'normal controlled lowering is not an incomplete-range fault');
    }
    assert.ok(live);assert.equal(last.reps,2);assert.equal(last.debug.completedCycles,2);
  });
  test(`curl ${view}: half lowering and recurl show a downward target and cannot count until a new complete cycle`,()=>{
    const e=new CoachEngine('curl',view);let target=false,both=false,last=e.interrupt();
    for(let t=0;t<19500;t+=65){
      const flex=t<5100?full(t):t<6000?1-(t-5100)/1800:t<7000?.5:t<8000?.5+(t-7000)/2000:t<8500?1:t<10300?1-(t-8500)/1800:t<11000?0:full(t-11000);
      const f=frame(flex,view,view==='side'&&t>5600&&t<8500?.14:0);
      last=e.update(f.pose,t,1,false,f.world).assessment;
      if(t<14000)assert.equal(last.reps,0);
      const cues=last.corrections?.filter(c=>c.id.startsWith('bottom-range'))??[];
      if(cues.length && t<8500){target=true;for(const c of cues){assert.ok(c.target.y>f.pose[c.joint].y);assert.equal(c.anchor,c.joint-2);assert.equal(c.kind,'translation');}assert.notEqual(last.score,null);}
      both ||= cues.length>0 && !!last.corrections?.some(c=>c.id==='torso');
      if(t>11000&&t<13500)assert.equal(cues.length,0,'returning down removes only the bottom correction');
    }
    assert.ok(target);if(view==='side')assert.ok(both);assert.equal(last.reps,1);assert.equal(last.debug.completedCycles,1);
  });
  test(`curl ${view}: static bends, tiny pulses and lateral raises cannot become reps`,()=>{
    for(const mode of ['static','tiny','raise']){const e=new CoachEngine('curl',view);
      for(let t=0;t<9000;t+=65){const flex=mode==='static'?.6:mode==='tiny'&&t>3000?.04*(1+Math.sin(t/500)):mode==='raise'?full(t):0;
        const f=frame(flex,view,0,mode==='raise'&&t>3000?75:0),a=e.update(f.pose,t,1,false,f.world).assessment;
        assert.equal(a.reps,0,mode);assert.equal(a.score,null,mode);
      }
    }
  });
}

test('side backward lean and forward hips get separate baseline targets; front never gives side verdicts',()=>{
  for(const view of ['front','side'] as const){const e=new CoachEngine('curl',view);let torso=false,hips=false,low=false;
    for(let t=0;t<7900;t+=65){const shift=t<3200?0:Math.min(1,(t-3200)/600)*.14;const f=frame(full(t),view,shift),a=e.update(f.pose,t,1,false,f.world).assessment;
      const ids=a.corrections?.map(c=>c.id)??[];
      torso ||= ids.includes('torso');hips ||= ids.includes('hip-shift');low ||= a.score!==null&&a.score<80;
      if(view==='front')assert.ok(!ids.some(id=>['torso','hip-shift','trunk-swing','upper-arm'].includes(id)));
      else assert.ok(!ids.some(id=>id.startsWith('elbow-')||id==='arm-symmetry'));
    }
    if(view==='side'){assert.ok(torso);assert.ok(hips);assert.ok(low);}
  }
});

test('uncertain facing suppresses hip-direction targets and confidence loss clears range guidance',()=>{
  const e=new CoachEngine('curl','side');let range=false;
  for(let t=0;t<8500;t+=65){const f=frame(t<5100?full(t):.5,'side',t>5500?.14:0);f.pose[0].visibility=0;f.pose[7].x=f.pose[8].x=f.pose[0].x;
    if(t>7500)f.pose[15].visibility=f.pose[16].visibility=0;
    const a=e.update(f.pose,t,1,false,f.world).assessment;
    assert.ok(!a.corrections?.some(c=>c.id==='hip-shift'));range ||= !!a.corrections?.some(c=>c.id.startsWith('bottom-range'));
    if(t>7500){assert.equal(a.score,null);assert.equal(a.corrections?.length??0,0);}
  }
  assert.ok(range);
});

test('curl calibration duration is in the requested range and measurements are scale invariant',()=>{
  assert.ok(EXERCISES.curl.readyMs>=1000&&EXERCISES.curl.readyMs<=1500);
  const a=new CoachEngine('curl','side'),b=new CoachEngine('curl','side');
  for(let t=0;t<8500;t+=65){const x=frame(full(t),'side',0,0,1),y=frame(full(t),'side',0,0,.7);
    const p=a.update(x.pose,t,1,false,x.world).assessment,q=b.update(y.pose,t,1,false,y.world).assessment;
    assert.equal(p.reps,q.reps);assert.equal(p.score,q.score);assert.equal(p.debug.state,q.debug.state);
  }
});

test('an extended elbow with the whole arm still raised does not satisfy wrist return',()=>{
  const e=new CoachEngine('curl','side');let seen=false,last=e.interrupt();
  for(let t=0;t<10000;t+=65){const f=frame(full(t),'side');
    if(t>6000&&t<8300)for(const i of [13,14,15,16]){f.pose[i].y-=.05;f.world[i].y-=.05;}
    last=e.update(f.pose,t,1,false,f.world).assessment;
    if(t>7200&&t<8200){assert.equal(last.reps,0);const cue=last.corrections?.find(c=>c.id==='bottom-range-0');
      if(cue){seen=true;assert.ok(cue.target.y>f.pose[15].y+.04);assert.ok(cue.targetAnchor);assert.ok(cue.target.y-cue.targetAnchor.y>.1);}}
  }
  assert.ok(seen);assert.equal(last.reps,1);
});

test('session aggregates come from local torso, elbow, partial-range and rejected-movement detections without network calls',()=>{
  const fetchOriginal=globalThis.fetch;let requests=0;globalThis.fetch=(()=>{requests++;throw new Error('Network disabled');}) as typeof fetch;
  try {
    for(const kind of ['torso','swing','elbow','partial','invalid'] as const) {
      const view=kind==='elbow'?'front':'side',e=new CoachEngine('curl',view),metrics=new SessionMetrics('curl',view,'camera');
      for(let t=0;t<11500;t+=65){
        const flex=kind==='partial'&&t>5100?(t<6200?1-(t-5100)/2200:t<7000?.5:t<8000?.5+(t-7000)/2000:1):full(t);
        const f=frame(flex,view,kind==='torso'&&t>3300?.14:0,kind==='elbow'&&t>3300?40:kind==='invalid'&&t>3300?75:0);
        if(kind==='swing'&&t>3300)for(const i of [11,12,13,14,15,16,23,24]){const dx=.1*Math.sin((t-3300)/450);f.pose[i].x+=dx;f.world[i].x+=dx;}
        const a=e.update(f.pose,t,1,false,f.world).assessment;metrics.observe(a,t);
      }
      const summary=metrics.snapshot();
      if(kind==='torso'){assert.ok(summary.issues.backwardLean.count>0);assert.ok(summary.issues.hipDrive.count>0);}
      if(kind==='swing')assert.ok(summary.issues.bodySwing.count>0);
      if(kind==='elbow')assert.ok(summary.issues.elbowDrift.count>0);
      if(kind==='partial'){assert.ok(summary.issues.incompleteLowering.count>0);assert.equal(summary.issues.partialRange.count,1);assert.equal(summary.completedReps,0);}
      if(kind==='invalid'){assert.equal(summary.rejectedMovements,1);assert.equal(summary.completedReps,0);}
    }
    assert.equal(requests,0);
  }finally{globalThis.fetch=fetchOriginal;}
});


for(const view of ['front','side'] as const)test(`curl ${view}: natural top reversal and brief down pause count each full cycle once`,()=>{
  for(const peak of [.85,1]) {const e=new CoachEngine('curl',view);let last=e.interrupt(),previous=0;
    for(let t=0;t<10700;t+=65){const phase=(t-3000)%2500;const ease=(x:number)=>(1-Math.cos(Math.PI*x))/2;
      const flex=t<3000?0:phase<1100?ease(phase/1100)*peak:phase<2200?(1-ease((phase-1100)/1100))*peak:0;
      const f=frame(flex,view);last=e.update(f.pose,t,1,false,f.world).assessment;
      const count=last.debug.completedCycles??0;
      assert.ok(count===previous||count===previous+1);if(count>previous){assert.equal(last.debug.state,'READY');assert.equal(last.debug.angles.bottomAccepted,1);}previous=count;
    }
    assert.equal(last.debug.completedCycles,3);assert.equal(last.reps,3);assert.ok(last.debug.curlCycle?.calibrated);
    assert.equal(e.interrupt().debug.completedCycles,3);
  }
});

for(const view of ['front','side'] as const)test(`curl ${view}: required-landmark loss cancels the current cycle without erasing completed reps`,()=>{
  const e=new CoachEngine('curl',view);let last=e.interrupt(),failure=false;
  for(let t=0;t<16000;t+=65){const f=frame(full(t<8000?t:t-8000),view);
    if(t>11800&&t<12000)f.pose[15].visibility=f.pose[16].visibility=.1;
    last=e.update(f.pose,t,1,false,f.world).assessment;failure ||= last.debug.curlCycle?.lastFailure==='Tracking/view confidence lost';
  }
  assert.equal(last.debug.completedCycles,1);assert.equal(last.reps,1);assert.ok(failure);
});
