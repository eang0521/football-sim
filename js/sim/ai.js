// Per-agent decision making. Each think() sets agent.want = {x, y, spd, arrive}
// and optionally agent.faceTo. Physics lives in playsim.js.
import { clamp, dist, norm, pointSegDist } from '../util/vec.js';
import { FIELD_W, MID_Y, GRAVITY, DT } from './constants.js';
import { hasTrait } from '../data/traits.js';

const OL_SLOTS = new Set(['LT', 'LG', 'C', 'RG', 'RT']);
export const attackDir = (a) => (a.side === 'O' ? 1 : -1);

function goTo(a, x, y, spd = a.maxSpd, arrive = true) { a.want = { x, y, spd, arrive }; }

export function histAt(a, lag) {
  const h = a.hist;
  if (!h.length) return { x: a.x, y: a.y, vx: a.vx, vy: a.vy };
  const i = clamp(h.length - 1 - Math.round(lag / DT), 0, h.length - 1);
  return h[i];
}

// ---------------- Pursuit ----------------
export function interceptPoint(a, c, quality = 1) {
  // Solve |P + V t| = s t for the earliest meeting time (proper pursuit angle).
  const q = clamp(0.8 + 0.25 * quality, 0.75, 1.05);
  const px = c.x - a.x, py = c.y - a.y, vx = c.vx * q, vy = c.vy * q;
  const s = a.maxSpd * 0.97;
  const A = vx * vx + vy * vy - s * s, B = 2 * (px * vx + py * vy), C = px * px + py * py;
  let t = -1;
  if (Math.abs(A) < 1e-6) t = B < 0 ? -C / B : -1;
  else {
    const disc = B * B - 4 * A * C;
    if (disc >= 0) {
      const r1 = (-B - Math.sqrt(disc)) / (2 * A), r2 = (-B + Math.sqrt(disc)) / (2 * A);
      t = Math.min(...[r1, r2].filter((x) => x > 0), Infinity);
      if (!isFinite(t)) t = -1;
    }
  }
  if (t < 0 || t > 4) t = 0.5; // can't catch it: chase just ahead of the runner
  return { x: c.x + vx * t, y: clamp(c.y + vy * t, 0, FIELD_W) };
}

function pursue(sim, a, c) {
  const dd = Math.hypot(c.x - a.x, c.y - a.y);
  const dirC = attackDir(c);
  const inFront = (a.x - c.x) * dirC > -0.5;
  // Break down and mirror the runner when close and in front of him
  const p = interceptPoint(a, c, a.r.awr / 100 + (a.r.tak - 50) / 300);
  // Contain: a defender outside the runner keeps outside leverage (forces it back inside)
  const ahead = (a.x - c.x) * dirC;
  if (ahead > 0 && ahead < 12) {
    const outSign = Math.sign(c.y - MID_Y) || 1;
    if ((a.y - c.y) * outSign > 0.5) p.y += outSign * Math.min(1.2, ahead * 0.2);
  }
  goTo(a, p.x, clamp(p.y, 0.3, FIELD_W - 0.3), a.maxSpd, false);
  a.faceTo = null;
}

// ---------------- Runner vision ----------------
const HEADINGS = [];
for (let deg = -100; deg <= 100; deg += 12.5) HEADINGS.push((deg * Math.PI) / 180);
const MAX_LOOK = 12;

// Expected-yards vision: for each heading, how far can the runner get before a
// defender can intercept, projected downfield.
function runnerThink(sim, a) {
  const dir = attackDir(a);
  const R = a.d.runner || (a.d.runner = { heading: 0, t0: sim.t });
  const opp = a.side === 'O' ? sim.def : sim.off;
  const goalX = dir > 0 ? 100 : 0;
  const sinceStart = sim.t - R.t0;
  if (R.path && R.pathIdx < R.path.length) {
    const p = R.path[R.pathIdx];
    if (Math.hypot(p.x - a.x, p.y - a.y) < 1.2) R.pathIdx++;
    else { goTo(a, p.x, p.y, a.maxSpd, false); return; }
  }
  if (!R.nextEval || sim.t >= R.nextEval) {
    R.nextEval = sim.t + 0.1 + (100 - a.r.awr) * 0.002; // human reaction time
    let holeBias = 0, holeAng = 0;
    const behindLos = (a.x - sim.los) * dir < 0.5;
    if (R.hole && sinceStart < 1.2 && behindLos) {
      holeBias = 2.2 * (1 - sinceStart / 1.2);
      holeAng = Math.atan2(R.hole.y - a.y, Math.max(0.5, (R.hole.x - a.x) * dir));
    }
    const vis = a.r.awr / 100;
    const wantOOB = sim.ctx && sim.ctx.wantOOB && a.side === sim.ctx.oobSide;
    const threats = [];
    for (const o of opp) {
      if (o.down) continue;
      let pen = o.stun > 0 ? o.stun : 0;
      if (o.blockers.length) pen += 0.45 + 0.25 * o.blockers.length;
      threats.push({ x: o.x, y: o.y, spd: o.maxSpd, pen });
    }
    const vx = a.vx, vy = a.vy;
    let best = -1e9, bestAng = R.heading;
    for (const ang of HEADINGS) {
      const ux = Math.cos(ang) * dir, uy = Math.sin(ang);
      const along = vx * ux + vy * uy;
      const vAvg = Math.max(3.5, (Math.max(0, along) + a.maxSpd) / 2);
      const turn = along < 0 ? -along / a.acc : 0;
      let free = MAX_LOOK, bonus = 0;
      for (let s = 0.75; s <= MAX_LOOK; s += 0.75) {
        const px = a.x + ux * s, py = a.y + uy * s;
        if (py < 0.3 || py > FIELD_W - 0.3) { free = s; if (wantOOB) bonus += 3; break; }
        if ((px - goalX) * dir > 0.3) { free = MAX_LOOK; bonus += 6; break; }
        const tr = s / vAvg + turn;
        let hit = false;
        for (const o of threats) {
          const to = Math.max(0, Math.hypot(o.x - px, o.y - py) - 1.0) / o.spd + o.pen;
          if (to < tr) { hit = true; break; }
        }
        if (hit) { free = s; break; }
      }
      let score = free * Math.cos(ang) + free * 0.12 + bonus;
      if (holeBias) score += holeBias * Math.cos(ang - holeAng) * 2;
      score -= Math.abs(ang - R.heading) * 0.4;
      score += (sim.rng.next() - 0.5) * (1.05 - vis) * 2;
      if (score > best) { best = score; bestAng = ang; }
    }
    R.target = bestAng;
  }
  R.heading = R.heading + (R.target - R.heading) * 0.3;
  const ux = Math.cos(R.heading) * dir, uy = Math.sin(R.heading);
  // securing the catch / taking the handoff: not at full speed right away
  const secure = sim.runFromCatch && sinceStart < 0.35 ? 0.65 : 1;
  goTo(a, a.x + ux * 6, a.y + uy * 6, a.maxSpd * secure, false);
  a.faceTo = null;
  // juke check
  for (const o of opp) {
    if (o.down || o.engaged || o.stun > 0) continue;
    const dx = (o.x - a.x) * dir, d = Math.hypot(o.x - a.x, o.y - a.y);
    if (dx > 0 && d < 2.0 && !R.juked?.[o.uid]) {
      R.juked = R.juked || {};
      R.juked[o.uid] = true;
      const p = (0.03 + Math.max(0, (a.r.agi + a.r.btk) / 200 - 0.65) * 0.4 - Math.max(0, o.r.awr - 70) / 800) * (hasTrait(a.p, 'elusive') ? 1.6 : 1);
      if (sim.rng.chance(p)) {
        o.d.jukedT = sim.t;
        o.stun = Math.max(o.stun, 0.35);
        const side = Math.sign(a.y - o.y) || 1;
        a.vx *= 0.8; a.vy += side * 2.5;
        sim.note('juke', a, o);
      }
    }
  }
}

