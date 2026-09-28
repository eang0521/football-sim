// Accuracy of the QB's route prediction: predicted vs actual receiver position 0.7s later.
import { generateLeague } from '../js/data/teamgen.js';
import { PlaySim } from '../js/sim/playsim.js';
import { RNG } from '../js/util/rng.js';
import { PASS_PLAYS, DEF_CALLS } from '../js/sim/playbook.js';
import { predictRoutePos } from '../js/sim/ai.js';
const lg = generateLeague(777);
for (const [pid, slot, t0] of [['slants', 'X', 0.6], ['slants', 'X', 1.0], ['curlflat', 'X', 1.2], ['levels', 'X', 1.4], ['stick', 'Y', 0.8], ['drive', 'H', 1.0]]) {
  let ex = 0, ey = 0, n = 0;
  for (let i = 0; i < 40; i++) {
    const play = { kind: 'pass', ...PASS_PLAYS.find((p) => p.id === pid) };
    const sim = new PlaySim({ kind: 'scrimmage', offTeam: lg.teams[i % 8], defTeam: lg.teams[(i + 2) % 8], offCall: { formation: 'gun_doubles', flip: false, play },
      defCall: { front: 'nickel', ...DEF_CALLS[i % 6], cov: DEF_CALLS[i % 6].cov }, los: 30, ballY: 26.67, rng: new RNG(i), skipLineup: true, ctx: {} });
    sim.noThrow = true;
    const r = sim.bySlotO[slot];
    while (sim.t < t0 && sim.phase === 'live') sim.step(1 / 60);
    if (sim.phase !== 'live') continue;
    const p = predictRoutePos(r, 0.7);
    while (sim.t < t0 + 0.7 && sim.phase === 'live') sim.step(1 / 60);
    if (sim.phase !== 'live') continue;
    ex += p.x - r.x; ey += Math.abs(p.y - r.y); n++;
  }
  console.log(`${pid}/${slot} @${t0}s: mean dx(pred-actual) ${(ex / n).toFixed(2)}  mean |dy| ${(ey / n).toFixed(2)}  n=${n}`);
}
