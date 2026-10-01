// Fantasy draft screen: pick a franchise and a draft slot, run a snake draft against AI GMs,
// then start a season with the rosters everyone drafted.
import {
  createDraft, advance, makePick, aiChoice, teamOnClock, isDone, totalPicks, roundOf, rosterOf, counts,
  allowedPositions, finishDraft, loadDraft, saveDraft, clearDraft, playerValue, boardRanking, MINIMUM, CAP,
} from '../season/draft.js';
import { POSITIONS, depthChart, teamRatings } from '../data/teamgen.js';

const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const KEY_RATINGS = {
  QB: ['thp', 'tha', 'awr'], RB: ['spd', 'agi', 'btk'], FB: ['rbk', 'str', 'btk'], WR: ['spd', 'cth', 'rte'], TE: ['cth', 'rte', 'rbk'],
  OL: ['pbk', 'rbk', 'str'], DE: ['prs', 'rds', 'spd'], DT: ['rds', 'prs', 'str'], LB: ['tak', 'rds', 'zcv'], CB: ['mcv', 'zcv', 'spd'],
  S: ['zcv', 'tak', 'spd'], K: ['kpw', 'kac'], P: ['kpw', 'kac'],
};

export class DraftUI {
  constructor(root, deps) {
    this.root = root;
    this.deps = deps; // { getLeague, startSeason(league), toast(msg) }
    this.draft = loadDraft();
    this.posF = 'ALL';
    this.q = '';
    this.busy = false;
  }

  team(id) { return (this.draft?.teams || this.deps.getLeague().teams).find((t) => t.id === id); }
  chip(id) {
    const t = this.team(id);
    const mine = this.draft && id === this.draft.userTeam;
    return t ? `<i class="swatch" style="background:${t.colors.primary}"></i> ${mine ? '<b>' : ''}${esc(t.abbr)}${mine ? '</b>' : ''}` : esc(id);
  }

  render() {
    if (!this.draft) return this.renderSetup();
    if (isDone(this.draft)) return this.renderDone();
    return this.renderBoard();
  }

  // ---------- setup ----------
  renderSetup() {
    const lg = this.deps.getLeague();
    const n = lg.teams.length;
    const players = lg.teams.reduce((s, t) => s + t.roster.length, 0);
    const nfl = lg.source === 'nfl' || lg.source === 'fantasy';
    this.root.innerHTML = `
      <p style="color:var(--muted);margin-top:0">Every player in the league goes into one pool, and all ${n} teams rebuild their rosters in a
        <b>snake draft</b> to fill a ${Math.min(53, Math.floor(players / n))}-man gameday roster. You run one franchise; the other ${n - 1} teams are drafted by AI general managers
        who draft for need, positional value and best available. After the draft you play a ${n === 32 ? '17-game season and the playoffs' : 'full season and the playoffs'}.</p>
      <p style="font-size:12.5px;margin:-4px 0 12px;color:${nfl ? 'var(--accent)' : 'var(--muted)'}">Player pool: ${esc(lg.label || 'your current league')} · ${players} players
        ${nfl ? '' : '<br>To draft real NFL players, load the NFL league first (Teams → Load NFL league).'}</p>
      <div class="dr-setup">
        <label>Your franchise<select id="dr-team">${lg.teams.map((t) => `<option value="${esc(t.id)}">${esc(t.city)} ${esc(t.name)}</option>`).join('')}</select></label>
        <label>Draft position<select id="dr-slot"><option value="0">Random</option>${lg.teams.map((_, i) => `<option value="${i + 1}">${i + 1}${i === 0 ? ' (first pick)' : i === n - 1 ? ' (last pick)' : ''}</option>`).join('')}</select></label>
      </div>
      <div class="actions" style="justify-content:flex-start"><button class="primary" id="dr-start">Start draft</button></div>`;
    this.root.querySelector('#dr-start').onclick = () => {
      const team = this.root.querySelector('#dr-team').value;
      let slot = +this.root.querySelector('#dr-slot').value;
      if (!slot) slot = 1 + Math.floor(Math.random() * n);
      this.draft = createDraft(lg, team, slot);
      advance(this.draft);
      this.save();
      this.render();
    };
  }