// ---------------- QB ----------------
export function predictRoutePos(r, T) {
  const R = r.d.route;
  let x = r.x, y = r.y;
  if (!R) return { x: x + r.vx * T, y: y + r.vy * T };
  // Mini-simulation of the rest of the route with acceleration and cut slowdowns.
  let vx = r.vx, vy = r.vy, i = R.idx, t = 0;
  const top = r.maxSpd * 0.97, dt = 0.05;
  while (t < T) {
    let tx, ty, want = top;
    if (i < R.pts.length) {
      const p = R.pts[i];
      tx = p.x; ty = p.y;
      const d = Math.hypot(tx - x, ty - y);
      const nxt = R.pts[i + 1];
      if (nxt) {
        const u1x = (tx - x) / (d || 1), u1y = (ty - y) / (d || 1);
        const dl = Math.hypot(nxt.x - tx, nxt.y - ty) || 1;
        const cos = u1x * (nxt.x - tx) / dl + u1y * (nxt.y - ty) / dl;
        if (cos < 0.7) {
          const cutSpd = r.maxSpd * (0.38 + 0.42 * (r.r.rte / 100)) * (0.6 + 0.4 * Math.max(0, cos + 0.3));
          want = Math.min(want, Math.sqrt(cutSpd * cutSpd + 2 * r.acc * 1.8 * d));
        }
      }
      if (d < 0.7 || (nxt && d < 1.2)) {
        // turning into the next leg costs speed (hips have to come around)
        if (nxt) {
          const sp0 = Math.hypot(vx, vy) || 1, dl = Math.hypot(nxt.x - tx, nxt.y - ty) || 1;
          const c = (vx * (nxt.x - tx) + vy * (nxt.y - ty)) / (sp0 * dl);
          const k = 0.55 + 0.45 * Math.max(0, c);
          vx *= k; vy *= k;
        }
        i++; continue;
      }
      if (R.sit && !nxt) want = Math.min(want, Math.sqrt(2 * r.acc * 1.3 * d));
    } else if (R.sit) { break; }
    else { const sp = Math.hypot(vx, vy) || 1; tx = x + vx / sp * 10; ty = y + vy / sp * 10; }
    const d = Math.hypot(tx - x, ty - y) || 1;
    const dvx = (tx - x) / d * want - vx, dvy = (ty - y) / d * want - vy;
    const sp = Math.hypot(vx, vy);
    const amax = r.acc * (1 - 0.55 * sp / r.maxSpd) * dt * 0.95;
    const dl = Math.hypot(dvx, dvy);
    const k = dl > amax ? amax / dl : 1;
    vx += dvx * k; vy += dvy * k;
    x += vx * dt; y += vy * dt;
    t += dt;
  }
  return { x, y: clamp(y, 0.8, FIELD_W - 0.8) };
}

function throwSpeed(qb, d, lob) {
  const base = 15 + qb.r.thp * 0.1;
  return lob ? Math.max(14, base - Math.max(0, d - 22) * 0.18) : base;
}

// Evaluate a throw to receiver r: returns {score (s of margin), catchPt, T, v, lob}
export function evaluateTarget(sim, qb, r) {
  if (r.down) return null;
  const R = r.d.route;
  if (R && !R.quick && sim.t < (R.delay || 0) + 0.5) return null;
  let v = throwSpeed(qb, 12, false), T = 0.5, c = { x: r.x, y: r.y }, lob = false;
  for (let k = 0; k < 4; k++) {
    c = predictRoutePos(r, T + 0.12);
    const d = Math.hypot(c.x - qb.x, c.y - qb.y);
    lob = d > 26;
    v = throwSpeed(qb, d, lob);
    T = d / v;
  }
  if (c.y < 1 || c.y > FIELD_W - 1 || c.x > 109) return null;
  const d = Math.hypot(c.x - qb.x, c.y - qb.y);
  if (d > 40 + qb.r.thp * 0.22 || T > 3.2) return null; // beyond the QB's arm
  if (R && !R.sit && R.idx === 0 && !R.quick) {
    // haven't reached the break yet: anticipation depends on awareness
    const p0 = R.pts[0];
    if (Math.hypot(p0.x - r.x, p0.y - r.y) > 3 + qb.r.awr / 40 && !sim.pass?.duress) return { notReady: true };
  }
  let margin = 9;
  for (const o of sim.def) {
    if (o.down) continue;
    const react = 0.2 + (100 - o.r.awr) / 300;
    const dist = Math.hypot(o.x - c.x, o.y - c.y);
    const dd = Math.max(0, dist - 1.2);
    // defenders already moving toward the spot get there sooner; moving away costs a turn
    const sp = Math.hypot(o.vx, o.vy);
    const cosA = sp > 0.5 && dist > 0.01 ? ((c.x - o.x) * o.vx + (c.y - o.y) * o.vy) / (dist * sp) : 0;
    const turn = (1 - cosA) * sp / (2 * o.acc);
    const vAvg = Math.min(o.maxSpd, (Math.max(0, cosA * sp) + o.maxSpd) / 2 + 1);
    const td = react + turn + dd / vAvg;
    margin = Math.min(margin, td - T);
    // lane interception on flat throws
    if (!lob) {
      const seg = pointSegDist(o, qb, c);
      if (seg.t > 0.2 && seg.t < 0.92 && seg.d < 2.2) {
        const tBall = seg.t * T;
        const tDef = react * 0.6 + Math.max(0, seg.d - 0.9) / o.maxSpd;
        margin = Math.min(margin, tDef - tBall + 0.15);
      }
    }
  }
  return { score: margin, c, T, v, lob, d, r };
}

