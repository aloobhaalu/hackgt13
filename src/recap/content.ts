import { ISSUE_KEYS, type SessionSummary, type IssueKey } from './summary';
export type Recap = {headline:string;tips:string[]};
const CURL:Record<string,Recap>={
  bodySwing:{headline:'Focus on steadier curls',tips:['Keep your torso still as you curl.','Use a controlled pace through the movement.']},
  backwardLean:{headline:'Focus on staying upright',tips:['Keep your torso near your calibrated upright position.']},
  hipDrive:{headline:'Focus on keeping hips still',tips:['Keep your hips near your starting position while curling.']},
  elbowDrift:{headline:'Focus on keeping elbows close',tips:['Keep your elbows near your torso as you curl.']},
  incompleteLowering:{headline:'Focus on full lowering',tips:['Lower fully before starting the next curl.']},
  partialRange:{headline:'Focus on complete curl cycles',tips:['Complete the upward curl, then return to your starting position.']},
  instability:{headline:'Focus on steadier curl positioning',tips:['Keep your upper body steady through each curl.']},
  control:{headline:'Focus on controlled curls',tips:['Slow the curl and lowering to a controlled pace.']},
  torsoLean:{headline:'Focus on upright curl posture',tips:['Keep your torso near your starting upright position.']},
  armPath:{headline:'Focus on the curl path',tips:['Bend your forearms toward your shoulders, then lower along that path.']},
  armSymmetry:{headline:'Focus on even arm movement',tips:['Move both arms through the curl together.']},
};
const SQUAT:Record<string,Recap>={
  shallowDepth:{headline:'Focus on squat depth',tips:['Follow the lower hip target during your squat.']},
  torsoLean:{headline:'Focus on steadier torso alignment',tips:['Follow the more upright torso target while squatting.']},
  instability:{headline:'Focus on controlled squats',tips:['Lower and rise at a steady, controlled pace.']},
  stanceTooWide:{headline:'Bring your squat stance closer',tips:['Bring your feet inward toward the stance targets.']},
  stanceTooNarrow:{headline:'Give your squat stance more space',tips:['Move your feet outward toward the stance targets.']},
  toeDirection:{headline:'Focus on foot direction',tips:['Follow the foot rotation targets when visible.']},
  setupSymmetry:{headline:'Focus on even squat setup',tips:['Use the leg and foot targets to balance your setup.']},
  hipCentering:{headline:'Focus on centered squat positioning',tips:['Keep your hips centered between your feet.']},
  kneeTracking:{headline:'Focus on knee tracking',tips:['Follow the knee targets during your squat.']},
  heelLift:{headline:'Focus on keeping heels grounded',tips:['Keep your heels near their grounded starting position.']},
};
const PLANK:Record<string,Recap>={
  hipsHigh:{headline:'Focus on lowering raised hips',tips:['Lower your hips toward the body-line target.']},
  hipsLow:{headline:'Focus on lifting lowered hips',tips:['Lift your hips toward the body-line target.']},
  bodyLineDeviation:{headline:'Focus on your plank body line',tips:['Follow the targets along your shoulder-to-ankle line.']},
  handPlacement:{headline:'Focus on plank hand placement',tips:['Adjust your hands toward the displayed alignment targets.']},
  setupSymmetry:{headline:'Focus on an even plank setup',tips:['Follow the alignment targets to even out your setup.']},
  hipCentering:{headline:'Focus on centered plank positioning',tips:['Center your hips between your hands.']},
  instability:{headline:'Focus on a steadier plank',tips:['Settle into a steady position before extending your hold.']},
};
const COPY={curl:CURL,squat:SQUAT,plank:PLANK};
export function rankedIssues(summary:SessionSummary) {
  const measured=summary.issues as Partial<Record<IssueKey,{count:number;averageSeverity:number;maxSeverity:number}>>;
  return ISSUE_KEYS[summary.exercise].filter(key=>measured[key]!.count>0).map(key=>({type:key,...measured[key]!,priority:Math.round(measured[key]!.count*Math.max(.1,measured[key]!.averageSeverity)*100)/100})).sort((a,b)=>b.priority-a.priority||b.count-a.count||b.maxSeverity-a.maxSeverity);
}
export function recapOptions(summary:SessionSummary) {
  const issues=rankedIssues(summary).slice(0,2).map(issue=>issue.type);
  const copy=COPY[summary.exercise];
  if(issues.length)return {headlines:[copy[issues[0]].headline],tips:[...new Set([...issues.map(k=>copy[k].tips[0]),...issues.flatMap(k=>copy[k].tips.slice(1))])]};
  if(summary.exercise==='curl') {
    if(summary.rejectedMovements)return {headlines:[summary.completedReps?'Keep the curl path consistent':'No complete curl movement confirmed'],tips:[]};
    if(!summary.validScoreSamples)return {headlines:['Not enough curl movement to summarize'],tips:[]};
    return {headlines:[summary.completedReps?'Curl session complete':'No completed curls recorded'],tips:[]};
  }
  if(summary.exercise==='plank')return {headlines:[summary.totalHoldMs>0?'Plank session complete':'No confirmed plank hold recorded'],tips:[]};
  return {headlines:[summary.completedReps?'Squat session complete':summary.validScoreSamples?'No completed squats recorded':'Not enough squat movement to summarize'],tips:[]};
}
export function localRecap(summary:SessionSummary):Recap {
  const options=recapOptions(summary);
  return {headline:options.headlines[0],tips:options.tips.slice(0,2)};
}
export function parseRecap(value:unknown,summary:SessionSummary):Recap|null {
  if(!value||typeof value!=='object'||Array.isArray(value))return null;
  const v=value as Record<string,unknown>,options=recapOptions(summary);
  if(Object.keys(v).length!==2||typeof v.headline!=='string'||!options.headlines.includes(v.headline)||v.headline.trim().split(/\s+/).length>8)return null;
  if(!Array.isArray(v.tips)||v.tips.length>2||!v.tips.every(t=>typeof t==='string'&&options.tips.includes(t)&&t.trim().split(/\s+/).length<=12)||new Set(v.tips).size!==v.tips.length)return null;
  return {headline:v.headline,tips:[...v.tips]};
}
