import { FEEDBACK } from '../config';

/** Time-weighted, phase-balanced quality prevents a long pause masking poor movement. */
export class RepQuality {
  private phases = new Map<string, { total: number; duration: number; initial: number }>();
  private previous: { at: number; phase: string; score: number } | null = null;
  completedCycles = 0;
  lastScore: number | null = null;
  reset() { this.phases.clear(); this.previous = null; }
  sample(score: number | null, phase: string, now: number) {
    if (score === null || !Number.isFinite(score)) return;
    const old = this.previous;
    if (old && now > old.at) {
      const duration = Math.min(now - old.at, 350);
      const p = this.phases.get(old.phase) ?? { total: 0, duration: 0, initial: old.score };
      p.total += old.score * duration; p.duration += duration;
      this.phases.set(old.phase, p);
    }
    if(!this.phases.has(phase)) this.phases.set(phase,{total:0,duration:0,initial:score});
    this.previous = { at: now, phase, score };
  }
  complete(now: number, required: string[]) {
    if (this.previous) this.sample(this.previous.score, this.previous.phase, now);
    const values = [...this.phases.values()];
    const recognized = required.every(phase => this.phases.has(phase));
    this.lastScore = recognized && values.length ? values.reduce((s, p) => s + (p.duration > 0 ? p.total / p.duration : p.initial), 0) / values.length : null;
    if (recognized) this.completedCycles++;
    const accepted = this.lastScore !== null && this.lastScore >= FEEDBACK.qualityRepThreshold;
    this.reset();
    return accepted;
  }
}
