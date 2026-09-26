import type { CameraView, ExerciseId } from '../config';
import type { Assessment, Point, Pose } from './types';
import { curlFacing, curlWrist } from './curlVisual';

/** References use measured segments and current anchors, never a screen template. */
export function referenceVisual(p: Pose, id: ExerciseId, view: CameraView, a: Assessment, aspect: number): NonNullable<Assessment['squatVisual']> {
  const framing=!p.length || a.debug.landmarks.some(l=>l.required&&(!l.inFrame||l.visibility<0.45));
  const reference: Pose[]=[];
  const paths: Point[][]=[];
  const length=(i:number,j:number)=>Math.hypot((p[i].x-p[j].x)*aspect,p[i].y-p[j].y);
  if(!framing && !a.debug.validMovement && !a.debug.coachingEnabled) {
    for(const flex of id==='plank'?[0]:[0,1,0]) {
      const ghost=p.map(v=>({...v,visibility:0}));
      for(const s of [0,1]) {
        const sh=11+s,h=23+s,k=25+s,an=27+s,e=13+s,w=15+s;
        if([sh,h,...(id==='curl'?[e,w]:[k,an])].some(i=>p[i]?.visibility<0.45))continue;
        if(id==='curl') {
          const upper=length(sh,e),lower=length(e,w),sign=view==='front'?(s===0?1:-1):curlFacing(p);
          ghost[sh]={...p[sh],visibility:1};ghost[h]={...p[h],visibility:1};
          ghost[e]={...p[e],x:p[sh].x,y:p[sh].y+upper,visibility:1};
          ghost[w]={...curlWrist(ghost[e],lower,flex,view,sign,aspect),visibility:1};
          if(reference.length===0) paths.push(Array.from({length:25},(_,i)=>curlWrist(ghost[e],lower,i/24,view,sign,aspect)));
        } else if(id==='squat') {
          const shin=length(k,an),thigh=length(h,k),torso=length(sh,h);
          ghost[an]={...p[an],visibility:1};
          ghost[k]={...p[k],x:p[an].x,y:p[an].y-shin*(1-flex*0.12),visibility:1};
          ghost[h]={...p[h],y:ghost[k].y-thigh*(1-flex*0.45),visibility:1};
          ghost[sh]={...p[sh],y:ghost[h].y-torso,visibility:1};
        } else {
          const body=length(sh,h)+length(h,k)+length(k,an),sign=Math.sign(p[an].x-p[sh].x)||1;
          ghost[an]={...p[an],visibility:1};
          ghost[sh]={...p[sh],x:view==='side'?p[an].x-sign*body*.9/aspect:p[sh].x,y:p[an].y-body*.35,visibility:1};
          for(const [i,t] of [[h,length(sh,h)/body],[k,(length(sh,h)+length(h,k))/body]])ghost[i]={...p[i],x:ghost[sh].x+(p[an].x-ghost[sh].x)*t,y:ghost[sh].y+(p[an].y-ghost[sh].y)*t,visibility:1};
          ghost[w]={...p[w],x:ghost[sh].x,y:ghost[sh].y+length(sh,e)+length(e,w),visibility:1};
          ghost[e]={...p[e],x:ghost[sh].x,y:(ghost[sh].y+ghost[w].y)/2,visibility:1};
        }
      }
      reference.push(ghost);
    }
  }
  return {reference,recovery:[],recoveryPose:[],framing,pathJoint:id==='curl'?15:23,paths:id==='curl'?paths:undefined};
}
