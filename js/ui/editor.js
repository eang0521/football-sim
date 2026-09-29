import { RATING_KEYS, RATING_LABELS, POSITIONS, computeOvr, teamRatings, generateTeam, depthScore } from '../data/teamgen.js';
import { saveLeague, resetLeague, exportLeagueJSON, importLeagueJSON } from '../data/storage.js';
import { FRANCHISES } from '../data/names.js';
import { TRAITS, traitsFor } from '../data/traits.js';
import { RNG } from '../util/rng.js';

const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

const COACH_SLIDERS = [
  ['passRate', 'Pass rate', 0.3, 0.8, 'How often the offense throws on neutral downs'],
  ['aggression', '4th-down aggression', 0, 1, 'Willingness to go for it / attempt 2-pt'],
  ['deepShot', 'Deep shots', 0, 1, 'Appetite for vertical concepts'],
  ['playAction', 'Play action', 0, 0.8, 'Share of play-action passes'],
  ['tempo', 'Tempo', 0, 1, 'Pace between plays'],
  ['blitzRate', 'Blitz rate', 0, 0.7, 'How often the defense sends extra rushers'],
  ['manRate', 'Man coverage', 0, 1, 'Man vs zone preference'],
  ['twoHigh', 'Two-high shells', 0, 1, 'Cover 2/4 vs single-high preference'],
];

// One-line summary of a player's real last-season stats (imported leagues only).
function realSummary(p) {
  const r = p.real;
  if (!r) return '';
  const n = (x) => Math.round(x).toLocaleString();
  const parts = [];
  if (r.pass && r.pass.att >= 20) parts.push(`${r.pass.cmp}/${r.pass.att}, ${n(r.pass.yds)} yds, ${r.pass.td} TD, ${r.pass.int} INT`);
  if (r.rush && (r.rush.car >= 15 || p.pos === 'RB' || p.pos === 'FB')) parts.push(`${r.rush.car} car, ${n(r.rush.yds)} yds, ${r.rush.td} TD`);
  if (r.rec && (r.rec.rec >= 5 || ['WR', 'TE'].includes(p.pos))) parts.push(`${r.rec.rec} rec, ${n(r.rec.yds)} yds, ${r.rec.td} TD`);
  if (r.def && ['DE', 'DT', 'LB', 'CB', 'S'].includes(p.pos)) parts.push(`${r.def.tkl} tkl, ${r.def.sack} sk${r.def.int ? `, ${r.def.int} INT` : ''}${r.def.pd ? `, ${r.def.pd} PD` : ''}`);
  if (r.kick) parts.push(`FG ${r.kick.fgm}/${r.kick.fga}, long ${r.kick.lng}`);
  if (r.punt) parts.push(`${r.punt.punts} punts, ${r.punt.avg} avg`);
  return `${r.gp} GP${parts.length ? ' · ' + parts.join(' · ') : ''}`;
}

const NFL_FILE = 'private/nfl-league.json';

export class TeamEditor {
  constructor(root, getLeague, setLeague, onChange) {
    this.root = root;
    this.getLeague = getLeague;
    this.setLeague = setLeague;
    this.onChange = onChange;
    this.sel = 0;
    this.posFilter = 'ALL';
    // The NFL league file only exists where tools/import-nfl.mjs was run (never on the public site).
    this.nflAvailable = false;
    fetch(NFL_FILE, { method: 'HEAD', cache: 'no-store' })
      .then((r) => { this.nflAvailable = r.ok; if (r.ok && this.root.innerHTML) this.render(); })
      .catch(() => {});
  }

