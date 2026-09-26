import { FEEDBACK } from '../config';

// Smooth scores from the pose measurements we have
// Clear the displayed score as soon as tracking becomes uncertain
export class ScoreWindow {
  private samples: { at: number; score: number }[] = [];
  private sampledAt: number | null = null;
  value: number | null = null;
  updatedAt: number | null = null;
  reset() { this.samples=[];this.sampledAt=null;this.value=null;this.updatedAt=null; }
  update(raw: number | null, now: number, interval: number) {
    if(raw===null || !Number.isFinite(raw)) {this.reset();return null;}
    this.samples.push({at:now,score:raw});
    this.samples=this.samples.filter(s=>now-s.at<=FEEDBACK.scoreWindowMs);
    if(this.sampledAt===null || now-this.sampledAt>=interval) {
      const measured=this.samples.reduce((sum,s)=>sum+s.score,0)/this.samples.length;
      this.sampledAt=now;
      if(this.value===null || Math.abs(measured-this.value)>=FEEDBACK.scoreChangeMin) {
        this.value=Math.round(measured);this.updatedAt=now;
      }
    }
    return this.value;
  }
}
