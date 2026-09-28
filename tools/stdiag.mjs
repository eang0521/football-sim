// Special-teams scenario checks: onside recovery rate, squib, fake punt / FG outcomes.
import { generateLeague } from '../js/data/teamgen.js';
import { PlaySim } from '../js/sim/playsim.js';
import { RNG } from '../js/util/rng.js';
const lg = generateLeague(777);
const run = (cfg, n) => { const out = []; for (let i = 0; i < n; i++) { const sim = new PlaySim({ ...cfg, offTeam: lg.teams[i % 8], defTeam: lg.teams[(i + 3) % 8], rng: new RNG(i + 1), skipLineup: true, dir: 1 }); out.push(sim.runToEnd()); } return out; };
let r = run({ kind: 'kickoff', los: 35, ballY: 26.67, kickType: 'onside' }, 200);
const kept = r.filter((x) => x.possession === 'O').length;
console.log(`onside: kicking team recovers ${kept}/200 (${(kept / 2).toFixed(0)}%), sample: ${r[0].desc}`);
r = run({ kind: 'kickoff', los: 35, ballY: 26.67, kickType: 'squib' }, 60);
console.log(`squib: avg receiving start ${(r.reduce((s, x) => s + (100 - x.spotX), 0) / 60).toFixed(1)}, sample: ${r[0].desc}`);
r = run({ kind: 'punt', los: 45, ballY: 26.67, fake: true }, 100);
console.log(`fake punt: avg ${(r.reduce((s, x) => s + (x.spotX - 45), 0) / 100).toFixed(1)} yds, conv(>=3) ${r.filter((x) => x.spotX - 45 >= 3).length}%, sample: ${r[0].desc}`);
r = run({ kind: 'fg', los: 75, ballY: 26.67, fake: true }, 100);
console.log(`fake FG: avg ${(r.reduce((s, x) => s + (x.spotX - 75), 0) / 100).toFixed(1)} yds, conv(>=3) ${r.filter((x) => x.spotX - 75 >= 3).length}%, sample: ${r[0].desc}`);
