// Builds agents for a scrimmage play: personnel, alignment and assignments.
import { FORMATIONS, ROUTES, defaultRoute, FRONTS, SLOT_POS, COVERAGES } from './playbook.js';
import { MID_Y, FIELD_W, physFromRatings } from './constants.js';
import { depthChart } from '../data/teamgen.js';
import { clamp } from '../util/vec.js';
import { TRAITS } from '../data/traits.js';

const FALLBACK = {
  QB: ['QB', 'RB'], RB: ['RB', 'FB', 'WR'], FB: ['FB', 'TE', 'RB'], WR: ['WR', 'TE', 'RB'], TE: ['TE', 'FB', 'OL'],
  OL: ['OL', 'DT'], DE: ['DE', 'DT', 'LB'], DT: ['DT', 'DE'], LB: ['LB', 'S', 'DE'], CB: ['CB', 'S'], S: ['S', 'CB'],
  K: ['K', 'P'], P: ['P', 'K'],
};

// Fatigue at which a starter comes off for a breather (if a fresher backup exists).
const ROTATE_AT = { DE: 0.74, DT: 0.74, RB: 0.82, FB: 0.62, LB: 0.6, CB: 0.55, S: 0.55, WR: 0.52, TE: 0.56, OL: 0.42, QB: 0, K: 0, P: 0 };

export class Picker {
  constructor(team, unavailable) {
    this.d = depthChart(team);
    this.used = new Set(unavailable || []); // injured players are never picked
  }
  take(pos) {
    const energy = CTX?.energy;
    for (const p2 of FALLBACK[pos] || [pos]) {
      const list = (this.d[p2] || []).filter((p) => !this.used.has(p.id));
      let pl = list[0];
      if (pl && energy) {
        const e0 = energy.get(pl.id) ?? 1;
        if (e0 < (ROTATE_AT[p2] ?? 0.5)) {
          const fresh = list.slice(1).find((p) => (energy.get(p.id) ?? 1) > e0 + 0.15 && p.ovr >= pl.ovr - 16);
          if (fresh) pl = fresh;
        }
      }
      // Backfield committees: the RB2 gets a share of the snaps even when the starter is fresh
      // (less of one behind a workhorse).
      if (pl && p2 === 'RB' && pos === 'RB' && CTX?.rng && list.length > 1 && pl === list[0]) {
        const rb2 = list[1];
        const share = (pl.traits || []).includes('workhorse') ? 0.12 : 0.26;
        if (rb2.ovr >= pl.ovr - 22 && CTX.rng.chance(share)) pl = rb2;
      }
      if (pl) { this.used.add(pl.id); return pl; }
    }
    // absolute fallback: anyone
    for (const k in this.d) {
      const pl = this.d[k].find((p) => !this.used.has(p.id));
      if (pl) { this.used.add(pl.id); return pl; }
    }
    return null;
  }
}

let AGENT_UID = 0;
// Per-play context: energy (fatigue) and rating modifiers (momentum / clutch).
let CTX = null;
export function setAgentContext(cfg) { CTX = cfg || null; }

const PHYS = ['spd', 'acc', 'agi'];
const POWER = ['str', 'prs', 'pbk', 'rbk', 'rds', 'tak', 'btk'];
const MENTAL = ['awr', 'tha', 'cth', 'rte', 'mcv', 'zcv', 'tak', 'prs', 'pbk', 'rbk', 'rds', 'kac'];

// Ratings as they play today: traits, fatigue, then momentum/clutch.
export function effectiveRatings(player, side) {
  const r = { ...player.ratings };
  for (const t of player.traits || []) {
    const b = TRAITS[t]?.bump;
    if (b) for (const k in b) r[k] += b[k];
  }
  const e = CTX?.energy?.get(player.id) ?? 1;
  if (e < 1) {
    for (const k of PHYS) r[k] *= 0.9 + 0.1 * e;
    for (const k of POWER) r[k] *= 0.88 + 0.12 * e;
  }
  const mod = CTX?.mod ? CTX.mod(player, side) : 0;
  if (mod) for (const k of MENTAL) r[k] += mod;
  for (const k in r) r[k] = Math.max(15, Math.min(99, r[k]));
  return r;
}

