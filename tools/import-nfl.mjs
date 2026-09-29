// Build a private NFL league file from public sources:
//   - Madden NFL ratings (ea.com ratings pages): rosters, positions, jerseys, size, ratings
//   - ESPN APIs: team names/colors, head coaches, last season's player and team stats,
//     current rosters and injuries, depth charts (incl. returners) and this season's schedule/results
// Usage: node tools/import-nfl.mjs [--stats-season 2025] [--refresh]
// Live data (ratings, rosters, injuries, depth charts, schedule) is cached per day, so running this
// again on a later day picks up the latest; --refresh re-downloads everything.
// Output: private/nfl-league.json (gitignored). Import it from Teams → Import league JSON,
// or use "Load NFL league" when running the site locally. Nothing here is committed or deployed.
import fs from 'node:fs';
import path from 'node:path';
import { computeOvr, RATING_KEYS, generateLeague, depthChart } from '../js/data/teamgen.js';
import { TRAITS } from '../js/data/traits.js';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')), '..');
const OUT_DIR = path.join(ROOT, 'private');
const CACHE = path.join(OUT_DIR, 'cache');
fs.mkdirSync(CACHE, { recursive: true });

const arg = (k, d) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : d; };
const REFRESH = process.argv.includes('--refresh');
const STATS_SEASON = +arg('--stats-season', new Date().getMonth() >= 8 ? new Date().getFullYear() - 1 : new Date().getFullYear() - 1);
const COACH_SEASON = STATS_SEASON + 1;
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126 Safari/537.36';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const TODAY = new Date().toISOString().slice(0, 10);

// Cached, polite fetch: one request at a time with a pause, and results reused between runs.
// live: cache for today only (data that changes week to week).
async function get(url, name, { json = true, pause = 700, live = false } = {}) {
  const file = path.join(CACHE, live ? name.replace(/(\.\w+)$/, `-${TODAY}$1`) : name);
  if (!REFRESH && fs.existsSync(file)) {
    const txt = fs.readFileSync(file, 'utf8');
    return json ? JSON.parse(txt) : txt;
  }
  for (let attempt = 1; ; attempt++) {
    try {
      const res = await fetch(url, { headers: { 'User-Agent': UA, Accept: json ? 'application/json' : 'text/html' } });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const txt = await res.text();
      fs.writeFileSync(file, txt);
      await sleep(pause);
      return json ? JSON.parse(txt) : txt;
    } catch (e) {
      if (attempt >= 3) throw new Error(`${url}: ${e.message}`);
      await sleep(2000 * attempt);
    }
  }
}

// ---------- Madden ratings ----------
async function fetchMadden() {
  const players = [];
  let label = '';
  for (let page = 1; ; page++) {
    const html = await get(`https://www.ea.com/games/madden-nfl/ratings${page > 1 ? `?page=${page}` : ''}`, `madden-${page}.html`, { json: false, pause: 1200, live: true });
    const m = html.match(/<script id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/);
    if (!m) throw new Error(`Madden page ${page}: no data block (page layout changed?)`);
    const data = JSON.parse(m[1]).props?.pageProps?.ratingDetails;
    if (!data?.items?.length) break;
    players.push(...data.items);
    label ||= `${data.items[0].avatarUrl?.match(/madden-nfl-\d+/)?.[0] || 'madden'} ${data.items[0].iteration?.label || ''}`.trim();
    process.stdout.write(`\rMadden ratings: ${players.length}/${data.totalItems}`);
    if (players.length >= data.totalItems) break;
  }
  console.log();
  return { players, label };
}

// ---------- ESPN ----------
async function fetchEspnTeams() {
  const j = await get('https://site.api.espn.com/apis/site/v2/sports/football/nfl/teams', 'espn-teams.json');
  return j.sports[0].leagues[0].teams.map((x) => x.team);
}

async function fetchCoach(teamId) {
  try {
    const list = await get(`https://sports.core.api.espn.com/v2/sports/football/leagues/nfl/seasons/${COACH_SEASON}/teams/${teamId}/coaches`, `espn-coaches-${COACH_SEASON}-${teamId}.json`);
    const ref = list.items?.[0]?.$ref;
    if (!ref) return null;
    const c = await get(ref.replace(/^http:/, 'https:'), `espn-coach-${COACH_SEASON}-${teamId}.json`);
    return `${c.firstName} ${c.lastName}`;
  } catch { return null; }
}

