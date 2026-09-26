import { useEffect, useRef, useState } from 'react';
import type { Assessment } from '../pose/types';
import { validationRecord } from '../pose/validation';
import { BRAND } from '../config';

// Closing debug mode also stops these local validation logs
export default function ValidationPanel({assessment,exercise,view,source}:{assessment:Assessment;exercise:string;view:string;source:string}) {
  const [enabled,setEnabled]=useState(false);
  const last=useRef({at:-Infinity,start:0,signature:''});
  useEffect(()=>{
    if(!enabled)return;
    const now=performance.now();
    const record=validationRecord(assessment,exercise,view,source,now-last.current.start);
    const signature=JSON.stringify([record.state,record.coachingEnabled,record.scoringEnabled,record.issues.map(i=>i.type),record.confidence.viewValid]);
    if(now-last.current.at<500 && signature===last.current.signature)return;
    console.info(`[${BRAND.name} validation]`,record);
    last.current.at=now;last.current.signature=signature;
  },[assessment,enabled,exercise,view,source]);
  return <details><summary>Local validation</summary>
    <p>Derived measurements only. Logs appear in the browser console; no video or pose coordinates are recorded or uploaded.</p>
    <button className="secondary-button" onClick={()=>{last.current={at:-Infinity,start:performance.now(),signature:''};setEnabled(v=>!v);}}>{enabled?'Stop validation logging':'Start validation logging'}</button>
  </details>;
}
