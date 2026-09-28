// Headless harness: simulate many games and print league-wide averages.
// Usage: node tools/headless.mjs [games] [--pbp]
import { generateLeague } from '../js/data/teamgen.js';
import { Game } from '../js/sim/game.js';

const N = parseInt(process.argv[2] || '20', 10);
const PBP = process.argv.includes('--pbp');
const league = generateLeague(777);
const agg = { games: 0, pts: 0, plays: 0, passAtt: 0, passCmp: 0, passYds: 0, rushAtt: 0, rushYds: 0, sacks: 0,
  ints: 0, fum: 0, punts: 0, fga: 0, fgm: 0, tds: 0, firstDowns: 0, thirdAtt: 0, thirdConv: 0, ot: 0, ties: 0, maxPts: 0, top: 0, pen: 0, penYds: 0, inj: 0, injOut: 0 };
const foulTypes = {};
const t0 = Date.now();
for (let g = 0; g < N; g++) {
  const h = league.teams[g % 8], a = league.teams[(g + 3) % 8];
  const game = new Game(h, a, { seed: 1000 + g });
  game.simToEnd();
  const s = game.s;
  agg.games++;
  agg.pts += s.score.home + s.score.away;
  agg.maxPts = Math.max(agg.maxPts, s.score.home, s.score.away);
  if (s.ot) agg.ot++;
  if (s.score.home === s.score.away) agg.ties++;
  for (const k of ['home', 'away']) {
    const T = game.stats.team[k];
    agg.plays += T.plays; agg.passAtt += T.passAtt; agg.passCmp += T.passCmp; agg.passYds += T.passYds;
    agg.rushAtt += T.rushAtt; agg.rushYds += T.rushYds; agg.sacks += T.sacks; agg.firstDowns += T.firstDowns;
    agg.thirdAtt += T.thirdAtt; agg.thirdConv += T.thirdConv; agg.top += T.top; agg.pen += T.penalties; agg.penYds += T.penYds;
  }
  agg.inj += game.injuries.size; agg.injOut += [...game.injuries.values()].filter((i) => i.returnAt === Infinity).length;
  for (const e of game.log) { const m = e.text.match(/PENALTY: ([A-Za-z -]+),/); if (m) foulTypes[m[1]] = (foulTypes[m[1]] || 0) + 1; }
  for (const [, L] of game.stats.players) {
    agg.ints += L.pass.int; agg.fum += L.fum.lost; agg.punts += L.punt.punts; agg.fga += L.kick.fga; agg.fgm += L.kick.fgm;
    agg.tds += L.pass.td + L.rush.td;
  }
  if (PBP && g === 0) for (const e of game.log) console.log(`Q${e.q} ${Math.floor(e.clock/60)}:${String(Math.ceil(e.clock%60)).padStart(2,'0')} ${e.prefix ? e.prefix + ': ' : ''}${e.text}  [${e.score.away}-${e.score.home}]${e.label ? '  {' + e.label + '}' : ''}`);
  if (!PBP) process.stdout.write(`${a.abbr} ${s.score.away} @ ${h.abbr} ${s.score.home}${s.ot ? ' (OT)' : ''} | `);
}
const G = agg.games * 2; // per team-game
const f = (x, d = 1) => x.toFixed(d);
console.log('\n');
console.log(`Sim time: ${((Date.now() - t0) / 1000).toFixed(1)}s for ${N} games`);
console.log(`Points/team-game  ${f(agg.pts / G)}   (NFL ~22)     max ${agg.maxPts}  OT ${agg.ot} ties ${agg.ties}`);
console.log(`Plays/team-game   ${f(agg.plays / G)}   (NFL ~63)`);
console.log(`Pass att/g        ${f(agg.passAtt / G)}   (NFL ~34)  cmp% ${f(100 * agg.passCmp / agg.passAtt)} (NFL ~65)  Y/A ${f(agg.passYds / agg.passAtt)} (NFL ~7.0)`);
console.log(`Rush att/g        ${f(agg.rushAtt / G)}   (NFL ~27)  YPC ${f(agg.rushYds / agg.rushAtt)} (NFL ~4.3)`);
console.log(`Sacks/g           ${f(agg.sacks / G)}   (NFL ~2.3)   INT/g ${f(agg.ints / G, 2)} (NFL ~0.8)  FumLost/g ${f(agg.fum / G, 2)} (NFL ~0.4)`);
console.log(`Punts/g           ${f(agg.punts / G)}   (NFL ~4)     FG ${agg.fgm}/${agg.fga} (${f(100 * agg.fgm / Math.max(1, agg.fga))}%)  TD/g ${f(agg.tds / G)}`);
console.log(`1st downs/g       ${f(agg.firstDowns / G)}  (NFL ~20)   3rd% ${f(100 * agg.thirdConv / Math.max(1, agg.thirdAtt))} (NFL ~39)  TOP/g ${f(agg.top / G / 60)} min`);
console.log(`Penalties/g       ${f(agg.pen / G)}-${f(agg.penYds / G)} yds (NFL ~6-50)   injuries/g ${f(agg.inj / G, 2)} (out for game ${f(agg.injOut / G, 2)})`);
console.log('Accepted by type (per team-game):', Object.entries(foulTypes).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k} ${(v / G).toFixed(2)}`).join(', '));
