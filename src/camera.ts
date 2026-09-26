export type CameraResult = { stream: MediaStream; error?: never } | { error: Error; stream?: never };

/** Starts synchronously in the card/retry click, before React renders or any model downloads. */
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
      throw new Error('Camera unavailable. Open FormFlow on localhost or HTTPS.');
    }
    const pending = getMedia ? getMedia() : navigator.mediaDevices.getUserMedia({
      video: { width: { ideal: 1280 }, height: { ideal: 720 }, facingMode: 'user' }, audio: false,
    });
    // Attach rejection handling immediately, including before the component mounts.
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
        // React StrictMode reattaches effects in the same turn. Do not stop that shared request.
        queueMicrotask(() => { if (consumers === 0) dispose(); });
      };
    },
  };
}
export type CameraRequest = ReturnType<typeof requestCamera>;
export type SessionSource = { kind: 'camera'; camera: CameraRequest } | { kind: 'demo' };
