import { FieldRenderer } from './render/scene.js';
import { Game } from './sim/game.js';
import { loadLeague, saveLeague } from './data/storage.js';
import { teamRatings } from './data/teamgen.js';
import { Hud, renderBoxScore, readable, shade } from './ui/hud.js';
import { TeamEditor } from './ui/editor.js';
import { SeasonUI } from './ui/seasonui.js';
import { DraftUI } from './ui/draftui.js';
import { DT } from './sim/constants.js';
import { ReplaySim } from './sim/replay.js';
import { PlayMode } from './ui/playmode.js';

const $ = (id) => document.getElementById(id);
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

let league = loadLeague();
saveLeague(league);

const renderer = new FieldRenderer($('view'));
const hud = new Hud();
const playMode = new PlayMode({ renderer, panel: $('playcall'), hint: $('play-hint') });
const editor = new TeamEditor($('teams-body'), () => league, (lg) => { league = lg; }, () => fillTeamSelects());

const S = {
  game: null, sim: null, paused: false, speed: 1, acc: 0, bulk: false, auto: true,
  waiting: false, clockFrom: null, lastShown: null, lastQ: 1, overShown: false,
};

// ---------------- Game flow ----------------
function startGame(home, away, opts, user = null) {
  S.onFinal = null; // exhibition game: nothing to report back
  attachGame(new Game(home, away, opts), user);
}

// user: 'home' | 'away' to call the plays and control a player for that team
function attachGame(game, user = null) {
  const home = game.teams.home, away = game.teams.away;
  S.game = game;
  game.recording = true; // keep frames for instant replay and highlights
  S.replay = null;
  S.sim = null; S.acc = 0; S.waiting = false; S.overShown = false;
  S.lastShown = S.game.s.clock; S.lastQ = 1;
  renderer.setTeams(home, away);
  renderer.setWeather(S.game.weather);
  hud.reset(S.game);
  hud.showWP(S.game);
  setPaused(false);
  S.calling = false;
  if (user) {
    playMode.start(game, user);
    if (renderer.camMode === 'broadcast') setCam('endzone');
  } else playMode.stop();
  window.__game = S.game; // handy for debugging in the console
}

function beginNextPlay() {
  const g = S.game;
  if (S.calling) return null;
  let opts = {};
  if (playMode.active && !S.call) {
    // the user's team is on the field: wait for the play call
    const asked = playMode.callNext();
    if (asked) {
      S.calling = true;
      asked.then((choice) => { S.calling = false; S.call = { user: choice }; });
      return null;
    }
  }
  if (S.call) { opts = S.call; S.call = null; }
  const sim = g.nextSim(opts);
  if (!sim) { onGameOver(); return null; }
  S.sim = sim;
  playMode.attach(sim);
  S.clockFrom = g.s.quarter === S.lastQ ? S.lastShown : null;
  S.lastQ = g.s.quarter;
  renderer.updateOverlays(sim, g);
  renderer.buildArt(sim);
  hud.showCall(sim);
  hud.update(displayClock());
  hud.syncLog();
  return sim;
}

function finishPlay(sim) {
  S.game.applyResult(sim);
  sim.applied = true;
  S.lastShown = liveClock(sim);
  hud.showResult(sim);
  hud.showWP(S.game);
  hud.update(S.lastShown);
  hud.syncLog();
}

function liveClock(sim) {
  const pre = sim.meta.pre.clock;
  const ticking = sim.meta.type === 'scrimmage' || sim.meta.type === 'punt' || sim.meta.type === 'fg' || sim.meta.type === 'kneel' ||
    (sim.meta.type === 'kickoff' && sim.st.kickLive);
  const t = sim.phase === 'dead' ? sim.wt ?? sim.t : sim.t;
  return ticking ? Math.max(0, pre - t) : pre;
}

function displayClock() {
  const sim = S.sim;
  if (!sim) return S.lastShown;
  if (sim.phase === 'lineup' || sim.phase === 'set') {
    const to = sim.meta.pre.clock;
    if (S.clockFrom == null || S.clockFrom < to) return to;
    const k = sim.phase === 'set' ? 1 : Math.min(1, sim.phaseT / 3);
    return S.clockFrom + (to - S.clockFrom) * k;
  }
  return liveClock(sim);
}

function tickSim() {
  if (!S.game || S.game.s.final && !S.sim) return;
  if (S.calling) return;
  if (!S.sim) { if (!beginNextPlay()) return; }
  const sim = S.sim;
  if (S.waiting) return;
  sim.step(DT);
  if (sim.phase === 'dead' && !sim.applied) finishPlay(sim);
  if (sim.done) {
    if (S.auto) { S.sim = null; hud.hideBanner(); }
    else S.waiting = true;
  }
}

