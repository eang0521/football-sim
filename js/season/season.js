// Season mode: schedule, standings, playoffs, season/career stats, injuries and history.
// Pure data + logic (no DOM) so it can be exercised from Node.
import { seasonDate } from '../sim/climate.js';
import { RNG } from '../util/rng.js';
import { Game } from '../sim/game.js';
import { computeOvr } from '../data/teamgen.js';

export const SEASON_VERSION = 1;

const MAX_WEEKS = 17;

// Round-robin rounds (circle method). Small leagues play it twice (home/away flipped);
// big leagues play 17 of the rounds once.
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
  const all = n <= 10
    ? [...rounds, ...rng.shuffle(rounds.map((g) => g.map((x) => ({ home: x.away, away: x.home }))))]
    : rng.shuffle(rounds).slice(0, MAX_WEEKS);
  return all.map((games, w) => ({ week: w + 1, games: games.map((g) => ({ ...g, result: null })) }));
}

// NFL format: 2 conferences x 4 divisions of 4 (teams carry `conf` and `div`).
export function nflDivisions(league) {
  const divs = {};
  for (const t of league.teams) if (t.div && t.conf) (divs[t.div] ||= []).push(t.id);
  const names = Object.keys(divs).sort();
  const confs = new Set(league.teams.map((t) => t.conf));
  if (names.length !== 8 || confs.size !== 2 || names.some((d) => divs[d].length !== 4)) return null;
  return names.map((d) => ({ name: d, conf: league.teams.find((t) => t.div === d).conf, teams: divs[d] }));
}

// 17 games, no byes: home and away against each division rival (6), all four teams of a
// same-conference division (4) and of an other-conference division (4), plus 3 more.
// Every week is a perfect matching: either division games, or divisions paired off with a shift.
function buildNflSchedule(divs, year, rng) {
  const D = divs.map((d) => rng.shuffle(d.teams.slice()));
  const confs = [...new Set(divs.map((d) => d.conf))];
  const [A, N] = confs.map((c) => divs.map((d, i) => [d.conf, i]).filter(([k]) => k === c).map(([, i]) => i));
  const rot = year % 3, x = year % 4;
  const PAIRS = [[[0, 1], [2, 3]], [[0, 2], [1, 3]], [[0, 3], [1, 2]]];
  const pairsIntra = (k) => PAIRS[k].flatMap(([a, b]) => [[A[a], A[b]], [N[a], N[b]]]);
  const pairsCross = (off) => [0, 1, 2, 3].map((i) => [A[i], N[(i + off) % 4]]);
  const vsDiv = (pairs, s, flip) => pairs.flatMap(([a, b]) => [0, 1, 2, 3].map((k) => {
    const h = D[a][k], v = D[b][(k + s) % 4];
    return (s + (k >> 1) + (flip ? 1 : 0)) % 2 ? { home: h, away: v } : { home: v, away: h }; // alternates for both sides
  }));
  const divWeek = (m, flip) => D.flatMap((t) => PAIRS[m].map(([a, b]) => (flip ? { home: t[b], away: t[a] } : { home: t[a], away: t[b] })));
  const weeks = [
    divWeek(0, false), divWeek(1, false), divWeek(2, false), divWeek(0, true), divWeek(1, true), divWeek(2, true),
    ...[0, 1, 2, 3].map((s) => vsDiv(pairsIntra(rot), s, false)),
    ...[0, 1, 2, 3].map((s) => vsDiv(pairsCross(x), s, true)),
    vsDiv(pairsIntra((rot + 1) % 3), rng.int(0, 3), false),
    vsDiv(pairsIntra((rot + 2) % 3), rng.int(0, 3), true),
    vsDiv(pairsCross((x + 2) % 4), rng.int(0, 3), false),
  ];
  // the first 14 weeks give everyone 7 home games; host the last 3 so everyone ends with 8 or 9
  const home = {};
  for (const w of weeks.slice(14)) for (const g of w) {
    const [a, b] = [g.home, g.away];
    if ((home[b] || 0) < (home[a] || 0) || ((home[b] || 0) === (home[a] || 0) && rng.chance(0.5))) { g.home = b; g.away = a; }
    home[g.home] = (home[g.home] || 0) + 1;
  }
  rng.shuffle(weeks);
  // save a round of division games for the final week, like the NFL does
  const isDiv = (w) => divs.some((d) => d.teams.includes(w[0].home) && d.teams.includes(w[0].away));
  const last = weeks.findIndex(isDiv);
  if (last >= 0) weeks.push(weeks.splice(last, 1)[0]);
  return weeks.map((games, w) => ({ week: w + 1, games: games.map((g) => ({ ...g, result: null })) }));
}

