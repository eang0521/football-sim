import { startRecording, recordFrame } from './replay.js';
// Core per-play simulation: agents, physics, blocking, ball flight, catches, tackles.
import { DT, FIELD_W, MID_Y, GRAVITY, PLAYER_R, ENGAGE_R, TACKLE_R, MAX_PLAY_TIME, yardsBetween } from './constants.js';
import { clamp, norm, angleDiff } from '../util/vec.js';
import { setupScrimmage, setAgentContext } from './setup.js';
import { hasTrait } from '../data/traits.js';
import { throwFactor } from './weather.js';
import { think, attackDir } from './ai.js';
import { setupSpecial, rollUpdate } from './special.js';

const HIST_LEN = 45;
const POST_FOULS = new Set(['roughing_passer', 'face_mask', 'unnecessary_roughness']);
export const shortName = (p) => (p ? `${p.first[0]}.${p.last}` : '?');

export class PlaySim {
  constructor(cfg) {
    this.cfg = cfg;
    this.kind = cfg.kind || 'scrimmage';
    this.rng = cfg.rng;
    this.ctx = cfg.ctx || {};
    this.los = cfg.los;
    this.ballY = cfg.ballY;
    this.firstDownX = cfg.firstDownX ?? cfg.los + 10;
    this.t = 0;
    this.phase = 'lineup';
    this.phaseT = 0;
    this.timers = [];
    this.notes = [];
    this.st = { tacklers: [] };
    this.runner = null;
    this.runStartT = null;
    this.result = null;
    this.deadT = 0;
    if (cfg.record) startRecording(this);
    this.isRun = false;
    this.pass = null;
    this.run = null;
    this.fouls = [];
    this.injuries = [];
    setAgentContext(cfg);
    if (this.kind === 'scrimmage' || this.kind === 'kneel') setupScrimmage(this, cfg);
    else setupSpecial(this, cfg);
    this.agents = [...this.off, ...this.def];
    for (const a of this.agents) { a.ax = a.x; a.ay = a.y; }
    if (this.motion) {
      const M = this.motion;
      M.m.ax = M.origin.x; M.m.ay = M.origin.y;
      if (M.man) { M.man.ax = M.origin.x + M.manOffset.x; M.man.ay = M.origin.y + M.manOffset.y; }
    }
    const snapper = this.snapper || this.bySlotO?.C || this.off[0];
    this.ball = {
      state: 'held', holder: snapper, x: this.los, y: this.ballY, z: 0.15, vx: 0, vy: 0, vz: 0,
      pass: null, spin: 0, rot: 0, onGround: true,
    };
    this.ball.x = snapper.x + 0.6; this.ball.y = snapper.y;
    // Starting positions for the lineup walk
    if (cfg.skipLineup) this.startSet(true);
    else {
      const from = cfg.from || new Map();
      for (const a of this.agents) {
        const f = from.get(a.id);
        if (f) { a.x = f.x; a.y = f.y; }
        else {
          // run in from the sideline / huddle
          const hx = a.side === 'O' ? this.los - 9 : this.los + 7;
          a.x = hx + this.rng.range(-2, 2); a.y = (from.size ? (a.side === 'O' ? -1.5 : FIELD_W + 1.5) : this.ballY) + this.rng.range(-3, 3);
        }
      }
    }
  }

  // ---------- helpers used by AI ----------
  qb() { return this.bySlotO?.QB || null; }
  carrierAgent() { return this.ball.state === 'held' ? this.ball.holder : null; }
  after(dt, fn) { this.timers.push({ at: this.t + dt, fn }); }
  note(type, a, b) { this.notes.push({ t: this.t, type, a: a?.p, b: b?.p }); }
  runRead(a) {
    if (!this.runner || this.runner.side === a.side) return false;
    return this.t >= this.runStartT + (a.d.readDelay || 0.3) * (this.runFromCatch ? 0.3 : 1);
  }
  startRun(a, opts = {}) {
    a.d.runner = { heading: 0, t0: this.t, hole: opts.hole || null, path: opts.path || null, pathIdx: 0 };
    this.runner = a;
    this.runStartT = this.t;
    this.runFromCatch = !!opts.fromCatch;
    if (a.role === 'qb' && !this.isRun && !opts.fromCatch) this.st.scramble = true;
  }
  handoff(qb, rb) {
    this.ball.holder = rb;
    this.st.rusher = rb;
    this.startRun(rb, { hole: { x: this.los + 1.5, y: this.run.holeY } });
    rb.anim = 'carry';
  }
  // Record a penalty flag against an agent. Kicks (FG/PAT) and kneels are exempt.
  foul(type, a, x, y) {
    if (this.kind === 'fg' || this.kind === 'xp' || this.kind === 'kneel') return;
    if (this.fouls.some((f) => f.type === type && f.a === a)) return;
    const side = this.kind === 'scrimmage' ? a.side : a.side === 'D' ? 'R' : 'K';
    if (side === 'K') return; // kicking-team fouls not modeled
    this.fouls.push({ type, side, a, p: a.p, x: x ?? a.x, y: y ?? a.y, t: this.t, post: POST_FOULS.has(type) });
    this.note('flag', a);
  }

  // Possible injury on a hit. base = probability scale for this collision.
  maybeInjure(a, base) {
    if (hasTrait(a.p, 'iron_man')) base *= 0.5;
    base *= Math.exp((75 - (a.p.dur ?? 75)) / 25); // durable players hold up; fragile ones don't
    if (a.injured || this.kind === 'kneel' || !this.rng.chance(base)) return;
    a.injured = true;
    a.down = true; a.downT = 0; a.anim = 'down';
    this.injuries.push({ a, p: a.p, side: a.side });
    this.note('injury', a);
  }

  release(a) {
    const d = a.engaged;
    if (!d) return;
    d.blockers = d.blockers.filter((b) => b !== a);
    a.engaged = null;
  }

  throwBall(qb, target, ev) {
    const B = this.ball;
    let c = { x: ev.c.x, y: ev.c.y };
    const d0 = Math.hypot(c.x - qb.x, c.y - qb.y);
    if (!ev.away && !ev.pitch && !ev.snap) {
      const pressure = this.pass?.pressure || 0;
      const onRun = qb.d.scramble ? 1.5 : 1;
      // Error along the throw line grows fast with distance (over/under-throws); lateral error less so.
      const acc = (1.75 - qb.r.tha / 100) * 1.55 * (1 + pressure * 0.9) * onRun * throwFactor(this.cfg.weather, d0);
      const sAlong = (0.35 + d0 * 0.016 + Math.max(0, d0 - 20) * 0.06) * acc;
      const sLat = (0.35 + d0 * 0.014) * acc;
      const ux = (c.x - qb.x) / (d0 || 1), uy = (c.y - qb.y) / (d0 || 1);
      const ea = this.rng.normal(0, sAlong), el = this.rng.normal(0, sLat);
      c.x += ux * ea - uy * el; c.y += uy * ea + ux * el;
    }
    const d = Math.hypot(c.x - qb.x, c.y - qb.y);
    const T = Math.max(0.2, ev.pitch || ev.snap ? ev.T : d / ev.v);
    const z0 = ev.snap ? 0.4 : 1.95, zc = ev.snap || ev.pitch ? 1.1 : 1.35;
    B.state = 'air';
    B.holder = null;
    B.x = qb.x; B.y = qb.y; B.z = z0;
    B.vx = (c.x - qb.x) / T; B.vy = (c.y - qb.y) / T;
    B.vz = (zc - z0 + 0.5 * GRAVITY * T * T) / T;
    B.pass = { passer: qb, target, T, t0: this.t, land: c, away: !!ev.away, pitch: !!ev.pitch, snap: !!ev.snap, airYds: c.x - this.los };
    B.onGround = false;
    if (!ev.pitch && !ev.snap) {
      this.st.passer = qb; this.st.target = target; this.st.thrown = true; this.st.away = !!ev.away;
      this.st.airYds = c.x - this.los; this.st.throwT = this.t;
      this.note('throw', qb, target);
    }
  }