function freeRushers(sim, qb, radius) {
  let pressure = 0, nearest = null, nd = 1e9, ttc = 9;
  for (const o of sim.def) {
    if (o.down || o.engaged || o.blockers.length || o.stun > 0) continue;
    if (o.x > sim.los - 1.0) continue; // hasn't penetrated the line yet
    const d = Math.hypot(o.x - qb.x, o.y - qb.y);
    if (d < radius) pressure = Math.max(pressure, (radius - d) / radius);
    if (d < nd) { nd = d; nearest = o; }
    // time to contact given closing speed
    const u = norm(qb.x - o.x, qb.y - o.y);
    const closing = Math.max(1.5, o.vx * u.x + o.vy * u.y);
    ttc = Math.min(ttc, Math.max(0, d - 1) / closing);
  }
  return { pressure, nearest, nd, ttc };
}

function qbPass(sim, qb) {
  const P = sim.pass;
  const los = sim.los;
  if (!P.init) {
    P.init = true;
    const uc = qb.x > los - 2;
    const depth = { quick: uc ? 3.2 : 0.6, '5': uc ? 6.2 : 1.8, '7': uc ? 7.8 : 2.8 }[P.drop] ?? 2;
    P.set = { x: (uc ? los - 1 : qb.x) - depth, y: qb.y };
    P.ri = 0; P.readT = 0; P.lastEval = -1; P.throwAt = null;
    P.minRead = P.drop === 'quick' ? 0.6 : P.drop === '5' ? 1.35 : 1.8;
    if (P.pa) P.minRead += 0.45;
    P.hot = sim.def.filter((d) => d.role === 'rush').length >= 6;
    if (sim.disguised) {
      // the post-snap picture isn't what he saw pre-snap: slower, noisier reads (awareness helps)
      P.readBonus = (P.readBonus || 1) * (1.45 - qb.r.awr / 250);
      P.minRead += 0.12;
    }
    if (P.tell) {
      // vs man: crossers and breaking routes first; vs zone: settle-in routes in the windows
      const pref = P.tell === 'man' ? ['cross', 'drag', 'drag6', 'slant', 'out', 'quickout', 'corner', 'post', 'dig']
        : ['curl', 'hook', 'stick', 'hitch', 'dig', 'in5', 'snag', 'flat', 'seam'];
      const rank = (l) => { const r = sim.bySlotO[l]?.d.route?.name; const i = pref.indexOf(r); return i < 0 ? 99 : i; };
      const first = P.prog.slice(0, 3).sort((a, b) => rank(a) - rank(b));
      P.prog = [...first, ...P.prog.slice(3)];
      P.readBonus = 0.9;
    }
    if (P.hot) P.minRead = Math.min(P.minRead, 0.7);
  }
  if (P.throwing) { goTo(qb, qb.x, qb.y, 0.5); return; }
  if (P.thrown) { goTo(qb, qb.x + 1, qb.y, 2); return; }
  const t = sim.t;
  // Movement: play-action fake, then drop, then subtle pocket movement
  if (P.pa && t < 0.55) {
    const rb = sim.bySlotO.F;
    goTo(qb, qb.x - 0.4, qb.y + (rb ? Math.sign(rb.y - qb.y || 1) * 0.5 : 0), 3);
  } else {
    const { pressure, nearest, nd, ttc } = freeRushers(sim, qb, 4.5);
    P.ttc = ttc;
    let tx = P.set.x, ty = P.set.y;
    if (nearest && nd < 4.5) {
      const away = norm(qb.x - nearest.x, qb.y - nearest.y);
      tx += away.x * 1.2 + 0.8; ty += away.y * 1.8;
    }
    goTo(qb, tx, clamp(ty, P.set.y - 3, P.set.y + 3), qb.maxSpd * (t < P.minRead ? 0.75 : 0.5));
    qb.faceTo = { x: qb.x + 10, y: qb.y + (P.look ? (P.look.y - qb.y) * 0.3 : 0) };
    P.pressure = pressure;
    P.nearD = nd;
  }
  if (P.screen && !sim.noThrow) {
    // screen: throw on timing, over the rush; dump it if the screen is smothered
    const S = P.screen;
    if (t < S.throwT) return;
    const r = S.target;
    const ev = evaluateTarget(sim, qb, r);
    const smothered = sim.def.some((d) => !d.down && !d.blockers.length && Math.hypot(d.x - r.x, d.y - r.y) < 1.2);
    if (ev && !ev.notReady && !smothered) { P.path = 'screen'; return startThrow(sim, qb, ev); }
    if (t > S.throwT + 0.6) { if (smothered && ev && !ev.notReady && sim.rng.chance(0.5)) return startThrow(sim, qb, ev); return throwAway(sim, qb); }
    return;
  }
  if (t < P.minRead - 0.1 || sim.noThrow) return;
  if (t - P.lastEval < 0.1) return;
  P.lastEval = t;
  const prog = P.prog.map((l) => sim.bySlotO[l]).filter(Boolean);
  const readTime = 0.62 - qb.r.awr * 0.0025;
  const style = hasTrait(qb.p, 'gunslinger') ? -0.12 : hasTrait(qb.p, 'game_manager') ? 0.08 : 0;
  const calm = hasTrait(qb.p, 'pocket_passer') ? 0.85 : 1;
  const noise = () => sim.rng.normal(0, 0.5 * (1.15 - qb.r.awr / 100) * (P.readBonus || 1) * calm);
  const pressure = P.pressure || 0;
  // awareness sets how early the QB feels the rush
  const underDuress = P.ttc < 0.35 + qb.r.awr / 250 || P.nearD < 1.6;
  P.duress = underDuress;
  const timeSet = t - P.minRead;
  const toGoX = sim.firstDownX;
  if (P.ri < prog.length) {
    const r = prog[P.ri];
    P.look = r;
    let ev = evaluateTarget(sim, qb, r);
    const waiting = ev && ev.notReady;
    if (waiting) ev = null;
    let thr = (P.drop === 'quick' ? 0.24 : 0.46) + style - timeSet * 0.1 - pressure * 0.25;
    if (ev && sim.ctx?.down >= 3 && ev.c.x < toGoX - 0.3 && P.ri < prog.length - 1) thr += 0.3;
    if (ev && ev.c.x - sim.los > 18) thr += (sim.cfg.weather?.windMph ?? 0) * 0.01 + (0.5 + (ev.c.x - sim.los - 18) * 0.03) * (hasTrait(qb.p, 'gunslinger') ? 0.6 : hasTrait(qb.p, 'game_manager') ? 1.4 : 1);
    if (ev && ev.score + noise() > thr) { P.path = 'read'; return startThrow(sim, qb, ev); }
    // hold on a primary read that hasn't broken yet (up to a point)
    if (!(waiting && P.ri === 0 && timeSet < 1.2)) P.readT += 0.1;
    if (P.readT >= readTime) { P.ri++; P.readT = 0; }
  }
  const late = P.ri >= prog.length;
  if (late || underDuress) {
    // scan everything: take the best option available
    let best = null;
    for (const r of sim.off) {
      if (r.role !== 'route') continue;
      const ev = evaluateTarget(sim, qb, r);
      if (!ev || ev.notReady) continue;
      const air = ev.c.x - los;
      let val = ev.score + noise() + Math.min(air, 15) * 0.03 - Math.max(0, air - 18) * 0.05;
      // on 3rd/4th down a throw that reaches the marker is worth more than a safe checkdown
      if (sim.ctx?.down >= 3) val += ev.c.x >= toGoX - 0.5 ? 0.22 : -0.12;
      if (!best || val > best.val) best = { ...ev, val };
    }
    const need = underDuress ? 0.25 : 0.15 - (timeSet - 1.5) * 0.07;
    if (best && best.val > need) { P.path = underDuress ? 'duress' : 'late'; return startThrow(sim, qb, best); }
    if (underDuress || timeSet > 3.2) {
      // escape: scramble, throw it away, or hang on (and maybe take the sack)
      if (P.escapeT && sim.t < P.escapeT) return;
      P.escapeT = sim.t + 0.35;
      const lane = scrambleLane(sim, qb);
      const scr = hasTrait(qb.p, 'scrambler') ? 2 : hasTrait(qb.p, 'pocket_passer') ? 0.3 : 1;
      if (lane > 0.5 && sim.rng.chance((0.2 + qb.r.spd / 300) * scr)) {
        qb.d.scramble = true; sim.startRun(qb); sim.note('scramble', qb); return;
      }
      if (sim.rng.chance(0.08 + qb.r.awr / 500) || timeSet > 4.5) return throwAway(sim, qb);
      if (best && best.val > -0.1 && sim.rng.chance(0.2)) return startThrow(sim, qb, best); // forced throw
    }
    if (late && timeSet > 2.4) { P.ri = 0; }
  }
}

