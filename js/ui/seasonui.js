// Season screen: standings, weekly slate (watch or sim), leaders, injuries, history.
import {
  createSeason, currentGames, createSeasonGame, recordGame, standings, leaders, developPlayers,
  LEADER_CATS, saveSeason, loadSeason, clearSeason,
} from '../season/season.js';
import { saveLeague } from '../data/storage.js';

const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

export class SeasonUI {
  constructor(root, deps) {
    this.root = root;
    this.deps = deps; // { getLeague, watch(game, onDone), toast(msg) }
    this.season = loadSeason();
    this.tab = 'overview';
    this.leaderSrc = 'season';
    this.busy = false;
    this.devNotes = null;
  }

  team(id) { return this.deps.getLeague().teams.find((t) => t.id === id); }
  chip(id) {
    const t = this.team(id);
    return t ? `<i class="swatch" style="background:${t.colors.primary}"></i> ${esc(t.abbr)}` : esc(id);
  }

  render() {
    const S = this.season;
    if (!S) {
      this.root.innerHTML = `<p style="color:var(--muted)">Play a ${this.deps.getLeague().teams.length}-team season: a 14-week double round-robin, a 4-team playoff and a champion.
        Injuries carry over from week to week, players develop between seasons, and season and career leaders are tracked.</p>
        <div class="actions" style="justify-content:flex-start"><button class="primary" id="se-new">Start season</button></div>`;
      this.root.querySelector('#se-new').onclick = () => { this.season = createSeason(this.deps.getLeague()); saveSeason(this.season); this.render(); };
      return;
    }
    const tabs = [['overview', 'Standings & schedule'], ['leaders', 'Leaders'], ['injuries', 'Injuries'], ['history', 'History']];
    this.root.innerHTML = `
      <div class="se-head">
        <div class="se-title">Season ${S.year} · ${S.phase === 'regular' ? `Week ${Math.min(S.week + 1, S.weeks.length)} of ${S.weeks.length}` : S.phase === 'playoffs' ? 'Playoffs' : 'Complete'}</div>
        <div class="pos-filter">${tabs.map(([k, l]) => `<button data-tab="${k}" class="${this.tab === k ? 'on' : ''}">${l}</button>`).join('')}</div>
      </div>
      <div id="se-status" class="se-status">${this.busy ? esc(this.busy) : ''}</div>
      <div id="se-body"></div>`;
    this.root.querySelectorAll('[data-tab]').forEach((b) => { b.onclick = () => { this.tab = b.dataset.tab; this.render(); }; });
    const body = this.root.querySelector('#se-body');
    if (this.tab === 'overview') this.renderOverview(body);
    else if (this.tab === 'leaders') this.renderLeaders(body);
    else if (this.tab === 'injuries') this.renderInjuries(body);
    else this.renderHistory(body);
  }

