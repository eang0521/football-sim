// Season mode: schedule, standings, playoffs, season/career stats, injuries and history.
// Pure data + logic (no DOM) so it can be exercised from Node.
import { RNG } from '../util/rng.js';
import { Game } from '../sim/game.js';
import { computeOvr } from '../data/teamgen.js';

export const SEASON_VERSION = 1;

// Double round-robin (circle method), home/away flipped in the second half.
function buildSchedule(ids, rng) {
  const t = ids.slice();
  rng.shuffle(t);
  if (t.length % 2) t.push(null);
  const n = t.length, rounds = [];
  const arr = t.slice();
  for (let r = 0; r < n - 1; r++) {
    const games = [];
    for (let i = 0; i < n / 2; i++) {
      const a = arr[i], b = arr[n - 1 - i];
      if (a && b) games.push(r % 2 === i % 2 ? { home: a, away: b } : { home: b, away: a });
    }
    rounds.push(games);
    arr.splice(1, 0, arr.pop()); // rotate all but the first
  }
  const second = rounds.map((g) => g.map((x) => ({ home: x.away, away: x.home })));
  return [...rounds, ...rng.shuffle(second)].map((games, w) => ({ week: w + 1, games: games.map((g) => ({ ...g, result: null })) }));
}

export function createSeason(league, prev) {
  const rng = new RNG(Date.now() % 1e9);
  const ids = league.teams.map((t) => t.id);
  return {
    version: SEASON_VERSION,
    year: prev ? prev.year + 1 : 1,
    seed: rng.seed,
    teams: ids,
    weeks: buildSchedule(ids, rng),
    week: 0,               // index of the current regular-season week
    phase: 'regular',      // 'regular' | 'playoffs' | 'done'
    playoffs: null,        // { rounds: [[game...], [game]] }
    champion: null,
    stats: {},             // pid -> season line
    injuries: {},          // pid -> { weeks, part, team }
    history: prev ? prev.history : [],
    careers: prev ? prev.careers : {},
  };
}

// ---------- standings ----------
export function standings(season, league) {
  const T = {};
  for (const id of season.teams) T[id] = { id, w: 0, l: 0, t: 0, pf: 0, pa: 0, streak: '', h2h: {}, games: [] };
  for (const wk of season.weeks) for (const g of wk.games) {
    if (!g.result) continue;
    const { homeScore: hs, awayScore: as } = g.result;
    const H = T[g.home], A = T[g.away];
    H.pf += hs; H.pa += as; A.pf += as; A.pa += hs;
    const hRes = hs > as ? 'W' : hs < as ? 'L' : 'T';
    const aRes = hRes === 'W' ? 'L' : hRes === 'L' ? 'W' : 'T';
    for (const [X, r, opp] of [[H, hRes, g.away], [A, aRes, g.home]]) {
      if (r === 'W') X.w++; else if (r === 'L') X.l++; else X.t++;
      X.h2h[opp] = (X.h2h[opp] || 0) + (r === 'W' ? 1 : r === 'L' ? -1 : 0);
      X.games.push(r);
    }
  }
  const rows = Object.values(T).map((x) => {
    const gp = x.w + x.l + x.t;
    let st = '', c = 0;
    for (let i = x.games.length - 1; i >= 0; i--) { if (!st) st = x.games[i]; if (x.games[i] === st) c++; else break; }
    return { ...x, gp, pct: gp ? (x.w + x.t * 0.5) / gp : 0, diff: x.pf - x.pa, streak: st ? `${st}${c}` : '-',
      team: league.teams.find((t) => t.id === x.id) };
  });
  rows.sort((a, b) => b.pct - a.pct || (b.h2h[a.id] || 0) - (a.h2h[b.id] || 0) || b.diff - a.diff || b.pf - a.pf);
  return rows;
}

