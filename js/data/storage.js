import { generateLeague, computeOvr } from './teamgen.js';

const KEY = 'gridiron-sim-league-v1';

function safeGet() {
  try { return globalThis.localStorage?.getItem(KEY) ?? null; } catch { return null; }
}
function safeSet(v) {
  try { globalThis.localStorage?.setItem(KEY, v); return true; } catch { return false; }
}

export function loadLeague() {
  const raw = safeGet();
  if (raw) {
    try {
      const lg = JSON.parse(raw);
      if (lg && lg.version === 1 && Array.isArray(lg.teams)) {
        lg.teams.forEach((t) => t.roster.forEach((p) => { p.ovr = computeOvr(p); }));
        return lg;
      }
    } catch { /* fall through */ }
  }
  return generateLeague(Math.floor(Math.random() * 1e9));
}

export function saveLeague(league) { return safeSet(JSON.stringify(league)); }

export function resetLeague(seed = Math.floor(Math.random() * 1e9)) {
  const lg = generateLeague(seed);
  saveLeague(lg);
  return lg;
}

export function exportLeagueJSON(league) { return JSON.stringify(league, null, 2); }
export function importLeagueJSON(text) {
  const lg = JSON.parse(text);
  if (!lg || lg.version !== 1 || !Array.isArray(lg.teams) || lg.teams.length < 2) throw new Error('Invalid league file');
  lg.teams.forEach((t) => t.roster.forEach((p) => { p.ovr = computeOvr(p); }));
  return lg;
}
