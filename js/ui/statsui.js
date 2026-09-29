// Season stats pages: sortable league tables, team stats, and a player page with a game log and a
// side-by-side with the player's real stats (imported leagues).
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const n = (x) => x || 0;
const r1 = (x) => (Number.isFinite(x) ? Math.round(x * 10) / 10 : 0);
const pct = (a, b) => (b ? (100 * a / b).toFixed(1) : '0.0');

// NFL passer rating
export function passerRating(p) {
  const att = n(p.att);
  if (!att) return 0;
  const c = (x) => Math.max(0, Math.min(2.375, x));
  const a = c((n(p.cmp) / att - 0.3) * 5), b = c((n(p.yds) / att - 3) * 0.25), t = c(n(p.td) / att * 20), i = c(2.375 - n(p.int) / att * 25);
  return Math.round((a + b + t + i) / 6 * 1000) / 10;
}

// Stat categories: columns are [label, value(line), sort key default?]
export const STAT_CATS = {
  passing: {
    label: 'Passing', qual: (x) => n(x.pass?.att) >= 1, sort: 'YDS',
    cols: [['CMP', (x) => n(x.pass?.cmp)], ['ATT', (x) => n(x.pass?.att)], ['PCT', (x) => +pct(n(x.pass?.cmp), n(x.pass?.att))], ['YDS', (x) => n(x.pass?.yds)],
      ['Y/A', (x) => r1(n(x.pass?.yds) / Math.max(1, n(x.pass?.att)))], ['TD', (x) => n(x.pass?.td)], ['INT', (x) => n(x.pass?.int)], ['SCK', (x) => n(x.pass?.sack)], ['RTG', (x) => passerRating(x.pass || {})]],
  },
  rushing: {
    label: 'Rushing', qual: (x) => n(x.rush?.car) >= 1, sort: 'YDS',
    cols: [['CAR', (x) => n(x.rush?.car)], ['YDS', (x) => n(x.rush?.yds)], ['AVG', (x) => r1(n(x.rush?.yds) / Math.max(1, n(x.rush?.car)))], ['LNG', (x) => n(x.rush?.long)], ['TD', (x) => n(x.rush?.td)], ['FUM', (x) => n(x.fum?.lost)]],
  },
  receiving: {
    label: 'Receiving', qual: (x) => n(x.rec?.rec) + n(x.rec?.tgt) >= 1, sort: 'YDS',
    cols: [['TGT', (x) => n(x.rec?.tgt)], ['REC', (x) => n(x.rec?.rec)], ['YDS', (x) => n(x.rec?.yds)], ['AVG', (x) => r1(n(x.rec?.yds) / Math.max(1, n(x.rec?.rec)))], ['LNG', (x) => n(x.rec?.long)], ['TD', (x) => n(x.rec?.td)]],
  },
  defense: {
    label: 'Defense', qual: (x) => n(x.def?.tkl) + n(x.def?.ast) + n(x.def?.sack) + n(x.def?.int) + n(x.def?.pd) > 0, sort: 'TOT',
    cols: [['TOT', (x) => n(x.def?.tkl) + n(x.def?.ast)], ['SOLO', (x) => n(x.def?.tkl)], ['AST', (x) => n(x.def?.ast)], ['SCK', (x) => r1(n(x.def?.sack))], ['TFL', (x) => n(x.def?.tfl)],
      ['INT', (x) => n(x.def?.int)], ['PD', (x) => n(x.def?.pd)], ['FF', (x) => n(x.def?.ff)], ['FR', (x) => n(x.def?.fr)], ['BLK', (x) => n(x.def?.blk)]],
  },
  kicking: {
    label: 'Kicking', qual: (x) => n(x.kick?.fga) + n(x.kick?.xpa) > 0, sort: 'FGM',
    cols: [['FGM', (x) => n(x.kick?.fgm)], ['FGA', (x) => n(x.kick?.fga)], ['PCT', (x) => +pct(n(x.kick?.fgm), n(x.kick?.fga))], ['LNG', (x) => n(x.kick?.long)], ['XPM', (x) => n(x.kick?.xpm)], ['XPA', (x) => n(x.kick?.xpa)]],
  },
  punting: {
    label: 'Punting', qual: (x) => n(x.punt?.punts) > 0, sort: 'AVG',
    cols: [['PUNTS', (x) => n(x.punt?.punts)], ['YDS', (x) => n(x.punt?.yds)], ['AVG', (x) => r1(n(x.punt?.yds) / Math.max(1, n(x.punt?.punts)))], ['IN20', (x) => n(x.punt?.in20)], ['TB', (x) => n(x.punt?.tb)]],
  },
  returns: {
    label: 'Returns', qual: (x) => n(x.ret?.kr) + n(x.ret?.pr) > 0, sort: 'KR YDS',
    cols: [['KR', (x) => n(x.ret?.kr)], ['KR YDS', (x) => n(x.ret?.kryds)], ['KR AVG', (x) => r1(n(x.ret?.kryds) / Math.max(1, n(x.ret?.kr)))], ['PR', (x) => n(x.ret?.pr)], ['PR YDS', (x) => n(x.ret?.pryds)], ['PR AVG', (x) => r1(n(x.ret?.pryds) / Math.max(1, n(x.ret?.pr)))], ['TD', (x) => n(x.ret?.td)]],
  },
};