  startSet(instant) {
    if (instant && this.motion) {
      const M = this.motion;
      M.m.ax = M.final.x; M.m.ay = M.final.y; M.done = true;
      if (M.man) { M.man.ax = M.final.x + M.manOffset.x; M.man.ay = M.final.y + M.manOffset.y; }
    }
    for (const a of this.agents) {
      a.x = a.ax; a.y = a.ay; a.vx = 0; a.vy = 0;
      a.face = a.side === 'O' ? 0 : Math.PI;
      if (this.kind === 'kickoff' && a.side === 'D') a.face = Math.PI;
      a.anim = 'stance';
    }
    this.phase = 'set';
    this.phaseT = instant ? 1 : 0;
    if (instant) this.snap();
  }

  snap() {
    this.phase = 'live';
    this.t = 0;
    for (const a of this.agents) { a.anim = 'run'; a.hist = []; }
    if (this.cfg.preSnap) return this.preSnapFoul(this.cfg.preSnap);
    if (this.onSnap) return this.onSnap();
    const qb = this.qb();
    if (this.kind === 'kneel') {
      this.ball.holder = qb; this.ball.state = 'held';
      if (this.cfg.spike) {
        this.after(0.55, () => {
          this.st.spike = true;
          this.whistle('incomplete', this.los);
          const B = this.ball; B.state = 'dead-air'; B.holder = null; B.vx = 5; B.vy = 0; B.vz = -4; B.z = 1.4;
          qb.anim = 'throw'; qb.animT = 0;
        });
      } else if (this.cfg.intSafety) {
        // run around in the end zone, then step out of the back of it
        const y0 = qb.y;
        qb.special = (sim, a) => {
          const pts = [{ x: -2, y: y0 }, { x: -3, y: clamp(y0 + 9, 2, FIELD_W - 2) }, { x: -4, y: clamp(y0 - 6, 2, FIELD_W - 2) }, { x: -11, y: y0 }];
          a.d.si = a.d.si || 0;
          const p = pts[Math.min(a.d.si, pts.length - 1)];
          if (Math.hypot(p.x - a.x, p.y - a.y) < 1) a.d.si++;
          a.want = { x: p.x, y: p.y, spd: a.maxSpd * 0.8, arrive: false };
          if (a.x < -10 || sim.t > 7) { sim.st.intSafety = true; sim.whistle('oob', -1); }
        };
      } else {
        this.after(0.7, () => { qb.down = true; this.st.kneel = true; this.whistle('tackle', qb.x - 0.5); });
      }
      return;
    }
    // press jams at the line
    for (const d of this.def) {
      if (d.role !== 'man' || !d.d.man) continue;
      const r = d.d.man;
      if (Math.hypot(r.x - d.x, r.y - d.y) < 2.2) {
        const edge = ((d.r.str + d.r.mcv) - (r.r.str + r.r.rte)) / 200 + 0.2 + this.rng.normal(0, 0.15);
        if (edge > 0) r.d.jamT = Math.min(0.7, edge * 1.4);
        else d.stun = Math.min(0.5, -edge * 1.6);
      }
    }
    // Motion tell: did a defender travel with the motion man?
    if (this.motion && this.pass) {
      this.pass.tell = this.motion.man ? 'man' : 'zone';
      this.note('motion', this.motion.m, this.motion.man);
    }
    // Run flow: second-level defenders step downhill as the line run-blocks
    if (this.isRun && this.kind === 'scrimmage') for (const d of this.def) {
      if ((d.fpos === 'LB' || d.slot === 'SS' || d.slot === 'NB') && d.role !== 'rush' && this.rng.chance(0.85 - (d.r.awr - 55) / 90)) {
        d.d.biteUntil = 0.25 + (100 - d.r.awr) / 100 * 0.5 + this.rng.range(0, 0.3);
      }
    }
    // PA bite for linebackers / safeties
    if (this.pass?.pa) for (const d of this.def) {
      if (d.fpos === 'LB' || d.fpos === 'S') d.d.biteUntil = 0.25 + (100 - d.r.awr) / 100 * (d.fpos === 'LB' ? 0.9 : 0.5);
    }
    if (qb.x < this.los - 3) {
      // shotgun snap flies back
      this.throwBall(this.bySlotO.C, qb, { c: { x: qb.x, y: qb.y }, T: 0.32, snap: true });
      this.ball.x = this.bySlotO.C.x + 0.3; this.ball.z = 0.4;
    } else {
      this.ball.state = 'held'; this.ball.holder = qb;
    }
  }

  preSnapFoul(type) {
    const pool = type === 'false_start' ? this.off.filter((a) => a.fpos === 'OL' || a.fpos === 'TE')
      : type === 'delay_of_game' ? [this.qb()]
        : this.def.filter((a) => a.fpos === 'DE' || a.fpos === 'DT' || a.fpos === 'LB');
    const a = this.rng.pick(pool.length ? pool : this.off);
    if (type !== 'delay_of_game') { a.vx = attackDir(a) * 3.5; a.anim = 'run'; }
    this.foul(type, a);
    this.whistle('presnap', this.los);
  }

  whistle(outcome, spotX) {
    if (this.phase === 'dead') return;
    this.phase = 'dead';
    this.deadT = 0;
    this.wt = this.t;
    this.outcome = outcome;
    this.spotX = spotX;
    for (const a of this.agents) if (a.engaged) this.release(a);
    this.result = this.buildResult ? this.buildResult(outcome, spotX) : buildScrimmageResult(this, outcome, spotX);
  }

  get done() { return this.phase === 'dead' && this.deadT > 1.6; }

  runToEnd() {
    let guard = 0;
    if (this.phase !== 'live') this.startSet(true);
    while (this.phase !== 'dead' && guard++ < 60 * 40) this.step(DT);
    return this.result;
  }

  // ---------- main tick ----------
  step(dt = DT) {
    if (this.rec) recordFrame(this);
    if (this.phase === 'lineup') return this.stepLineup(dt);
    if (this.phase === 'set') {
      this.phaseT += dt;
      if (this.motion && !this.motion.done) return this.stepMotion(dt);
      if (this.phaseT > 0.9 && !this.holdSnap) this.snap(); // a user's play waits for them to snap it
      return;
    }
    if (this.phase === 'dead') return this.stepDead(dt);
    this.t += dt;
    // timers
    if (this.timers.length) {
      const due = this.timers.filter((tm) => tm.at <= this.t);
      this.timers = this.timers.filter((tm) => tm.at > this.t);
      for (const tm of due) tm.fn();
      if (this.phase !== 'live') return;
    }
    for (const a of this.agents) {
      if (a.stun > 0) a.stun -= dt;
      if (a.down && a.downT > 0) { a.downT -= dt; if (a.downT <= 0) { a.down = false; a.anim = 'run'; } }
      if (a.d.biteUntil && this.t < a.d.biteUntil && !this.runner && a.side === 'D' && !(this.ball.state === 'air' && this.ball.pass && !this.ball.pass.snap)) {
        a.want = { x: this.los + 1.5, y: a.y, spd: a.maxSpd * 0.5, arrive: true };
        continue;
      }
      think(this, a);
    }
    for (const a of this.agents) if (!a.engaged && !a.blockers.length) steer(this, a, dt);
    this.engagements(dt);
    this.collisions();
    this.updateBall(dt);
    if (this.phase !== 'live') return;
    this.checkTackles();
    if (this.phase !== 'live') return;
    this.checkBounds();
    if (this.kind === 'scrimmage') this.checkLiveFouls();
    for (const a of this.agents) {
      // effort: running and blocking both tire players out
      a.work += Math.hypot(a.vx, a.vy) * dt * 0.1 + (a.engaged || a.blockers.length ? 0.6 * dt : 0);
      a.hist.push({ x: a.x, y: a.y, vx: a.vx, vy: a.vy });
      if (a.hist.length > HIST_LEN) a.hist.shift();
      a.animT += dt;
    }
    if (this.t > MAX_PLAY_TIME) {
      const c = this.carrierAgent();
      this.whistle('tackle', c ? c.x : this.los);
    }
  }

