import test from 'node:test';
import assert from 'node:assert/strict';
import { startLiveSnapshot } from './live-snapshot.js';

function fixture(request) {
  const listeners = new Set(), timers = new Map(), snapshots = [];
  let next = 0;
  const doc = { visibilityState: 'visible', addEventListener: (name, fn) => listeners.add(fn), removeEventListener: (name, fn) => listeners.delete(fn) };
  const stop = startLiveSnapshot({ request, document: doc, onSnapshot: value => snapshots.push(value), setTimer: (fn, delay) => { const id = ++next; timers.set(id, { fn, delay }); return id; }, clearTimer: id => timers.delete(id) });
  return { doc, timers, snapshots, stop, visibility: () => listeners.forEach(fn => fn()), async tick() { const [id, item] = [...timers][0]; timers.delete(id); await item.fn(); } };
}
const settle = () => new Promise(resolve => setImmediate(resolve));
test('version poll fetches changed snapshots only without refreshing the page', async () => {
  let version = 'v1'; const paths = [];
  const f = fixture(async path => { paths.push(path); return path.endsWith('-version') ? Response.json({ version }) : Response.json({ generatedAt: version, queries: { reach: { rows: [version] } } }); });
  await settle(); assert.equal(f.snapshots.length, 1);
  assert.equal([...f.timers.values()][0].delay, 5000);
  await f.tick(); assert.equal(f.snapshots.length, 1);
  version = 'v2'; await f.tick(); assert.equal(f.snapshots.length, 2);
  assert.deepEqual(paths, ['/api/snapshot-version', '/api/snapshot', '/api/snapshot-version', '/api/snapshot-version', '/api/snapshot']);
  f.stop(); assert.equal(f.timers.size, 0);
});
test('hidden state aborts current request and visibility return never overlaps', async () => {
  let active = 0, maxActive = 0;
  const f = fixture((path, { signal }) => new Promise((resolve, reject) => {
    active++; maxActive = Math.max(maxActive, active);
    signal.addEventListener('abort', () => { active--; reject(new Error('aborted')); }, { once: true });
  }));
  f.doc.visibilityState = 'hidden'; f.visibility();
  f.doc.visibilityState = 'visible'; f.visibility();
  await settle(); assert.equal(maxActive, 1);
  assert.equal([...f.timers.values()][0].delay, 0);
  f.stop();
});
test('authentication failure stops polling and transient failures back off', async () => {
  const denied = fixture(async () => new Response(null, { status: 401 }));
  await settle(); assert.equal(denied.timers.size, 0); denied.stop();
  const f = fixture(async () => { throw new Error('offline'); });
  await settle(); assert.equal([...f.timers.values()][0].delay, 10000);
  await f.tick(); assert.equal([...f.timers.values()][0].delay, 20000);
  f.stop();
});
test('cleanup and malformed snapshots never publish data', async () => {
  const f = fixture(async path => path.endsWith('-version') ? Response.json({ version: 'v1' }) : Response.json({ queries: [] }));
  await settle(); assert.equal(f.snapshots.length, 0); f.stop();
  assert.equal(f.timers.size, 0);
});
