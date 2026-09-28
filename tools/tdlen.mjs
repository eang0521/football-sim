import { generateLeague } from '../js/data/teamgen.js';
import { Game } from '../js/sim/game.js';
const lg = generateLeague(777); const lens = []; const kinds = {};
for (let g = 0; g < 8; g++) {
  const game = new Game(lg.teams[g % 8], lg.teams[(g + 3) % 8], { seed: 1000 + g }); game.simToEnd();
  for (const e of game.log) if (/TOUCHDOWN/.test(e.text)) {
    const m = e.text.match(/for (\d+) yards?/); const k = /INTERCEPTED/.test(e.text) ? 'pick6' : /punts|kicks/.test(e.text) ? 'return' : /pass/.test(e.text) ? 'pass' : 'run';
    kinds[k] = (kinds[k] || 0) + 1; if (m) lens.push(+m[1]);
  }
}
lens.sort((a, b) => a - b);
console.log(kinds, 'TD lengths:', lens.join(' '));