// Real schedule from an imported league (optionally with the results already played).
function realWeeks(league, withResults) {
  const ids = new Set(league.teams.map((t) => t.id));
  return league.schedule.weeks.map((w) => ({
    week: w.week,
    games: w.games.filter((g) => ids.has(g.home) && ids.has(g.away)).map((g) => ({
      home: g.home, away: g.away, date: g.date,
      result: withResults && g.final ? { homeScore: g.homeScore, awayScore: g.awayScore, ot: !!g.ot, real: true } : null,
    })),
  }));
}

// Current injury designations from an imported league -> weeks out at the start of the season.
function realInjuries(league) {
  const out = {};
  const W = { IR: 4, Out: 1, Doubtful: 1, Suspended: 2 };
  for (const t of league.teams) for (const p of t.roster) {
    const w = W[p.injury?.status];
    if (w) out[p.id] = { weeks: w, part: p.injury.status === 'Suspended' ? 'suspension' : 'injury (real)', team: t.id, name: `${p.first} ${p.last}`, pos: p.pos, ir: p.injury.status === 'IR' };
  }
  return out;
}

// opts (imported leagues with a schedule): { realSchedule, realResults, realInjuries }
export function createSeason(league, prev, opts = {}) {
  const rng = new RNG(Date.now() % 1e9);
  const ids = league.teams.map((t) => t.id);
  const divs = nflDivisions(league);
  const year = prev ? prev.year + 1 : 1;
  const real = !prev && opts.realSchedule && league.schedule?.weeks?.length >= 17;
  const weeks = real ? realWeeks(league, opts.realResults) : divs ? buildNflSchedule(divs, year, rng) : buildSchedule(ids, rng);
  let week = 0;
  while (week < weeks.length && weeks[week].games.every((g) => g.result)) week++;
  return {
    realSeason: real ? league.schedule.season : null,
    version: SEASON_VERSION,
    format: divs ? 'nfl' : 'bracket',
    divisions: divs,
    year,
    seed: rng.seed,
    teams: ids,
    weeks,
    week,                  // index of the current regular-season week
    phase: 'regular',      // 'regular' | 'playoffs' | 'done'
    playoffs: null,        // { rounds: [[game...], [game]] }
    champion: null,
    stats: {},             // pid -> season line
    injuries: !prev && opts.realInjuries ? realInjuries(league) : {}, // pid -> { weeks, part, team, ir }
    history: prev ? prev.history : [],
    careers: prev ? prev.careers : {},
  };
}

// ---------- standings ----------
export function standings(season, league) {
  const T = {};
  for (const id of season.teams) T[id] = { id, w: 0, l: 0, t: 0, pf: 0, pa: 0, streak: '', h2h: {}, games: [], dw: 0, dl: 0, dt: 0 };
  const divOf = {};
  for (const d of season.divisions || []) for (const id of d.teams) divOf[id] = d;
  for (const wk of season.weeks) for (const g of wk.games) {
    if (!g.result) continue;
    const { homeScore: hs, awayScore: as } = g.result;
    const H = T[g.home], A = T[g.away];
    H.pf += hs; H.pa += as; A.pf += as; A.pa += hs;
    const hRes = hs > as ? 'W' : hs < as ? 'L' : 'T';
    const aRes = hRes === 'W' ? 'L' : hRes === 'L' ? 'W' : 'T';
    for (const [X, r, opp] of [[H, hRes, g.away], [A, aRes, g.home]]) {
      if (r === 'W') X.w++; else if (r === 'L') X.l++; else X.t++;
      if (divOf[X.id] && divOf[X.id] === divOf[opp]) { if (r === 'W') X.dw++; else if (r === 'L') X.dl++; else X.dt++; }
      X.h2h[opp] = (X.h2h[opp] || 0) + (r === 'W' ? 1 : r === 'L' ? -1 : 0);
      X.games.push(r);
    }
  }
  const rows = Object.values(T).map((x) => {
    const gp = x.w + x.l + x.t;
    let st = '', c = 0;
    for (let i = x.games.length - 1; i >= 0; i--) { if (!st) st = x.games[i]; if (x.games[i] === st) c++; else break; }
    return { ...x, gp, pct: gp ? (x.w + x.t * 0.5) / gp : 0, diff: x.pf - x.pa, streak: st ? `${st}${c}` : '-',
      div: divOf[x.id]?.name || null, conf: divOf[x.id]?.conf || null,
      team: league.teams.find((t) => t.id === x.id) };
  });
  rows.sort(rankCmp);
  return rows;
}
const rankCmp = (a, b) => b.pct - a.pct || (b.h2h[a.id] || 0) - (a.h2h[b.id] || 0) || b.diff - a.diff || b.pf - a.pf;

