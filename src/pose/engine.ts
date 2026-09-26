import { EXERCISES, TRACKING, type ExerciseId, type CameraView } from '../config';
import type { Assessment, DebugData, Point, Pose } from './types';
import { SquatEvaluator } from './squat';
import { SquatVisuals } from './squatVisual';
import { ViewCoach } from './viewCoach';
import { referenceVisual } from './referenceVisual';

export const distance = (a: Point, b: Point) => Math.hypot(a.x - b.x, a.y - b.y);
export function angle(a: Point, b: Point, c: Point) {
  const denominator = distance(a, b) * distance(c, b);
  if (denominator < 0.00001) return 180;
  const cosine = ((a.x - b.x) * (c.x - b.x) + (a.y - b.y) * (c.y - b.y)) / denominator;
  return Math.acos(Math.max(-1, Math.min(1, cosine))) * 180 / Math.PI;
}
const emptyDebug = (reason: string): DebugData => ({ landmarks: [], angles: {}, components: [], reason, validMovement: false, rawScore: null, stableFrames: 0 });
export const emptyAssessment = (reason = 'Looking for movement'): Assessment => ({
  ready: false, confidence: 0, reason, score: null, reps: 0, phase: 'Ready',
  correction: null, confirmed: false, framingWarning: false, debug: emptyDebug(reason),
});
const NAMES: Record<number, string> = { 0: 'Head', 7: 'Left ear', 8: 'Right ear', 29: 'Left heel', 30: 'Right heel', 31: 'Left foot', 32: 'Right foot', 11: 'Left shoulder', 12: 'Right shoulder', 13: 'Left elbow', 14: 'Right elbow', 15: 'Left wrist', 16: 'Right wrist', 23: 'Left hip', 24: 'Right hip', 25: 'Left knee', 26: 'Right knee', 27: 'Left ankle', 28: 'Right ankle' };
const inFrame = (p: Point | undefined, tolerance: number = TRACKING.frameTolerance) => !!p && Number.isFinite(p.x) && Number.isFinite(p.y) && p.x >= -tolerance && p.x <= 1 + tolerance && p.y >= -tolerance && p.y <= 1 + tolerance;
const visible = (p: Point | undefined, cfg: { visibility: number; frameTolerance: number } = TRACKING) => inFrame(p, cfg.frameTolerance) && p!.visibility >= cfg.visibility;

export function choosePose(poses: Pose[], id: ExerciseId = 'squat') {
  const BODY = id === 'curl' ? [11,12,13,14,15,16,23,24] : [11,12,23,24,25,26,27,28];
  const ranked = poses.map((pose, index) => ({ pose, index })).filter(({ pose }) => BODY.every(i => pose[i])).map(({ pose: p, index }) => {
    const body = BODY.map(i => p[i]);
    const height = Math.max(...body.map(v => v.y)) - Math.min(...body.map(v => v.y));
    const center = (p[23].x + p[24].x) / 2;
    return { pose: p, index, weight: height * Math.max(0, 1 - Math.abs(center - 0.5)) * body.reduce((a, v) => a + v.visibility, 0) / body.length };
  }).sort((a, b) => b.weight - a.weight);
  return { pose: ranked[0]?.pose, index: ranked[0]?.index, ambiguous: ranked.length > 1 && ranked[1].weight > ranked[0].weight * TRACKING.ambiguityRatio };
}

/** Require relevant landmarks; a side profile may naturally hide the far chain. */
export function framing(p: Pose, id: ExerciseId, view: CameraView = 'side') {
  const cfg = id === 'squat' ? EXERCISES.squat : TRACKING;
  const chain = id === 'curl' ? [11,13,15,23] : id === 'plank' ? [11,13,15,23,25,27,31] : [11,23,25,27];
  const sides = [chain, chain.map(i => i+1)];
  const quality = (indices: number[]) => Math.min(...indices.map(i => visible(p[i], cfg) ? p[i].visibility : 0));
  const side = quality(sides[1]) > quality(sides[0]) ? 1 : 0;
  const head = [0,7,8].find(i => visible(p[i],cfg)) ?? 0;
  const required = [...(view === 'front' ? [...sides[0],...sides[1]] : sides[side]), ...(id === 'plank' ? [] : [head])];
  const confidence = required.reduce((sum, i) => sum + (p[i]?.visibility ?? 0), 0) / required.length;
  const missing = required.filter(i => !visible(p[i], cfg));
  const outside = missing.some(i => p[i] && p[i].visibility >= cfg.visibility && !inFrame(p[i], cfg.frameTolerance));
  const landmarks = Object.entries(NAMES).map(([key, name]) => {
    const index = Number(key);
    return { index, name, visibility: p[index]?.visibility ?? 0, inFrame: inFrame(p[index], cfg.frameTolerance), required: required.includes(index) };
  });
  return { ok: !missing.length, confidence, side, outside, landmarks, missing };
}

