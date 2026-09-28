// 4th-down pass plays: how do they end? (throwaways should never happen)
import { generateLeague } from '../js/data/teamgen.js';
import { PlaySim } from '../js/sim/playsim.js';
import { RNG } from '../js/util/rng.js';
import { callOffense, callDefense } from '../js/sim/playcaller.js';
const lg = generateLeague(777); const rng = new RNG(4);
for (const down of [3, 4]) {
  const c = { n: 0, away: 0, sack: 0, cmp: 0, inc: 0, int: 0, scr: 0, conv: 0 };
  for (let i = 0; i < 500; i++) {
    const off = lg.teams[i % 8], def = lg.teams[(i + 3) % 8];
    const ctx = { down, toGo: 3 + (i % 6), ballOn: 40 + (i % 25), quarter: 4, clock: 400, scoreDiff: -3 };
    let offCall; do { offCall = callOffense(off, ctx, rng); } while (offCall.play.kind !== 'pass');
    const defCall = callDefense(def, ctx, offCall, rng);
    const sim = new PlaySim({ kind: 'scrimmage', offTeam: off, defTeam: def, offCall, defCall, los: ctx.ballOn, ballY: 26.67, firstDownX: ctx.ballOn + ctx.toGo, rng, skipLineup: true, ctx });
    const r = sim.runToEnd(); c.n++;
    if (sim.st.away) c.away++; else if (r.kind === 'sack') c.sack++; else if (r.kind === 'scramble') c.scr++;
    else if (r.turnover) c.int++; else if (r.outcome === 'incomplete') c.inc++; else c.cmp++;
    if (r.possession === 'O' && (r.td || r.spotX >= ctx.ballOn + ctx.toGo)) c.conv++;
  }
  console.log(`down ${down}:`, JSON.stringify(c));
}
