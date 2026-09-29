// Play recording and playback. A recorded play is a list of compact frames (30 per second);
// ReplaySim plays them back with the same fields the renderer reads from a live PlaySim.
const BALL_STATES = ['held', 'air', 'dead-air', 'roll', 'tee', 'loose'];
const A_STRIDE = 6;   // x, y, face, vx, vy, flags (1 = down, 2 = runner)
const B_STRIDE = 14;  // x, y, z, vx, vy, vz, rot, state, holder, landX, landY, t0, T, kind (0 pass, 1 kick/pitch/snap)

export function startRecording(sim) {
  sim.rec = { frames: [], meta: null, anims: [], animIdx: new Map(), n: 0 };
}

export function recordFrame(sim) {
  const R = sim.rec;
  if (!R || (sim.phase !== 'live' && sim.phase !== 'dead')) return;
  if (R.n++ % 2) return; // 30 fps is plenty for playback
  if (sim.phase === 'dead' && (sim.deadT ?? 0) > 1.6) return;
  const A = sim.agents;
  if (!R.meta) {
    R.meta = A.map((a) => ({ id: a.id, p: a.p, side: a.side, pos: a.pos, slot: a.slot, special: !!a.special, role: a.role }));
    R.index = new Map(A.map((a, i) => [a, i]));
  }
  const f = new Float32Array(A.length * A_STRIDE + B_STRIDE);
  const anim = new Uint8Array(A.length);
  A.forEach((a, i) => {
    const o = i * A_STRIDE;
    f[o] = a.x; f[o + 1] = a.y; f[o + 2] = a.face; f[o + 3] = a.vx; f[o + 4] = a.vy;
    f[o + 5] = (a.down ? 1 : 0) | (a.d?.runner ? 2 : 0);
    let k = R.animIdx.get(a.anim);
    if (k == null) { k = R.anims.length; R.anims.push(a.anim); R.animIdx.set(a.anim, k); }
    anim[i] = k;
  });
  const B = sim.ball, o = A.length * A_STRIDE, P = B.pass;
  f[o] = B.x; f[o + 1] = B.y; f[o + 2] = B.z; f[o + 3] = B.vx || 0; f[o + 4] = B.vy || 0; f[o + 5] = B.vz || 0; f[o + 6] = B.rot || 0;
  f[o + 7] = Math.max(0, BALL_STATES.indexOf(B.state));
  f[o + 8] = B.holder ? (R.index.get(B.holder) ?? -1) : -1;
  f[o + 9] = P?.land?.x ?? NaN; f[o + 10] = P?.land?.y ?? NaN; f[o + 11] = P?.t0 ?? 0; f[o + 12] = P?.T ?? 0;
  f[o + 13] = P && (P.kick || P.pitch || P.snap) ? 1 : 0;
  R.frames.push({ t: sim.t, dead: sim.phase === 'dead', f, anim });
}

// Everything needed to replay the play later (the live sim can then be dropped).
export function finishRecording(sim, extra = {}) {
  const R = sim.rec;
  if (!R || !R.frames.length) return null;
  return {
    frames: R.frames, meta: R.meta, anims: R.anims,
    play: { meta: { dir: sim.meta.dir, off: sim.meta.off, def: sim.meta.def, type: sim.meta.type, label: sim.meta.label },
      kind: sim.kind, los: sim.los, isRun: sim.isRun, firstDownX: sim.firstDownX, fouls: sim.fouls || [] },
    ...extra,
  };
}

export class ReplaySim {
  constructor(rec) {
    this.rec = rec;
    Object.assign(this, rec.play);
    this.phase = 'live';
    this.t = rec.frames[0].t;
    this.clock = 0;
    this.done = false;
    this.agents = rec.meta.map((m) => ({ ...m, x: 0, y: 0, face: 0, vx: 0, vy: 0, anim: 'stance', animT: 0, down: false, hasBall: false, d: { runner: false } }));
    this.ball = { x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0, rot: 0, state: 'held', holder: null, pass: null };
    this.off = this.agents.filter((a) => a.side === 'O');
    this.def = this.agents.filter((a) => a.side === 'D');
    this.apply(0, 0);
  }
  qb() { return this.agents.find((a) => a.slot === 'QB') || null; }

  step(dt) {
    const F = this.rec.frames;
    const t0 = F[0].t, end = F[F.length - 1].t + 0.6;
    this.clock += dt;
    const t = t0 + this.clock;
    if (t >= end) { this.done = true; this.phase = 'dead'; return; }
    let i = this.i || 0;
    while (i < F.length - 1 && F[i + 1].t <= t) i++;
    this.i = i;
    const j = Math.min(i + 1, F.length - 1);
    const span = F[j].t - F[i].t;
    this.apply(i, span > 0 ? Math.min(1, (t - F[i].t) / span) : 0, dt);
    this.t = t;
  }

  apply(i, k, dt = 0) {
    const F = this.rec.frames;
    const a0 = F[i], a1 = F[Math.min(i + 1, F.length - 1)];
    const f0 = a0.f, f1 = a1.f, n = this.agents.length;
    const lerp = (x, y) => x + (y - x) * k;
    this.agents.forEach((a, idx) => {
      const o = idx * A_STRIDE;
      a.x = lerp(f0[o], f1[o]); a.y = lerp(f0[o + 1], f1[o + 1]);
      let d = f1[o + 2] - f0[o + 2];
      d = Math.atan2(Math.sin(d), Math.cos(d));
      a.face = f0[o + 2] + d * k;
      a.vx = f0[o + 3]; a.vy = f0[o + 4];
      a.down = !!(f0[o + 5] & 1); a.d.runner = !!(f0[o + 5] & 2);
      const anim = this.rec.anims[a0.anim[idx]];
      if (anim !== a.anim) { a.anim = anim; a.animT = 0; } else a.animT += dt;
    });
    const o = n * A_STRIDE, B = this.ball;
    B.x = lerp(f0[o], f1[o]); B.y = lerp(f0[o + 1], f1[o + 1]); B.z = lerp(f0[o + 2], f1[o + 2]);
    B.vx = f0[o + 3]; B.vy = f0[o + 4]; B.vz = f0[o + 5]; B.rot = f0[o + 6];
    B.state = BALL_STATES[f0[o + 7]] || 'held';
    const h = f0[o + 8];
    B.holder = h >= 0 ? this.agents[h] : null;
    for (const a of this.agents) a.hasBall = a === B.holder;
    B.pass = Number.isFinite(f0[o + 9]) ? { land: { x: f0[o + 9], y: f0[o + 10] }, t0: f0[o + 11], T: f0[o + 12], pitch: f0[o + 13] === 1 } : null;
    this.phase = a0.dead ? 'dead' : 'live';
  }
}