/** Stateful, memory-only analysis. No timers or synthetic data generate scores here. */
export class CoachEngine {
  private squat = new SquatEvaluator();
  private squatVisuals = new SquatVisuals();
  private smooth: Pose = [];
  private framedAt: number | null = null;
  private lostAt: number | null = null;
  private acquired = false;
  private reps = 0;
  private completed = 0;
  private lastRepScore:number|null=null;
  private lastSquatCycle:DebugData['squatCycle'];
  private briefLossAt:number|null=null;
  private lastReliableAt:number|null=null;
  private lastReliablePose:Pose=[];
  private side: number | null = null;
  private worldSmooth: Pose = [];
  private views: ViewCoach;
  constructor(private id: ExerciseId, private view: CameraView = 'side') { this.views = new ViewCoach(id,view); }
  private resetEvaluation() { this.views.reset(); this.worldSmooth=[]; }

  interrupt(reason = 'Assessment paused'): Assessment {
    this.briefLossAt=null;this.lastReliableAt=null;this.lastReliablePose=[];
    this.squatVisuals.reset();
    this.resetEvaluation(); this.framedAt = null; this.lostAt = null;
    this.acquired = false; this.smooth = []; this.side = null;
    const result = { ...emptyAssessment(reason), reps: this.reps };
    if (this.id === 'squat' && this.view === 'side') { const squat = this.squat.invalidate(reason); result.reps = squat.reps; result.debug.squat = squat.debug;result.debug.squatCycle=squat.debug.cycle; }
    if(this.id==='squat'&&this.view==='front')result.debug.squatCycle=this.views.squatCycle();
    if(this.id==='curl')result.debug.curlCycle=this.views.curlCycle();
    result.debug.completedCycles=this.completed;result.debug.lastRepScore=this.lastRepScore;
    return result;
  }

  update(raw: Pose | undefined, now: number, aspect = 1, ambiguous = false, world?: Pose): { pose: Pose; assessment: Assessment } {
    const frame=framing(raw??[],this.id,this.view);
    const chain=this.id==='curl'?[11,13,15,23]:[11,23,25,27];
    const required=this.view==='side'?chain.map(i=>i+(this.side??frame.side)):chain.flatMap(i=>[i,i+1]);
    const reliable=!!raw && frame.ok && required.every(i=>visible(raw[i]));
    let output:{pose:Pose;assessment:Assessment}|undefined;
    if(this.id!=='plank' && !ambiguous && this.acquired && !reliable && this.lastReliableAt!==null) {
      if(this.briefLossAt===null){this.briefLossAt=now;this.views.pauseEvidence();this.squat.pauseEvidence();}
      if(now-this.briefLossAt<TRACKING.repGraceMs && now-this.lastReliableAt<=EXERCISES.squat.maxFrameGapMs) {
        const assessment={...emptyAssessment('Tracking briefly uncertain'),reps:this.reps};
        assessment.debug.landmarks=frame.landmarks;assessment.debug.reason='Rep paused: waiting for reliable landmarks';
        assessment.debug.trackingGapMs=now-this.briefLossAt;
        assessment.debug.squatCycle=this.lastSquatCycle;
        output={pose:[],assessment};
      }
    }
    if(!output && this.briefLossAt!==null) {
      const old=this.lastReliablePose;
      const scale=old[11]&&old[23]?Math.hypot((old[11].x-old[23].x)*aspect,old[11].y-old[23].y):0;
      const continuous=reliable && !ambiguous && now-this.briefLossAt<TRACKING.repGraceMs && this.lastReliableAt!==null && now-this.lastReliableAt<=EXERCISES.squat.maxFrameGapMs && scale>0 && required.every(i=>old[i] && Math.hypot((raw![i].x-old[i].x)*aspect,raw![i].y-old[i].y)/scale<=TRACKING.repResumeTravel);
      if(!continuous)this.interrupt('Tracking/view confidence lost');
      this.briefLossAt=null;
    }
    output??=this.analyze(raw, now, aspect, ambiguous, world);
    if(reliable && !ambiguous){this.lastReliableAt=now;this.lastReliablePose=raw!;}
    if (this.id === 'squat' && this.view === 'side') {
      output.assessment.squatVisual = ambiguous ? { reference: [], recovery: [], recoveryPose: [], framing: true } : this.squatVisuals.update(output.pose, output.assessment, aspect, now);

    }
    else output.assessment.squatVisual = referenceVisual(output.pose, this.id, this.view, output.assessment, aspect);
    output.assessment.debug.exercise=this.id; output.assessment.debug.view=this.view;
    if(this.id==='squat' && this.view==='side') {
      output.assessment.debug.state=output.assessment.debug.squat?.state;output.assessment.debug.squatCycle??=output.assessment.debug.squat?.cycle;
      output.assessment.debug.viewValid=output.assessment.debug.squat?.sideOn ?? false;
      output.assessment.debug.coachingEnabled=output.assessment.debug.squat?.coachingEnabled ?? false;
      output.assessment.debug.scoringEnabled=output.assessment.score!==null;
      output.assessment.debug.scoreUpdatedAt=output.assessment.debug.squat?.scoreUpdatedAt ?? null;
    }
    if(this.id==='squat'&&this.view==='front')output.assessment.debug.squatCycle??=this.views.squatCycle();
    if(this.id==='curl')output.assessment.debug.curlCycle??=this.views.curlCycle();
    this.reps=output.assessment.reps;
    this.lastSquatCycle=output.assessment.debug.squatCycle;
    this.completed=Math.max(this.completed,output.assessment.debug.completedCycles??0);
    if(output.assessment.debug.lastRepScore!==undefined)this.lastRepScore=output.assessment.debug.lastRepScore;
    output.assessment.debug.completedCycles=this.completed;output.assessment.debug.lastRepScore=this.lastRepScore;
    return output;
  }

