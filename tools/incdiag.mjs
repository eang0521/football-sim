// Why do passes fall incomplete? Breakdown by route and reason.
import { generateLeague } from '../js/data/teamgen.js';
import { PlaySim } from '../js/sim/playsim.js';
import { RNG } from '../js/util/rng.js';
import { callOffense, callDefense } from '../js/sim/playcaller.js';
const lg = generateLeague(777); const rng = new RNG(9); const agg = {};
for (let i = 0; i < 600; i++) {
  const off = lg.teams[i % 8], def = lg.teams[(i + 3) % 8];
  const ctx = { down: 1 + (i % 3), toGo: [10, 7, 4, 10, 2][i % 5], ballOn: 25 + (i % 45), quarter: 2, clock: 600, scoreDiff: 0 };
  let offCall; do { offCall = callOffense(off, ctx, rng); } while (offCall.play.kind !== 'pass');
  const defCall = callDefense(def, ctx, offCall, rng);
  const sim = new PlaySim({ kind: 'scrimmage', offTeam: off, defTeam: def, offCall, defCall, los: ctx.ballOn, ballY: 26.67, firstDownX: ctx.ballOn + ctx.toGo, rng, skipLineup: true, ctx });
  const r = sim.runToEnd(); const st = sim.st;
  if (!st.thrown || st.away) continue;
  const k = st.target ? st.target.d.route?.name || '?' : '?';
  const why = sim.notes.some((n) => n.type === 'batted') ? 'batted' : st.catcher ? 'cmp' : st.int ? 'int' : st.pbu ? 'pbu' : st.drop ? 'drop' : st.oobCatch ? 'oob' : 'ground';
  (agg[k] ||= { n: 0 }); agg[k].n++; agg[k][why] = (agg[k][why] || 0) + 1;
}
for (const [k, v] of Object.entries(agg).sort((a, b) => b[1].n - a[1].n)) console.log(k.padEnd(9), JSON.stringify(v));
