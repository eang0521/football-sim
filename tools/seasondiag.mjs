// Simulate a full season headlessly and print standings, playoffs, leaders.
import { generateLeague } from '../js/data/teamgen.js';
import { createSeason, currentGames, createSeasonGame, recordGame, standings, leaders, developPlayers } from '../js/season/season.js';
const lg = generateLeague(777);
let season = createSeason(lg);
const t0 = Date.now();
let guard = 0;
while (season.phase !== 'done' && guard++ < 200) {
  for (const g of currentGames(season)) { const game = createSeasonGame(season, lg, g); game.simToEnd(); recordGame(season, lg, g, game); }
}
console.log(`season sim ${((Date.now() - t0) / 1000).toFixed(1)}s, weeks ${season.weeks.length}`);
for (const r of standings(season, lg)) console.log(`${r.team.abbr} ${r.w}-${r.l}${r.t ? '-' + r.t : ''} PF ${r.pf} PA ${r.pa} ${r.streak}`);
for (const round of season.playoffs.rounds) console.log(round.map((g) => `${g.playoff}: ${g.away} ${g.result.awayScore} @ ${g.home} ${g.result.homeScore}${g.result.ot ? ' OT' : ''}`).join(' | '));
console.log('champion', season.champion, 'injured now', Object.keys(season.injuries).length);
const L = leaders(season, 3);
for (const k of ['passYds', 'rushYds', 'recYds', 'sacks', 'ints']) console.log(k, L[k].map((r) => `${r.name} (${r.team}) ${r.v}`).join('; '));
console.log('dev sample', developPlayers(lg).slice(0, 3));
