// Season screen: standings, weekly slate (watch or sim), leaders, injuries, history.
import {
  createSeason, currentGames, createSeasonGame, recordGame, standings, leaders, developPlayers,
  LEADER_CATS, saveSeason, loadSeason, clearSeason, seasonKey, playoffTeams, seedOf, outPlayers,
} from '../season/season.js';
import { saveLeague } from '../data/storage.js';
import { StatsView, realAsLine } from './statsui.js';
import { showPlayerCard, bindCards, teamRatingHTML, lineupHTML, rosterHTML, coachPanelHTML, bindCoachPanel, leagueTableHTML } from './ratings.js';
import { SimPool } from './simpool.js';

const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

export class SeasonUI {
  constructor(root, deps) {
    this.root = root;
    this.deps = deps; // { getLeague, watch(game, onDone), toast(msg) }
    this.key = seasonKey(deps.getLeague());
    this.season = loadSeason(this.key);
    this.tab = 'overview';
    this.leaderSrc = 'season';
    this.busy = false;
    this.devNotes = null;
    this.stats = new StatsView(this);
    this.playerId = null;
    this.compareReal = false;
  }

  openPlayer(pid) { this.playerId = pid; this.render(); this.root.scrollTop = 0; }
  closePlayer() { this.playerId = null; this.render(); }

  team(id) { return this.deps.getLeague().teams.find((t) => t.id === id); }
  chip(id) {
    const t = this.team(id);
    const mine = id === this.deps.getLeague().userTeam; // fantasy draft: the user's franchise
    return t ? `<i class="swatch" style="background:${t.colors.primary}"></i> ${mine ? `<b class="my-team" title="Your team">★${esc(t.abbr)}</b>` : esc(t.abbr)}` : esc(id);
  }

  save() { saveSeason(this.season, this.key); }

  // Start a fresh season for a league (the fantasy draft hands its league over here).
  startSeasonFor(lg) {
    this.key = seasonKey(lg);
    this.season = createSeason(lg);
    this.devNotes = null; this.playerId = null; this.tab = 'overview';
    this.save();
  }

  render() {
    // each league (fictional, NFL) keeps its own season
    const lg = this.deps.getLeague();
    const key = seasonKey(lg);
    if (key !== this.key && !this.busy) { this.key = key; this.season = loadSeason(key); this.devNotes = null; }
    if (this.season && this.season.teams.some((id) => !this.team(id))) this.season = null; // league was replaced
    const S = this.season;
    if (!S) {
      const nfl = lg.teams.length === 32 && lg.teams.every((t) => t.div);
      const sch = lg.schedule;
      const finals = sch ? sch.weeks.flatMap((w) => w.games).filter((g) => g.final).length : 0;
      const firstOpen = sch ? (sch.weeks.find((w) => w.games.some((g) => !g.final))?.week ?? sch.weeks.length) : 1;
      const realOpts = sch ? `<div class="se-opts">
          <label class="tog"><input type="checkbox" id="se-real" checked /> Use the real ${sch.season} schedule (with byes)</label>
          <label class="tog"><input type="checkbox" id="se-results" ${finals ? 'checked' : 'disabled'} /> Start at week ${firstOpen} with the ${finals} real results so far</label>
          <label class="tog"><input type="checkbox" id="se-inj" checked /> Carry over current injuries, IR and suspensions</label>
        </div>` : '';
      this.root.innerHTML = `<p style="color:var(--muted)">${nfl
        ? 'Play an NFL season: a 17-game schedule with two games against each division rival, a 14-team playoff (division winners seeded 1–4, three wild cards, byes for the 1 seeds) and a championship game.'
        : `Play a ${lg.teams.length}-team season: a ${lg.teams.length <= 10 ? `${2 * (lg.teams.length - (lg.teams.length % 2 ? 0 : 1))}-week double round-robin` : '17-week schedule'}, a ${lg.teams.length > 8 ? 8 : 4}-team playoff and a champion.`}
        Injuries carry over from week to week, players develop between seasons, and season and career leaders are tracked.${nfl ? ' A full NFL season takes a few minutes to simulate.' : ''}</p>
        ${realOpts}
        <div class="actions" style="justify-content:flex-start"><button class="primary" id="se-new">Start season</button></div>`;
      this.root.querySelector('#se-new').onclick = () => {
        const q = (id) => this.root.querySelector(id)?.checked;
        const real = q('#se-real');
        this.season = createSeason(lg, null, { realSchedule: real, realResults: real && q('#se-results'), realInjuries: q('#se-inj') });
        this.save(); this.render();
      };
      return;
    }
    const tabs = [['overview', 'Standings & schedule'], ['team', lg.userTeam ? 'My team' : 'Teams'], ['leaders', 'Leaders'], ['stats', 'Stats'], ['teamstats', 'Team stats'], ['injuries', 'Injuries'], ['history', 'History']];
    this.root.innerHTML = `
      <div class="se-head">
        <div class="se-title">${S.realSeason && S.year === 1 ? `${S.realSeason} NFL season` : `Season ${S.year}`} · ${S.phase === 'regular' ? `Week ${Math.min(S.week + 1, S.weeks.length)} of ${S.weeks.length}` : S.phase === 'playoffs' ? 'Playoffs' : 'Complete'}</div>
        <div class="pos-filter">${tabs.map(([k, l]) => `<button data-tab="${k}" class="${this.tab === k ? 'on' : ''}">${l}</button>`).join('')}</div>
      </div>
      <div id="se-status" class="se-status">${this.busy ? esc(this.busy) : ''}</div>
      <div id="se-body"></div>`;
    this.root.querySelectorAll('[data-tab]').forEach((b) => { b.onclick = () => { this.tab = b.dataset.tab; this.playerId = null; this.render(); }; });
    const body = this.root.querySelector('#se-body');
    if (this.playerId) this.stats.renderPlayer(body, this.playerId);
    else if (this.tab === 'stats') this.stats.renderPlayers(body);
    else if (this.tab === 'teamstats') this.stats.renderTeams(body);
    else if (this.tab === 'overview') this.renderOverview(body);
    else if (this.tab === 'team') this.renderTeam(body);
    else if (this.tab === 'leaders') this.renderLeaders(body);
    else if (this.tab === 'injuries') this.renderInjuries(body);
    else this.renderHistory(body);
  }

