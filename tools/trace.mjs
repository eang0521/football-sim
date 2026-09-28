// Trace a single play: node tools/trace.mjs <playId> [defCallId] [seed]
import { generateLeague } from '../js/data/teamgen.js';
import { PlaySim } from '../js/sim/playsim.js';
import { RNG } from '../js/util/rng.js';
import { PASS_PLAYS, RUN_PLAYS, DEF_CALLS } from '../js/sim/playbook.js';

const [pid = 'iz', did = 'c3', seed = '5', form] = process.argv.slice(2).filter((x) => !x.startsWith('-'));
const lg = generateLeague(777);
const rng = new RNG(+seed);
const pass = PASS_PLAYS.find((p) => p.id === pid);
const run = RUN_PLAYS.find((p) => p.id === pid);
const play = pass ? { kind: 'pass', ...pass } : { kind: 'run', ...run, carrierSlot: run.scheme === 'sneak' ? 'QB' : 'F' };
const dc = DEF_CALLS.find((d) => d.id === did);
const offCall = { formation: form || play.forms[0], flip: false, runDir: -1, play };
const defCall = { front: 'nickel', cov: dc.cov, blitz: dc.blitz, lurk: dc.lurk };
const sim = new PlaySim({ kind: 'scrimmage', offTeam: lg.teams[0], defTeam: lg.teams[1], offCall, defCall, los: 30, ballY: 26.67, rng, skipLineup: true, ctx: { down: 1, toGo: 10 } });
const show = (a) => `${a.slot}(${a.x.toFixed(1)},${a.y.toFixed(1)} v${Math.hypot(a.vx, a.vy).toFixed(1)}${a.engaged ? ' E' : ''}${a.blockers.length ? ' B' + a.blockers.length : ''})`;
let k = 0;
while (sim.phase !== 'dead' && k < 60 * 12) {
  sim.step(1 / 60); k++;
  if (process.argv.includes('-a') && k % 30 === 0) ascii(sim);
  if (k % 15 === 0 && !process.argv.includes('-a')) {
    const c = sim.carrierAgent();
    console.log(`t=${sim.t.toFixed(2)} ball=${sim.ball.state} holder=${c?.slot || '-'} ` + (c ? show(c) : `ball(${sim.ball.x.toFixed(1)},${sim.ball.y.toFixed(1)},${sim.ball.z.toFixed(1)})`));
    if (process.argv.includes('-v')) console.log('   O: ' + sim.off.map(show).join(' ') + '\n   D: ' + sim.def.map(show).join(' '));
  }
}
console.log(sim.result.desc, sim.result.outcome);
console.log(sim.notes.map((n) => `${n.t.toFixed(2)} ${n.type} ${n.a?.last || ''} ${n.b?.last || ''}`).join('\n'));

function ascii(sim) {
  const c = sim.carrierAgent();
  const x0 = Math.floor(sim.los - 10), W = 50, H = 27; // x across, y down (y scaled /2)
  const g = Array.from({ length: H }, () => Array(W).fill('.'));
  for (let i = 0; i < H; i++) g[i][Math.round(sim.los - x0)] = '|';
  for (const a of sim.agents) {
    const col = Math.round(a.x - x0), row = H - 1 - Math.round(a.y / 2);
    if (col < 0 || col >= W || row < 0 || row >= H) continue;
    let ch = a.side === 'O' ? 'o' : 'x';
    if (a.engaged || a.blockers.length) ch = a.side === 'O' ? 'O' : 'X';
    if (a === c) ch = '@';
    if (a.down) ch = '_';
    g[row][col] = ch;
  }
  console.log(`t=${sim.t.toFixed(2)}  (o=off x=def, caps=engaged, @=ball)`);
  console.log(g.map((r) => r.join('')).join(String.fromCharCode(10)));
}