// Real stat lines from the importer use slightly different shapes; bring them in line for comparisons.
export function realAsLine(r) {
  if (!r) return null;
  return {
    gp: r.gp,
    pass: r.pass ? { cmp: r.pass.cmp, att: r.pass.att, yds: r.pass.yds, td: r.pass.td, int: r.pass.int } : null,
    rush: r.rush ? { car: r.rush.car, yds: r.rush.yds, td: r.rush.td } : null,
    rec: r.rec ? { tgt: r.rec.tgt, rec: r.rec.rec, yds: r.rec.yds, td: r.rec.td } : null,
    def: r.def ? { tkl: r.def.tkl, sack: r.def.sack, tfl: r.def.tfl, int: r.def.int, pd: r.def.pd, ff: r.def.ff } : null,
    kick: r.kick ? { fgm: r.kick.fgm, fga: r.kick.fga, long: r.kick.lng, xpm: r.kick.xpm, xpa: r.kick.xpa } : null,
    punt: r.punt ? { punts: r.punt.punts, yds: Math.round(r.punt.punts * r.punt.avg), in20: r.punt.in20 } : null,
  };
}

export class StatsView {
  constructor(ui) {
    this.ui = ui;               // SeasonUI: team(id), chip(id), season, deps.getLeague(), render()
    this.cat = 'passing';
    this.sortKey = null;
    this.sortDir = -1;
    this.teamF = '';
    this.src = 'season';
    this.teamView = 'off';
  }

  player(pid) {
    const lg = this.ui.deps.getLeague();
    for (const t of lg.teams) { const p = t.roster.find((x) => x.id === pid); if (p) return { p, t }; }
    return null;
  }
  link(pid, name) { return `<a href="#" class="plink" data-pid="${esc(pid)}">${esc(name)}</a>`; }
  bindLinks(root) {
    root.querySelectorAll('.plink').forEach((a) => { a.onclick = (e) => { e.preventDefault(); this.ui.openPlayer(a.dataset.pid); }; });
  }

  renderPlayers(body) {
    const S = this.ui.season;
    const C = STAT_CATS[this.cat];
    const sortKey = this.sortKey && C.cols.some(([l]) => l === this.sortKey) ? this.sortKey : C.sort;
    const col = C.cols.find(([l]) => l === sortKey)[1];
    const pool = Object.entries(this.src === 'career' ? S.careers : S.stats)
      .filter(([, x]) => C.qual(x) && (!this.teamF || x.team === this.teamF))
      .sort((a, b) => (col(b[1]) - col(a[1])) * (this.sortDir < 0 ? 1 : -1));
    const rows = pool.slice(0, 60);
    body.innerHTML = `
      <div class="st-bar">
        <div class="pos-filter">${Object.entries(STAT_CATS).map(([k, c]) => `<button data-cat="${k}" class="${this.cat === k ? 'on' : ''}">${c.label}</button>`).join('')}</div>
        <select id="st-team"><option value="">All teams</option>${S.teams.map((id) => `<option value="${id}" ${this.teamF === id ? 'selected' : ''}>${esc(this.ui.team(id)?.abbr || id)}</option>`).join('')}</select>
        <select id="st-src"><option value="season" ${this.src === 'season' ? 'selected' : ''}>${S.realSeason && S.year === 1 ? `${S.realSeason} season` : `Season ${S.year}`}</option><option value="career" ${this.src === 'career' ? 'selected' : ''}>Career</option></select>
      </div>
      <div class="st-scroll"><table class="stats st-table st-players"><tr><th>#</th><th>Player</th><th>Team</th><th>GP</th>${C.cols.map(([l]) => `<th data-sort="${l}" class="sortable${l === sortKey ? ' on' : ''}">${l}${l === sortKey ? (this.sortDir < 0 ? ' ▾' : ' ▴') : ''}</th>`).join('')}</tr>
      ${rows.map(([pid, x], i) => `<tr><td>${i + 1}</td><td>${this.link(pid, x.name)} <span class="pos">${x.pos}</span></td><td>${this.ui.chip(x.team)}</td><td>${x.gp}</td>${C.cols.map(([, f]) => `<td>${f(x)}</td>`).join('')}</tr>`).join('')
        || `<tr><td colspan="${C.cols.length + 4}" style="color:var(--muted)">No stats yet. Play or simulate some games.</td></tr>`}</table></div>`;
    body.querySelectorAll('[data-cat]').forEach((b) => { b.onclick = () => { this.cat = b.dataset.cat; this.sortKey = null; this.sortDir = -1; this.ui.render(); }; });
    body.querySelectorAll('[data-sort]').forEach((th) => { th.onclick = () => { if (this.sortKey === th.dataset.sort || (!this.sortKey && th.dataset.sort === C.sort)) this.sortDir = -this.sortDir; else { this.sortKey = th.dataset.sort; this.sortDir = -1; } this.ui.render(); }; });
    body.querySelector('#st-team').onchange = (e) => { this.teamF = e.target.value; this.ui.render(); };
    body.querySelector('#st-src').onchange = (e) => { this.src = e.target.value; this.ui.render(); };
    this.bindLinks(body);
  }

