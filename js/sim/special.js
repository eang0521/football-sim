// Special teams: kickoffs, punts, field goals and extra points.
// Frame: kicking team is 'O' and kicks toward +x.
import { FIELD_W, MID_Y, GRAVITY } from './constants.js';
import { Picker, makeAgent, buildRoute } from './setup.js';
import { clamp, norm } from '../util/vec.js';
import { runnerThink, pursue, escortBlock, goTo, attackDir, evaluateTarget } from './ai.js';
import { windAlong, effectiveKickDist } from './weather.js';

const shortName = (p) => (p ? `${p.first[0]}.${p.last}` : '?');

export function fgProbability(kicker, dist) {
  const r = kicker.ratings;
  const center = 50 + (r.kpw - 70) * 0.32 + (r.kac - 70) * 0.12;
  const slope = 4.2 + (r.kac - 70) * 0.05;
  const maxRange = 50 + r.kpw * 0.14;
  if (dist > maxRange + 2) return 0;
  return clamp(1 / (1 + Math.exp((dist - center) / slope)), 0, 0.995);
}

export function setupSpecial(sim, cfg) {
  if (cfg.kind === 'kickoff') return setupKickoff(sim, cfg);
  if (cfg.kind === 'punt') return setupPunt(sim, cfg);
  return setupFG(sim, cfg);
}

function takeMany(pk, list) { return list.map((pos) => pk.take(pos)); }

// Special-teams units come off the bench first; starters at these spots are usually spared.
const STARTERS = { QB: 1, RB: 1, FB: 0, WR: 3, TE: 1, OL: 5, DE: 2, DT: 2, LB: 2, CB: 2, S: 2 };
function takeBench(pk, pos, score) {
  const all = pk.d[pos] || [];
  let bench = all.filter((p, i) => i >= (STARTERS[pos] ?? 0) && !pk.used.has(p.id));
  if (score) bench = bench.sort((a, b) => score(b) - score(a));
  if (!bench.length) return pk.take(pos);
  pk.used.add(bench[0].id);
  return bench[0];
}
function benchMany(pk, list, score) { return list.map((pos) => takeBench(pk, pos, score)); }

// Returners: an imported special-teams depth chart wins; otherwise the most dangerous
// ball carrier who isn't a key starter (teams rarely risk their WR1 or RB1 on returns).
export function pickReturner(pk, kind) {
  const pool = [...(pk.d.RB || []), ...(pk.d.WR || []), ...(pk.d.CB || []), ...(pk.d.S || [])].filter((p) => !pk.used.has(p.id));
  const listed = pool.filter((p) => p.st?.[kind] != null).sort((a, b) => a.st[kind] - b.st[kind]);
  let best = listed[0];
  if (!best) {
    const score = (p) => {
      const r = p.ratings;
      const idx = (pk.d[p.pos] || []).indexOf(p);
      const starter = idx >= 0 && idx < (STARTERS[p.pos] ?? 0);
      return r.spd + r.acc * 0.5 + r.agi * 0.5 + r.btk * 0.6 + (kind === 'PR' ? r.cth * 0.6 : r.car * 0.3) - (starter ? (idx === 0 ? 28 : 14) : 0);
    };
    best = pool.sort((a, b) => score(b) - score(a))[0];
  }
  if (best) pk.used.add(best.id);
  return best || pk.take('WR');
}
const gunnerScore = (p) => p.ratings.spd * 1.2 + p.ratings.tak * 0.6 + p.ratings.agi * 0.3;

// Block chance for a kick: the rush unit's push against the protection, raised for low, long kicks.
function blockChance(sim, base) {
  const avg = (arr, f) => arr.reduce((s, a) => s + f(a), 0) / Math.max(1, arr.length);
  const rush = sim.def.filter((d) => d.x < sim.los + 2.5);
  const prot = sim.off.filter((o) => Math.abs(o.x - sim.los) < 2.5);
  const edge = avg(rush, (d) => d.r.str * 0.4 + d.r.prs * 0.3 + d.r.spd * 0.3) - avg(prot, (o) => o.r.str * 0.5 + o.r.pbk * 0.5);
  return base * Math.exp(edge / 14);
}
function blocker(sim) {
  const k = sim.st.holder || sim.st.kicker;
  return sim.def.filter((d) => !d.down).sort((a, b) => Math.hypot(a.x - k.x, a.y - k.y) - Math.hypot(b.x - k.x, b.y - k.y))[0];
}

// ---------------- Kickoff ----------------
function setupKickoff(sim, cfg) {
  const { offTeam: kt, defTeam: rt, los } = cfg;
  const kp = new Picker(kt, cfg.unavailable), rp = new Picker(rt, cfg.unavailable);
  // Skip the top starters where sensible: take depth players for coverage
  const K = kp.take('K');
  kp.used.add(kp.d.QB[0]?.id);
  const cov = benchMany(kp, ['LB', 'LB', 'S', 'S', 'CB', 'CB', 'LB', 'WR', 'RB', 'TE'], gunnerScore);
  const off = [];
  const k = makeAgent(K, 'O', 'K', los - 6, MID_Y);
  k.special = kickerKO; off.push(k);
  // Dynamic kickoff (2024+ rules): coverage lines up at the receiving 40 and can't move until the ball lands or is touched.
  const onside = cfg.kickType === 'onside';
  sim.st.kickType = cfg.kickType || 'normal';
  const ys = onside ? [8, 12, 16, 20, 23.5, 29.8, 33.3, 37.3, 41.3, 45.3] : [4, 9, 14, 19, 23.5, 29.8, 34.3, 39.3, 44.3, 49.3];
  cov.forEach((p, i) => { const a = makeAgent(p, 'O', 'COV' + i, onside ? los - 1 : los + 25, ys[i]); a.special = coverage; a.d.laneY = ys[i]; off.push(a); });
  // Return team
  const d = rp.d;
  const ret1 = pickReturner(rp, 'KR');
  const ret2 = pickReturner(rp, 'KR');
  const blk = benchMany(rp, ['LB', 'LB', 'TE', 'FB', 'LB', 'S', 'TE', 'DE', 'S']);
  const def = [];
  // onside: the "hands team" crowds up to 10-15 yards from the kick
  const r1 = makeAgent(ret1, 'D', 'KR', onside ? los + 28 : los + 62, MID_Y + 4); r1.special = returner; def.push(r1);
  const r2 = makeAgent(ret2, 'D', 'KR2', onside ? los + 18 : los + 60, MID_Y - 5); r2.special = retBlocker; def.push(r2);
  const bY = [6, 12, 18, 24, 29.5, 35.5, 41.5, 20, 33];
  blk.forEach((p, i) => { const a = makeAgent(p, 'D', 'RB' + i, onside ? los + (i < 7 ? 13 : 17) : los + (i < 7 ? 30.5 : 35), bY[i]); a.special = retBlocker; def.push(a); });
  sim.off = off; sim.def = def; sim.snapper = k;
  sim.kr = r1;
  sim.onSnap = () => {
    sim.ball.state = 'tee'; sim.ball.holder = null;
    sim.ball.x = los; sim.ball.y = MID_Y; sim.ball.z = 0.25;
  };
  sim.kickBallUpdate = kickBallUpdate;
  sim.buildResult = kickResult;
  sim.st.kicker = k;
}