async function fetchTeamStats(teamId) {
  try {
    const j = await get(`https://sports.core.api.espn.com/v2/sports/football/leagues/nfl/seasons/${STATS_SEASON}/types/2/teams/${teamId}/statistics`, `espn-teamstats-${STATS_SEASON}-${teamId}.json`);
    const out = {};
    for (const c of j.splits.categories) for (const s of c.stats) out[`${c.name}.${s.name}`] = s.value;
    return out;
  } catch { return null; }
}

async function fetchPlayerStats() {
  const rows = [];
  let cats = null;
  for (let page = 1; ; page++) {
    const j = await get(`https://site.web.api.espn.com/apis/common/v3/sports/football/nfl/statistics/byathlete?region=us&lang=en&contentorigin=espn&isqualified=false&limit=1000&page=${page}&season=${STATS_SEASON}&seasontype=2&sort=general.gamesPlayed:desc`,
      `espn-stats-${STATS_SEASON}-${page}.json`);
    cats ||= j.categories;
    for (const a of j.athletes) {
      const s = {};
      for (const c of a.categories) {
        const def = cats.find((x) => x.name === c.name);
        if (!def) continue;
        def.names.forEach((n, i) => { s[`${c.name}.${n}`] = c.values[i]; });
      }
      rows.push({ name: a.athlete.displayName, first: a.athlete.firstName, last: a.athlete.lastName, team: a.athlete.teamShortName, pos: a.athlete.position?.abbreviation, s });
    }
    process.stdout.write(`\rESPN ${STATS_SEASON} player stats: ${rows.length}/${j.pagination.count}`);
    if (page >= j.pagination.pages) break;
  }
  console.log();
  return rows;
}

// Current roster: team, jersey, status group and injury designation for every player.
async function fetchRoster(team) {
  const j = await get(`https://site.api.espn.com/apis/site/v2/sports/football/nfl/teams/${team.id}/roster`, `espn-roster-${team.id}.json`, { live: true });
  const out = [];
  for (const g of j.athletes || []) for (const a of g.items || []) {
    out.push({ id: a.id, first: a.firstName, last: a.lastName, jersey: a.jersey != null ? +a.jersey : null, team: team.abbreviation, group: g.position,
      injury: a.injuries?.[0]?.status || null });
  }
  return out;
}

// ESPN depth chart position -> sim position
const DEPTH_POS = { qb: 'QB', rb: 'RB', fb: 'FB', wr: 'WR', te: 'TE', lt: 'OL', lg: 'OL', c: 'OL', rg: 'OL', rt: 'OL',
  lde: 'DE', rde: 'DE', lolb: 'DE', rolb: 'DE', de: 'DE', ldt: 'DT', rdt: 'DT', nt: 'DT', dt: 'DT',
  wlb: 'LB', mlb: 'LB', slb: 'LB', lilb: 'LB', rilb: 'LB', lb: 'LB', lcb: 'CB', rcb: 'CB', nb: 'CB', cb: 'CB', ss: 'S', fs: 'S', pk: 'K', p: 'P' };
async function fetchDepth(team) {
  const ranks = new Map(); // espnId -> { [simPos]: rank, KR, PR }
  try {
    const j = await get(`https://sports.core.api.espn.com/v2/sports/football/leagues/nfl/seasons/${COACH_SEASON}/teams/${team.id}/depthcharts`, `espn-depth-${team.id}.json`, { live: true });
    for (const it of j.items || []) {
      Object.entries(it.positions || {}).forEach(([key, v], order) => {
        for (const a of v.athletes || []) {
          const id = a.athlete?.$ref?.match(/athletes\/(\d+)/)?.[1];
          if (!id) continue;
          const r = ranks.get(id) || {};
          if (key === 'kr' || key === 'pr') r[key.toUpperCase()] = Math.min(r[key.toUpperCase()] ?? 99, a.slot);
          const pos = DEPTH_POS[key];
          if (pos) r[pos] = Math.min(r[pos] ?? 999, (a.slot - 1) * 20 + order);
          ranks.set(id, r);
        }
      });
    }
  } catch { /* no depth chart: Madden order is used */ }
  return ranks;
}