  renderTeams(body) {
    const S = this.ui.season;
    const TS = S.teamStats || {};
    const side = this.teamView;
    const cols = [
      ['PTS/G', (t) => r1(t.pf / t.g)], ['OPP/G', (t) => r1(t.pa / t.g)],
      ['YDS/G', (t) => r1(n(t[side].totalYds) / t.g)], ['PASS/G', (t) => r1(n(t[side].passYds) / t.g)], ['RUSH/G', (t) => r1(n(t[side].rushYds) / t.g)],
      ['YPC', (t) => r1(n(t[side].rushYds) / Math.max(1, n(t[side].rushAtt)))], ['CMP%', (t) => +pct(n(t[side].passCmp), n(t[side].passAtt))],
      ['3RD%', (t) => +pct(n(t[side].thirdConv), n(t[side].thirdAtt))], ['TO', (t) => n(t[side].turnovers)], ['SACKS', (t) => n(t[side].sacks)],
      ['PEN', (t) => n(t[side].penalties)],
    ];
    const key = this.teamSort && cols.some(([l]) => l === this.teamSort) ? this.teamSort : 'PTS/G';
    const f = cols.find(([l]) => l === key)[1];
    const rows = Object.entries(TS).filter(([, t]) => t.g).sort((a, b) => (f(b[1]) - f(a[1])) * ((this.teamDir || -1) < 0 ? 1 : -1));
    body.innerHTML = `
      <div class="st-bar"><div class="pos-filter">${[['off', 'Offense'], ['def', 'Defense (allowed)']].map(([k, l]) => `<button data-side="${k}" class="${side === k ? 'on' : ''}">${l}</button>`).join('')}</div></div>
      <div class="st-scroll"><table class="stats st-table"><tr><th>Team</th><th>G</th>${cols.map(([l]) => `<th data-sort="${l}" class="sortable${l === key ? ' on' : ''}">${l}</th>`).join('')}</tr>
      ${rows.map(([id, t]) => `<tr><td>${this.ui.chip(id)} <span class="tname">${esc(this.ui.team(id)?.name || '')}</span></td><td>${t.g}</td>${cols.map(([, g]) => `<td>${g(t)}</td>`).join('')}</tr>`).join('')
        || '<tr><td colspan="13" style="color:var(--muted)">No games played yet.</td></tr>'}</table></div>
      <div style="color:var(--muted);font-size:11.5px;margin-top:4px">${side === 'def' ? 'What opponents gained against each team (sacks = sacks made by the defense).' : 'Sacks = sacks taken by the offense.'}</div>`;
    body.querySelectorAll('[data-side]').forEach((b) => { b.onclick = () => { this.teamView = b.dataset.side; this.ui.render(); }; });
    body.querySelectorAll('[data-sort]').forEach((th) => { th.onclick = () => { this.teamDir = this.teamSort === th.dataset.sort ? -(this.teamDir || -1) : -1; this.teamSort = th.dataset.sort; this.ui.render(); }; });
  }

