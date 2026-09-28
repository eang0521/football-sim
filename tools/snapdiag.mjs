// Snap shares by position (rotation check) and trait coverage.
import { generateLeague } from '../js/data/teamgen.js';
import { Game } from '../js/sim/game.js';
const lg = generateLeague(777);
const share = {}; let tr = 0, n = 0;
for (const t of lg.teams) for (const p of t.roster) { n++; if (p.traits.length) tr++; }
for (let g = 0; g < 6; g++) {
  const game = new Game(lg.teams[g], lg.teams[g + 1], { seed: 70 + g }); game.simToEnd();
  const offPlays = game.stats.team.home.plays + game.stats.team.away.plays;
  for (const k of ['home', 'away']) {
    const team = game.teams[k];
    const byPos = {};
    for (const p of team.roster) (byPos[p.pos] ||= []).push(p);
    for (const pos of ['QB', 'RB', 'WR', 'TE', 'OL', 'DE', 'DT', 'LB', 'CB', 'S']) {
      const arr = byPos[pos].sort((a, b) => b.ovr - a.ovr).map((p) => game.snaps.get(p.id) || 0);
      const tot = offPlays; // both sides' scrimmage plays
      (share[pos] ||= []).push(arr.slice(0, 4).map((x) => x / (tot / 2)));
    }
  }
}
console.log(`players with traits: ${tr}/${n}`);
for (const [pos, rows] of Object.entries(share)) {
  const avg = rows[0].map((_, i) => rows.reduce((s, r) => s + (r[i] || 0), 0) / rows.length);
  console.log(pos.padEnd(3), avg.map((x) => (x * 100).toFixed(0).padStart(4) + '%').join(''));
}