// NFL seeding per conference: 4 division winners (1-4), then 3 wild cards (5-7).
function nflSeeds(rows, conf) {
  const C = rows.filter((r) => r.conf === conf);
  const winners = [...new Set(C.map((r) => r.div))].map((d) => C.find((r) => r.div === d)).sort(rankCmp);
  const wild = C.filter((r) => !winners.includes(r)).sort(rankCmp).slice(0, 3);
  return [...winners, ...wild].map((r) => r.id);
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
  // game date for the weather: the real schedule's date, or an estimate from the week / playoff round
  const wk = season.phase === 'playoffs' ? season.weeks.length + (season.playoffs?.rounds.length || 1) - 1 : season.week;
  const date = g.date || seasonDate(wk);
  return new Game(home, away, { date, ...opts, out: outPlayers(season), noTie: !!g.playoff });
}

// Record a finished game: result, stats, injuries. Advances weeks/rounds as they complete.
export function recordGame(season, league, g, game) {
  const s = game.s;
  g.result = { homeScore: s.score.home, awayScore: s.score.away, ot: s.quarter >= 5 };
  // season + career stats (full box-score lines), per-player game logs and team totals
  season.logs ||= {};
  season.teamStats ||= {};
  const wk = g.playoff || `W${season.weeks[season.week]?.week ?? season.week + 1}`;
  for (const [pid, L] of game.stats.players) {
    const info = game.stats.pidTeam.get(pid);
    if (!info) continue;
    const tm = game.teams[info.key].id;
    for (const bucket of [season.stats, season.careers]) {
      const cur = (bucket[pid] ||= { name: `${info.p.first} ${info.p.last}`, pos: info.p.pos, team: tm, gp: 0 });
      cur.team = tm; cur.pos = info.p.pos;
      cur.gp++;
      addLine(cur, L);
    }
    const opp = game.teams[info.key === 'home' ? 'away' : 'home'].id;
    const my = s.score[info.key], their = s.score[info.key === 'home' ? 'away' : 'home'];
    (season.logs[pid] ||= []).push({ w: wk, opp, ha: info.key === 'home' ? 'vs' : '@', res: `${my > their ? 'W' : my < their ? 'L' : 'T'} ${my}-${their}`, L: compactLine(L) });
  }
  for (const key of ['home', 'away']) {
    const other = key === 'home' ? 'away' : 'home';
    const T = (season.teamStats[game.teams[key].id] ||= { g: 0, pf: 0, pa: 0, off: {}, def: {} });
    T.g++; T.pf += s.score[key]; T.pa += s.score[other];
    addLine(T.off, game.stats.team[key]);
    addLine(T.def, game.stats.team[other]);
  }
  // injuries carry over: weeks out based on severity
  const rng = new RNG((season.seed + season.week * 97 + s.score.home * 7 + s.score.away) >>> 0);
  for (const [pid, inj] of game.injuries) {
    if (inj.returnAt !== Infinity && inj.returned) continue;
    const weeks = inj.weeks ?? (inj.part === 'concussion' ? rng.int(1, 2) : inj.returnAt === Infinity ? rng.int(1, 5) : rng.int(0, 1));
    if (weeks > 0) season.injuries[pid] = { weeks: weeks >= 99 ? 99 : weeks + 1, part: inj.part, team: game.teams[inj.team].id,
      name: `${inj.p.first} ${inj.p.last}`, pos: inj.p.pos, ir: weeks >= 4, seasonEnding: weeks >= 99, week: season.week + 1 };
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
      } else if (season.playoffs.format === 'nfl') {
        // reseed within each conference; the 1 seed rejoins after its bye
        const S = season.playoffs.seeds, confs = Object.keys(S);
        const left = {};
        for (const c of confs) {
          left[c] = winners.filter((w) => S[c].includes(w));
          if (rounds.length === 1) left[c].push(S[c][0]);
          left[c].sort((a, b) => S[c].indexOf(a) - S[c].indexOf(b));
        }
        if (confs.every((c) => left[c].length === 1)) {
          const [a, b] = confs.map((c) => left[c][0]);
          const st = standings(season, league).map((r) => r.id);
          const [home, away] = st.indexOf(a) <= st.indexOf(b) ? [a, b] : [b, a];
          rounds.push([{ home, away, playoff: 'Championship Game', result: null }]);
        } else {
          rounds.push(confs.flatMap((c) => pairUp(left[c], `${c} ${left[c].length === 2 ? 'Championship' : 'Divisional'}`)));
        }
      } else {
        // reseed: best remaining seed hosts
        const seeds = season.playoffs.seeds;
        winners.sort((a, b) => seeds.indexOf(a) - seeds.indexOf(b));
        rounds.push(pairUp(winners, winners.length === 2 ? 'Championship' : 'Semifinal'));
      }
    }
  }
}

