// A small pool of simulation workers. Each worker holds a copy of the league; games are handed out
// as workers free up. Returns null from create() when workers aren't available (the caller falls
// back to simulating on the main thread).
export class SimPool {
  static create(league) {
    try {
      if (typeof Worker === 'undefined') return null;
      return new SimPool(league);
    } catch { return null; }
  }

  constructor(league) {
    const n = Math.max(1, Math.min(8, (navigator.hardwareConcurrency || 4) - 1));
    this.league = league;
    this.workers = [];
    this.pending = new Map();
    this.nextId = 1;
    this.broken = false;
    for (let i = 0; i < n; i++) {
      const w = new Worker(new URL('../sim/simworker.js', import.meta.url), { type: 'module' });
      w.onmessage = (e) => this.onResult(w, e.data);
      w.onerror = (e) => { this.broken = true; this.failAll(e.message || 'worker error'); };
      w.postMessage({ type: 'init', teams: league.teams });
      w.busy = null;
      this.workers.push(w);
    }
    this.queue = [];
  }

  // spec: { home, away, out: [pid], noTie } -> Promise<result>
  run(spec) {
    return new Promise((resolve, reject) => {
      const id = this.nextId++;
      this.pending.set(id, { resolve, reject });
      this.queue.push({ ...spec, id, type: 'game' });
      this.pump();
    });
  }

  pump() {
    for (const w of this.workers) {
      if (w.busy || !this.queue.length) continue;
      const job = this.queue.shift();
      w.busy = job.id;
      w.postMessage(job);
    }
  }

  onResult(w, msg) {
    w.busy = null;
    const p = this.pending.get(msg.id);
    this.pending.delete(msg.id);
    if (p) { if (msg.error) p.reject(new Error(msg.error)); else p.resolve(msg.res); }
    this.pump();
  }

  failAll(reason) {
    for (const [, p] of this.pending) p.reject(new Error(reason));
    this.pending.clear();
    this.queue = [];
  }

  terminate() { for (const w of this.workers) w.terminate(); this.workers = []; }
}
