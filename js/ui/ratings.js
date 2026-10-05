// Shared views for ratings and coaching: a player ratings card (popup), a team's starting lineup
// with its team ratings, and the coaching-preferences panel (sliders + presets).
import { RATING_KEYS, RATING_LABELS, OVR_WEIGHTS, POSITIONS, depthChart, teamRatings, depthScore } from '../data/teamgen.js';
import { TRAITS } from '../data/traits.js';

const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

// ---------- player ratings ----------
const GROUPS = [
  ['Physical', ['spd', 'acc', 'agi', 'str', 'awr']],
  ['Passing', ['thp', 'tha']],
  ['Ball carrier & receiving', ['cth', 'rte', 'btk', 'car']],
  ['Blocking', ['rbk', 'pbk']],
  ['Defense', ['prs', 'rds', 'tak', 'mcv', 'zcv']],
  ['Kicking', ['kpw', 'kac']],
];
// Groups worth showing for each position (everything else is noise, e.g. a corner's kick power).
const POS_GROUPS = {
  QB: ['Physical', 'Passing', 'Ball carrier & receiving'], RB: ['Physical', 'Ball carrier & receiving', 'Blocking'],
  FB: ['Physical', 'Ball carrier & receiving', 'Blocking'], WR: ['Physical', 'Ball carrier & receiving', 'Blocking'],
  TE: ['Physical', 'Ball carrier & receiving', 'Blocking'], OL: ['Physical', 'Blocking'],
  DE: ['Physical', 'Defense'], DT: ['Physical', 'Defense'], LB: ['Physical', 'Defense'], CB: ['Physical', 'Defense'], S: ['Physical', 'Defense'],
  K: ['Kicking'], P: ['Kicking'],
};
export const keyRatings = (pos) => Object.entries(OVR_WEIGHTS[pos] || {}).sort((a, b) => b[1] - a[1]).map(([k]) => k);
export const ratingClass = (v) => (v >= 85 ? 'r-elite' : v >= 75 ? 'r-good' : v >= 62 ? 'r-ok' : 'r-low');
const bar = (k, v, key) => `<div class="rc-row${key ? ' key' : ''}" title="${esc(RATING_LABELS[k])}${key ? ' (counts toward OVR)' : ''}">
  <span>${esc(RATING_LABELS[k])}</span><i><b class="${ratingClass(v)}" style="width:${Math.max(4, (v - 20) / 79 * 100)}%"></b></i><em class="${ratingClass(v)}">${v}</em></div>`;

export function playerCardHTML(p, { team } = {}) {
  const keys = new Set(keyRatings(p.pos));
  const show = POS_GROUPS[p.pos] || GROUPS.map(([g]) => g);
  const groups = GROUPS.filter(([g]) => show.includes(g));
  const other = RATING_KEYS.filter((k) => !groups.some(([, ks]) => ks.includes(k)));
  const traits = (p.traits || []).map((t) => `<span class="trait" title="${esc(TRAITS[t]?.desc || '')}">${esc(TRAITS[t]?.name || t)}</span>`).join('');
  const ht = p.height ? `${Math.floor(p.height / 12)}'${p.height % 12}"` : '';
  return `
    <div class="rc-head">
      <div class="rc-ovr ${ratingClass(p.ovr)}">${p.ovr}<small>OVR</small></div>
      <div>
        <div class="rc-name">${esc(p.first)} ${esc(p.last)} <span class="pos">${esc(p.pos)} #${p.num}</span></div>
        <div class="rc-meta">${team ? `${esc(team.city)} ${esc(team.name)} · ` : ''}${[ht, p.weight ? `${p.weight} lb` : '', p.age ? `age ${p.age}` : '', p.college ? esc(p.college) : ''].filter(Boolean).join(' · ')}</div>
        ${p.madden ? `<div class="rc-meta">Madden ${p.madden.ovr} (${esc(p.madden.pos)})</div>` : ''}
        ${p.injury ? `<div class="rc-meta"><span class="inj-tag">${esc(p.injury.status)}</span></div>` : ''}
        ${traits ? `<div style="margin-top:4px">${traits}</div>` : ''}
      </div>
    </div>
    <div class="rc-key">Key ${esc(p.pos)} ratings: ${[...keys].map((k) => `<b class="${ratingClass(p.ratings[k])}">${k.toUpperCase()} ${p.ratings[k]}</b>`).join(' · ')}</div>
    <div class="rc-groups">
      ${groups.map(([g, ks]) => `<div><h4>${g}</h4>${ks.map((k) => bar(k, p.ratings[k], keys.has(k))).join('')}</div>`).join('')}
    </div>
    ${other.length ? `<details class="rc-more"><summary>All other ratings</summary><div class="rc-groups"><div>${other.map((k) => bar(k, p.ratings[k], false)).join('')}</div></div></details>` : ''}`;
}

