// Open-field 1-on-1: ball carrier vs a single defender approaching from depth.
// node tools/openfield.mjs [depth] [lateral]
import { generateLeague } from '../js/data/teamgen.js';
import { PlaySim } from '../js/sim/playsim.js';
import { RNG } from '../js/util/rng.js';
import { PASS_PLAYS, DEF_CALLS } from '../js/sim/playbook.js';

const depth = +(process.argv[2] || 12), lat = +(process.argv[3] || 4);
const lg = generateLeague(777); const rng = new RNG(1);
const play = { kind: 'pass', ...PASS_PLAYS.find((p) => p.id === 'curlflat') };
const res = [];
let brk = 0, dives = 0, tk = 0, dtk = 0;
for (let i = 0; i < 300; i++) {
  const sim = new PlaySim({ kind: 'scrimmage', offTeam: lg.teams[i % 8], defTeam: lg.teams[(i + 3) % 8], offCall: { formation: 'gun_doubles', flip: false, play },
    defCall: { front: 'nickel', cov: 'C3', blitz: [] }, los: 30, ballY: 26.67, rng, skipLineup: true, ctx: {} });
  const wr = sim.bySlotO.X, s = sim.bySlotD.FS;
  sim.agents = [wr, s]; sim.off = [wr]; sim.def = [s];
  wr.x = 40; wr.y = 26.67; wr.vx = 7; wr.vy = 0; wr.face = 0;
  s.x = 40 + depth; s.y = 26.67 + lat; s.vx = -2; s.vy = 0; s.face = Math.PI;
  sim.ball.state = 'held'; sim.ball.holder = wr; sim.st.catcher = wr; sim.st.catchX = 40; sim.st.thrown = true; sim.st.passer = wr; sim.st.target = wr;
  sim.startRun(wr, { fromCatch: true });
  while (sim.phase !== 'dead' && sim.t < 12) sim.step(1 / 60);
  res.push(sim.result ? Math.round(sim.result.spotX - 40) : 60);
  brk += sim.notes.filter((n) => n.type === 'broken').length; dives += sim.notes.filter((n) => n.type === 'divemiss').length;
}
res.sort((a, b) => a - b);
const tdish = res.filter((y) => y >= 50).length;
console.log(`depth ${depth} lat ${lat}: median ${res[150]} p75 ${res[225]} p90 ${res[270]} escapes(50+) ${tdish}/300 broken ${brk} divemiss ${dives}`);
