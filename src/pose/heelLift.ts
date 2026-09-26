import { EXERCISES } from '../config';
import type { Correction, Pose } from './types';

const C = EXERCISES.squat;
type Foot = { heel: number; ankle: number; length: number; toeX: number; toeY: number; leg: number };

export class HeelLiftEvaluator {
  private baseline: Foot | null = null;
  private calibration: { at: number; foot: Foot }[] = [];
  private samples: number[] = [];
  private since: number | null = null;
  private active = false;
  debug: { baseline: Foot | null; lift: number | null; reason: string } = { baseline: null, lift: null, reason: 'Foot baseline unavailable' };

  reset() {
    this.baseline = null; this.calibration = []; this.unavailable('Foot baseline unavailable');
  }
  private unavailable(reason: string) {
    this.samples = []; this.since = null; this.active = false;
    this.debug = { baseline: this.baseline, lift: null, reason };
    return null;
  }
  update(img: Pose, side: number, leg: number, now: number, calibrating: boolean, stable: boolean, coaching: boolean, imageWidth = 1): Correction | null {
    const ankle = 27 + side, heel = 29 + side, toe = 31 + side;
    const visible = [ankle, heel, toe].every(i => {
      const p = img[i];
      return p && p.visibility >= C.heelVisibility && Number.isFinite(p.x) && Number.isFinite(p.y) && p.x >= 0 && p.x <= imageWidth && p.y >= 0 && p.y <= 1;
    });
    if (!visible || leg <= 0) {
      this.calibration = [];
      if (calibrating) this.baseline = null;
      return this.unavailable('Heel, toe and ankle must be visible');
    }
    const f: Foot = { heel: (img[toe].y - img[heel].y) / leg, ankle: (img[toe].y - img[ankle].y) / leg,
      length: Math.hypot(img[toe].x - img[heel].x, img[toe].y - img[heel].y) / leg,
      toeX: img[toe].x, toeY: img[toe].y, leg };
    if (f.length < C.heelFootLengthMin || f.length > C.heelFootLengthMax) {
      this.calibration = []; if (calibrating) this.baseline = null;
      return this.unavailable('Foot geometry unclear');
    }
    if (calibrating) {
      if (!stable) { this.calibration = []; this.baseline = null; return this.unavailable('Waiting for stable standing feet'); }
      const first = this.calibration[0]?.foot;
      if (first && (Math.abs(f.heel - first.heel) > C.heelBaselineRange || Math.abs(f.ankle - first.ankle) > C.heelBaselineRange || Math.hypot(f.toeX - first.toeX, f.toeY - first.toeY) / leg > C.heelBaselineRange)) {
        this.calibration = []; this.baseline = null;
      }
      this.calibration.push({ at: now, foot: f });
      while (this.calibration.length > 1 && now - this.calibration[1].at >= C.heelBaselineMs) this.calibration.shift();
      if (now - this.calibration[0].at >= C.heelBaselineMs) {
        const mean = (key: keyof Foot) => this.calibration.reduce((sum, s) => sum + s.foot[key], 0) / this.calibration.length;
        this.baseline = { heel: mean('heel'), ankle: mean('ankle'), length: mean('length'), toeX: mean('toeX'), toeY: mean('toeY'), leg: mean('leg') };
      }
      return this.unavailable(this.baseline ? 'Standing foot baseline captured' : 'Capturing standing feet');
    }
    const b = this.baseline;
    if (!b || !coaching) return this.unavailable(b ? 'Waiting for recognized squat' : 'Foot baseline unavailable');
    if (Math.hypot(f.toeX - b.toeX, f.toeY - b.toeY) / b.leg > C.heelToeTravelMax || Math.abs(f.length / b.length - 1) > C.heelFootScaleChange) return this.unavailable('Foot moved or changed orientation');
    // Toe-relative rise rejects whole-foot translation, ankle rise corroborates the heel
    const lift = f.heel - b.heel;
    this.samples.push(lift);
    if (this.samples.length > C.featureWindow) this.samples.shift();
    const filtered = [...this.samples].sort((a, b) => a - b)[Math.floor(this.samples.length / 2)];
    const raised = this.samples.length === C.featureWindow && filtered > (this.active ? C.heelLiftRelease : C.heelLiftMin) && f.ankle - b.ankle >= C.heelAnkleLiftMin;
    if (raised) { this.since ??= now; this.active ||= now - this.since >= C.heelConfirmMs; }
    else { this.since = null; this.active = false; }
    this.debug = { baseline: b, lift: filtered, reason: this.active ? 'Heel lift detected' : raised ? 'Confirming heel lift' : 'Heel within baseline range' };
    return this.active ? { id: 'heel-lift', label: '', joint: heel, anchor: toe, kind: 'translation', severity: Math.min(1, filtered / C.heelLiftMin),
      target: { ...img[heel], y: img[toe].y - b.heel * leg } } : null;
  }
}
