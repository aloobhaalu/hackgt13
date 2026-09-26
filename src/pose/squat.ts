import { EXERCISES, TRACKING } from '../config';
import type { Correction, Point, Pose, ScoreComponent, SquatDebug, SquatState } from './types';

const C = EXERCISES.squat;
const length = (a: Point, b: Point) => Math.hypot(a.x - b.x, a.y - b.y, (a.z ?? 0) - (b.z ?? 0));
function jointAngle(a: Point, b: Point, c: Point) {
  const denominator = length(a, b) * length(c, b);
  if (denominator < 1e-8) return NaN;
  const dot = (a.x - b.x) * (c.x - b.x) + (a.y - b.y) * (c.y - b.y) + ((a.z ?? 0) - (b.z ?? 0)) * ((c.z ?? 0) - (b.z ?? 0));
  return Math.acos(Math.max(-1, Math.min(1, dot / denominator))) * 180 / Math.PI;
}
const reliable = (p: Point | undefined) => !!p && p.visibility >= TRACKING.visibility && Number.isFinite(p.x) && Number.isFinite(p.y);
const finiteWorld = (p: Point | undefined) => reliable(p) && Number.isFinite(p!.z);
const clamp = (n: number) => Math.max(0, Math.min(1, n));
const active = (s: SquatState) => s === 'DESCENDING' || s === 'BOTTOM' || s === 'ASCENDING';

type Features = {
  knee: number; hip: number; tilt: number; hipHeight: number; leg: number;
  hipVelocity: number; kneeVelocity: number; asymmetry: number | null;
  shinHeight: number; shoulderRatio: number; hipRatio: number;
  leftKnee: number | null; rightKnee: number | null; supportTravel: number;
};
type Baseline = { height: number; knee: number; hip: number; leg: number; imageLeg: number; ankle: Point; hipX: number; feet: Record<number, Point> };
export type SquatResult = {
  debug: SquatDebug; score: number | null; rawScore: number | null;
  components: ScoreComponent[]; stableFrames: number; correction: Correction | null;
  confirmed: boolean; reps: number; evaluating: boolean;
};

/** A conservative sequence classifier. A knee angle alone can never activate scoring. */
export class SquatEvaluator {
  private state: SquatState = 'FRAME_INVALID';
  private reason = 'Full-body tracking unavailable';
  private source: 'world' | 'normalized' | null = null;
  private side: number | null = null;
  private features: Features | null = null;
  private previousAt: number | null = null;
  private baseline: Baseline | null = null;
  private baselineSince: number | null = null;
  private baselineHeight = 0;
  private directionSince: number | null = null;
  private contradictionSince: number | null = null;
  private mismatchSince: number | null = null;
  private finishSince: number | null = null;
  private bottomSince: number | null = null;
  private startedAt = 0;
  private stateSince = 0;
  private lastMovingAt = 0;
  private peakDrop = 0;
  private minKnee = 180;
  private reps = 0;
  private score: number | null = null;
  private totalScore = 0;
  private scoredFrames = 0;
  private acceptedFrames = 0;
  private finalScore: number | null = null;
  private errorsSince = new Map<string, number>();
  private current: Correction | null = null;
  private confirmedUntil = 0;
  private samples: Features[] = [];
  private missingSince: number | null = null;
  private geometrySince: number | null = null;
  private geometryReason = '';
  private footPoints = 0;
  private rotateSideways = false;

  private clearSequence() {
    this.baseline = null; this.baselineSince = null; this.directionSince = null;
    this.contradictionSince = null; this.mismatchSince = null; this.finishSince = null; this.bottomSince = null;
    this.peakDrop = 0; this.minKnee = 180; this.score = null;
    this.totalScore = 0; this.scoredFrames = 0; this.acceptedFrames = 0;
    this.finalScore = null; this.errorsSince.clear(); this.current = null; this.confirmedUntil = 0;
  }

  invalidate(reason: string): SquatResult {
    this.clearSequence(); this.features = null; this.previousAt = null;
    this.source = null; this.side = null; this.state = 'FRAME_INVALID'; this.reason = reason;
    this.samples = []; this.missingSince = null; this.geometrySince = null; this.footPoints = 0; this.rotateSideways = false;
    return this.result();
  }