function nextPlay() {
  if (!S.game || S.bulk) return;
  if (S.calling) return;
  if (S.sim && !S.sim.applied) {
    // fast-forward the current play (the AI takes over the user's player)
    playMode.release(S.sim);
    S.sim.runToEnd();
    finishPlay(S.sim);
    S.sim.deadT = 1.2; // brief pause to show the result
    return;
  }
  S.waiting = false;
  S.sim = null;
  hud.hideBanner();
  beginNextPlay();
}

// mode: 'quarter' (end of this quarter), 'late' (5:00 left in the 4th), or 'game'
async function bulkSim(mode) {
  const g = S.game;
  if (!g || S.bulk || g.s.final) return;
  const untilQuarterEnd = mode === 'quarter';
  const late = () => mode === 'late' && g.s.quarter >= 4 && g.s.clock <= 300;
  if (late()) { hud.toast('Already inside the last five minutes.'); return; }
  if (S.calling) { playMode.hidePanel(); S.calling = false; S.call = null; } // the coaches take it from here
  if (S.sim && !S.sim.applied) { playMode.release(S.sim); S.sim.runToEnd(); finishPlay(S.sim); }
  S.sim = null; S.waiting = false;
  S.bulk = true;
  setBusy(true);
  const q0 = g.s.quarter;
  hud.hideBanner();
  while (!g.s.final && !(untilQuarterEnd && g.s.quarter !== q0) && !late()) {
    const t0 = performance.now();
    while (performance.now() - t0 < 14 && !g.s.final && !(untilQuarterEnd && g.s.quarter !== q0) && !late()) {
      const sim = g.nextSim({ skipLineup: true });
      if (!sim) break;
      sim.runToEnd();
      g.applyResult(sim);
    }
    hud.update(g.s.clock); hud.syncLog();
    await new Promise((r) => setTimeout(r, 0));
  }
  S.lastShown = g.s.clock; S.lastQ = g.s.quarter; S.clockFrom = null;
  S.bulk = false;
  setBusy(false);
  hud.showWP(g);
  hud.update(); hud.syncLog();
  if (g.s.final) onGameOver();
  else if (mode === 'late') hud.toast(`${Math.floor(g.s.clock / 60)}:${String(Math.floor(g.s.clock % 60)).padStart(2, '0')} left in the 4th — watching the finish live`);
  else hud.toast(`${untilQuarterEnd ? 'Quarter' : 'Game'} simulated — resuming live play`);
}

function onGameOver() {
  if (S.overShown) return;
  S.overShown = true;
  hud.update(); hud.syncLog();
  const g = S.game, s = g.s;
  hud.toast(`FINAL: ${g.teams.away.abbr} ${s.score.away} – ${g.teams.home.abbr} ${s.score.home}`, 5000);
  if (S.onFinal) { const f = S.onFinal; S.onFinal = null; f(); }
  setTimeout(() => openBox(), 1200);
}

function setBusy(b) {
  for (const id of ['btn-next', 'btn-simq', 'btn-sim5', 'btn-simg', 'btn-play']) $(id).disabled = b;
}

function setPaused(p) {
  S.paused = p;
  $('btn-play').innerHTML = p ? '&#9654;' : '&#10074;&#10074;';
}