  // Motion man jogs across during the cadence; his man defender trails him.
  stepMotion(dt) {
    const M = this.motion;
    if (this.phaseT < 0.5) return;
    const m = M.m;
    const d = Math.hypot(M.final.x - m.x, M.final.y - m.y);
    m.want = { x: M.final.x, y: M.final.y, spd: 6.5, arrive: true };
    m.faceTo = { x: m.x + (M.final.y > m.y ? 0 : 0), y: M.final.y };
    m.anim = 'run';
    steer(this, m, dt);
    if (M.man) {
      const t = M.man;
      t.want = { x: m.x + M.manOffset.x, y: m.y + M.manOffset.y, spd: t.maxSpd * 0.8, arrive: true };
      t.faceTo = { x: t.x - 5, y: t.y }; t.anim = 'run';
      steer(this, t, dt);
    }
    if (d < 0.35 || this.phaseT > 3.8) {
      M.done = true;
      m.x = M.final.x; m.y = M.final.y; m.vx = 0; m.vy = 0; m.face = 0; m.anim = 'stance';
      if (M.man) { M.man.anim = 'stance'; M.man.vx = 0; M.man.vy = 0; M.man.face = Math.PI; }
      this.phaseT = 0.75; // brief reset, then snap
    }
  }

  stepLineup(dt) {
    this.phaseT += dt;
    let maxD = 0;
    for (const a of this.agents) {
      const d = Math.hypot(a.ax - a.x, a.ay - a.y);
      maxD = Math.max(maxD, d);
      a.want = { x: a.ax, y: a.ay, spd: Math.min(a.maxSpd, 3 + d * 0.6), arrive: true };
      a.faceTo = null;
      steer(this, a, dt);
      if (d < 0.6) a.face = a.face + angleDiff(a.face, a.side === 'O' ? 0 : Math.PI) * 0.1;
      a.anim = d > 0.3 ? 'run' : 'stand';
    }
    this.collisions(true);
    const B = this.ball;
    if (this.kind === 'kickoff') { B.x = this.los; B.y = this.ballY; B.z = 0.25; }
    else { B.x = this.los; B.y = this.ballY; B.z = 0.15; }
    if (maxD < 0.3 || this.phaseT > 4.5) this.startSet(false);
  }

  stepDead(dt) {
    this.deadT += dt;
    for (const a of this.agents) {
      a.want = null;
      if (!a.down) steer(this, a, dt);
      if (a.down) { a.vx *= 0.9; a.vy *= 0.9; a.x += a.vx * dt; a.y += a.vy * dt; }
    }
    const B = this.ball;
    if (B.state === 'air' || B.state === 'dead-air') {
      B.state = 'dead-air';
      B.vz -= GRAVITY * dt; B.x += B.vx * dt; B.y += B.vy * dt; B.z += B.vz * dt;
      if (B.z <= 0.12) { B.z = 0.12; B.vz = -B.vz * 0.3; B.vx *= 0.5; B.vy *= 0.5; if (Math.abs(B.vz) < 0.6) { B.vz = 0; B.state = 'ground'; } }
    } else if (B.state === 'held' && B.holder) { this.placeHeldBall(); }
  }

  placeHeldBall() {
    const B = this.ball, h = B.holder;
    B.x = h.x + Math.cos(h.face) * 0.25; B.y = h.y + Math.sin(h.face) * 0.25;
    B.z = h.down ? 0.3 : 1.05;
    B.vx = h.vx; B.vy = h.vy; B.vz = 0;
  }

  checkLiveFouls() {
    // Defensive holding / illegal contact while routes develop
    if (!this.isRun && !this.runner && !this.st.thrown && this.t > 1.1 && !this.st.holdChecked) {
      this.st.holdChecked = true;
      for (const r of this.off) {
        if (r.role !== 'route') continue;
        const d = this.def.find((o) => !o.down && Math.hypot(o.x - r.x, o.y - r.y) < 1.3);
        if (d && this.rng.chance(0.028 * (1.5 - Math.max(d.r.mcv, d.r.zcv) / 100) / 0.6)) {
          this.foul(r.x - this.los > 5 && this.rng.chance(0.4) ? 'illegal_contact' : 'def_holding', d);
        }
      }
    }
    // Roughing the passer: a hit shortly after the release
    const B = this.ball;
    if (this.st.thrown && !this.st.away && this.st.throwT != null) {
      const dtT = this.t - this.st.throwT;
      if (dtT > 0.12 && dtT < 0.6) {
        const qb = this.st.passer;
        for (const o of this.def) {
          if (o.down || o.blockers.length || o.d.hitQB) continue;
          if (Math.hypot(o.x - qb.x, o.y - qb.y) < 1.0) {
            o.d.hitQB = true;
            if (!qb.down) { qb.down = true; qb.downT = 1.2; qb.anim = 'down'; }
            this.maybeInjure(qb, 0.012);
            const late = dtT > 0.35 ? 1.8 : 1;
            if (Math.hypot(o.vx, o.vy) > 4 && this.rng.chance(0.011 * late)) this.foul('roughing_passer', o);
          }
        }
      }
    }
  }