// Onside: everybody chases the bouncing ball.
function chaseOnside(sim, a) {
  const B = sim.ball;
  if (sim.st.kickType !== 'onside' || sim.runner || B.state === 'tee' || sim.phase !== 'live') return false;
  // the hands team reacts a beat late to the dribbled kick
  if (a.side === 'D' && sim.t < (sim.st.kickT ?? 0) + 0.5) { goTo(a, a.x, a.y, 1); a.faceTo = B; return true; }
  goTo(a, B.x + B.vx * 0.2, B.y + B.vy * 0.2, a.maxSpd, false);
  a.faceTo = null;
  return true;
}

function kickerKO(sim, a) {
  if (sim.runner) return sim.runner.side !== a.side ? pursue(sim, a, sim.runner) : null;
  if (chaseOnside(sim, a)) return;
  if (sim.ball.state === 'tee') {
    goTo(a, sim.los - 0.3, sim.ballY, a.maxSpd * 0.8, false);
    if (Math.hypot(a.x - sim.los, a.y - sim.ballY) < 0.8) {
      const kp = a.r.kpw;
      const W = sim.cfg.weather;
      if (sim.st.kickType === 'onside') {
        const side = sim.rng.chance(0.5) ? 1 : -1;
        const land = { x: sim.los + sim.rng.range(6, 9), y: clamp(MID_Y + side * sim.rng.range(6, 14), 4, FIELD_W - 4) };
        launch(sim, a, land, 0.6, 'kickoff', { onside: true, zEnd: 0.15 });
        sim.st.kickLive = true; sim.st.kickT = sim.t;
      } else if (sim.st.kickType === 'squib') {
        const land = { x: sim.los + 38 + sim.rng.range(0, 7), y: clamp(MID_Y + sim.rng.normal(0, 7), 6, FIELD_W - 6) };
        launch(sim, a, land, 1.5, 'kickoff', { squib: true, zEnd: 0.15 });
      } else {
        const dist = 59 + (kp - 75) * 0.3 + sim.rng.normal(0, 4.5) + (W ? W.kickYds + windAlong(W, sim.cfg.dir) * 0.25 : 0);
        const land = { x: Math.min(sim.los + dist, 108), y: clamp(MID_Y + sim.rng.normal(0, 6), 6, FIELD_W - 6) };
        launch(sim, a, land, 3.9 + sim.rng.normal(0, 0.2), 'kickoff');
      }
      a.anim = 'kick'; a.animT = 0;
    }
    return;
  }
  goTo(a, a.x + 6, a.y, a.maxSpd * 0.6);
}

function launch(sim, from, land, T, kind, extra = {}) {
  const B = sim.ball;
  B.state = 'air'; B.holder = null;
  B.x = kind === 'kickoff' ? sim.los : from.x + 0.6; B.y = kind === 'kickoff' ? sim.ballY : from.y;
  B.z = kind === 'kickoff' ? 0.25 : 1.0;
  B.vx = (land.x - B.x) / T; B.vy = (land.y - B.y) / T;
  const zEnd = extra.zEnd ?? 0.9;
  B.vz = (zEnd - B.z + 0.5 * GRAVITY * T * T) / T;
  B.pass = { kick: true, kind, t0: sim.t, T, land, ...extra };
  sim.st.kickFrom = from.x; sim.st.land = land;
  sim.note(kind, from);
}

function coverage(sim, a) {
  const B = sim.ball;
  if (sim.runner && sim.runner.side !== a.side) return pursue(sim, a, sim.runner);
  if (sim.runner) return escortBlock(sim, a, sim.runner);
  if (chaseOnside(sim, a)) return;
  if (sim.kind === 'kickoff' && !sim.st.kickLive) { goTo(a, a.x, a.y, 0.5); a.faceTo = B; return; }
  if (B.state === 'tee') { goTo(a, sim.los - 0.8, a.y, 2.5); return; }
  const land = B.pass?.land || { x: a.x + 20, y: a.y };
  // lanes converge on the landing spot
  const ty = a.d.laneY + (land.y - a.d.laneY) * clamp((a.x - sim.los) / (land.x - sim.los), 0, 1) * 0.8;
  goTo(a, Math.min(land.x - 4, a.x + 10), ty, a.maxSpd, false);
}

function retBlocker(sim, a) {
  const w = sim.st.fakeTarget;
  if (w && sim.kind === 'punt' && !sim.runner && sim.t > 0.45 + (100 - a.r.awr) / 250) {
    goTo(a, w.x + w.vx * 0.3 + 1, w.y + w.vy * 0.3, a.maxSpd, false);
    return;
  }
  const c = fooled(sim, a) ? null : sim.runner;
  if (c && c.side === a.side) return escortBlock(sim, a, c);
  if (c && c.side !== a.side) return pursue(sim, a, c);
  if (chaseOnside(sim, a)) return;
  const B = sim.ball;
  const land = B.pass?.land;
  if (!land) { goTo(a, a.x, a.y, 1); return; }
  if (sim.kind === 'kickoff' && !sim.st.kickLive) { goTo(a, a.x, a.y, 0.5); a.faceTo = B; return; }
  // set up a wall between coverage and landing spot, facing the coverage team
  const depth = sim.kind === 'kickoff' ? 14 : 10;
  goTo(a, Math.min(land.x - depth + (a.slot === 'KR2' ? 6 : 0), a.x + 25), a.y + (land.y - a.y) * 0.3, a.maxSpd * 0.8);
  a.faceTo = { x: sim.los, y: a.y };
}