// ---------------- Render loop ----------------
let last = performance.now();
function frame(now) {
  const dt = Math.min(0.1, (now - last) / 1000);
  last = now;
  if (S.replay) {
    const R = S.replay;
    if (!S.paused) R.cur.step(dt * S.speed);
    renderer.update(R.cur, S.game, dt * (S.paused ? 0 : S.speed), now);
    if (R.cur.done) nextReplay();
    requestAnimationFrame(frame);
    return;
  }
  if (S.game && !S.paused && !S.bulk) {
    if (S.sim?.user) playMode.frame(S.sim, renderer.camera);
    else if (playMode.active) playMode.setHint('');
    S.acc += dt * S.speed;
    let n = 0;
    while (S.acc >= DT && n++ < 40) { tickSim(); S.acc -= DT; }
    if (S.sim && !S.sim.applied) hud.update(displayClock());
  }
  renderer.update(S.bulk ? null : S.sim, S.game, dt * (S.paused ? 0 : S.speed), now);
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
// Debug hooks (console): advance the sim n ticks and render once.
window.__S = S;
window.__playMode = playMode;
window.__advance = (n = 60) => { for (let i = 0; i < n; i++) { if (S.sim?.user) playMode.frame(S.sim, renderer.camera); tickSim(); } renderer.update(S.sim, S.game, 1 / 60, performance.now()); hud.update(displayClock()); return S.sim && { phase: S.sim.phase, t: +S.sim.t.toFixed(2) }; };

// ---------------- Replays ----------------
function playReplays(list, title) {
  if (!list.length) { hud.toast('Nothing to replay yet.'); return; }
  if (S.bulk) return;
  S.replay = { queue: list.slice(), title, resume: { sim: S.sim } };
  document.body.classList.add('replaying');
  nextReplay();
}
function nextReplay() {
  const R = S.replay;
  const rec = R.queue.shift();
  if (!rec) return endReplay();
  R.cur = new ReplaySim(rec);
  renderer.updateOverlays(R.cur, S.game);
  if (renderer.art) renderer.art.visible = false;
  const n = R.total ?? (R.total = R.queue.length + 1);
  const idx = n - R.queue.length;
  const wp = rec.wp0 != null ? ` · home WP ${Math.round(rec.wp0 * 100)}% → ${Math.round(rec.wp1 * 100)}%` : '';
  hud.banner(`${R.title}${n > 1 ? ` ${idx}/${n}` : ''}`, `Q${Math.min(rec.q, 5)} ${rec.prefix ? rec.prefix + ': ' : ''}${rec.desc}${wp}`);
}
function endReplay() {
  S.replay = null;
  document.body.classList.remove('replaying');
  hud.hideBanner();
  if (S.sim) { renderer.updateOverlays(S.sim, S.game); renderer.buildArt(S.sim); }
}
$('btn-replay').addEventListener('click', () => { if (S.replay) return endReplay(); const r = S.game?.replays || []; playReplays(r.slice(-1), 'REPLAY'); });
$('btn-hl').addEventListener('click', () => {
  if (S.replay) return endReplay();
  const H = (S.game?.highlights || []).slice().sort((a, b) => a.q - b.q || b.clock - a.clock); // in game order
  playReplays(H, 'HIGHLIGHTS');
});

// ---------------- Controls ----------------
$('btn-play').addEventListener('click', () => setPaused(!S.paused));
$('speed').addEventListener('change', (e) => { S.speed = +e.target.value; });
$('btn-next').addEventListener('click', nextPlay);
$('btn-simq').addEventListener('click', () => bulkSim('quarter'));
$('btn-sim5').addEventListener('click', () => bulkSim('late'));
$('btn-simg').addEventListener('click', () => bulkSim('game'));
$('tog-art').addEventListener('change', (e) => { renderer.showArt = e.target.checked; if (S.sim) renderer.buildArt(S.sim); });
$('tog-names').addEventListener('change', (e) => { renderer.showNames = e.target.checked; });
$('tog-auto').addEventListener('change', (e) => { S.auto = e.target.checked; if (S.auto && S.waiting) nextPlay(); });
document.querySelectorAll('#cams button').forEach((b) => b.addEventListener('click', () => setCam(b.dataset.cam)));
function setCam(mode) {
  renderer.setCamera(mode);
  document.querySelectorAll('#cams button').forEach((x) => x.classList.toggle('on', x.dataset.cam === mode));
}
window.addEventListener('keydown', (e) => {
  if (e.target.tagName === 'INPUT' || e.target.tagName === 'SELECT' || e.target.tagName === 'TEXTAREA') return;
  if (!document.querySelector('.modal:not(.hidden)') && !S.paused && !S.replay && playMode.keyDown(e, S.sim)) { e.preventDefault(); return; }
  if (!document.querySelector('.modal:not(.hidden)')) {
    if (e.code === 'Space') { e.preventDefault(); setPaused(!S.paused); }
    if (e.key === 'n' || e.key === 'N') { if (S.replay) endReplay(); else nextPlay(); }
    if (e.key === 'r' || e.key === 'R') $('btn-replay').click();
    const cams = ['broadcast', 'high', 'endzone', 'follow', 'sky', 'free'];
    if (e.key >= '1' && e.key <= '6') setCam(cams[+e.key - 1]);
  }
  if (e.key === 'Escape') document.querySelectorAll('.modal').forEach((m) => m.classList.add('hidden'));
});
window.addEventListener('keyup', (e) => playMode.keyUp(e));
window.addEventListener('blur', () => playMode.keys.clear());

// ---------------- Modals ----------------
function openModal(id) { $(id).classList.remove('hidden'); }
function closeModal(id) { $(id).classList.add('hidden'); }
document.querySelectorAll('[data-close]').forEach((b) => b.addEventListener('click', () => closeModal(b.dataset.close)));
document.querySelectorAll('.modal').forEach((m) => m.addEventListener('mousedown', (e) => { if (e.target === m && S.game) m.classList.add('hidden'); }));

function openBox() {
  if (!S.game) return;
  $('box-body').innerHTML = renderBoxScore(S.game);
  openModal('modal-box');
}
$('btn-box').addEventListener('click', openBox);
$('btn-teams').addEventListener('click', () => { editor.render(); openModal('modal-teams'); });
const seasonUI = new SeasonUI($('season-body'), {
  getLeague: () => league,
  toast: (m) => hud.toast(m, 4000),
  watch: (game, onDone, user) => {
    closeModal('modal-season');
    attachGame(game, user);
    S.onFinal = onDone; // record the result when the final whistle blows
    hud.toast(`Season ${seasonUI.season.year}: ${game.teams.away.abbr} @ ${game.teams.home.abbr}`);
  },
});
$('btn-season').addEventListener('click', () => { seasonUI.render(); openModal('modal-season'); });
const draftUI = new DraftUI($('draft-body'), {
  getLeague: () => league,
  toast: (m) => hud.toast(m, 4000),
  // the drafted league becomes the current league, and its season starts right away
  startSeason: (lg) => {
    league = lg;
    if (!saveLeague(league)) hud.toast('Browser storage is full; the drafted league lasts until you reload.', 5000);
    fillTeamSelects();
    seasonUI.startSeasonFor(league);
    closeModal('modal-draft');
    seasonUI.render();
    openModal('modal-season');
  },
});
$('btn-draft').addEventListener('click', () => { draftUI.render(); openModal('modal-draft'); });
$('btn-new').addEventListener('click', () => { fillTeamSelects(); openModal('modal-new'); });
$('ng-cancel').addEventListener('click', () => { if (S.game) closeModal('modal-new'); });

function teamCard(t) {
  const r = teamRatings(t);
  const c = t.coach;
  const pct = (x) => Math.round(x * 100);
  const fg = readable(t.colors.primary);
  return `<div style="background:linear-gradient(135deg, ${t.colors.primary}, ${shade(t.colors.primary, -22)});color:${fg};border-radius:9px;padding:10px 12px">
    <div class="nm">${esc(t.city)} ${esc(t.name)}</div>
    <div class="rt"><span>OVR <b>${r.ovr}</b></span><span>OFF <b>${r.off}</b></span><span>DEF <b>${r.def}</b></span></div>
    <div class="coach">Coach ${esc(c.name)} · ${c.runScheme} runs<br/>Pass ${pct(c.passRate)}% · Aggr ${pct(c.aggression)} · Deep ${pct(c.deepShot)}<br/>Blitz ${pct(c.blitzRate)}% · Man ${pct(c.manRate)}% · 2-high ${pct(c.twoHigh)}%</div>
  </div>`;
}

function fillTeamSelects() {
  const opts = league.teams.map((t, i) => `<option value="${i}">${esc(t.city)} ${esc(t.name)}</option>`).join('');
  const a = $('ng-away'), h = $('ng-home');
  const va = a.value, vh = h.value;
  a.innerHTML = opts; h.innerHTML = opts;
  if (va !== '' && va < league.teams.length) a.value = va; else a.value = String(Math.floor(Math.random() * league.teams.length));
  if (vh !== '' && vh < league.teams.length && vh !== a.value) h.value = vh;
  else { let x; do { x = Math.floor(Math.random() * league.teams.length); } while (String(x) === a.value); h.value = String(x); }
  updateCards();
}
function updateCards() {
  $('ng-away-card').innerHTML = teamCard(league.teams[+$('ng-away').value]);
  $('ng-home-card').innerHTML = teamCard(league.teams[+$('ng-home').value]);
  const u = $('ng-user'), v = u.value;
  u.options[1].textContent = `${league.teams[+$('ng-away').value].name} (away)`;
  u.options[2].textContent = `${league.teams[+$('ng-home').value].name} (home)`;
  u.value = v;
}
$('ng-away').addEventListener('change', updateCards);
$('ng-home').addEventListener('change', updateCards);
$('ng-start').addEventListener('click', () => {
  const ai = +$('ng-away').value, hi = +$('ng-home').value;
  if (ai === hi) { alert('Pick two different teams.'); return; }
  const seedV = $('ng-seed').value;
  closeModal('modal-new');
  startGame(league.teams[hi], league.teams[ai], {
    quarterLen: +$('ng-qlen').value,
    weather: $('ng-weather').value,
    seed: seedV === '' ? undefined : +seedV,
    // imported leagues: players currently out (IR, out, doubtful, suspended) sit this one out
    out: new Set([league.teams[hi], league.teams[ai]].flatMap((t) => t.roster.filter((p) => ['IR', 'Out', 'Doubtful', 'Suspended'].includes(p.injury?.status)).map((p) => p.id))),
  }, $('ng-user').value || null);
});

if (window.innerWidth < 1100) $('pbp').classList.add('collapsed');

// Initial state: draw a field and prompt for a matchup
renderer.setTeams(league.teams[0], league.teams[1]);
fillTeamSelects();
openModal('modal-new');
