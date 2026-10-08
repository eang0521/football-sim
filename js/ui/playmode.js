// Playable games: the user calls the plays for one team and controls a player with the keyboard.
//   Offense: the QB drops back on his own; WASD moves him, Y U I O P throw to the receivers
//   (left to right on screen), T throws it away. After a handoff, catch or scramble the user runs
//   with the ball carrier. Defense: Q W E R T Y U I O P [ pick a defender (W only before the snap,
//   when it isn't needed to move), WASD moves him; tackles happen on contact as they do for the AI.
//   Space snaps the ball (or tells the AI offense you're set).
import * as THREE from 'three';
import { FORMATIONS, PASS_PLAYS, RUN_PLAYS, DEF_CALLS, COVERAGES } from '../sim/playbook.js';
import { userThrow, userThrowAway } from '../sim/ai.js';

const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const RECV_KEYS = ['y', 'u', 'i', 'o', 'p'];
const DEF_KEYS = ['q', 'w', 'e', 'r', 't', 'y', 'u', 'i', 'o', 'p', '['];
const MOVE_KEYS = { w: [1, 0], arrowup: [1, 0], s: [-1, 0], arrowdown: [-1, 0], a: [0, -1], arrowleft: [0, -1], d: [0, 1], arrowright: [0, 1] };
const DEPTH_TAG = { short: 'Quick', medium: 'Intermediate', deep: 'Deep', screen: 'Screen', hail: 'Hail Mary' };
const GROUP = { DE: 0, DT: 0, LB: 1, CB: 2, S: 2 };

export class PlayMode {
  // deps: { renderer, panel (element), hint (element), fieldPos(key, ballOn), downStr() }
  constructor(deps) {
    this.deps = deps;
    this.user = null;     // 'home' | 'away' while a playable game is on
    this.keys = new Set();
    this.form = null;     // formation picked in the play-call panel
  }

  get active() { return !!this.user; }
  start(game, user) { this.game = game; this.user = user; this.keys.clear(); this.hidePanel(); this.setHint(''); }
  stop() { this.user = null; this.game = null; this.hidePanel(); this.setHint(''); this.deps.renderer.setUserView(null); }

  // ---------- play calling ----------
  // Ask the game whether the user calls the next snap; if so, open the panel and resolve with the call.
  callNext() {
    const need = this.game.prepareNext(this.user);
    if (!need) return null;
    return new Promise((resolve) => this.showPanel(need, resolve));
  }

  situation(ctx) {
    const g = this.game, s = g.s;
    const m = Math.floor(s.clock / 60), sec = String(Math.floor(s.clock % 60)).padStart(2, '0');
    const me = g.teams[this.user], opp = g.teams[this.user === 'home' ? 'away' : 'home'];
    return `${g.downStr()} at ${esc(g.fieldPos(s.poss, s.ballOn))} · Q${Math.min(s.quarter, 5)} ${m}:${sec} · ${esc(me.abbr)} ${s.score[this.user]}, ${esc(opp.abbr)} ${s.score[this.user === 'home' ? 'away' : 'home']} · ${ctx.timeouts ?? s.timeouts[this.user]} timeouts`;
  }