function returner(sim, a) {
  const B = sim.ball;
  if (sim.carrierAgent() === a && a.d.runner) return runnerThink(sim, a);
  if (sim.runner && sim.runner.side !== a.side) return pursue(sim, a, sim.runner);
  if (sim.runner) return escortBlock(sim, a, sim.runner);
  if (chaseOnside(sim, a)) return;
  const land = B.pass?.land;
  if (!land || !B.pass?.kick) { goTo(a, a.x, a.y, 1); return; }
  if (B.pass.letBounce) { goTo(a, land.x - 8, land.y, a.maxSpd * 0.6); a.faceTo = B; return; }
  goTo(a, land.x + 0.2, land.y, a.maxSpd, true);
  a.faceTo = B;
}

function kickBallUpdate(B, P) {
  const sim = this;
  const t = sim.t;
  if (P.kind === 'fg' || P.kind === 'xp') {
    if (B.x >= 110 || B.z <= 0.1 || t > P.t0 + P.T + 0.4) {
      if (!sim.st.fgDone) {
        sim.st.fgDone = true;
        sim.whistle(P.good ? 'fg_good' : 'fg_miss', sim.los);
        B.state = 'dead-air';
      }
    }
    return;
  }
  // Out of bounds in flight (low)
  if ((B.y < 0 || B.y > FIELD_W) && B.z < 1.5) return sim.whistle('oob', B.x);
  const ret = sim.kr;
  if (!P.letBounce && !P.onside && ret && !ret.down && t > P.t0 + P.T * 0.6 && B.z < 2.7) {
    if (Math.hypot(ret.x - B.x, ret.y - B.y) < 1.3) {
      if (sim.rng.chance(0.012 + (100 - ret.r.cth) / 100 * 0.02)) {
        // muff: ball falls, return team recovers most of the time
        B.vx *= 0.2; B.vy *= 0.2; B.vz = 1.5; sim.st.muff = true;
        P.letBounce = true;
        return;
      }
      B.state = 'held'; B.holder = ret; B.pass = null;
      sim.st.catchX = ret.x; sim.st.kickLive = true;
      if (P.fairCatch) return sim.whistle('fair_catch', ret.x);
      if (P.kind === 'kickoff' && ret.x > 100 && (ret.x > 103 || sim.rng.chance(0.6))) return sim.whistle('touchback', ret.x);
      ret.vx = -2; ret.vy = 0;
      sim.startRun(ret);
      sim.note('return', ret);
      return;
    }
  }
  if (B.z <= 0.12) {
    sim.st.kickLive = true;
    // hit the ground
    if (P.onside) {
      // the ball takes a big hop and keeps bouncing: whoever wins the scrum gets it
      B.state = 'roll'; B.onside = true; B.rollT = 0; B.pass = null;
      B.vx = sim.rng.range(3, 6.5); B.vy = sim.rng.normal(0, 2.5); B.vz = 0; B.z = 0.12;
      return;
    }
    if (P.kind === 'kickoff') {
      if (B.x >= 100) return sim.whistle('touchback', B.x);
      // nearest returner scoops it
      const r = sim.def.slice().sort((p, q) => Math.hypot(p.x - B.x, p.y - B.y) - Math.hypot(q.x - B.x, q.y - B.y))[0];
      B.state = 'held'; B.holder = r; B.pass = null; sim.kr = r;
      r.special = returner;
      sim.startRun(r);
      return;
    }
    // punt: bounce and roll
    if (B.x >= 100) return sim.whistle('touchback', B.x);
    B.state = 'roll';
    const rollSpd = Math.max(0, sim.rng.normal(4.5, 3));
    const u = norm(B.vx, B.vy);
    B.vx = u.x * rollSpd + sim.rng.normal(0, 1); B.vy = u.y * rollSpd * 0.6 + sim.rng.normal(0, 1.5); B.vz = 0; B.z = 0.12;
    B.rollT = 0;
  }
}

function onsideScrum(sim, dt) {
  const B = sim.ball;
  B.rollT += dt;
  B.vx *= 1 - 1.1 * dt; B.vy *= 1 - 1.1 * dt;
  B.x += B.vx * dt; B.y += B.vy * dt;
  B.z = 0.12 + Math.abs(Math.sin(B.rollT * 7)) * Math.min(0.9, Math.hypot(B.vx, B.vy) * 0.15);
  B.rot += dt * 10;
  if (B.y < 0 || B.y > FIELD_W) return sim.whistle('oob', B.x);
  // the kicking team may only recover once the ball has gone 10 yards
  const legal = (a) => a.side === 'D' || B.x >= sim.los + 10;
  const cands = sim.agents.filter((a) => !a.down && legal(a) && Math.hypot(a.x - B.x, a.y - B.y) < 0.9 && !(a.d.grabT > sim.t));
  cands.sort((p, q) => Math.hypot(p.x - B.x, p.y - B.y) - Math.hypot(q.x - B.x, q.y - B.y));
  for (const a of cands) {
    a.d.grabT = sim.t + 0.35;
    if (sim.rng.chance(a.side === 'D' ? 0.36 : 0.5)) {
      B.state = 'held'; B.holder = a; B.onside = false;
      a.down = true; a.anim = 'down';
      sim.st.onsideRec = a;
      return sim.whistle('onside', B.x);
    }
    B.vx = sim.rng.normal(0, 3); B.vy = sim.rng.normal(0, 3); // bobbled
  }
  if (Math.hypot(B.vx, B.vy) < 0.3 || B.rollT > 5) {
    const r = sim.agents.filter((a) => !a.down && legal(a))
      .sort((p, q) => Math.hypot(p.x - B.x, p.y - B.y) + sim.rng.range(0, 1) - Math.hypot(q.x - B.x, q.y - B.y) - sim.rng.range(0, 1))[0];
    if (r) { B.state = 'held'; B.holder = r; sim.st.onsideRec = r; r.down = true; return sim.whistle('onside', B.x); }
  }
}