  // ---------- blocking ----------
  engagements(dt) {
    const passMode = !this.runner && !this.isRun;
    // new engagements
    for (const a of this.agents) {
      const t = a.d.blockOn;
      if (!t || a.engaged || a.down || t.down || t.side === a.side) continue;
      if (a.noBlock[t.uid] > this.t) continue;
      if (this.ball.holder === t && this.ball.state === 'held') continue;
      if (this.ball.holder === a) continue;
      if (t.blockers.length >= 2) continue;
      if (Math.hypot(t.x - a.x, t.y - a.y) < ENGAGE_R) {
        a.engaged = t; t.blockers.push(a); a.engT = this.t;
        if (t.blockers.length === 1) t.engT = this.t;
        // whiff chance on open-field blocks
        if (!passMode && t.fpos !== 'DT' && t.fpos !== 'DE') {
          const whiff = (a.d.escort ? 0.28 : 0.1) + (t.r.agi - a.r.agi) / 400;
          if (this.rng.chance(clamp(whiff, 0.02, 0.3))) { this.release(a); a.noBlock[t.uid] = this.t + 0.8; a.stun = 0.3; }
        }
      }
    }
    // resolve engaged defenders
    for (const t of this.agents) {
      if (!t.blockers.length) continue;
      t.blockers = t.blockers.filter((b) => {
        const ok = !b.down && b.engaged === t && (b.d.blockOn === t || b.d.blockOn == null);
        if (!ok && b.engaged === t) b.engaged = null;
        return ok;
      });
      if (!t.blockers.length) continue;
      if (t.down) { for (const b of t.blockers) b.engaged = null; t.blockers = []; continue; }
      const c = this.carrierAgent();
      const w = t.want;
      let dT = w ? norm(w.x - t.x, w.y - t.y) : { x: 0, y: 0 };
      const tSkill = passMode ? t.r.prs * 0.65 + t.r.str * 0.35 : t.r.rds * 0.65 + t.r.str * 0.35;
      const wT = Math.exp(tSkill / 16) * (0.8 + t.mass * 0.2);
      let fx = dT.x * wT, fy = dT.y * wT, wSum = wT, bestB = 0, wBsum = 0;
      for (const b of t.blockers) {
        const bSkill = passMode ? b.r.pbk * 0.65 + b.r.str * 0.35 : b.r.rbk * 0.65 + b.r.str * 0.35;
        bestB = Math.max(bestB, bSkill);
        const prot = b.d.protect || (c || this.qb() || b);
        let u = norm(t.x - prot.x, t.y - prot.y);
        if (!passMode) { const dir = attackDir(b); u = norm(u.x + dir * 0.8, u.y); }
        const wB = Math.exp(bSkill / 16) * (0.8 + b.mass * 0.2);
        fx += u.x * wB; fy += u.y * wB; wSum += wB; wBsum += wB;
      }
      if (passMode) {
        // Pass pro: blockers absorb and give ground; they don't drive rushers upfield.
        const adv = (wT - wBsum * 0.92) / (wT + wBsum);
        const sp = clamp(0.55 + adv * 4, 0.12, 2.2);
        t.vx = dT.x * sp; t.vy = dT.y * sp;
      } else {
        const nx = fx / wSum, ny = fy / wSum;
        const u = norm(nx, ny);
        // linemen who win a run block get a yard of penetration, not a free walk into the backfield
        const intoBackfield = u.x * attackDir(t.blockers[0]) < 0 && (t.fpos === 'DT' || t.fpos === 'DE');
        const sp = Math.min(intoBackfield ? 1.1 : 2.4, Math.hypot(nx, ny) * 3.6);
        t.vx = u.x * sp; t.vy = u.y * sp;
      }
      t.x += t.vx * dt; t.y += t.vy * dt;
      if (w) t.face = t.face + angleDiff(t.face, Math.atan2(dT.y, dT.x)) * 0.2;
      // place blockers in front of the defender
      const n = t.blockers.length;
      t.blockers.forEach((b, i) => {
        const prot = b.d.protect || (c || this.qb() || b);
        const pu = norm(prot.x - t.x, prot.y - t.y);
        const off = n > 1 ? (i === 0 ? -0.45 : 0.45) : 0;
        const tx = t.x + pu.x * 0.85 - pu.y * off, ty = t.y + pu.y * 0.85 + pu.x * off;
        b.vx = (tx - b.x) / dt * 0.25; b.vy = (ty - b.y) / dt * 0.25;
        const vl = Math.hypot(b.vx, b.vy); if (vl > 4) { b.vx *= 4 / vl; b.vy *= 4 / vl; }
        b.x += b.vx * dt; b.y += b.vy * dt;
        b.face = Math.atan2(t.y - b.y, t.x - b.x);
        b.anim = 'block'; t.anim = 'block';
      });
      // shed
      const engTime = this.t - (t.engT ?? this.t);
      // Interior rushers work in a phone booth against help; edge rushers have room to win.
      // Blocks in space on linebackers and DBs don't last as long as those at the line.
      const slotK = t.fpos === 'DT' ? (passMode ? 0.6 : 0.36) : t.fpos === 'DE' ? (passMode ? 1.15 : 1) : passMode ? 1 : 1.8;
      // Rating edge saturates: a big mismatch wins more often, but not exponentially more (keeps
      // wide talent gaps, like real rosters have, from snowballing into sacks and stuffs).
      const edge = 2 / (1 + Math.exp(-(tSkill - bestB) / 9));
      let lam = (passMode ? 0.25 : 0.115) * slotK * edge / (1 + 1.8 * (n - 1));
      if (engTime < (passMode ? 0.45 : 0.8)) lam *= 0.25;
      if (passMode) lam *= 1 + Math.max(0, engTime - 1.8) * 0.5;
      // near the ball carrier a defender fights off the block; in space that's much easier
      const lineman = t.fpos === 'DT' || t.fpos === 'DE';
      if (c && c !== this.qb() && Math.hypot(c.x - t.x, c.y - t.y) < (lineman ? 1.8 : 2.8)) lam *= lineman ? 1.8 : 5;
      if (t.blockers.some((b) => b.d.escort)) lam *= 2.5;
      if (this.rng.next() < lam * dt) {
        // a beaten blocker sometimes grabs instead of letting go: holding
        const hb = t.blockers[0];
        const holdSide = this.kind === 'scrimmage' ? hb.side === 'O' : hb.side === 'D';
        if (holdSide && this.rng.chance((passMode ? 0.015 : 0.011) * (1.45 - hb.r.awr / 100) * (this.kind === 'scrimmage' ? 1 : 8))) {
          this.foul(this.kind === 'scrimmage' ? 'off_holding' : (this.rng.chance(0.4) ? 'ret_block_back' : 'ret_holding'), hb);
          continue; // the hold keeps the defender engaged
        }
        for (const b of t.blockers) { b.engaged = null; b.noBlock[t.uid] = this.t + 0.9; b.anim = 'run'; }
        t.blockers = [];
        if (passMode) this.note('shed', null, t);
        const k = passMode ? 2.5 : 1.5;
        t.vx = dT.x * k; t.vy = dT.y * k;
        t.anim = 'run';
        continue;
      }
      // pancake
      if (bestB - tSkill > 8 && this.rng.next() < 0.03 * dt * (bestB - tSkill) / 8) {
        t.down = true; t.downT = 1.3; t.anim = 'down';
        for (const b of t.blockers) { b.engaged = null; b.noBlock[t.uid] = this.t + 1.5; }
        t.blockers = [];
        this.maybeInjure(t, 0.006);
        this.note('pancake', null, t);
      }
    }
  }

  collisions(soft) {
    const A = this.agents;
    const R2 = PLAYER_R * 2;
    for (let i = 0; i < A.length; i++) {
      const a = A[i];
      if (a.down) continue;
      for (let j = i + 1; j < A.length; j++) {
        const b = A[j];
        if (b.down) continue;
        if (a.engaged === b || b.engaged === a) continue;
        const dx = b.x - a.x, dy = b.y - a.y;
        const d2 = dx * dx + dy * dy;
        if (d2 >= R2 * R2 || d2 < 1e-8) continue;
        const d = Math.sqrt(d2), ov = (R2 - d) * (soft ? 0.3 : 0.5);
        const ux = dx / d, uy = dy / d;
        const ma = a.mass * (a.engaged || a.blockers.length ? 3 : 1), mb = b.mass * (b.engaged || b.blockers.length ? 3 : 1);
        const ka = mb / (ma + mb), kb = ma / (ma + mb);
        a.x -= ux * ov * ka; a.y -= uy * ov * ka;
        b.x += ux * ov * kb; b.y += uy * ov * kb;
      }
    }
  }