  render() {
    const lg = this.getLeague();
    const t = lg.teams[this.sel];
    const tr = teamRatings(t);
    const roster = t.roster
      .filter((p) => this.posFilter === 'ALL' || p.pos === this.posFilter)
      .sort((a, b) => POSITIONS.indexOf(a.pos) - POSITIONS.indexOf(b.pos) || depthScore(b) - depthScore(a));
    const real = lg.teams.some((x) => x.roster.some((p) => p.real));
    const realSeason = real && t.roster.find((p) => p.real)?.real.season;
    this.root.innerHTML = `
      <p style="color:var(--muted);font-size:13px;margin:0 0 12px">Edits are saved in this browser and apply to new games. Ratings are 20–99; OVR updates automatically. The depth chart is ordered by OVR at each position${lg.source ? ' (imported players keep their source ranking)' : ''}.</p>
      ${lg.label ? `<p style="font-size:12.5px;margin:-6px 0 12px;color:var(--accent)">League: ${esc(lg.label)}${lg.built ? ` · built ${esc(lg.built)}` : ''}</p>` : ''}
      <div class="ed-layout">
        <div class="ed-teams">
          ${lg.teams.map((tm, i) => `<button data-team="${i}" class="${i === this.sel ? 'on' : ''}"><i class="swatch" style="background:${tm.colors.primary}"></i>${esc(tm.abbr)} ${esc(tm.name)}</button>`).join('')}
          <div class="ed-actions" style="flex-direction:column">
            <button id="ed-regen">Regenerate this team</button>
            ${this.nflAvailable ? '<button id="ed-nfl" title="Load private/nfl-league.json, built by tools/import-nfl.mjs">Load NFL league</button>' : ''}
            <button id="ed-export">Export league JSON</button>
            <label class="tog" style="justify-content:center"><input type="file" id="ed-import" accept="application/json" style="display:none" /><span class="fakebtn" style="padding:7px 11px;border:1px solid rgba(255,255,255,.1);border-radius:7px;background:#1b2638;color:var(--text);font-weight:600;cursor:pointer">Import league JSON</span></label>
            <button id="ed-reset" style="color:var(--bad)">Reset entire league</button>
          </div>
        </div>
        <div>
          <div class="ed-form">
            <label>City<input data-f="city" value="${esc(t.city)}" maxlength="20" /></label>
            <label>Name<input data-f="name" value="${esc(t.name)}" maxlength="20" /></label>
            <label>Abbreviation<input data-f="abbr" value="${esc(t.abbr)}" maxlength="4" /></label>
            <label>Primary<input type="color" data-c="primary" value="${t.colors.primary}" /></label>
            <label>Secondary<input type="color" data-c="secondary" value="${t.colors.secondary}" /></label>
            <label>Helmet<input type="color" data-c="helmet" value="${t.colors.helmet}" /></label>
            <label>Pants<input type="color" data-c="pants" value="${t.colors.pants}" /></label>
            <label>Team OVR<div style="font:800 24px var(--cond);color:var(--accent)">${tr.ovr} <span style="font-size:14px;color:var(--muted)">OFF ${tr.off} · DEF ${tr.def}</span></div></label>
          </div>
          <div class="ed-coach">
            <label>Head coach<input data-coach-name value="${esc(t.coach.name)}" maxlength="24" style="background:#1b2638;color:var(--text);border:1px solid rgba(255,255,255,.1);border-radius:6px;padding:5px 7px" /></label>
            <label>Run scheme<select data-coach="runScheme">${['zone', 'power', 'balanced'].map((s) => `<option ${t.coach.runScheme === s ? 'selected' : ''}>${s}</option>`).join('')}</select></label>
            ${COACH_SLIDERS.map(([k, lab, mn, mx, tip]) => `<label title="${tip}">${lab} <output>${Math.round(t.coach[k] * 100)}</output><input type="range" data-coach="${k}" min="${mn}" max="${mx}" step="0.01" value="${t.coach[k]}" /></label>`).join('')}
          </div>
          <div class="pos-filter">${['ALL', ...POSITIONS].map((p) => `<button data-pos="${p}" class="${p === this.posFilter ? 'on' : ''}">${p}</button>`).join('')}</div>
          <div class="ed-roster"><table>
            <tr><th>#</th><th>First</th><th>Last</th><th>Pos</th><th>Ht</th><th>Wt</th><th>OVR</th><th>Traits</th>${real ? `<th>${realSeason || ''} stats</th>` : ''}${RATING_KEYS.map((k) => `<th title="${RATING_LABELS[k]}">${k.toUpperCase()}</th>`).join('')}</tr>
            ${roster.map((p) => `<tr data-pid="${p.id}">
              <td><input data-p="num" value="${p.num}" type="number" min="0" max="99" /></td>
              <td><input class="nm" data-p="first" value="${esc(p.first)}" /></td>
              <td><input class="nm" data-p="last" value="${esc(p.last)}" /></td>
              <td><select data-p="pos">${POSITIONS.map((x) => `<option ${x === p.pos ? 'selected' : ''}>${x}</option>`).join('')}</select></td>
              <td><input data-p="height" value="${p.height}" type="number" min="64" max="84" title="inches" /></td>
              <td><input data-p="weight" value="${p.weight}" type="number" min="150" max="380" /></td>
              <td class="ovr">${p.ovr}</td>
              <td style="white-space:nowrap">${[0, 1].map((i) => `<select class="tr" data-t="${i}" title="${esc(TRAITS[(p.traits || [])[i]]?.desc || 'No trait')}"><option value="">—</option>${traitsFor(p.pos).map((k) => `<option value="${k}" ${(p.traits || [])[i] === k ? 'selected' : ''}>${TRAITS[k].name}</option>`).join('')}</select>`).join('')}</td>
              ${real ? `<td class="real" title="${esc(p.real ? `${p.real.season} with ${p.real.team}${p.madden ? ` · Madden OVR ${p.madden.ovr} (${p.madden.pos})` : ''}` : p.madden ? `No ${realSeason} stats · Madden OVR ${p.madden.ovr} (${p.madden.pos})` : '')}">${esc(realSummary(p)) || '<span style="color:var(--muted)">—</span>'}</td>` : ''}
              ${RATING_KEYS.map((k) => `<td><input data-r="${k}" value="${p.ratings[k]}" type="number" min="20" max="99" /></td>`).join('')}
            </tr>`).join('')}
          </table></div>
        </div>
      </div>`;
    this.bind(t);
  }

