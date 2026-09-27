import type { Assessment } from './types';
import { EXERCISES, FRONT_SQUAT } from '../config';

export function alignmentText(a:Assessment) {
  if(a.score!==null)return `${a.score}%`;
  if(!a.ready || a.debug.trackingGapMs!==undefined)return 'Tracking unclear';
  if(a.debug.viewValid===false)return 'Adjust camera';
  const squat=a.debug.squat;
  if(squat?.baseline&&squat.state==='CALIBRATING_STANDING'&&squat.hipDrop!==null&&squat.hipDrop>EXERCISES.squat.minHipDrop/4&&squat.kneeAngle!==null&&squat.baseline.knee-squat.kneeAngle>=EXERCISES.squat.minKneeBend/2&&(squat.kneeVelocity??0)<=0.5)return 'Lowering';
  const front=a.debug.view==='front'&&a.debug.squatCycle?.calibrated&&a.debug.state==='CALIBRATING_STANDING';
  if(front&&a.debug.angles.hipDrop>FRONT_SQUAT.minDrop/4&&a.debug.angles.kneeBend>=FRONT_SQUAT.kneeBend/2&&a.debug.angles.angularSpeed<=0.5)return 'Lowering';
  if(a.debug.curlCycle&&!a.debug.curlCycle.calibrated) {
    return a.debug.angles.joint>EXERCISES.curl.phaseStart?'Hold still':'Lower your arms';
  }
  if(a.debug.squatCycle&&!a.debug.squatCycle.calibrated) {
    const s=a.debug.squat;
    const upright=s?s.kneeAngle!==null&&s.kneeAngle>=EXERCISES.squat.startKneeMin&&s.hipAngle!==null&&s.hipAngle>=EXERCISES.squat.startHipMin&&s.torsoTilt!==null&&s.torsoTilt<=EXERCISES.squat.startTorsoMax:a.debug.angles.joint>FRONT_SQUAT.uprightKnee;
    return upright?'Hold still':'Stand tall';
  }
  return a.scoreStatus==='ready'?'Ready':'Get into position';
}
export const holdTime = (ms: number) => `${Math.floor(ms / 60000)}:${String(Math.floor(ms / 1000) % 60).padStart(2, '0')}`;