  renderOverview(body) {
    const S = this.season, lg = this.deps.getLeague();
    const rows = standings(S, lg);
    const games = currentGames(S);
    const seedCut = 4;
    const table = `<table class="stats"><tr><th>Team</th><th>W</th><th>L</th><th>T</th><th>PCT</th><th>PF</th><th>PA</th><th>DIFF</th><th>STRK</th></tr>
      ${rows.map((r, i) => `<tr${i === seedCut - 1 ? ' class="cut"' : ''}><td>${i + 1}. ${this.chip(r.id)} ${esc(r.team.name)}</td><td>${r.w}</td><td>${r.l}</td><td>${r.t}</td><td>${r.pct.toFixed(3).replace(/^0/, '')}</td><td>${r.pf}</td><td>${r.pa}</td><td>${r.diff > 0 ? '+' : ''}${r.diff}</td><td>${r.streak}</td></tr>`).join('')}</table>
      <div style="color:var(--muted);font-size:11.5px;margin-top:4px">Top 4 make the playoffs.</div>`;
    let slate = '';
    if (S.phase === 'done') {
      slate = `<div class="se-champ">🏆 ${this.chip(S.champion)} ${esc(this.team(S.champion).city)} ${esc(this.team(S.champion).name)} are Season ${S.year} champions!</div>
        ${this.devNotes ? `<div class="box-sec"><h3>Offseason development</h3><div class="snaps">${this.devNotes.slice(0, 18).map((c) => `<div><span>${esc(c.name)} <span class="pos">${c.team} ${c.pos}</span></span><b style="color:${c.to > c.from ? 'var(--good)' : 'var(--bad)'}">${c.from}→${c.to}</b></div>`).join('')}</div></div>` : ''}
        <div class="actions" style="justify-content:flex-start"><button class="primary" id="se-next">Start Season ${S.year + 1}</button><button id="se-reset">Delete season</button></div>`;
    } else {
      const label = S.phase === 'playoffs' ? S.playoffs.rounds[S.playoffs.rounds.length - 1][0].playoff : `Week ${S.week + 1}`;
      slate = `<h3 class="se-h3">${label}</h3>
        <div class="se-games">${games.map((g, i) => `<div class="se-game"><span>${this.chip(g.away)} @ ${this.chip(g.home)}</span>
          <span><button data-watch="${i}">Watch</button> <button data-sim="${i}">Sim</button></span></div>`).join('')}</div>
        ${this.lastResults()}
        <div class="actions" style="justify-content:flex-start">
          <button id="se-simweek" class="primary">Sim ${S.phase === 'playoffs' ? 'round' : 'week'}</button>
          ${S.phase === 'regular' ? '<button id="se-simreg">Sim to playoffs</button>' : ''}
          <button id="se-simall">Sim rest of season</button>
          <button id="se-reset">Delete season</button>
        </div>`;
    }
    body.innerHTML = `<div class="box-top"><div>${table}</div><div>${slate}</div></div>`;
    const q = (sel) => body.querySelector(sel);
    body.querySelectorAll('[data-watch]').forEach((b) => { b.onclick = () => this.watch(games[+b.dataset.watch]); });
    body.querySelectorAll('[data-sim]').forEach((b) => { b.onclick = () => this.simGames([games[+b.dataset.sim]]); });
    q('#se-simweek') && (q('#se-simweek').onclick = () => this.simGames(currentGames(this.season)));
    q('#se-simreg') && (q('#se-simreg').onclick = () => this.simUntil(() => this.season.phase !== 'regular'));
    q('#se-simall') && (q('#se-simall').onclick = () => this.simUntil(() => this.season.phase === 'done'));
    q('#se-next') && (q('#se-next').onclick = () => { this.season = createSeason(lg, this.season); this.devNotes = null; saveSeason(this.season); this.render(); });
    q('#se-reset') && (q('#se-reset').onclick = () => { if (confirm('Delete this season (including history and career stats)?')) { clearSeason(); this.season = null; this.render(); } });
  }

  lastResults() {
    const S = this.season;
    let done = [];
    if (S.phase === 'playoffs') done = S.playoffs.rounds.flat().filter((g) => g.result);
    else {
      const wk = S.weeks[S.week]; done = (wk?.games || []).filter((g) => g.result);
      if (!done.length && S.week > 0) done = S.weeks[S.week - 1].games;
    }
    if (!done.length) return '';
    return `<h3 class="se-h3">Results</h3><div class="se-games">${done.map((g) => {
      const r = g.result, hw = r.homeScore > r.awayScore;
      return `<div class="se-game"><span>${this.chip(g.away)} <b style="${!hw ? 'color:var(--accent)' : ''}">${r.awayScore}</b> @ ${this.chip(g.home)} <b style="${hw ? 'color:var(--accent)' : ''}">${r.homeScore}</b>${r.ot ? ' <span style="color:var(--muted)">OT</span>' : ''}</span><span style="color:var(--muted)">${g.playoff || ''}</span></div>`;
    }).join('')}</div>`;
  }