  bind(t) {
    const R = this.root;
    const save = () => { saveLeague(this.getLeague()); this.onChange?.(); };
    R.querySelectorAll('[data-team]').forEach((b) => b.addEventListener('click', () => { this.sel = +b.dataset.team; this.render(); }));
    R.querySelectorAll('[data-pos]').forEach((b) => b.addEventListener('click', () => { this.posFilter = b.dataset.pos; this.render(); }));
    R.querySelectorAll('[data-f]').forEach((i) => i.addEventListener('change', () => {
      let v = i.value.trim();
      if (i.dataset.f === 'abbr') v = v.toUpperCase();
      if (v) t[i.dataset.f] = v;
      save(); this.render();
    }));
    R.querySelectorAll('[data-c]').forEach((i) => i.addEventListener('change', () => { t.colors[i.dataset.c] = i.value; save(); this.render(); }));
    R.querySelector('[data-coach-name]').addEventListener('change', (e) => { t.coach.name = e.target.value.trim() || t.coach.name; save(); });
    R.querySelectorAll('[data-coach]').forEach((i) => i.addEventListener('input', () => {
      const k = i.dataset.coach;
      t.coach[k] = k === 'runScheme' ? i.value : +i.value;
      const o = i.parentElement.querySelector('output');
      if (o) o.textContent = Math.round(+i.value * 100);
    }));
    R.querySelectorAll('[data-coach]').forEach((i) => i.addEventListener('change', save));
    R.querySelectorAll('tr[data-pid]').forEach((row) => {
      const p = t.roster.find((x) => x.id === row.dataset.pid);
      row.querySelectorAll('[data-p]').forEach((i) => i.addEventListener('change', () => {
        const k = i.dataset.p;
        if (k === 'first' || k === 'last' || k === 'pos') p[k] = i.value.trim() || p[k];
        else p[k] = Math.round(+i.value) || p[k];
        p.ovr = computeOvr(p);
        row.querySelector('.ovr').textContent = p.ovr;
        save();
      }));
      row.querySelectorAll('[data-t]').forEach((i) => i.addEventListener('change', () => {
        const tr = [...(p.traits || [])];
        tr[+i.dataset.t] = i.value;
        p.traits = [...new Set(tr.filter(Boolean))];
        i.title = TRAITS[i.value]?.desc || 'No trait';
        save();
      }));
      row.querySelectorAll('[data-r]').forEach((i) => i.addEventListener('change', () => {
        const v = Math.max(20, Math.min(99, Math.round(+i.value) || 50));
        i.value = v;
        p.ratings[i.dataset.r] = v;
        p.ovr = computeOvr(p);
        row.querySelector('.ovr').textContent = p.ovr;
        save();
      }));
    });
    R.querySelector('#ed-regen').addEventListener('click', () => {
      if (!confirm(`Regenerate the ${t.name} roster and coach? This replaces all of its players.`)) return;
      const lg = this.getLeague();
      const fr = FRANCHISES.find((f) => f[2] === t.id) || FRANCHISES[this.sel % FRANCHISES.length];
      const nt = generateTeam(new RNG(Date.now()), fr, this.sel, 0);
      nt.city = t.city; nt.name = t.name; nt.abbr = t.abbr; nt.colors = t.colors; nt.id = t.id;
      lg.teams[this.sel] = nt;
      save(); this.render();
    });
    R.querySelector('#ed-nfl')?.addEventListener('click', async () => {
      if (!confirm('Replace the current league with the NFL league? Edits to the current league will be lost (export it first to keep them).')) return;
      try {
        const res = await fetch(NFL_FILE, { cache: 'no-store' });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const lg = importLeagueJSON(await res.text());
        this.setLeague(lg); saveLeague(lg); this.sel = 0; this.posFilter = 'ALL'; this.render(); this.onChange?.();
      } catch (e) { alert('Could not load the NFL league: ' + e.message); }
    });
    R.querySelector('#ed-export').addEventListener('click', () => {
      const blob = new Blob([exportLeagueJSON(this.getLeague())], { type: 'application/json' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = 'gridiron-league.json';
      a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 1000);
    });
    const imp = R.querySelector('#ed-import');
    R.querySelector('.fakebtn').addEventListener('click', () => imp.click());
    imp.addEventListener('change', async () => {
      const f = imp.files[0];
      if (!f) return;
      try {
        const lg = importLeagueJSON(await f.text());
        this.setLeague(lg); saveLeague(lg); this.sel = 0; this.render(); this.onChange?.();
      } catch (e) { alert('Could not import: ' + e.message); }
    });
    R.querySelector('#ed-reset').addEventListener('click', () => {
      if (!confirm('Generate a brand-new league? All edits will be lost.')) return;
      const lg = resetLeague();
      this.setLeague(lg); this.sel = 0; this.render(); this.onChange?.();
    });
  }
}
