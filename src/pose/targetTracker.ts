import { TARGET as C } from '../config';
import type { Point, Pose } from './types';

export type TargetState = 'selecting' | 'locked' | 'occluded';
type Body = { index: number; pose: Pose; core: Point[]; scale: number; center: Point };
export type TargetSelection = { state: TargetState; pose?: Pose; index?: number; acquired: boolean };

// Follow the same visible body using its position and size
// Pause feedback when we cannot confidently match it
export class TargetTracker {
  private locked: Body | null = null;
  private candidate: Body | null = null;
  private candidateSince = 0;
  private lastSeen = 0;
  private lastAt: number | null = null;
  private ambiguous = false;
  reset() { this.locked=null; this.candidate=null; this.lastAt=null; this.ambiguous=false; }

  update(poses: Pose[], now: number, aspect = 1): TargetSelection {
    const gap=this.lastAt!==null && (now<=this.lastAt || now-this.lastAt>C.maxFrameGapMs);
    this.lastAt=now;
    if(gap) this.candidate=null;
    const bodies: Body[]=poses.flatMap((pose,index)=>{
      const reliable=(p:Point|undefined)=>p && p.visibility>=C.visibility && Number.isFinite(p.x) && Number.isFinite(p.y) && p.x>=0 && p.x<=1 && p.y>=0 && p.y<=1;
      if(![0,1].some(side=>reliable(pose[11+side]) && reliable(pose[23+side])))return [];
      // Use the visible shoulder and hip if the far side is hidden
      // Pass the original landmarks to the exercise checks
      const points=[11,12,23,24].map(i=>reliable(pose[i])?pose[i]:pose[i%2===1?i+1:i-1]);
      if(points.some(p=>!reliable(p)))return [];
      const core=points.map(p=>({...p,x:p.x*aspect}));
      const scale=(Math.hypot(core[0].x-core[2].x,core[0].y-core[2].y)+Math.hypot(core[1].x-core[3].x,core[1].y-core[3].y))/2;
      if(scale<C.minTorso)return [];
      const center={x:core.reduce((s,p)=>s+p.x,0)/4,y:core.reduce((s,p)=>s+p.y,0)/4,visibility:1};
      return [{index,pose,core,scale,center}];
    });
    const match=(a:Body,b:Body)=>{
      if(Math.max(a.scale/b.scale,b.scale/a.scale)>C.maxScaleRatio)return Infinity;
      // Sorting each pair avoids left/right landmark swaps in a side profile
      const pair=(start:number)=>{
        const left=a.core.slice(start,start+2).sort((p,q)=>p.x-q.x);
        const right=b.core.slice(start,start+2).sort((p,q)=>p.x-q.x);
        return left.reduce((sum,p,i)=>sum+Math.hypot(p.x-right[i].x,p.y-right[i].y),0);
      };
      return (pair(0)+pair(2))/(4*Math.min(a.scale,b.scale));
    };
    if(this.locked) {
      const matches=bodies.map(body=>({body,distance:match(this.locked!,body)})).sort((a,b)=>a.distance-b.distance);
      const best=matches[0];
      if(best && best.distance<=C.maxMatchDistance && matches[1] && matches[1].distance-best.distance<=C.matchMargin)this.ambiguous=true;
      const certain=!this.ambiguous && best && best.distance<=C.maxMatchDistance && (!matches[1] || matches[1].distance-best.distance>C.matchMargin);
      // Pause on a stale interval, crossing/overlap ambiguity requires a new acquisition
      if(!gap && now-this.lastSeen<C.lostMs && certain) {
        this.locked=best.body; this.lastSeen=now;
        return {state:'locked',pose:best.body.pose,index:best.body.index,acquired:false};
      }
      if(now-this.lastSeen<C.lostMs) return {state:'occluded',acquired:false};
      this.locked=null; this.candidate=null; this.ambiguous=false;
    }
    const ranked=bodies.filter(b=>Math.abs(b.center.x/aspect-0.5)<=C.centerRadius)
      .map(body=>({body,rank:Math.abs(body.center.x/aspect-0.5)/C.centerRadius+0.1/body.scale}))
      .sort((a,b)=>a.rank-b.rank);
    const first=ranked[0];
    if(!first || (ranked[1] && ranked[1].rank-first.rank<C.acquisitionMargin)) {
      this.candidate=null; return {state:'selecting',acquired:false};
    }
    if(!this.candidate || match(this.candidate,first.body)>C.maxMatchDistance) this.candidateSince=now;
    this.candidate=first.body;
    if(now-this.candidateSince<C.acquireMs)return {state:'selecting',acquired:false};
    this.locked=first.body;this.candidate=null;this.lastSeen=now;
    return {state:'locked',pose:first.body.pose,index:first.body.index,acquired:true};
  }
}