// This season's schedule, with final scores for games already played.
async function fetchSchedule() {
  const weeks = [];
  for (let w = 1; w <= 18; w++) {
    try {
      const j = await get(`https://site.api.espn.com/apis/site/v2/sports/football/nfl/scoreboard?dates=${COACH_SEASON}&seasontype=2&week=${w}`, `espn-sched-${COACH_SEASON}-${w}.json`, { live: true, pause: 400 });
      const games = (j.events || []).map((e) => {
        const c = e.competitions[0];
        const H = c.competitors.find((x) => x.homeAway === 'home'), A = c.competitors.find((x) => x.homeAway === 'away');
        const done = !!e.status?.type?.completed;
        return { home: H.team.abbreviation, away: A.team.abbreviation, date: e.date, final: done,
          ...(done ? { homeScore: +H.score, awayScore: +A.score, ot: (e.status.period ?? 4) > 4 } : {}) };
      });
      if (games.length) weeks.push({ week: w, games });
      process.stdout.write(`\rESPN ${COACH_SEASON} schedule: week ${w}   `);
    } catch { break; }
  }
  console.log();
  return weeks;
}

// ---------- mapping ----------
const POS = { QB: 'QB', HB: 'RB', FB: 'FB', WR: 'WR', TE: 'TE', LT: 'OL', LG: 'OL', C: 'OL', RG: 'OL', RT: 'OL',
  LEDG: 'DE', REDG: 'DE', LE: 'DE', RE: 'DE', DT: 'DT', MIKE: 'LB', WILL: 'LB', SAM: 'LB', LOLB: 'LB', ROLB: 'LB', MLB: 'LB',
  CB: 'CB', FS: 'S', SS: 'S', K: 'K', P: 'P' };
const DEF = new Set(['DE', 'DT', 'LB', 'CB', 'S']);
const clampR = (x) => Math.max(20, Math.min(99, Math.round(x)));

function mapRatings(st, pos) {
  const v = (k) => st[k]?.value ?? 40;
  const avg = (...ks) => ks.reduce((s, k) => s + v(k), 0) / ks.length;
  const r = {
    spd: v('speed'),
    acc: v('acceleration'),
    agi: 0.6 * v('agility') + 0.4 * v('changeOfDirection'),
    str: v('strength'),
    awr: DEF.has(pos) ? 0.5 * v('awareness') + 0.5 * v('playRecognition') : v('awareness'),
    thp: v('throwPower'),
    tha: 0.35 * v('throwAccuracyShort') + 0.35 * v('throwAccuracyMid') + 0.2 * v('throwAccuracyDeep') + 0.1 * v('throwUnderPressure'),
    cth: 0.7 * v('catching') + 0.3 * v('catchInTraffic'),
    rte: avg('shortRouteRunning', 'mediumRouteRunning', 'deepRouteRunning'),
    btk: 0.35 * v('breakTackle') + 0.25 * v('jukeMove') + 0.2 * v('bCVision') + 0.2 * Math.max(v('trucking'), v('stiffArm')),
    car: v('carrying'),
    rbk: v('runBlock'),
    pbk: v('passBlock'),
    prs: 0.6 * Math.max(v('powerMoves'), v('finesseMoves')) + 0.4 * avg('powerMoves', 'finesseMoves'),
    rds: 0.7 * v('blockShedding') + 0.3 * v('playRecognition'),
    tak: 0.7 * v('tackle') + 0.3 * v('pursuit'),
    mcv: 0.8 * v('manCoverage') + 0.2 * v('press'),
    zcv: v('zoneCoverage'),
    kpw: v('kickPower'),
    kac: v('kickAccuracy'),
  };
  for (const k of RATING_KEYS) r[k] = clampR(r[k]);
  return r;
}