// ---------- playing games ----------
export function currentGames(season) {
  if (season.phase === 'regular') return season.weeks[season.week]?.games.filter((g) => !g.result) || [];
  if (season.phase === 'playoffs') {
    const r = season.playoffs.rounds[season.playoffs.rounds.length - 1];
    return r.filter((g) => !g.result);
  }
  return [];
}

export function outPlayers(season) {
  return new Set(Object.entries(season.injuries).filter(([, v]) => v.weeks > 0).map(([k]) => k));
}

export function createSeasonGame(season, league, g, opts = {}) {
  const home = league.teams.find((t) => t.id === g.home), away = league.teams.find((t) => t.id === g.away);
  return new Game(home, away, { ...opts, out: outPlayers(season), noTie: !!g.playoff });
}

// Record a finished game: result, stats, injuries. Advances weeks/rounds as they complete.
export function recordGame(season, league, g, game) {
  const s = game.s;
  g.result = { homeScore: s.score.home, awayScore: s.score.away, ot: s.quarter >= 5 };
  // season + career stats
  for (const [pid, L] of game.stats.players) {
    const info = game.stats.pidTeam.get(pid);
    if (!info) continue;
    for (const bucket of [season.stats, season.careers]) {
      const cur = (bucket[pid] ||= { name: `${info.p.first} ${info.p.last}`, pos: info.p.pos, team: game.teams[info.key].id, gp: 0,
        pass: { att: 0, cmp: 0, yds: 0, td: 0, int: 0 }, rush: { car: 0, yds: 0, td: 0 }, rec: { rec: 0, yds: 0, td: 0 },
        def: { tkl: 0, sack: 0, int: 0 }, kick: { fgm: 0, fga: 0 } });
      cur.team = game.teams[info.key].id;
      cur.gp++;
      for (const k of ['att', 'cmp', 'yds', 'td', 'int']) cur.pass[k] += L.pass[k] || 0;
      for (const k of ['car', 'yds', 'td']) cur.rush[k] += L.rush[k] || 0;
      for (const k of ['rec', 'yds', 'td']) cur.rec[k] += L.rec[k] || 0;
      cur.def.tkl += (L.def.tkl || 0) + (L.def.ast || 0); cur.def.sack += L.def.sack || 0; cur.def.int += L.def.int || 0;
      cur.kick.fgm += L.kick.fgm || 0; cur.kick.fga += L.kick.fga || 0;
    }
  }
  // injuries carry over: weeks out based on severity
  const rng = new RNG((season.seed + season.week * 97 + s.score.home * 7 + s.score.away) >>> 0);
  for (const [pid, inj] of game.injuries) {
    if (inj.returnAt !== Infinity && inj.returned) continue;
    const weeks = inj.part === 'concussion' ? rng.int(1, 2) : inj.returnAt === Infinity ? rng.int(1, 5) : rng.int(0, 1);
    if (weeks > 0) season.injuries[pid] = { weeks: weeks + 1, part: inj.part, team: game.teams[inj.team].id, name: `${inj.p.first} ${inj.p.last}` };
  }
  advance(season, league);
}

function advance(season, league) {
  if (season.phase === 'regular') {
    const wk = season.weeks[season.week];
    if (wk && wk.games.every((g) => g.result)) {
      // a week passes: heal
      for (const [pid, v] of Object.entries(season.injuries)) { v.weeks--; if (v.weeks <= 0) delete season.injuries[pid]; }
      season.week++;
      if (season.week >= season.weeks.length) startPlayoffs(season, league);
    }
  } else if (season.phase === 'playoffs') {
    const rounds = season.playoffs.rounds;
    const last = rounds[rounds.length - 1];
    if (last.every((g) => g.result)) {
      for (const [pid, v] of Object.entries(season.injuries)) { v.weeks--; if (v.weeks <= 0) delete season.injuries[pid]; }
      const winners = last.map((g) => (g.result.homeScore >= g.result.awayScore ? g.home : g.away));
      if (winners.length === 1) {
        season.champion = winners[0];
        season.phase = 'done';
        const f = last[0];
        season.history.push({ year: season.year, champion: winners[0], runnerUp: f.home === winners[0] ? f.away : f.home,
          score: `${Math.max(f.result.homeScore, f.result.awayScore)}-${Math.min(f.result.homeScore, f.result.awayScore)}`,
          leaders: leaders(season, 1) });
      } else {
        // reseed: best remaining seed hosts
        const seeds = season.playoffs.seeds;
        winners.sort((a, b) => seeds.indexOf(a) - seeds.indexOf(b));
        rounds.push([{ home: winners[0], away: winners[1], playoff: 'Championship', result: null }]);
      }
    }
  }
}