function scrambleLane(sim, qb) {
  let open = 0;
  for (const ang of [-0.6, -0.3, 0, 0.3, 0.6]) {
    const px = qb.x + Math.cos(ang) * 4, py = qb.y + Math.sin(ang) * 4;
    let ok = 1;
    for (const o of sim.def) {
      if (o.down) continue;
      if (Math.hypot(o.x - px, o.y - py) < (o.engaged ? 1.2 : 2.6)) { ok = 0; break; }
    }
    open = Math.max(open, ok);
  }
  return open;
}

function startThrow(sim, qb, ev) {
  const P = sim.pass;
  P.throwing = true;
  sim.after(0.16, () => {
    if (sim.ball.holder !== qb || sim.phase !== 'live') return;
    P.throwing = false; P.thrown = true;
    // re-evaluate at release for accurate lead
    const e2 = evaluateTarget(sim, qb, ev.r);
    const ev2 = e2 && !e2.notReady ? e2 : ev;
    sim.throwBall(qb, ev2.r, ev2);
  });
  qb.anim = 'throw'; qb.animT = 0;
}

function throwAway(sim, qb) {
  const P = sim.pass;
  P.thrown = true;
  const side = qb.y > MID_Y ? 1 : -1;
  const target = { x: qb.x + 12, y: side > 0 ? FIELD_W + 4 : -4 };
  sim.throwBall(qb, null, { c: target, lob: true, v: 18, T: Math.hypot(target.x - qb.x, target.y - qb.y) / 18, away: true });
  qb.anim = 'throw'; qb.animT = 0;
  sim.note('throwaway', qb);
}