  save() { if (!saveDraft(this.draft)) this.deps.toast('Could not save the draft in this browser (storage full); it will still work until you reload.'); }

  // ---------- the draft board ----------
  renderBoard() {
    const d = this.draft;
    const onClock = teamOnClock(d);
    const mine = onClock === d.userTeam;
    const pick = d.picks.length + 1;
    const n = d.order.length;
    let nextMine = null;
    for (let i = d.picks.length; i < totalPicks(d); i++) if (teamOnClock(d, i) === d.userTeam) { nextMine = i + 1; break; }
    const ok = allowedPositions(d, d.userTeam);
    const q = this.q.trim().toLowerCase();
    // the board: value over replacement, adjusted for positional value and how scarce each position is
    const B = boardRanking(d);
    const rows = B.rows
      .filter(({ p }) => (this.posF === 'ALL' || p.pos === this.posF) && (!q || `${p.first} ${p.last}`.toLowerCase().includes(q)));
    if (this.sortBy === 'rating') rows.sort((a, b) => playerValue(b.p) - playerValue(a.p));
    const shown = rows.slice(0, 120);
    const needLine = POSITIONS.filter((p) => B.needs[p].starters > 0)
      .map((p) => `<span title="replacement level ${Math.round(B.repl[p])}">${p} ${B.needs[p].starters}</span>`).join('');
    const c = counts(d, d.userTeam);
    const mineRoster = rosterOf(d, d.userTeam);
    const recent = d.picks.slice(-12).reverse();
    this.root.innerHTML = `
      <div class="dr-head">
        <div><div class="se-title">Round ${roundOf(d)} of ${d.rounds} · Pick ${pick} of ${totalPicks(d)}</div>
          <div class="dr-clock ${mine ? 'mine' : ''}">${mine ? `You're on the clock (${this.chip(onClock)})` : `On the clock: ${this.chip(onClock)}`}${!mine && nextMine ? ` · your next pick: #${nextMine}` : ''}</div></div>
        <div class="actions" style="margin:0">
          <button id="dr-auto" ${mine ? '' : 'disabled'} title="Let the AI make this pick for you">Auto-pick</button>
          <button id="dr-rest" title="The AI drafts the rest of your picks">Auto-draft the rest</button>
          <button id="dr-quit" style="color:var(--bad)">Abandon draft</button>
        </div>
      </div>
      <div id="dr-status" class="se-status">${this.busy ? esc(this.busy) : ''}</div>
      <div class="dr-layout">
        <div>
          <div class="st-bar">
            <div class="pos-filter">${['ALL', ...POSITIONS].map((p) => `<button data-pos="${p}" class="${this.posF === p ? 'on' : ''}">${p}</button>`).join('')}</div>
            <input id="dr-q" placeholder="Search players" value="${esc(this.q)}" />
            <select id="dr-sort" title="How to order the board">
              <option value="board" ${this.sortBy !== 'rating' ? 'selected' : ''}>Board rank (value + scarcity)</option>
              <option value="rating" ${this.sortBy === 'rating' ? 'selected' : ''}>Rating</option>
            </select>
          </div>
          ${needLine ? `<div class="dr-needs league" title="Starting jobs still open across the league; hover for each position's replacement level">Starters still needed league-wide: ${needLine}</div>` : ''}
          <div class="st-scroll"><table class="stats st-table st-players dr-table"><tr><th title="Board rank: value over replacement, weighted by position">Rank</th><th>Player</th><th>Pos</th><th>From</th><th>Age</th><th>Rating</th><th title="Rating above the replacement-level player at this position (the one who would fill the last open starting job)">VOR</th><th>Key ratings</th><th></th></tr>
          ${shown.map(({ p, rank, vor }) => `<tr${ok.has(p.pos) ? '' : ' class="full"'}><td>${rank}</td><td>${esc(p.first)} ${esc(p.last)}${p.traits?.length ? ` <span class="pos" title="${esc(p.traits.join(', '))}">★</span>` : ''}</td><td>${p.pos}</td><td>${this.chip(p.fromTeam)}</td><td>${p.age ?? ''}</td><td><b>${Math.round(playerValue(p))}</b></td>
            <td class="${vor > 0 ? 'vor-pos' : 'vor-neg'}">${vor > 0 ? '+' : ''}${Math.round(vor)}</td>
            <td style="color:var(--muted)">${(KEY_RATINGS[p.pos] || []).map((k) => `${k.toUpperCase()} ${p.ratings[k]}`).join(' · ')}</td>
            <td><button data-pick="${esc(p.id)}" ${mine && ok.has(p.pos) ? '' : 'disabled'}>Draft</button></td></tr>`).join('')
            || '<tr><td colspan="9" style="color:var(--muted)">No players match.</td></tr>'}</table></div>
        </div>
        <div>
          <h3 class="se-h3">Your roster (${mineRoster.length}/${d.rounds})</h3>
          <div class="dr-needs">${POSITIONS.map((p) => `<span class="${c[p] < MINIMUM[p] ? 'need' : c[p] >= CAP[p] ? 'full' : ''}" title="need ${MINIMUM[p]} to start, max ${CAP[p]}">${p} ${c[p]}/${MINIMUM[p]}</span>`).join('')}</div>
          <table class="stats dr-mine">${mineRoster.slice().sort((a, b) => POSITIONS.indexOf(a.pos) - POSITIONS.indexOf(b.pos) || playerValue(b) - playerValue(a))
            .map((p) => `<tr><td>${p.pos}</td><td style="text-align:left">${esc(p.first[0])}. ${esc(p.last)}</td><td>${Math.round(playerValue(p))}</td></tr>`).join('') || '<tr><td style="color:var(--muted)">No picks yet.</td></tr>'}</table>
          <h3 class="se-h3">Recent picks</h3>
          <table class="stats dr-recent">${recent.map((pk) => { const p = d.pool[pk.pid]; return `<tr${pk.team === d.userTeam ? ' class="mine"' : ''}><td>${pk.n}</td><td style="text-align:left">${this.chip(pk.team)}</td><td style="text-align:left">${esc(p.first[0])}. ${esc(p.last)} <span class="pos">${p.pos}</span></td><td>${Math.round(playerValue(p))}</td></tr>`; }).join('')
            || '<tr><td style="color:var(--muted)">The draft is about to begin.</td></tr>'}</table>
        </div>
      </div>`;
    const R = this.root;
    R.querySelectorAll('[data-pos]').forEach((b) => { b.onclick = () => { this.posF = b.dataset.pos; this.render(); }; });
    const qi = R.querySelector('#dr-q');
    qi.oninput = () => { this.q = qi.value; clearTimeout(this.qT); this.qT = setTimeout(() => { this.render(); const x = this.root.querySelector('#dr-q'); x.focus(); x.setSelectionRange(x.value.length, x.value.length); }, 200); };
    R.querySelectorAll('[data-pick]').forEach((b) => { b.onclick = () => this.pick(b.dataset.pick); });
    R.querySelector('#dr-sort').onchange = (e) => { this.sortBy = e.target.value; this.render(); };
    R.querySelector('#dr-auto').onclick = () => { const p = aiChoice(this.draft, this.draft.userTeam); if (p) this.pick(p.id); };
    R.querySelector('#dr-rest').onclick = () => { if (confirm('Let the AI draft the rest of your picks?')) { this.draft.autoRest = true; this.runAI(); } };
    R.querySelector('#dr-quit').onclick = () => { if (confirm('Abandon this draft? Your picks will be lost.')) { clearDraft(); this.draft = null; this.render(); } };
  }

  pick(pid) {
    if (this.busy) return;
    try { makePick(this.draft, pid); } catch (e) { this.deps.toast(e.message); return; }
    this.runAI();
  }

  // AI picks in small batches so the page stays responsive
  async runAI() {
    const d = this.draft;
    this.busy = 'The other teams are picking...';
    this.render();
    while (!isDone(d) && (teamOnClock(d) !== d.userTeam || d.autoRest)) {
      const t0 = performance.now();
      while (!isDone(d) && (teamOnClock(d) !== d.userTeam || d.autoRest) && performance.now() - t0 < 40) {
        const p = aiChoice(d, teamOnClock(d));
        if (!p) break;
        makePick(d, p.id);
      }
      const st = this.root.querySelector('#dr-status');
      if (st) st.textContent = `Drafting... pick ${d.picks.length} of ${totalPicks(d)}`;
      await new Promise((r) => setTimeout(r, 0));
    }
    this.busy = false;
    this.save();
    this.render();
  }

  // ---------- done ----------
  renderDone() {
    const d = this.draft;
    const lg = finishDraft(d);
    const me = lg.teams.find((t) => t.id === d.userTeam);
    const dc = depthChart(me);
    // power: average rating of each team's starting lineup (the QB counts double)
    const LINEUP = { QB: 2, RB: 1, WR: 3, TE: 1, OL: 5, DE: 2, DT: 2, LB: 3, CB: 3, S: 2 };
    const power = (t) => {
      const c = depthChart(t);
      let s = 0, n = 0;
      for (const [pos, k] of Object.entries(LINEUP)) {
        const list = pos === 'QB' ? [c.QB[0], c.QB[0]] : (c[pos] || []).slice(0, k);
        for (const p of list) if (p) { s += playerValue(p); n++; }
      }
      return Math.round(s / Math.max(1, n) * 10) / 10;
    };
    const ranked = lg.teams.map((t) => ({ id: t.id, pw: power(t) })).sort((a, b) => b.pw - a.pw);
    const rank = ranked.findIndex((r) => r.id === me.id) + 1;
    const r = teamRatings(me);
    const star = (arr, n) => arr.slice(0, n).map((p) => `${esc(p.first[0])}. ${esc(p.last)} (${Math.round(playerValue(p))})`).join(', ');
    const firsts = d.picks.filter((pk) => pk.team === d.userTeam).slice(0, 5).map((pk) => { const p = d.pool[pk.pid]; return `#${pk.n} ${esc(p.first)} ${esc(p.last)} (${p.pos})`; });
    this.root.innerHTML = `
      <div class="se-title">Draft complete: the ${esc(me.city)} ${esc(me.name)}</div>
      <p style="color:var(--muted)">Starting lineup rating <b style="color:var(--accent)">${ranked[rank - 1].pw}</b> (team OVR ${r.ovr}: OFF ${r.off} · DEF ${r.def}), ranked ${rank}${[11, 12, 13].includes(rank) ? 'th' : ['st', 'nd', 'rd'][(rank % 10) - 1] || 'th'} of ${lg.teams.length}. First picks: ${firsts.join(' · ')}</p>
      <table class="stats dr-lineup">
        ${[['QB', 1], ['RB', 1], ['WR', 3], ['TE', 1], ['OL', 5], ['DE', 2], ['DT', 2], ['LB', 3], ['CB', 3], ['S', 2], ['K', 1], ['P', 1]]
          .map(([p, n]) => `<tr><td>${p}</td><td style="text-align:left">${star(dc[p] || [], n)}</td></tr>`).join('')}
      </table>
      <h3 class="se-h3">League power ranking</h3>
      <div class="dr-rank">${ranked.map((x, i) => `<span${x.id === me.id ? ' class="mine"' : ''}>${i + 1}. ${this.chip(x.id)} ${x.pw}</span>`).join('')}</div>
      <div class="actions" style="justify-content:flex-start">
        <button class="primary" id="dr-go">Start the season</button>
        <button id="dr-again">Draft again</button>
      </div>
      <p style="color:var(--muted);font-size:12px">Starting the season replaces the current league with the drafted one (load the NFL league again from Teams any time). Seasons for each league are saved separately.</p>`;
    this.root.querySelector('#dr-go').onclick = () => { clearDraft(); this.draft = null; this.deps.startSeason(lg); };
    this.root.querySelector('#dr-again').onclick = () => { if (confirm('Throw out this draft and start over?')) { clearDraft(); this.draft = null; this.render(); } };
  }
}