  // ---------- ball ----------
  updateBall(dt) {
    const B = this.ball;
    if (B.state === 'held') { this.placeHeldBall(); return; }
    if (B.state === 'roll') return rollUpdate(this, dt);
    if (B.state !== 'air') return;
    B.vz -= GRAVITY * dt;
    B.x += B.vx * dt; B.y += B.vy * dt; B.z += B.vz * dt;
    B.rot += dt * 25;
    const P = B.pass;
    if (P && P.kick) return this.kickBallUpdate(B, P);
    if (P && (P.pitch || P.snap)) {
      const r = P.target;
      if (this.t >= P.t0 + P.T * 0.75 && Math.hypot(r.x - B.x, r.y - B.y) < 1.4) {
        B.state = 'held'; B.holder = r; B.pass = null;
        if (P.pitch) { this.st.rusher = r; this.run.handed = true; this.startRun(r, { hole: { x: this.los + 1, y: this.run.holeY } }); }
        return;
      }
      if (B.z <= 0.1) {
        // bobbled snap/pitch: recovered by nearest offensive player behind the line
        B.state = 'held'; B.holder = r; B.pass = null;
        if (P.pitch) { this.st.rusher = r; this.run.handed = true; this.startRun(r); }
      }
      return;
    }
    if (P.away) {
      if (B.z <= 0.1 || B.y < -1 || B.y > FIELD_W + 1) this.whistle('incomplete', this.los);
      return;
    }
    if (B.z <= 0.12) {
      if (P.target) this.st.groundMiss = { d: Math.hypot(P.target.x - B.x, P.target.y - B.y), dx: P.target.x - B.x, dy: P.target.y - B.y, T: P.T };
      this.whistle('incomplete', this.los); return;
    }
    if (B.z > 3.4) return;
    const near = [];
    if (Math.hypot(B.x - P.passer.x, B.y - P.passer.y) < 3) return;
    const fromQB = Math.hypot(B.x - P.passer.x, B.y - P.passer.y);
    P.ignore = P.ignore || new Set();
    for (const a of this.agents) {
      if (a.down || a === P.passer || P.ignore.has(a)) continue;
      if (a.side === 'O' && a.role !== 'route' && a !== P.target) continue; // ineligible
      const d = Math.hypot(a.x - B.x, a.y - B.y);
      if (d >= 2.0 || B.z > a.height + 0.75) continue;
      // Near the line: only a rare batted ball from a rusher with hands up
      if (a.side === 'D' && (fromQB < 6 || a.role === 'rush') && d < 1.0) {
        P.ignore.add(a);
        if (B.z < a.height + 0.45 && this.rng.chance(0.07)) {
          this.st.pbu = a; this.note('batted', a);
          this.whistle('incomplete', this.los); B.vz = 3; B.vx *= -0.2; B.vy = this.rng.normal(0, 3);
          return;
        }
        continue;
      }
      near.push({ a, d });
    }
    const reach = (n) => (n.a === P.target ? 1.3 : 1.0) * (B.z < 2.6 ? 1 : 0.8);
    // resolve at the ball's closest approach to a player (or when it's about to hit the ground)
    const ready = (n) => {
      if (n.d >= reach(n)) return false;
      if (n.d < 0.5 || B.z < 0.45) return true;
      const dn = Math.hypot(B.x + B.vx * dt - (n.a.x + n.a.vx * dt), B.y + B.vy * dt - (n.a.y + n.a.vy * dt));
      return dn >= n.d;
    };
    const first = near.filter(ready).sort((x, y) => x.d - y.d)[0];
    if (!first) return;
    this.resolveCatch(first, near);
  }

  resolveCatch(first, near) {
    const B = this.ball, P = B.pass;
    const rng = this.rng;
    const offNear = near.filter((n) => n.a.side === 'O').sort((x, y) => x.d - y.d);
    const defNear = near.filter((n) => n.a.side === 'D').sort((x, y) => x.d - y.d);
    const inBounds = B.y > 0.05 && B.y < FIELD_W - 0.05 && B.x < 110;
    const cov = (d) => Math.max(d.r.mcv, d.r.zcv);
    const deflect = (d) => { this.st.pbu = d; this.whistle('incomplete', this.los); B.vx *= -0.3; B.vy = rng.normal(0, 3); B.vz = 2; };
    if (first.a.side === 'D') {
      const d = first.a;
      // an underneath defender in the throwing lane, away from the receiver: QBs throw over and
      // around these, so the ball usually gets by him
      if (P.target && Math.hypot(d.x - P.target.x, d.y - P.target.y) > 3 && rng.chance(d.fpos === 'LB' ? 0.8 : 0.6)) { P.ignore.add(d); return; }
      const contested = offNear.length && offNear[0].d < 1.2;
      let pInt = (0.07 + d.r.cth / 100 * 0.17 + (d.r.awr - 70) / 600) * (hasTrait(d.p, 'ball_hawk') ? 1.4 : 1);
      if (contested) pInt *= 0.55;
      if (!inBounds) pInt = 0;
      if (rng.chance(pInt)) return this.interception(d);
      if (rng.chance(0.7) || !offNear.length) return deflect(d);
      // tipped but receiver still has a chance
      return this.receiverAttempt(offNear[0].a, defNear, inBounds, 0.35);
    }
    return this.receiverAttempt(first.a, defNear, inBounds, 1);
  }

  receiverAttempt(r, defNear, inBounds, mult) {
    const rng = this.rng;
    const B = this.ball;
    // defenders at the catch point contest it first
    for (const n of defNear) {
      const d = n.a;
      const R = 1.8;
      if (n.d > R) continue;
      const tracking = this.t >= (d.d.ballReactAt || 99) ? 1 : 0.45;
      const skill = Math.max(d.r.mcv, d.r.zcv) / 100;
      const airY = (this.st.airYds ?? 10);
      const depthK = airY < 10 ? 0.85 : airY < 20 ? 0.95 : 1.1;
      // In phase = the defender is at least as close to the ball as the receiver (can get a hand on it).
      // Trailing defenders rarely break it up cleanly.
      const rD = Math.hypot(r.x - B.x, r.y - B.y);
      const phase = n.d <= rD + 0.25 ? 1 : 0.3;
      // a trailing defender who grabs to recover: pass interference
      if (phase < 1 && n.d < 1.3 && airY > 6 && rng.chance(0.07 * (airY > 18 ? 1.6 : 1))) this.foul('dpi', d, B.x, B.y);
      const cover = d.fpos === 'CB' ? 1.3 : d.fpos === 'S' ? 1.1 : 0.5; // DBs are the ones trained to play the ball
      const pPlay = (0.09 + skill * 0.36) * cover * (1 - (n.d / R) ** 2) * tracking * depthK * phase;
      if (rng.chance(pPlay)) {
        // contact at the catch point: pass interference (worse if not looking back for the ball)
        if (airY > 4 && n.d < 1.2 && rng.chance((tracking < 1 ? 0.45 : 0.2) * (airY > 18 ? 1.5 : 1))) {
          this.foul('dpi', d, B.x, B.y);
        } else if (rng.chance((0.17 + d.r.cth / 100 * 0.26) * (hasTrait(d.p, 'ball_hawk') ? 1.5 : 1)) && inBounds) return this.interception(d);
        this.st.pbu = d;
        this.whistle('incomplete', this.los);
        B.vz = 2; B.vy += rng.normal(0, 3);
        return;
      }
    }
    const crowd = defNear.filter((n) => n.d < 1.1).length;
    const speed = Math.hypot(r.vx, r.vy);
    const dBall = Math.hypot(r.x - B.x, r.y - B.y);
    let pCatch = (0.86 + r.r.cth / 100 * 0.13 - crowd * (hasTrait(r.p, 'possession') ? 0.03 : 0.07) - (speed > 8.5 ? 0.02 : 0)) * mult;
    if (dBall > 0.9) pCatch *= 1 - (dBall - 0.9) * 0.55; // diving / stretching catch
    pCatch *= this.cfg.weather?.catchK ?? 1;
    if (r !== this.st.target) pCatch *= 0.85;
    if (!inBounds || r.y < 0.1 || r.y > FIELD_W - 0.1) { this.st.oobCatch = true; this.whistle('incomplete', this.los); return; }
    if (crowd && (this.st.airYds ?? 0) > 4 && rng.chance(0.05)) this.foul('opi', r);
    else if (crowd && (this.st.airYds ?? 0) > 4 && rng.chance(0.08)) this.foul('dpi', defNear[0].a, B.x, B.y);
    if (rng.chance(pCatch)) {
      B.state = 'held'; B.holder = r; B.pass = null; B.vz = 0;
      this.st.catcher = r; this.st.catchX = r.x; this.st.catchT = this.t;
      this.st.catchNearD = Math.min(...this.def.filter((d) => !d.down).map((d) => Math.hypot(d.x - r.x, d.y - r.y)));
      r.vx *= 0.8; r.vy *= 0.8;
      r.anim = 'carry';
      this.startRun(r, { fromCatch: true });
      this.note('catch', r);
      if (r.x >= 100) this.whistle('td', r.x);
    } else {
      this.st.drop = r;
      this.whistle('incomplete', this.los);
      B.vz = 2.5; B.vx *= 0.2; B.vy = rng.normal(0, 2);
    }
  }