export function rollUpdate(sim, dt) {
  const B = sim.ball;
  if (B.onside) return onsideScrum(sim, dt);
  B.rollT += dt;
  B.vx *= 1 - 1.4 * dt; B.vy *= 1 - 1.4 * dt;
  B.x += B.vx * dt; B.y += B.vy * dt;
  B.rot += dt * Math.hypot(B.vx, B.vy) * 3;
  B.z = 0.12 + Math.abs(Math.sin(B.rollT * 6)) * Math.min(0.5, Math.hypot(B.vx, B.vy) * 0.08);
  if (B.x >= 100) return sim.whistle('touchback', B.x);
  if (B.y < 0 || B.y > FIELD_W) return sim.whistle('oob', B.x);
  const sp = Math.hypot(B.vx, B.vy);
  // a coverage player touching it downs it
  const toucher = sim.off.find((a) => !a.down && Math.hypot(a.x - B.x, a.y - B.y) < 1.0);
  if (sp < 0.3 || toucher || B.rollT > 3) sim.whistle('downed', B.x);
}

function kickResult(outcome, spotX) {
  const sim = this;
  const st = sim.st;
  const res = {
    kind: 'kickoff', outcome, spotX, possession: 'D', td: null, safety: false, touchback: false,
    elapsed: sim.t, clockStops: true, events: [], desc: '', turnover: false, oob: outcome === 'oob',
    tacklers: (st.tacklers || []).map((a) => a.p),
  };
  const k = st.kicker;
  const kdist = Math.round((st.land?.x ?? spotX) - sim.los);
  const ret = sim.kr;
  const nm = (a) => shortName(a?.p);
  res.events.push({ type: 'kick', pid: k.p.id, ko: 1, tb: outcome === 'touchback' ? 1 : 0 });
  if (outcome === 'onside') {
    const r = st.onsideRec;
    res.spotX = clamp(spotX, 1, 99);
    res.kind = 'onside';
    if (r.side === 'O') { res.possession = 'O'; res.desc = `ONSIDE KICK RECOVERED by ${nm(r)}! ${nm(k)} gets it back for the kicking team.`; }
    else res.desc = `Onside kick by ${nm(k)} is recovered by ${nm(r)}.`;
    return res;
  }
  if (sim.st.kickType === 'squib' && outcome !== 'td') res.squib = true;
  if (outcome === 'touchback') {
    res.touchback = true; res.spotX = 65;
    res.desc = `${nm(k)} kicks ${kdist} yards. Touchback.`;
    return res;
  }
  if (outcome === 'oob' && !st.catchX) {
    res.spotX = 60;
    res.desc = `${nm(k)} kicks out of bounds. Ball placed at the 40.`;
    return res;
  }
  const retYds = Math.round((st.catchX ?? spotX) - spotX);
  res.events.push({ type: 'ret', pid: ret.p.id, kr: 1, yds: retYds, td: outcome === 'td' ? 1 : 0 });
  res.desc = `${nm(k)} ${sim.st.kickType === 'squib' ? 'squibs it' : 'kicks'} ${kdist} yards, ${nm(ret)} returns ${retYds} yards`;
  if (outcome === 'td') { res.td = 'D'; res.spotX = 0; res.desc += ' for a TOUCHDOWN!'; return res; }
  if (spotX >= 100 && !st.fumble) { res.touchback = true; res.spotX = 80; res.desc += ', downed in the end zone. Touchback.'; return res; }
  finishTackle(sim, res, st);
  return res;
}

function finishTackle(sim, res, st) {
  const nm = (a) => shortName(a?.p);
  if (res.outcome === 'oob') res.desc += ' (out of bounds).';
  else if (st.tacklers?.length) {
    res.desc += ` (${st.tacklers.map(nm).join(', ')}).`;
    st.tacklers.forEach((t, i) => res.events.push({ type: 'def', pid: t.p.id, ...(i === 0 ? { tkl: 1 } : { ast: 1 }) }));
  } else res.desc += '.';
  if (st.fumble) {
    const f = st.fumble;
    res.events.push({ type: 'fum', pid: f.by.p.id, fum: 1, lost: f.lost ? 1 : 0 });
    if (f.lost) {
      res.possession = 'O'; res.turnover = true;
      res.desc += ` FUMBLE! Recovered by ${nm(f.rec)}.`;
    } else res.desc += ` Fumble, recovered by ${nm(f.rec)}.`;
  }
}