function qbRun(sim, qb) {
  // Handoff / toss / sneak / draw mechanics
  const R = sim.run;
  const rb = sim.bySlotO[sim.cfg.offCall.play.carrierSlot || 'F'];
  if (R.scheme === 'sneak') { if (!R.handed) { R.handed = true; sim.startRun(qb, { hole: { x: sim.los + 2, y: R.holeY } }); } return; }
  if (R.handed) { goTo(qb, qb.x - 1, qb.y - R.dir * 1, 2); return; }
  if (R.scheme === 'toss') {
    goTo(qb, qb.x - 0.5, qb.y + R.dir * 0.4, 3);
    if (sim.t > 0.3 && !R.pitched) {
      R.pitched = true;
      const T = 0.45;
      const tgt = predictLinear(rb, T);
      sim.throwBall(qb, rb, { c: tgt, lob: false, v: Math.hypot(tgt.x - qb.x, tgt.y - qb.y) / T, T, pitch: true });
    }
    return;
  }
  // option plays ride the mesh longer while the QB reads his key
  const meshT = R.scheme === 'draw' ? 0.85 : (R.option || R.rpo) ? 0.95 : qb.x > sim.los - 2 ? 0.65 : 0.45;
  if (!R.mesh) {
    const uc = qb.x > sim.los - 2;
    R.mesh = R.scheme === 'draw'
      ? { x: uc ? sim.los - 4.8 : qb.x - 0.6, y: qb.y + R.dir * 0.5 }
      : { x: uc ? sim.los - 4 : qb.x + 0.2, y: qb.y + R.dir * (uc ? 0.9 : 0.6) };
  }
  goTo(qb, R.mesh.x, R.mesh.y - R.dir * 0.5, qb.maxSpd * 0.7);
  // RPO: if the overhang defender fills against the run, pull it and throw the quick route
  if (R.rpo && !R.rpoDone && sim.t > 0.35) {
    const k = R.rpo.key, r = R.rpo.r;
    const fills = k && k.x < R.rpo.keyX0 - 0.8 && k.vx < -2;
    const read = sim.rng.normal(0, 0.25 * (1.1 - qb.r.awr / 100));
    if (fills || read > 0.45) {
      const ev = r.d.route.idx >= 1 || r.d.route.name === 'bubble' ? evaluateTarget(sim, qb, r) : null;
      if (ev && !ev.notReady && ev.score > -0.3) {
        R.rpoDone = true; R.handed = true;
        sim.pass.path = 'rpo';
        sim.note('rpo_pass', qb, k);
        return startThrow(sim, qb, ev);
      }
    }
    if (sim.t > meshT * 0.6) R.rpoDone = true;
  }
  if (sim.t > meshT * 0.6 && rb && Math.hypot(rb.x - qb.x, rb.y - qb.y) < 1.3 && !R.handed) {
    // Read option: keep it if the unblocked end crashes on the dive
    const O = R.option;
    if (O && !O.decided) {
      O.decided = true;
      const k = O.key;
      // read what the end actually does: flattening down the line toward the dive = crash
      const crashing = Math.abs(k.y - rb.y) < Math.abs(k.ay - rb.y) - 0.8;
      const misread = sim.rng.chance(0.18 * (1.1 - qb.r.awr / 100));
      if (crashing !== misread) {
        R.handed = true; R.kept = true;
        k.d.fooledUntil = sim.t + 0.45; // committed to the dive
        k.tackleCD = sim.t + 0.45;
        sim.note('keep', qb, k);
        sim.startRun(qb, { hole: { x: sim.los + 2, y: O.keepY } });
        return;
      }
    }
    R.handed = true; R.handoffT = sim.t;
    sim.handoff(qb, rb);
  }
}

function predictLinear(a, T) { return { x: a.x + a.vx * T, y: a.y + a.vy * T }; }

// ---------------- Offensive skill players ----------------
function routeThink(sim, a) {
  const R = a.d.route;
  if (!R) return;
  if (sim.t >= R.delay && a.engaged) { sim.release(a); a.d.blockOn = null; }
  if (sim.t < R.delay) {
    // check-release: help protect first
    const threat = nearestFree(sim.def, a, 3.5);
    if (threat) return blockTarget(sim, a, threat, sim.qb());
    goTo(a, a.x, a.y, 1.5); return;
  }
  if (R.idx >= R.pts.length) {
    if (R.sit) {
      // settle in the window away from nearest defender
      const end = R.pts[R.pts.length - 1];
      const d = nearestOpp(sim, a);
      let sx = end.x, sy = end.y;
      if (d && Math.hypot(d.x - a.x, d.y - a.y) < 4) sy += Math.sign(a.y - d.y) * 1.6;
      goTo(a, sx, clamp(sy, 1, FIELD_W - 1), 2.5);
      a.faceTo = sim.qb() || null;
      return;
    }
    const last = R.pts[R.pts.length - 1], prev = R.pts[R.pts.length - 2] || { x: a.x - 1, y: a.y };
    const u = norm(last.x - prev.x, last.y - prev.y);
    goTo(a, a.x + u.x * 10, clamp(a.y + u.y * 10, 1, FIELD_W - 1), a.maxSpd, false);
    return;
  }
  const p = R.pts[R.idx];
  const d = Math.hypot(p.x - a.x, p.y - a.y);
  // Sharp cut at break points: slow approach based on route running
  const next = R.pts[R.idx + 1];
  let spd = a.maxSpd * 0.97;
  if (next) {
    const u1 = norm(p.x - a.x, p.y - a.y), u2 = norm(next.x - p.x, next.y - p.y);
    const cos = u1.x * u2.x + u1.y * u2.y;
    if (cos < 0.7) {
      const cutSpd = a.maxSpd * (0.38 + 0.42 * (a.r.rte / 100)) * (0.6 + 0.4 * Math.max(0, cos + 0.3));
      const brake = a.acc * 1.8;
      spd = Math.min(spd, Math.sqrt(cutSpd * cutSpd + 2 * brake * d));
    }
  }
  if (d < 0.7 || (next && d < 1.2)) { R.idx++; }
  goTo(a, p.x, p.y, spd, R.sit && R.idx === R.pts.length - 1);
  if (a.d.jamT > sim.t) a.spdMul = 0.35;
}

function nearestOpp(sim, a) {
  const opp = a.side === 'O' ? sim.def : sim.off;
  let best = null, bd = 1e9;
  for (const o of opp) { if (o.down) continue; const d = Math.hypot(o.x - a.x, o.y - a.y); if (d < bd) { bd = d; best = o; } }
  return best;
}

function nearestFree(list, a, radius) {
  let best = null, bd = radius;
  for (const o of list) {
    if (o.down || o.blockers.length >= 1) continue;
    const d = Math.hypot(o.x - a.x, o.y - a.y);
    if (d < bd && o.role === 'rush') { bd = d; best = o; }
  }
  return best;
}

