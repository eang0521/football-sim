// End-of-half / end-of-game clock management diagnostics.
// Usage: node tools/clockdiag.mjs [games] [--league nfl/nfl-league.json]
import fs from 'node:fs';
import { generateLeague } from '../js/data/teamgen.js';
import { Game } from '../js/sim/game.js';
import { fgProbability } from '../js/sim/special.js';
import { effectiveKickDist } from '../js/sim/weather.js';

const N = parseInt(process.argv[2] || '200', 10);
const LG = process.argv.indexOf('--league');
const league = LG > 0 ? JSON.parse(fs.readFileSync(process.argv[LG + 1], 'utf8')) : generateLeague(777);
const NT = league.teams.length;
const other = (k) => (k === 'home' ? 'away' : 'home');
const fgProb = (game, k) => Math.max(0, fgProbability(game.kicker(k), effectiveKickDist(game.weather, 117 - game.s.ballOn, game.dirOf(k))) - game.weather.fgPen);
const DEBUG = process.argv.includes('--debug');
const c = {
  halves: 0, kneels: 0, kneel4thTO: 0, spikes: 0, spikeLate: 0, gaveUp: 0, timeouts: 0,
  rangeExpired: 0, lastSecFG: 0, lastSecFGgood: 0, closeLossTOs: 0, closeLosses: 0, endHalfTDs: 0, endHalfFGs: 0,
  defTOs: 0, offTOs: 0, q2DefTOs: 0, leadBlown2Min: 0, lead2Min: 0,
};
for (let g = 0; g < N; g++) {
  const game = new Game(league.teams[g % NT], league.teams[(g + 3) % NT], { seed: 5000 + g });
  const s = game.s;
  let lead2 = null;
  while (!s.final) {
    const sim = game.nextSim({ skipLineup: true });
    if (!sim) break;
    const pre = { q: s.quarter, clock: s.clock, poss: s.poss, down: s.down, ballOn: s.ballOn, score: { ...s.score }, phase: s.phase, to: { ...s.timeouts } };
    const t = sim.meta.type, off = sim.meta.off;
    if ((pre.q === 4) && pre.clock <= 120 && lead2 == null && s.score.home !== s.score.away) lead2 = s.score.home > s.score.away ? 'home' : 'away';
    const pFG = t === 'scrimmage' || t === 'kneel' ? fgProb(game, off) : 0;
    sim.runToEnd();
    const nLog = game.log.length;
    game.applyResult(sim);
    for (const e of game.log.slice(nLog)) {
      if (e.type !== 'timeout') continue;
      c.timeouts++;
      const who = e.text.includes(game.teams[pre.poss].abbr + ' (') ? 'off' : 'def';
      if (who === 'off') c.offTOs++; else { c.defTOs++; if (pre.q === 2) c.q2DefTOs++; }
    }
    if (t === 'kneel') {
      const label = sim.meta.label;
      if (label === 'Spike') { c.spikes++; if (pre.down >= 3) c.spikeLate++; }
      else if (label !== 'Intentional Safety') { c.kneels++; if (pre.down === 4 && s.poss !== off && s.clock > 0) { c.kneel4thTO++; if (DEBUG) console.log('4th-down kneel', g, pre); } }
    }
    if (sim.result?.desc?.includes('goes down in bounds')) c.gaveUp++;
    const diff = pre.score[off] - pre.score[other(off)];
    const fgMatters = pre.q === 2 || (pre.q === 4 && diff <= 0 && diff >= -3);
    // the half ran out on a team sitting in makeable range that never got the kick off
    if ((pre.q === 2 || pre.q === 4) && s.clock <= 0 && t === 'scrimmage' && fgMatters && pFG >= 0.6 && s.poss === off && s.phase === 'scrimmage') c.rangeExpired++;
    if ((pre.q === 2 || pre.q === 4) && t === 'fg' && pre.clock <= 10 && fgMatters) { c.lastSecFG++; if (s.score[off] > pre.score[off]) c.lastSecFGgood++; }
    if (pre.q === 2 && pre.clock <= 120 && s.score[off] - pre.score[off] >= 6 && pre.phase === 'scrimmage') c.endHalfTDs++;
    if (pre.q === 2 && pre.clock <= 120 && t === 'fg' && s.score[off] - pre.score[off] === 3) c.endHalfFGs++;
    if (pre.q === 2 && s.quarter === 3) c.halves++;
  }
  const loser = s.score.home < s.score.away ? 'home' : s.score.away < s.score.home ? 'away' : null;
  if (loser && Math.abs(s.score.home - s.score.away) <= 8 && !s.ot) { c.closeLosses++; c.closeLossTOs += s.timeouts[loser]; }
  if (lead2) { c.lead2Min++; if (s.score[lead2] <= s.score[other(lead2)]) c.leadBlown2Min++; }
}
const per = (x) => (x / N).toFixed(2);
console.log(`${N} games`);
console.log(`Kneels/g ${per(c.kneels)}  kneels on 4th that gave the ball away: ${c.kneel4thTO}`);
console.log(`Spikes/g ${per(c.spikes)}  on 3rd/4th down: ${c.spikeLate}   runners giving themselves up: ${c.gaveUp}`);
console.log(`Timeouts/g ${per(c.timeouts)}  (offense ${per(c.offTOs)}, defense ${per(c.defTOs)}, defense before half ${per(c.q2DefTOs)})`);
console.log(`Halves/regulation ending with a team in range (pFG>=60%) and no kick: ${c.rangeExpired}`);
console.log(`Last-second (<=0:10) kicks that tie/win/end the half: ${c.lastSecFG} (${c.lastSecFGgood} good)`);
console.log(`Final-2:00 points before half: TD ${per(c.endHalfTDs)}/g, FG ${per(c.endHalfFGs)}/g`);
console.log(`Close losses (<=8, no OT): ${c.closeLosses}, avg timeouts left unused by loser ${(c.closeLossTOs / Math.max(1, c.closeLosses)).toFixed(2)}`);
console.log(`Teams leading at the 2:00 warning in Q4 that failed to win: ${c.leadBlown2Min}/${c.lead2Min} (NFL ~8%)`);
