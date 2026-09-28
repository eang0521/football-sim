// Box-score accumulation.
const blank = () => ({
  pass: { att: 0, cmp: 0, yds: 0, td: 0, int: 0, sack: 0, sackYds: 0 },
  rush: { car: 0, yds: 0, td: 0, long: 0 },
  rec: { tgt: 0, rec: 0, yds: 0, td: 0, long: 0 },
  def: { tkl: 0, ast: 0, sack: 0, tfl: 0, int: 0, pd: 0, ff: 0, fr: 0 },
  kick: { fga: 0, fgm: 0, long: 0, xpa: 0, xpm: 0, ko: 0, tb: 0 },
  punt: { punts: 0, yds: 0, in20: 0, tb: 0 },
  ret: { kr: 0, kryds: 0, pr: 0, pryds: 0, td: 0 },
  fum: { fum: 0, lost: 0 },
});
const teamBlank = () => ({
  firstDowns: 0, plays: 0, totalYds: 0, passYds: 0, rushYds: 0, rushAtt: 0, passAtt: 0, passCmp: 0,
  thirdAtt: 0, thirdConv: 0, fourthAtt: 0, fourthConv: 0, turnovers: 0, sacks: 0, sackYds: 0, top: 0, penalties: 0,
  redZoneAtt: 0, redZoneTD: 0,
});

export class Stats {
  constructor(home, away) {
    this.players = new Map();
    this.team = { home: teamBlank(), away: teamBlank() };
    this.pidTeam = new Map();
    for (const [k, t] of [['home', home], ['away', away]]) for (const p of t.roster) this.pidTeam.set(p.id, { key: k, p });
  }
  line(pid) {
    if (!this.players.has(pid)) this.players.set(pid, blank());
    return this.players.get(pid);
  }
  apply(events) {
    for (const e of events) {
      if (!e.pid) continue;
      const L = this.line(e.pid);
      switch (e.type) {
        case 'pass':
          L.pass.att += e.att || 0; L.pass.cmp += e.cmp || 0; L.pass.yds += e.yds || 0; L.pass.td += e.td || 0;
          L.pass.int += e.int || 0; L.pass.sack += e.sack || 0; L.pass.sackYds += e.sackYds || 0;
          break;
        case 'rush':
          L.rush.car += e.car || 0; L.rush.yds += e.yds || 0; L.rush.td += e.td || 0;
          if (e.car) L.rush.long = Math.max(L.rush.long, e.yds || 0);
          break;
        case 'rec':
          L.rec.tgt += e.tgt || 0; L.rec.rec += e.rec || 0; L.rec.yds += e.yds || 0; L.rec.td += e.td || 0;
          if (e.rec) L.rec.long = Math.max(L.rec.long, e.yds || 0);
          break;
        case 'def':
          for (const k of ['tkl', 'ast', 'sack', 'tfl', 'int', 'pd', 'ff', 'fr']) L.def[k] += e[k] || 0;
          break;
        case 'kick':
          for (const k of ['fga', 'fgm', 'xpa', 'xpm', 'ko', 'tb']) L.kick[k] += e[k] || 0;
          if (e.fgm) L.kick.long = Math.max(L.kick.long, e.long || 0);
          break;
        case 'punt':
          L.punt.punts += e.punts || 0; L.punt.yds += e.yds || 0; L.punt.in20 += e.in20 || 0; L.punt.tb += e.tb || 0;
          break;
        case 'ret':
          if (e.kr) { L.ret.kr++; L.ret.kryds += e.yds || 0; }
          if (e.pr) { L.ret.pr++; L.ret.pryds += e.yds || 0; }
          L.ret.td += e.td || 0;
          break;
        case 'fum':
          L.fum.fum += e.fum || 0; L.fum.lost += e.lost || 0;
          break;
      }
    }
  }
  // Rows for the box score UI
  table(teamKey, cat) {
    const rows = [];
    for (const [pid, L] of this.players) {
      const info = this.pidTeam.get(pid);
      if (!info || info.key !== teamKey) continue;
      const p = info.p;
      const name = `${p.first[0]}. ${p.last}`;
      const s = L[cat];
      const any = Object.values(s).some((v) => v);
      if (any) rows.push({ pid, name, num: p.num, pos: p.pos, ...s });
    }
    const key = { pass: 'att', rush: 'car', rec: 'rec', def: 'tkl', kick: 'fga', punt: 'punts', ret: 'kryds' }[cat];
    rows.sort((a, b) => (b[key] || 0) - (a[key] || 0) || (b.yds || 0) - (a.yds || 0));
    return rows;
  }
}
