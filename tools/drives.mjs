import { generateLeague } from '../js/data/teamgen.js';
import { Game } from '../js/sim/game.js';
const lg = generateLeague(777); let nd = 0, pts = 0, g = 0, plays = 0; const res = {}; let secs = 0;
for (let i = 0; i < 8; i++) {
  const game = new Game(lg.teams[i % 8], lg.teams[(i + 3) % 8], { seed: 50 + i }); game.simToEnd(); g++;
  nd += game.drives.length; pts += game.s.score.home + game.s.score.away;
  for (const d of game.drives) { res[d.result] = (res[d.result] || 0) + 1; plays += d.plays; }
}
console.log('drives/team-game', (nd / g / 2).toFixed(1), 'pts/drive', (pts / nd).toFixed(2), 'plays/drive', (plays / nd).toFixed(1), res);
