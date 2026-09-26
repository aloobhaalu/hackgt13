import { useCallback, useEffect, useRef, useState } from 'react';
import type { PoseLandmarker } from '@mediapipe/tasks-vision';
import { TRACKING, type ExerciseId } from './config';
import type { SessionSource } from './camera';
import { CoachEngine, choosePose, emptyAssessment } from './pose/engine';
import { drawPose } from './pose/draw';
import { demoPose } from './pose/demo';
import type { Pose } from './pose/types';

export function useCoach(exercise: ExerciseId, source: SessionSource) {
  const videoRef = useRef<HTMLVideoElement>(null), canvasRef = useRef<HTMLCanvasElement>(null);
  const [status, setStatus] = useState<'loading' | 'running' | 'error'>('loading');
  const [message, setMessage] = useState('Waiting for camera permission');
  const [hasVideo, setHasVideo] = useState(false), [showSetup, setShowSetup] = useState(false);
  const [paused, setPaused] = useState(false), [assessment, setAssessment] = useState(emptyAssessment());
  const pausedRef = useRef(false), streamRef = useRef<MediaStream | null>(null);
  const togglePause = useCallback(() => setPaused(value => !value), []);
  useEffect(() => {
    pausedRef.current = paused;
    streamRef.current?.getVideoTracks().forEach(track => { track.enabled = !paused; });
  }, [paused]);
  useEffect(() => {
    const hidden = () => { if (document.hidden) setPaused(true); };
    document.addEventListener('visibilitychange', hidden);
    return () => document.removeEventListener('visibilitychange', hidden);
  }, []);

  useEffect(() => {
    let disposed = false, raf = 0, model: PoseLandmarker | undefined;
    let lastInference = 0, lastFrame = -1, lastVideoAt = 0, lastTick = 0, elapsed = 0, wasPaused = false;
    let introUntil = 0, setupTimer: ReturnType<typeof setTimeout> | undefined;
    let modelTimer: ReturnType<typeof setTimeout> | undefined;
    let pose: Pose = [], result = emptyAssessment();
    let generateDemo: ((id: ExerciseId, seconds: number) => Pose) | undefined;
    const engine = new CoachEngine(exercise);
    const release = source.kind === 'camera' ? source.camera.retain() : undefined;
    const fail = (text: string) => {
      if (disposed) return;
      cancelAnimationFrame(raf);
      result = engine.interrupt(text); setAssessment(result);
      canvasRef.current?.getContext('2d')?.clearRect(0, 0, canvasRef.current.width, canvasRef.current.height);
      setMessage(text); setStatus('error'); setShowSetup(false);
      model?.close(); model = undefined;
      // Keep an already available video visible, even if the model failed to load.
    };
    const tick = (now: number) => {
      if (disposed) return;
      const dt = lastTick ? Math.min(now - lastTick, 100) : 0; lastTick = now;
      const canvas = canvasRef.current, video = videoRef.current;
      if (!canvas) return;
      if (pausedRef.current) {
        if (!wasPaused) {
          result = engine.interrupt(); setAssessment(result); wasPaused = true;
          canvas.getContext('2d')?.clearRect(0, 0, canvas.width, canvas.height);
        }
        raf = requestAnimationFrame(tick); return;
      }
      wasPaused = false; elapsed += dt;
      const demo = source.kind === 'demo';
      const w = demo ? 720 : video?.videoWidth || 1280, h = demo ? 720 : video?.videoHeight || 720;
      if (canvas.width !== w || canvas.height !== h) { canvas.width = w; canvas.height = h; }
      try {
        if (now >= introUntil && now - lastInference >= TRACKING.inferenceIntervalMs) {
          if (source.kind === 'demo' && generateDemo) {
            const output = engine.update(generateDemo(exercise, elapsed / 1000), now, 1);
            pose = output.pose; result = output.assessment;
          } else if (source.kind === 'camera' && video && model && video.readyState >= 2 && video.currentTime !== lastFrame) {
            lastFrame = video.currentTime; lastVideoAt = now;
            const detected = model.detectForVideo(video, now);
            const selected = choosePose(detected.landmarks);
            const world = selected.index === undefined ? undefined : detected.worldLandmarks[selected.index];
            const output = engine.update(selected.pose, now, w / h, selected.ambiguous, world);
            pose = output.pose; result = output.assessment;
          } else if (!demo && now - lastVideoAt > 1000) {
            pose = []; result = engine.interrupt('Waiting for fresh camera frames');
          }
          lastInference = now;
          setAssessment(result);
        }
        const ctx = canvas.getContext('2d');
        if (ctx) { ctx.clearRect(0, 0, w, h); drawPose(ctx, pose, w, h, result, now, demo); }
        raf = requestAnimationFrame(tick);
      } catch { fail('Pose tracking is unavailable. Try camera again.'); }
    };
    const boot = async () => {
      if (source.kind === 'demo') {
        // The generator can only feed an explicitly selected demo source, never the camera branch.
        generateDemo = demoPose; setStatus('running'); raf = requestAnimationFrame(tick); return;
      }
      try {
        const camera = await source.camera.result;
        if (disposed) return;
        if (camera.error) throw camera.error;
        const stream = camera.stream!;
        const video = videoRef.current;
        if (!video) return;
        streamRef.current = stream;
        stream.getVideoTracks().forEach(track => {
          track.enabled = !pausedRef.current;
          track.onended = () => fail('Camera disconnected. Try camera again.');
        });
        video.srcObject = stream;
        await video.play();
        if (disposed) return;
        // Display camera immediately. Model loading never hides the live video.
        setHasVideo(true); setShowSetup(true); setMessage('Loading pose tracking');
        introUntil = performance.now() + TRACKING.setupOverlayMs;
        setupTimer = setTimeout(() => { if (!disposed) setShowSetup(false); }, TRACKING.setupOverlayMs);

        const { FilesetResolver, PoseLandmarker } = await import('@mediapipe/tasks-vision');
        if (disposed) return;
        let expired = false;
        const load = async () => {
          const vision = await FilesetResolver.forVisionTasks('https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.32/wasm');
          if (disposed || expired) return undefined;
          const options = {
            baseOptions: { modelAssetPath: 'https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/1/pose_landmarker_lite.task' },
            runningMode: 'VIDEO' as const, numPoses: 3,
            minPoseDetectionConfidence: 0.5, minPosePresenceConfidence: 0.5, minTrackingConfidence: 0.5,
          };
          let loaded: PoseLandmarker;
          try { loaded = await PoseLandmarker.createFromOptions(vision, { ...options, baseOptions: { ...options.baseOptions, delegate: 'GPU' } }); }
          catch {
            if (disposed || expired) return undefined;
            loaded = await PoseLandmarker.createFromOptions(vision, { ...options, baseOptions: { ...options.baseOptions, delegate: 'CPU' } });
          }
          if (disposed || expired) { loaded.close(); return undefined; }
          return loaded;
        };
        try {
          model = await Promise.race([load(), new Promise<never>((_, reject) => {
            modelTimer = setTimeout(() => { expired = true; reject(new Error('Pose tracking could not load. Check your connection and try camera again.')); }, 30000);
          })]);
        } finally { clearTimeout(modelTimer); }
        if (disposed || !model) return;
        setStatus('running'); raf = requestAnimationFrame(tick);
      } catch (error) {
        const e = error as Error;
        fail(e.name === 'NotAllowedError' ? 'Camera permission was denied. Allow camera access in your browser.' : e.name === 'NotFoundError' ? 'No camera found. Connect a webcam to continue.' : e.name === 'NotReadableError' ? 'Your camera is in use by another app.' : e.message || 'Camera unavailable. Use localhost or HTTPS.');
      }
    };
    void boot();
    const video = videoRef.current;
    return () => {
      disposed = true; cancelAnimationFrame(raf); clearTimeout(setupTimer); clearTimeout(modelTimer);
      streamRef.current?.getVideoTracks().forEach(track => { track.onended = null; });
      streamRef.current = null;
      if (video) { video.pause(); video.srcObject = null; }
      model?.close(); release?.();
    };
  }, [exercise, source]);
  return { videoRef, canvasRef, status, message, hasVideo, showSetup, paused, togglePause, assessment };
}
