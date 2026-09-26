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
      drawPose(ctx,pose,720,600,undefined,time,true);
      if(!reduce)frame=requestAnimationFrame(draw);
    };
    frame=requestAnimationFrame(draw);return()=>cancelAnimationFrame(frame);
  },[exercise]);
  return <div className={`motion-diagram ${large?'large':''}`}><div className="diagram-grid"/><div className="ground-line"/><canvas ref={ref} aria-label={`Animated ${exercise} movement demonstration`} role="img"/><span className="diagram-axis">{exercise==='curl'?'FRONT VIEW':'SIDE VIEW'}</span><span className="tracking-point">●</span></div>;
}