// A popup card over whatever screen is open. Closes on the ×, a click outside, or Escape.
export function showPlayerCard(p, opts = {}) {
  document.querySelector('.rc-overlay')?.remove();
  const ov = document.createElement('div');
  ov.className = 'rc-overlay';
  ov.innerHTML = `<div class="rc-card" role="dialog" aria-label="Player ratings"><button class="icon-btn rc-close" title="Close">&times;</button>${playerCardHTML(p, opts)}${opts.footer || ''}</div>`;
  const close = () => { ov.remove(); document.removeEventListener('keydown', onKey, true); };
  const onKey = (e) => { if (e.key === 'Escape') { e.stopPropagation(); close(); } };
  ov.addEventListener('mousedown', (e) => { if (e.target === ov) close(); });
  ov.querySelector('.rc-close').onclick = close;
  document.addEventListener('keydown', onKey, true);
  document.body.appendChild(ov);
  opts.onOpen?.(ov.querySelector('.rc-card'), close);
  return close;
}

// Clicking any [data-card="pid"] inside root opens that player's card. find(pid) -> { p, team? }
export function bindCards(root, find) {
  root.querySelectorAll('[data-card]').forEach((el) => {
    el.addEventListener('click', (e) => {
      e.preventDefault();
      const hit = find(el.dataset.card);
      if (hit?.p) showPlayerCard(hit.p, { team: hit.team });
    });
  });
}
export const cardLink = (p, label) => `<a href="#" class="plink" data-card="${esc(p.id)}">${label ?? `${esc(p.first)} ${esc(p.last)}`}</a>`;

// ---------- team ratings ----------
export function teamRatingHTML(team) {
  const r = teamRatings(team);
  return `<div class="tr-badges"><span class="${ratingClass(r.ovr)}"><b>${r.ovr}</b>OVR</span><span class="${ratingClass(r.off)}"><b>${r.off}</b>OFF</span><span class="${ratingClass(r.def)}"><b>${r.def}</b>DEF</span></div>`;
}

const LINEUP = [['QB', 1], ['RB', 1], ['WR', 3], ['TE', 1], ['OL', 5], ['DE', 2], ['DT', 2], ['LB', 3], ['CB', 3], ['S', 2], ['K', 1], ['P', 1]];
// Starters by position (the depth chart's top players) with each one's OVR and key ratings.
export function lineupHTML(team) {
  const dc = depthChart(team);
  const cell = (p) => (p.open ? `<span class="tr-openslot" title="Not drafted yet: counted at replacement level">open ~${p.ovr}</span>`
    : `${cardLink(p, `${esc(p.first[0])}. ${esc(p.last)}`)} <b class="${ratingClass(p.ovr)}">${p.ovr}</b>`);
  return `<table class="stats tr-lineup">${LINEUP.map(([pos, n]) => {
    const list = (dc[pos] || []).slice(0, n);
    return `<tr><td>${pos}</td><td style="text-align:left">${list.map(cell).join(', ') || '<span style="color:var(--bad)">empty</span>'}</td></tr>`;
  }).join('')}</table>`;
}

