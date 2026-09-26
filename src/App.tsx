import { alignmentText, holdTime } from './pose/scoreDisplay';
import { useEffect, useRef, useState } from 'react';
import { Activity, ArrowLeft, ArrowUpRight, Camera, LockKeyhole, Pause, Play, RotateCcw, Square, VideoOff } from 'lucide-react';
import { BRAND, EXERCISES, type CameraView, type ExerciseId } from './config';
import { requestCamera, type CameraRequest, type SessionSource } from './camera';
import MotionDiagram from './components/MotionDiagram';
import TargetGuide from './components/TargetGuide';
import ViewPicker from './components/ViewPicker';
import DebugPanel from './components/DebugPanel';
import { useCoach } from './useCoach';

type Screen = { type: 'home' } | { type: 'session'; exercise: ExerciseId; view: CameraView; source: SessionSource; key: number };
const ids = Object.keys(EXERCISES) as ExerciseId[];

export default function App() {
  const [choosing, setChoosing] = useState<ExerciseId | null>(null);
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

  const start = (exercise: ExerciseId, view: CameraView = EXERCISES[exercise].recommendedView, demo = false) => {
    setChoosing(null);
    camera.current?.dispose();
    // This call is intentionally inside the click handler, not in an effect or after model loading.
    const source: SessionSource = demo ? { kind: 'demo' } : { kind: 'camera', camera: requestCamera() };
    camera.current = source.kind === 'camera' ? source.camera : null;
    setScreen({ type: 'session', exercise, view, source, key: ++sequence.current });
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
          {ids.map((id, i) => <button key={id} className={`exercise-card exercise-${id}`} onClick={() => setChoosing(id)} aria-label={`Start ${EXERCISES[id].name}`}>
            <div className="card-top"><span className="card-category">{EXERCISES[id].angle}</span><span className="card-number">0{i + 1}</span></div>
            <MotionDiagram exercise={id}/>
            <div className="card-content"><div className="card-title"><h2>{EXERCISES[id].short}</h2><span className="card-arrow"><ArrowUpRight size={21}/></span></div></div>
          </button>)}
        </div>
        {debug && <aside className="debug-home"><strong>Developer mode</strong><span>Select a card for camera testing, or use an explicit synthetic source:</span>{ids.map(id => <button key={id} className="secondary-button" onClick={() => start(id, EXERCISES[id].recommendedView, true)}>Demo: {EXERCISES[id].short}</button>)}</aside>}
      </> : <Session key={screen.key} exercise={screen.exercise} view={screen.view} source={screen.source} debug={debug} end={home} retry={() => start(screen.exercise, screen.view)} demoStart={() => start(screen.exercise, screen.view, true)}/>}
    </main>
    {choosing && <ViewPicker exercise={choosing} choose={view => start(choosing, view)} close={() => setChoosing(null)}/>}
    <footer className="minimal-footer"><LockKeyhole size={13}/><p>Webcam processing happens locally. Video and pose data are not saved.</p></footer>
  </div>;
}

function Session({ exercise, view, source, debug, end, retry, demoStart }: {
  exercise: ExerciseId; view: CameraView; source: SessionSource; debug: boolean; end: () => void; retry: () => void; demoStart: () => void;
}) {
  const { videoRef, canvasRef, status, message, hasVideo, targetState, paused, togglePause, assessment: a } = useCoach(exercise, source, view);
  const demo = source.kind === 'demo';
  const cameraStatus = paused ? 'Paused' : status === 'error' ? (hasVideo ? 'Tracking unavailable' : 'Camera unavailable') : status === 'loading' ? (hasVideo ? 'Loading tracking' : 'Opening camera') : a.ready ? 'Tracking' : 'Tracking uncertain';
  return <section className="session-page camera-first">
    <div className="live-heading"><button className="back-button" onClick={end}><ArrowLeft size={16}/> Back</button><h1>{EXERCISES[exercise].name}</h1><span className="live-camera-status"><span className={a.ready && !paused ? 'connected' : ''}/>{demo ? 'Simulated demo' : cameraStatus}</span></div>
    <div className={`camera-stage ${demo ? 'demo-stage' : ''} ${paused ? 'is-paused' : ''}`}>
      <video ref={videoRef} muted playsInline className={demo ? 'hidden-video' : ''}/>
      {demo && <div className="stage-grid"/>}
      <canvas ref={canvasRef} className="pose-canvas" aria-label="White pose skeleton. Orange joint points toward a pulsing mint target when adjustment is needed."/>
      {status === 'running' && !paused && targetState==='locked' && <>
        <div className="alignment-indicator" aria-label="Form Alignment"><strong>{alignmentText(a)}</strong></div>
        <div className="stage-bottom"><span className="rep-count" aria-label={exercise==='plank'?'Hold duration':`${a.reps} Quality Reps`}><strong>{exercise==='plank'?holdTime(a.holdMs??0):String(a.reps).padStart(2,'0')}</strong><span>{exercise==='plank'?'Hold':'Quality Reps'}</span></span></div>
      </>}
      {hasVideo && !demo && !paused && status!=='error' && <TargetGuide visible={targetState==='selecting'}/>}
      {status === 'loading' && !hasVideo && <div className="stage-overlay"><div className="loader"><Camera size={30}/></div><p role="status">{message}</p></div>}

      {paused && status !== 'error' && <div className="pause-indicator"><Pause size={26}/><span>Paused</span></div>}
      {status === 'error' && <div className={`camera-error ${hasVideo ? 'over-video' : ''}`}><VideoOff size={27}/><p role="alert">{message}</p><button className="primary-button" onClick={retry}><RotateCcw size={16}/> Try camera again</button></div>}
      {demo && <div className="demo-watermark">SYNTHETIC POSE · NO CAMERA</div>}
    </div>
    <div className="session-controls"><div><button className="secondary-button" disabled={!hasVideo && !demo} onClick={togglePause}>{paused ? <Play size={16}/> : <Pause size={16}/>} {paused ? 'Resume' : 'Pause'}</button><button className="end-button" onClick={end}><Square size={13} fill="currentColor"/> End</button></div></div>
    {debug && <DebugPanel assessment={a} exercise={exercise} view={view} source={source.kind} cameraStatus={cameraStatus} demoStart={demoStart} retry={retry}/>}
  </section>;
}