export function makeAgent(player, side, slot, x, y) {
  const r = effectiveRatings(player, side);
  const ph = physFromRatings({ ...player, ratings: r });
  const W = CTX?.weather;
  if (W) { ph.acc *= W.footing; ph.maxSpd *= W.speedK; }
  return {
    uid: ++AGENT_UID, id: player.id, p: player, r, side, slot, pos: player.pos, work: 0,
    x, y, vx: 0, vy: 0, face: side === 'O' ? 0 : Math.PI,
    maxSpd: ph.maxSpd, acc: ph.acc, agi: ph.agi, mass: ph.mass, height: ph.height,
    role: 'idle', d: {}, want: null, faceTo: null,
    engaged: null, blockers: [], stun: 0, tackleCD: 0, noBlock: {}, down: false, downT: 0,
    hist: [], spdMul: 1, ax: x, ay: y, anim: 'stand', animT: 0,
  };
}

function clampY(y) { return clamp(y, 1.2, FIELD_W - 1.2); }

// Absolute route waypoints for an agent.
export function buildRoute(agent, routeName, outSign, los) {
  const def = ROUTES[routeName];
  // backfield players measure route depth from the line of scrimmage
  const bx = los != null && agent.x < los - 2.2 ? los - 0.5 : agent.x;
  const pts = def.pts.map(([d, o]) => ({ x: bx + d, y: clampY(agent.y + o * outSign) }));
  return { name: routeName, pts, sit: !!def.sit, quick: !!def.quick, delay: def.delay || 0, idx: 0, screen: !!def.screen,
    firstLen: Math.hypot(def.pts[0][0], def.pts[0][1]) };
}

// Zone landmark (frame coords)
export function zoneSpot(name, los, ballY, flats) {
  const depthScale = clamp((110 - los) / 20, 0.35, 1);
  const Z = {
    thirdL: [16, 44.5, 11, true], thirdM: [18, (MID_Y * 2 + ballY) / 3, 11, true], thirdR: [16, 8.8, 11, true],
    halfL: [17, 39.5, 13, true], halfR: [17, 13.8, 13, true],
    quarterL1: [14, 45.5, 8, true], quarterL2: [15, 33.5, 8, true], quarterR2: [15, 19.8, 8, true], quarterR1: [14, 7.8, 8, true],
    deepM: [18, (MID_Y + ballY) / 2, 16, true],
    flatL: flats === 'squat' ? [4, 46, 7] : [7, 42, 8], flatR: flats === 'squat' ? [4, 7.3, 7] : [7, 11.3, 8],
    hookL: [8, ballY + 6, 6], hookR: [8, ballY - 6, 6], hookM: [9, ballY, 6],
  }[name];
  const depth = Z[0] * (Z[3] ? depthScale : Math.max(0.6, depthScale));
  return { name, x: Math.min(los + depth, 109), y: Z[1], r: Z[2], deep: !!Z[3] };
}

function underZones(n) {
  if (n >= 5) return ['flatL', 'hookL', 'hookM', 'hookR', 'flatR'];
  if (n === 4) return ['flatL', 'hookL', 'hookR', 'flatR'];
  if (n === 3) return ['flatL', 'hookM', 'flatR'];
  if (n === 2) return ['hookL', 'hookR'];
  if (n === 1) return ['hookM'];
  return [];
}

