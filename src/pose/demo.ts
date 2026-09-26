import type { ExerciseId } from '../config';
import type { Point, Pose } from './types';
import { curlWrist } from './curlVisual';
// These are made-up demo landmarks, never recorded camera data
export function demoPose(id: ExerciseId, seconds: number, withErrors = true): Pose {
  const p: Pose=Array.from({length:33},()=>({x:0.5,y:0.5,z:0,visibility:0.98}));
  const set=(i:number,x:number,y:number)=>{p[i]={x,y,z:0,visibility:0.98};};
  // Squat demonstrations include a genuine upright hold for baseline acquisition
  const period=id==='squat'?10:5, local=seconds%period, cycle=local/period;
  const ease=(v:number)=>(1-Math.cos(Math.PI*Math.max(0,Math.min(1,v))))/2;
  const t=id==='squat'?(local<2.6?0:local<4.2?ease((local-2.6)/1.6):local<7.4?1:local<9?1-ease((local-7.4)/1.6):0):(1-Math.cos(cycle*Math.PI*2))/2;
  const error=withErrors && Math.floor(seconds/period)%3===1 ? (id==='squat'?t:Math.sin(cycle*Math.PI)**2) : 0;
  if(id==='squat') {
    for(const side of [0,1]){
      const o=side*0.035;
      set(27+side,.54+o,.87);set(25+side,.53+o+t*.10,.64+t*.025);set(23+side,.53+o-t*.13,.42+t*.23);
      set(11+side,p[23+side].x+.015+t*.09+error*.18,p[23+side].y-.255+error*.07);
      set(13+side,p[11+side].x+.10+t*.06,p[11+side].y+.11-t*.08);set(15+side,p[13+side].x+.08,p[13+side].y+.1-t*.12);
    }
  } else if(id==='curl') {
    for(const side of [0,1]){
      const sign=side===0?-1:1, sway=error*.09;
      set(27+side,.5+sign*.10,.88);set(25+side,.5+sign*.085,.68);set(23+side,.5+sign*.065,.49);
      set(11+side,.5+sign*.105+sway,.255);set(13+side,.5+sign*(.105+error*.075)+sway,.445);
      p[15+side]=curlWrist(p[13+side],.165,t,'front',-sign);
    }
  } else {
    // Held high plank: hands and toes support a stable shoulder-to-ankle line
    for(const side of [0,1]) {
      const o=side*.022;
      set(11+side,.27+o,.38);set(13+side,.27+o,.5425);set(15+side,.27+o,.705);
      set(23+side,.49+o,.5022+error*.07);set(25+side,.65+o,.5911);set(27+side,.81+o,.68);
    }
  }
  const head:Point={x:(p[11].x+p[12].x)/2,y:(p[11].y+p[12].y)/2-.095,visibility:.98};
  for(let i=0;i<11;i++) p[i]={...head,x:head.x+(i%2===0?.013:-.013),y:head.y+(i===7||i===8?.015:0)};
  for(const s of [0,1]){set(29+s,p[27+s].x-.02,p[27+s].y+.015);set(31+s,p[27+s].x+.055,p[27+s].y+.025);}
  return p;
}