// Traits from the underlying Madden ratings: each candidate scores by how far past its bar the player is.
function mapTraits(st, pos) {
  const v = (k) => st[k]?.value ?? 0;
  const c = [];
  const add = (t, score) => { if (score > 0 && TRAITS[t].pos.includes(pos)) c.push([t, score]); };
  if (pos === 'QB') {
    add('scrambler', Math.min(v('speed') - 88, v('throwOnTheRun') - 70)); // true runners, not every mobile QB
    add('pocket_passer', Math.min(v('throwUnderPressure') - 88, 80 - v('speed')));
    add('gunslinger', Math.min(v('throwPower') - 93, v('throwAccuracyDeep') - 86));
    add('game_manager', Math.min(v('throwAccuracyShort') - 88, 90 - v('throwPower')));
  }
  add('workhorse', Math.min(v('stamina') - 90, v('carrying') - 85));
  add('elusive', Math.max(v('jukeMove'), v('changeOfDirection')) - 91);
  add('power_back', v('trucking') - 88);
  add('deep_threat', Math.min(v('speed') - 93, v('deepRouteRunning') - 80));
  add('possession', v('catchInTraffic') - 90);
  add('route_tech', Math.max(v('shortRouteRunning'), v('mediumRouteRunning')) - 91);
  add('road_grader', v('runBlock') - 88);
  add('pass_protector', v('passBlock') - 88);
  add('pass_rusher', Math.max(v('powerMoves'), v('finesseMoves')) - 88);
  add('run_stopper', v('blockShedding') - 88);
  add('ball_hawk', Math.min(v('catching') - 65, v('zoneCoverage') - 85));
  add('shutdown', v('manCoverage') - 90);
  add('hard_hitter', v('hitPower') - 90);
  add('clutch', pos === 'K' ? v('kickAccuracy') - 93 : Math.min(v('awareness') - 93, v('throwUnderPressure') - 85));
  add('iron_man', Math.min(v('injury') - 93, v('stamina') - 92, v('toughness') - 93));
  c.sort((a, b) => b[1] - a[1]);
  const out = [];
  const clash = { scrambler: 'pocket_passer', pocket_passer: 'scrambler', gunslinger: 'game_manager', game_manager: 'gunslinger' };
  for (const [t] of c) { if (out.length < 2 && !out.includes(clash[t])) out.push(t); }
  return out;
}

const norm = (s) => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
  .replace(/\b(jr|sr|ii|iii|iv|v)\b\.?/g, '').replace(/[^a-z]/g, '');

// Keep only the stat groups a player actually recorded.
function realLine(s, season, team) {
  const n = (k) => Math.round((s[k] || 0) * 10) / 10;
  const out = { season, team, gp: n('general.gamesPlayed') };
  if (n('passing.passingAttempts') > 0) out.pass = { cmp: n('passing.completions'), att: n('passing.passingAttempts'), yds: n('passing.passingYards'), td: n('passing.passingTouchdowns'), int: n('passing.interceptions'), rtg: n('passing.QBRating') };
  if (n('rushing.rushingAttempts') > 0) out.rush = { car: n('rushing.rushingAttempts'), yds: n('rushing.rushingYards'), td: n('rushing.rushingTouchdowns') };
  if (n('receiving.receptions') > 0 || n('receiving.receivingTargets') > 0) out.rec = { rec: n('receiving.receptions'), tgt: n('receiving.receivingTargets'), yds: n('receiving.receivingYards'), td: n('receiving.receivingTouchdowns') };
  if (n('defensive.totalTackles') > 0 || n('defensive.sacks') > 0 || n('defensiveinterceptions.interceptions') > 0 || n('defensive.passesDefended') > 0) {
    out.def = { tkl: n('defensive.totalTackles'), sack: n('defensive.sacks'), tfl: n('defensive.tacklesForLoss'), pd: n('defensive.passesDefended'), int: n('defensiveinterceptions.interceptions'), ff: n('general.fumblesForced') };
  }
  if (n('kicking.fieldGoalAttempts') > 0) out.kick = { fgm: n('kicking.fieldGoalsMade'), fga: n('kicking.fieldGoalAttempts'), lng: n('kicking.longFieldGoalMade'), xpm: n('kicking.extraPointsMade'), xpa: n('kicking.extraPointAttempts') };
  if (n('punting.punts') > 0) out.punt = { punts: n('punting.punts'), avg: n('punting.grossAvgPuntYards'), net: n('punting.netAvgPuntYards'), in20: n('punting.puntsInside20') };
  return out;
}