  /** Never score missing data. Preserve phase memory only for a very short dropout. */
  suspend(reason: string, now: number): SquatResult {
    this.missingSince ??= now;
    if (now - this.missingSince >= C.trackingGraceMs) return this.invalidate(reason);
    this.current = null; this.errorsSince.clear(); this.acceptedFrames = 0;
    const result = this.result();
    result.score = null; result.rawScore = null; result.correction = null; result.evaluating = false; result.confirmed = false;
    result.debug.trackingReliable = false; result.debug.reason = reason;
    return result;
  }

  private uncertainGeometry(reason: string, now: number): SquatResult {
    if (this.geometryReason !== reason) { this.geometryReason = reason; this.geometrySince = now; }
    this.geometrySince ??= now;
    if (now - this.geometrySince >= C.geometryRejectMs) this.reject(reason, now);
    this.current = null; this.errorsSince.clear(); this.acceptedFrames = 0;
    const result = this.result();
    result.score = null; result.rawScore = null; result.correction = null; result.evaluating = false; result.confirmed = false;
    result.debug.trackingReliable = false; result.debug.reason = reason;
    return result;
  }

  private reject(reason: string, now: number) {
    this.clearSequence(); this.state = 'NOT_SQUAT_MOVEMENT'; this.stateSince = now; this.reason = reason;
  }

  private result(components: ScoreComponent[] = [], rawScore: number | null = null, drop: number | null = null): SquatResult {
    const f = this.features;
    return {
      debug: {
        state: this.state, source: this.source, kneeAngle: f?.knee ?? null, hipAngle: f?.hip ?? null,
        torsoTilt: f?.tilt ?? null, hipDrop: drop ?? (f && this.baseline ? (this.baseline.height - f.hipHeight) / this.baseline.leg : null), hipVelocity: f?.hipVelocity ?? null,
        kneeVelocity: f?.kneeVelocity ?? null, baselineDetected: !!this.baseline,
        sideOn: !!f && f.shoulderRatio <= C.sideShoulderRatioMax && f.hipRatio <= C.sideHipRatioMax,
        leftKneeAngle: f?.leftKnee ?? null, rightKneeAngle: f?.rightKnee ?? null,
        shoulderRatio: f?.shoulderRatio ?? null, hipRatio: f?.hipRatio ?? null,
        trackingReliable: this.state !== 'FRAME_INVALID', rotateSideways: this.rotateSideways, footPoints: this.footPoints,
        reason: this.reason,
      },
      score: this.state === 'VALID_REP' ? this.finalScore : active(this.state) ? this.score : null,
      rawScore, components, stableFrames: this.acceptedFrames,
      correction: active(this.state) ? this.current : null, confirmed: this.state === 'VALID_REP',
      reps: this.reps, evaluating: active(this.state) || this.state === 'VALID_REP',
    };
  }