// The whole roster by position, with key ratings: click a name for the full card.
export function rosterHTML(team) {
  const rows = team.roster.slice().sort((a, b) => POSITIONS.indexOf(a.pos) - POSITIONS.indexOf(b.pos) || depthScore(b) - depthScore(a));
  const ages = rows.some((p) => p.age);
  return `<div class="st-scroll"><table class="stats st-table st-players"><tr><th>Pos</th><th>Player</th>${ages ? '<th>Age</th>' : ''}<th>OVR</th><th>Key ratings</th></tr>
    ${rows.map((p) => `<tr><td>${p.pos}</td><td>${cardLink(p)}${p.traits?.length ? ' <span class="pos">★</span>' : ''}${p.injury ? ` <span class="inj-tag">${esc(p.injury.status)}</span>` : ''}</td>${ages ? `<td>${p.age ?? ''}</td>` : ''}
      <td><b class="${ratingClass(p.ovr)}">${p.ovr}</b></td><td style="color:var(--muted)">${keyRatings(p.pos).slice(0, 3).map((k) => `${k.toUpperCase()} <span class="${ratingClass(p.ratings[k])}">${p.ratings[k]}</span>`).join(' · ')}</td></tr>`).join('')}</table></div>`;
}

// Every team's ratings, best first. Rows carry data-lgteam (the caller toggles openId on click to
// show that team's starters). chip(id) renders a team label; extra(team) adds a column.
export function leagueTableHTML(teams, mine, chip, openId, extra, extraLabel) {
  const rows = teams.map((t) => ({ t, r: teamRatings(t) })).sort((a, b) => b.r.ovr - a.r.ovr || b.r.offRaw + b.r.defRaw - a.r.offRaw - a.r.defRaw);
  const c = (v) => `<td><b class="${ratingClass(v)}">${v}</b></td>`;
  const cols = 6 + (extra ? 1 : 0);
  return `<div class="st-scroll"><table class="stats st-table tr-league"><tr><th>#</th><th style="text-align:left">Team</th><th>OVR</th><th>OFF</th><th>DEF</th><th style="text-align:left">QB</th>${extra ? `<th>${extraLabel}</th>` : ''}</tr>
    ${rows.map(({ t, r }, i) => {
      const qb = depthChart(t).QB[0];
      return `<tr data-lgteam="${esc(t.id)}" class="${t.id === mine ? 'mine' : ''}${t.id === openId ? ' open' : ''}" title="Show starters"><td>${i + 1}</td><td style="text-align:left">${chip(t.id)} <span class="tname">${esc(t.name)}</span></td>${c(r.ovr)}${c(r.off)}${c(r.def)}
        <td style="text-align:left">${qb ? `${esc(qb.first[0])}. ${esc(qb.last)} <b class="${ratingClass(qb.ovr)}">${qb.ovr}</b>` : '—'}</td>${extra ? `<td>${extra(t)}</td>` : ''}</tr>
        ${t.id === openId ? `<tr class="tr-open"><td></td><td colspan="${cols - 1}">${lineupHTML(t)}</td></tr>` : ''}`;
    }).join('')}</table></div>
    <div class="dr-note">Click a team to see its starters, and a player for his full ratings.</div>`;
}

// ---------- coaching preferences ----------
// [key, label, min, max, low end, high end, what it does]
export const COACH_SLIDERS = [
  ['passRate', 'Run / pass mix', 0.3, 0.8, 'Run-heavy', 'Pass-heavy', 'How often the offense throws on neutral downs'],
  ['deepShot', 'Deep shots', 0, 1, 'Short & safe', 'Take shots', 'Appetite for vertical concepts'],
  ['playAction', 'Play action', 0, 0.8, 'Rarely', 'Often', 'Share of play-action passes'],
  ['tempo', 'Tempo', 0, 1, 'Slow', 'Hurry-up', 'Pace between plays'],
  ['aggression', '4th down & 2-pt', 0, 1, 'Conservative', 'Aggressive', 'Willingness to go for it on 4th down and try two-point conversions'],
  ['blitzRate', 'Blitz rate', 0, 0.7, 'Rush four', 'Blitz often', 'How often the defense sends extra rushers'],
  ['manRate', 'Coverage', 0, 1, 'Zone', 'Man', 'Man vs zone preference'],
  ['twoHigh', 'Safeties', 0, 1, 'Single-high', 'Two-high', 'Cover 1/3 vs Cover 2/4 shells'],
];
const OFF_KEYS = ['passRate', 'deepShot', 'playAction', 'tempo', 'runScheme'];
export const COACH_PRESETS = [
  ['Balanced', { passRate: 0.55, deepShot: 0.5, playAction: 0.35, tempo: 0.5, runScheme: 'balanced' }],
  ['Air raid', { passRate: 0.7, deepShot: 0.75, playAction: 0.15, tempo: 0.75, runScheme: 'zone' }],
  ['West Coast', { passRate: 0.6, deepShot: 0.3, playAction: 0.45, tempo: 0.5, runScheme: 'zone' }],
  ['Ground & pound', { passRate: 0.4, deepShot: 0.35, playAction: 0.55, tempo: 0.3, runScheme: 'power' }],
  ['Analytics', { aggression: 0.9 }],
  ['Old school', { aggression: 0.2 }],
  ['Attacking D', { blitzRate: 0.55, manRate: 0.7, twoHigh: 0.3 }],
  ['Bend don\'t break', { blitzRate: 0.15, manRate: 0.3, twoHigh: 0.75 }],
];