// NFL alignment (ESPN abbreviations).
const DIVS = {
  'AFC East': ['BUF', 'MIA', 'NE', 'NYJ'], 'AFC North': ['BAL', 'CIN', 'CLE', 'PIT'],
  'AFC South': ['HOU', 'IND', 'JAX', 'TEN'], 'AFC West': ['DEN', 'KC', 'LV', 'LAC'],
  'NFC East': ['DAL', 'NYG', 'PHI', 'WSH'], 'NFC North': ['CHI', 'DET', 'GB', 'MIN'],
  'NFC South': ['ATL', 'CAR', 'NO', 'TB'], 'NFC West': ['ARI', 'LAR', 'SF', 'SEA'],
};
const divOf = (abbr) => Object.entries(DIVS).find(([, t]) => t.includes(abbr))?.[0] || null;

const clamp = (x, a, b) => Math.max(a, Math.min(b, x));
const lerp01 = (x, lo, hi) => clamp((x - lo) / (hi - lo), 0, 1);
const r2 = (x) => Math.round(x * 100) / 100;

// Coach tendencies from last season's team stats; things the box score can't tell us stay neutral.
function coachFrom(name, ts, abbr) {
  let h = 0;
  for (const ch of abbr) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  const jitter = (k, lo, hi) => r2(lo + (((h >>> k) & 255) / 255) * (hi - lo)); // stable per team
  const c = {
    name: name || `${abbr} Head Coach`, passRate: 0.56, aggression: 0.5, deepShot: 0.5, playAction: jitter(1, 0.25, 0.45),
    runScheme: ['zone', 'power', 'balanced'][h % 3], tempo: 0.5, blitzRate: jitter(3, 0.2, 0.4), manRate: jitter(5, 0.3, 0.55), twoHigh: jitter(7, 0.35, 0.65),
  };
  if (ts) {
    const pa = ts['passing.passingAttempts'] || 0, ra = ts['rushing.rushingAttempts'] || 0, sk = ts['passing.sacks'] || 0;
    // passRate is the neutral-situation tendency; overall shares run a little higher
    // because of 3rd-and-long and trailing-late passing, which the play-caller adds itself
    if (pa + ra > 0) c.passRate = r2(clamp((pa + sk) / (pa + sk + ra) - 0.02, 0.47, 0.68));
    c.aggression = r2(0.2 + 0.65 * lerp01(ts['miscellaneous.fourthDownAttempts'] || 18, 10, 34));
    if (pa > 0) c.deepShot = r2(0.2 + 0.6 * lerp01((ts['passing.passingBigPlays'] || 0) / pa, 0.06, 0.12));
    const plays = ts['passing.totalOffensivePlays'] || ts['rushing.totalOffensivePlays'];
    if (plays) c.tempo = r2(0.2 + 0.6 * lerp01(plays, 980, 1130));
  }
  return c;
}