export function setupScrimmage(sim, cfg) {
  const { offTeam, defTeam, offCall, defCall, los, ballY } = cfg;
  const form = FORMATIONS[offCall.formation];
  const f = offCall.flip ? -1 : 1;
  const op = new Picker(offTeam, cfg.unavailable);
  const O = {};
  // OL: best five, assign by order
  const olOrder = ['LT', 'RT', 'C', 'LG', 'RG'];
  for (const s of olOrder) O[s] = op.take('OL');
  const labels = Object.keys(form.slots).filter((s) => !olOrder.includes(s));
  // QB first, then skill in priority order
  for (const s of ['QB', 'F', 'X', 'Z', 'Y', 'H', 'A']) if (labels.includes(s)) O[s] = op.take(form.slots[s].pos);

  const off = [];
  for (const s of Object.keys(form.slots)) {
    const sd = form.slots[s];
    let y = (sd.field ? MID_Y : ballY) + sd.dy * f;
    if (sd.field) { // keep detached receivers outside the ball
      const side = Math.sign(sd.dy * f);
      if ((y - ballY) * side < 4) y = ballY + side * 4;
    }
    const a = makeAgent(O[s], 'O', s, los + sd.dx, clampY(y));
    a.fpos = sd.pos;
    a.alignDy = sd.dy * f;
    off.push(a);
  }
  const bySlotO = Object.fromEntries(off.map((a) => [a.slot, a]));

  // ---- Defense personnel ----
  const front = FRONTS[defCall.front];
  const dp = new Picker(defTeam, cfg.unavailable);
  const D = {};
  // priority order so starters go to the key slots
  const order = ['DE_L', 'DE_R', 'DT_L', 'DT_R', 'NT', 'MIKE', 'WILL', 'SAM', 'CB_L', 'CB_R', 'NB', 'DB', 'FS', 'SS'];
  for (const s of order) if (front.slots.includes(s)) D[s] = dp.take(SLOT_POS[s]);

  // Strength: side of Y (TE) or side with more receivers
  const rec = off.filter((a) => ['X', 'Z', 'H', 'A', 'Y', 'F'].includes(a.slot));
  const Y = bySlotO.Y;
  let s = Y ? Math.sign(Y.y - ballY) || 1 : 0;
  const leftSide = rec.filter((a) => a.x > los - 2.5 && a.y > ballY + 0.5).sort((a, b) => b.y - a.y);
  const rightSide = rec.filter((a) => a.x > los - 2.5 && a.y < ballY - 0.5).sort((a, b) => a.y - b.y);
  if (!s) s = leftSide.length >= rightSide.length ? 1 : -1;
  const cov = COVERAGES[defCall.cov];

  const spots = {};
  const LT = bySlotO.LT, LG = bySlotO.LG, C = bySlotO.C, RG = bySlotO.RG, RT = bySlotO.RT;
  const teL = off.find((a) => a.fpos === 'TE' && a.y > ballY && a.y - ballY < 5.5 && a.x > los - 2);
  const teR = off.find((a) => a.fpos === 'TE' && a.y < ballY && ballY - a.y < 5.5 && a.x > los - 2);
  const dlx = los + 0.9;
  spots.DE_L = [dlx, (teL ? teL.y : LT.y) + 1.3];
  spots.DE_R = [dlx, (teR ? teR.y : RT.y) - 1.3];
  if (defCall.front === 'goal') {
    spots.DT_L = [dlx, LG.y + 0.5]; spots.DT_R = [dlx, RG.y - 0.5]; spots.NT = [dlx, C.y];
  } else {
    spots.DT_L = s > 0 ? [dlx, LG.y + 0.7] : [dlx, C.y + 0.6];
    spots.DT_R = s < 0 ? [dlx, RG.y - 0.7] : [dlx, C.y - 0.6];
  }
  // Linebackers
  if (defCall.front === 'base' || defCall.front === 'goal') {
    const dep = defCall.front === 'goal' ? 3 : 4.5;
    spots.SAM = [los + dep, ballY + s * 3.8]; spots.MIKE = [los + dep + 0.5, ballY]; spots.WILL = [los + dep, ballY - s * 3.8];
  } else if (defCall.front === 'nickel') {
    spots.MIKE = [los + 5, ballY + s * 1.8]; spots.WILL = [los + 5, ballY - s * 2.2];
  } else spots.MIKE = [los + 5.5, ballY];
  // simulated pressure / real A-gap blitz look: linebackers mugged up on the line
  if (defCall.simPressure) {
    if (spots.MIKE) spots.MIKE = [los + 1.3, ballY + s * 0.7];
    if (spots.WILL) spots.WILL = [los + 1.3, ballY - s * 0.7];
  }

  // Corners / slot defenders
  const press = cov.man ? (sim.rng.chance(0.55) ? 1.3 : 5.5) : cov === COVERAGES.C2 ? 4.5 : 7;
  const lev = (recv, side, inside) => recv.y + (inside ? -side : side) * 0.9;
  const covDepth = (name) => (cov.man ? press : name === 'NB' || name === 'DB' ? 5 : press);
  const inside = cov.man || defCall.cov === 'C4';
  const L1 = leftSide[0], R1 = rightSide[0];
  spots.CB_L = L1 ? [L1.x + covDepth('CB') + 0.8, lev(L1, 1, inside)] : [los + 7, ballY + 11];
  spots.CB_R = R1 ? [R1.x + covDepth('CB') + 0.8, lev(R1, -1, inside)] : [los + 7, ballY - 11];
  const strongList = s > 0 ? leftSide : rightSide, weakList = s > 0 ? rightSide : leftSide;
  const slotRec = (lst) => lst[1];
  const pickSlotSide = strongList.length >= weakList.length ? strongList : weakList;
  const otherSide = pickSlotSide === strongList ? weakList : strongList;
  const sgn = (lst) => (lst === leftSide ? 1 : -1);
  if (front.slots.includes('NB')) {
    const r = slotRec(pickSlotSide);
    spots.NB = r ? [r.x + 5, r.y - sgn(pickSlotSide) * 0.8] : [los + 5, ballY + s * 6];
  }
  if (front.slots.includes('DB')) {
    const r = slotRec(otherSide) || pickSlotSide[2];
    spots.DB = r ? [r.x + 5, r.y - sgn(otherSide) * 0.8] : [los + 6, ballY - s * 6];
  }
  // Safeties
  const sDepth = Math.min(12, Math.max(4, (110 - los) * 0.55));
  const shown = defCall.shownShell ?? cov.shell;
  if (shown === 2) {
    spots.FS = [los + sDepth, MID_Y - s * 9]; spots.SS = [los + sDepth, MID_Y + s * 9];
  } else if (shown === 1) {
    spots.FS = [los + Math.min(13, sDepth + 1), (ballY + MID_Y) / 2]; spots.SS = [los + Math.min(7, sDepth), ballY + s * 5.5];
  } else {
    spots.FS = [los + 6, ballY - s * 3]; spots.SS = [los + 6, ballY + s * 4.5];
  }
  if (defCall.front === 'goal') spots.SS = [los + 4, ballY + s * 5];

  const def = [];
  for (const sl of front.slots) {
    const [x, y] = spots[sl];
    const a = makeAgent(D[sl], 'D', sl, Math.min(x, 109.5), clampY(y));
    a.fpos = SLOT_POS[sl];
    def.push(a);
  }
  const bySlotD = Object.fromEntries(def.map((a) => [a.slot, a]));

  sim.off = off; sim.def = def; sim.bySlotO = bySlotO; sim.bySlotD = bySlotD; sim.strength = s;
  assignOffense(sim, cfg, bySlotO, form, f);
  assignDefense(sim, cfg, bySlotD, cov, rec);
  if (cfg.offCall.motion) setupMotion(sim, cfg);
}

