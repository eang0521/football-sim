// Fantasy draft: every player in a league goes into one pool, and the teams rebuild their rosters
// in a snake draft. The user runs one franchise; the others are AI GMs that draft for need,
// positional value and best available. Pure data + logic (no DOM).
import { RNG } from '../util/rng.js';
import { ROSTER_TEMPLATE, POSITIONS, depthScore, computeOvr, generatePlayer } from '../data/teamgen.js';

export const DRAFT_VERSION = 1;
// A full 53-man gameday roster (fewer when the pool is too small to give every team 53).
export const DRAFT_ROUNDS = 53;
// Every team must come out of the draft with a starting lineup...
export const MINIMUM = { QB: 1, RB: 1, FB: 0, WR: 3, TE: 1, OL: 5, DE: 2, DT: 2, LB: 3, CB: 3, S: 2, K: 1, P: 1 };
// ...and can't hoard any one position.
export const CAP = { QB: 3, RB: 4, FB: 2, WR: 7, TE: 4, OL: 10, DE: 6, DT: 5, LB: 6, CB: 7, S: 5, K: 1, P: 1 };
// How much GMs value each position early (quarterbacks and pass rushers go first).
const POS_VALUE = { QB: 1.16, DE: 1.06, WR: 1.04, CB: 1.03, OL: 1.02, DT: 1.0, S: 0.97, LB: 0.97, RB: 0.96, TE: 0.95, FB: 0.72, K: 0.7, P: 0.68 };

export const playerValue = (p) => depthScore(p); // imported players: their source rating; generated: OVR

export function createDraft(league, userTeam, userSlot, seed = Date.now() % 1e9) {
  const rng = new RNG(seed);
  const ids = league.teams.map((t) => t.id);
  const order = rng.shuffle(ids.filter((id) => id !== userTeam));
  order.splice(Math.max(0, Math.min(order.length, userSlot - 1)), 0, userTeam);
  const pool = {};
  for (const t of league.teams) for (const p of t.roster) pool[p.id] = { ...p, fromTeam: t.id };
  return {
    version: DRAFT_VERSION, seed, userTeam, order,
    source: { label: league.label || null, source: league.source || null },
    teams: league.teams.map((t) => ({ ...t, roster: [] })), // franchises without players
    pool, picks: [], rounds: Math.min(DRAFT_ROUNDS, Math.floor(Object.keys(pool).length / ids.length)), autoRest: false,
  };
}

// ---------- the board: remaining players ranked by value over replacement ----------
// How much a point of rating above replacement is worth at each position.
export const VOR_WEIGHT = { QB: 1.35, DE: 1.12, WR: 1.05, CB: 1.05, OL: 1.0, DT: 0.95, S: 0.9, LB: 0.9, RB: 0.85, TE: 0.85, FB: 0.4, K: 0.35, P: 0.3 };

// Starter slots every team still has to fill at each position (then depth slots, once starters are gone).
export function leagueNeeds(d) {
  const out = {};
  for (const pos of POSITIONS) out[pos] = { starters: 0, depth: 0 };
  for (const id of d.order) {
    const c = counts(d, id);
    for (const pos of POSITIONS) {
      out[pos].starters += Math.max(0, MINIMUM[pos] - c[pos]);
      out[pos].depth += Math.max(0, ROSTER_TEMPLATE[pos] - Math.max(c[pos], MINIMUM[pos]));
    }
  }
  return out;
}

// Replacement level at a position = the player who'd fill the last open slot there. A player's
// worth is how far he is above that, weighted by the position: scarce, important positions rise.
export function boardRanking(d, pool = available(d)) {
  const needs = leagueNeeds(d);
  const byPos = {};
  for (const p of pool) (byPos[p.pos] ||= []).push(playerValue(p));
  const repl = {};
  for (const pos of POSITIONS) {
    const vals = (byPos[pos] || []).sort((a, b) => b - a);
    const n = needs[pos].starters || needs[pos].depth;
    repl[pos] = vals.length ? vals[Math.min(Math.max(0, n - 1), vals.length - 1)] : 0;
    if (!n) repl[pos] = vals[0] ?? 0; // nobody needs one: no value over replacement
  }
  const rows = pool.map((p) => {
    const vor = playerValue(p) - repl[p.pos];
    return { p, vor, score: Math.max(0, vor) * VOR_WEIGHT[p.pos] + playerValue(p) * 0.05 };
  }).sort((a, b) => b.score - a.score);
  rows.forEach((r, i) => { r.rank = i + 1; });
  return { rows, repl, needs };
}

export const totalPicks = (d) => d.order.length * d.rounds;
export const isDone = (d) => d.picks.length >= totalPicks(d);
export const roundOf = (d, i = d.picks.length) => Math.floor(i / d.order.length) + 1;
// snake: odd rounds go 1..N, even rounds N..1
export function teamOnClock(d, i = d.picks.length) {
  const n = d.order.length, r = Math.floor(i / n), k = i % n;
  return d.order[r % 2 === 0 ? k : n - 1 - k];
}

export function rosterOf(d, teamId) {
  return d.picks.filter((pk) => pk.team === teamId).map((pk) => d.pool[pk.pid]);
}
export function counts(d, teamId) {
  const c = Object.fromEntries(POSITIONS.map((p) => [p, 0]));
  for (const p of rosterOf(d, teamId)) c[p.pos]++;
  return c;
}
export function available(d) {
  const taken = new Set(d.picks.map((pk) => pk.pid));
  return Object.values(d.pool).filter((p) => !taken.has(p.id));
}

