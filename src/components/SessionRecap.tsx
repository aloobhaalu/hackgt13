import type { RecapDiagnostics } from '../recap/diagnostics';
import { useEffect, useRef } from 'react';
import type { SessionSummary } from '../recap/summary';
import { holdTime } from '../pose/scoreDisplay';
import type { Recap } from '../recap/content';
import RecapPayload from './RecapPayload';

export default function SessionRecap({summary,recap,debug,done,diagnostics}:{summary:SessionSummary;recap:Recap|null;debug:boolean;done:()=>void;diagnostics?:RecapDiagnostics}) {
  const dialog=useRef<HTMLElement>(null),button=useRef<HTMLButtonElement>(null);
  const empty=summary.exercise==='plank'?summary.totalHoldMs===0:summary.validScoreSamples===0;
  useEffect(()=>{
    const previousOverflow=document.body.style.overflow;
    document.body.style.overflow='hidden';button.current?.focus();
    return ()=>{document.body.style.overflow=previousOverflow;};
  },[]);
  return <div className="recap-backdrop">
    <section className="session-recap" role="dialog" aria-modal="true" aria-labelledby="recap-title" ref={dialog} onKeyDown={event=>{
      if(event.key==='Escape'){event.stopPropagation();done();}
      if(event.key==='Tab') {
        const items=Array.from(dialog.current!.querySelectorAll<HTMLElement>('button,[tabindex="0"]'));
        const index=items.indexOf(document.activeElement as HTMLElement);
        event.preventDefault();items[(index+(event.shiftKey?-1:1)+items.length)%items.length]?.focus();
      }
    }}>
      <div aria-live="polite" aria-busy={!recap}>
        <h2 id="recap-title">{recap?.headline??'Preparing recap\u2026'}</h2>
        {recap&&recap.tips.length>0&&<ul>{recap.tips.map(tip=><li key={tip}>{tip}</li>)}</ul>}
      </div>
      {summary.exercise==='plank'&&<div className={`recap-totals${empty?' is-empty':''}`}>
        <span><strong>{holdTime(summary.bestHoldMs)}</strong> Best Hold</span><span><strong>{holdTime(summary.totalHoldMs)}</strong> Total Hold Time</span>
      </div>}
      {debug&&<RecapPayload summary={summary} diagnostics={diagnostics} ended/>}
      <button className="primary-button recap-done" onClick={done} ref={button}>Done</button>
    </section>
  </div>;
}