function assignOffense(sim, cfg, O, form, f) {
  const { offCall, los, ballY } = cfg;
  const play = offCall.play;
  sim.isRun = play.kind === 'run';
  for (const a of sim.off) {
    if (['LT', 'LG', 'C', 'RG', 'RT'].includes(a.slot)) { a.role = sim.isRun ? 'rblock' : 'pblock'; continue; }
    if (a.slot === 'QB') { a.role = 'qb'; continue; }
    if (sim.isRun) {
      if (a.slot === (play.carrierSlot || 'F')) { a.role = 'carrier'; continue; }
      if (a.fpos === 'WR') a.role = 'stalk';
      else if (a.fpos === 'FB') a.role = 'lead';
      else a.role = 'rblock';
      continue;
    }
    let rn = play.routes[a.slot] ?? defaultRoute(a.fpos);
    if (a.fpos === 'FB' && play.routes[a.slot] == null) rn = 'block';
    if (rn === 'block') { a.role = 'pblock'; a.d.backBlock = true; continue; }
    if (rn === 'stalk') { a.role = 'stalk'; continue; }
    let out = Math.sign(a.y - ballY);
    if (Math.abs(a.y - ballY) < 0.8) out = -sim.strength;
    a.role = 'route';
    a.d.route = buildRoute(a, rn, out, los);
    a.d.out = out;
  }
  if (sim.isRun) {
    const dirSign = offCall.runDir;
    sim.run = {
      scheme: play.scheme, dir: dirSign, holeY: clampY(ballY + dirSign * play.aim),
      aim: play.aim, handed: false, handoffT: null,
    };
    setupOption(sim, cfg, play);
    assignRunBlocks(sim, cfg);
  } else {
    sim.pass = { drop: play.drop, pa: !!play.pa, prog: play.prog.filter((l) => O[l] && O[l].role === 'route') };
    if (play.screen && O[play.screen.slot]?.d.route) assignScreen(sim, cfg, O, play.screen);
  }
}