  interception(d) {
    const B = this.ball;
    B.state = 'held'; B.holder = d; B.pass = null;
    this.st.int = d; this.st.intX = d.x;
    this.st.turnover = true;
    d.d.runner = null;
    this.startRun(d, { fromCatch: true });
    d.anim = 'carry';
    this.note('int', d);
  }

  // ---------- tackles ----------
  checkTackles() {
    const c = this.carrierAgent();
    if (!c || c.down) return;
    const pocketQB = c.role === 'qb' && !c.d.runner;
    if (c === this.snapper && !c.d.runner) return;
    // a punter/holder with the ball is live too: out the back of the end zone (or the side) is dead
    if (this.kind !== 'scrimmage' && c.side === 'O' && c === this.st.kicker && (c.x < -10 || c.y < 0 || c.y > FIELD_W)) return this.whistle('oob', c.x);
    if (this.kind !== 'scrimmage' && !c.d.runner) return;
    const opp = c.side === 'O' ? this.def : this.off;
    const dirC = attackDir(c);
    const cSpd = Math.hypot(c.vx, c.vy);
    for (const o of opp) {
      if (o.down || o.stun > 0 || o.tackleCD > this.t) continue;
      const d = Math.hypot(o.x - c.x, o.y - c.y);
      // defenders arriving with the ball get a shot at the receiver as he secures it
      const justCaught = this.st.catcher === c && this.t - (this.st.catchT ?? -9) < 0.4;
      const reachR = justCaught ? 2.1 : 1.75;
      if (d > reachR) {
        // Diving / shoestring tackle when a chaser can't close the gap
        if (d < 2.1 && !pocketQB && !o.engaged && !o.blockers.length) {
          const closing = ((c.x - o.x) * (o.vx - c.vx) + (c.y - o.y) * (o.vy - c.vy)) / d;
          const chasing = (o.x - c.x) * c.vx + (o.y - c.y) * c.vy < 0; // defender behind the runner
          const atSpeed = Math.hypot(o.vx, o.vy) > o.maxSpd * 0.75;
          if (closing < 0.4 && chasing && atSpeed) {
            o.tackleCD = this.t + 1;
            const pd = 0.38 + (o.r.tak - 60) / 250 - (c.r.agi - 70) / 300 - (d - 1.55) * 0.5;
            o.down = true; o.downT = 1.1; o.anim = 'dive';
            if (this.rng.chance(pd)) return this.tackle(c, o, 0, cSpd);
            c.vx *= 0.8; c.vy *= 0.8;
            this.note('divemiss', c, o);
          }
        }
        continue;
      }
      // at the edge of reach, wait only if a closer chance is coming in the next instant
      if (d > 1.0) {
        const rx = c.x - o.x, ry = c.y - o.y, vx = c.vx - o.vx, vy = c.vy - o.vy;
        const vv = vx * vx + vy * vy;
        const tca = vv > 1e-6 ? -(rx * vx + ry * vy) / vv : 0;
        if (tca > 0.05) {
          const mx = rx + vx * tca, my = ry + vy * tca;
          if (Math.hypot(mx, my) < d - 0.15) continue;
        }
      }
      // a blocked lineman can only reach out for a runner who comes right by him;
      // a blocked linebacker or DB can come off the block to make the play
      const tied = o.engaged || o.blockers.length;
      const dl = o.fpos === 'DT' || o.fpos === 'DE';
      if (tied && dl && d > 0.9) continue;
      o.tackleCD = this.t + 0.4;
      const elus = c.r.btk * 0.55 + c.r.str * 0.2 + c.r.agi * 0.25;
      let p = 0.88 + (o.r.tak - elus) / 150;
      if (tied) p *= dl ? 0.05 : 0.45;
      if (this.st.fake && this.t < 1.0) p *= 0.3; // still in rush / return mode on a fake
      const behind = (o.x - c.x) * dirC < -0.3;
      const oSpd = Math.hypot(o.vx, o.vy);
      if (behind && cSpd > oSpd * 0.9) p -= 0.08;
      if (!behind && oSpd > 4) p += 0.05;
      if (o.d.jukedT && this.t - o.d.jukedT < 0.7) p *= 0.6;
      let helpers = 0;
      for (const o2 of opp) if (o2 !== o && !o2.down && Math.hypot(o2.x - c.x, o2.y - c.y) < 1.6) helpers++;
      p += helpers * 0.13;
      if (pocketQB) p += 0.14;
      p -= clamp((c.mass * cSpd - o.mass * 4) / 70, -0.04, 0.08);
      // arm tackles at the edge of reach are less secure
      if (d > 1.0) p *= 1 - (d - 1.0) * (justCaught ? 0.4 : 0.6);
      p = clamp(p, 0.12, 0.97);
      if (this.rng.chance(p)) return this.tackle(c, o, helpers, cSpd);
      if (o.engaged || o.blockers.length) continue;
      o.stun = d > 1.0 ? 0.3 : 0.55; o.anim = 'miss';
      c.vx *= 0.85; c.vy *= 0.85;
      this.st.missed = (this.st.missed || 0) + 1;
      this.note('broken', c, o);
    }
  }

  tackle(c, o, helpers, cSpd) {
    const dirC = attackDir(c);
    const fwdVel = (c.vx * dirC) / Math.max(1, cSpd);
    let fall = this.rng.normal(0.8, 0.45) + (hasTrait(c.p, 'power_back') ? 0.5 : 0) + (c.mass - o.mass) * 0.9 + Math.max(0, c.vx * dirC) * 0.08 + (c.r.str - o.r.str) / 120;
    fall = clamp(fall, -0.4, 2.2) * (fwdVel > -0.2 ? 1 : 0.2);
    const spot = c.x + dirC * fall;
    c.down = true; c.anim = 'down'; c.downT = 0;
    o.anim = 'tackle';
    if (this.rng.chance(0.3)) { o.down = true; o.downT = 1.4; }
    this.st.tacklers = [o];
    // injuries on the hit (harder hits, more risk)
    const force = Math.min(2, (cSpd + Math.hypot(o.vx, o.vy)) / 9);
    const pocketQB0 = c.role === 'qb' && !c.d.runner;
    this.maybeInjure(c, 0.0085 * force * (pocketQB0 ? 1.4 : 1) * (helpers ? 1.25 : 1));
    this.maybeInjure(o, 0.0035 * force);
    if (o.injured) o.downT = 0;
    if (this.rng.chance(0.009)) this.foul(this.rng.chance(0.45) ? 'face_mask' : 'unnecessary_roughness', o);
    if (helpers) {
      const h = (c.side === 'O' ? this.def : this.off).find((x) => x !== o && !x.down && Math.hypot(x.x - c.x, x.y - c.y) < 1.8);
      if (h) this.st.tacklers.push(h);
    }
    // fumble
    const pocketQB = c.role === 'qb' && !c.d.runner;
    const pF = (0.0045 + (100 - c.r.car) / 100 * 0.022) * (pocketQB ? 2.6 : 1) * (helpers ? 1.3 : 1) * (hasTrait(o.p, 'hard_hitter') ? 1.5 : 1) * (this.cfg.weather?.fumbleK ?? 1);
    // falling forward across the goal line: the ball broke the plane before he was down
    const scores = c.d.runner && ((spot >= 100 && c.side === 'O') || (spot <= 0 && c.side === 'D'));
    if (!this.st.kneel && this.rng.chance(pF) && !scores) {
      return this.fumble(c, o, spot);
    }
    if (scores) return this.whistle('td', spot);
    this.whistle('tackle', spot);
  }

