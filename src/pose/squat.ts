import { EXERCISES } from '../config';
import { HeelLiftEvaluator } from './heelLift';
import type { Correction, Point, Pose, ScoreComponent, SquatDebug, SquatState } from './types';

const C = EXERCISES.squat;
const length = (a: Point, b: Point) => Math.hypot(a.x - b.x, a.y - b.y, (a.z ?? 0) - (b.z ?? 0));
function jointAngle(a: Point, b: Point, c: Point) {
  const denominator = length(a, b) * length(c, b);
  if (denominator < 1e-8) return NaN;
  const dot = (a.x - b.x) * (c.x - b.x) + (a.y - b.y) * (c.y - b.y) + ((a.z ?? 0) - (b.z ?? 0)) * ((c.z ?? 0) - (b.z ?? 0));
  return Math.acos(Math.max(-1, Math.min(1, dot / denominator))) * 180 / Math.PI;
}
const reliable = (p: Point | undefined) => !!p && p.visibility >= C.visibility && Number.isFinite(p.x) && Number.isFinite(p.y);
const finiteWorld = (p: Point | undefined) => reliable(p) && Number.isFinite(p!.z);
const clamp = (n: number) => Math.max(0, Math.min(1, n));

type Features = {
  knee: number; hip: number; tilt: number; hipHeight: number; leg: number;
  hipVelocity: number; kneeVelocity: number;
  shinHeight: number; shoulderRatio: number; hipRatio: number;
  leftKnee: number | null; rightKnee: number | null; supportTravel: number;
  hipTravel: number;
};
type Baseline = { tilt: number; confidence: number; height: number; knee: number; hip: number; leg: number; imageLeg: number; ankle: Point; hipX: number; feet: Record<number, Point> };
export type SquatResult = {
  debug: SquatDebug; score: number | null; rawScore: number | null;
  components: ScoreComponent[]; stableFrames: number; correction: Correction | null;
  confirmed: boolean; reps: number; evaluating: boolean;
  corrections: Correction[];
};

/** Live quality is available only after a calibrated descent and stable hold. */
export class SquatEvaluator {
  private heels = new HeelLiftEvaluator();
  private state: SquatState = 'FRAME_INVALID';
  private reason = 'Required landmarks unavailable';
  private source: 'world' | 'normalized' | null = null;
  private side: number | null = null;
  private features: Features | null = null;
  private previousAt: number | null = null;
  private baseline: Baseline | null = null;
  private baselineSince: number | null = null;
  private baselineFrames: Features[] = [];
  private directionSince: number | null = null;
  private holdDuration = 0;
  private holdOrigin: Features | null = null;
  private held = false;
  private startedAt = 0;
  private finishSince: number | null = null;
  private reps = 0;
  private samples: Features[] = [];
  private recent: Features[] = [];
  private holdWindow: { at: number; frame: Features }[] = [];
  private missingSince: number | null = null;
  private footPoints = 0;
  private rotateSideways = false;
  private confidenceSamples: number[] = [];
  private score: number | null = null;
  private rawScore: number | null = null;
  private components: ScoreComponent[] = [];
  private corrections: Correction[] = [];
  private evaluatedAt: number | null = null;
  private quality: { knee: number; hip: number; tilt: number; drop: number; stability: number } | null = null;
  private reliableFrame = false;

