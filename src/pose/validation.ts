import type { Assessment } from './types';

/** Allowlist: never include frame pixels, landmark coordinates, or a pose object. */
export function validationRecord(a: Assessment, exercise: string, view: string, source: string, elapsedMs: number) {
  const required=a.debug.landmarks.filter(l=>l.required);
  return {
    elapsedMs:Math.round(elapsedMs),exercise,view,source,
    coachingEnabled:a.debug.coachingEnabled===true,
    scoringEnabled:a.debug.scoringEnabled===true && a.score!==null,
    state:a.debug.state??'FRAME_INVALID',score:a.score,scoreStatus:a.scoreStatus??'uncertain',
    qualityReps:a.reps,holdMs:a.holdMs??0,completedCycles:a.debug.completedCycles??0,lastRepScore:a.debug.lastRepScore??null,
    issues:(a.corrections??[]).map(c=>({type:c.id,severity:c.severity})),
    confidence:{mean:a.confidence,minimumRequired:required.length?Math.min(...required.map(l=>l.visibility)):null,
      requiredCount:required.length,missing:required.filter(l=>!l.inFrame||l.visibility<0.45).map(l=>l.name),
      viewValid:a.debug.viewValid===true,shoulderSpread:a.debug.angles.shoulderSpread??a.debug.squat?.shoulderRatio??null},
    reason:a.debug.reason,
  };
}