// Position between defender and the point being protected; engagement handled in physics.
function blockTarget(sim, a, d, protect, opts = {}) {
  a.d.blockOn = d;
  a.d.protect = protect;
  if (!d) return;
  const u = norm((protect?.x ?? a.x) - d.x, (protect?.y ?? a.y) - d.y);
  let tx = d.x + u.x * 0.95, ty = d.y + u.y * 0.95;
  if (opts.maxX != null) tx = Math.min(tx, opts.maxX);
  if (opts.minX != null) tx = Math.max(tx, opts.minX);
  goTo(a, tx, ty, a.maxSpd, false);
  a.faceTo = d;
}

function passBlock(sim, a) {
  const qb = sim.qb();
  if (!qb) return;
  if (a.d.screenRelease != null && sim.t >= a.d.screenRelease) {
    // screen: let the rusher go and get out in front
    if (a.engaged) { a.noBlock[a.engaged.uid] = sim.t + 5; sim.release(a); }
    a.d.blockOn = null;
    const sp = a.d.screenSpot;
    const threat = nearestDefenderTo(sim, sp, 6);
    if (threat && Math.hypot(sp.x - a.x, sp.y - a.y) < 2) return blockTarget(sim, a, threat, sim.pass.screen.target);
    goTo(a, sp.x, sp.y, a.maxSpd * 0.9, true);
    a.faceTo = { x: sp.x + 5, y: sp.y };
    return;
  }
  let t = a.d.blockOn;
  if (a.engaged) return; // physics drives engaged pairs
  if (!t || t.down || t.stun > 0.3 || (t.blockers.length >= 1 && !t.blockers.includes(a)) || a.noBlock[t.uid] > sim.t
      || Math.hypot(t.x - a.x, t.y - a.y) > 6) {
    t = pickRusher(sim, a, qb);
  }
  if (!t) {
    // no one to block: set and help inside
    const hx = Math.min(sim.los - 1.2, qb.x + 3);
    goTo(a, hx, a.d.setY ?? a.y, 3);
    a.d.setY = a.d.setY ?? a.y;
    a.d.blockOn = null;
    return;
  }
  blockTarget(sim, a, t, qb, { maxX: sim.los + 0.3, minX: qb.x + 0.8 });
}

function nearestDefenderTo(sim, p, radius) {
  let best = null, bd = radius;
  for (const d of sim.def) {
    if (d.down || d.blockers.length) continue;
    const dd = Math.hypot(d.x - p.x, d.y - p.y);
    if (dd < bd) { bd = dd; best = d; }
  }
  return best;
}

function pickRusher(sim, a, qb) {
  let best = null, bc = 1e9;
  for (const d of sim.def) {
    if (d.down || d.role !== 'rush' || a.noBlock[d.uid] > sim.t) continue;
    const taken = d.blockers.length + sim.off.filter((o) => o !== a && o.d.blockOn === d && !o.engaged).length;
    const dd = Math.hypot(d.x - a.x, d.y - a.y);
    if (dd > 7) continue;
    const c = dd + taken * 3.5 + Math.abs(d.y - a.y) * 0.5;
    if (c < bc) { bc = c; best = d; }
  }
  return best;
}

function runBlock(sim, a) {
  if (a.engaged) return;
  const c = sim.carrierAgent();
  const R = sim.run;
  let t = a.d.target;
  if (!t || t.down || a.noBlock[t.uid] > sim.t || (t.blockers.length >= 2 && !t.blockers.includes(a))) {
    t = a.d.target = pickRunTarget(sim, a, c);
  }
  if (!t) { goTo(a, a.x + 1.5, a.y, 3); return; }
  const protect = c && c !== sim.qb() ? c : { x: sim.los - 3, y: R ? R.holeY : a.y };
  const opts = {};
  if (a.d.pull && Math.abs(a.y - (R?.holeY ?? a.y)) > 1.8) opts.maxX = sim.los - 0.6;
  blockTarget(sim, a, t, protect, opts);
}

function pickRunTarget(sim, a, c) {
  let best = null, bc = 1e9;
  const ref = c || a;
  for (const d of sim.def) {
    if (d.down || a.noBlock[d.uid] > sim.t) continue;
    const dd = Math.hypot(d.x - a.x, d.y - a.y);
    if (dd > 8) continue;
    const toC = Math.hypot(d.x - ref.x, d.y - ref.y);
    const cst = dd + toC * 0.5 + d.blockers.length * 3;
    if (cst < bc) { bc = cst; best = d; }
  }
  return best;
}

function stalkBlock(sim, a) {
  if (a.engaged) return;
  const c = sim.carrierAgent();
  let t = a.d.blockOn;
  if (!t || t.down || t.blockers.length >= 1 || a.noBlock[t.uid] > sim.t) {
    // nearest DB/LB downfield
    let best = null, bd = 12;
    for (const d of sim.def) {
      if (d.down || d.blockers.length || d.role === 'rush' || a.noBlock[d.uid] > sim.t) continue;
      const dd = Math.hypot(d.x - a.x, d.y - a.y);
      if (dd < bd) { bd = dd; best = d; }
    }
    t = best;
  }
  if (!t) { goTo(a, a.x + 2, a.y, 3); return; }
  const protect = c && c !== sim.qb() ? c : { x: sim.los - 2, y: sim.ballY };
  blockTarget(sim, a, t, protect);
  if (Math.hypot(t.x - a.x, t.y - a.y) > 3) a.want.spd = a.maxSpd * 0.8;
}