  update(image: Pose, now: number, aspect: number, side: number, world?: Pose): SquatResult {
    const indices = [11 + side, 23 + side, 25 + side, 27 + side];
    if (!indices.every(i => reliable(image[i]))) return this.suspend('Required squat landmarks have low confidence', now);
    const [shoulder, hip, knee, ankle] = indices;
    const img = image.map(p => ({ ...p, x: p.x * aspect, z: 0 }));
    const usableWorld = !!world && indices.every(i => finiteWorld(world[i])) && length(world[hip], world[knee]) > 1e-5 && length(world[knee], world[ankle]) > 1e-5;
    if (this.source === 'world' && !usableWorld) {
      const held = this.suspend('World landmarks briefly unreliable', now);
      if (held.debug.state !== 'FRAME_INVALID') return held;
    }
    if (this.missingSince !== null && now - this.missingSince >= C.trackingGraceMs) this.invalidate('Sustained tracking loss; reacquire upright baseline');
    this.missingSince = null;
    const source = usableWorld ? 'world' : 'normalized';
    const geometry = usableWorld ? world! : img;
    if ((this.source && this.source !== source) || (this.side !== null && this.side !== side)) this.invalidate('Geometry source or camera-facing side changed; reacquire upright baseline');
    if (this.previousAt !== null && (now <= this.previousAt || now - this.previousAt > C.maxFrameGapMs)) this.invalidate('Tracking gap; reacquire upright baseline');
    this.source = source; this.side = side;

    const leg = length(geometry[hip], geometry[knee]) + length(geometry[knee], geometry[ankle]);
    const imageLeg = length(img[hip], img[knee]) + length(img[knee], img[ankle]);
    const torso = length(img[shoulder], img[hip]);
    if (leg < 1e-5 || imageLeg < 1e-5 || torso < 1e-5) return this.invalidate('Degenerate limb geometry');
    const opposite = 1 - side;
    const otherReliable = [11, 23, 25, 27].every(i => reliable(image[i + opposite]) && (!usableWorld || finiteWorld(world?.[i + opposite])));
    const kneeAngle = jointAngle(geometry[hip], geometry[knee], geometry[ankle]);
    const otherKnee = otherReliable ? jointAngle(geometry[23 + opposite], geometry[25 + opposite], geometry[27 + opposite]) : null;
    // Heels/toes are optional support evidence; their occlusion never fails framing.
    const footIndices = [27, 28, 29, 30, 31, 32].filter(i => reliable(image[i]) && image[i].visibility >= C.footVisibility);
    this.footPoints = footIndices.length;
    const supportTravel = this.baseline ? Math.max(0, ...footIndices.filter(i => this.baseline!.feet[i]).map(i => length(img[i], this.baseline!.feet[i]) / this.baseline!.imageLeg)) : 0;
    // World landmarks are pelvis-centered, so absolute hip.y cannot measure a squat.
    // Hip height is measured above the ankle, then compared with the user's standing baseline.
    const current: Features = {
      knee: kneeAngle, hip: jointAngle(geometry[shoulder], geometry[hip], geometry[knee]),
      tilt: Math.atan2(Math.hypot(geometry[shoulder].x - geometry[hip].x, (geometry[shoulder].z ?? 0) - (geometry[hip].z ?? 0)), geometry[hip].y - geometry[shoulder].y) * 180 / Math.PI,
      hipHeight: geometry[ankle].y - geometry[hip].y, leg,
      hipVelocity: 0, kneeVelocity: 0, asymmetry: otherKnee === null ? null : Math.abs(kneeAngle - otherKnee),
      shinHeight: (geometry[ankle].y - geometry[knee].y) / leg,
      shoulderRatio: reliable(image[11]) && reliable(image[12]) ? Math.abs(img[11].x - img[12].x) / torso : 0,
      hipRatio: reliable(image[23]) && reliable(image[24]) ? Math.abs(img[23].x - img[24].x) / torso : 0,
      leftKnee: side === 0 ? kneeAngle : otherKnee, rightKnee: side === 1 ? kneeAngle : otherKnee,
      supportTravel,
    };
    if (![current.knee, current.hip, current.tilt, current.hipHeight].every(Number.isFinite)) return this.invalidate('Joint geometry is not finite');
    this.samples.push({ ...current });
    if (this.samples.length > C.featureWindow) this.samples.shift();
    // Median first, then EMA: a single extreme sample cannot flip a valid phase.
    if (this.samples.length === C.featureWindow) {
      for (const key of ['knee', 'hip', 'tilt', 'hipHeight', 'leg', 'shinHeight', 'shoulderRatio', 'hipRatio', 'supportTravel', 'asymmetry', 'leftKnee', 'rightKnee'] as const) {
        if (current[key] === null) continue;
        const values = this.samples.map(sample => sample[key]).filter((value): value is number => value !== null).sort((a, b) => a - b);
        if (values.length === C.featureWindow) current[key] = values[Math.floor(values.length / 2)];
      }
    }
    const old = this.features, dt = this.previousAt === null ? 0 : (now - this.previousAt) / 1000;
    if (old && dt > 0) {
      for (const key of ['knee', 'hip', 'tilt', 'hipHeight', 'leg'] as const) current[key] = old[key] + (current[key] - old[key]) * C.featureSmoothing;
      const scale = this.baseline?.leg ?? current.leg;
      current.hipVelocity = old.hipVelocity + ((old.hipHeight - current.hipHeight) / scale / dt - old.hipVelocity) * C.velocitySmoothing;
      current.kneeVelocity = old.kneeVelocity + ((current.knee - old.knee) / dt - old.kneeVelocity) * C.velocitySmoothing;
    }
    this.features = current; this.previousAt = now;
    const f = current;
    const sideOn = f.shoulderRatio <= C.sideShoulderRatioMax && f.hipRatio <= C.sideHipRatioMax;
    this.rotateSideways = !sideOn;
    if (!sideOn) return this.uncertainGeometry('Rotate sideways for squat assessment', now);
    if (f.hipHeight / f.leg < C.minHipHeight || f.shinHeight < C.minShinHeight || f.hip < C.minHipAngle) {
      return this.uncertainGeometry('Seated, floor-level, or kneeling geometry; no plausible standing squat', now);
    }
    if (f.tilt > C.maxPlausibleTilt || (f.asymmetry !== null && f.asymmetry > C.maxAsymmetry)) {
      return this.uncertainGeometry('Torso or left/right leg geometry is inconsistent with a squat', now);
    }
    if (Math.abs(f.hipVelocity) > C.maxHipSpeed || Math.abs(f.kneeVelocity) > C.maxKneeSpeed) {
      return this.uncertainGeometry('Movement is too abrupt to classify confidently', now);
    }
    const upright = f.knee >= C.startKneeMin && f.hip >= C.startHipMin && f.tilt <= C.startTorsoMax;
    const stableStart = upright && Math.abs(f.hipVelocity) <= C.baselineHipSpeed && Math.abs(f.kneeVelocity) <= C.baselineKneeSpeed;

    if (this.state === 'VALID_REP') {
      if (now - this.stateSince < C.resultHoldMs && stableStart) return this.result();
      // A completed rep already establishes an upright return. Keep its calibration
      // so consecutive reps do not require another stationary baseline hold.
      const baseline = this.baseline;
      this.clearSequence(); this.baseline = baseline; this.state = 'WAITING_FOR_START_POSE';
    }
    if (!this.baseline) {
      this.geometrySince = null; this.geometryReason = '';
      if (stableStart) {
        if (this.baselineSince === null || Math.abs(f.hipHeight - this.baselineHeight) / f.leg > C.baselineHipRange) {
          this.baselineSince = now; this.baselineHeight = f.hipHeight;
        }
        this.state = 'WAITING_FOR_START_POSE'; this.reason = 'Hold a stable upright start pose';
        if (now - this.baselineSince >= C.baselineHoldMs) {
          this.baseline = { height: f.hipHeight, knee: f.knee, hip: f.hip, leg: f.leg, imageLeg, ankle: { ...img[ankle] }, hipX: img[hip].x - img[ankle].x, feet: Object.fromEntries(footIndices.map(i => [i, { ...img[i] }])) };
          this.reason = 'Upright baseline acquired; waiting for coordinated hip drop and knee bend';
        }
      } else {
        this.baselineSince = null;
        this.state = upright ? 'WAITING_FOR_START_POSE' : 'NOT_SQUAT_MOVEMENT';
        this.reason = upright ? 'Waiting for a stable torso and extended knees' : 'No upright baseline; bent-knee or unrelated poses are not scored';
      }
      return this.result();
    }

    const b = this.baseline;
    const drop = (b.height - f.hipHeight) / b.leg;
    const bend = b.knee - f.knee;
    const footTravel = f.supportTravel;
    const hipTravel = Math.abs(img[hip].x - img[ankle].x - b.hipX) / b.imageLeg;
    if (footTravel > C.maxFootTravel || hipTravel > C.maxHipTravel || Math.abs(f.leg / b.leg - 1) > C.maxLegScaleChange) {
      return this.uncertainGeometry('Foot travel, lateral motion, or changing body scale makes the squat uncertain', now);
    }
    this.geometrySince = null; this.geometryReason = '';
    const descending = f.hipVelocity > C.directionHipSpeed && f.kneeVelocity < -C.directionKneeSpeed;
    const ascending = f.hipVelocity < -C.directionHipSpeed && f.kneeVelocity > C.directionKneeSpeed;
    const contradictory = (f.hipVelocity > C.directionHipSpeed && f.kneeVelocity > C.directionKneeSpeed) || (f.hipVelocity < -C.directionHipSpeed && f.kneeVelocity < -C.directionKneeSpeed);
    if (contradictory) this.contradictionSince ??= now; else this.contradictionSince = null;
    if (this.contradictionSince !== null && now - this.contradictionSince >= C.contradictionHoldMs) {
      this.reject('Hip motion and knee progression disagree', now); return this.result();
    }

    if (this.state === 'WAITING_FOR_START_POSE') {
      const coherentStart = drop >= C.minHipDrop && bend >= C.minKneeBend && b.hip - f.hip >= C.minHipBend && descending;
      if (coherentStart) this.directionSince ??= now; else this.directionSince = null;
      if (this.directionSince !== null && now - this.directionSince >= C.directionHoldMs) {
        this.state = 'DESCENDING'; this.stateSince = now; this.startedAt = this.directionSince;
        this.lastMovingAt = now; this.peakDrop = drop; this.minKnee = f.knee; this.directionSince = null;
      } else {
        // Slow shallow squats can accumulate knee flexion before the minimum drop.
        // Reject mismatched motion only when the corresponding velocity is absent too.
        if ((bend >= C.minKneeBend && drop < C.minHipDrop && f.hipVelocity <= C.directionHipSpeed) || (drop >= C.minHipDrop && bend < C.minKneeBend && f.kneeVelocity >= -C.directionKneeSpeed)) {
          this.mismatchSince ??= now;
          if (now - this.mismatchSince >= C.contradictionHoldMs) { this.reject('Knee bend without matching hip descent, or hip descent without knee bend', now); return this.result(); }
        } else this.mismatchSince = null;
        this.reason = 'Waiting for correlated hip descent, knee bend, and hip flexion';
        return this.result([], null, drop);
      }
    }

    this.peakDrop = Math.max(this.peakDrop, drop); this.minKnee = Math.min(this.minKnee, f.knee);
    if (descending || ascending) this.lastMovingAt = now;
    if (now - this.lastMovingAt > C.maxStillMs || now - this.startedAt > C.maxSequenceMs) {
      this.reject('Movement stalled or timed out; acquire a new upright baseline', now); return this.result();
    }
    if (this.state === 'DESCENDING') {
      const recognizableBottom = drop >= C.bottomDropMin && f.knee <= C.bottomKneeMax && f.hip <= C.bottomHipMax;
      if (recognizableBottom && f.hipVelocity <= C.bottomHipSpeed && now - this.startedAt >= C.minDescentMs) this.bottomSince ??= now;
      else this.bottomSince = null;
      if (this.bottomSince !== null && now - this.bottomSince >= C.bottomHoldMs) {
        this.state = 'BOTTOM'; this.stateSince = now;
      } else if (ascending && this.peakDrop - drop > C.ascentDrop) {
        this.reject('Reversed before a recognizable squat bottom', now); return this.result();
      }
    }
    if (this.state === 'BOTTOM') {
      if (ascending && this.peakDrop - drop >= C.ascentDrop && f.knee - this.minKnee >= C.ascentKneeExtension) this.directionSince ??= now;
      else this.directionSince = null;
      if (this.directionSince !== null && now - this.directionSince >= C.directionHoldMs) {
        this.state = 'ASCENDING'; this.stateSince = now; this.directionSince = null;
      }
    }
    if (this.state === 'ASCENDING') {
      if (upright && drop <= C.finishHipDrop) this.finishSince ??= now; else this.finishSince = null;
      if (this.finishSince !== null && now - this.finishSince >= C.finishHoldMs && now - this.startedAt >= C.minSequenceMs) {
        this.state = 'VALID_REP'; this.stateSince = now; this.reps++;
        const average = this.scoredFrames ? this.totalScore / this.scoredFrames : 0;
        this.finalScore = Math.min(this.acceptedFrames >= TRACKING.perfectFrames ? 100 : 99, Math.round(average));
        this.current = null; this.reason = 'Completed upright → descent → bottom → ascent → upright sequence';
        return this.result([], average, drop);
      }
      if (descending && this.peakDrop - drop < C.ascentDrop) {
        this.reject('Returned downward without completing the ascent', now); return this.result();
      }
    }
    this.reason = `Recognized ${this.state.toLowerCase()} phase; score from phase-specific geometry`;
    const result = this.evaluate(img, f, b, drop, footTravel, now);
    if (result.correction) result.correction = { ...result.correction, target: { ...result.correction.target, x: result.correction.target.x / aspect } };
    return result;
  }

