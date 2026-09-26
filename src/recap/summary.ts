import type { Assessment } from '../pose/types';
import { EXERCISES, TARGET, type ExerciseId } from '../config';

export const ISSUE_KEYS = {
  squat: ['shallowDepth','torsoLean','instability','stanceTooWide','stanceTooNarrow','toeDirection','setupSymmetry','hipCentering','kneeTracking','heelLift'],
  curl: ['bodySwing','backwardLean','hipDrive','elbowDrift','incompleteLowering','partialRange','instability','control','torsoLean','armPath','armSymmetry'],
  plank: ['hipsHigh','hipsLow','bodyLineDeviation','handPlacement','setupSymmetry','hipCentering','instability'],
} as const;
export type IssueKey = typeof ISSUE_KEYS[ExerciseId][number];
export type IssueAggregate = { count:number; averageSeverity:number; maxSeverity:number };
export type SessionSummary<E extends ExerciseId = ExerciseId> = { [K in E]: {
  exercise:K; view:'front'|'side'; source:'camera'|'demo';
  enoughValidData:boolean;averageAlignment:number|null; bestAlignment:number|null; validScoreSamples:number;
  issues:Record<typeof ISSUE_KEYS[K][number],IssueAggregate>; rejectedMovements:number;
} & (K extends 'plank' ? {totalHoldMs:number;bestHoldMs:number} : {completedReps:number;qualityReps:number}) }[E];
const clamp=(n:number)=>Math.max(0,Math.min(1,n));
const round=(n:number)=>Math.round(n*100)/100;