// Escort the ball carrier after a catch / interception / on returns.
function escortBlock(sim, a, c) {
  if (a.engaged) return;
  const opp = a.side === 'O' ? sim.def : sim.off;
  const dir = attackDir(c);
  let t = a.d.blockOn;
  const valid = (o) => o && !o.down && !(o.blockers.length >= 1 && !o.blockers.includes(a)) && !(a.noBlock[o.uid] > sim.t);
  if (!valid(t) || Math.hypot(t.x - c.x, t.y - c.y) > 14) {
    let best = null, bc = 1e9;
    for (const o of opp) {
      if (!valid(o)) continue;
      const toC = Math.hypot(o.x - c.x, o.y - c.y);
      if (toC > 13) continue;
      const ahead = (o.x - c.x) * dir > -2 ? 0 : 6;
      const cst = Math.hypot(o.x - a.x, o.y - a.y) + toC * 0.8 + ahead;
      if (cst < bc) { bc = cst; best = o; }
    }
    t = best;
  }
  if (!t) { goTo(a, c.x + dir * 4, c.y + (a.y - c.y) * 0.5, a.maxSpd * 0.8); return; }
  a.d.escort = true;
  blockTarget(sim, a, t, c);
}

// ---------------- Defense ----------------
function rushThink(sim, a) {
  const c = sim.carrierAgent();
  const qb = sim.qb();
  // read-option key: crash the dive or squeeze and play the QB
  if (a.d.optionKey && sim.run && (!sim.run.handed || (sim.run.kept && sim.t < (a.d.fooledUntil || 0)))) {
    const rb = sim.bySlotO[sim.cfg.offCall.play.carrierSlot || 'F'];
    if (a.d.crash && rb) goTo(a, rb.x + 0.5, rb.y, a.maxSpd, false);
    else goTo(a, sim.los + 0.5, sim.run.option ? sim.run.option.keepY * 0.6 + a.y * 0.4 : a.y, a.maxSpd * 0.6, true);
    return;
  }
  if (sim.runRead(a)) return pursue(sim, a, c);
  const target = c || qb;
  if (!target) return;
  const d = Math.hypot(target.x - a.x, target.y - a.y);
  let tx = target.x, ty = target.y;
  const side = Math.sign(a.d.laneY - sim.ballY) || 1;
  const edge = a.fpos === 'DE' || (a.d.blitz && Math.abs(a.d.laneY - sim.ballY) > 3);
  if (edge && d > 2.5) { ty += side * Math.min(2.2, d * 0.35); tx -= 0.5; }
  else if (d > 3) ty = ty + (a.d.laneY - ty) * 0.25;
  goTo(a, tx, ty, a.maxSpd, false);
  a.faceTo = null;
}

function manThink(sim, a) {
  const r = a.d.man;
  if (sim.runRead(a)) return pursue(sim, a, sim.carrierAgent());
  if (!r) return;
  // Receiver stayed in to block -> become a rat/green-dog rusher
  if ((r.role === 'pblock' || r.role === 'stalk') && sim.t > 0.6) {
    if (a.fpos === 'CB') { a.role = 'zone'; a.d.zone = { x: sim.los + 8, y: r.y, r: 6, deep: false }; }
    else { a.role = 'rush'; a.d.laneY = a.y; }
    return;
  }
  if (sim.t < 0) return;
  const skill = (a.r.mcv * 0.7 + a.r.agi * 0.15 + a.r.awr * 0.15);
  const lag = clamp(0.06 + (100 - skill) / 100 * 0.3 + (r.r.rte - 70) / 100 * 0.15, 0.04, 0.38);
  const h = histAt(r, lag);
  const lead = lag + 0.12;
  let px = h.x + h.vx * lead, py = h.y + h.vy * lead;
  // Cushion: start from the alignment gap and shrink it as the route develops.
  if (a.d.cushion0 == null) a.d.cushion0 = Math.max(0.8, a.x - r.x);
  const settle = a.d.help ? 0.3 : 1.1; // trail (with help) vs on-top (no help)
  const cushion = Math.max(settle, a.d.cushion0 - sim.t * 3.2);
  const inside = Math.sign(sim.ballY - r.y) || 1;
  let tx = Math.max(px + cushion, r.x + settle * 0.6);
  let ty = py + inside * (a.d.help ? 0.7 : 0.35);
  // receiver working back to the QB (comeback/curl/drag underneath): drive on it
  if (h.vx < -1) tx = px + 0.4;
  const dRec = Math.hypot(r.x - a.x, r.y - a.y);
  goTo(a, tx, clamp(ty, 0.5, FIELD_W - 0.5), a.maxSpd, false);
  // Backpedal while there's cushion; turn and run once the receiver threatens it.
  const gap = a.x - r.x;
  a.faceTo = gap > 2.2 && r.vx > 0.5 && sim.t < 2.0 ? sim.qb() : null;
  if (a.d.jamT > sim.t) a.spdMul = 0.5;
}

function zoneThink(sim, a) {
  if (sim.runRead(a)) return pursue(sim, a, sim.carrierAgent());
  const z = a.d.zone;
  if (!z) return;
  const qb = sim.qb();
  const threats = sim.off.filter((o) => o.role === 'route' && !o.down);
  let tx = z.x, ty = z.y;
  let deepest = null;
  if (z.deep) {
    for (const o of threats) {
      const px = o.x + o.vx * 0.5, py = o.y + o.vy * 0.5;
      if (Math.abs(py - z.y) < z.r + 2 && px > sim.los + 6) if (!deepest || px > deepest.px) deepest = { o, px, py };
    }
    if (deepest) {
      const vertical = deepest.o.vx > 5;
      const cushion = (vertical ? 4.5 : 2.8) - (100 - a.r.zcv) / 100 * 1.5;
      tx = Math.max(z.x, deepest.px + cushion);
      ty = z.y + (deepest.py - z.y) * 0.75;
    }
  } else {
    let best = null, bs = 1e9;
    for (const o of threats) {
      const px = o.x + o.vx * 0.4, py = o.y + o.vy * 0.4;
      const d = Math.hypot(px - z.x, py - z.y);
      if (d < z.r * 1.35 && d < bs) { bs = d; best = { o, px, py }; }
    }
    if (best && qb) {
      const u = norm(qb.x - best.px, qb.y - best.py);
      tx = best.px + u.x * 1.4; ty = best.py + u.y * 1.4;
      const off = Math.hypot(tx - z.x, ty - z.y), lim = z.r * 1.4;
      if (off > lim) { tx = z.x + (tx - z.x) * lim / off; ty = z.y + (ty - z.y) * lim / off; }
    } else if (qb && sim.pass?.look) {
      // drift with QB's eyes
      const k = a.r.awr / 100 * 0.35;
      ty += (sim.pass.look.y - ty) * k;
    }
  }
  goTo(a, Math.min(tx, 109.5), clamp(ty, 0.5, FIELD_W - 0.5), a.maxSpd, !(z.deep && deepest));
  // Turn and run when a vertical threat eats the cushion or the landmark is far away.
  let faceQB = true;
  if (deepest && deepest.px > a.x - 8 && deepest.o.vx > 3) faceQB = false;
  if (Math.hypot(tx - a.x, ty - a.y) > 6) faceQB = false;
  a.faceTo = faceQB ? qb : null;
}

