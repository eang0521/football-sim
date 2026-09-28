import { RNG } from '../util/rng.js';
import { FIRST_NAMES, LAST_NAMES, COACH_FIRST, FRANCHISES } from './names.js';

export const RATING_KEYS = [
  'spd', 'acc', 'agi', 'str', 'awr', 'thp', 'tha', 'cth', 'rte', 'btk', 'car',
  'rbk', 'pbk', 'prs', 'rds', 'tak', 'mcv', 'zcv', 'kpw', 'kac',
];
export const RATING_LABELS = {
  spd: 'Speed', acc: 'Acceleration', agi: 'Agility', str: 'Strength', awr: 'Awareness',
  thp: 'Throw Power', tha: 'Throw Accuracy', cth: 'Catching', rte: 'Route Running',
  btk: 'Elusiveness / Break Tackle', car: 'Ball Security', rbk: 'Run Block', pbk: 'Pass Block',
  prs: 'Pass Rush', rds: 'Run Defense / Block Shed', tak: 'Tackling', mcv: 'Man Coverage',
  zcv: 'Zone Coverage', kpw: 'Kick Power', kac: 'Kick Accuracy',
};

// Archetype means per position; unspecified ratings default to `def`.
const ARCH = {
  QB: { def: 35, spd: 62, acc: 66, agi: 64, str: 55, awr: 72, thp: 84, tha: 78, cth: 40, btk: 50, car: 60, tak: 20 },
  RB: { def: 35, spd: 86, acc: 88, agi: 86, str: 65, awr: 64, cth: 64, rte: 55, btk: 80, car: 76, pbk: 45, rbk: 40, tak: 30 },
  FB: { def: 35, spd: 70, acc: 72, agi: 64, str: 78, awr: 64, cth: 58, rte: 40, btk: 66, car: 70, rbk: 72, pbk: 62, tak: 45 },
  WR: { def: 35, spd: 88, acc: 88, agi: 86, str: 55, awr: 66, cth: 78, rte: 76, btk: 64, car: 66, rbk: 42, pbk: 30, tak: 30 },
  TE: { def: 35, spd: 74, acc: 76, agi: 70, str: 72, awr: 66, cth: 72, rte: 62, btk: 64, car: 66, rbk: 64, pbk: 58, tak: 40 },
  OL: { def: 30, spd: 52, acc: 60, agi: 52, str: 84, awr: 68, rbk: 74, pbk: 74, tak: 25, cth: 20 },
  DE: { def: 30, spd: 74, acc: 78, agi: 70, str: 76, awr: 64, prs: 74, rds: 70, tak: 70, mcv: 30, zcv: 35 },
  DT: { def: 30, spd: 60, acc: 70, agi: 58, str: 86, awr: 64, prs: 66, rds: 76, tak: 68, mcv: 20, zcv: 25 },
  LB: { def: 35, spd: 76, acc: 80, agi: 72, str: 70, awr: 68, prs: 58, rds: 68, tak: 76, mcv: 55, zcv: 64, cth: 50 },
  CB: { def: 35, spd: 89, acc: 90, agi: 88, str: 52, awr: 66, prs: 40, rds: 45, tak: 58, mcv: 74, zcv: 70, cth: 60 },
  S: { def: 35, spd: 84, acc: 85, agi: 80, str: 62, awr: 70, prs: 48, rds: 58, tak: 70, mcv: 62, zcv: 72, cth: 58 },
  K: { def: 25, spd: 50, acc: 50, agi: 50, str: 40, awr: 60, kpw: 84, kac: 80, tak: 20 },
  P: { def: 25, spd: 50, acc: 50, agi: 50, str: 40, awr: 60, kpw: 82, kac: 76, tak: 20 },
};
// Rating keys that matter most for each position (used to vary quality + compute OVR)
const OVR_WEIGHTS = {
  QB: { tha: 3, thp: 2, awr: 3, spd: 0.5, agi: 0.5 },
  RB: { spd: 2, acc: 1.5, agi: 2, btk: 2, car: 1, cth: 1, awr: 1 },
  FB: { rbk: 3, str: 2, pbk: 1, btk: 1, car: 1 },
  WR: { spd: 2, cth: 2.5, rte: 2.5, agi: 1, acc: 1, awr: 1 },
  TE: { cth: 2, rte: 1.5, rbk: 2, pbk: 1, spd: 1, str: 1 },
  OL: { pbk: 3, rbk: 3, str: 2, awr: 1, agi: 0.5 },
  DE: { prs: 3, rds: 2, spd: 1.5, str: 1.5, tak: 1 },
  DT: { rds: 3, prs: 2, str: 2.5, tak: 1 },
  LB: { tak: 2.5, rds: 2, zcv: 1.5, mcv: 1, spd: 1.5, awr: 2 },
  CB: { mcv: 3, zcv: 2, spd: 2.5, agi: 1, cth: 0.5, awr: 1 },
  S: { zcv: 3, mcv: 1, tak: 2, spd: 1.5, awr: 2 },
  K: { kpw: 3, kac: 3 },
  P: { kpw: 3, kac: 2 },
};
const SIZE = { // [height inches, weight lbs]
  QB: [75, 225], RB: [71, 215], FB: [72, 245], WR: [73, 200], TE: [77, 250], OL: [77, 315],
  DE: [76, 270], DT: [75, 310], LB: [74, 240], CB: [71, 192], S: [72, 205], K: [72, 195], P: [74, 210],
};
const NUMBERS = {
  QB: [1, 19], RB: [20, 39], FB: [40, 49], WR: [10, 19, 80, 89], TE: [80, 89, 40, 49], OL: [60, 79],
  DE: [90, 99, 50, 59], DT: [90, 99, 70, 79], LB: [40, 59], CB: [20, 39], S: [20, 49], K: [1, 19], P: [1, 19],
};
export const ROSTER_TEMPLATE = { QB: 3, RB: 3, FB: 1, WR: 6, TE: 3, OL: 8, DE: 4, DT: 3, LB: 5, CB: 5, S: 4, K: 1, P: 1 };
export const POSITIONS = Object.keys(ROSTER_TEMPLATE);