// ---------------- Punt ----------------
function setupPunt(sim, cfg) {
  const { offTeam: kt, defTeam: rt, los, ballY } = cfg;
  const kp = new Picker(kt, cfg.unavailable), rp = new Picker(rt, cfg.unavailable);
  const P = kp.take('P');
  const line = takeMany(kp, ['OL', 'OL', 'OL', 'OL', 'OL']);
  const wings = benchMany(kp, ['TE', 'LB']);
  const pp = takeBench(kp, 'FB');
  const gun = benchMany(kp, ['CB', 'WR'], gunnerScore);
  const off = [];
  const lineY = [0, 1.3, -1.3, 2.6, -2.6];
  line.forEach((p, i) => {
    const a = makeAgent(p, 'O', i === 0 ? 'LS' : 'PL' + i, los - 0.6, ballY + lineY[i]);
    a.special = puntProtect; off.push(a);
  });
  wings.forEach((p, i) => { const a = makeAgent(p, 'O', 'W' + i, los - 1.5, ballY + (i ? -3.6 : 3.6)); a.special = puntProtect; off.push(a); });
  const ppA = makeAgent(pp, 'O', 'PP', los - 5, ballY + 0.8); ppA.special = puntProtect; off.push(ppA);
  gun.forEach((p, i) => { const a = makeAgent(p, 'O', 'G' + i, los - 0.8, i ? 3.5 : FIELD_W - 3.5); a.special = gunner; off.push(a); });
  const pA = makeAgent(P, 'O', 'P', los - 14, ballY); pA.special = punter; off.push(pA);
  // return team
  const d = rp.d;
  const ret1 = pickReturner(rp, 'PR');
  const rush = benchMany(rp, ['DE', 'DT', 'LB', 'LB', 'DE', 'LB']);
  const jam = benchMany(rp, ['CB', 'CB'], gunnerScore);
  const back = benchMany(rp, ['S', 'S']);
  const def = [];
  const rY = [3.2, 1.3, -0.7, -2.2, -3.8, 5.5];
  rush.forEach((p, i) => { const a = makeAgent(p, 'D', 'PR' + i, los + 0.9, ballY + rY[i]); a.special = puntRush; def.push(a); });
  jam.forEach((p, i) => {
    const a = makeAgent(p, 'D', 'J' + i, los + 1.2, i ? 3.5 : FIELD_W - 3.5);
    a.special = jammer; a.d.gunner = off.find((o) => o.slot === 'G' + i); def.push(a);
  });
  back.forEach((p, i) => { const a = makeAgent(p, 'D', 'B' + i, los + 9, ballY + (i ? -6 : 6)); a.special = retBlocker; def.push(a); });
  const puntSpot = los - 14;
  const r1 = makeAgent(ret1, 'D', 'PRET', clamp(los + 44 + (P.ratings.kpw - 75) * 0.3, 0, 103), MID_Y);
  r1.special = returner; def.push(r1);
  sim.off = off; sim.def = def; sim.snapper = off[0]; sim.kr = r1;
  sim.st.kicker = pA;
  sim.st.fake = !!cfg.fake;
  if (sim.st.fake) {
    const wingSlot = sim.rng.chance(0.5) ? 'W0' : 'W1';
    const wing = off.find((a) => a.slot === wingSlot);
    wing.special = null;
    wing.role = 'route';
    wing.d.route = buildRoute(wing, 'arrow', Math.sign(wing.y - ballY) || 1, los);
    sim.st.fakeTarget = wing;
  }
  sim.onSnap = () => {
    sim.throwBall(sim.snapper, pA, { c: { x: pA.x, y: pA.y }, T: 0.75, snap: true });
    sim.ball.z = 0.4;
  };
  sim.kickBallUpdate = kickBallUpdate;
  sim.buildResult = puntResult;
}

function punter(sim, a) {
  const B = sim.ball;
  if (sim.runner && sim.runner.side !== a.side) return pursue(sim, a, sim.runner);
  if (sim.st.fake && B.state === 'held' && B.holder === a) return fakeThrow(sim, a, 0.45);
  if (B.state === 'held' && B.holder === a && !sim.st.punted) {
    goTo(a, a.x + 0.8, a.y, 1.5);
    if (!a.d.caughtT) a.d.caughtT = sim.t;
    if (sim.t - a.d.caughtT > 1.15) {
      sim.st.punted = true;
      if (sim.rng.chance(blockChance(sim, 0.004))) {
        // BLOCKED: the ball caroms back behind the line
        sim.st.blocked = blocker(sim);
        launch(sim, a, { x: a.x - sim.rng.range(2, 9), y: a.y + sim.rng.normal(0, 4) }, 0.9, 'punt', { letBounce: true, zEnd: 0.3, blocked: true });
        a.anim = 'kick'; a.animT = 0;
        return;
      }
      const r = a.r;
      // gross distance measured from the line of scrimmage
      const W = sim.cfg.weather;
      let gross = 46 + (r.kpw - 75) * 0.35 + sim.rng.normal(0, 5) + (W ? W.kickYds + windAlong(W, sim.cfg.dir) * 0.3 : 0);
      const toGoal = 100 - sim.los;
      // pin it inside the 10 when the field is short
      if (toGoal < 58) gross = Math.min(gross, toGoal - 6 - (r.kac / 100) * 3 + sim.rng.normal(0, 3.5));
      const land = { x: Math.min(sim.los + gross, 115), y: clamp(MID_Y + sim.rng.normal(0, 7), 4, FIELD_W - 4) };
      const hang = clamp(4.2 + (r.kpw - 75) * 0.02 + sim.rng.normal(0, 0.3), 3.3, 5.2) * (gross < 38 ? 0.85 : 1);
      const extra = {};
      if (land.x >= 92 && land.x < 100) extra.letBounce = true;
      if (land.x >= 100) extra.letBounce = true;
      launch(sim, a, land, hang, 'punt', extra);
      a.anim = 'kick'; a.animT = 0;
      // fair catch decision made when the ball is kicked, based on projected coverage
      const ret = sim.kr;
      const gunners = sim.off.filter((o) => o.slot.startsWith('G'));
      const soonest = Math.min(...gunners.map((g) => Math.max(0, Math.hypot(g.x - land.x, g.y - land.y) - 3) / g.maxSpd));
      if (!extra.letBounce && soonest < hang + 0.9 && sim.rng.chance(0.6 + (100 - ret.r.awr) / 300)) B.pass.fairCatch = true;
    }
    return;
  }
  goTo(a, a.x + 3, a.y, 3);
}

function puntProtect(sim, a) {
  const c = sim.runner;
  if (c && c.side !== a.side) return pursue(sim, a, c);
  if (sim.ball.state === 'air' && sim.ball.pass?.kick) {
    // release into coverage
    if (a.engaged) sim.release(a);
    a.d.blockOn = null;
    const land = sim.ball.pass.land;
    goTo(a, land.x - 5, land.y + (a.y - sim.ballY) * 1.5, a.maxSpd, false);
    return;
  }
  const p = sim.off.find((o) => o.slot === 'P');
  let best = null, bd = 5;
  for (const d of sim.def) {
    if (d.down || d.special !== puntRush) continue;
    const dd = Math.hypot(d.x - a.x, d.y - a.y);
    if (dd < bd && d.blockers.length < 1) { bd = dd; best = d; }
  }
  if (a.engaged) return;
  if (best) {
    a.d.blockOn = best; a.d.protect = p;
    const u = norm(p.x - best.x, p.y - best.y);
    goTo(a, best.x + u.x * 0.9, best.y + u.y * 0.9, a.maxSpd, false);
  } else goTo(a, a.x - 0.5, a.y, 2);
}