  fumble(c, forcedBy, spot) {
    const B = this.ball;
    const fx = clamp(c.x + this.rng.normal(0, 2), -9, 109), fy = clamp(c.y + this.rng.normal(0, 2), 0.5, FIELD_W - 0.5);
    let best = null, bd = 1e9;
    for (const a of this.agents) {
      if (a === c) continue;
      const d = Math.hypot(a.x - fx, a.y - fy) + this.rng.range(0, 1.8) - (a.down ? -1 : 0);
      if (d < bd) { bd = d; best = a; }
    }
    this.st.fumble = { by: c, ff: forcedBy, rec: best, lost: best.side !== c.side };
    B.state = 'held'; B.holder = best;
    best.down = true; best.anim = 'down';
    this.note('fumble', c, best);
    if (best.side !== c.side) this.st.turnover = true;
    let rs = fx;
    // recovery in end zone
    if (best.side === 'D' && fx >= 100) rs = fx;
    this.whistle('tackle', rs);
  }

  checkBounds() {
    const c = this.carrierAgent();
    if (!c) return;
    // a scrambling QB who gets past the line is a runner; until then a stop behind it is a sack
    if (c.role === 'qb' && c.d.runner && !this.isRun && this.kind === 'scrimmage' && c.x > this.los) this.st.qbCrossedLos = true;
    if (c.role === 'qb' && !c.d.runner && this.kind === 'scrimmage') {
      if (c.y < 0 || c.y > FIELD_W) this.whistle('oob', c.x);
      return;
    }
    if (c === this.snapper && !c.d.runner) return;
    // a punter/holder with the ball is live too: out the back of the end zone (or the side) is dead
    if (this.kind !== 'scrimmage' && c.side === 'O' && c === this.st.kicker && (c.x < -10 || c.y < 0 || c.y > FIELD_W)) return this.whistle('oob', c.x);
    if (this.kind !== 'scrimmage' && !c.d.runner) return;
    // protecting a late lead: past the sticks with open field ahead, the runner goes down in bounds
    if (this.ctx.giveUp && c.side === 'O' && c.d.runner && this.kind === 'scrimmage' && c.x >= this.firstDownX + 0.5 && c.x < 99) {
      const near = Math.min(...this.def.filter((d) => !d.down).map((d) => Math.hypot(d.x - c.x, d.y - c.y)));
      if (near > 2.5) { this.st.gaveUp = true; c.down = true; c.anim = 'down'; return this.whistle('tackle', c.x); }
    }
    if (c.side === 'O' && c.x >= 100 && c.d.runner) return this.whistle('td', c.x);
    if (c.side === 'D' && c.x <= 0 && c.d.runner) return this.whistle('td', c.x);
    if (c.y < 0 || c.y > FIELD_W) return this.whistle('oob', c.x);
    if (c.x > 110 || c.x < -10) return this.whistle('oob', c.x);
  }
}

// ---------- physics: steering ----------
export function steer(sim, a, dt) {
  const w = a.want;
  let dvx = 0, dvy = 0;
  if (w) {
    const dx = w.x - a.x, dy = w.y - a.y, d = Math.hypot(dx, dy);
    let spd = w.spd * a.spdMul;
    if (w.arrive) spd = Math.min(spd, Math.sqrt(2 * a.acc * 1.3 * Math.max(0, d - 0.08)));
    if (d > 0.04) { dvx = (dx / d) * spd; dvy = (dy / d) * spd; }
  }
  if (a.stun > 0) { dvx *= 0.3; dvy *= 0.3; }
  let vx = a.vx, vy = a.vy;
  const sp = Math.hypot(vx, vy);
  const ex = dvx - vx, ey = dvy - vy;
  if (sp > 0.3) {
    const ux = vx / sp, uy = vy / sp;
    let along = ex * ux + ey * uy;
    let px = ex - along * ux, py = ey - along * uy;
    const aF = along > 0 ? a.acc * (1 - 0.55 * sp / a.maxSpd) : a.acc * 1.8;
    along = clamp(along, -aF * dt, aF * dt);
    const pl = Math.hypot(px, py), latMax = a.acc * (0.95 + a.agi / 170) * dt;
    if (pl > latMax) { px *= latMax / pl; py *= latMax / pl; }
    vx += along * ux + px; vy += along * uy + py;
  } else {
    const el = Math.hypot(ex, ey), lim = a.acc * dt;
    if (el > lim) { vx += (ex / el) * lim; vy += (ey / el) * lim; } else { vx += ex; vy += ey; }
  }
  // facing
  let faceTarget = null;
  if (a.faceTo) faceTarget = Math.atan2(a.faceTo.y - a.y, a.faceTo.x - a.x);
  else if (Math.hypot(dvx, dvy) > 0.8) faceTarget = Math.atan2(dvy, dvx);
  if (faceTarget != null) {
    const turn = (5.5 + a.agi / 11) * dt;
    const df = angleDiff(a.face, faceTarget);
    a.face += clamp(df, -turn, turn);
  }
  const nsp = Math.hypot(vx, vy);
  let cap = a.maxSpd * a.spdMul * (sim.ball.holder === a ? 0.96 : 1);
  if (nsp > 0.5) {
    const c = Math.cos(angleDiff(a.face, Math.atan2(vy, vx)));
    cap *= c >= 0 ? 0.6 + 0.4 * c : 0.6;
  }
  if (a.stun > 0) cap *= 0.4;
  if (nsp > cap) { vx *= cap / nsp; vy *= cap / nsp; }
  a.vx = vx; a.vy = vy;
  a.x += vx * dt; a.y += vy * dt;
}

