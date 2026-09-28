import { generateLeague } from '../js/data/teamgen.js';
import { Game } from '../js/sim/game.js';
const lg = generateLeague(777);
for (const w of ['clear', 'rain', 'snow', 'wind', 'cold']) {
  let pts = 0, cmp = 0, att = 0, fum = 0, fga = 0, fgm = 0, ya = 0, G = 0;
  for (let g = 0; g < 10; g++) {
    const game = new Game(lg.teams[g % 8], lg.teams[(g + 3) % 8], { seed: 300 + g, weather: w }); game.simToEnd(); G += 2;
    pts += game.s.score.home + game.s.score.away;
    for (const k of ['home', 'away']) { const T = game.stats.team[k]; cmp += T.passCmp; att += T.passAtt; ya += T.passYds; }
    for (const [, L] of game.stats.players) { fum += L.fum.lost; fga += L.kick.fga; fgm += L.kick.fgm; }
  }
  console.log(`${w.padEnd(6)} pts/team ${(pts / G).toFixed(1)}  cmp ${(100 * cmp / att).toFixed(1)}%  Y/A ${(ya / att).toFixed(1)}  fumLost/g ${(fum / G).toFixed(2)}  FG ${fgm}/${fga}`);
}