// The sim was tuned on its generated leagues. Madden's scale runs higher and unevenly by position
// (defensive speed and tackling especially), so map each rating per position onto the generated
// league's scale: NFL starters get the generated starters' mean and (at most) their spread, since
// the sim is tuned for generated talent ranges and overreacts to stretched extremes. Order is preserved.
const STARTERS = { QB: 1, RB: 1, FB: 1, WR: 3, TE: 1, OL: 5, DE: 2, DT: 2, LB: 3, CB: 3, S: 2, K: 1, P: 1 };
function ratingStats(teams, rank) {
  const acc = {};
  for (const t of teams) {
    for (const pos in STARTERS) {
      // actual starters: the imported depth chart first (as the sim will line them up), then the rank
      const list = t.roster.filter((p) => p.pos === pos).sort((a, b) => (a.depth ?? 1e4) - (b.depth ?? 1e4) || rank(b) - rank(a)).slice(0, STARTERS[pos]);
      for (const p of list) for (const k of RATING_KEYS) ((acc[pos] ||= {})[k] ||= []).push(p.ratings[k]);
    }
  }
  const out = {};
  for (const pos in acc) for (const k in acc[pos]) {
    const a = acc[pos][k], m = a.reduce((s, x) => s + x, 0) / a.length;
    (out[pos] ||= {})[k] = { m, sd: Math.sqrt(a.reduce((s, x) => s + (x - m) ** 2, 0) / a.length) || 1 };
  }
  return out;
}
function calibrate(teams) {
  const durs = teams.flatMap((t) => t.roster.map((p) => p.dur)).sort((a, b) => a - b);
  const med = durs[durs.length >> 1];
  for (const t of teams) for (const p of t.roster) p.dur = clampR(78 + (p.dur - med) * 0.9);
  const ref = ratingStats([1, 2, 3, 4, 5, 6].flatMap((s) => generateLeague(s * 101).teams), (p) => p.ovr);
  const src = ratingStats(teams, (p) => p.madden.ovr);
  for (const t of teams) for (const p of t.roster) {
    for (const k of RATING_KEYS) {
      const a = src[p.pos]?.[k], b = ref[p.pos]?.[k];
      if (!a || !b) continue;
      p.ratings[k] = clampR(b.m + (p.ratings[k] - a.m) * Math.max(0.6, Math.min(0.85, b.sd / a.sd)));
    }
    // Imported traits are earned by these very ratings, so their rating bump would count the skill
    // twice: take it back out and let the trait add only its behavior.
    for (const t of p.traits) for (const [k, v] of Object.entries(TRAITS[t]?.bump || {})) p.ratings[k] = clampR(p.ratings[k] - v);
    p.ovr = computeOvr(p);
    // Madden's OVR is the better judge of who starts; keep its order but let rating edits still move players.
    p.madden.adj = p.madden.ovr - p.ovr;
  }
}

// ---------- build ----------
const { players: mad, label: maddenLabel } = await fetchMadden();
const espnTeams = await fetchEspnTeams();
const stats = await fetchPlayerStats();
const byName = new Map();
for (const r of stats) {
  const k = norm(`${r.first}${r.last}`);
  if (!byName.has(k)) byName.set(k, []);
  byName.get(k).push(r);
}

const teams = [];
let matched = 0, total = 0;
for (const et of espnTeams) {
  const label = et.displayName;
  // Madden abbreviates some cities ("NY Giants"), so match on the nickname.
  const roster = mad.filter((p) => (p.team?.label === label || p.team?.label?.endsWith(` ${et.name}`)) && POS[p.position?.id]);
  if (!roster.length) { console.warn(`No Madden players for ${label}`); continue; }
  process.stdout.write(`\rESPN coaches + team stats: ${et.abbreviation}   `);
  const [coachName, ts] = [await fetchCoach(et.id), await fetchTeamStats(et.id)];
  const used = new Set();
  const out = roster.map((m) => {
    const pos = POS[m.position.id];
    const ratings = mapRatings(m.stats, pos);
    let num = m.jerseyNum ?? 0;
    if (used.has(num)) num = [...Array(100).keys()].find((n) => !used.has(n)) ?? num;
    used.add(num);
    const p = {
      id: `NFL-${m.id}`, first: m.firstName, last: m.lastName, pos, num, height: m.height, weight: m.weight, ratings,
      traits: mapTraits(m.stats, pos), age: m.age, yearsPro: m.yearsPro, college: m.college,
      dur: clampR(0.6 * (m.stats.injury?.value ?? 80) + 0.4 * (m.stats.toughness?.value ?? 80)),
      madden: { ovr: m.overallRating, pos: m.position.id, archetype: m.archetype?.label || null },
    };
    total++;
    const cands = byName.get(norm(`${m.firstName}${m.lastName}`)) || [];
    const hit = cands.length === 1 ? cands[0] : cands.find((r) => r.team === et.abbreviation) || cands.find((r) => POS[r.pos] === pos || r.pos === pos);
    if (hit) { p.real = realLine(hit.s, STATS_SEASON, hit.team); matched++; }
    return p;
  });
  const col = (c, d) => (c ? `#${c}` : d);
  const primary = col(et.color, '#333333'), secondary = col(et.alternateColor, '#ffffff');
  teams.push({
    id: et.abbreviation, city: et.location, name: et.name, abbr: et.abbreviation,
    colors: { primary, secondary, helmet: primary, pants: secondary },
    coach: coachFrom(coachName, ts, et.abbreviation),
    conf: divOf(et.abbreviation)?.slice(0, 3) || null, div: divOf(et.abbreviation),
    roster: out,
  });
}
console.log();