// Positions a team may still take. Near the end, only positions it still needs to field a lineup.
export function allowedPositions(d, teamId) {
  const c = counts(d, teamId);
  const left = d.rounds - rosterOf(d, teamId).length;
  const left0 = available(d);
  const unmet = POSITIONS.filter((p) => c[p] < MINIMUM[p] && left0.some((x) => x.pos === p)); // can't force what's gone
  const needSlots = unmet.reduce((s, p) => s + (MINIMUM[p] - c[p]), 0);
  if (left <= needSlots) return new Set(unmet);
  return new Set(POSITIONS.filter((p) => c[p] < CAP[p]));
}

// AI GM: best value for this team's needs, with a little noise so drafts differ.
export function aiChoice(d, teamId, pool = available(d)) {
  const rng = new RNG((d.seed + d.picks.length * 7919) >>> 0);
  const c = counts(d, teamId);
  const ok = allowedPositions(d, teamId);
  const round = roundOf(d);
  let best = null, bs = -1e9;
  for (const p of pool) {
    if (!ok.has(p.pos)) continue;
    const have = c[p.pos];
    // starters first, then depth (kickers and punters wait for the later rounds)
    let need = have < MINIMUM[p.pos] ? 1.08 : have < ROSTER_TEMPLATE[p.pos] ? 0.93 : 0.8;
    if ((p.pos === 'K' || p.pos === 'P') && round < 10) need *= 0.8;
    if (p.pos === 'QB' && have >= 1) need *= 0.88; // a backup QB is nice, not urgent
    const age = p.age ? Math.max(0, p.age - 30) * 0.4 : 0;
    const sc = playerValue(p) * POS_VALUE[p.pos] * need - age + rng.normal(0, 1.6);
    if (sc > bs) { bs = sc; best = p; }
  }
  return best || pool.slice().sort((a, b) => playerValue(b) - playerValue(a))[0] || null;
}

export function makePick(d, pid) {
  const team = teamOnClock(d);
  const p = d.pool[pid];
  if (!p || d.picks.some((pk) => pk.pid === pid)) throw new Error('Player already taken');
  if (!allowedPositions(d, team).has(p.pos) && available(d).some((x) => allowedPositions(d, team).has(x.pos))) throw new Error(`Can't take another ${p.pos}`);
  d.picks.push({ team, pid, round: roundOf(d), n: d.picks.length + 1 });
}

// Let the AI pick until it's the user's turn (or the draft is over). With autoRest on, the AI
// picks for the user too.
export function advance(d) {
  while (!isDone(d) && (teamOnClock(d) !== d.userTeam || d.autoRest)) {
    const p = aiChoice(d, teamOnClock(d));
    if (!p) break;
    makePick(d, p.id);
  }
}

// Build the league the season is played with.
export function finishDraft(d) {
  const teams = d.teams.map((t) => {
    const used = new Set();
    const roster = rosterOf(d, t.id).map((p) => {
      const q = JSON.parse(JSON.stringify(p));
      delete q.fromTeam; delete q.depth; delete q.st; delete q.injury;
      q.drafted = { from: p.fromTeam, n: d.picks.find((pk) => pk.pid === p.id)?.n };
      let num = q.num;
      if (used.has(num)) num = [...Array(100).keys()].find((k) => !used.has(k) && k > 0) ?? num;
      used.add(num); q.num = num;
      q.ovr = computeOvr(q);
      return q;
    });
    // short a starter because the pool ran dry (e.g. more teams than kickers)? sign a free agent
    const rng = new RNG((d.seed ^ t.id.split('').reduce((h, ch) => h * 31 + ch.charCodeAt(0), 7)) >>> 0);
    for (const pos of POSITIONS) {
      while (roster.filter((p) => p.pos === pos).length < MINIMUM[pos]) {
        const fa = generatePlayer(rng, pos, -6, used);
        fa.id = `FA-${t.id}-${pos}-${roster.length}`;
        fa.fa = true;
        roster.push(fa);
      }
    }
    const { roster: _r, ...rest } = t;
    return { ...rest, roster };
  });
  const user = d.teams.find((t) => t.id === d.userTeam);
  return {
    version: 1, seed: d.seed, source: 'fantasy',
    label: `Fantasy draft: you run the ${user.city} ${user.name}${d.source.label ? ` (player pool: ${d.source.label})` : ''}`,
    built: new Date().toISOString().slice(0, 10),
    userTeam: d.userTeam,
    teams,
  };
}

// ---------- persistence (a draft can be picked up where it was left) ----------
const KEY = 'gridiron-sim-draft-v1';
export function loadDraft() {
  try { const d = JSON.parse(globalThis.localStorage?.getItem(KEY) || 'null'); return d && d.version === DRAFT_VERSION ? d : null; } catch { return null; }
}
export function saveDraft(d) { try { globalThis.localStorage?.setItem(KEY, JSON.stringify(d)); return true; } catch { return false; } }
export function clearDraft() { try { globalThis.localStorage?.removeItem(KEY); } catch { /* ignore */ } }
