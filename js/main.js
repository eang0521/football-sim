import { FieldRenderer } from './render/scene.js';
import { Game } from './sim/game.js';
import { loadLeague, saveLeague } from './data/storage.js';
import { teamRatings } from './data/teamgen.js';
import { Hud, renderBoxScore, readable, shade } from './ui/hud.js';
import { TeamEditor } from './ui/editor.js';
import { SeasonUI } from './ui/seasonui.js';
import { DT } from './sim/constants.js';

const $ = (id) => document.getElementById(id);
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

let league = loadLeague();
saveLeague(league);

const renderer = new FieldRenderer($('view'));
const hud = new Hud();
const editor = new TeamEditor($('teams-body'), () => league, (lg) => { league = lg; }, () => fillTeamSelects());

const S = {
  game: null, sim: null, paused: false, speed: 1, acc: 0, bulk: false, auto: true,
  waiting: false, clockFrom: null, lastShown: null, lastQ: 1, overShown: false,
};

// ---------------- Game flow ----------------
function startGame(home, away, opts) {
  S.onFinal = null; // exhibition game: nothing to report back
  attachGame(new Game(home, away, opts));
}

function attachGame(game) {
  const home = game.teams.home, away = game.teams.away;
  S.game = game;
  S.sim = null; S.acc = 0; S.waiting = false; S.overShown = false;
  S.lastShown = S.game.s.clock; S.lastQ = 1;
  renderer.setTeams(home, away);
  renderer.setWeather(S.game.weather);
  hud.reset(S.game);
  setPaused(false);
  window.__game = S.game; // handy for debugging in the console
}

function beginNextPlay() {
  const g = S.game;
  const sim = g.nextSim();
  if (!sim) { onGameOver(); return null; }
  S.sim = sim;
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
  if (S.sim && !S.sim.applied) {
    // fast-forward the current play
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

async function bulkSim(untilQuarterEnd) {
  const g = S.game;
  if (!g || S.bulk || g.s.final) return;
  if (S.sim && !S.sim.applied) { S.sim.runToEnd(); finishPlay(S.sim); }
  S.sim = null; S.waiting = false;
  S.bulk = true;
  setBusy(true);
  const q0 = g.s.quarter;
  hud.hideBanner();
  while (!g.s.final && !(untilQuarterEnd && g.s.quarter !== q0)) {
    const t0 = performance.now();
    while (performance.now() - t0 < 14 && !g.s.final && !(untilQuarterEnd && g.s.quarter !== q0)) {
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
  hud.update(); hud.syncLog();
  if (g.s.final) onGameOver();
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
  for (const id of ['btn-next', 'btn-simq', 'btn-simg', 'btn-play']) $(id).disabled = b;
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
  if (S.game && !S.paused && !S.bulk) {
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
window.__advance = (n = 60) => { for (let i = 0; i < n; i++) tickSim(); renderer.update(S.sim, S.game, 1 / 60, performance.now()); hud.update(displayClock()); return S.sim && { phase: S.sim.phase, t: +S.sim.t.toFixed(2) }; };

// ---------------- Controls ----------------
$('btn-play').addEventListener('click', () => setPaused(!S.paused));
$('speed').addEventListener('change', (e) => { S.speed = +e.target.value; });
$('btn-next').addEventListener('click', nextPlay);
$('btn-simq').addEventListener('click', () => bulkSim(true));
$('btn-simg').addEventListener('click', () => bulkSim(false));
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
  if (!document.querySelector('.modal:not(.hidden)')) {
    if (e.code === 'Space') { e.preventDefault(); setPaused(!S.paused); }
    if (e.key === 'n' || e.key === 'N') nextPlay();
    const cams = ['broadcast', 'high', 'endzone', 'follow', 'sky', 'free'];
    if (e.key >= '1' && e.key <= '6') setCam(cams[+e.key - 1]);
  }
  if (e.key === 'Escape') document.querySelectorAll('.modal').forEach((m) => m.classList.add('hidden'));
});

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
  watch: (game, onDone) => {
    closeModal('modal-season');
    attachGame(game);
    S.onFinal = onDone; // record the result when the final whistle blows
    hud.toast(`Season ${seasonUI.season.year}: ${game.teams.away.abbr} @ ${game.teams.home.abbr}`);
  },
});
$('btn-season').addEventListener('click', () => { seasonUI.render(); openModal('modal-season'); });
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
  });
});

if (window.innerWidth < 1100) $('pbp').classList.add('collapsed');

// Initial state: draw a field and prompt for a matchup
renderer.setTeams(league.teams[0], league.teams[1]);
fillTeamSelects();
openModal('modal-new');
