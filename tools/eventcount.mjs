// Count notable game events across many games (reviews, challenges, spikes, onside, fakes...).
import { generateLeague } from '../js/data/teamgen.js';
import { Game } from '../js/sim/game.js';
const lg = generateLeague(777);
const pats = { review: /booth review/, challenge: /challenge flag/, reversed: /REVERSED/, spike: /spikes the ball/, onside: /[Oo]nside kick/,
  onsideRec: /ONSIDE KICK RECOVERED/, squib: /squibs/, fake: /FAKE/, safetyInt: /intentional safety/, runoff10: /10-second runoff/, audible: /audible/, adjust: /Halftime adjustments/, victory: /Victory Formation/ };
const cnt = Object.fromEntries(Object.keys(pats).map((k) => [k, 0]));
const samples = {};
const N = +(process.argv[2] || 20);
for (let g = 0; g < N; g++) {
  const game = new Game(lg.teams[g % 8], lg.teams[(g + 3) % 8], { seed: 500 + g }); game.simToEnd();
  for (const e of game.log) for (const [k, re] of Object.entries(pats)) if (re.test(e.text + ' ' + (e.label || ''))) { cnt[k]++; samples[k] ||= `${e.prefix ? e.prefix + ': ' : ''}${e.text}`; }
}
console.log(`per ${N} games:`, JSON.stringify(cnt));
for (const [k, v] of Object.entries(samples)) console.log(`  ${k}: ${v.slice(0, 150)}`);
