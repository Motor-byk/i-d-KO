import { performance } from 'node:perf_hooks';
import { TICK_RATE, MAX_CATCHUP_TICKS } from '../shared/constants.js';

const TICK_MS = 1000 / TICK_RATE;
const AVG_WEIGHT = 0.05; // EMA weight for per-room tick time

// One fixed-step loop for every running match. Entities implement tick().
// A throwing entity is removed and handed to onError; it never takes down the loop or other rooms.
// The timer only runs while there is something to tick, so an idle server stays idle.
export class GameLoop {
  constructor({ now = () => performance.now(), onError = defaultOnError } = {}) {
    this.now = now;
    this.onError = onError;
    this.entities = new Map(); // entity -> { lastMs, avgMs, maxMs }
    this.tick = 0;
    this.droppedTicks = 0;
    this.acc = 0;
    this.last = null;
    this.timer = null;
  }

  add(entity) {
    this.entities.set(entity, { lastMs: 0, avgMs: 0, maxMs: 0 });
    if (!this.timer) this.#schedule();
  }

  remove(entity) {
    this.entities.delete(entity);
    if (!this.entities.size) this.stop();
  }

  stats(entity) {
    return this.entities.get(entity);
  }

  stop() {
    clearTimeout(this.timer);
    this.timer = null;
    this.last = null;
    this.acc = 0;
  }

  // Runs every tick that is due (at most MAX_CATCHUP_TICKS) and returns how many ran.
  update() {
    const t = this.now();
    this.acc += this.last === null ? TICK_MS : t - this.last;
    this.last = t;
    let ran = 0;
    while (this.acc >= TICK_MS && ran < MAX_CATCHUP_TICKS) {
      this.acc -= TICK_MS;
      this.#tickAll();
      ran++;
    }
    if (this.acc >= TICK_MS) {
      // Too far behind (GC pause, suspended VM): drop the backlog instead of fast-forwarding.
      this.droppedTicks += Math.floor(this.acc / TICK_MS);
      this.acc %= TICK_MS;
    }
    return ran;
  }

  #tickAll() {
    this.tick++;
    for (const [entity, stats] of this.entities) {
      const start = performance.now();
      try {
        entity.tick();
      } catch (err) {
        this.entities.delete(entity);
        this.onError(entity, err);
        continue;
      }
      const ms = performance.now() - start;
      stats.lastMs = ms;
      stats.avgMs += (ms - stats.avgMs) * AVG_WEIGHT;
      stats.maxMs = Math.max(stats.maxMs, ms);
    }
  }

  #schedule() {
    const delay = this.last === null ? TICK_MS : Math.max(0, TICK_MS - this.acc - (this.now() - this.last));
    this.timer = setTimeout(() => {
      this.timer = null;
      this.update();
      // An entity added during update() may already have scheduled the next wake.
      if (this.timer) return;
      if (this.entities.size) this.#schedule();
      else this.stop();
    }, delay);
    // The HTTP server keeps the process alive; the loop alone shouldn't.
    this.timer.unref();
  }
}

function defaultOnError(_entity, err) {
  console.error('room tick failed, ending it', err);
}
