import { generateLeague } from '../js/data/teamgen.js';
import { PlaySim } from '../js/sim/playsim.js';
import { RNG } from '../js/util/rng.js';
import { callOffense, callDefense } from '../js/sim/playcaller.js';
const N = parseInt(process.argv[2] || "400", 10);
const lg = generateLeague(777); const rng = new RNG(9);
const bySlot = {}; let thrownAt = 0, nThrow = 0, air = 0, yac = 0, nc = 0, sacks = 0, drops = 0, pbu = 0, ints = 0, away = 0, n = 0, pressT = 0;
const hist = {}; const big = []; const yb = {}; const dep = { att: 0, cmp: 0, mid: 0, midc: 0, sh: 0, shc: 0 };
for (let i = 0; i < N; i++) {
  const off = lg.teams[i % 8], def = lg.teams[(i + 3) % 8];
  const ctx = { down: 1 + (i % 3), toGo: [10, 7, 4, 10, 2][i % 5], ballOn: 25 + (i % 45), quarter: 2, clock: 600, scoreDiff: 0 };
  let offCall; do { offCall = callOffense(off, ctx, rng); } while (offCall.play.kind !== 'pass');
  const defCall = callDefense(def, ctx, offCall, rng);
  const sim = new PlaySim({ kind: 'scrimmage', offTeam: off, defTeam: def, offCall, defCall, los: ctx.ballOn, ballY: 26.67, firstDownX: ctx.ballOn + ctx.toGo, rng, skipLineup: true, ctx });
  const r = sim.runToEnd(); n++;
  const st = sim.st;
  if (r.kind === 'sack') sacks++;
  if (st.thrown && !st.away) {
    nThrow++; const th = sim.notes.find((x) => x.type === 'throw'); thrownAt += th ? th.t : 0;
    const tg = st.target; const k = tg ? tg.slot + ':' + (tg.d.route?.name || '?') : '-';
    bySlot[k] = bySlot[k] || { n: 0, c: 0, yac: 0 }; bySlot[k].n++;
    if (st.catcher && r.spotX - sim.los >= 25) big.push(`${k} vs ${defCall.cov} air${(st.catchX - sim.los).toFixed(0)} yac${(r.spotX - st.catchX).toFixed(0)} throwT${(sim.notes.find((x) => x.type === 'throw')?.t || 0).toFixed(1)}`);
    if (st.catcher) { const bk = st.catchNearD < 1.5 ? '<1.5' : st.catchNearD < 3 ? '1.5-3' : st.catchNearD < 5 ? '3-5' : st.catchNearD < 8 ? '5-8' : '8+'; (yb[bk] ||= [0, 0, 0]); yb[bk][0]++; yb[bk][1] += r.spotX - st.catchX; if (r.spotX - st.catchX > 15) yb[bk][2]++; }
    if (st.catcher) { bySlot[k].c++; bySlot[k].yac += r.spotX - st.catchX; nc++; air += st.catchX - sim.los; yac += r.spotX - st.catchX; }
    { const ay = sim.ball.pass ? sim.ball.pass.airYds : (st.catchX ?? sim.ball.x) - sim.los; const land = sim.notes.find((x)=>x.type==='throw'); }
    const ay = st.airYds; const done = !!st.catcher;
    if (ay >= 20) { dep.att++; if (done) dep.cmp++; } else if (ay >= 10) { dep.mid++; if (done) dep.midc++; } else { dep.sh++; if (done) dep.shc++; }
    if (st.drop) drops++; if (st.pbu) pbu++; if (st.int) ints++;
    const b = Math.floor((th?.t || 0) * 2) / 2; hist[b] = (hist[b] || 0) + 1;
  }
  if (st.away) away++;
}
console.log(`dropbacks ${n} throws ${nThrow} sacks ${sacks} (${(100 * sacks / n).toFixed(1)}%) away ${away} avgThrowT ${(thrownAt / nThrow).toFixed(2)}s`);
console.log(`cmp ${nc}/${nThrow} ${(100 * nc / nThrow).toFixed(1)}%  airYds/cmp ${(air / nc).toFixed(1)} yac ${(yac / nc).toFixed(1)} drops ${drops} pbu ${pbu} int ${ints}`);
console.log('throw time hist', JSON.stringify(hist));
console.log(Object.entries(bySlot).sort((a, b) => b[1].n - a[1].n).slice(0, 25).map(([k, v]) => `${k} ${v.c}/${v.n} yac${v.c ? (v.yac / v.c).toFixed(0) : '-'}`).join('  '));

console.log(`air<10: ${dep.shc}/${dep.sh}  10-19: ${dep.midc}/${dep.mid}  20+: ${dep.cmp}/${dep.att}`);
for (const k of ['<1.5','1.5-3','3-5','5-8','8+']) if (yb[k]) console.log(`nearest def ${k}: n=${yb[k][0]} yac=${(yb[k][1]/yb[k][0]).toFixed(1)} yac15+=${yb[k][2]}`);
console.log('BIG PLAYS', big.length); console.log(big.join(String.fromCharCode(10)));