  private observeConfidence(value: number) {
    this.confidenceSamples.push(value);
    if (this.confidenceSamples.length > C.featureWindow) this.confidenceSamples.shift();
  }
  private filteredConfidence() {
    const sorted = [...this.confidenceSamples].sort((a, b) => a - b);
    return sorted.length ? sorted[Math.floor(sorted.length / 2)] : 0;
  }
  private clearQuality() {
    this.score = null; this.rawScore = null; this.components = []; this.corrections = [];
    this.quality = null; this.evaluatedAt = null;
  }
  invalidate(reason: string): SquatResult {
    this.heels.reset();
    this.state = 'FRAME_INVALID'; this.reason = reason; this.reliableFrame = false;
    this.baseline = null; this.baselineSince = null; this.baselineFrames = [];
    this.directionSince = null; this.holdDuration = 0; this.holdOrigin = null;
    this.finishSince = null; this.held = false;
    this.features = null; this.previousAt = null; this.source = null; this.side = null;
    this.samples = []; this.recent = []; this.holdWindow = []; this.missingSince = null;
    this.confidenceSamples = []; this.footPoints = 0; this.rotateSideways = false;
    this.clearQuality(); return this.result();
  }
  suspend(reason: string, now: number, recordLoss = true): SquatResult {
    this.heels.reset();
    if (this.state === 'HOLDING') return this.invalidate(reason);
    if (recordLoss) this.observeConfidence(0);
    this.missingSince ??= now;
    if (now - this.missingSince >= C.trackingGraceMs) return this.invalidate(reason);
    this.holdDuration = 0; this.recent = []; this.holdWindow = [];
    this.reliableFrame = false; this.reason = reason; this.clearQuality(); return this.result();
  }
  private exit(reason: string) {
    this.heels.reset();
    this.state = 'EXIT'; this.reason = reason; this.baseline = null;
    this.baselineSince = null; this.baselineFrames = []; this.directionSince = null;
    this.holdDuration = 0; this.holdOrigin = null; this.held = false;
    this.clearQuality(); return this.result();
  }
  private result(): SquatResult {
    const f = this.features, b = this.baseline;
    const holding = this.state === 'HOLDING' && this.reliableFrame;
    const coaching = this.reliableFrame && (holding || this.state === 'DESCENDING');
    return {
      debug: {
        state: this.state, source: this.source, kneeAngle: f?.knee ?? null, hipAngle: f?.hip ?? null,
        torsoTilt: f?.tilt ?? null, hipDrop: f && b ? (b.height - f.hipHeight) / b.leg : null,
        hipVelocity: f?.hipVelocity ?? null, kneeVelocity: f?.kneeVelocity ?? null,
        baselineDetected: !!b, baseline: b ? { knee: b.knee, hip: b.hip, height: b.height, leg: b.leg, tilt: b.tilt, confidence: b.confidence, feet: b.feet } : null,
        sideOn: !!f && f.shoulderRatio <= C.sideShoulderRatioMax && f.hipRatio <= C.sideHipRatioMax,
        leftKneeAngle: f?.leftKnee ?? null, rightKneeAngle: f?.rightKnee ?? null,
        shoulderRatio: f?.shoulderRatio ?? null, hipRatio: f?.hipRatio ?? null,
        trackingReliable: this.reliableFrame, rotateSideways: this.rotateSideways, footPoints: this.footPoints,
        landmarkConfidence: this.filteredConfidence(), holdConfirmationMs: this.holdDuration,
        heelLift: this.heels.debug,
        evaluatedAt: this.evaluatedAt, activeCorrections: coaching ? this.corrections.map(c => c.id) : [], reason: this.reason,
      },
      score: holding ? this.score : null, rawScore: holding ? this.rawScore : null,
      components: holding ? this.components : [], stableFrames: holding ? this.recent.length : 0,
      correction: coaching ? this.corrections[0] ?? null : null, corrections: coaching ? this.corrections : [],
      confirmed: false, reps: this.reps, evaluating: holding,
    };
  }
  update(image: Pose, now: number, aspect: number, side: number, world?: Pose): SquatResult {
    const indices = [11 + side, 23 + side, 25 + side, 27 + side];
    if (!indices.every(i => reliable(image[i]))) return this.suspend('Required squat landmarks have low confidence', now);
    this.observeConfidence(Math.min(...indices.map(i => image[i].visibility)));
    if (this.filteredConfidence() < C.visibility) return this.suspend('Filtered landmark confidence recovering', now, false);
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
      hipVelocity: 0, kneeVelocity: 0,
      shinHeight: (geometry[ankle].y - geometry[knee].y) / leg,
      shoulderRatio: reliable(image[11]) && reliable(image[12]) ? Math.abs(img[11].x - img[12].x) / torso : 0,
      hipRatio: reliable(image[23]) && reliable(image[24]) ? Math.abs(img[23].x - img[24].x) / torso : 0,
      leftKnee: side === 0 ? kneeAngle : otherKnee, rightKnee: side === 1 ? kneeAngle : otherKnee,
      supportTravel,
      hipTravel: this.baseline ? Math.abs(img[hip].x - img[ankle].x - this.baseline.hipX) / this.baseline.imageLeg : 0,
    };
    if (![current.knee, current.hip, current.tilt, current.hipHeight].every(Number.isFinite)) return this.invalidate('Joint geometry is not finite');
    this.samples.push({ ...current });
    if (this.samples.length > C.featureWindow) this.samples.shift();
    // Median first, then EMA: a single extreme sample cannot flip a valid phase.
    if (this.samples.length === C.featureWindow) {
      for (const key of ['knee', 'hip', 'tilt', 'hipHeight', 'leg', 'shinHeight', 'shoulderRatio', 'hipRatio', 'supportTravel', 'hipTravel', 'leftKnee', 'rightKnee'] as const) {
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
    this.reliableFrame = true;
    this.recent.push({ ...f });
    if (this.recent.length > C.holdSampleWindow) this.recent.shift();
    this.rotateSideways = f.shoulderRatio > C.sideShoulderRatioMax || f.hipRatio > C.sideHipRatioMax;
    if (this.rotateSideways) return this.exit('Side-view orientation required');
    // Torso lean and hip folding are form measurements, not tracking failures.
    // Upright calibration and coordinated leg movement still establish the squat;
    // a visible leaned torso must remain assessable once that movement is observed.
    if (f.hipHeight / f.leg < C.minHipHeight || f.shinHeight < C.minShinHeight) return this.exit('Lower-body pose is outside the supported squat geometry');
    if (Math.abs(f.hipVelocity) > C.maxHipSpeed || Math.abs(f.kneeVelocity) > C.maxKneeSpeed) return this.exit('Movement too abrupt to recognize');
    const upright = f.knee >= C.startKneeMin && f.hip >= C.startHipMin && f.tilt <= C.startTorsoMax;
    const stableStart = upright && Math.abs(f.hipVelocity) <= C.baselineHipSpeed && Math.abs(f.kneeVelocity) <= C.baselineKneeSpeed;
    if (!this.baseline) {
      this.heels.update(img, side, imageLeg, now, true, stableStart, false, aspect);
      this.state = 'CALIBRATING_STANDING'; this.reason = 'Waiting for stable upright calibration';
      if (!stableStart) { this.baselineSince = null; this.baselineFrames = []; return this.result(); }
      const origin = this.baselineFrames[0];
      if (origin && Math.abs(f.hipHeight - origin.hipHeight) / f.leg > C.baselineHipRange) { this.baselineSince = null; this.baselineFrames = []; }
      this.baselineSince ??= now; this.baselineFrames.push({ ...f });
      if (now - this.baselineSince >= C.baselineHoldMs) {
        const mean = (key: 'knee' | 'hip' | 'hipHeight' | 'leg' | 'tilt') => this.baselineFrames.reduce((sum, frame) => sum + frame[key], 0) / this.baselineFrames.length;
        this.baseline = { knee: mean('knee'), hip: mean('hip'), height: mean('hipHeight'), leg: mean('leg'), tilt: mean('tilt'), confidence: this.filteredConfidence(),
          imageLeg, ankle: { ...img[ankle] }, hipX: img[hip].x - img[ankle].x, feet: Object.fromEntries(footIndices.map(i => [i, { ...img[i] }])) };
        this.baselineFrames = []; this.reason = 'Calibrated; waiting for coordinated descent';
      }
      return this.result();
    }
    const b = this.baseline, drop = (b.height - f.hipHeight) / b.leg, bend = b.knee - f.knee;
    if (f.supportTravel > C.maxFootTravel || f.hipTravel > C.maxHipTravel || Math.abs(f.leg / b.leg - 1) > C.maxLegScaleChange) return this.exit('Foot travel or changing body geometry invalidates calibration');
    const ascending = f.hipVelocity < -C.directionHipSpeed && f.kneeVelocity > C.directionKneeSpeed;
    if (this.state === 'CALIBRATING_STANDING') {
      // Require a measured change from the observed standing baseline, rather
      // than simultaneous derivative thresholds that miss slow descents.
      const plausible = drop >= C.minHipDrop && bend >= C.minKneeBend && b.hip - f.hip >= C.minHipBend && !ascending;
      if (plausible) this.directionSince ??= now; else this.directionSince = null;
      if (this.directionSince !== null && now - this.directionSince >= C.directionHoldMs) {
        this.state = 'DESCENDING'; this.startedAt = now; this.directionSince = null; this.held = false; this.holdWindow = [];
      } else { this.reason = 'Calibrated; waiting for sustained hip descent and knee bend'; return this.result(); }
    }
    const squatPosition = bend >= C.holdMinKneeBend && drop >= C.holdMinHipDrop;
    if (this.state === 'HOLDING') {
      const risingFromHold = ascending && this.holdOrigin && (f.hipHeight - this.holdOrigin.hipHeight) / b.leg >= C.ascentDrop && f.knee - this.holdOrigin.knee >= C.ascentKneeExtension;
      const movedFromHold = this.holdOrigin && (Math.abs(f.hipHeight - this.holdOrigin.hipHeight) / b.leg > C.holdExitHipRange || Math.abs(f.knee - this.holdOrigin.knee) > C.holdExitKneeRange);
      if (!squatPosition || risingFromHold || Math.abs(f.hipVelocity) > C.holdExitHipSpeed || Math.abs(f.kneeVelocity) > C.holdExitKneeSpeed || movedFromHold) {
        this.clearQuality(); this.holdDuration = 0;
        if (ascending || upright) { this.state = 'ASCENDING'; this.reason = 'Rising from hold; scoring stopped'; }
        else return this.exit('Hold moved too far; return to standing to recalibrate');
        return this.result();
      }
    }
    if (this.state === 'ASCENDING') {
      if (stableStart) this.finishSince ??= now; else this.finishSince = null;
      if (this.finishSince !== null && now - this.finishSince >= C.finishHoldMs) {
        if (this.held) this.reps++;
        this.finishSince = null; return this.exit('Returned to standing; recalibrate before another hold');
      }
      this.reason = 'Ascending; no hold score'; return this.result();
    }
    if (this.state === 'DESCENDING') {
      if (now - this.startedAt > C.maxSequenceMs) return this.exit('No stable squat hold established');
      if (!squatPosition && ascending) { this.state = 'ASCENDING'; this.reason = 'Rising before hold confirmation'; this.holdDuration = 0; return this.result(); }
      // A time window of smoothed geometry tolerates small zero-crossings in
      // landmark velocity. One noisy velocity sample cannot erase a bottom hold.
      if (squatPosition) this.holdWindow.push({ at: now, frame: { ...f } }); else this.holdWindow = [];
      while (this.holdWindow.length > 1 && now - this.holdWindow[1].at >= C.holdConfirmMs) this.holdWindow.shift();
      const knees = this.holdWindow.map(sample => sample.frame.knee);
      const heights = this.holdWindow.map(sample => sample.frame.hipHeight);
      const duration = this.holdWindow.length ? now - this.holdWindow[0].at : 0;
      const kneeRange = knees.length ? Math.max(...knees) - Math.min(...knees) : Infinity;
      const hipRange = heights.length ? (Math.max(...heights) - Math.min(...heights)) / b.leg : Infinity;
      const stable = squatPosition && kneeRange <= C.holdMaxKneeRange && hipRange <= C.holdMaxHipRange;
      this.holdDuration = stable ? duration : 0;
      this.reason = stable ? 'Confirming stable squat hold' : 'Waiting for knee and hip position to settle';
      if (this.holdDuration < C.holdConfirmMs) {
        // Posture guidance must not depend on settling into a scoreable hold.
        // Calibration and coordinated descent have already established context.
        const error = Math.max(0, (f.tilt - C.maxLean) / C.torsoPenaltyRange);
        this.corrections = error > C.holdIssueThreshold ? [this.torsoCorrection(img, error)] : [];
        return this.imageResult(aspect, img, b, now);
      }
      this.state = 'HOLDING'; this.held = true; this.holdOrigin = { ...f }; this.clearQuality();
    }
    if (this.state === 'HOLDING') {
      this.reason = 'Measured stable squat hold';
      this.evaluateHold(img, b, now);
      return this.imageResult(aspect, img, b, now);
    }
    return this.result();
  }

  private imageResult(aspect: number, img: Pose, b: Baseline, now: number) {
    const heel = this.heels.update(img, this.side!, b.imageLeg, now, false, false, true, aspect);
    if (heel) this.corrections.push(heel);
    const result = this.result();
    result.corrections = result.corrections.map(c => ({ ...c, target: { ...c.target, x: c.target.x / aspect } }));
    result.correction = result.corrections[0] ?? null;
    return result;
  }

  private torsoCorrection(img: Pose, severity: number): Correction {
    const hip = 23 + this.side!, shoulder = 11 + this.side!;
    const angle = Math.sign(img[shoulder].x - img[hip].x) * C.maxLean * C.torsoTargetRatio * Math.PI / 180;
    const size = length(img[hip], img[shoulder]);
    return { id: 'torso', label: '', joint: shoulder, anchor: hip, kind: 'rotation', severity,
      target: { ...img[shoulder], x: img[hip].x + Math.sin(angle) * size, y: img[hip].y - Math.cos(angle) * size } };
  }

  private evaluateHold(img: Pose, b: Baseline, now: number) {
    const mean = (key: 'knee' | 'hip' | 'tilt' | 'hipHeight') => this.recent.reduce((sum, f) => sum + f[key], 0) / this.recent.length;
    const range = (key: 'knee' | 'hipHeight') => Math.max(...this.recent.map(f => f[key])) - Math.min(...this.recent.map(f => f[key]));
    const q = { knee: mean('knee'), hip: mean('hip'), tilt: mean('tilt'), drop: (b.height - mean('hipHeight')) / b.leg,
      stability: Math.max(0, (range('hipHeight') / b.leg - C.holdStableHipRange) / (C.holdMaxHipRange - C.holdStableHipRange), (range('knee') - C.holdStableKneeRange) / (C.holdMaxKneeRange - C.holdStableKneeRange)) };
    const depth = C.depthKneeWeight * clamp((q.knee - C.depthAngle) / C.depthPenaltyRange) + C.depthDropWeight * clamp((C.targetHipDrop - q.drop) / C.dropPenaltyRange);
    const torso = Math.max(0, (q.tilt - C.maxLean) / C.torsoPenaltyRange);
    const components: ScoreComponent[] = [
      { id: 'depth', value: q.knee, limit: C.depthAngle, error: depth, score: 100 * (1 - clamp(depth)) },
      { id: 'torso', value: q.tilt, limit: C.maxLean, error: torso, score: 100 * (1 - clamp(torso)) },
      { id: 'stability', value: q.stability, limit: 0, error: q.stability, score: 100 * (1 - clamp(q.stability)) },
    ];
    const previous = this.quality;
    const crossed = components.some(c => (c.error > C.holdIssueThreshold) !== ((this.components.find(old => old.id === c.id)?.error ?? 0) > C.holdIssueThreshold));
    const changed = !previous || crossed || Math.abs(q.knee - previous.knee) >= C.holdChangeAngle || Math.abs(q.hip - previous.hip) >= C.holdChangeAngle || Math.abs(q.tilt - previous.tilt) >= C.holdChangeAngle || Math.abs(q.drop - previous.drop) >= C.holdChangeDrop || Math.abs(q.stability - previous.stability) >= C.holdChangeStability;
    if (this.evaluatedAt === null || now - this.evaluatedAt >= C.holdEvaluationMs) {
      this.evaluatedAt = now;
      if (changed) {
        this.quality = q; this.components = components;
        this.rawScore = components.reduce((sum, c) => sum + c.score! * C.holdWeights[c.id as keyof typeof C.holdWeights], 0);
        this.score = Math.round(this.rawScore);
      }
    }
    // Keep target anchors attached to the current skeleton without recomputing quality every frame.
    const side = this.side!, hip = 23 + side, knee = 25 + side;
    this.corrections = [];
    for (const c of this.components) {
      if (c.error <= C.holdIssueThreshold) continue;
      if (c.id === 'depth') this.corrections.push({ id: 'depth', label: '', joint: hip, anchor: knee, kind: 'translation', severity: c.error, target: { ...img[hip], y: img[hip].y + b.imageLeg * C.depthTargetDrop } });
      if (c.id === 'torso') this.corrections.push(this.torsoCorrection(img, c.error));
      if (c.id === 'stability') for (const joint of [hip, knee]) this.corrections.push({ id: `stability-${joint}`, label: '', joint, anchor: 27 + side, kind: 'instability', severity: c.error, target: { ...img[joint] } });
    }
  }
}