function gunner(sim, a) {
  const c = sim.runner;
  if (c && c.side !== a.side) return pursue(sim, a, c);
  if (sim.phase !== 'live') return;
  const land = sim.ball.pass?.land || sim.st.land;
  const tx = land ? land.x - 1.5 : a.x + 20;
  const ty = land ? land.y + Math.sign(a.y - MID_Y) * 2 : a.y;
  goTo(a, tx, a.x < tx - 15 ? a.y + (ty - a.y) * 0.15 : ty, a.maxSpd, !!land);
  if (land && sim.ball.state === 'roll') goTo(a, sim.ball.x, sim.ball.y, a.maxSpd, false);
}

function jammer(sim, a) {
  const c = fooled(sim, a) ? null : sim.runner;
  if (c && c.side === a.side) return escortBlock(sim, a, c);
  if (c && c.side !== a.side) return pursue(sim, a, c);
  const g = a.d.gunner;
  if (!g) return;
  a.d.blockOn = g; a.d.protect = sim.kr;
  const u = norm(sim.kr.x - g.x, sim.kr.y - g.y);
  goTo(a, g.x + u.x * 0.9, g.y + u.y * 0.9, a.maxSpd, false);
}

// On a fake the return unit keeps doing its punt-return job for a beat before it recognizes the run.
const fooled = (sim, a) => sim.st.fake && sim.t < 0.55 + (100 - a.r.awr) / 100 * 0.6;

function puntRush(sim, a) {
  const c = fooled(sim, a) ? null : sim.runner;
  if (c && c.side === a.side) return escortBlock(sim, a, c);
  if (c && c.side !== a.side) return pursue(sim, a, c);
  const B = sim.ball;
  if (B.state === 'air' && B.pass?.kick) {
    // peel back to set up the return
    const land = B.pass.land;
    goTo(a, land.x - 14, a.y + (land.y - a.y) * 0.4, a.maxSpd * 0.85);
    return;
  }
  const p = sim.off.find((o) => o.slot === 'P');
  if (sim.t > 1.4 && a.slot !== 'PR2') { goTo(a, a.x + 3, a.y, 3); return; }
  goTo(a, p.x, p.y, a.maxSpd, false);
}

function puntResult(outcome, spotX) {
  const sim = this;
  const st = sim.st;
  const res = {
    kind: 'punt', outcome, spotX, possession: 'D', td: null, safety: false, touchback: false,
    elapsed: sim.t, clockStops: true, events: [], desc: '', turnover: false, oob: outcome === 'oob',
    tacklers: (st.tacklers || []).map((a) => a.p),
  };
  const P = st.kicker;
  const nm = (a) => shortName(a?.p);
  if (st.fake) return fakePassResult(sim, res, outcome, spotX, st.kicker, 'FAKE PUNT!');
  if (!st.punted) {
    // snap trouble: punter tackled with the ball
    res.possession = 'D'; res.turnover = true;
    res.desc = `Punt is blocked/botched! ${nm(P)} is swarmed.`;
    res.spotX = Math.min(spotX, sim.los);
    return res;
  }
  if (st.blocked) {
    // the rush team scoops it up; now and then it goes the other way for six
    const B = st.blocked;
    res.events.push({ type: 'punt', pid: P.p.id, punts: 1, yds: 0 }, { type: 'def', pid: B.p.id, blk: 1 });
    const land = sim.st.land?.x ?? sim.los - 5;
    if (sim.rng.chance(land < 12 ? 0.45 : 0.14)) {
      res.td = 'D'; res.spotX = 0;
      res.desc = `${nm(P)}'s punt is BLOCKED by ${nm(B)}! The punt team can't cover it... TOUCHDOWN return!`;
    } else {
      res.spotX = clamp(land, 1, sim.los);
      if (res.spotX <= 0.5) { res.safety = true; res.possession = 'O'; }
      res.desc = `${nm(P)}'s punt is BLOCKED by ${nm(B)}! Recovered at the ${fieldSpot(res.spotX)}.`;
    }
    return res;
  }
  let gross = Math.round((outcome === 'touchback' ? 100 : (st.catchX ?? spotX)) - sim.los);
  if (outcome === 'touchback') {
    res.touchback = true; res.spotX = 80;
    res.events.push({ type: 'punt', pid: P.p.id, punts: 1, yds: gross, tb: 1 });
    res.desc = `${nm(P)} punts ${gross} yards into the end zone. Touchback.`;
    return res;
  }
  if (outcome === 'downed' || (outcome === 'oob' && !st.catchX)) {
    gross = Math.round(spotX - sim.los);
    res.events.push({ type: 'punt', pid: P.p.id, punts: 1, yds: gross, in20: spotX >= 80 ? 1 : 0 });
    res.desc = `${nm(P)} punts ${gross} yards, ${outcome === 'oob' ? 'out of bounds' : 'downed'}.`;
    return res;
  }
  res.events.push({ type: 'punt', pid: P.p.id, punts: 1, yds: gross, in20: spotX >= 80 ? 1 : 0 });
  const ret = sim.kr;
  if (outcome === 'fair_catch') {
    res.desc = `${nm(P)} punts ${gross} yards, fair catch by ${nm(ret)}.`;
    res.events.push({ type: 'ret', pid: ret.p.id, pr: 1, yds: 0, fc: 1 });
    return res;
  }
  const retYds = Math.round((st.catchX ?? spotX) - spotX);
  res.events.push({ type: 'ret', pid: ret.p.id, pr: 1, yds: retYds, td: outcome === 'td' ? 1 : 0 });
  res.desc = `${nm(P)} punts ${gross} yards, ${nm(ret)} returns ${retYds} yards`;
  if (outcome === 'td') { res.td = 'D'; res.spotX = 0; res.desc += ' for a TOUCHDOWN!'; return res; }
  finishTackle(sim, res, st);
  return res;
}

