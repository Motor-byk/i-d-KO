import { h } from './ui/dom.js';

const REFRESH_MS = 250;
const PING_MS = 2000;
const WINDOW_MS = 1000; // snapshot gap stats cover the last second

// Network/perf overlay. Shown with ?debug in the URL; toggled with the backquote key.
// ping() resolves to an RTT in ms (or null). Call destroy() when the screen goes away.
export function debugOverlay({ ping }) {
  const el = h('pre.debug', { hidden: !new URLSearchParams(location.search).has('debug') });
  let rtt = null;
  let tickMs = null;
  let correction = null;
  let interpMs = null;
  let jitterMs = null;
  let lastArrival = null;
  let gaps = []; // [arrivalTime, gapMs]
  let lastTick = 0;

  const onKey = (e) => { if (e.code === 'Backquote') el.hidden = !el.hidden; };
  window.addEventListener('keydown', onKey);

  const pingTimer = setInterval(async () => {
    if (!el.hidden) rtt = await ping();
  }, PING_MS);

  const fmt = (v, unit = 'ms') => (v == null ? '—' : `${v.toFixed(1)}${unit}`);

  const refreshTimer = setInterval(() => {
    if (el.hidden) return;
    const now = performance.now();
    gaps = gaps.filter(([t]) => now - t < WINDOW_MS);
    const values = gaps.map(([, g]) => g);
    const avg = values.length ? values.reduce((a, b) => a + b, 0) / values.length : null;
    el.textContent = [
      `rtt      ${fmt(rtt)}`,
      `snap gap ${fmt(avg)} avg  ${fmt(values.length ? Math.max(...values) : null)} max  (${values.length}/s)`,
      `server   ${fmt(tickMs?.avg)} avg  ${fmt(tickMs?.max)} max per tick`,
      `interp   ${fmt(interpMs)} delay  ${fmt(jitterMs)} jitter`,
      `correct  ${fmt(correction, 'u')}`,
      `tick     ${lastTick}`,
    ].join('\n');
  }, REFRESH_MS);

  return {
    el,
    onSnapshot(snap) {
      const now = performance.now();
      if (lastArrival !== null) gaps.push([now, now - lastArrival]);
      lastArrival = now;
      lastTick = snap.tick;
      if (snap.tickMs) tickMs = snap.tickMs;
    },
    // Size of the last prediction correction, in world units (from client prediction).
    setCorrection(units) { correction = units; },
    // Interpolation delay for other players and the measured snapshot jitter.
    setInterp(delay, jitter) {
      interpMs = delay;
      jitterMs = jitter;
    },
    destroy() {
      clearInterval(pingTimer);
      clearInterval(refreshTimer);
      window.removeEventListener('keydown', onKey);
    },
  };
}