  showPanel(need, resolve) {
    const P = this.deps.panel;
    const done = (choice) => { this.hidePanel(); resolve(choice); };
    const g = this.game, s = g.s;
    if (need.side === 'D') {
      P.innerHTML = `<div class="pc-head"><b>Defense</b> · ${this.situation(need.ctx)}</div>
        <div class="pc-grid">${DEF_CALLS.map((c) => {
          const cov = COVERAGES[c.cov];
          const desc = `${cov.man ? 'Man' : 'Zone'}, ${cov.shell === 2 ? 'two deep safeties' : cov.shell === 1 ? 'one deep safety' : 'no deep help'}${c.blitz.length ? `, sends ${c.blitz.length === 1 ? 'a blitzer' : `${c.blitz.length} blitzers`}` : ''}`;
          return `<button data-def="${c.id}"><b>${esc(c.name)}</b><small>${desc}</small></button>`;
        }).join('')}</div>
        <div class="pc-foot"><button data-coach>Coach's call</button><span>After the call: pick your defender with Q W E R T Y U I O P [ and press Space when set.</span></div>`;
      P.querySelectorAll('[data-def]').forEach((b) => { b.onclick = () => done({ def: { callId: b.dataset.def } }); });
      P.querySelector('[data-coach]').onclick = () => done({});
    } else {
      const forms = Object.keys(FORMATIONS);
      if (!this.form || !FORMATIONS[this.form]) this.form = s.ballOn >= 97 ? 'goal_line' : 'gun_doubles';
      const nearGoal = s.ballOn >= 80;
      const passes = PASS_PLAYS.filter((p) => p.forms.includes(this.form) && (nearGoal || !p.id.startsWith('gl_')));
      const runs = RUN_PLAYS.filter((r) => r.forms.includes(this.form));
      const fgDist = 117 - Math.round(s.ballOn);
      const pFG = g.fgProb(s.poss);
      const specials = [
        ['punt', 'Punt'],
        fgDist <= 66 ? ['fg', `Field goal (${fgDist} yd, ${Math.round(pFG * 100)}%)`] : null,
        ['kneel', 'Kneel'],
        ['spike', 'Spike'],
      ].filter(Boolean);
      P.innerHTML = `<div class="pc-head"><b>Offense</b> · ${this.situation(need.ctx)}</div>
        <div class="pc-forms">${forms.map((f) => `<button data-form="${f}" class="${f === this.form ? 'on' : ''}">${esc(FORMATIONS[f].name.replace(/ \(\d+\)$/, ''))} <small>${FORMATIONS[f].personnel}</small></button>`).join('')}</div>
        <div class="pc-cols">
          <div><h4>Pass</h4><div class="pc-grid">${passes.map((p) => `<button data-pass="${p.id}"><b>${esc(p.name)}</b><small>${DEPTH_TAG[p.depth] || ''}${p.pa ? ' · play action' : ''}</small></button>`).join('')}</div></div>
          <div><h4>Run</h4><div class="pc-runs">${runs.map((r) => `<div><span>${esc(r.name)}</span><button data-run="${r.id}" data-dir="1" title="Run to the offense's left">◀ Left</button><button data-run="${r.id}" data-dir="-1" title="Run to the offense's right">Right ▶</button></div>`).join('')}</div></div>
        </div>
        <div class="pc-foot">${specials.map(([k, l]) => `<button data-dec="${k}">${l}</button>`).join('')}<button data-coach>Coach's call</button>
          <span>Space snaps. WASD moves · Y U I O P throw (left to right) · T throws it away.</span></div>`;
      P.querySelectorAll('[data-form]').forEach((b) => { b.onclick = () => { this.form = b.dataset.form; this.showPanel(need, resolve); }; });
      P.querySelectorAll('[data-pass]').forEach((b) => { b.onclick = () => done({ off: { formation: this.form, playId: b.dataset.pass } }); });
      P.querySelectorAll('[data-run]').forEach((b) => { b.onclick = () => done({ off: { formation: this.form, playId: b.dataset.run, runDir: +b.dataset.dir } }); });
      P.querySelectorAll('[data-dec]').forEach((b) => { b.onclick = () => done({ off: { decision: b.dataset.dec } }); });
      P.querySelector('[data-coach]').onclick = () => done({});
    }
    P.classList.remove('hidden');
  }

  hidePanel() { this.deps.panel.classList.add('hidden'); }
  setHint(html) {
    if (html === this.hint) return;
    this.hint = html;
    const h = this.deps.hint; h.innerHTML = html; h.classList.toggle('hidden', !html);
  }

  // ---------- control during a play ----------
  // Hook a freshly created play up to the keyboard when the user's team is on the field.
  attach(sim) {
    const m = sim.meta;
    if (!this.user || m.type !== 'scrimmage' || (m.off !== this.user && m.def !== this.user)) return false;
    const side = m.off === this.user ? 'O' : 'D';
    sim.user = { side, agent: null, move: { x: 0, y: 0 }, selected: null };
    sim.holdSnap = true;
    if (side === 'O') sim.noThrow = !sim.isRun; // the user throws
    // key order: left to right on the offense's screen (+y is the offense's left)
    const byLeft = (a, b) => b.ay - a.ay;
    sim.user.recv = sim.off.filter((a) => a.role === 'route').sort(byLeft).slice(0, RECV_KEYS.length);
    sim.user.defs = sim.def.slice().sort((a, b) => (GROUP[a.fpos] ?? 3) - (GROUP[b.fpos] ?? 3) || byLeft(a, b)).slice(0, DEF_KEYS.length);
    if (side === 'D') {
      const D = sim.user.defs;
      sim.user.selected = D.find((a) => a.slot === 'MIKE') || D.find((a) => a.fpos === 'LB') || D.find((a) => a.fpos === 'S') || D[0];
    }
    return true;
  }

