// Builds agents for a scrimmage play: personnel, alignment and assignments.
import { FORMATIONS, ROUTES, defaultRoute, FRONTS, SLOT_POS, COVERAGES } from './playbook.js';
import { MID_Y, FIELD_W, physFromRatings } from './constants.js';
import { depthChart } from '../data/teamgen.js';
import { clamp } from '../util/vec.js';

const FALLBACK = {
  QB: ['QB', 'RB'], RB: ['RB', 'FB', 'WR'], FB: ['FB', 'TE', 'RB'], WR: ['WR', 'TE', 'RB'], TE: ['TE', 'FB', 'OL'],
  OL: ['OL', 'DT'], DE: ['DE', 'DT', 'LB'], DT: ['DT', 'DE'], LB: ['LB', 'S', 'DE'], CB: ['CB', 'S'], S: ['S', 'CB'],
  K: ['K', 'P'], P: ['P', 'K'],
};

export class Picker {
  constructor(team) { this.d = depthChart(team); this.used = new Set(); }
  take(pos) {
    for (const p2 of FALLBACK[pos] || [pos]) {
      const pl = (this.d[p2] || []).find((p) => !this.used.has(p.id));
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
export function makeAgent(player, side, slot, x, y) {
  const ph = physFromRatings(player);
  return {
    uid: ++AGENT_UID, id: player.id, p: player, r: player.ratings, side, slot, pos: player.pos,
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
  return { name: routeName, pts, sit: !!def.sit, quick: !!def.quick, delay: def.delay || 0, idx: 0,
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
  const op = new Picker(offTeam);
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
  const dp = new Picker(defTeam);
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
  if (cov.shell === 2) {
    spots.FS = [los + sDepth, MID_Y - s * 9]; spots.SS = [los + sDepth, MID_Y + s * 9];
  } else if (cov.shell === 1) {
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
    assignRunBlocks(sim, cfg);
  } else {
    sim.pass = { drop: play.drop, pa: !!play.pa, prog: play.prog.filter((l) => O[l] && O[l].role === 'route') };
  }
}

// Greedy run-blocking assignments.
function assignRunBlocks(sim, cfg) {
  const { los, ballY } = cfg;
  const s = sim.run.dir;
  const scheme = sim.run.scheme;
  const box = sim.def.filter((d) => d.x < los + 7.5 && Math.abs(d.y - ballY) < 8.5);
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
  const assign = (pool, targets) => {
    const pairs = [];
    for (const b of pool) for (const d of targets) pairs.push([cost(b, d), b, d]);
    pairs.sort((a, b) => a[0] - b[0]);
    const usedB = new Set(), usedD = new Set();
    for (const [c, b, d] of pairs) {
      if (usedB.has(b) || usedD.has(d) || c > 6) continue;
      usedB.add(b); usedD.add(d); b.d.target = d; taken.set(d, b);
    }
    return pool.filter((b) => !usedB.has(b));
  };
  let free = assign(blockers, dl);
  free = assign(free, lbs);
  // leftovers double-team nearest DL
  for (const b of free) {
    let best = null, bd = 1e9;
    for (const d of dl) { const c = Math.abs(d.y - b.y); if (c < bd) { bd = c; best = d; } }
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

function recOrder(r) {
  if (r.fpos === 'WR') return Math.abs(r.y - MID_Y) > 10 ? 0 : 1;
  if (r.fpos === 'TE') return 2;
  return 3;
}