function startPlayoffs(season, league) {
  const st = standings(season, league);
  const seeds = st.slice(0, 4).map((r) => r.id);
  season.phase = 'playoffs';
  season.playoffs = { seeds, rounds: [[
    { home: seeds[0], away: seeds[3], playoff: 'Semifinal', result: null },
    { home: seeds[1], away: seeds[2], playoff: 'Semifinal', result: null },
  ]] };
}

// ---------- leaders ----------
const CATS = {
  passYds: { label: 'Passing yards', get: (x) => x.pass.yds },
  passTD: { label: 'Passing TD', get: (x) => x.pass.td },
  rushYds: { label: 'Rushing yards', get: (x) => x.rush.yds },
  rushTD: { label: 'Rushing TD', get: (x) => x.rush.td },
  recYds: { label: 'Receiving yards', get: (x) => x.rec.yds },
  rec: { label: 'Receptions', get: (x) => x.rec.rec },
  sacks: { label: 'Sacks', get: (x) => Math.round(x.def.sack * 10) / 10 },
  ints: { label: 'Interceptions', get: (x) => x.def.int },
  tackles: { label: 'Tackles', get: (x) => x.def.tkl },
};
export const LEADER_CATS = CATS;

export function leaders(season, n = 5, source = 'season') {
  const pool = Object.entries(source === 'career' ? season.careers : season.stats);
  const out = {};
  for (const [k, c] of Object.entries(CATS)) {
    out[k] = pool.map(([pid, x]) => ({ pid, name: x.name, pos: x.pos, team: x.team, gp: x.gp, v: c.get(x) }))
      .filter((r) => r.v > 0).sort((a, b) => b.v - a.v).slice(0, n);
  }
  return out;
}

// ---------- offseason ----------
// Development: younger/lower-rated players tend to improve, stars drift a little either way.
export function developPlayers(league, rng = new RNG(Date.now() % 1e9)) {
  const changes = [];
  for (const t of league.teams) for (const p of t.roster) {
    const before = p.ovr;
    const trend = (72 - p.ovr) / 12; // regression toward the middle + growth for low-rated players
    for (const k in p.ratings) {
      const d = Math.round(rng.normal(trend * 0.6, 1.6));
      p.ratings[k] = Math.max(20, Math.min(99, p.ratings[k] + d));
    }
    p.ovr = computeOvr(p);
    if (Math.abs(p.ovr - before) >= 3) changes.push({ name: `${p.first} ${p.last}`, team: t.abbr, pos: p.pos, from: before, to: p.ovr });
  }
  return changes.sort((a, b) => Math.abs(b.to - b.from) - Math.abs(a.to - a.from));
}

// ---------- persistence ----------
const KEY = 'gridiron-sim-season-v1';
export function loadSeason() {
  try {
    const raw = globalThis.localStorage?.getItem(KEY);
    if (!raw) return null;
    const s = JSON.parse(raw);
    return s && s.version === SEASON_VERSION ? s : null;
  } catch { return null; }
}
export function saveSeason(s) { try { globalThis.localStorage?.setItem(KEY, JSON.stringify(s)); return true; } catch { return false; } }
export function clearSeason() { try { globalThis.localStorage?.removeItem(KEY); } catch { /* ignore */ } }