  renderPlayer(body, pid) {
    const S = this.ui.season;
    const x = S.stats[pid], car = S.careers[pid];
    const found = this.player(pid);
    const p = found?.p;
    const name = p ? `${p.first} ${p.last}` : x?.name || car?.name || 'Player';
    const real = realAsLine(p?.real);
    const cats = Object.entries(STAT_CATS).filter(([, C]) => (x && C.qual(x)) || (car && C.qual(car)) || (real && C.qual(real)));
    const line = (label, L) => (L ? `<tr><td>${label}</td><td>${L.gp ?? ''}</td>` : '');
    const tbl = ([k, C]) => `<h3 class="se-h3">${C.label}</h3><div class="st-scroll"><table class="stats st-table"><tr><th></th><th>GP</th>${C.cols.map(([l]) => `<th>${l}</th>`).join('')}</tr>
      ${[[`Sim ${S.realSeason && S.year === 1 ? S.realSeason : `season ${S.year}`}`, x], ['Sim career', car], [real ? `Real ${p.real.season}${p.real.team ? ` (${esc(p.real.team)})` : ''}` : '', real]]
        .filter(([, L]) => L && C.qual(L)).map(([label, L]) => `${line(label, L)}${C.cols.map(([, f]) => `<td>${f(L)}</td>`).join('')}</tr>`).join('')}</table></div>`;
    const log = (S.logs?.[pid] || []).slice().reverse();
    const logLine = (L) => {
      const b = [];
      if (L.pass?.att) b.push(`${L.pass.cmp || 0}/${L.pass.att}, ${L.pass.yds || 0} yds${L.pass.td ? `, ${L.pass.td} TD` : ''}${L.pass.int ? `, ${L.pass.int} INT` : ''}`);
      if (L.rush?.car) b.push(`${L.rush.car} car, ${L.rush.yds || 0} yds${L.rush.td ? `, ${L.rush.td} TD` : ''}`);
      if (L.rec?.rec || L.rec?.tgt) b.push(`${L.rec.rec || 0} rec, ${L.rec.yds || 0} yds${L.rec.td ? `, ${L.rec.td} TD` : ''}`);
      const d = L.def || {};
      if (d.tkl || d.ast || d.sack || d.int || d.pd) b.push([d.tkl || d.ast ? `${(d.tkl || 0) + (d.ast || 0)} tkl` : '', d.sack ? `${d.sack} sk` : '', d.int ? `${d.int} INT` : '', d.pd ? `${d.pd} PD` : ''].filter(Boolean).join(', '));
      if (L.kick?.fga || L.kick?.xpa) b.push(`FG ${L.kick.fgm || 0}/${L.kick.fga || 0}, XP ${L.kick.xpm || 0}/${L.kick.xpa || 0}`);
      if (L.punt?.punts) b.push(`${L.punt.punts} punts, ${L.punt.yds || 0} yds`);
      if (L.ret?.kr || L.ret?.pr) b.push(`${(L.ret.kr || 0) + (L.ret.pr || 0)} ret, ${(L.ret.kryds || 0) + (L.ret.pryds || 0)} yds`);
      return b.join(' · ') || '—';
    };
    const t = found?.t;
    const traits = (p?.traits || []).join(', ');
    body.innerHTML = `
      <div class="pl-head">
        <button id="pl-back">← Back</button>
        <div>
          <div class="pl-name">${esc(name)} <span class="pos">${esc(p?.pos || x?.pos || '')}${p ? ` #${p.num}` : ''}</span>${p?.injury ? ` <span class="inj-tag">${esc(p.injury.status)}</span>` : ''}</div>
          <div class="pl-meta">${t ? `${this.ui.chip(t.id)} ${esc(t.city)} ${esc(t.name)} · ` : ''}${p ? `${Math.floor(p.height / 12)}'${p.height % 12}" ${p.weight} lb${p.age ? ` · age ${p.age}` : ''}${p.college ? ` · ${esc(p.college)}` : ''}` : ''}</div>
          ${p ? `<div class="pl-meta">OVR <b>${p.ovr}</b>${p.madden ? ` · Madden ${p.madden.ovr}` : ''}${traits ? ` · ${esc(traits.replace(/_/g, ' '))}` : ''}</div>` : ''}
        </div>
      </div>
      ${cats.map(tbl).join('') || '<p style="color:var(--muted)">No stats yet.</p>'}
      ${log.length ? `<h3 class="se-h3">Game log</h3><div class="st-scroll"><table class="stats st-table"><tr><th>Week</th><th>Opp</th><th>Result</th><th style="text-align:left">Line</th></tr>
        ${log.map((g) => `<tr><td>${esc(g.w)}</td><td>${g.ha} ${this.ui.chip(g.opp)}</td><td>${esc(g.res)}</td><td style="text-align:left">${esc(logLine(g.L))}</td></tr>`).join('')}</table></div>` : ''}`;
    body.querySelector('#pl-back').onclick = () => this.ui.closePlayer();
  }
}
