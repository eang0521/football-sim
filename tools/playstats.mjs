// Aggregate outcomes for many isolated plays: node tools/playstats.mjs [run|pass|all] [N]
import { generateLeague } from '../js/data/teamgen.js';
import { PlaySim } from '../js/sim/playsim.js';
import { RNG } from '../js/util/rng.js';
import { callOffense, callDefense } from '../js/sim/playcaller.js';

const mode = process.argv[2] || 'all';
const N = parseInt(process.argv[3] || '300', 10);
const lg = generateLeague(777);
const rng = new RNG(42);
const agg = {};
const bucket = (k) => (agg[k] ||= { n: 0, yds: 0, arr: [], sack: 0, inc: 0, int: 0, cmp: 0, td: 0, away: 0, scr: 0, time: 0, fum: 0, brk: 0, juke: 0 });
const t0 = Date.now();
for (let i = 0; i < N; i++) {
  const off = lg.teams[i % 8], def = lg.teams[(i + 3) % 8];
  const ctx = { down: 1 + (i % 3), toGo: [10, 7, 4, 10, 2][i % 5], ballOn: 25 + (i % 50), quarter: 2, clock: 600, scoreDiff: 0 };
  let offCall;
  for (let k = 0; k < 20; k++) {
    offCall = callOffense(off, ctx, rng);
    if (mode === 'all' || offCall.play.kind === mode) break;
  }
  const defCall = callDefense(def, { ...ctx }, offCall, rng);
  const sim = new PlaySim({ kind: 'scrimmage', offTeam: off, defTeam: def, offCall, defCall, los: ctx.ballOn, ballY: 26.67,
    firstDownX: ctx.ballOn + ctx.toGo, rng, skipLineup: true, ctx });
  const r = sim.runToEnd();
  const key = r.kind;
  for (const k of [key, offCall.play.kind === 'run' ? `run:${offCall.play.id}` : `pass:${offCall.play.id}`, `def:${defCall.cov}`]) {
    const b = bucket(k);
    const y = r.possession === 'O' ? (r.td === 'O' ? 100 - ctx.ballOn : Math.round(r.spotX - ctx.ballOn)) : 0;
    b.n++; b.yds += y; b.arr.push(y); b.time += r.elapsed;
    if (r.kind === 'sack') b.sack++;
    if (r.outcome === 'incomplete') b.inc++;
    if (r.kind === 'pass' && r.outcome !== 'incomplete' && !r.turnover) b.cmp++;
    if (r.turnover && r.kind === 'pass') b.int++;
    if (r.turnover && r.kind !== 'pass') b.fum++;
    if (r.td === 'O') b.td++;
    if (r.desc.includes('away')) b.away++;
    if (r.kind === 'scramble') b.scr++;
    b.brk += sim.notes.filter((n) => n.type === 'broken').length; b.juke += sim.notes.filter((n) => n.type === 'juke').length;
  }
}
console.log(`${N} plays in ${((Date.now() - t0) / 1000).toFixed(1)}s`);
const rows = Object.entries(agg).sort((a, b) => a[0].localeCompare(b[0]));
for (const [k, b] of rows) {
  const s = b.arr.slice().sort((x, y) => x - y);
  const pct = (p) => s[Math.floor(p * (s.length - 1))];
  console.log(`${k.padEnd(16)} n=${String(b.n).padStart(4)} avg=${(b.yds / b.n).toFixed(1).padStart(5)} med=${String(pct(0.5)).padStart(3)} p10=${String(pct(0.1)).padStart(3)} p90=${String(pct(0.9)).padStart(3)} ` +
    `cmp=${b.cmp} inc=${b.inc} int=${b.int} sack=${b.sack} away=${b.away} scr=${b.scr} td=${b.td} fum=${b.fum} t=${(b.time / b.n).toFixed(1)}s brk=${(b.brk / b.n).toFixed(2)} juke=${(b.juke / b.n).toFixed(2)}`);
}