  renderLeaders(body) {
    const S = this.season;
    const L = leaders(S, 8, this.leaderSrc);
    body.innerHTML = `<div class="pos-filter">${['season', 'career'].map((k) => `<button data-src="${k}" class="${this.leaderSrc === k ? 'on' : ''}">${k === 'season' ? `Season ${S.year}` : 'Career'}</button>`).join('')}</div>
      <div class="se-leaders">${Object.entries(LEADER_CATS).map(([k, c]) => `<div><h3 class="se-h3">${c.label}</h3><table class="stats">${(L[k] || []).map((r, i) =>
        `<tr><td>${i + 1}. ${esc(r.name)} <span style="color:var(--muted)">${r.pos} · ${esc(r.team)}</span></td><td><b>${r.v}</b></td></tr>`).join('') || '<tr><td style="color:var(--muted)">No games yet</td></tr>'}</table></div>`).join('')}</div>`;
    body.querySelectorAll('[data-src]').forEach((b) => { b.onclick = () => { this.leaderSrc = b.dataset.src; this.render(); }; });
  }

  renderInjuries(body) {
    const inj = Object.values(this.season.injuries);
    body.innerHTML = inj.length ? `<table class="stats"><tr><th>Player</th><th>Team</th><th>Injury</th><th>Weeks out</th></tr>${inj.sort((a, b) => b.weeks - a.weeks).map((i) =>
      `<tr><td>${esc(i.name)}</td><td>${this.chip(i.team)}</td><td>${esc(i.part)}</td><td>${i.weeks}</td></tr>`).join('')}</table>` : '<p style="color:var(--muted)">No one is injured right now.</p>';
  }

  renderHistory(body) {
    const H = this.season.history;
    body.innerHTML = H.length ? `<table class="stats"><tr><th>Season</th><th>Champion</th><th>Runner-up</th><th>Final</th><th>Passing leader</th><th>Rushing leader</th></tr>${H.slice().reverse().map((h) =>
      `<tr><td>${h.year}</td><td>${this.chip(h.champion)}</td><td>${this.chip(h.runnerUp)}</td><td>${h.score}</td><td>${esc(h.leaders.passYds[0]?.name || '-')} ${h.leaders.passYds[0]?.v ?? ''}</td><td>${esc(h.leaders.rushYds[0]?.name || '-')} ${h.leaders.rushYds[0]?.v ?? ''}</td></tr>`).join('')}</table>`
      : '<p style="color:var(--muted)">Champions appear here once a season is finished.</p>';
  }

  // ---------- actions ----------
  watch(g) {
    const lg = this.deps.getLeague();
    const game = createSeasonGame(this.season, lg, g);
    this.deps.watch(game, () => this.finished(g, game));
  }

  finished(g, game) {
    recordGame(this.season, this.deps.getLeague(), g, game);
    this.afterRecord();
  }

  afterRecord() {
    const S = this.season;
    if (S.phase === 'done' && !this.devNotes) {
      const lg = this.deps.getLeague();
      this.devNotes = developPlayers(lg);
      saveLeague(lg);
      this.deps.toast(`${this.team(S.champion).name} win Season ${S.year}!`);
    }
    saveSeason(S);
  }

  // Simulate games without blocking the page: play-by-play chunks with progress.
  async simGames(games) {
    if (this.busy || !games.length) return;
    const lg = this.deps.getLeague();
    for (const g of games.slice()) {
      const game = createSeasonGame(this.season, lg, g);
      this.busy = `Simulating ${g.away} @ ${g.home}...`;
      this.render();
      while (!game.s.final) {
        const t0 = performance.now();
        while (!game.s.final && performance.now() - t0 < 30) {
          const sim = game.nextSim({ skipLineup: true });
          if (!sim) break;
          sim.runToEnd();
          game.applyResult(sim);
        }
        const st = this.root.querySelector('#se-status');
        if (st) st.textContent = `Simulating ${g.away} @ ${g.home}... Q${Math.min(game.s.quarter, 4)} ${game.teams.away.abbr} ${game.s.score.away}-${game.s.score.home} ${game.teams.home.abbr}`;
        await new Promise((r) => setTimeout(r, 0));
      }
      recordGame(this.season, lg, g, game);
      this.afterRecord();
    }
    this.busy = false;
    this.render();
  }

  async simUntil(stop) {
    let guard = 0;
    while (!stop() && guard++ < 60) {
      const games = currentGames(this.season);
      if (!games.length) break;
      await this.simGames(games);
    }
  }
}
