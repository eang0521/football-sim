import { fmtClock, qName } from '../sim/game.js';
import { COVERAGES, FORMATIONS } from '../sim/playbook.js';

const $ = (id) => document.getElementById(id);
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

export class Hud {
  constructor() {
    this.pbpCount = 0;
    $('pbp-toggle').addEventListener('click', () => $('pbp').classList.toggle('collapsed'));
  }

  reset(game) {
    this.game = game;
    this.pbpCount = 0;
    $('pbp-list').innerHTML = '';
    $('scorebug').classList.remove('hidden');
    for (const k of ['home', 'away']) {
      const t = game.teams[k];
      const el = $(`sb-${k}`);
      el.style.background = `linear-gradient(90deg, ${t.colors.primary}, ${shade(t.colors.primary, -25)})`;
      el.querySelector('.sb-abbr').textContent = t.abbr;
      el.style.color = readable(t.colors.primary);
    }
    this.update();
    this.syncLog();
  }

  update(displayClock) {
    const g = this.game;
    if (!g) return;
    const s = g.s;
    for (const k of ['home', 'away']) {
      const el = $(`sb-${k}`);
      el.querySelector('.sb-score').textContent = s.score[k];
      el.querySelector('.sb-to').innerHTML = [0, 1, 2].map((i) => `<i class="${i < s.timeouts[k] ? '' : 'used'}"></i>`).join('');
      el.classList.toggle('has-ball', s.poss === k && !s.final && s.phase !== 'kickoff');
    }
    $('sb-q').textContent = s.final ? 'FINAL' : qName(s.quarter);
    $('sb-time').textContent = s.final ? '' : fmtClock(displayClock ?? s.clock);
    const mo = $('momentum');
    if (mo) {
      mo.querySelector('.mo-away').style.background = g.teams.away.colors.primary;
      mo.querySelector('.mo-home').style.background = g.teams.home.colors.primary;
      mo.querySelector('i').style.left = `${50 + (g.momentum || 0) * 50}%`;
      mo.title = `Momentum: ${Math.abs(g.momentum || 0) < 0.1 ? 'even' : (g.momentum > 0 ? g.teams.home.abbr : g.teams.away.abbr)}`;
    }
    const dn = $('sb-down');
    dn.classList.remove('flag');
    if (s.final) dn.textContent = s.score.home === s.score.away ? 'TIE' : `${g.teams[s.score.home > s.score.away ? 'home' : 'away'].abbr} WIN`;
    else if (s.phase === 'kickoff') dn.textContent = 'KICKOFF';
    else if (s.phase === 'pat') dn.textContent = 'PAT';
    else {
      dn.textContent = `${g.downStr()} · ${g.fieldPos(s.poss, s.ballOn)}`;
      if (s.down === 4) dn.classList.add('flag');
    }
  }

  showCall(sim) {
    const m = sim.meta, g = this.game;
    const b = $('banner');
    b.className = '';
    const off = g.teams[m.off], def = g.teams[m.def];
    if (m.offCall && m.defCall) {
      const f = m.offCall.formation;
      const formName = `${(FORMATIONS[f]?.name || f).replace('Shotgun', 'Gun').replace(/ \(\d+\)$/, '')} (${FORMATIONS[f]?.personnel || '11'})`;
      $('banner-top').innerHTML = `<span class="o">${esc(off.abbr)}: ${esc(formName)} — ${esc(m.offCall.name)}</span><span class="vs">vs</span><span class="d">${esc(def.abbr)}: ${esc(m.defCall.name)}</span>`;
      const cov = COVERAGES[m.defCall.cov];
      const blitz = (m.defCall.blitz || []).length;
      $('banner-sub').textContent = `${m.pre.dstr} at ${m.pre.fpos}  ·  ${cov.man ? 'Man' : 'Zone'} coverage${blitz ? `, ${blitz + 4}-man pressure` : ''}`;
    } else {
      $('banner-top').innerHTML = `<span class="o">${esc(off.abbr)}</span>: ${esc(m.label)}`;
      $('banner-sub').textContent = m.type === 'fg' ? `${m.pre.fpos}` : '';
    }
  }

