import { FRONT_SQUAT as F } from '../config';
import type { Pose } from './types';

/** Conservative projected foot direction, not a measurement of anatomical toe angle. */
export function frontFoot(p: Pose, side: number, leg: number, imageWidth: number) {
  const ankle=27+side,heel=29+side,toe=31+side;
  if(![ankle,heel,toe].every(i=>p[i] && p[i].visibility>=F.toeVisibility && Number.isFinite(p[i].x) && Number.isFinite(p[i].y) && p[i].x>=0 && p[i].x<=imageWidth && p[i].y>=0 && p[i].y<=1)) return null;
  const dx=p[toe].x-p[heel].x,dy=p[toe].y-p[heel].y,length=Math.hypot(dx,dy);
  if(leg<=0 || length/leg<F.toeLengthMin || length/leg>F.toeLengthMax || dy/leg<F.toeForwardMin)return null;
  const center=(p[27].x+p[28].x)/2,outward=Math.sign(p[ankle].x-center);
  if(!outward)return null;
  const angle=Math.atan2(dx*outward,dy)*180/Math.PI;
  const targetAngle=F.toeOutTarget*Math.PI/180;
  return {angle,heel,toe,ankle,dx,
    target:{...p[toe],x:p[heel].x+outward*Math.sin(targetAngle)*length,y:p[heel].y+Math.cos(targetAngle)*length}};
}
