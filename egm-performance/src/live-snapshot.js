// Poll stored snapshots only. This never invokes source ingestion or page reloads.
export function startLiveSnapshot({ request = fetch, document: doc = globalThis.document, onSnapshot, interval = 60000, setTimer = setTimeout, clearTimer = clearTimeout }) {
  let stopped = false, running = false, timer, controller, version, failures = 0, checkAgain = false;
  const schedule = delay => {
    clearTimer(timer);
    if (!stopped && doc.visibilityState === 'visible') timer = setTimer(check, delay);
  };
  const check = async () => {
    if (stopped || doc.visibilityState !== 'visible') return;
    if (running) { checkAgain = true; return; }
    running = true;
    controller = new AbortController();
    let delay = interval;
    try {
      const options = { signal: AbortSignal.any([controller.signal, AbortSignal.timeout(20000)]), cache: 'no-store', credentials: 'same-origin' };
      const response = await request('/api/snapshot-version', options);
      if (response.status === 401 || response.status === 403) { stopped = true; return; }
      if (!response.ok) throw new Error('snapshot_version_unavailable');
      const record = await response.json();
      if (typeof record.version !== 'string' || !record.version) throw new Error('invalid_snapshot_version');
      if (record.version !== version) {
        const dataResponse = await request('/api/snapshot', options);
        if (dataResponse.status === 401 || dataResponse.status === 403) { stopped = true; return; }
        if (!dataResponse.ok) throw new Error('snapshot_unavailable');
        const snapshot = await dataResponse.json();
        if (!snapshot || typeof snapshot.queries !== 'object' || Array.isArray(snapshot.queries) || snapshot.queries === null || typeof snapshot.generatedAt !== 'string') throw new Error('invalid_snapshot');
        if (!stopped && !controller.signal.aborted && doc.visibilityState === 'visible') {
          onSnapshot(snapshot);
          version = dataResponse.headers?.get('x-egm-snapshot-version') || record.version;
        }
      }
      failures = 0;
    } catch {
      if (!controller.signal.aborted) { failures++; delay = Math.min(interval * 2 ** failures, 600000); }
    } finally {
      running = false;
      if (checkAgain) { checkAgain = false; delay = 0; }
      schedule(delay);
    }
  };
  const visibility = () => {
    clearTimer(timer);
    if (doc.visibilityState === 'visible') void check();
    else controller?.abort();
  };
  doc.addEventListener('visibilitychange', visibility);
  void check();
  return () => {
    stopped = true;
    clearTimer(timer);
    controller?.abort();
    doc.removeEventListener('visibilitychange', visibility);
  };
}
