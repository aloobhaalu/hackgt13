import test from 'node:test';
import assert from 'node:assert/strict';
import { coachingText } from './coachingText';
import { alignmentText } from './scoreDisplay';
import { emptyAssessment, CoachEngine } from './engine';
import { repFrame } from './repFixtures';
import type { Assessment, Correction } from './types';

const cue=(id:string):Correction=>({id,label:'',joint:13,anchor:11,target:{x:.4,y:.4,visibility:1},kind:'translation',severity:.5});
const visible=():Assessment=>({...emptyAssessment(),ready:true,debug:{...emptyAssessment().debug,coachingEnabled:true,viewValid:true}});

test('live wording uses every confirmed issue, groups both arms, and removes corrected cues independently',()=>{
  const a=visible();a.score=42;
  a.corrections=['elbow-13','elbow-14','elbow-motion-0','elbow-motion-1','torso','bottom-range-0'].map(cue);
  const text=coachingText(a,'curl','front');
  assert.equal(text.status,'42%');assert.equal(text.prompt,null);assert.equal(text.cues.length,4);
  assert.ok(text.cues.includes('Keep your elbows close to your torso'));
  assert.ok(text.cues.includes('Keep your elbows still as you curl'));
  a.corrections=a.corrections.filter(c=>!c.id.startsWith('elbow-'));
  assert.deepEqual(coachingText(a,'curl','front').cues,['Keep your torso still and upright','Lower your arms fully before the next curl']);
});

test('uncertain tracking and wrong views give setup guidance without invented form cues',()=>{
  const a=visible();a.corrections=[cue('elbow-13')];
  a.ready=false;
  assert.equal(coachingText(a,'curl','front').status,'Tracking unclear');
  assert.equal(coachingText(a,'curl','front').cues.length,0);
  a.ready=true;a.debug.viewValid=false;
  assert.equal(coachingText(a,'curl','side').status,'Adjust camera');
  assert.equal(coachingText(a,'curl','side').prompt,'Turn sideways to the camera for this view');
  assert.equal(coachingText(a,'curl','side').cues.length,0);
});

for(const exercise of ['squat','curl'] as const)for(const view of ['front','side'] as const)test(`${exercise} ${view}: Ready means calibration is finished`,()=>{
  const e=new CoachEngine(exercise,view);let calibrated=false,settingUp=false;
  for(let t=0;t<3300;t+=65) {
    const f=repFrame(exercise,view,0),a=e.update(f.pose,t,16/9,false,f.world).assessment;
    const cycle=exercise==='squat'?a.debug.squatCycle:a.debug.curlCycle;
    if(!cycle?.calibrated){assert.notEqual(alignmentText(a),'Ready');settingUp||=alignmentText(a)==='Hold still'||!a.ready;}
    else {assert.equal(alignmentText(a),'Ready');calibrated=true;}
  }
  assert.ok(settingUp);assert.ok(calibrated);
});

test('casual poses have exercise-specific setup wording and never imply a bad form score',()=>{
  const a=visible();
  a.debug.curlCycle={state:'READY',calibrated:false,validCycle:false,topConfirmed:false,blockReason:'',lastFailure:null,returnConfirmationMs:0};
  a.debug.angles.joint=90;
  assert.equal(alignmentText(a),'Lower your arms');
  const squat=visible();squat.debug.squatCycle={state:'CALIBRATING_STANDING',calibrated:false,bottomConfirmed:false,blockReason:'',lastFailure:null,ascentConfirmationMs:0};squat.debug.angles.joint=95;
  assert.equal(alignmentText(squat),'Stand tall');
  assert.equal(coachingText(squat,'squat','front').cues.length,0);
});

test('foot and plank wording follows the measured issue and target direction',()=>{
  const a=visible();a.corrections=[cue('stance-wide-27'),cue('stance-wide-28'),cue('stability-23'),cue('stability-25')];
  assert.deepEqual(coachingText(a,'squat','front').cues,['Bring your feet closer together','Slow down and keep the movement steady']);
  a.corrections=[cue('hip-line'),cue('hand-stack')];a.debug.angles.hipLineOffset=.2;
  assert.deepEqual(coachingText(a,'plank','side').cues,['Lift your hips toward the green line','Bring your hands closer beneath your shoulders']);
  a.debug.angles.hipLineOffset=-.2;
  assert.equal(coachingText(a,'plank','side').cues[0],'Lower your hips toward the green line');
});