// ---------- scrimmage result ----------
function buildScrimmageResult(sim, outcome, spotX) {
  const st = sim.st;
  const B = sim.ball;
  const holder = B.state === 'held' ? B.holder : null;
  const los = sim.los;
  const res = {
    kind: 'run', outcome, spotX: spotX ?? los, possession: 'O', td: null, safety: false, touchback: false,
    elapsed: sim.t, clockStops: false, events: [], desc: '', firstDown: false, turnover: false, oob: outcome === 'oob',
    tacklers: st.tacklers.map((a) => a.p),
  };
  const ev = (type, player, data = {}) => res.events.push({ type, pid: player?.id, side: player ? null : null, ...data });
  const nm = (a) => shortName(a?.p);
  const dirWord = (y) => (y > MID_Y + 6 ? 'left' : y < MID_Y - 6 ? 'right' : 'middle');
  let yds;
  if (outcome === 'presnap') {
    res.kind = 'penalty'; res.elapsed = 0; res.clockStops = true; res.desc = '';
    return res;
  }
  if (st.spike) {
    res.kind = 'pass'; res.outcome = 'incomplete'; res.spotX = los; res.clockStops = true;
    res.desc = `${nm(sim.qb())} spikes the ball to stop the clock.`;
    ev('pass', sim.qb().p, { att: 1 });
    return res;
  }
  if (st.intSafety) {
    res.kind = 'run'; res.safety = true; res.spotX = -1; res.clockStops = true;
    res.desc = `${nm(sim.qb())} takes an intentional safety, running out of the back of the end zone.`;
    return res;
  }
  if (st.kneel) {
    res.kind = 'kneel';
    res.spotX = los - 1; res.elapsed = Math.max(res.elapsed, 1.5); // the clock runs while the QB takes the snap and goes down
    res.desc = `${nm(sim.qb())} kneels.`;
    ev('rush', sim.qb().p, { yds: -1 });
    return res;
  }
  if (st.thrown && !st.away) {
    res.kind = 'pass';
    const qb = st.passer.p;
    const tgt = st.target?.p;
    if (st.int) {
      res.turnover = true;
      res.possession = 'D';
      const retYds = yardsBetween(res.spotX, st.intX);
      ev('pass', qb, { att: 1, int: 1 });
      if (tgt) ev('rec', tgt, { tgt: 1 });
      ev('def', st.int.p, { int: 1, intYds: retYds });
      res.desc = `${nm(st.passer)} pass ${Math.round(B.x - los) > 15 ? 'deep' : 'short'} intended for ${tgt ? shortName(tgt) : '?'} INTERCEPTED by ${nm(st.int)}`;
      if (outcome === 'td') { res.td = 'D'; res.desc += ` and returned for a TOUCHDOWN!`; }
      else if (st.fumble?.lost) { res.possession = 'O'; res.desc += `, fumbled and recovered by ${shortName(st.fumble.rec.p)}.`; }
      else if (res.spotX >= 100) { res.touchback = true; res.spotX = 80; res.desc += ` in the end zone. Touchback.`; }
      else res.desc += `, returned ${retYds} yards.`;
      res.clockStops = true;
      return res;
    }
    if (outcome === 'incomplete') {
      ev('pass', qb, { att: 1 });
      if (tgt) ev('rec', tgt, { tgt: 1 });
      if (st.pbu) ev('def', st.pbu.p, { pd: 1 });
      const where = st.target ? `${B.pass?.airYds > 15 ? 'deep' : 'short'} ${dirWord(st.target.y)}` : '';
      res.outcome = 'incomplete'; res.spotX = los; res.clockStops = true;
      res.desc = `${nm(st.passer)} pass incomplete ${where} to ${tgt ? shortName(tgt) : '?'}` +
        (st.pbu ? ` (defended by ${nm(st.pbu)})` : st.drop ? ' (dropped)' : '') + '.';
      return res;
    }
    // completion (whoever ended up with the ball, if the catch wasn't recorded)
    const catcher = st.catcher || (sim.ball.holder?.side === 'O' ? sim.ball.holder : null);
    if (!catcher) {
      ev('pass', qb, { att: 1 });
      res.outcome = 'incomplete'; res.spotX = los; res.clockStops = true;
      res.desc = `${nm(st.passer)} pass incomplete.`;
      return res;
    }
    yds = yardsBetween(los, res.spotX);
    if (outcome === 'td') { res.td = 'O'; yds = yardsBetween(los, 100); res.spotX = 100; }
    ev('pass', qb, { att: 1, cmp: 1, yds, td: res.td ? 1 : 0 });
    ev('rec', catcher.p, { tgt: catcher === st.target ? 1 : 1, rec: 1, yds, td: res.td ? 1 : 0, long: yds });
    res.desc = `${nm(st.passer)} pass ${Math.round(st.catchX - los) > 15 ? 'deep' : 'short'} ${dirWord(catcher.y)} to ${nm(catcher)} for ${yds === 0 ? 'no gain' : `${yds} yard${Math.abs(yds) === 1 ? '' : 's'}`}`;
  } else if (st.thrown && st.away) {
    res.kind = 'pass';
    ev('pass', st.passer.p, { att: 1 });
    res.outcome = 'incomplete'; res.spotX = los; res.clockStops = true;
    res.desc = `${nm(st.passer)} throws the ball away under pressure.`;
    return res;
  } else {
    // run, scramble or sack
    const carrier = st.rusher || (sim.runner) || sim.qb();
    const isQB = carrier === sim.qb();
    yds = yardsBetween(los, res.spotX);
    if (outcome === 'td') { res.td = 'O'; yds = yardsBetween(los, 100); res.spotX = 100; }
    // NFL scoring: on a pass play, a QB downed at or behind the line without throwing is sacked,
    // even after scrambling, unless he crossed the line of scrimmage first.
    if (isQB && !sim.isRun && outcome !== 'td' && !st.qbCrossedLos && res.spotX <= los) {
      res.kind = 'sack';
      let credit = st.tacklers;
      if (!credit.length) {
        // pushed out of bounds behind the line: credit the nearest pursuer, else a team sack
        const near = sim.def.filter((d) => !d.down && Math.hypot(d.x - carrier.x, d.y - carrier.y) < 2.5)
          .sort((a, b) => Math.hypot(a.x - carrier.x, a.y - carrier.y) - Math.hypot(b.x - carrier.x, b.y - carrier.y));
        credit = near.slice(0, 1);
      }
      ev('pass', carrier.p, { sack: 1, sackYds: -yds });
      for (const t of credit) ev('def', t.p, { sack: 1 / credit.length, tfl: 1 });
      const loss = yds === 0 ? 'no gain' : `${yds} yards`;
      const by = credit.length ? ` by ${credit.map(nm).join(' and ')}` : '';
      res.desc = st.scramble
        ? `${nm(carrier)} scrambles and is sacked${by} for ${loss}${outcome === 'oob' ? ' (out of bounds)' : ''}`
        : `${nm(carrier)} sacked${by} for ${loss}`;
      if (res.spotX <= 0) { res.safety = true; res.desc += ' in the end zone for a SAFETY!'; }
      else res.desc += '.';
      if (st.fumble) res.desc += ` FUMBLE, recovered by ${shortName(st.fumble.rec.p)}.`;
      if (st.fumble?.lost) { res.turnover = true; res.possession = 'D'; ev('def', st.fumble.ff.p, { ff: 1 }); ev('def', st.fumble.rec.p, { fr: 1 }); ev('fum', carrier.p, { fum: 1, lost: 1 }); }
      res.tacklers = [];
      return res;
    }
    res.kind = st.scramble ? 'scramble' : 'run';
    if (sim.run?.kept) {
      ev('rush', carrier.p, { car: 1, yds, td: res.td ? 1 : 0, long: yds });
      res.desc = `${nm(carrier)} keeps it on the read option, ${sim.run.option.keepY > MID_Y ? 'left' : 'right'} end for ${yds === 0 ? 'no gain' : `${yds} yard${Math.abs(yds) === 1 ? '' : 's'}`}`;
    } else {
      ev('rush', carrier.p, { car: 1, yds, td: res.td ? 1 : 0, long: yds });
      const gap = sim.run ? (Math.abs(sim.run.aim) > 5 ? (sim.run.dir > 0 ? 'left end' : 'right end') : Math.abs(sim.run.aim) > 1.5 ? (sim.run.dir > 0 ? 'left tackle' : 'right tackle') : 'up the middle') : dirWord(carrier.y);
      res.desc = `${nm(carrier)} ${st.scramble ? 'scrambles' : 'runs'} ${gap} for ${yds === 0 ? 'no gain' : `${yds} yard${Math.abs(yds) === 1 ? '' : 's'}`}`;
    }
  }
  // common endings for plays where the offense had the ball in the field of play
  if (res.td === 'O') { res.desc += ', TOUCHDOWN!'; res.clockStops = true; }
  else if (res.spotX <= 0 && !st.fumble) { res.safety = true; res.desc += ', tackled in the end zone. SAFETY!'; res.clockStops = true; }
  else if (outcome === 'oob') { res.desc += ' (out of bounds).'; }
  else if (st.gaveUp) { res.desc += ', and goes down in bounds to keep the clock running.'; }
  else if (st.tacklers.length) {
    res.desc += ` (${st.tacklers.map(nm).join(', ')}).`;
    if (yds < 0) ev('def', st.tacklers[0].p, { tfl: 1 });
  } else res.desc += '.';
  for (let i = 0; i < st.tacklers.length; i++) ev('def', st.tacklers[i].p, i === 0 ? { tkl: 1 } : { ast: 1 });
  if (st.fumble) {
    const f = st.fumble;
    ev('fum', f.by.p, { fum: 1, lost: f.lost ? 1 : 0 });
    if (f.lost) {
      ev('def', f.ff.p, { ff: 1 }); ev('def', f.rec.p, { fr: 1 });
      res.turnover = true; res.possession = 'D'; res.clockStops = true;
      res.desc += ` FUMBLE by ${nm(f.by)}, recovered by ${nm(f.rec)}!`;
      if (res.spotX >= 100) { res.touchback = true; res.spotX = 80; }
    } else res.desc += ` Fumble by ${nm(f.by)}, recovered by the offense.`;
  }
  return res;
}