// React to a thrown ball: attack the catch point if reachable, else rally to it.
function ballReact(sim, a) {
  const B = sim.ball;
  const info = B.pass;
  if (!info || info.away) { goTo(a, a.x, a.y, 2); return; }
  const tArr = info.t0 + info.T;
  const land = info.land;
  if (a === info.target) {
    // Work to the ball: the earliest point on its flight that is catchable (chest to over-the-head)
    // and that we can reach in time. Fall back to the aim point.
    const sp = Math.hypot(a.vx, a.vy);
    let aim = land;
    for (let t = 0.05; t < 2.5; t += 0.05) {
      const bx = B.x + B.vx * t, by = B.y + B.vy * t, bz = B.z + B.vz * t - 0.5 * GRAVITY * t * t;
      if (bz < 0.3) break;
      if (bz > 2.4) continue;
      const reach = Math.min(a.maxSpd * t, sp * t + 0.5 * a.acc * t * t) + 0.9;
      if (Math.hypot(bx - a.x, by - a.y) <= reach) { aim = { x: bx, y: by }; break; }
    }
    goTo(a, aim.x, aim.y, a.maxSpd, false);
    return;
  }
  if (a.side === 'O') {
    // other receivers: continue a bit then drift toward the ball to block
    if (a.role === 'route') { goTo(a, a.x + a.vx * 0.3, a.y + a.vy * 0.3, 4); return; }
    return;
  }
  // Defender
  if (!a.d.ballReactAt) {
    const facingAway = a.faceTo == null && a.vx > 2;
    a.d.ballReactAt = info.t0 + 0.08 + (100 - a.r.awr) / 100 * 0.3 + (facingAway ? 0.2 : 0);
  }
  if (sim.t < a.d.ballReactAt) return false; // keep playing coverage until reacting
  const d = Math.hypot(land.x - a.x, land.y - a.y);
  const tLeft = tArr - sim.t;
  if (d - 1.0 <= a.maxSpd * (tLeft + 0.35)) goTo(a, land.x, land.y, a.maxSpd, false);
  else if (info.target) {
    const p = interceptPoint(a, { x: land.x, y: land.y, vx: info.target.vx * 0.5, vy: info.target.vy * 0.5 }, 1);
    goTo(a, p.x, p.y, a.maxSpd, false);
  }
  a.faceTo = null;
}

// ---------------- Main dispatcher ----------------
export function think(sim, a) {
  a.want = null; a.faceTo = null; a.spdMul = 1;
  if (a.down) return;
  if (a.special) return a.special(sim, a);
  if (sim.kind === 'kneel') {
    if (sim.cfg.intSafety && a.side === 'D' && sim.qb()) return pursue(sim, a, sim.qb());
    goTo(a, a.x, a.y, 1); return;
  }
  const B = sim.ball;
  const c = sim.carrierAgent();
  if (c === a) {
    if (a.role === 'qb' && !a.d.scramble && !sim.isRun && !a.d.runner) return qbPass(sim, a);
    if (a.role === 'qb' && sim.isRun && !a.d.runner) return qbRun(sim, a);
    return runnerThink(sim, a);
  }
  if (B.state === 'air' && B.pass && !B.pass.pitch && !B.pass.snap) {
    if (ballReact(sim, a) !== false) return;
  }
  if (c && c.d.runner) {
    if (c.side !== a.side) {
      if (a.engaged) return;
      const delay = (a.d.readDelay ?? 0.3) * (sim.runFromCatch ? 0.3 : 1);
      if (sim.t >= sim.runStartT + delay || dist(a, c) < 4 || a.role === 'rush' || a.side === 'O') return pursue(sim, a, c);
    } else {
      // teammates of the runner
      if (a.role === 'qb' && sim.isRun) return qbRun(sim, a);
      if (a.role === 'rblock' || a.role === 'lead') return runBlock(sim, a);
      if (a.role === 'stalk') return stalkBlock(sim, a);
      if (a.role === 'pblock' && sim.isRun) return runBlock(sim, a);
      return escortBlock(sim, a, c);
    }
  }
  switch (a.role) {
    case 'qb': return sim.isRun ? qbRun(sim, a) : undefined;
    case 'route': return routeThink(sim, a);
    case 'pblock': return sim.isRun && sim.run?.scheme === 'draw' && sim.run.handed ? runBlock(sim, a) : passBlock(sim, a);
    case 'rblock': case 'lead': return sim.run && sim.run.scheme === 'draw' && !sim.run.handed ? passBlock(sim, a) : runBlock(sim, a);
    case 'stalk': return stalkBlock(sim, a);
    case 'carrier': return carrierPreHandoff(sim, a);
    case 'rush': return rushThink(sim, a);
    case 'man': return manThink(sim, a);
    case 'zone': return zoneThink(sim, a);
    default: return;
  }
}

function carrierPreHandoff(sim, a) {
  const R = sim.run;
  if (!R) return;
  if (R.scheme === 'sneak') { goTo(a, sim.los - 3, a.y, 3); return; }
  if (R.scheme === 'toss') { goTo(a, sim.los - 3.5, sim.ballY + R.dir * 7, a.maxSpd); return; }
  if (!R.mesh) return;
  const early = R.scheme === 'draw' ? sim.t < 0.45 : false;
  if (early) { goTo(a, a.x, a.y, 1); return; }
  const tgt = { x: R.mesh.x, y: R.mesh.y };
  goTo(a, tgt.x, tgt.y, a.maxSpd * (R.scheme === 'draw' ? 0.6 : 0.85), false);
}

export { runnerThink, pursue, blockTarget, escortBlock, goTo, OL_SLOTS };
