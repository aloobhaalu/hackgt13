import {demoPose} from './demo';
import type {CameraView} from '../config';
import type {Pose} from './types';

// Independent articulated exercise motion; a static template fills unused landmarks.
function frame(flex:number,view:CameraView,hipShift=0,raise=0,scale=1) {
  const p:Pose=demoPose('curl',0,false);
  for(const side of [0,1]) {
    const x=view==='front'?.39+side*.22:.48+side*.025,sign=side===0?-1:1;
    p[11+side]={x,y:.24,z:0,visibility:.99};p[23+side]={x:x+hipShift,y:.51,z:0,visibility:.99};
    const abduction=raise*Math.PI/180;
    p[13+side]={x:x+sign*.19*Math.sin(abduction),y:.24+.19*Math.cos(abduction),z:0,visibility:.99};
    const r=(5+140*flex)*Math.PI/180,forward=.16*Math.sin(r),e=p[13+side];
    p[15+side]={x:e.x+(view==='front'?-sign*.08*forward:forward),y:e.y+.16*Math.cos(r),z:view==='front'?-forward*Math.sqrt(1-.08**2):0,visibility:.99};
  }
  p[0]={x:view==='side'?.56:.5,y:.15,z:0,visibility:.99};p[7]={x:.51,y:.15,z:0,visibility:.99};p[8]={x:.515,y:.15,z:0,visibility:.99};
  for(const i of [25,26,27,28,29,30,31,32])p[i].visibility=0;
  const pose=p.map(p=>({...p,x:.1+p.x*scale*.8,y:.08+p.y*scale*.8,z:(p.z??0)*scale*.8}));
  return {pose,world:pose.map(p=>({...p}))};
}
function frontSquat(ms:number,bad=false):{p:Pose;world:Pose} {
  const p=demoPose('curl',0,false),flex=ms<2700?0:ms<4300?(ms-2700)/1600:ms<6800?1:ms<8500?1-(ms-6800)/1700:0;
  for(const s of [0,1]) {
    p[11+s]={x:.4+s*.2,y:.2+flex*.16,visibility:.99};
    p[23+s]={x:.44+s*.12,y:.45+flex*.16,visibility:.99};
    p[25+s]={x:.42+s*.16+(bad&&s===0?.09*flex:0),y:.68+flex*.03,visibility:.99};
    p[27+s]={x:.4+s*.2,y:.9,visibility:.99};
    p[29+s]={x:p[27+s].x,y:.89,visibility:.99};
    p[31+s]={x:p[27+s].x+(s===0?-1:1)*.05*Math.sin(Math.PI/9),y:.89+.05*Math.cos(Math.PI/9),visibility:.99};
  }
  const world=p.map(v=>({...v,z:0}));for(const i of [25,26])world[i].z=-flex*.2;
  return {p,world};
}
function squatPose(flex: number, tilt = 2 + flex * 20): Pose {
  const p = demoPose('squat', 0, false);
  const rad = Math.PI / 180;
  for (const s of [0, 1]) {
    const x = 0.54 + s * 0.025;
    p[27 + s] = { x, y: 0.9, visibility: 0.99 };
    p[25 + s] = { x: x + 0.24 * Math.sin(25 * flex * rad), y: 0.9 - 0.24 * Math.cos(25 * flex * rad), visibility: 0.99 };
    p[23 + s] = { x: p[25 + s].x - 0.24 * Math.sin(80 * flex * rad), y: p[25 + s].y - 0.24 * Math.cos(80 * flex * rad), visibility: 0.99 };
    p[11 + s] = { x: p[23 + s].x + 0.25 * Math.sin(tilt * rad), y: p[23 + s].y - 0.25 * Math.cos(tilt * rad), visibility: 0.99 };
  }
  return p;
}

export function repFrame(exercise:'squat'|'curl',view:CameraView,flex:number,aspect=16/9) {
 let pose:Pose,world:Pose;
 if(exercise==='curl')({pose,world}=frame(flex*.75,view));
 else if(view==='front')({p:pose,world}=frontSquat(2700+1600*flex));
 else {pose=squatPose(flex);world=pose.map(p=>({...p,z:0}));}
 const hip={x:(world[23].x+world[24].x)/2,y:(world[23].y+world[24].y)/2};
 world=world.map(p=>({...p,x:p.x-hip.x,y:p.y-hip.y}));
 pose=pose.map(p=>({...p,x:.5+(p.x-.5)/aspect}));
 return {pose,world};
}
export const repMotion=(t:number,cycles=2)=>t<4000||t>=4000+cycles*3000?0:(1-Math.cos(2*Math.PI*((t-4000)%3000)/3000))/2;
