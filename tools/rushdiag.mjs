import { generateLeague } from '../js/data/teamgen.js';
import { PlaySim } from '../js/sim/playsim.js';
import { RNG } from '../js/util/rng.js';
import { PASS_PLAYS, DEF_CALLS } from '../js/sim/playbook.js';
// Pass pro only: receivers run routes but the QB never throws (hold ball), measure time to first pressure/sack.
const lg = generateLeague(777); const rng = new RNG(5);
const play = { kind: 'pass', ...PASS_PLAYS.find((p) => p.id === 'verts') };
let sheds = [], sackT = [], pressT = [];
for (let i = 0; i < 200; i++) {
  const dc = DEF_CALLS[i % 7];
  const sim = new PlaySim({ kind: 'scrimmage', offTeam: lg.teams[i % 8], defTeam: lg.teams[(i + 3) % 8], offCall: { formation: 'gun_doubles', flip: false, play }, defCall: { front: 'nickel', cov: dc.cov, blitz: dc.blitz }, los: 30, ballY: 26.67, rng, skipLineup: true, ctx: {} });
  sim.noThrow = true;
  let pressed = null;
  while (sim.phase !== 'dead' && sim.t < 8) {
    sim.step(1 / 60);
    const qb = sim.qb();
    if (!pressed && sim.def.some((d) => !d.blockers.length && Math.hypot(d.x - qb.x, d.y - qb.y) < 2)) pressed = sim.t;
  }
  const sh = sim.notes.find((n) => n.type === 'shed'); if (sh) sheds.push(sh.t);
  pressT.push(pressed ?? 9);
  if (sim.result?.kind === 'sack') sackT.push(sim.t);
}
const pct = (arr, t) => (100 * arr.filter((x) => x <= t).length / 200).toFixed(0) + '%';
console.log('first shed by 1.5/2.5/3.5s:', pct(sheds, 1.5), pct(sheds, 2.5), pct(sheds, 3.5));
console.log('pressure(<2yd) by 2/2.5/3/4s:', pct(pressT, 2), pct(pressT, 2.5), pct(pressT, 3), pct(pressT, 4));
console.log('sack by 2.5/3/4/6s:', pct(sackT, 2.5), pct(sackT, 3), pct(sackT, 4), pct(sackT, 6));
