import { EXERCISES, SCORE_RANGES, TRACKING, type ExerciseId } from '../config';
import type { Assessment, Correction, DebugData, Point, Pose, ScoreComponent } from './types';

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
const BODY = [11, 12, 23, 24, 25, 26, 27, 28];
const NAMES: Record<number, string> = { 11: 'Left shoulder', 12: 'Right shoulder', 13: 'Left elbow', 14: 'Right elbow', 15: 'Left wrist', 16: 'Right wrist', 23: 'Left hip', 24: 'Right hip', 25: 'Left knee', 26: 'Right knee', 27: 'Left ankle', 28: 'Right ankle' };
const inFrame = (p: Point | undefined) => !!p && Number.isFinite(p.x) && Number.isFinite(p.y) && p.x >= -TRACKING.frameTolerance && p.x <= 1 + TRACKING.frameTolerance && p.y >= -TRACKING.frameTolerance && p.y <= 1 + TRACKING.frameTolerance;
const visible = (p: Point | undefined) => inFrame(p) && p!.visibility >= TRACKING.visibility;

export function choosePose(poses: Pose[]) {
  const ranked = poses.filter(p => BODY.every(i => p[i])).map(p => {
    const body = BODY.map(i => p[i]);
    const height = Math.max(...body.map(v => v.y)) - Math.min(...body.map(v => v.y));
    const center = (p[23].x + p[24].x) / 2;
    return { pose: p, weight: height * Math.max(0, 1 - Math.abs(center - 0.5)) * body.reduce((a, v) => a + v.visibility, 0) / body.length };
  }).sort((a, b) => b.weight - a.weight);
  return { pose: ranked[0]?.pose, ambiguous: ranked.length > 1 && ranked[1].weight > ranked[0].weight * TRACKING.ambiguityRatio };
}

/** Face, hands, centering and apparent body size are deliberately NOT framing requirements. */
export function framing(p: Pose, id: ExerciseId) {
  const sides = [[11, 23, 25, 27], [12, 24, 26, 28]];
  const quality = (indices: number[]) => Math.min(...indices.map(i => visible(p[i]) ? p[i].visibility : 0));
  const side = quality(sides[1]) > quality(sides[0]) ? 1 : 0;
  // In profile, the far side is often naturally occluded. Require one complete camera-facing chain.
  const required = id === 'curl' ? BODY : sides[side];
  const confidence = required.reduce((sum, i) => sum + (p[i]?.visibility ?? 0), 0) / required.length;
  const missing = required.filter(i => !visible(p[i]));
  const outside = missing.some(i => p[i] && p[i].visibility >= TRACKING.visibility && !inFrame(p[i]));
  const landmarks = Object.entries(NAMES).map(([key, name]) => {
    const index = Number(key);
    return { index, name, visibility: p[index]?.visibility ?? 0, inFrame: inFrame(p[index]), required: required.includes(index) };
  });
  return { ok: !missing.length, confidence, side, outside, landmarks, missing };
}

/** Stateful, memory-only analysis. No timers or synthetic data generate scores here. */
export class CoachEngine {
  private smooth: Pose = [];
  private framedAt: number | null = null;
  private lostAt: number | null = null;
  private acquired = false;
  private errorsSince = new Map<string, number>();
  private current: Correction | null = null;
  private confirmedUntil = 0;
  private armed = false;
  private reachedEnd = false;
  private lastRep = -Infinity;
  private reps = 0;
  private startAt: number | null = null;
  private endAt: number | null = null;
  private previousAngle: number | null = null;
  private movementOrigin: number | null = null;
  private movementAt: number | null = null;
  private activeMovement = false;
  private lowest = 180;
  private shallow = false;
  private ankle: Point | null = null;
  private side: number | null = null;
  private score: number | null = null;
  private perfectFrames = 0;

  constructor(private id: ExerciseId) {}

  private resetEvaluation() {
    this.current = null; this.errorsSince.clear(); this.confirmedUntil = 0;
    this.armed = false; this.reachedEnd = false; this.startAt = null; this.endAt = null;
    this.previousAngle = null; this.movementOrigin = null; this.movementAt = null;
    this.activeMovement = false; this.lowest = 180; this.shallow = false;
    this.ankle = null; this.score = null; this.perfectFrames = 0;
  }