/** Retains counters only. No assessment, coordinates, images or per-frame history are stored. */
export class SessionMetrics<E extends ExerciseId = ExerciseId> {
  private completed=0;private quality=0;private previousCompleted=0;private previousQuality=0;private partialCount=0;private partialTotal=0;
  private scores=0;private scoreTotal=0;private best:number|null=null;
  private scoreAt:number|null=null;
  private active=new Map<IssueKey,number>();
  private issues:Partial<Record<IssueKey,{count:number;total:number;max:number}>>;
  private totalHold=0;private bestHold=0;private continuousHold=0;private previousHold:{at:number;ms:number}|null=null;
  private rejected=0;private rejectionCounted=false;
  constructor(private exercise:E,private view:'front'|'side',private source:'camera'|'demo') {
    this.issues=Object.fromEntries(ISSUE_KEYS[exercise].map(key=>[key,{count:0,total:0,max:0}]));
  }
  interrupt(){this.previousHold=null;this.continuousHold=0;this.active.clear();this.scoreAt=null;}
  newEvaluator(){this.interrupt();this.previousCompleted=0;this.previousQuality=0;this.partialCount=0;this.partialTotal=0;this.active.clear();this.rejectionCounted=false;this.scoreAt=null;}
  observe(a:Assessment,now:number) {
    if(a.debug.exercise!==this.exercise){this.interrupt();return;}
    if(a.debug.completedCycles!==undefined){this.completed+=Math.max(0,a.debug.completedCycles-this.previousCompleted);this.previousCompleted=Math.max(this.previousCompleted,a.debug.completedCycles);}
    this.quality+=Math.max(0,a.reps-this.previousQuality);this.previousQuality=Math.max(this.previousQuality,a.reps);
    const p=a.debug.curlPartial;
    if(this.exercise==='curl' && p && p.count>=this.partialCount) {
      const bucket=this.issues.partialRange!;
      bucket.count+=p.count-this.partialCount;bucket.total+=p.severityTotal-this.partialTotal;bucket.max=Math.max(bucket.max,p.maxSeverity);
      this.partialCount=p.count;this.partialTotal=p.severityTotal;
    }
    const holding=this.exercise==='plank' && a.debug.state==='HOLDING' && a.debug.scoringEnabled && a.debug.viewValid && a.score!==null && Number.isFinite(a.score) && Number.isFinite(a.holdMs) && a.holdMs!>=0;
    if(holding) {
      const previous=this.previousHold,ms=a.holdMs!;
      if(previous && now>previous.at && now-previous.at<=TARGET.maxFrameGapMs && ms>=previous.ms) {
        const delta=Math.min(ms-previous.ms,now-previous.at);
        this.totalHold+=delta;this.continuousHold+=delta;this.bestHold=Math.max(this.bestHold,this.continuousHold);
      } else this.continuousHold=0;
      this.previousHold={at:now,ms};
    } else {this.previousHold=null;this.continuousHold=0;}
    const at=now;
    if((this.exercise!=='plank'||holding) && a.debug.scoringEnabled && a.debug.viewValid && a.score!==null && Number.isFinite(a.score) && (this.scoreAt===null||at-this.scoreAt>=200)) {
      this.scoreAt=at;this.scores++;this.scoreTotal+=a.score;this.best=Math.max(this.best??0,a.score);
    }
    const current=new Map<IssueKey,number>();
    if(a.debug.viewValid && a.debug.coachingEnabled)for(const cue of a.corrections??[]) {
      let key:IssueKey|undefined;
      const id=cue.id;
      if(id==='stability'||id.startsWith('stability-'))key='instability';
      if(this.exercise==='curl') {
        if(id==='trunk-swing')key='bodySwing';
        if(id==='torso')key=this.view==='side' && a.debug.angles.backwardLean>EXERCISES.curl.maxLean?'backwardLean':'torsoLean';
        if(id==='hip-shift' && this.view==='side')key='hipDrive';
        if(id==='upper-arm'||id.startsWith('elbow-'))key='elbowDrift';
        if(id.startsWith('bottom-range-'))key='incompleteLowering';
        if(id==='control')key='control';
        if(id==='forearm-path'||id.startsWith('hand-path-'))key='armPath';
        if(id==='arm-symmetry')key='armSymmetry';
      } else if(this.exercise==='squat') {
        if(id==='depth')key='shallowDepth';
        if(id==='torso')key='torsoLean';
        if(id==='heel-lift')key='heelLift';
        if(id.startsWith('stance-wide-'))key='stanceTooWide';
        if(id.startsWith('stance-narrow-'))key='stanceTooNarrow';
        if(id.startsWith('toe-direction-'))key='toeDirection';
        if(id==='leg-symmetry'||id==='foot-symmetry')key='setupSymmetry';
        if(id==='balance')key='hipCentering';
        if(id.startsWith('knee-track-'))key='kneeTracking';
      } else {
        if(id==='hip-line')key=a.debug.angles.hipLineOffset<0?'hipsHigh':a.debug.angles.hipLineOffset>0?'hipsLow':'bodyLineDeviation';
        if(id==='knee-line')key='bodyLineDeviation';
        if(id==='hand-stack'||id==='level-15')key='handPlacement';
        if(id.startsWith('level-') && id!=='level-15')key='setupSymmetry';
        if(id==='balance')key='hipCentering';
      }
      if(key && Number.isFinite(cue.severity))current.set(key,Math.max(current.get(key)??0,clamp(cue.severity)));
    }
    for(const [key,value] of current) {
      const previous=this.active.get(key),bucket=this.issues[key]!;
      if(previous===undefined){bucket.count++;bucket.total+=value;this.active.set(key,value);}
      else if(value>previous){bucket.total+=value-previous;this.active.set(key,value);}
      bucket.max=Math.max(bucket.max,value);
    }
    for(const key of this.active.keys())if(!current.has(key))this.active.delete(key);
    const rejected=this.exercise==='curl' && a.debug.viewValid && a.score===null && ['Arm motion does not follow a standing curl path','Waiting for standing curl position'].includes(a.reason);
    if(rejected && !this.rejectionCounted){this.rejected++;this.rejectionCounted=true;}
    else if(!rejected && a.debug.viewValid && a.debug.coachingEnabled)this.rejectionCounted=false;
  }
  /** Presentation totals only; call after observe(), never feed them back into the evaluator. */
  forDisplay(a:Assessment):Assessment {
    if(this.exercise==='plank')return a;
    return {...a,reps:this.quality,debug:{...a.debug,completedCycles:this.completed}};
  }
  snapshot():SessionSummary<E> {
    return {exercise:this.exercise,view:this.view,source:this.source,
      ...(this.exercise==='plank'?{totalHoldMs:Math.round(this.totalHold),bestHoldMs:Math.round(this.bestHold)}:{completedReps:this.completed,qualityReps:this.quality}),
      enoughValidData:this.scores>0&&(this.exercise==='plank'?this.totalHold>0:this.completed>0),averageAlignment:this.scores?round(this.scoreTotal/this.scores):null,bestAlignment:this.best,validScoreSamples:this.scores,
      issues:Object.fromEntries(ISSUE_KEYS[this.exercise].map(key=>{const b=this.issues[key]!;return [key,{count:b.count,averageSeverity:b.count?round(b.total/b.count):0,maxSeverity:round(b.max)}];})),rejectedMovements:this.rejected} as unknown as SessionSummary<E>;
  }
}

