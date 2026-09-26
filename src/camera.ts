import { BRAND } from './config';

export type CameraResult = { stream: MediaStream; error?: never } | { error: Error; stream?: never };

// Ask for the camera as soon as the user clicks
// React and model loading can catch up afterward
export function requestCamera(getMedia?: () => Promise<MediaStream>) {
  let disposed = false;
  let stream: MediaStream | undefined;
  let consumers = 0;
  let result: Promise<CameraResult>;
  const dispose = () => {
    disposed = true;
    stream?.getTracks().forEach(track => track.stop());
  };
  try {
    if (!getMedia && !navigator.mediaDevices?.getUserMedia) {
      throw new Error(`Camera unavailable. Open ${BRAND.name} on localhost or HTTPS.`);
    }
    const pending = getMedia ? getMedia() : navigator.mediaDevices.getUserMedia({
      video: { width: { ideal: 1280 }, height: { ideal: 720 }, facingMode: 'user' }, audio: false,
    });
    // Attach rejection handling immediately, including before the component mounts
    result = pending.then(value => {
      stream = value;
      if (disposed) dispose();
      return { stream: value };
    }, error => ({ error: error instanceof Error ? error : new Error(String(error)) }));
  } catch (error) {
    result = Promise.resolve({ error: error instanceof Error ? error : new Error('Camera is unavailable. Use localhost or HTTPS.') });
  }
  return {
    result, dispose,
    retain() {
      consumers++;
      return () => {
        consumers--;
        // React StrictMode reconnects effects right away
        // Keep the shared camera request alive during that reconnect
        queueMicrotask(() => { if (consumers === 0) dispose(); });
      };
    },
  };
}
export type CameraRequest = ReturnType<typeof requestCamera>;
export type SessionSource = { kind: 'camera'; camera: CameraRequest } | { kind: 'demo' };