// Fakes: the kicker/holder/punter throws to a wing who leaked out.
function fakeThrow(sim, a, after) {
  if (sim.st.fakeThrown) return;
  const w = sim.st.fakeTarget;
  if (!a.d.caughtT) a.d.caughtT = sim.t;
  goTo(a, a.x - 0.3, a.y + Math.sign(w.y - a.y) * 1.2, 3);
  if (sim.t - a.d.caughtT < after) return;
  const ev = evaluateTarget(sim, a, w);
  if ((ev && !ev.notReady) || sim.t - a.d.caughtT > after + 0.7) {
    sim.st.fakeThrown = true;
    const c = ev && !ev.notReady ? ev : { c: { x: w.x + 2, y: w.y }, v: 16, T: 0.5 };
    sim.throwBall(a, w, c);
    a.anim = 'throw'; a.animT = 0;
  }
}

function fakePassResult(sim, res, outcome, spotX, thrower, head) {
  const st = sim.st;
  res.fake = true; res.kind = 'pass'; res.possession = 'O'; res.clockStops = false; res.events = [];
  const w = st.fakeTarget;
  const nmA = (x) => shortName(x?.p);
  if (st.catcher) {
    let yds = Math.round((spotX ?? sim.los) - sim.los);
    if (outcome === 'td') { res.td = 'O'; yds = Math.round(100 - sim.los); res.spotX = 100; res.clockStops = true; }
    else res.spotX = spotX;
    res.events.push({ type: 'pass', pid: thrower.p.id, att: 1, cmp: 1, yds, td: res.td ? 1 : 0 });
    res.events.push({ type: 'rec', pid: st.catcher.p.id, tgt: 1, rec: 1, yds, td: res.td ? 1 : 0, long: yds });
    res.desc = `${head} ${nmA(thrower)} throws to ${nmA(st.catcher)} for ${yds} yard${Math.abs(yds) === 1 ? '' : 's'}${res.td ? ', TOUCHDOWN!' : '.'}`;
    if (st.tacklers?.length) st.tacklers.forEach((t, i) => res.events.push({ type: 'def', pid: t.p.id, ...(i === 0 ? { tkl: 1 } : { ast: 1 }) }));
    if (st.fumble?.lost) { res.possession = 'D'; res.turnover = true; }
  } else if (st.int) {
    res.possession = 'D'; res.turnover = true; res.spotX = spotX;
    res.events.push({ type: 'pass', pid: thrower.p.id, att: 1, int: 1 });
    res.desc = `${head} ${nmA(thrower)}'s pass is INTERCEPTED by ${nmA(st.int)}.`;
  } else if (!st.fakeThrown) {
    res.kind = 'sack'; res.spotX = spotX;
    res.desc = `${head} ${nmA(thrower)} is swarmed before he can throw.`;
  } else {
    res.spotX = sim.los; res.clockStops = true;
    res.events.push({ type: 'pass', pid: thrower.p.id, att: 1 });
    res.desc = `${head} ${nmA(thrower)}'s pass for ${nmA(w)} falls incomplete.`;
  }
  return res;
}

function yardLine(ballOn) {
  const b = Math.round(ballOn);
  return b <= 50 ? `own ${b}` : `opp ${100 - b}`;
}

// ---------------- Field goal / PAT ----------------
function setupFG(sim, cfg) {
  const { offTeam: kt, defTeam: rt, los, ballY } = cfg;
  const kp = new Picker(kt, cfg.unavailable), rp = new Picker(rt, cfg.unavailable);
  const K = kp.take('K');
  const H = kp.take('P');
  const line = takeMany(kp, ['OL', 'OL', 'OL', 'OL', 'OL', 'TE', 'TE', 'TE', 'OL']);
  const off = [];
  const lineY = [0, 1.3, -1.3, 2.6, -2.6, 3.9, -3.9, 5.0, -5.0];
  line.forEach((p, i) => {
    const a = makeAgent(p, 'O', i === 0 ? 'LS' : 'FL' + i, los - (i < 7 ? 0.6 : 1.4), ballY + lineY[i]);
    a.special = fgProtect; off.push(a);
  });
  const hA = makeAgent(H, 'O', 'H', los - 7, ballY); hA.special = holder; off.push(hA);
  const kA = makeAgent(K, 'O', 'K', los - 9.5, ballY + 1.8); kA.special = fgKicker; off.push(kA);
  const rush = takeMany(rp, ['DE', 'DT', 'DT', 'DE', 'DT', 'DE', 'LB', 'LB', 'LB', 'S', 'CB']);
  const def = [];
  const rY = [0.7, -0.7, 2.0, -2.0, 3.3, -3.3, 4.6, -4.6, 6.2, 0, -6.2];
  rush.forEach((p, i) => {
    const a = makeAgent(p, 'D', 'FR' + i, los + (i < 9 ? 0.9 : 7), ballY + rY[i]);
    a.special = fgRush; def.push(a);
  });
  sim.off = off; sim.def = def; sim.snapper = off[0];
  sim.st.kicker = kA; sim.st.holder = hA;
  sim.st.fake = !!cfg.fake;
  if (sim.st.fake) {
    const wingSlot = sim.rng.chance(0.5) ? 'FL7' : 'FL8';
    const wing = off.find((a) => a.slot === wingSlot);
    wing.special = null;
    wing.role = 'route';
    wing.d.route = buildRoute(wing, 'arrow', Math.sign(wing.y - ballY) || 1, los);
    sim.st.fakeTarget = wing;
  }
  const dist = Math.round(100 - los + 17);
  sim.st.fgDist = dist;
  sim.onSnap = () => {
    sim.throwBall(sim.snapper, hA, { c: { x: hA.x, y: hA.y }, T: 0.45, snap: true });
    sim.ball.z = 0.4;
  };
  sim.kickBallUpdate = kickBallUpdate;
  sim.buildResult = fgResult;
}