  renderOverview(body) {
    const S = this.season, lg = this.deps.getLeague();
    const rows = standings(S, lg);
    const me = lg.userTeam;
    const isMine = (g) => !!me && (g.home === me || g.away === me);
    const games = currentGames(S).sort((a, b) => isMine(b) - isMine(a)); // your game first
    const seedCut = playoffTeams(S);
    const pct = (r) => r.pct.toFixed(3).replace(/^0/, '');
    const seed = (id) => { const s = seedOf(S, id); return s ? ` <span style="color:var(--accent);font-size:11px">(${s})</span>` : ''; };
    let table;
    if (S.format === 'nfl') {
      table = [...new Set(S.divisions.map((d) => d.conf))].map((c) => `<h3 class="se-h3">${esc(c)}</h3>${S.divisions.filter((d) => d.conf === c).map((d) =>
        `<table class="stats" style="margin-bottom:6px"><tr><th>${esc(d.name)}</th><th>W</th><th>L</th><th>T</th><th>PCT</th><th>DIV</th><th>PF</th><th>PA</th><th>STRK</th></tr>
        ${rows.filter((r) => r.div === d.name).map((r) => `<tr><td>${this.chip(r.id)} <span class="tname">${esc(r.team.name)}</span>${seed(r.id)}</td><td>${r.w}</td><td>${r.l}</td><td>${r.t}</td><td>${pct(r)}</td><td>${r.dw}-${r.dl}${r.dt ? `-${r.dt}` : ''}</td><td>${r.pf}</td><td>${r.pa}</td><td>${r.streak}</td></tr>`).join('')}</table>`).join('')}`).join('')
        + '<div style="color:var(--muted);font-size:11.5px;margin-top:4px">Seven teams per conference make the playoffs: four division winners and three wild cards.</div>';
    } else {
      table = `<table class="stats"><tr><th>Team</th><th>W</th><th>L</th><th>T</th><th>PCT</th><th>PF</th><th>PA</th><th>DIFF</th><th>STRK</th></tr>
      ${rows.map((r, i) => `<tr${i === seedCut - 1 ? ' class="cut"' : ''}><td>${i + 1}. ${this.chip(r.id)} <span class="tname">${esc(r.team.name)}</span></td><td>${r.w}</td><td>${r.l}</td><td>${r.t}</td><td>${pct(r)}</td><td>${r.pf}</td><td>${r.pa}</td><td>${r.diff > 0 ? '+' : ''}${r.diff}</td><td>${r.streak}</td></tr>`).join('')}</table>
      <div style="color:var(--muted);font-size:11.5px;margin-top:4px">Top ${seedCut} make the playoffs.</div>`;
    }
    let slate = '';
    if (S.phase === 'done') {
      slate = `<div class="se-champ">🏆 ${this.chip(S.champion)} ${esc(this.team(S.champion).city)} ${esc(this.team(S.champion).name)} are Season ${S.year} champions!</div>
        ${this.devNotes ? `<div class="box-sec"><h3>Offseason development</h3><div class="snaps">${this.devNotes.slice(0, 18).map((c) => `<div><span>${esc(c.name)} <span class="pos">${c.team} ${c.pos}</span></span><b style="color:${c.to > c.from ? 'var(--good)' : 'var(--bad)'}">${c.from}→${c.to}</b></div>`).join('')}</div></div>` : ''}
        <div class="actions" style="justify-content:flex-start"><button class="primary" id="se-next">Start Season ${S.year + 1}</button><button id="se-reset">Delete season</button></div>`;
    } else {
      const label = S.phase === 'playoffs' ? S.playoffs.rounds[S.playoffs.rounds.length - 1][0].playoff.replace(/^[A-Z]{3} (?=Wild|Div|Champ)/, '') : `Week ${S.week + 1}`;
      const playing = new Set(games.flatMap((g) => [g.home, g.away]).concat((S.weeks[S.week]?.games || []).flatMap((g) => [g.home, g.away])));
      const byes = S.phase === 'regular' ? S.teams.filter((id) => !playing.has(id)) : [];
      slate = `<h3 class="se-h3">${label}</h3>${byes.length ? `<div style="color:var(--muted);font-size:12px;margin:-2px 0 6px">Bye: ${byes.map((id) => this.chip(id)).join(' ')}</div>` : ''}
        <div class="se-games">${games.map((g, i) => `<div class="se-game${isMine(g) ? ' mine' : ''}"><span>${isMine(g) ? '<span class="my-label">Your game</span> ' : ''}${this.chip(g.away)}${seed(g.away)} @ ${this.chip(g.home)}${seed(g.home)}${g.playoff && /^[A-Z]{3} /.test(g.playoff) ? ` <span style="color:var(--muted)">${esc(g.playoff.slice(0, 3))}</span>` : ''}</span>
          <span><button data-watch="${i}">Watch</button> <button data-sim="${i}">Sim</button></span></div>`).join('')}</div>
        ${this.lastResults()}
        <div class="actions" style="justify-content:flex-start">
          ${games.some(isMine) && games.length > 1 ? '<button id="se-simothers" title="Simulate every game except yours, then watch yours">Sim other games</button>' : ''}
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
    q('#se-simothers') && (q('#se-simothers').onclick = () => this.simGames(currentGames(this.season).filter((g) => !isMine(g))));
    q('#se-simreg') && (q('#se-simreg').onclick = () => this.simUntil(() => this.season.phase !== 'regular'));
    q('#se-simall') && (q('#se-simall').onclick = () => this.simUntil(() => this.season.phase === 'done'));
    q('#se-next') && (q('#se-next').onclick = () => { this.season = createSeason(lg, this.season); this.devNotes = null; this.save(); this.render(); });
    q('#se-reset') && (q('#se-reset').onclick = () => { if (confirm('Delete this season (including history and career stats)?')) { clearSeason(this.key); this.season = null; this.render(); } });
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
      return `<div class="se-game"><span>${this.chip(g.away)} <b style="${!hw ? 'color:var(--accent)' : ''}">${r.awayScore}</b> @ ${this.chip(g.home)} <b style="${hw ? 'color:var(--accent)' : ''}">${r.homeScore}</b>${r.ot ? ' <span style="color:var(--muted)">OT</span>' : ''}</span><span style="color:var(--muted)">${g.playoff || (r.real ? 'real result' : '')}</span></div>`;
    }).join('')}</div>`;
  }

  renderLeaders(body) {
    const S = this.season;
    const L = leaders(S, 8, this.leaderSrc);
    // imported leagues: put each leader's real stat line from last season beside the sim number
    const lg = this.deps.getLeague();
    const realOf = new Map();
    for (const t of lg.teams) for (const p of t.roster) if (p.real) realOf.set(p.id, p.real);
    const realYr = realOf.size ? [...realOf.values()][0].season : null;
    const cmp = this.compareReal && realYr;
    body.innerHTML = `<div class="st-bar"><div class="pos-filter">${['season', 'career'].map((k) => `<button data-src="${k}" class="${this.leaderSrc === k ? 'on' : ''}">${k === 'season' ? `Season ${S.year}` : 'Career'}</button>`).join('')}</div>
      ${realYr ? `<label class="tog"><input type="checkbox" id="se-cmp" ${cmp ? 'checked' : ''} /> Compare with real ${realYr} stats</label>` : ''}</div>
      <div class="se-leaders">${Object.entries(LEADER_CATS).map(([k, c]) => `<div><h3 class="se-h3">${c.label}</h3><table class="stats">${cmp ? `<tr><th></th><th>Sim</th><th>Real ${realYr}</th></tr>` : ''}${(L[k] || []).map((r, i) => {
        const rl = cmp ? realAsLine(realOf.get(r.pid)) : null;
        return `<tr><td>${i + 1}. ${this.stats.link(r.pid, r.name)} <span style="color:var(--muted)">${r.pos} · ${esc(r.team)}</span></td><td><b>${r.v}</b></td>${cmp ? `<td style="color:var(--muted)">${rl ? c.get(rl) : '—'}</td>` : ''}</tr>`;
      }).join('') || '<tr><td style="color:var(--muted)">No games yet</td></tr>'}</table></div>`).join('')}</div>`;
    body.querySelectorAll('[data-src]').forEach((b) => { b.onclick = () => { this.leaderSrc = b.dataset.src; this.render(); }; });
    const cb = body.querySelector('#se-cmp'); if (cb) cb.onchange = () => { this.compareReal = cb.checked; this.render(); };
    this.stats.bindLinks(body);
  }

  // Team ratings, starters, roster and coaching preferences, plus every team's ratings.
  renderTeam(body) {
    const lg = this.deps.getLeague();
    if (!this.teamSel || !this.team(this.teamSel)) this.teamSel = lg.userTeam || lg.teams[0].id;
    const t = this.team(this.teamSel);
    const mine = t.id === lg.userTeam;
    // in a fantasy league you coach your own franchise; otherwise any team can be adjusted (as in the Teams editor)
    const editable = !lg.userTeam || mine;
    const view = this.teamView || 'team';
    body.innerHTML = `
      <div class="st-bar">
        <div class="pos-filter">${[['team', 'Team'], ['league', 'League ratings']].map(([k, l]) => `<button data-tview="${k}" class="${view === k ? 'on' : ''}">${l}</button>`).join('')}</div>
        ${view === 'team' ? `<select id="tm-sel">${lg.teams.map((x) => `<option value="${esc(x.id)}" ${x.id === t.id ? 'selected' : ''}>${x.id === lg.userTeam ? '★ ' : ''}${esc(x.city)} ${esc(x.name)}</option>`).join('')}</select>` : ''}
      </div>
      ${view === 'league' ? leagueTableHTML(lg.teams, lg.userTeam, (id) => this.chip(id), this.openTeam) : `
      <div class="box-top">
        <div>
          <div class="se-title">${this.chip(t.id)} ${esc(t.city)} ${esc(t.name)}</div>
          ${teamRatingHTML(t)}
          <h3 class="se-h3">Starters</h3>${lineupHTML(t)}
        </div>
        <div>
          <h3 class="se-h3">Coaching${editable ? '' : ' (view only)'}</h3>
          ${editable ? `<p class="dr-note" style="margin-top:0">Changes apply from the next game you watch or simulate.</p>` : '<p class="dr-note" style="margin-top:0">You coach your own franchise; other teams are run by the AI.</p>'}
          ${coachPanelHTML(t.coach, { editable })}
        </div>
      </div>
      <h3 class="se-h3">Roster</h3>${rosterHTML(t)}`}`;
    const find = (pid) => { for (const x of lg.teams) { const p = x.roster.find((q) => q.id === pid); if (p) return { p, team: x }; } return null; };
    body.querySelectorAll('[data-card]').forEach((el) => el.addEventListener('click', (e) => {
      e.preventDefault();
      const hit = find(el.dataset.card);
      if (!hit) return;
      showPlayerCard(hit.p, {
        team: hit.team,
        footer: '<div class="actions" style="justify-content:flex-start;margin-bottom:0"><button data-stats>Season stats &amp; game log</button></div>',
        onOpen: (card, close) => { card.querySelector('[data-stats]').onclick = () => { close(); this.openPlayer(hit.p.id); }; },
      });
    }));
    body.querySelectorAll('[data-tview]').forEach((b) => { b.onclick = () => { this.teamView = b.dataset.tview; this.render(); }; });
    body.querySelectorAll('[data-lgteam]').forEach((tr) => { tr.onclick = () => { this.openTeam = this.openTeam === tr.dataset.lgteam ? null : tr.dataset.lgteam; this.render(); }; });
    const sel = body.querySelector('#tm-sel');
    if (sel) sel.onchange = () => { this.teamSel = sel.value; this.render(); };
    if (editable && view === 'team') bindCoachPanel(body, t.coach, () => saveLeague(lg));
  }

  renderInjuries(body) {
    const inj = Object.values(this.season.injuries);
    const tag = (i) => i.seasonEnding ? '<b style="color:var(--bad)">Season-ending IR</b>' : i.ir ? `<b style="color:var(--bad)">IR</b> · ${i.weeks} wk` : i.weeks <= 1 ? 'Questionable' : `Out · ${i.weeks} wk`;
    body.innerHTML = inj.length ? `<table class="stats"><tr><th>Player</th><th>Team</th><th>Injury</th><th>Status</th></tr>${inj.sort((a, b) => b.weeks - a.weeks).map((i) =>
      `<tr><td>${esc(i.name)}${i.pos ? ` <span style="color:var(--muted)">${i.pos}</span>` : ''}</td><td>${this.chip(i.team)}</td><td>${esc(i.part)}</td><td>${tag(i)}</td></tr>`).join('')}</table>` : '<p style="color:var(--muted)">No one is injured right now.</p>';
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
    this.save();
  }

  // Simulate games without blocking the page: in parallel Web Workers when available,
  // otherwise play-by-play chunks on the main thread with progress.
  async simGames(games, pool) {
    if ((this.busy && !pool) || !games.length) return;
    const own = !pool;
    if (own) pool = SimPool.create(this.deps.getLeague());
    try {
      if (pool && !pool.broken) {
        try { await this.simParallel(games, pool); return; } catch (e) { console.warn('Worker simulation failed; using the main thread.', e); }
      }
      await this.simMainThread(games.filter((g) => !g.result));
    } finally {
      if (own && pool) pool.terminate();
      this.busy = false;
      this.render();
    }
  }

  async simParallel(games, pool) {
    const lg = this.deps.getLeague();
    const out = [...outPlayers(this.season)];
    let done = 0;
    const label = this.season.phase === 'playoffs' ? 'playoff' : `week ${this.season.weeks[this.season.week]?.week ?? this.season.week + 1}`;
    this.busy = `Simulating ${label}: 0/${games.length} games...`;
    this.render();
    await Promise.all(games.map((g) => pool.run({ home: g.home, away: g.away, out, noTie: !!g.playoff }).then((res) => {
      if (g.result) return;
      recordGame(this.season, lg, g, res);
      this.afterRecord();
      done++;
      this.busy = `Simulating ${label}: ${done}/${games.length} games...`;
      const st = this.root.querySelector('#se-status');
      if (st) st.textContent = this.busy;
    })));
  }

  async simMainThread(games) {
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
  }

  async simUntil(stop) {
    if (this.busy) return;
    const pool = SimPool.create(this.deps.getLeague());
    try {
      let guard = 0;
      while (!stop() && guard++ < 60) {
        const games = currentGames(this.season);
        if (!games.length) break;
        this.busy = 'Simulating...';
        await this.simGames(games, pool);
      }
    } finally {
      pool?.terminate();
      this.busy = false;
      this.render();
    }
  }

}
