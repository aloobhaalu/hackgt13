import test from 'node:test';
import assert from 'node:assert/strict';
import { requestCamera } from './camera';

test('camera request starts synchronously and late permission results are released after leaving', async () => {
  let requested = false, stopped = 0;
  let resolve!: (stream: MediaStream) => void;
  const stream = { getTracks: () => [{ stop: () => stopped++ }] } as unknown as MediaStream;
  const camera = requestCamera(() => { requested = true; return new Promise(done => { resolve = done; }); });
  assert.equal(requested, true);
  camera.dispose(); resolve(stream);
  await camera.result;
  assert.equal(stopped, 1);
});

test('StrictMode effect replay keeps the same camera request alive until actual unmount', async () => {
  let stopped = 0;
  const stream = { getTracks: () => [{ stop: () => stopped++ }] } as unknown as MediaStream;
  const camera = requestCamera(() => Promise.resolve(stream));
  const firstRelease = camera.retain(); firstRelease();
  const secondRelease = camera.retain();
  await camera.result;
  assert.equal(stopped, 0);
  secondRelease(); await Promise.resolve();
  assert.equal(stopped, 1);
});

test('camera rejection is handled even before any component subscribes', async () => {
  const camera = requestCamera(() => Promise.reject(new Error('Permission denied')));
  const result = await camera.result;
  assert.equal(result.error?.message, 'Permission denied');
});
