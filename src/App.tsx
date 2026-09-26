import { useEffect, useRef, useState } from 'react';
import { Activity, ArrowLeft, ArrowUpRight, Camera, Check, Focus, LockKeyhole, Pause, Play, RotateCcw, Square, VideoOff } from 'lucide-react';
import { BRAND, EXERCISES, type ExerciseId } from './config';
import { requestCamera, type CameraRequest, type SessionSource } from './camera';
import MotionDiagram from './components/MotionDiagram';
import DebugPanel from './components/DebugPanel';
import { useCoach } from './useCoach';

type Screen = { type: 'home' } | { type: 'session'; exercise: ExerciseId; source: SessionSource; key: number };
const ids = Object.keys(EXERCISES) as ExerciseId[];

export default function App() {
  const [screen, setScreen] = useState<Screen>({ type: 'home' });
  const [debug, setDebug] = useState(() => new URLSearchParams(window.location.search).get('debug') === '1');
  const camera = useRef<CameraRequest | null>(null), sequence = useRef(0);
  const heading = useRef<HTMLElement>(null);
  useEffect(() => {
    const toggle = (event: KeyboardEvent) => {
      if (event.key.toLowerCase() !== 'd' || event.repeat || event.altKey || event.ctrlKey || event.metaKey) return;
      if (event.target instanceof HTMLElement && (event.target.isContentEditable || /INPUT|TEXTAREA|SELECT/.test(event.target.tagName))) return;
      setDebug(value => !value);
    };
    const leave = () => camera.current?.dispose();
    window.addEventListener('keydown', toggle); window.addEventListener('pagehide', leave);
    return () => { window.removeEventListener('keydown', toggle); window.removeEventListener('pagehide', leave); };
  }, []);
  useEffect(() => { heading.current?.focus(); window.scrollTo(0, 0); }, [screen.type]);

  const start = (exercise: ExerciseId, demo = false) => {
    camera.current?.dispose();
    // This call is intentionally inside the click handler, not in an effect or after model loading.
    const source: SessionSource = demo ? { kind: 'demo' } : { kind: 'camera', camera: requestCamera() };
    camera.current = source.kind === 'camera' ? source.camera : null;
    setScreen({ type: 'session', exercise, source, key: ++sequence.current });
  };
  const home = () => { camera.current?.dispose(); camera.current = null; setScreen({ type: 'home' }); };

  return <div className="app-shell minimal-flow">
    <header className="site-header">
      <button className="brand" onClick={home} aria-label="FormFlow home"><span className="brand-icon"><Activity size={23}/></span>{BRAND.name}</button>
    </header>
    <main ref={heading} tabIndex={-1}>
      {screen.type === 'home' ? <>
        <section className="intro"><h1>See your form.<br/><span>Find your flow.</span></h1></section>
        <div className="exercise-grid" aria-label="Choose an exercise">
          {ids.map((id, i) => <button key={id} className={`exercise-card exercise-${id}`} onClick={() => start(id)} aria-label={`Start ${EXERCISES[id].name}`}>
            <div className="card-top"><span className="card-category">{EXERCISES[id].angle}</span><span className="card-number">0{i + 1}</span></div>
            <MotionDiagram exercise={id}/>
            <div className="card-content"><div className="card-title"><h2>{EXERCISES[id].short}</h2><span className="card-arrow"><ArrowUpRight size={21}/></span></div></div>
          </button>)}
        </div>
        {debug && <aside className="debug-home"><strong>Developer mode</strong><span>Select a card for camera testing, or use an explicit synthetic source:</span>{ids.map(id => <button key={id} className="secondary-button" onClick={() => start(id, true)}>Demo: {EXERCISES[id].short}</button>)}</aside>}
      </> : <Session key={screen.key} exercise={screen.exercise} source={screen.source} debug={debug} end={home} retry={() => start(screen.exercise)} demoStart={() => start(screen.exercise, true)}/>}
    </main>
    <footer className="minimal-footer"><LockKeyhole size={13}/><p>Webcam processing happens locally. Video is not saved.</p></footer>
  </div>;
}

