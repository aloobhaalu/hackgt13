import { useEffect, useRef } from 'react';
import { EXERCISES, type CameraView, type ExerciseId } from '../config';

export function Placement({exercise,view}:{exercise:ExerciseId;view:CameraView}) {
  return <svg className="placement-figure" viewBox="0 0 160 150" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" aria-hidden="true">
    <path className="placement-corners" d="M12 32V12H32M128 12H148V32M12 118V138H32M128 138H148V118"/>
    {exercise==='plank' && view==='side' ? <><circle cx="35" cy="49" r="8"/><path d="M40 62L125 108L135 128M40 62V125M40 125H30"/></> : view==='front' ? <><circle cx="80" cy="30" r="9"/><path d={exercise==='curl'?'M62 48H98M62 48L58 75L60 98M98 48L102 75L100 98M68 48L69 110H91L92 48':'M62 48H98M62 48L54 88M98 48L106 88M68 48L70 84H90L92 48M70 84L60 125M90 84L100 125'}/></> : <><circle cx="79" cy="30" r="9"/><path d={exercise==='curl'?'M78 45L75 103M78 49L86 76L88 100M69 103H84':'M78 45L75 84L87 106L82 128M78 49L88 75L91 91M75 84L67 107L68 128'}/></>}
  </svg>;
}

export default function ViewPicker({exercise,choose,close}:{exercise:ExerciseId;choose:(view:CameraView)=>void;close:()=>void}) {
  const ref=useRef<HTMLDivElement>(null);
  const recommended=EXERCISES[exercise].recommendedView;
  const views: CameraView[]=[recommended,recommended==='side'?'front':'side'];
  useEffect(()=>{
    const previous=document.activeElement as HTMLElement|null;
    ref.current?.querySelector('button')?.focus();
    return ()=>previous?.focus();
  },[]);
  return <div className="view-backdrop" onClick={e=>{if(e.target===e.currentTarget)close();}}>
    <div className="view-picker" role="dialog" aria-modal="true" aria-labelledby="view-title" ref={ref} onKeyDown={e=>{
      if(e.key==='Escape'){e.stopPropagation();close();}
      if(e.key==='Tab') {
        const buttons=Array.from(ref.current!.querySelectorAll('button')),index=buttons.indexOf(document.activeElement as HTMLButtonElement);
        e.preventDefault();buttons[(index+(e.shiftKey?-1:1)+buttons.length)%buttons.length]?.focus();
      }
    }}>
      <h2 id="view-title">{EXERCISES[exercise].short}</h2>
      <div className="view-options">{views.map(view=><button key={view} className="view-choice" onClick={()=>choose(view)} aria-label={`${view==='side'?'Side':'Front'} View`}>
        <Placement exercise={exercise} view={view}/><strong>{view==='side'?'Side':'Front'} View</strong><small>{view===recommended?'Recommended':'Alternate view'}</small>
      </button>)}</div>
      <p className="view-note">Visual form awareness · camera stays on your device</p>
      <button className="view-close" onClick={close} aria-label="Close view selection">×</button>
    </div>
  </div>;
}