  private evaluate(img: Pose, f: Features, b: Baseline, drop: number, footTravel: number, now: number): SquatResult {
    const depthRelevant = this.state !== 'DESCENDING';
    const depthError = depthRelevant ? Math.max(0, (this.minKnee - C.depthAngle) / C.depthPenaltyRange, (C.targetHipDrop - this.peakDrop) / C.dropPenaltyRange) : 0;
    const torsoError = Math.max(0, (f.tilt - C.maxLean) / C.torsoPenaltyRange);
    const stabilityError = Math.max(0, (footTravel - C.acceptedFootTravel) / (C.maxFootTravel - C.acceptedFootTravel), f.asymmetry === null ? 0 : (f.asymmetry - C.acceptedAsymmetry) / (C.maxAsymmetry - C.acceptedAsymmetry));
    const progressionError = Math.max(0, (Math.abs(f.hipVelocity) - C.smoothHipSpeed) / (C.maxHipSpeed - C.smoothHipSpeed), (Math.abs(f.kneeVelocity) - C.smoothKneeSpeed) / (C.maxKneeSpeed - C.smoothKneeSpeed));
    const components: ScoreComponent[] = [
      { id: 'depth', value: depthRelevant ? this.minKnee : f.knee, limit: depthRelevant ? C.depthAngle : b.knee - C.minKneeBend, error: depthError, score: 100 * (1 - clamp(depthError)) },
      { id: 'torso', value: f.tilt, limit: C.maxLean, error: torsoError, score: 100 * (1 - clamp(torsoError)) },
      { id: 'stability', value: footTravel, limit: C.acceptedFootTravel, error: stabilityError, score: 100 * (1 - clamp(stabilityError)) },
      { id: 'progression', value: Math.abs(f.hipVelocity), limit: C.smoothHipSpeed, error: progressionError, score: 100 * (1 - clamp(progressionError)) },
    ];
    const weights = this.state === 'DESCENDING' ? C.weights.descending : this.state === 'BOTTOM' ? C.weights.bottom : C.weights.ascending;
    const rawScore = components.reduce((sum, c) => sum + c.score! * weights[c.id as keyof typeof weights], 0);
    this.score = this.score === null ? rawScore : this.score + (rawScore - this.score) * TRACKING.scoreSmoothing;
    this.totalScore += rawScore; this.scoredFrames++;
    this.acceptedFrames = components.every(c => c.error === 0) ? this.acceptedFrames + 1 : 0;
    // A full sequence has not yet been observed: never label a partial descent 99–100%.
    const liveScore = Math.min(C.liveScoreCap, Math.round(this.score));
    const side = this.side!, shoulder = 11 + side, hip = 23 + side, knee = 25 + side, ankle = 27 + side;
    const proposals: Correction[] = [];
    const rotation = (anchor: number, joint: number, direction: number) => {
      const segment = length(img[anchor], img[joint]);
      return { ...img[joint], x: img[anchor].x + Math.sin(direction) * segment, y: img[anchor].y - Math.cos(direction) * segment };
    };
    if (torsoError > 0) proposals.push({ id: 'torso', label: 'Torso', anchor: hip, joint: shoulder, kind: 'rotation', severity: torsoError,
      target: rotation(hip, shoulder, Math.sign(img[shoulder].x - img[hip].x) * C.maxLean * 0.7 * Math.PI / 180) });
    if (depthError > 0 && this.state === 'BOTTOM') {
      // A downward hip target communicates depth directly; distance follows this user's leg length.
      proposals.push({ id: 'depth', label: 'Squat depth', anchor: knee, joint: hip, kind: 'translation', severity: depthError,
        target: { ...img[hip], y: img[hip].y + b.imageLeg * C.depthTargetDrop } });
    }
    if (footTravel > C.acceptedFootTravel) {
      const support = Object.keys(b.feet).map(Number).filter(i => reliable(img[i]) && img[i].visibility >= C.footVisibility)
        .sort((a, c) => length(img[c], b.feet[c]) - length(img[a], b.feet[a]));
      const joint = support[0] ?? ankle;
      const anchor = joint <= 28 ? joint - 2 : (joint % 2 ? 27 : 28);
      if (length(img[joint], b.feet[joint] ?? b.ankle) / b.imageLeg > C.acceptedFootTravel) proposals.push({
        id: 'stability', label: 'Foot', anchor, joint, kind: 'translation', severity: stabilityError, target: b.feet[joint] ?? b.ankle,
      });
    }
    for (const id of this.errorsSince.keys()) if (!proposals.some(c => c.id === id)) this.errorsSince.delete(id);
    for (const c of proposals) if (!this.errorsSince.has(c.id)) this.errorsSince.set(c.id, now);
    if (this.current && !proposals.some(c => c.id === this.current!.id)) this.confirmedUntil = now + TRACKING.confirmationMs;
    this.current = proposals.filter(c => now - this.errorsSince.get(c.id)! >= TRACKING.errorHoldMs).sort((a, b) => b.severity - a.severity)[0] ?? null;
    const result = this.result(components, rawScore, drop);
    result.score = liveScore; result.confirmed = !this.current && now < this.confirmedUntil;
    return result;
  }
}