function Session({ exercise, source, debug, end, retry, demoStart }: {
  exercise: ExerciseId; source: SessionSource; debug: boolean; end: () => void; retry: () => void; demoStart: () => void;
}) {
  const { videoRef, canvasRef, status, message, hasVideo, showSetup, paused, togglePause, assessment: a } = useCoach(exercise, source);
  const demo = source.kind === 'demo';
  const cameraStatus = paused ? 'Paused' : status === 'error' ? (hasVideo ? 'Tracking unavailable' : 'Camera unavailable') : status === 'loading' ? (hasVideo ? 'Loading tracking' : 'Opening camera') : a.ready ? 'Tracking' : 'Tracking uncertain';
  return <section className="session-page camera-first">
    <div className="live-heading"><button className="back-button" onClick={end}><ArrowLeft size={16}/> Back</button><h1>{EXERCISES[exercise].name}</h1><span className="live-camera-status"><span className={a.ready && !paused ? 'connected' : ''}/>{demo ? 'Simulated demo' : cameraStatus}</span></div>
    <div className={`camera-stage ${demo ? 'demo-stage' : ''} ${paused ? 'is-paused' : ''}`}>
      <video ref={videoRef} muted playsInline className={demo ? 'hidden-video' : ''}/>
      {demo && <div className="stage-grid"/>}
      <canvas ref={canvasRef} className="pose-canvas" aria-label="White pose skeleton. Orange joint points toward a pulsing mint target when adjustment is needed."/>
      {status === 'running' && !paused && !showSetup && <>
        <div className="alignment-indicator"><span>Form Alignment</span><strong>{a.score === null ? (a.debug.squat ? (a.debug.squat.state === 'WAITING_FOR_START_POSE' ? 'Ready' : '—') : (a.ready ? 'Ready' : '—')) : `${a.score}%`}</strong></div>
        <div className="stage-bottom"><span className="rep-count"><strong>{String(a.reps).padStart(2, '0')}</strong> reps</span>{a.confirmed && <span className="correction-confirmed" aria-label={a.debug.squat?.state === 'VALID_REP' ? 'Squat completed' : 'Adjustment detected'}><Check size={19}/></span>}</div>
        {a.framingWarning && <div className="reframe-hint"><Focus size={18}/> Keep shoulders, hips, knees and ankles in view.</div>}
        {a.debug.squat?.rotateSideways && !a.framingWarning && <div className="reframe-hint" role="status"><RotateCcw size={18}/> Rotate sideways</div>}
        {a.debug.squat && !a.framingWarning && !a.debug.squat.rotateSideways && <div className="reframe-hint" role="status">{!a.debug.squat.trackingReliable ? a.debug.squat.reason : a.debug.squat.state === 'VALID_REP' ? 'Squat completed' : a.debug.squat.state === 'WAITING_FOR_START_POSE' ? (a.debug.squat.baselineDetected ? 'Ready — begin your squat' : 'Stand upright briefly to calibrate') : a.debug.squat.state === 'DESCENDING' ? 'Squat detected — lowering' : a.debug.squat.state === 'BOTTOM' ? 'Bottom detected' : a.debug.squat.state === 'ASCENDING' ? 'Squat detected — rising' : a.debug.squat.reason}</div>}
      </>}
      {showSetup && !paused && status !== 'error' && <div className="quick-setup" role="status">
        <Camera size={26}/><div className="body-frame"><svg viewBox="0 0 70 126" aria-hidden="true"><circle cx="35" cy="17" r="9"/><path d="M35 29V68M16 37H54M16 37L10 67M54 37L60 67M35 68L21 107M35 68L49 107"/></svg><span className="frame-corner tl"/><span className="frame-corner tr"/><span className="frame-corner bl"/><span className="frame-corner br"/></div><div><strong>{EXERCISES[exercise].angle}</strong><span>Shoulders to ankles in view</span></div>
      </div>}
      {status === 'loading' && !hasVideo && <div className="stage-overlay"><div className="loader"><Camera size={30}/></div><p role="status">{message}</p></div>}
      {status === 'loading' && hasVideo && !showSetup && <div className="tracking-loading" role="status">Loading pose tracking…</div>}
      {paused && status !== 'error' && <div className="pause-indicator"><Pause size={26}/><span>Paused</span></div>}
      {status === 'error' && <div className={`camera-error ${hasVideo ? 'over-video' : ''}`}><VideoOff size={27}/><p role="alert">{message}</p><button className="primary-button" onClick={retry}><RotateCcw size={16}/> Try camera again</button></div>}
      {demo && <div className="demo-watermark">SYNTHETIC POSE · NO CAMERA</div>}
    </div>
    <div className="session-controls"><div><button className="secondary-button" disabled={!hasVideo && !demo} onClick={togglePause}>{paused ? <Play size={16}/> : <Pause size={16}/>} {paused ? 'Resume' : 'Pause'}</button><button className="end-button" onClick={end}><Square size={13} fill="currentColor"/> End</button></div></div>
    {debug && <DebugPanel assessment={a} source={source.kind} cameraStatus={cameraStatus} demoStart={demoStart} retry={retry}/>}
  </section>;
}
