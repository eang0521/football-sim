// Simulate a full season for a league file and compare leaders/distributions with NFL norms.
// Each week's games run in parallel worker threads (weeks stay sequential for injuries).
// Usage: node tools/nflseason.mjs [league.json] [--weeks N] [--workers N] [--no-playoffs]
import fs from 'node:fs';
import os from 'node:os';
import { Worker, isMainThread, parentPort, workerData } from 'node:worker_threads';
import { Game } from '../js/sim/game.js';

if (!isMainThread) {
  const lg = JSON.parse(fs.readFileSync(workerData.file, 'utf8'));
  const byId = new Map(lg.teams.map((t) => [t.id, t]));
  parentPort.on('message', ({ i, home, away, out, noTie }) => {
    const game = new Game(byId.get(home), byId.get(away), { out: new Set(out), noTie });
    game.simToEnd();
    // only what recordGame + this report needs (players keyed by id so they cross the thread boundary)
    const pidTeam = new Map([...game.stats.pidTeam].filter(([pid]) => game.stats.players.has(pid)));
    parentPort.postMessage({ i, res: {
      s: { score: game.s.score, quarter: game.s.quarter },
      stats: { players: game.stats.players, pidTeam, team: game.stats.team },
      injuries: game.injuries, teams: { home: { id: home }, away: { id: away } },
    } });
  });
} else {
  const { createSeason, currentGames, recordGame, standings, outPlayers } = await import('../js/season/season.js');
  const args = process.argv.slice(2);
  const opt = (k, d) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : d; };
  const file = args[0] && !args[0].startsWith('--') ? args[0] : 'private/nfl-league.json';
  const WEEKS = +opt('--weeks', 99);
  const NW = +opt('--workers', Math.max(1, os.availableParallelism() - 1));
  const lg = JSON.parse(fs.readFileSync(file, 'utf8'));
  const season = createSeason(lg);
  const workers = Array.from({ length: NW }, () => new Worker(new URL(import.meta.url), { workerData: { file } }));
  const runAll = (games) => new Promise((resolve) => {
    const out = new Array(games.length);
    let next = 0, done = 0;
    const feed = (w) => {
      if (next >= games.length) return;
      const i = next++, g = games[i];
      w.postMessage({ i, home: g.home, away: g.away, out: [...outPlayers(season)], noTie: !!g.playoff });
    };
    for (const w of workers) {
      w.removeAllListeners('message');
      w.on('message', ({ i, res }) => { out[i] = res; if (++done === games.length) resolve(out); else feed(w); });
      feed(w);
    }
  });

  const full = new Map(); // pid -> { name, pos, team, line } with every box-score field
  const teamTot = {}; // team id -> summed team box score
  const add = (a, b) => { for (const k in b) { if (typeof b[k] === 'object') add(a[k] ||= {}, b[k]); else if (k !== 'long') a[k] = (a[k] || 0) + b[k]; } };
  const t0 = Date.now();
  let wk = 0;
  while (season.phase !== 'done') {
    if (season.phase === 'regular' && wk >= WEEKS) break;
    if (season.phase === 'playoffs' && args.includes('--no-playoffs')) break;
    const games = currentGames(season);
    const res = await runAll(games);
    const regular = season.phase === 'regular';
    games.forEach((g, i) => {
      const r = res[i];
      if (regular) {
        for (const [pid, L] of r.stats.players) {
          const info = r.stats.pidTeam.get(pid);
          if (!info) continue;
          const cur = full.get(pid) || { name: `${info.p.first} ${info.p.last}`, pos: info.p.pos, team: r.teams[info.key].id, line: {}, gp: 0 };
          add(cur.line, L); cur.gp++;
          full.set(pid, cur);
        }
        for (const k of ['home', 'away']) add(teamTot[r.teams[k].id] ||= {}, { ...r.stats.team[k], pts: r.s.score[k], ptsAllowed: r.s.score[k === 'home' ? 'away' : 'home'], g: 1 });
      }
      recordGame(season, lg, g, r);
    });
    if (regular) wk++;
    process.stdout.write(`\r${regular ? `week ${wk}` : 'playoffs'} done, ${((Date.now() - t0) / 1000).toFixed(0)}s   `);
  }
  await Promise.all(workers.map((w) => w.terminate()));
  console.log();

  // ---------- report ----------
  const P = [...full.values()];
  const v = (p, path) => path.split('.').reduce((o, k) => (o ? o[k] : 0), p.line) || 0;
  const top = (path, n = 5, fmt = (x) => Math.round(x * 10) / 10) => P.slice().sort((a, b) => v(b, path) - v(a, path)).slice(0, n)
    .map((p) => `${p.name} ${p.pos} ${p.team} ${fmt(v(p, path))}`).join('; ');
  const count = (path, min) => P.filter((p) => v(p, path) >= min).length;
  const gamesPlayed = Math.min(17, wk);
  const sc = gamesPlayed / 17;
  console.log(`\n${Object.keys(teamTot).length} teams, ${wk} week(s) of regular season${sc < 1 ? ` (NFL references scaled to ${gamesPlayed} games)` : ''}`);
  const rows = [
    ['Pass yds', 'pass.yds', '~4,700-5,000', [4000 * sc, '4000+ passers', '~6-10']],
    ['Pass TD', 'pass.td', '~38-45', null],
    ['INT thrown', 'pass.int', '~14-18', null],
    ['Rush yds', 'rush.yds', '~1,700-2,000', [1000 * sc, '1000+ rushers', '~15-20']],
    ['Rush TD', 'rush.td', '~15-18', null],
    ['Receptions', 'rec.rec', '~120-130', null],
    ['Rec yds', 'rec.yds', '~1,650-1,800', [1000 * sc, '1000+ receivers', '~20-25']],
    ['Rec TD', 'rec.td', '~13-17', null],
    ['Tackles', 'def.tkl', '~170-190 (solo+ast)', null],
    ['Sacks', 'def.sack', '~17-20', [10 * sc, '10+ sack players', '~15-20']],
    ['TFL', 'def.tfl', '~20-25', null],
    ['INT', 'def.int', '~7-9', null],
    ['PD', 'def.pd', '~18-22', null],
    ['FF', 'def.ff', '~5-6', null],
  ];
  for (const [label, path, ref, cnt] of rows) {
    console.log(`${label.padEnd(11)} NFL leader ${ref.padEnd(22)} | ${top(path)}`);
    if (cnt) console.log(`${''.padEnd(11)} ${cnt[1]}: ${count(path, cnt[0])} (NFL ${cnt[2]})`);
  }
  // tackles incl. assists
  const tk = (p) => (p.line.def?.tkl || 0) + (p.line.def?.ast || 0);
  console.log('Tackles+ast top:', P.slice().sort((a, b) => tk(b) - tk(a)).slice(0, 5).map((p) => `${p.name} ${p.pos} ${tk(p)}`).join('; '));

  // sack distribution by position and concentration within teams
  const sackBy = {};
  let sackAll = 0;
  for (const p of P) { const s = v(p, 'def.sack'); sackBy[p.pos] = (sackBy[p.pos] || 0) + s; sackAll += s; }
  console.log('\nSack share by position:', Object.entries(sackBy).sort((a, b) => b[1] - a[1]).map(([k, x]) => `${k} ${(100 * x / sackAll).toFixed(0)}%`).join(', '),
    '(NFL: edge ~55%, interior DL ~22%, LB ~13%, DB ~7%)');
  const shares = Object.keys(teamTot).map((id) => {
    const ts = P.filter((p) => p.team === id).map((p) => v(p, 'def.sack')).sort((a, b) => b - a);
    const tot = ts.reduce((s, x) => s + x, 0);
    return { id, tot, top: ts[0] / (tot || 1) };
  });
  console.log(`Team sacks: ${Math.min(...shares.map((s) => s.tot)).toFixed(0)}-${Math.max(...shares.map((s) => s.tot)).toFixed(0)} per team, avg ${(shares.reduce((s, x) => s + x.tot, 0) / shares.length).toFixed(1)} (NFL ~30-60, avg ~42 per 17)`);
  console.log(`Top rusher's share of team sacks: avg ${(100 * shares.reduce((s, x) => s + x.top, 0) / shares.length).toFixed(0)}%, max ${(100 * Math.max(...shares.map((s) => s.top))).toFixed(0)}% (NFL ~30-35%, rarely >50%)`);

  // team scoring spread and records
  const T = Object.entries(teamTot).map(([id, t]) => ({ id, ppg: t.pts / t.g, papg: t.ptsAllowed / t.g, ypc: t.rushYds / Math.max(1, t.rushAtt), cmp: t.passCmp / Math.max(1, t.passAtt), sacks: t.sacks / t.g }));
  const mm = (k) => `${Math.min(...T.map((t) => t[k])).toFixed(1)}-${Math.max(...T.map((t) => t[k])).toFixed(1)}`;
  console.log(`\nTeam PPG ${mm('ppg')} (NFL ~15-31) | PA/G ${mm('papg')} | YPC ${mm('ypc')} (NFL ~3.8-5.2) | cmp% ${mm('cmp')} (NFL ~.58-.71)`);
  const st = standings(season, lg);
  console.log('Standings:', st.map((r) => `${r.id} ${r.w}-${r.l}${r.t ? '-' + r.t : ''}`).join(', '));
  if (season.playoffs) for (const round of season.playoffs.rounds) console.log(round.map((g) => g.result ? `${g.playoff}: ${g.away} ${g.result.awayScore} @ ${g.home} ${g.result.homeScore}` : '').join(' | '));
  if (season.champion) console.log('Champion:', season.champion);
  fs.mkdirSync('private/cache', { recursive: true });
  fs.writeFileSync('private/cache/season-dump.json', JSON.stringify({ players: P, teams: teamTot }));
  console.log(`\n${((Date.now() - t0) / 1000).toFixed(0)}s total; player lines saved to private/cache/season-dump.json`);
}