// ---------- live rosters: trades/signings/cuts, injuries, depth charts ----------
const espnPlayers = [];
for (const et of espnTeams) {
  process.stdout.write(`\rESPN rosters + depth charts: ${et.abbreviation}   `);
  const roster = await fetchRoster(et);
  const depth = await fetchDepth(et);
  for (const r of roster) espnPlayers.push({ ...r, depth: depth.get(r.id) });
}
console.log();
const espnByName = new Map();
for (const r of espnPlayers) { const k = norm(`${r.first}${r.last}`); if (!espnByName.has(k)) espnByName.set(k, []); espnByName.get(k).push(r); }
const STATUS = { 'Injured Reserve': 'IR', Out: 'Out', Doubtful: 'Doubtful', Questionable: 'Questionable', Suspension: 'Suspended' };
let moved = 0, dropped = 0, injured = 0, depthRanked = 0;
const byAbbr = new Map(teams.map((t) => [t.abbr, t]));
for (const t of teams) {
  t.roster = t.roster.filter((p) => {
    const cands = espnByName.get(norm(`${p.first}${p.last}`)) || [];
    const e = cands.length === 1 ? cands[0] : cands.find((c) => c.team === t.abbr);
    if (!e) { dropped++; return false; } // not on any NFL roster right now (released / unsigned)
    p.espnId = e.id;
    if (e.jersey != null) p.num = e.jersey;
    let status = STATUS[e.injury] || null;
    if (e.group === 'injuredReserveOrOut' && !status) status = 'IR';
    if (e.group === 'suspended') status = 'Suspended';
    if (status) { p.injury = { status, asOf: TODAY }; injured++; }
    if (e.group === 'practiceSquad') p.ps = true;
    const d = e.depth || {};
    if (d[p.pos] != null) { p.depth = d[p.pos]; depthRanked++; }
    if (d.KR != null || d.PR != null) p.st = { ...(d.KR != null ? { KR: d.KR } : {}), ...(d.PR != null ? { PR: d.PR } : {}) };
    if (e.team !== t.abbr && byAbbr.has(e.team)) { (p._move = e.team); moved++; }
    return true;
  });
}
for (const t of teams) for (const p of t.roster.filter((x) => x._move)) {
  t.roster = t.roster.filter((x) => x !== p);
  const to = byAbbr.get(p._move); delete p._move; to.roster.push(p);
}
console.log(`ESPN rosters: ${moved} players moved to their current team, ${dropped} not on an NFL roster dropped, ${injured} with an injury/status designation, ${depthRanked} ranked on a depth chart`);
const schedule = await fetchSchedule();

calibrate(teams);
teams.sort((a, b) => (a.div || '').localeCompare(b.div || '') || a.abbr.localeCompare(b.abbr));

const league = {
  version: 1, seed: 0, source: 'nfl',
  label: `NFL: ${maddenLabel.replace('madden-nfl-', 'Madden ')}, ${STATS_SEASON} ESPN stats`,
  built: TODAY,
  schedule: schedule.length ? { season: COACH_SEASON, weeks: schedule } : null,
  teams,
};
const file = path.join(OUT_DIR, 'nfl-league.json');
fs.writeFileSync(file, JSON.stringify(league));
const counts = {};
for (const t of teams) for (const p of t.roster) counts[p.pos] = (counts[p.pos] || 0) + 1;
total = teams.reduce((n, t) => n + t.roster.length, 0);
matched = teams.reduce((n, t) => n + t.roster.filter((p) => p.real).length, 0);
console.log(`${teams.length} teams, ${total} players (${matched} matched to ${STATS_SEASON} stats) → ${path.relative(ROOT, file)} (${(fs.statSync(file).size / 1e6).toFixed(1)} MB)`);
console.log('By position:', Object.entries(counts).map(([k, v]) => `${k} ${v}`).join(', '));
console.log(league.label);
if (schedule.length) console.log(`Schedule: ${schedule.length} weeks, ${schedule.flatMap((w) => w.games).filter((g) => g.final).length} games already final`);