// Screens: the three linemen nearest the screen side sell pass pro, then release to a landmark
// in front of the catch point and lead the runner.
function assignScreen(sim, cfg, O, sc) {
  const tgt = O[sc.slot];
  const end = tgt.d.route.pts[tgt.d.route.pts.length - 1];
  sim.pass.screen = { target: tgt, throwT: sc.throwT, spot: end };
  const side = Math.sign(end.y - cfg.ballY) || 1;
  const ol = ['LT', 'LG', 'C', 'RG', 'RT'].map((k) => O[k]).filter(Boolean)
    .sort((a, b) => (b.y - a.y) * side);
  ol.slice(0, 3).forEach((a, i) => {
    a.d.screenRelease = sc.release + i * 0.08;
    // landmarks spread across the field in front of the catcher
    a.d.screenSpot = { x: cfg.los + 1.5 + i * 1.2, y: clampY(end.y + side * (2.5 - i * 2.5)) };
  });
}

// Read option: leave the backside end unblocked and read him. RPO: give a slot a quick route
// and read the overhang defender who has to choose between the run and the pass.
function setupOption(sim, cfg, play) {
  const { ballY, los } = cfg;
  const R = sim.run;
  if (play.option === 'read') {
    const back = -R.dir;
    const key = sim.def.filter((d) => (d.fpos === 'DE' || d.d.blitz) && Math.sign(d.y - ballY) === back)
      .sort((a, b) => Math.abs(b.y - ballY) - Math.abs(a.y - ballY))[0];
    if (key) {
      R.option = { key, keepY: clampY(ballY + back * 7) };
      key.d.optionKey = true;
      // discipline: good-awareness ends squeeze and play the QB, others crash the dive
      key.d.crash = sim.rng.chance(0.62 - (key.r.awr - 70) / 120);
    }
  }
  if (play.rpo) {
    const r = sim.bySlotO[play.rpo.slot];
    if (r) {
      const out = Math.sign(r.y - ballY) || 1;
      r.role = 'route';
      r.d.route = buildRoute(r, play.rpo.route, out, los);
      const key = sim.def.filter((d) => (d.fpos === 'LB' || d.slot === 'NB' || d.slot === 'SS') && d.role !== 'rush'
        && Math.sign(d.y - ballY) === out && d.x < los + 9)
        .sort((a, b) => Math.abs(a.y - (ballY + r.y) / 2) - Math.abs(b.y - (ballY + r.y) / 2))[0];
      R.rpo = { r, key: key || null, keyX0: key ? key.x : 0 };
      sim.pass = { drop: 'quick', pa: false, prog: [], rpo: true };
    }
  }
}