  private analyze(raw: Pose | undefined, now: number, aspect: number, ambiguous: boolean, world?: Pose): { pose: Pose; assessment: Assessment } {
    const tracking = this.id === 'squat' ? EXERCISES.squat : TRACKING;
    const smoothing = this.id === 'squat' ? EXERCISES.squat.landmarkSmoothing : TRACKING.smoothing;
    const frame = framing(raw ?? [], this.id, this.view);
    if (!raw || ambiguous || !frame.ok) {
      this.lostAt ??= now;
      const sustained = now - this.lostAt >= tracking.framingLossMs;
      if (sustained) { this.acquired = false; this.side = null; }
      this.framedAt = null; this.smooth = []; this.resetEvaluation();
      // Confidence loss suppresses scores immediately. Reframing is only shown for sustained cropping.
      const warning = sustained && frame.outside && !ambiguous;
      const reason = ambiguous ? 'Multiple prominent poses' : !raw ? 'No reliable pose detected' : frame.missing.map(i => NAMES[i]).join(', ') + (frame.outside ? ': outside frame' : ': low confidence');
      const squat = this.id === 'squat' && this.view === 'side' ? (ambiguous ? this.squat.invalidate(reason) : this.squat.suspend(reason, now)) : undefined;
      return { pose: raw ?? [], assessment: { ...emptyAssessment('Tracking uncertain'), reps: squat?.reps ?? this.reps, confidence: frame.confidence, framingWarning: warning, debug: { ...emptyDebug(reason), landmarks: frame.landmarks, squat: squat?.debug } } };
    }
    this.lostAt = null;
    this.framedAt ??= now;
    if (!this.acquired && now - this.framedAt >= tracking.framingHoldMs) this.acquired = true;
    this.smooth = raw.map((p, i) => {
      const old = this.smooth[i];
      return old ? { ...p, x: old.x + (p.x - old.x) * smoothing, y: old.y + (p.y - old.y) * smoothing } : { ...p };
    });
    const base = { ...emptyAssessment('Checking frame'), confidence: frame.confidence, reps: this.reps, debug: { ...emptyDebug('Acquiring required landmarks for 500 ms'), landmarks: frame.landmarks } };
    if (!this.acquired) {
      if (this.id === 'squat' && this.view === 'side') { const squat = this.squat.invalidate(base.debug.reason); base.debug.squat = squat.debug; base.reps = squat.reps; }
      return { pose: this.smooth, assessment: base };
    }

    if (this.id === 'squat' && this.view === 'side' && this.side !== null && ![11, 23, 25, 27].every(i => visible(raw[i + this.side!], tracking))) {
      const result = this.squat.suspend('Camera-facing landmarks briefly occluded', now);
      if (result.debug.state === 'FRAME_INVALID') this.side = null;
      return { pose: this.smooth, assessment: { ...base, reps: result.reps, reason: result.debug.reason,
        debug: { ...base.debug, squat: result.debug, reason: result.debug.reason } } };
    }
    const sideChain=this.id==='curl'?[11,13,15,23]:this.id==='plank'?[11,13,15,23,25,27,31]:[11,23,25,27];
    if (this.side !== null && !sideChain.every(i => visible(raw[i + this.side!], tracking))) {
      this.side = null;
      if(this.id!=='squat'||this.view!=='side') this.resetEvaluation();
    }
    this.side ??= frame.side;
    if (this.id === 'squat' && this.view === 'side') {
      const result = this.squat.update(raw, now, aspect, this.side, world);
      // Anchor squat guidance to the same smoothed skeleton that is rendered.
      result.corrections = result.corrections.map(cue => {
      if (cue?.id === 'depth' || cue?.id === 'heel-lift') {
        return { ...cue, target: { ...cue.target, x: this.smooth[cue.joint].x,
          y: this.smooth[cue.joint].y + cue.target.y - raw[cue.joint].y } };
      } else if (cue?.kind === 'rotation') {
        const dx = (cue.target.x - raw[cue.anchor].x) * aspect, dy = cue.target.y - raw[cue.anchor].y;
        const direction = Math.hypot(dx, dy);
        const segment = Math.hypot((this.smooth[cue.joint].x - this.smooth[cue.anchor].x) * aspect, this.smooth[cue.joint].y - this.smooth[cue.anchor].y);
        if (direction > 0) return { ...cue, target: { ...cue.target,
          x: this.smooth[cue.anchor].x + dx / direction * segment / aspect, y: this.smooth[cue.anchor].y + dy / direction * segment } };
      }
        return cue;
      });
      result.correction = result.corrections[0] ?? null;
      const state = result.debug.state;
      return { pose: this.smooth, assessment: {
        ...base, ready: result.debug.trackingReliable && state !== 'FRAME_INVALID', reason: result.debug.reason,
        scoreStatus:result.score!==null?'live':result.debug.trackingReliable && result.debug.sideOn && result.debug.kneeAngle!==null && result.debug.kneeAngle>=EXERCISES.squat.startKneeMin?'ready':'uncertain',
        reps: result.reps, score: result.score, correction: result.correction, confirmed: result.confirmed,
        corrections: result.corrections,
        phase: state === 'HOLDING' ? 'Hold' : state === 'DESCENDING' ? 'Lower' : state === 'ASCENDING' ? 'Rise' : 'Ready',
        debug: { ...base.debug, completedCycles:result.debug.completedCycles,lastRepScore:result.debug.lastRepScore,squat: result.debug, reason: result.debug.reason, validMovement: result.evaluating,
          rawScore: result.rawScore, stableFrames: result.stableFrames, components: result.components,
          angles: { knee: result.debug.kneeAngle ?? 0, hip: result.debug.hipAngle ?? 0, torsoLean: result.debug.torsoTilt ?? 0 } },
      } };
    }
    this.worldSmooth = world ? world.map((p,i)=> {
      const old=this.worldSmooth[i];
      return old ? {...p,x:old.x+(p.x-old.x)*smoothing,y:old.y+(p.y-old.y)*smoothing,z:(old.z??0)+((p.z??0)-(old.z??0))*smoothing}: {...p};
    }) : [];
    const assessment=this.views.update(this.smooth,now,aspect,this.side,base,world?this.worldSmooth:undefined);
    const rp=raw.map(p=>({...p,x:p.x*aspect}));
    assessment.debug.rawAngles={leftElbow:angle(rp[11],rp[13],rp[15]),rightElbow:angle(rp[12],rp[14],rp[16]),leftKnee:angle(rp[23],rp[25],rp[27]),rightKnee:angle(rp[24],rp[26],rp[28])};
    this.reps=assessment.reps;
    return {pose:this.smooth,assessment};
  }
}