  // Let the AI finish a play the user was in (skip / sim).
  release(sim) {
    if (!sim?.user) return;
    sim.user = null; sim.holdSnap = false; sim.noThrow = false;
    this.deps.renderer.setUserView(null);
  }

  // Who the user is steering right now.
  controlled(sim) {
    const U = sim.user;
    if (U.side === 'D') return U.selected;
    const B = sim.ball, h = B.state === 'held' ? B.holder : null;
    if (sim.phase !== 'live') return sim.isRun ? null : sim.qb();
    if (!h || h.side !== 'O') return null;
    if (h.d.runner) return h;
    if (h === sim.qb() && !sim.isRun) return h;
    return null;
  }

  // Per frame: keys -> movement in frame coordinates, plus the marker and key badges on screen.
  frame(sim, camera) {
    const U = sim?.user;
    if (!U || sim.phase === 'dead') { this.deps.renderer.setUserView(null); this.setHint(''); return; }
    U.agent = this.controlled(sim);
    let f = 0, r = 0;
    for (const k of this.keys) { const v = MOVE_KEYS[k]; if (v) { f += v[0]; r += v[1]; } }
    if (f || r) {
      // screen up / right projected onto the field, then into the offense's frame
      const fwd = new THREE.Vector3(); camera.getWorldDirection(fwd);
      const up = new THREE.Vector3(0, 1, 0).applyQuaternion(camera.quaternion);
      let ux = fwd.x + up.x, uz = fwd.z + up.z;
      const n = Math.hypot(ux, uz) || 1; ux /= n; uz /= n;
      const wx = f * ux + r * -uz, wz = f * uz + r * ux;
      const L = Math.hypot(wx, wz) || 1, d = sim.meta.dir > 0 ? 1 : -1;
      U.move = { x: (d * wx) / L, y: (-d * wz) / L };
    } else U.move = { x: 0, y: 0 };
    const badges = new Map();
    if (U.side === 'O' && !sim.isRun && !sim.pass?.thrown) U.recv.forEach((a, i) => badges.set(a.id, RECV_KEYS[i].toUpperCase()));
    if (U.side === 'D') U.defs.forEach((a, i) => badges.set(a.id, DEF_KEYS[i].toUpperCase()));
    this.deps.renderer.setUserView({ agentId: U.agent?.id ?? null, badges });
    const pre = sim.phase === 'lineup' || sim.phase === 'set';
    this.setHint(pre
      ? `<b>Space</b> to ${U.side === 'O' ? 'snap' : 'get set'}${U.side === 'D' ? ' · <b>Q W E R T Y U I O P [</b> pick your defender' : ''}`
      : U.side === 'O'
        ? (U.agent && U.agent === sim.qb() && !U.agent.d.runner && !sim.isRun ? '<b>WASD</b> move · <b>Y U I O P</b> throw · <b>T</b> throw it away' : U.agent ? '<b>WASD</b> run' : '')
        : '<b>WASD</b> move · <b>Q E R T Y U I O P [</b> switch defender');
  }

  // Keyboard: returns true when the key was used for the play.
  keyDown(e, sim) {
    const k = e.key.toLowerCase();
    if (!this.user) return false;
    if (!this.deps.panel.classList.contains('hidden')) return e.code === 'Space'; // calling a play: Space doesn't pause
    if (MOVE_KEYS[k] && sim?.user && !(k === 'w' && sim.user.side === 'D' && sim.phase !== 'live')) { this.keys.add(k); return true; }
    const U = sim?.user;
    if (!U) return false;
    if (e.code === 'Space') {
      if (sim.holdSnap) { sim.holdSnap = false; return true; }
      return false;
    }
    if (U.side === 'O') {
      const i = RECV_KEYS.indexOf(k);
      if (i >= 0) { if (U.recv[i]) userThrow(sim, U.recv[i]); return true; }
      if (k === 't') { userThrowAway(sim); return true; }
    } else {
      const i = DEF_KEYS.indexOf(k);
      if (i >= 0 && U.defs[i]) { U.selected = U.defs[i]; return true; }
    }
    return false;
  }
  keyUp(e) { this.keys.delete(e.key.toLowerCase()); }
}