function holder(sim, a) {
  if (sim.st.fake && sim.carrierAgent() === a) return fakeThrow(sim, a, 0.5);
  goTo(a, a.x, a.y, 0.5);
  if (sim.ball.holder === a) { a.anim = 'kneel'; sim.ball.z = 0.35; }
}
function fgKicker(sim, a) {
  const B = sim.ball;
  const h = sim.st.holder;
  if (sim.st.kicked || sim.st.fake) { goTo(a, a.x + 1, a.y, 1.5); return; }
  if (B.holder === h && sim.t > 0.75) {
    goTo(a, h.x - 0.6, h.y + 0.4, 5, false);
    if (Math.hypot(a.x - (h.x - 0.6), a.y - (h.y + 0.4)) < 0.4 || sim.t > 1.6) {
      sim.st.kicked = true;
      const W = sim.cfg.weather;
      const p = Math.max(0, fgProbability(a.p, effectiveKickDist(W, sim.st.fgDist, sim.cfg.dir)) - (W?.fgPen ?? 0));
      const xp = sim.kind === 'xp';
      if (sim.rng.chance(blockChance(sim, xp ? 0.006 : 0.009 + Math.max(0, sim.st.fgDist - 35) * 0.0007))) {
        sim.st.blocked = blocker(sim);
        launch(sim, h, { x: h.x - sim.rng.range(-2, 8), y: h.y + sim.rng.normal(0, 5) }, 0.9, xp ? 'xp' : 'fg', { good: false, zEnd: 0.2, blocked: true });
        sim.ball.x = h.x; sim.ball.z = 0.35;
        a.anim = 'kick'; a.animT = 0;
        return;
      }
      const good = sim.rng.chance(p);
      const kx = h.x;
      const T = (110 - kx) / 22;
      let y = MID_Y + sim.rng.normal(0, 1);
      let zEnd = 5 + sim.rng.range(0, 4);
      if (good) y = MID_Y + clamp(sim.rng.normal(0, 1.1), -2.6, 2.6);
      else {
        const range = 50 + a.r.kpw * 0.14;
        if (sim.st.fgDist > range - 3 && sim.rng.chance(0.6)) { zEnd = 1.5; sim.st.short = true; }
        else { y = MID_Y + (sim.rng.chance(0.5) ? 1 : -1) * sim.rng.range(3.5, 6); sim.st.wide = y > MID_Y ? 'left' : 'right'; }
      }
      launch(sim, h, { x: 110, y }, T, sim.kind === 'xp' ? 'xp' : 'fg', { good, zEnd });
      sim.ball.x = h.x; sim.ball.z = 0.35;
      a.anim = 'kick'; a.animT = 0;
    }
    return;
  }
  goTo(a, a.x, a.y, 0.5);
}
function fgProtect(sim, a) {
  if (a.engaged) return;
  let best = null, bd = 3;
  for (const d of sim.def) {
    const dd = Math.hypot(d.x - a.x, d.y - a.y);
    if (dd < bd && d.blockers.length < 1) { bd = dd; best = d; }
  }
  if (best) { a.d.blockOn = best; a.d.protect = sim.st.holder; goTo(a, best.x - 0.8, best.y, 3, false); }
  else goTo(a, a.x, a.y, 1);
}
function fgRush(sim, a) {
  const h = sim.st.holder;
  if (sim.phase !== 'live') return;
  if (sim.runner && !fooled(sim, a)) return pursue(sim, a, sim.runner);
  // the two defenders playing back pick up a leaking wing once they read the fake
  const w = sim.st.fakeTarget;
  if (w && a.ax > sim.los + 3 && sim.t > 0.35 + (100 - a.r.awr) / 250) {
    goTo(a, w.x + w.vx * 0.3 + 1, w.y + w.vy * 0.3, a.maxSpd, false);
    return;
  }
  goTo(a, h.ax, h.ay, a.maxSpd, false);
}

function fgResult(outcome, spotX) {
  const sim = this;
  const st = sim.st;
  const K = st.kicker;
  const xp = sim.kind === 'xp';
  const good = outcome === 'fg_good';
  const res = {
    kind: xp ? 'xp' : 'fg', outcome, spotX: sim.los, possession: 'O', td: null, safety: false, touchback: false,
    elapsed: sim.t, clockStops: true, events: [], desc: '', turnover: false, good, dist: st.fgDist, tacklers: [],
  };
  const nm = shortName(K.p);
  if (st.fake && !xp) return fakePassResult(sim, res, outcome, spotX, st.holder, 'FAKE FIELD GOAL!');
  if (st.blocked) {
    const B = st.blocked;
    res.good = false; res.blocked = true;
    res.events.push({ type: 'kick', pid: K.p.id, ...(xp ? { xpa: 1, xpm: 0 } : { fga: 1, fgm: 0 }) }, { type: 'def', pid: B.p.id, blk: 1 });
    const land = sim.st.land?.x ?? sim.los - 5;
    res.recoverX = clamp(land, 1, sim.los);
    if (!xp && sim.rng.chance(0.12)) res.returnTD = true;
    res.desc = `${nm}'s ${xp ? 'extra point' : `${st.fgDist}-yard field goal`} is BLOCKED by ${shortName(B.p)}!${res.returnTD ? ' Scooped up and returned for a TOUCHDOWN!' : ''}`;
    return res;
  }
  if (xp) {
    res.events.push({ type: 'kick', pid: K.p.id, xpa: 1, xpm: good ? 1 : 0 });
    res.desc = good ? `${nm} extra point is GOOD.` : `${nm} extra point is NO GOOD${st.wide ? ` (wide ${st.wide})` : ''}.`;
  } else {
    res.events.push({ type: 'kick', pid: K.p.id, fga: 1, fgm: good ? 1 : 0, long: good ? st.fgDist : 0 });
    res.desc = `${nm} ${st.fgDist}-yard field goal is ${good ? 'GOOD' : `NO GOOD${st.short ? ' (short)' : st.wide ? ` (wide ${st.wide})` : ''}`}.`;
  }
  return res;
}

function fieldSpot(x) { const b = Math.round(x); return b <= 50 ? `own ${b}` : `opp ${100 - b}`; }