export function coachPanelHTML(coach, { editable = true, name = true } = {}) {
  const dis = editable ? '' : 'disabled';
  const slider = ([k, lab, mn, mx, lo, hi, tip]) => `<label class="cp-slider" title="${esc(tip)}">
    <span class="cp-lab">${lab}</span>
    <input type="range" data-coach="${k}" min="${mn}" max="${mx}" step="0.01" value="${coach[k]}" ${dis} />
    <span class="cp-ends"><span>${lo}</span><output>${Math.round((coach[k] - mn) / (mx - mn) * 100)}</output><span>${hi}</span></span></label>`;
  const off = COACH_SLIDERS.filter(([k]) => OFF_KEYS.includes(k));
  const def = COACH_SLIDERS.filter(([k]) => ['blitzRate', 'manRate', 'twoHigh'].includes(k));
  const mgmt = COACH_SLIDERS.filter(([k]) => k === 'aggression');
  return `<div class="cp">
    ${name ? `<label class="cp-name">Head coach<input data-coach-name value="${esc(coach.name)}" maxlength="24" ${dis} /></label>` : ''}
    ${editable ? `<div class="cp-presets"><span>Presets:</span>${COACH_PRESETS.map(([n], i) => `<button data-preset="${i}" title="${esc(Object.keys(COACH_PRESETS[i][1]).join(', '))}">${esc(n)}</button>`).join('')}</div>` : ''}
    <div class="cp-cols">
      <div><h4>Offense</h4>
        <label class="cp-slider"><span class="cp-lab">Run scheme</span><select data-coach="runScheme" ${dis}>${[['zone', 'Zone (outside & inside zone)'], ['power', 'Power (gap / man blocking)'], ['balanced', 'Balanced']].map(([v, l]) => `<option value="${v}" ${coach.runScheme === v ? 'selected' : ''}>${l}</option>`).join('')}</select></label>
        ${off.map(slider).join('')}</div>
      <div><h4>Defense</h4>${def.map(slider).join('')}<h4>Game management</h4>${mgmt.map(slider).join('')}</div>
    </div>
  </div>`;
}

// Wire up a coach panel rendered by coachPanelHTML. onSave() runs after each committed change.
export function bindCoachPanel(root, coach, onSave) {
  const panel = root.querySelector('.cp');
  if (!panel) return;
  panel.querySelector('[data-coach-name]')?.addEventListener('change', (e) => { coach.name = e.target.value.trim() || coach.name; onSave(); });
  panel.querySelectorAll('[data-coach]').forEach((i) => {
    const k = i.dataset.coach;
    i.addEventListener('input', () => {
      coach[k] = k === 'runScheme' ? i.value : +i.value;
      const o = i.parentElement.querySelector('output');
      if (o) o.textContent = Math.round((+i.value - +i.min) / (+i.max - +i.min) * 100);
    });
    i.addEventListener('change', onSave);
  });
  panel.querySelectorAll('[data-preset]').forEach((b) => b.addEventListener('click', () => {
    Object.assign(coach, COACH_PRESETS[+b.dataset.preset][1]);
    onSave();
    for (const i of panel.querySelectorAll('[data-coach]')) {
      i.value = coach[i.dataset.coach];
      i.dispatchEvent(new Event('input'));
    }
  }));
}
