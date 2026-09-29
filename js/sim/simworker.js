// Web Worker: simulates whole games off the main thread for season mode.
// Messages in:  { type: 'init', teams }  |  { type: 'game', id, home, away, out, noTie }
// Messages out: { id, res } shaped like the parts of a Game that recordGame() reads, or { id, error }.
import { Game } from './game.js';

let teams = new Map();

self.onmessage = (e) => {
  const m = e.data;
  if (m.type === 'init') { teams = new Map(m.teams.map((t) => [t.id, t])); return; }
  if (m.type !== 'game') return;
  try {
    const game = new Game(teams.get(m.home), teams.get(m.away), { out: new Set(m.out), noTie: m.noTie });
    game.simToEnd();
    const pidTeam = new Map([...game.stats.pidTeam].filter(([pid]) => game.stats.players.has(pid) || game.injuries.has(pid)));
    self.postMessage({ id: m.id, res: {
      s: { score: game.s.score, quarter: game.s.quarter },
      stats: { players: game.stats.players, pidTeam, team: game.stats.team },
      injuries: game.injuries,
      teams: { home: { id: m.home }, away: { id: m.away } },
    } });
  } catch (err) {
    self.postMessage({ id: m.id, error: String(err && err.stack || err) });
  }
};