export function computeOvr(p) {
  const w = OVR_WEIGHTS[p.pos];
  let s = 0, t = 0;
  for (const k in w) { s += p.ratings[k] * w[k]; t += w[k]; }
  return Math.round(s / t);
}

const clampR = (v) => Math.max(20, Math.min(99, Math.round(v)));

export function generatePlayer(rng, pos, quality, usedNumbers) {
  const a = ARCH[pos];
  const w = OVR_WEIGHTS[pos];
  const ratings = {};
  for (const k of RATING_KEYS) {
    const base = a[k] ?? a.def;
    const key = w[k] ? 1 : 0.4;
    ratings[k] = clampR(rng.normal(base + quality * key, key ? 6 : 8));
  }
  const [h, wt] = SIZE[pos];
  const height = Math.round(rng.normal(h, 1.6));
  const weight = Math.round(rng.normal(wt, wt * 0.05));
  const nr = NUMBERS[pos];
  let num = 0;
  for (let tries = 0; tries < 60; tries++) {
    const pair = nr.length > 2 && rng.chance(0.4) ? [nr[2], nr[3]] : [nr[0], nr[1]];
    num = rng.int(pair[0], pair[1]);
    if (!usedNumbers.has(num)) break;
  }
  usedNumbers.add(num);
  const p = {
    id: '', first: rng.pick(FIRST_NAMES), last: rng.pick(LAST_NAMES), pos, num, height, weight, ratings,
  };
  p.ovr = computeOvr(p);
  return p;
}

export function generateCoach(rng) {
  const r = (a, b) => Math.round(rng.range(a, b) * 100) / 100;
  return {
    name: `${rng.pick(COACH_FIRST)} ${rng.pick(LAST_NAMES)}`,
    passRate: r(0.45, 0.66),      // baseline share of pass calls on neutral downs
    aggression: r(0.2, 0.85),     // 4th-down / 2-pt willingness
    deepShot: r(0.2, 0.8),        // appetite for vertical concepts
    playAction: r(0.15, 0.55),
    runScheme: rng.pick(['zone', 'zone', 'power', 'balanced']),
    tempo: r(0.2, 0.8),           // pace between plays
    blitzRate: r(0.15, 0.45),
    manRate: r(0.25, 0.6),
    twoHigh: r(0.3, 0.7),         // preference for two-deep shells
  };
}

export function generateTeam(rng, fr, idx, qualityBias = 0) {
  const [city, name, abbr, primary, secondary, helmet, pants] = fr;
  const teamQ = rng.normal(qualityBias, 3);
  const used = new Set();
  const roster = [];
  for (const pos of POSITIONS) {
    for (let i = 0; i < ROSTER_TEMPLATE[pos]; i++) {
      // starters better than backups
      const depthPenalty = i === 0 ? 3 : i === 1 ? -1 : -5;
      const pl = generatePlayer(rng, pos, teamQ + depthPenalty, used);
      pl.id = `${abbr}-${pos}-${i}-${Math.floor(rng.next() * 1e6)}`;
      roster.push(pl);
    }
  }
  return {
    id: abbr, city, name, abbr,
    colors: { primary, secondary, helmet, pants },
    coach: generateCoach(rng),
    roster,
  };
}

export function generateLeague(seed = 12345) {
  const rng = new RNG(seed);
  return { version: 1, seed, teams: FRANCHISES.map((fr, i) => generateTeam(rng, fr, i, rng.normal(0, 2))) };
}

// Depth chart: best players by OVR at each position.
export function depthChart(team) {
  const d = {};
  for (const pos of POSITIONS) d[pos] = team.roster.filter((p) => p.pos === pos).sort((a, b) => b.ovr - a.ovr);
  return d;
}

export function teamRatings(team) {
  const d = depthChart(team);
  const avg = (arr) => Math.round(arr.reduce((s, p) => s + p.ovr, 0) / Math.max(1, arr.length));
  const off = avg([d.QB[0], d.QB[0], d.RB[0], ...d.WR.slice(0, 3), d.TE[0], ...d.OL.slice(0, 5)]);
  const def = avg([...d.DE.slice(0, 2), ...d.DT.slice(0, 2), ...d.LB.slice(0, 3), ...d.CB.slice(0, 3), ...d.S.slice(0, 2)]);
  return { off, def, ovr: Math.round((off + def) / 2) };
}
