import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { StrictMode, act } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import { FilesetResolver } from '@mediapipe/tasks-vision';

function setup(query = '') {
  const dom = new JSDOM('<div id="root"></div>', { url: `http://localhost/${query}` });
  const { window } = dom;
  for (const name of ['window', 'document', 'navigator', 'HTMLElement', 'HTMLCanvasElement', 'HTMLVideoElement']) {
    Object.defineProperty(globalThis, name, { configurable: true, value: name === 'window' ? window : (window as unknown as Record<string, unknown>)[name] });
  }
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true, requestAnimationFrame: () => 1, cancelAnimationFrame: () => {} });
  window.scrollTo = () => {};
  window.matchMedia = (() => ({ matches: true })) as unknown as typeof window.matchMedia;
  window.HTMLMediaElement.prototype.pause = () => {};
  window.HTMLCanvasElement.prototype.getContext = (() => ({ clearRect: () => {} })) as unknown as typeof window.HTMLCanvasElement.prototype.getContext;
  let calls = 0;
  let deny!: (error: Error) => void;
  Object.defineProperty(window.navigator, 'mediaDevices', { configurable: true, value: {
    getUserMedia: () => { calls++; return new Promise<MediaStream>((_, reject) => { deny = reject; }); },
  } });
  const root = createRoot(window.document.getElementById('root')!);
  return { dom, window, root, calls: () => calls, deny: () => deny(Object.assign(new Error('Denied'), { name: 'NotAllowedError' })) };
}

test('all three complete cards, including canvas/title/arrow, request the camera in the same click', async () => {
  const ctx = setup();
  await act(async () => ctx.root.render(<StrictMode><App/></StrictMode>));
  const targets = ['canvas', 'h2', '.card-arrow'];
  for (let index = 0; index < 3; index++) {
    const cards = ctx.window.document.querySelectorAll('.exercise-card');
    assert.equal(cards.length, 3);
    const target = cards[index].querySelector(targets[index])!;
    const before = ctx.calls();
    await act(async () => {
      target.dispatchEvent(new ctx.window.MouseEvent('click', { bubbles: true }));
      assert.equal(ctx.calls(), before + 1, 'getUserMedia must run before any asynchronous work');
    });
    assert.ok(ctx.window.document.querySelector('.camera-stage video'));
    assert.equal(ctx.window.document.querySelectorAll('.motion-diagram').length, 0, 'home animations must unmount');
    assert.equal(ctx.window.document.querySelector('.setup-page'), null);
    assert.doesNotMatch(ctx.window.document.body.textContent!, /Start Camera|100%|Take a look around/);
    assert.equal(ctx.calls(), before + 1, 'StrictMode must not request twice');
    await act(async () => (ctx.window.document.querySelector('.back-button') as HTMLElement).click());
  }
  await act(async () => ctx.root.unmount()); ctx.dom.window.close();
});

test('denied permission has one retry action and retry directly requests again', async () => {
  const ctx = setup();
  await act(async () => ctx.root.render(<App/>));
  await act(async () => (ctx.window.document.querySelector('.exercise-card') as HTMLElement).click());
  await act(async () => ctx.deny());
  const retry = ctx.window.document.querySelector('.camera-error button') as HTMLButtonElement;
  assert.equal(retry.textContent, ' Try camera again');
  assert.equal(ctx.window.document.querySelectorAll('.camera-error button').length, 1);
  assert.equal(ctx.window.document.querySelector('.debug-panel'), null);
  await act(async () => retry.click());
  assert.equal(ctx.calls(), 2);
  assert.equal(ctx.window.document.querySelector('.camera-error'), null);
  await act(async () => ctx.root.unmount()); ctx.dom.window.close();
});

test('debug UI is absent by default, toggles with D, and can be enabled by query', async () => {
  for (const query of ['', '?debug=1']) {
    const ctx = setup(query);
    await act(async () => ctx.root.render(<App/>));
    assert.equal(!!ctx.window.document.querySelector('.debug-home'), !!query);
    await act(async () => ctx.window.dispatchEvent(new ctx.window.KeyboardEvent('keydown', { key: 'D' })));
    assert.equal(!!ctx.window.document.querySelector('.debug-home'), !query);
    await act(async () => ctx.root.unmount()); ctx.dom.window.close();
  }
});

test('permission success shows video before tracking loads; visual setup disappears automatically', async () => {
  const ctx = setup();
  let stopped = 0, playCalls = 0;
  const track = { enabled: true, onended: null, stop: () => stopped++ };
  const stream = { getTracks: () => [track], getVideoTracks: () => [track] } as unknown as MediaStream;
  Object.defineProperty(ctx.window.navigator, 'mediaDevices', { value: { getUserMedia: () => Promise.resolve(stream) } });
  ctx.window.HTMLMediaElement.prototype.play = async () => { playCalls++; };
  const originalResolver = FilesetResolver.forVisionTasks;
  FilesetResolver.forVisionTasks = () => new Promise(() => {});
  try {
    await act(async () => ctx.root.render(<StrictMode><App/></StrictMode>));
    await act(async () => (ctx.window.document.querySelector('.exercise-card') as HTMLElement).click());
    assert.equal(playCalls, 1, 'StrictMode must not attach the stream twice');
    const video = ctx.window.document.querySelector('video') as HTMLVideoElement;
    assert.equal(video.srcObject, stream);
    assert.equal(ctx.window.document.querySelector('.quick-setup'), null, 'squat startup has no written setup overlay');
    assert.equal(ctx.window.document.querySelector('.stage-overlay'), null, 'model loading must not cover the video');
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 2700)); });
    assert.equal(ctx.window.document.querySelector('.quick-setup'), null);
    assert.ok(ctx.window.document.querySelector('.tracking-loading'));
    const pause = Array.from(ctx.window.document.querySelectorAll('button')).find(button => button.textContent?.trim() === 'Pause')!;
    await act(async () => pause.click());
    assert.equal(track.enabled, false);
    await act(async () => (ctx.window.document.querySelector('.back-button') as HTMLElement).click());
    assert.ok(stopped >= 1);
  } finally {
    FilesetResolver.forVisionTasks = originalResolver;
    await act(async () => ctx.root.unmount()); ctx.dom.window.close();
  }
});