/** Strict boundary: reject extra keys rather than forwarding arbitrary client data. */
export function parseSummary(value:unknown):SessionSummary|null {
  const object=(v:unknown):v is Record<string,unknown>=>!!v&&typeof v==='object'&&!Array.isArray(v);
  const exact=(v:Record<string,unknown>,keys:string[])=>Object.keys(v).length===keys.length&&keys.every(k=>Object.hasOwn(v,k));
  const num=(v:unknown,max:number)=>typeof v==='number'&&Number.isFinite(v)&&v>=0&&v<=max;
  const count=(v:unknown)=>num(v,1000000)&&Number.isInteger(v);
  if(!object(value)||!['squat','curl','plank'].includes(value.exercise as string))return null;
  const exercise=value.exercise as ExerciseId,plank=exercise==='plank';
  if(!exact(value,['exercise','view','source',...(plank?['totalHoldMs','bestHoldMs']:['completedReps','qualityReps']),'enoughValidData','averageAlignment','bestAlignment','validScoreSamples','issues','rejectedMovements']))return null;
  if(!['front','side'].includes(value.view as string)||!['camera','demo'].includes(value.source as string))return null;
  if(![value.validScoreSamples,value.rejectedMovements].every(count))return null;
  if(plank) {
    if(![value.totalHoldMs,value.bestHoldMs].every(v=>num(v,86400000)&&Number.isInteger(v))||Number(value.bestHoldMs)>Number(value.totalHoldMs))return null;
  } else if(![value.completedReps,value.qualityReps].every(count)||Number(value.qualityReps)>Number(value.completedReps))return null;
  if(value.enoughValidData!==(Number(value.validScoreSamples)>0&&(plank?Number(value.totalHoldMs)>0:Number(value.completedReps)>0)))return null;
  if(![value.averageAlignment,value.bestAlignment].every(v=>v===null||num(v,100)))return null;
  if((value.validScoreSamples===0)!==(value.averageAlignment===null)|| (value.averageAlignment===null)!==(value.bestAlignment===null))return null;
  if(value.averageAlignment!==null&&Number(value.averageAlignment)>Number(value.bestAlignment))return null;
  if(!object(value.issues)||!exact(value.issues,[...ISSUE_KEYS[exercise]]))return null;
  for(const key of ISSUE_KEYS[exercise]){const b=value.issues[key];if(!object(b)||!exact(b,['count','averageSeverity','maxSeverity'])||!count(b.count)||!num(b.averageSeverity,1)||!num(b.maxSeverity,1)||Number(b.averageSeverity)>Number(b.maxSeverity)||(b.count===0&&(b.averageSeverity!==0||b.maxSeverity!==0)))return null;}
  return JSON.parse(JSON.stringify(value)) as SessionSummary;
}