// Best remaining seed hosts the worst, and so on.
function pairUp(seeded, label) {
  const out = [];
  for (let i = 0; i < seeded.length / 2; i++) out.push({ home: seeded[i], away: seeded[seeded.length - 1 - i], playoff: label, result: null });
  return out;
}

export function playoffTeams(season) { return season.format === 'nfl' ? 14 : season.teams.length > 8 ? 8 : 4; }

function startPlayoffs(season, league) {
  const st = standings(season, league);
  season.phase = 'playoffs';
  if (season.format === 'nfl') {
    const confs = [...new Set(season.divisions.map((d) => d.conf))];
    const seeds = Object.fromEntries(confs.map((c) => [c, nflSeeds(st, c)]));
    // Wild Card round: 2v7, 3v6, 4v5; the 1 seed has a bye
    season.playoffs = { format: 'nfl', seeds, rounds: [confs.flatMap((c) => pairUp(seeds[c].slice(1), `${c} Wild Card`))] };
  } else {
    const seeds = st.slice(0, playoffTeams(season)).map((r) => r.id);
    season.playoffs = { format: 'bracket', seeds, rounds: [pairUp(seeds, seeds.length === 8 ? 'Quarterfinal' : 'Semifinal')] };
  }
}

export function seedOf(season, id) {
  const S = season.playoffs?.seeds;
  if (!S) return null;
  if (Array.isArray(S)) { const i = S.indexOf(id); return i < 0 ? null : i + 1; }
  for (const c in S) { const i = S[c].indexOf(id); if (i >= 0) return i + 1; }
  return null;
}

// Sum a box-score line into a running total ('long' keeps the max).
function addLine(cur, L) {
  for (const k in L) {
    const v = L[k];
    if (v && typeof v === 'object') addLine(cur[k] ||= {}, v);
    else if (typeof v === 'number') cur[k] = k === 'long' ? Math.max(cur[k] || 0, v) : (cur[k] || 0) + v;
  }
}
// Only the categories a player actually recorded (keeps game logs small).
function compactLine(L) {
  const out = {};
  for (const g in L) {
    const o = {};
    for (const k in L[g]) if (L[g][k]) o[k] = Math.round(L[g][k] * 10) / 10;
    if (Object.keys(o).length) out[g] = o;
  }
  return out;
}

// ---------- leaders ----------
const CATS = {
  passYds: { label: 'Passing yards', get: (x) => x.pass?.yds || 0 },
  passTD: { label: 'Passing TD', get: (x) => x.pass?.td || 0 },
  rushYds: { label: 'Rushing yards', get: (x) => x.rush?.yds || 0 },
  rushTD: { label: 'Rushing TD', get: (x) => x.rush?.td || 0 },
  recYds: { label: 'Receiving yards', get: (x) => x.rec?.yds || 0 },
  rec: { label: 'Receptions', get: (x) => x.rec?.rec || 0 },
  sacks: { label: 'Sacks', get: (x) => Math.round((x.def?.sack || 0) * 10) / 10 },
  ints: { label: 'Interceptions', get: (x) => x.def?.int || 0 },
  tackles: { label: 'Tackles', get: (x) => (x.def?.tkl || 0) + (x.def?.ast || 0) },
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
export const seasonKey = (league) => (league?.source ? `${KEY}-${league.source}` : KEY);
export function loadSeason(key = KEY) {
  try {
    const raw = globalThis.localStorage?.getItem(key);
    if (!raw) return null;
    const s = JSON.parse(raw);
    return s && s.version === SEASON_VERSION ? s : null;
  } catch { return null; }
}
export function saveSeason(s, key = KEY) { try { globalThis.localStorage?.setItem(key, JSON.stringify(s)); return true; } catch { return false; } }
export function clearSeason(key = KEY) { try { globalThis.localStorage?.removeItem(key); } catch { /* ignore */ } }