// Greedy run-blocking assignments.
function assignRunBlocks(sim, cfg) {
  const { los, ballY } = cfg;
  const s = sim.run.dir;
  const scheme = sim.run.scheme;
  const box = sim.def.filter((d) => d.x < los + 7.5 && Math.abs(d.y - ballY) < 8.5 && !d.d.optionKey);
  const dl = box.filter((d) => d.fpos === 'DE' || d.fpos === 'DT');
  const lbs = box.filter((d) => !dl.includes(d));
  let blockers = sim.off.filter((a) => a.role === 'rblock');
  const taken = new Map();
  let puller = null;
  if (scheme === 'power') {
    puller = sim.off.find((a) => a.slot === (s > 0 ? 'RG' : 'LG'));
    blockers = blockers.filter((b) => b !== puller);
  }
  const shift = scheme === 'power' ? -s * 1.1 : s * 1.2;
  const cost = (b, d) => Math.abs(d.y - (b.y + shift)) + (d.x - los) * 0.4;
  const assign = (pool, targets, maxCost = 6) => {
    const pairs = [];
    for (const b of pool) for (const d of targets) pairs.push([cost(b, d), b, d]);
    pairs.sort((a, b) => a[0] - b[0]);
    const usedB = new Set(), usedD = new Set();
    for (const [c, b, d] of pairs) {
      if (usedB.has(b) || usedD.has(d) || c > maxCost) continue;
      usedB.add(b); usedD.add(d); b.d.target = d; taken.set(d, b);
    }
    return pool.filter((b) => !usedB.has(b));
  };
  let free = assign(blockers, dl, 9); // every lineman in the box gets a hat if possible
  free = assign(free, lbs);
  // leftovers double-team the most dangerous nearby DL (the one who'd wreck the play one-on-one)
  const doubled = new Set();
  for (const b of free) {
    let best = null, bs = -1e9;
    for (const d of dl) {
      const lat = Math.abs(d.y - b.y);
      if (lat > 4) continue;
      const sc = (d.r.rds + d.r.str) / 2 - lat * 3 - (doubled.has(d) ? 20 : 0);
      if (sc > bs) { bs = sc; best = d; }
    }
    if (!best) for (const d of dl) if (!best || Math.abs(d.y - b.y) < Math.abs(best.y - b.y)) best = d;
    if (best) doubled.add(best);
    b.d.target = best;
  }
  const unblocked = box.filter((d) => !taken.has(d));
  const nearHole = (arr) => arr.slice().sort((a, b) => Math.abs(a.y - sim.run.holeY) - Math.abs(b.y - sim.run.holeY))[0];
  if (puller) { puller.role = 'rblock'; puller.d.pull = true; puller.d.target = nearHole(unblocked) || nearHole(lbs); if (puller.d.target) taken.set(puller.d.target, puller); }
  const lead = sim.off.find((a) => a.role === 'lead');
  if (lead) { const rest = box.filter((d) => !taken.has(d)); lead.d.target = nearHole(rest) || nearHole(lbs); }
}

function assignDefense(sim, cfg, D, cov, rec) {
  const { defCall, los, ballY } = cfg;
  const rushers = new Set(sim.def.filter((d) => d.fpos === 'DE' || d.fpos === 'DT'));
  for (const opts of defCall.blitz || []) {
    const pick = opts.map((sl) => D[sl]).find((a) => a && !rushers.has(a));
    if (pick) { rushers.add(pick); pick.d.blitz = true; }
  }
  for (const a of rushers) { a.role = 'rush'; a.d.laneY = a.y; }
  sim.disguised = (defCall.shownShell ?? cov.shell) !== cov.shell || !!defCall.simPressure;
  if (rushers.size >= 6 && sim.pass) setHotRoute(sim, cfg, rushers);
  let covers = sim.def.filter((d) => !rushers.has(d));
  const typePen = (d, zone) => {
    if (zone.deep) {
      if (d.fpos === 'LB') return 40;
      if (d.fpos === 'CB' && Math.abs(zone.y - MID_Y) < 9) return 9;
      if (d.fpos === 'S' && Math.abs(zone.y - MID_Y) > 14) return 5;
    }
    return 0;
  };
  const greedyZones = (players, zones) => {
    const pairs = [];
    for (const d of players) for (const z of zones) pairs.push([Math.hypot(d.x - z.x, d.y - z.y) + typePen(d, z), d, z]);
    pairs.sort((a, b) => a[0] - b[0]);
    const ud = new Set(), uz = new Set();
    for (const [, d, z] of pairs) {
      if (ud.has(d) || uz.has(z)) continue;
      ud.add(d); uz.add(z); d.role = 'zone'; d.d.zone = z;
    }
    return players.filter((d) => !ud.has(d));
  };
  const deep = cov.deep.map((n) => zoneSpot(n, los, ballY, cov.flats));
  // Deep zones go to DBs only
  covers = greedyZones(covers, deep);
  if (cov.man) {
    const recs = rec.slice().sort((a, b) => recOrder(a) - recOrder(b));
    const pen = (d, r) => {
      const rp = r.fpos;
      if (d.fpos === 'CB') return rp === 'WR' ? 0 : rp === 'TE' ? 4 : 9;
      if (d.fpos === 'S') return rp === 'WR' ? 5 : rp === 'TE' ? 0 : 3;
      return rp === 'WR' ? 25 : rp === 'TE' ? 4 : 0;
    };
    const pool = new Set(covers);
    for (const r of recs) {
      let best = null, bc = 1e9;
      for (const d of pool) {
        const c = Math.abs(d.y - r.y) * 0.8 + pen(d, r);
        if (c < bc) { bc = c; best = d; }
      }
      if (!best) break;
      pool.delete(best);
      best.role = 'man'; best.d.man = r; r.d.manBy = best;
      best.d.help = cov.shell > 0;
    }
    covers = [...pool];
    const extra = underZones(Math.min(covers.length, 1)).map((n) => zoneSpot(n, los, ballY, 'curl'));
    covers = greedyZones(covers, extra);
    for (const d of covers) { d.role = defCall.lurk ? 'zone' : 'rush'; if (d.role === 'rush') d.d.blitz = true; else d.d.zone = zoneSpot('hookM', los, ballY); }
  } else {
    const under = underZones(covers.length).map((n) => zoneSpot(n, los, ballY, cov.flats));
    covers = greedyZones(covers, under);
    for (const d of covers) { d.role = 'zone'; d.d.zone = zoneSpot('hookM', los, ballY); }
  }
  // man defenders in press move tighter
  for (const d of sim.def) {
    if (d.role === 'man' && !d.d.help && cov.shell === 0) d.d.tight = true;
    d.d.readDelay = 0.1 + (100 - d.r.awr) / 100 * 0.6 + (d.fpos === 'CB' ? 0.15 : d.fpos === 'S' ? 0.05 : 0);
  }
}