  showResult(sim) {
    const r = sim.result;
    const b = $('banner');
    const g = this.game;
    const entry = g.log.slice().reverse().find((e) => e.prefix);
    const flagged = sim.fouls && sim.fouls.length;
    b.className = 'result' + (r.td || r.safety || (r.good && sim.meta.type === 'fg') ? ' score' : r.turnover ? ' turnover' : flagged ? ' flag' : '');
    const text = entry && entry.label === sim.meta.label ? entry.text : r.desc;
    $('banner-top').innerHTML = (flagged ? '<span class="flagtag">FLAG</span>' : '') + esc(text);
    const T = this.game.stats.team;
    $('banner-sub').textContent = '';
  }

  hideBanner() { $('banner').classList.add('hidden'); }

  // Free-form banner (replays and highlights)
  banner(top, sub) {
    const b = $('banner');
    b.className = 'replay';
    $('banner-top').textContent = top;
    $('banner-sub').textContent = sub || '';
  }

  // Win probability next to the scorebug (computed once per play, it isn't free)
  showWP(game) {
    const el = $('wp');
    if (!el || !game) return;
    const h = game.wpHome();
    const lead = h >= 0.5 ? game.teams.home : game.teams.away;
    el.textContent = `${lead.abbr} ${Math.round(Math.max(h, 1 - h) * 100)}%`;
    el.title = `Win probability: ${game.teams.home.abbr} ${Math.round(h * 100)}% · ${game.teams.away.abbr} ${Math.round((1 - h) * 100)}%`;
  }

  syncLog() {
    const g = this.game;
    const list = $('pbp-list');
    const frag = document.createDocumentFragment();
    for (let i = this.pbpCount; i < g.log.length; i++) {
      const e = g.log[i];
      const d = document.createElement('div');
      d.className = `pbp-item ${e.type}`;
      if (e.prefix) {
        const t = g.teams[e.off];
        d.innerHTML = `<div class="meta"><span><i class="tm" style="background:${t.colors.primary}"></i>${esc(e.prefix)}</span><span>${qName(e.q)} ${fmtClock(e.clock)} · ${g.teams.away.abbr} ${e.score.away}–${e.score.home} ${g.teams.home.abbr}</span></div>` +
          `<div>${esc(e.text)}</div>` + (e.label && !/^Kickoff|^Extra|^Punt|Field Goal$/.test(e.label) ? `<div class="call">${esc(e.label)}</div>` : '');
      } else d.textContent = e.text;
      frag.prepend(d);
    }
    list.prepend(frag);
    this.pbpCount = g.log.length;
  }

  toast(msg, ms = 2400) {
    const t = $('toast');
    t.textContent = msg;
    t.classList.remove('hidden');
    clearTimeout(this._tt);
    this._tt = setTimeout(() => t.classList.add('hidden'), ms);
  }
}

export function shade(hex, pct) {
  const n = parseInt(hex.slice(1), 16);
  let r = (n >> 16) & 255, g = (n >> 8) & 255, b = n & 255;
  const f = pct / 100;
  r = Math.round(Math.min(255, Math.max(0, r + 255 * f)));
  g = Math.round(Math.min(255, Math.max(0, g + 255 * f)));
  b = Math.round(Math.min(255, Math.max(0, b + 255 * f)));
  return `#${((r << 16) | (g << 8) | b).toString(16).padStart(6, '0')}`;
}
export function readable(hex) {
  const n = parseInt(hex.slice(1), 16);
  const L = (0.299 * ((n >> 16) & 255) + 0.587 * ((n >> 8) & 255) + 0.114 * (n & 255)) / 255;
  return L > 0.62 ? '#111' : '#fff';
}

