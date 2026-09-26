import type { Assessment } from '../pose/types';

export default function DebugPanel({ assessment: a, source, cameraStatus, demoStart, retry }: {
  assessment: Assessment; source: 'camera' | 'demo'; cameraStatus: string;
  demoStart: () => void; retry: () => void;
}) {
  return <aside className="debug-panel" aria-label="Developer pose diagnostics">
    <div className="debug-title"><h2>Developer diagnostics</h2><span>D to hide · {source === 'camera' ? 'REAL CAMERA' : 'SYNTHETIC DEMO'}</span></div>
    <dl className="debug-summary">
      <dt>Camera</dt><dd>{cameraStatus}</dd>
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
    <div className="debug-tables">
      <table><caption>Landmark confidence · * required for framing</caption><thead><tr><th>Landmark</th><th>Visibility</th><th>In frame</th></tr></thead><tbody>{a.debug.landmarks.map(p => <tr key={p.index}><td>{p.name}{p.required ? ' *' : ''}</td><td>{p.visibility.toFixed(2)}</td><td>{p.inFrame ? 'Yes' : 'No'}</td></tr>)}</tbody></table>
      <div><table><caption>Joint angles · degrees</caption><thead><tr><th>Measurement</th><th>Value</th></tr></thead><tbody>{Object.entries(a.debug.angles).map(([name, value]) => <tr key={name}><td>{name}</td><td>{value.toFixed(1)}</td></tr>)}</tbody></table>
        <table><caption>Pose-derived score components</caption><thead><tr><th>Metric</th><th>Value / limit</th><th>Score</th></tr></thead><tbody>{a.debug.components.map(c => <tr key={c.id}><td>{c.id}</td><td>{c.value?.toFixed(2) ?? 'Unavailable'} / {c.limit}</td><td>{c.score?.toFixed(1) ?? '—'}</td></tr>)}</tbody></table></div>
    </div>
    <div className="debug-actions"><button className="secondary-button" onClick={source === 'camera' ? demoStart : retry}>{source === 'camera' ? 'Switch to synthetic demo' : 'Switch to real camera'}</button><small>Experimental thresholds, not medical standards.</small></div>
  </aside>;
}