// Pre-snap motion: a receiver aligns across the formation and motions to his real spot.
// His man defender travels with him (a man-coverage tell); zone defenders just bump.
function setupMotion(sim, cfg) {
  const { ballY } = cfg;
  const cands = sim.off.filter((a) => ['H', 'A', 'Z', 'Y'].includes(a.slot) && (a.role === 'route' || a.role === 'stalk')
    && !(sim.pass?.screen && sim.pass.screen.target === a));
  if (!cands.length) return;
  const m = cands[Math.floor(sim.rng.next() * cands.length)];
  const side = Math.sign(m.y - ballY) || 1;
  // origin: mirrored to the other side of the formation, a few yards off the ball
  const oy = clampY(ballY - side * Math.max(3.5, Math.abs(m.y - ballY) * 0.6));
  const origin = { x: m.x - (m.fpos === 'TE' ? 0.6 : 0), y: oy };
  const final = { x: m.x, y: m.y };
  const man = sim.def.find((d) => d.role === 'man' && d.d.man === m);
  const off = man ? { x: clamp(man.x - m.x, 1.5, 6), y: Math.sign(ballY - final.y) * 0.8 } : null;
  if (man) { man.x = final.x + off.x; man.y = clampY(final.y + off.y); }
  sim.motion = { m, origin, final, man, manOffset: off, done: false };
}

// Hot route: vs 6+ rushers, a receiver on the pressure side converts to a quick throw and
// becomes the first read.
function setHotRoute(sim, cfg, rushers) {
  const { ballY, los } = cfg;
  let lean = 0;
  for (const r of rushers) if (r.fpos !== 'DE' && r.fpos !== 'DT') lean += Math.sign(r.y - ballY);
  const side = Math.sign(lean) || sim.strength;
  const quick = new Set(['slant', 'hitch', 'stick', 'flat', 'quickout', 'bubble', 'snag', 'arrow', 'in5', 'drag']);
  const cands = sim.off.filter((a) => a.role === 'route' && a.d.route && !quick.has(a.d.route.name) && !a.d.route.screen)
    .sort((a, b) => Math.abs(a.y - (ballY + side * 5)) - Math.abs(b.y - (ballY + side * 5)));
  const r = cands[0];
  if (!r) return;
  const rn = r.fpos === 'WR' ? 'slant' : r.fpos === 'TE' ? 'stick' : 'flat';
  const out = r.d.out ?? (Math.sign(r.y - ballY) || side);
  r.d.route = buildRoute(r, rn, out, los);
  r.d.hot = true;
  sim.pass.prog = [r.slot, ...sim.pass.prog.filter((l) => l !== r.slot)];
  sim.pass.hotSlot = r.slot;
}

function recOrder(r) {
  if (r.fpos === 'WR') return Math.abs(r.y - MID_Y) > 10 ? 0 : 1;
  if (r.fpos === 'TE') return 2;
  return 3;
}