// ---------------- Box score ----------------
export function renderBoxScore(game) {
  const { home, away } = game.teams;
  const s = game.s;
  const T = game.stats.team;
  const nq = s.qScores.home.length;
  const qh = Array.from({ length: nq }, (_, i) => `<th>${i < 4 ? i + 1 : 'OT'}</th>`).join('');
  const qrow = (k) => s.qScores[k].map((v) => `<td>${v}</td>`).join('');
  const line = `<table class="linescore"><tr><th></th>${qh}<th>T</th></tr>
    <tr><td><i class="swatch" style="background:${away.colors.primary}"></i> ${esc(away.city)} ${esc(away.name)}</td>${qrow('away')}<td class="tot">${s.score.away}</td></tr>
    <tr><td><i class="swatch" style="background:${home.colors.primary}"></i> ${esc(home.city)} ${esc(home.name)}</td>${qrow('home')}<td class="tot">${s.score.home}</td></tr></table>`;
  const tsRow = (label, a, h) => `<div class="l">${a}</div><div class="m">${label}</div><div class="r">${h}</div>`;
  const top = (sec) => `${Math.floor(sec / 60)}:${String(Math.round(sec % 60)).padStart(2, '0')}`;
  const A = T.away, H = T.home;
  const teamStats = `<div class="tstats">
    ${tsRow(`<b>${away.abbr}</b>`, '', `<b>${home.abbr}</b>`).replace('<div class="l"><b>', '<div class="l"><b>')}
    ${tsRow('First downs', A.firstDowns, H.firstDowns)}
    ${tsRow('Total yards', A.totalYds, H.totalYds)}
    ${tsRow('Passing', `${A.passCmp}/${A.passAtt}, ${A.passYds}`, `${H.passCmp}/${H.passAtt}, ${H.passYds}`)}
    ${tsRow('Rushing', `${A.rushAtt}-${A.rushYds}`, `${H.rushAtt}-${H.rushYds}`)}
    ${tsRow('Sacks–yds', `${A.sacks}-${A.sackYds}`, `${H.sacks}-${H.sackYds}`)}
    ${tsRow('3rd down', `${A.thirdConv}/${A.thirdAtt}`, `${H.thirdConv}/${H.thirdAtt}`)}
    ${tsRow('4th down', `${A.fourthConv}/${A.fourthAtt}`, `${H.fourthConv}/${H.fourthAtt}`)}
    ${tsRow('Turnovers', A.turnovers, H.turnovers)}
    ${tsRow('Penalties–yds', `${A.penalties}-${A.penYds}`, `${H.penalties}-${H.penYds}`)}
    ${tsRow('Possession', top(A.top), top(H.top))}
  </div>`;
  const cols = {
    pass: [['C/ATT', (r) => `${r.cmp}/${r.att}`], ['YDS', (r) => r.yds], ['AVG', (r) => (r.att ? (r.yds / r.att).toFixed(1) : '-')], ['TD', (r) => r.td], ['INT', (r) => r.int], ['SCK', (r) => `${r.sack}-${r.sackYds}`], ['RTG', (r) => rating(r)]],
    rush: [['CAR', (r) => r.car], ['YDS', (r) => r.yds], ['AVG', (r) => (r.car ? (r.yds / r.car).toFixed(1) : '-')], ['TD', (r) => r.td], ['LNG', (r) => r.long]],
    rec: [['REC', (r) => r.rec], ['TGT', (r) => r.tgt], ['YDS', (r) => r.yds], ['AVG', (r) => (r.rec ? (r.yds / r.rec).toFixed(1) : '-')], ['TD', (r) => r.td], ['LNG', (r) => r.long]],
    def: [['TKL', (r) => r.tkl + r.ast], ['SOLO', (r) => r.tkl], ['SACK', (r) => +r.sack.toFixed(1)], ['TFL', (r) => r.tfl], ['PD', (r) => r.pd], ['INT', (r) => r.int], ['FF', (r) => r.ff]],
    kick: [['FG', (r) => `${r.fgm}/${r.fga}`], ['LNG', (r) => r.long], ['XP', (r) => `${r.xpm}/${r.xpa}`], ['KO', (r) => r.ko], ['TB', (r) => r.tb]],
    punt: [['NO', (r) => r.punts], ['YDS', (r) => r.yds], ['AVG', (r) => (r.punts ? (r.yds / r.punts).toFixed(1) : '-')], ['IN20', (r) => r.in20], ['TB', (r) => r.tb]],
    ret: [['KR', (r) => r.kr], ['KR YDS', (r) => r.kryds], ['PR', (r) => r.pr], ['PR YDS', (r) => r.pryds], ['TD', (r) => r.td]],
  };
  const names = { pass: 'Passing', rush: 'Rushing', rec: 'Receiving', def: 'Defense', kick: 'Kicking', punt: 'Punting', ret: 'Returns' };
  const table = (k, cat) => {
    let rows = game.stats.table(k, cat);
    if (cat === 'def') rows = rows.sort((a, b) => (b.tkl + b.ast) - (a.tkl + a.ast)).slice(0, 10);
    if (!rows.length) return '';
    return `<table class="stats"><tr><th>${names[cat]}</th>${cols[cat].map((c) => `<th>${c[0]}</th>`).join('')}</tr>` +
      rows.map((r) => `<tr><td>${r.num} ${esc(r.name)} <span style="color:var(--muted)">${r.pos}</span></td>${cols[cat].map((c) => `<td>${c[1](r)}</td>`).join('')}</tr>`).join('') + '</table>';
  };
  const side = (k) => {
    const t = game.teams[k];
    return `<div><div class="teamhdr"><i class="swatch" style="background:${t.colors.primary}"></i>${esc(t.city)} ${esc(t.name)}</div>` +
      ['pass', 'rush', 'rec', 'def', 'kick', 'punt', 'ret'].map((c) => `<div class="box-sec">${table(k, c)}</div>`).join('') + '</div>';
  };
  const inj = [...(game.injuries?.values() || [])];
  const order = ['QB', 'RB', 'FB', 'WR', 'TE', 'OL', 'DE', 'DT', 'LB', 'CB', 'S'];
  const snapHtml = (k) => {
    const rows = game.teams[k].roster.filter((p) => game.snaps?.get(p.id))
      .sort((a, b) => order.indexOf(a.pos) - order.indexOf(b.pos) || game.snaps.get(b.id) - game.snaps.get(a.id));
    if (!rows.length) return '';
    return `<div class="box-sec"><h3>${esc(game.teams[k].abbr)} snap counts</h3><div class="snaps">${rows.map((p) =>
      `<div><span>${p.num} ${esc(p.first[0])}. ${esc(p.last)}<span class="pos">${p.pos}</span></span><b>${game.snaps.get(p.id)}</b></div>`).join('')}</div></div>`;
  };
  const injHtml = inj.length ? `<div class="box-sec"><h3>Injuries</h3><div class="injlist">${inj.map((i) => {
    const t = game.teams[i.team];
    const back = i.returnAt !== Infinity && game.snapCount >= i.returnAt;
    return `<div><i class="swatch" style="background:${t.colors.primary}"></i> ${esc(t.abbr)} #${i.p.num} ${esc(i.p.first[0])}. ${esc(i.p.last)} (${i.p.pos}) — ${i.part}, ` +
      `<span class="${i.returnAt === Infinity ? 'out' : ''}">${back ? 'returned' : i.returnAt === Infinity ? 'out for the game' : 'out'}</span> <span style="color:var(--muted)">(Q${Math.min(i.q, 4)})</span></div>`;
  }).join('')}</div></div>` : '';
  return `${line}<div class="box-sec"><h3>Team stats</h3>${teamStats}</div>${injHtml}<div class="box-top">${side('away')}${side('home')}</div>` +
    `<div class="box-top">${snapHtml('away')}${snapHtml('home')}</div>`;
}

function rating(r) {
  if (!r.att) return '-';
  const cl = (x) => Math.max(0, Math.min(2.375, x));
  const a = cl((r.cmp / r.att - 0.3) * 5), b = cl((r.yds / r.att - 3) * 0.25), c = cl((r.td / r.att) * 20), d = cl(2.375 - (r.int / r.att) * 25);
  return (((a + b + c + d) / 6) * 100).toFixed(1);
}
