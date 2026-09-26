import { useEffect, useRef } from 'react';
import type { ExerciseId } from '../config';
import { demoPose } from '../pose/demo';
import { drawPose } from '../pose/draw';

export default function MotionDiagram({exercise,large=false}:{exercise:ExerciseId;large?:boolean}) {
  const ref=useRef<HTMLCanvasElement>(null);
  useEffect(()=>{
    let frame=0;
    const reduce=window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const draw=(time:number)=>{
      const canvas=ref.current;if(!canvas)return;
      const ctx=canvas.getContext('2d');if(!ctx)return;
      canvas.width=720;canvas.height=600;
      ctx.clearRect(0,0,720,600);
      // A movement diagram, using the same synthetic landmarks as the demo.
      const pose=demoPose(exercise,reduce?1.7:time/1000+1.2,false);
      if(exercise==='plank') {
        // Draw the floor in the same coordinate system as the contact landmarks,
        // so responsive canvas scaling cannot leave hands floating above it.
        const floor=pose[15].y*600;
        ctx.beginPath();ctx.moveTo(720*.14,floor);ctx.lineTo(720*.94,floor);
        ctx.strokeStyle='#a5b99b99';ctx.lineWidth=2;ctx.stroke();
        // Preview-only head placement: extend the spine toward the crown.
        const shoulder={x:(pose[11].x+pose[12].x)/2,y:(pose[11].y+pose[12].y)/2};
        const dx=(pose[27].x-pose[11].x)*720,dy=(pose[27].y-pose[11].y)*600;
        const length=Math.hypot(dx,dy);
        pose[0]={...pose[0],x:shoulder.x-dx/length*48/720,y:shoulder.y-dy/length*48/600};
      }
      drawPose(ctx,pose,720,600,undefined,time,true);
      if(!reduce)frame=requestAnimationFrame(draw);
    };
    frame=requestAnimationFrame(draw);return()=>cancelAnimationFrame(frame);
  },[exercise]);
  return <div className={`motion-diagram ${large?'large':''}`}><div className="diagram-grid"/>{exercise!=='plank' && <div className="ground-line"/>}<canvas ref={ref} aria-label={`Animated ${exercise} movement demonstration`} role="img"/><span className="diagram-axis">{exercise==='curl'?'FRONT VIEW':'SIDE VIEW'}</span><span className="tracking-point">●</span></div>;
}
