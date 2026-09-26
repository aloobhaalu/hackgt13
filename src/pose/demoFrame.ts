import type { CameraView, ExerciseId } from '../config';
import { demoPose } from './demo';
import type { Pose } from './types';

/** Explicit developer demos only. Homepage previews keep using the unchanged demoPose branches. */
export function demoFrame(id: ExerciseId, view: CameraView, seconds: number): { pose: Pose; world?: Pose } {
  const pose=demoPose(id,seconds);
  if(id==='curl'&&view==='side') {
    for(const s of [0,1]) {
      const shift=.48+s*.025-pose[11+s].x;
      // Recover the forward arc from the front projection's horizontal/depth components.
      const dx=Math.hypot(pose[15+s].x-pose[13+s].x,(pose[15+s].z??0)-(pose[13+s].z??0));
      for(const i of [11,13,15,23])pose[i+s].x+=shift;
      pose[15+s].x=pose[13+s].x+dx;
      pose[15+s].z=0;
    }
  }
  if(id==='curl'&&view==='front') return {pose,world:pose.map(p=>({...p}))};
  if(view==='front'&&id!=='curl') {
    const world=pose.map(p=>({...p,z:p.x}));
    for(const s of [0,1]) {
      const sign=s===0?-1:1;
      for(const [i,width] of [[11,.12],[13,.12],[15,.12],[23,.07],[25,.08],[27,.11],[29,.12],[31,.12]]) {
        pose[i+s].x=.5+sign*width;
        world[i+s].x=sign*width;
      }
    }
    return {pose,world};
  }
  return {pose};
}