  interrupt(reason = 'Assessment paused'): Assessment {
    this.resetEvaluation(); this.framedAt = null; this.lostAt = null;
    this.acquired = false; this.smooth = []; this.side = null;
    return { ...emptyAssessment(reason), reps: this.reps };
  }

  update(raw: Pose | undefined, now: number, aspect = 1, ambiguous = false): { pose: Pose; assessment: Assessment } {
    const frame = framing(raw ?? [], this.id);
    if (!raw || ambiguous || !frame.ok) {
      this.lostAt ??= now;
      const sustained = now - this.lostAt >= TRACKING.framingLossMs;
      if (sustained) { this.acquired = false; this.side = null; }
      this.framedAt = null; this.smooth = []; this.resetEvaluation();
      // Confidence loss suppresses scores immediately. Reframing is only shown for sustained cropping.
      const warning = sustained && frame.outside && !ambiguous;
      const reason = ambiguous ? 'Multiple prominent poses' : !raw ? 'No reliable pose detected' : frame.missing.map(i => NAMES[i]).join(', ') + (frame.outside ? ': outside frame' : ': low confidence');
      return { pose: raw ?? [], assessment: { ...emptyAssessment('Tracking uncertain'), reps: this.reps, confidence: frame.confidence, framingWarning: warning, debug: { ...emptyDebug(reason), landmarks: frame.landmarks } } };
    }
    this.lostAt = null;
    this.framedAt ??= now;
    if (!this.acquired && now - this.framedAt >= TRACKING.framingHoldMs) this.acquired = true;
    this.smooth = raw.map((p, i) => {
      const old = this.smooth[i];
      return old ? { ...p, x: old.x + (p.x - old.x) * TRACKING.smoothing, y: old.y + (p.y - old.y) * TRACKING.smoothing } : { ...p };
    });
    const base = { ...emptyAssessment('Checking frame'), confidence: frame.confidence, reps: this.reps, debug: { ...emptyDebug('Acquiring full-body landmarks for 500 ms'), landmarks: frame.landmarks } };
    if (!this.acquired) return { pose: this.smooth, assessment: base };

    if (this.side !== null && ![11, 23, 25, 27].every(i => visible(raw[i + this.side!]))) this.side = null;
    this.side ??= frame.side;
    const s = this.side, shoulder = 11 + s, elbow = 13 + s, wrist = 15 + s, hip = 23 + s, knee = 25 + s, ankle = 27 + s;
    const armIndices = this.id === 'curl' ? [13, 14, 15, 16] : this.id === 'row' ? [elbow, wrist] : [];
    if (armIndices.some(i => !visible(raw[i]))) {
      this.resetEvaluation();
      return { pose: this.smooth, assessment: { ...base, reason: 'Tracking uncertain', debug: { ...base.debug, reason: 'Body framed; exercise arm landmarks are occluded' } } };
    }

    // Measurements use isotropic coordinates so the camera's aspect ratio cannot distort angles.
    const p = this.smooth.map(v => ({ ...v, x: v.x * aspect }));
    const torso = Math.max(distance(p[shoulder], p[hip]), 0.0001);
    const leanDx = this.id === 'curl' ? (p[11].x + p[12].x - p[23].x - p[24].x) / 2 : p[shoulder].x - p[hip].x;
    const leanDy = this.id === 'curl' ? (p[23].y + p[24].y - p[11].y - p[12].y) / 2 : p[hip].y - p[shoulder].y;
    const lean = Math.atan2(Math.abs(leanDx), Math.abs(leanDy)) * 180 / Math.PI;
    const cfg = EXERCISES[this.id];
    const leftAngle = angle(p[11], p[13], p[15]), rightAngle = angle(p[12], p[14], p[16]);
    const kneeAngle = angle(p[hip], p[knee], p[ankle]);
    const jointAngle = this.id === 'squat' ? kneeAngle : this.id === 'curl' ? (leftAngle + rightAngle) / 2 : angle(p[shoulder], p[elbow], p[wrist]);
    const rawP = raw.map(v => ({ ...v, x: v.x * aspect }));
    const rawDx = this.id === 'curl' ? (rawP[11].x + rawP[12].x - rawP[23].x - rawP[24].x) / 2 : rawP[shoulder].x - rawP[hip].x;
    const rawDy = this.id === 'curl' ? (rawP[23].y + rawP[24].y - rawP[11].y - rawP[12].y) / 2 : rawP[hip].y - rawP[shoulder].y;
    const debugAngles = { leftElbow: angle(rawP[11], rawP[13], rawP[15]), rightElbow: angle(rawP[12], rawP[14], rawP[16]), knee: angle(rawP[hip], rawP[knee], rawP[ankle]), torsoLean: Math.atan2(Math.abs(rawDx), Math.abs(rawDy)) * 180 / Math.PI };

    this.startAt = jointAngle > cfg.phaseStart ? (this.startAt ?? now) : null;
    this.endAt = jointAngle < cfg.phaseEnd ? (this.endAt ?? now) : null;
    if (this.startAt !== null && now - this.startAt >= TRACKING.phaseHoldMs) {
      if (this.armed && this.reachedEnd && now - this.lastRep > TRACKING.minRepMs) { this.reps++; this.lastRep = now; }
      this.armed = true; this.reachedEnd = false; this.lowest = 180; this.shallow = false;
      this.ankle = { ...p[ankle] }; this.activeMovement = false; this.movementAt = null;
      this.movementOrigin = jointAngle;
    }
    if (this.armed && this.endAt !== null && now - this.endAt >= TRACKING.phaseHoldMs) this.reachedEnd = true;
    this.movementOrigin ??= jointAngle;
    if (jointAngle <= cfg.phaseStart && Math.abs(jointAngle - this.movementOrigin) >= TRACKING.movementDelta) this.movementAt ??= now;
    if (this.movementAt !== null && now - this.movementAt >= TRACKING.movementHoldMs) this.activeMovement = true;
    this.lowest = Math.min(this.lowest, jointAngle);
    if (this.id === 'squat' && this.armed && this.lowest < 145 && this.lowest > EXERCISES.squat.depthAngle && jointAngle > this.lowest + 5 && jointAngle < 150) this.shallow = true;
    const extending = this.previousAngle !== null && jointAngle > this.previousAngle + 0.1;
    this.previousAngle = jointAngle;
    const phase: Assessment['phase'] = jointAngle > cfg.phaseStart ? 'Ready' : this.id === 'squat' ? (extending ? 'Rise' : 'Lower') : this.id === 'curl' ? (extending ? 'Release' : 'Curl') : (extending ? 'Return' : 'Pull');
    const evaluating = this.activeMovement && phase !== 'Ready';
    const candidates: Correction[] = [], components: ScoreComponent[] = [];
    const metric = (id: keyof typeof SCORE_RANGES, value: number | null, limit: number, lower = false, applicable = true) => {
      const error = value === null || !applicable ? 0 : Math.max(0, lower ? limit - value : value - limit) / SCORE_RANGES[id];
      components.push({ id, value, limit, error, score: value === null || !applicable ? null : Math.max(0, 100 - error * 70) });
      return error;
    };
    const add = (id: string, label: string, joint: number, anchor: number, target: Point, severity: number, kind: Correction['kind'] = 'translation') => {
      if (severity > 0) candidates.push({ id, label, joint, anchor, target: { ...target, x: target.x / aspect }, severity, kind });
    };
    const rotationTarget = (anchor: number, joint: number, targetAngle: number): Point => {
      const length = distance(p[anchor], p[joint]);
      return { ...p[joint], x: p[anchor].x + Math.sin(targetAngle) * length, y: p[anchor].y - Math.cos(targetAngle) * length };
    };
    const torsoError = metric('torso', lean, cfg.maxLean);
    // Preserve the user's segment length; use a target safely inside the accepted range.
    const desiredLean = Math.sign(leanDx) * cfg.maxLean * 0.7 * Math.PI / 180;
    const torsoTarget = this.id === 'curl' ? { ...p[shoulder], x: p[shoulder].x - leanDx * 0.8 } : rotationTarget(hip, shoulder, desiredLean);
    add('torso', 'Torso', shoulder, hip, torsoTarget, torsoError, 'rotation');
    if (this.id === 'squat') {
      const depthError = metric('depth', this.lowest, EXERCISES.squat.depthAngle, false, this.shallow || this.lowest <= EXERCISES.squat.depthAngle);
      const calfDirection = Math.atan2(p[ankle].x - p[knee].x, -(p[ankle].y - p[knee].y));
      const currentDirection = Math.atan2(p[hip].x - p[knee].x, -(p[hip].y - p[knee].y));
      const signed = Math.atan2(Math.sin(currentDirection - calfDirection), Math.cos(currentDirection - calfDirection));
      const depthTarget = rotationTarget(knee, hip, calfDirection + Math.sign(signed) * EXERCISES.squat.depthAngle * Math.PI / 180);
      add('depth', 'Knee bend', hip, knee, depthTarget, depthError, 'rotation');
      const stability = this.ankle ? distance(this.ankle, p[ankle]) / torso : null;
      add('stability', 'Foot', ankle, knee, this.ankle ?? p[ankle], metric('stability', stability, EXERCISES.squat.stability));
    } else if (this.id === 'curl') {
      const leftDrift = Math.abs(p[13].x - p[11].x), rightDrift = Math.abs(p[14].x - p[12].x);
      const j = leftDrift > rightDrift ? 13 : 14;
      add('elbow', 'Elbow', j, j - 2, { ...p[j], x: p[j - 2].x }, metric('elbow', Math.max(leftDrift, rightDrift) / torso, EXERCISES.curl.elbowDrift));
      const j2 = leftAngle > rightAngle ? 15 : 16, opposite = j2 === 15 ? 16 : 15;
      const ratio = distance(p[j2], p[j2 - 2]) / Math.max(distance(p[opposite], p[opposite - 2]), 0.0001);
      const target = { ...p[j2], x: p[j2 - 2].x - (p[opposite].x - p[opposite - 2].x) * ratio, y: p[j2 - 2].y + (p[opposite].y - p[opposite - 2].y) * ratio };
      add('symmetry', 'Forearm', j2, j2 - 2, target, metric('symmetry', Math.abs(leftAngle - rightAngle), EXERCISES.curl.asymmetry), 'rotation');
    } else {
      const ear = p[7 + s];
      const elevation = visible(raw[7 + s]) ? Math.abs(p[shoulder].y - ear.y) / torso : null;
      add('shoulder', 'Shoulder', shoulder, hip, { ...p[shoulder], y: p[shoulder].y + torso * 0.15 }, metric('shoulder', elevation, EXERCISES.row.shoulderElevation, true));
      add('path', 'Elbow', elbow, shoulder, { ...p[elbow], y: p[shoulder].y + torso * 0.6 }, metric('path', (p[elbow].y - p[shoulder].y) / torso, EXERCISES.row.elbowPath, true));
    }

    // Each error earns its own persistence window, so fluctuating priority cannot reset every cue.
    for (const id of this.errorsSince.keys()) if (!candidates.some(c => c.id === id)) this.errorsSince.delete(id);
    for (const c of candidates) if (!this.errorsSince.has(c.id)) this.errorsSince.set(c.id, now);
    const stable = candidates.filter(c => now - this.errorsSince.get(c.id)! >= TRACKING.errorHoldMs).sort((a, b) => b.severity - a.severity);
    if (this.current && !candidates.some(c => c.id === this.current!.id)) this.confirmedUntil = now + TRACKING.confirmationMs;
    this.current = evaluating ? stable[0] ?? null : null;
    const available = components.filter(c => c.score !== null);
    const rawScore = evaluating && available.length ? available.reduce((sum, c) => sum + c.score!, 0) / available.length : null;
    const allAccepted = evaluating && components.every(c => c.score === 100);
    this.perfectFrames = allAccepted ? this.perfectFrames + 1 : 0;
    if (rawScore === null) { this.score = null; this.perfectFrames = 0; }
    else this.score = this.score === null ? rawScore : this.score + (rawScore - this.score) * TRACKING.scoreSmoothing;
    const score = this.score === null ? null : Math.min(this.perfectFrames >= TRACKING.perfectFrames ? 100 : 99, Math.round(this.score));
    const reason = evaluating ? 'Evaluating movement' : 'Ready';
    return { pose: this.smooth, assessment: {
      ready: true, confidence: frame.confidence, reason, reps: this.reps, phase, score,
      correction: this.current, confirmed: evaluating && !this.current && now < this.confirmedUntil, framingWarning: false,
      debug: { landmarks: frame.landmarks, angles: debugAngles, components, reason: evaluating ? 'Pose-derived metrics' : 'Waiting for a meaningful angle change', validMovement: evaluating, rawScore, stableFrames: this.perfectFrames },
    } };
  }
}
