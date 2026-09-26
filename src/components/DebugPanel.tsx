import { useState } from 'react';
import type { Assessment } from '../pose/types';
import { EXERCISES, FRONT_SQUAT, VIEW, FEEDBACK, TRACKING } from '../config';
import ValidationPanel from './ValidationPanel';

export default function DebugPanel({ assessment: a, source, cameraStatus, demoStart, retry, exercise, view }: {
  exercise: string; view: string;
  assessment: Assessment; source: 'camera' | 'demo'; cameraStatus: string;
  demoStart: () => void; retry: () => void;
}) {
  const [threshold,setThreshold]=useState(FEEDBACK.qualityRepThreshold);
  return <aside className="debug-panel" aria-label="Developer pose diagnostics">
    <div className="debug-title"><h2>Developer diagnostics</h2><span>D to hide · {source === 'camera' ? 'REAL CAMERA' : 'SYNTHETIC DEMO'}</span></div>
    <label>Quality Rep threshold <input type="number" min="0" max="100" step="1" value={threshold} onChange={event=>{const n=event.target.valueAsNumber;if(Number.isFinite(n)){FEEDBACK.qualityRepThreshold=Math.max(0,Math.min(100,n));setThreshold(FEEDBACK.qualityRepThreshold);}}}/></label>
    <dl className="debug-summary">
      {exercise==='squat'&&<><dt>Squat cycle / block reason</dt><dd>{a.debug.squatCycle?.state??a.debug.squat?.state??'FRAME_INVALID'} / {a.debug.squatCycle?.blockReason??'Tracking/view confidence lost'}</dd><dt>Last failed squat cycle</dt><dd>{a.debug.squatCycle?.lastFailure??'None recorded'}</dd><dt>Squat cycle evidence</dt><dd><pre>{JSON.stringify(a.debug.squatCycle??a.debug.squat?.cycle??{},null,2)}</pre></dd></>}
      {exercise==='curl'&&<><dt>Curl cycle / block reason</dt><dd>{a.debug.curlCycle?.state??'FRAME_INVALID'} / {a.debug.curlCycle?.blockReason??'Tracking/view confidence lost'}</dd><dt>Last failed curl cycle</dt><dd>{a.debug.curlCycle?.lastFailure??'None recorded'}</dd><dt>Curl cycle evidence</dt><dd><pre>{JSON.stringify(a.debug.curlCycle??{},null,2)}</pre></dd></>}
      <dt>Completed cycles / Quality Reps</dt><dd>{a.debug.completedCycles??0} / {a.reps}</dd>
      <dt>Brief tracking gap</dt><dd>{a.debug.trackingGapMs===undefined?'None':`${Math.round(a.debug.trackingGapMs)} ms; rep evidence paused`}</dd>
      <dt>Last completed rep quality</dt><dd>{a.debug.lastRepScore?.toFixed(1)??'Unavailable'}</dd>
      <dt>Plank hold duration</dt><dd>{((a.holdMs??0)/1000).toFixed(1)} s</dd>
      <dt>Camera</dt><dd>{cameraStatus}</dd>
      <dt>Visual coaching / scoring</dt><dd>{String(a.debug.coachingEnabled??false)} / {String(a.debug.scoringEnabled??false)}</dd>
      <dt>Score last updated</dt><dd>{a.debug.scoreUpdatedAt?.toFixed(0)??'Unavailable'}</dd>
      <dt>Exercise / view</dt><dd>{a.debug.exercise} / {a.debug.view}</dd>
      <dt>Exercise state</dt><dd>{a.debug.state ?? 'FRAME_INVALID'}</dd>
      <dt>Selected view confirmed</dt><dd>{String(a.debug.viewValid ?? false)}</dd>
      <dt>Raw image angles</dt><dd><pre>{JSON.stringify(a.debug.rawAngles ?? {}, null, 2)}</pre></dd>
      <dt>All corrections</dt><dd>{a.corrections?.map(c=>c.id).join(', ') || 'None'}</dd>
      <dt>Phase</dt><dd>{a.phase}</dd>
      <dt>Movement valid</dt><dd>{String(a.debug.validMovement)}</dd>
      <dt>Reason</dt><dd>{a.debug.reason}</dd>
      <dt>Raw / smoothed score</dt><dd>{a.debug.rawScore?.toFixed(1) ?? '—'} / {a.score ?? '—'}</dd>
      <dt>Accepted frames</dt><dd>{a.debug.stableFrames}</dd>
      <dt>Correction</dt><dd>{a.correction?.id ?? 'None'}</dd>
      {a.debug.squat && <>
        <dt>Squat state</dt><dd>{a.debug.squat.state}</dd>
        <dt>Geometry source</dt><dd>{a.debug.squat.source ?? 'Unavailable'}</dd>
        <dt>Upright baseline</dt><dd>{a.debug.squat.baselineDetected ? 'Detected' : 'Not detected'}</dd>
        <dt>Side-on</dt><dd>{String(a.debug.squat.sideOn)}</dd>
        <dt>Shoulder / hip spread</dt><dd>{a.debug.squat.shoulderRatio?.toFixed(3) ?? '—'} / {a.debug.squat.hipRatio?.toFixed(3) ?? '—'}</dd>
        <dt>Tracking reliable</dt><dd>{String(a.debug.squat.trackingReliable)}</dd>
        <dt>Filtered landmark confidence</dt><dd>{a.debug.squat.landmarkConfidence.toFixed(3)}</dd>
        <dt>Hold confirmation</dt><dd>{Math.round(a.debug.squat.holdConfirmationMs)} ms</dd>
        <dt>Last hold evaluation</dt><dd>{a.debug.squat.evaluatedAt?.toFixed(0) ?? 'Not evaluated'}</dd>
        <dt>Active corrections</dt><dd>{a.debug.squat.activeCorrections.join(', ') || 'None'}</dd>
        <dt>Heel lift / leg length</dt><dd>{a.debug.squat.heelLift?.lift?.toFixed(3) ?? 'Unavailable'}</dd>
        <dt>Heel tracking</dt><dd>{a.debug.squat.heelLift?.reason ?? 'Unavailable'}</dd>
        <dt>Standing foot baseline</dt><dd><pre>{JSON.stringify(a.debug.squat.heelLift?.baseline ?? null, null, 2)}</pre></dd>
        <dt>Standing baseline</dt><dd><pre>{JSON.stringify(a.debug.squat.baseline, null, 2)}</pre></dd>
        <dt>Left / right knee</dt><dd>{a.debug.squat.leftKneeAngle?.toFixed(1) ?? '—'}° / {a.debug.squat.rightKneeAngle?.toFixed(1) ?? '—'}°</dd>
        <dt>Visible foot points</dt><dd>{a.debug.squat.footPoints} / 6</dd>
        <dt>Knee / hip angle</dt><dd>{a.debug.squat.kneeAngle?.toFixed(1) ?? '—'}° / {a.debug.squat.hipAngle?.toFixed(1) ?? '—'}°</dd>
        <dt>Torso tilt</dt><dd>{a.debug.squat.torsoTilt?.toFixed(1) ?? '—'}°</dd>
        <dt>Hip drop / leg length</dt><dd>{a.debug.squat.hipDrop?.toFixed(3) ?? '—'}</dd>
        <dt>Hip speed (legs/s)</dt><dd>{a.debug.squat.hipVelocity?.toFixed(3) ?? '—'}</dd>
        <dt>Knee speed (deg/s)</dt><dd>{a.debug.squat.kneeVelocity?.toFixed(1) ?? '—'}</dd>
        <dt>Squat score status</dt><dd>{a.debug.squat.reason}</dd>
      </>}
    </dl>
<details><summary>Thresholds: src/config.ts</summary><pre>{JSON.stringify({exercises:EXERCISES,frontSquat:FRONT_SQUAT,views:VIEW,feedback:FEEDBACK,tracking:TRACKING}, null, 2)}</pre></details>
    <ValidationPanel assessment={a} exercise={exercise} view={view} source={source}/>
    <div className="debug-tables">
      <table><caption>Landmark confidence · * required for framing</caption><thead><tr><th>Landmark</th><th>Visibility</th><th>In frame</th></tr></thead><tbody>{a.debug.landmarks.map(p => <tr key={p.index}><td>{p.name}{p.required ? ' *' : ''}</td><td>{p.visibility.toFixed(2)}</td><td>{p.inFrame ? 'Yes' : 'No'}</td></tr>)}</tbody></table>
      <div><table><caption>Joint angles · degrees</caption><thead><tr><th>Measurement</th><th>Value</th></tr></thead><tbody>{Object.entries(a.debug.angles).map(([name, value]) => <tr key={name}><td>{name}</td><td>{value.toFixed(1)}</td></tr>)}</tbody></table>
        <table><caption>Pose-derived score components</caption><thead><tr><th>Metric</th><th>Value / limit</th><th>Score</th></tr></thead><tbody>{a.debug.components.map(c => <tr key={c.id}><td>{c.id}</td><td>{c.value?.toFixed(2) ?? 'Unavailable'} / {c.limit}</td><td>{c.score?.toFixed(1) ?? '—'}</td></tr>)}</tbody></table></div>
    </div>
    <div className="debug-actions"><button className="secondary-button" onClick={source === 'camera' ? demoStart : retry}>{source === 'camera' ? 'Switch to synthetic demo' : 'Switch to real camera'}</button><small>Experimental thresholds, not medical standards.</small></div>
  </aside>;
}
