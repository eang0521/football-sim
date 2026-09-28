// Game state machine: clock, downs, scoring, possession, decisions, stats.
import { RNG } from '../util/rng.js';
import { clamp } from '../util/vec.js';
import { PlaySim } from './playsim.js';
import { callOffense, callDefense } from './playcaller.js';
import { fgProbability } from './special.js';
import { Stats } from './stats.js';
import { depthChart } from '../data/teamgen.js';
import { FIELD_W, MID_Y, HASH_L, HASH_R, QUARTER_LEN, OT_LEN } from './constants.js';

const other = (k) => (k === 'home' ? 'away' : 'home');
const ORD = ['', '1st', '2nd', '3rd', '4th'];
export const fmtClock = (s) => { s = Math.max(0, Math.ceil(s)); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`; };
export const qName = (q) => (q <= 4 ? ORD[q] : q === 5 ? 'OT' : `${q - 4}OT`);

export class Game {
  constructor(home, away, opts = {}) {
    this.teams = { home, away };
    this.seed = opts.seed ?? Math.floor(Math.random() * 1e9);
    this.rng = new RNG(this.seed);
    this.qLen = opts.quarterLen ?? QUARTER_LEN;
    this.stats = new Stats(home, away);
    this.log = [];
    this.drives = [];
    const receiver = this.rng.chance(0.5) ? 'home' : 'away';
    this.s = {
      quarter: 1, clock: this.qLen, poss: receiver, ballOn: 25, ballY: MID_Y, down: 1, toGo: 10,
      score: { home: 0, away: 0 }, qScores: { home: [0, 0, 0, 0], away: [0, 0, 0, 0] },
      timeouts: { home: 3, away: 3 }, phase: 'kickoff', kicking: other(receiver), kickFrom: 35,
      openingReceiver: receiver, warned: false, final: false, ot: null,
    };
    this.lastAbs = null;
    this.addLog('info', `${this.teams[receiver].name} win the toss and will receive.`);
  }

  // ---------- helpers ----------
  dirOf(key, q = this.s.quarter) {
    const homeDir = q === 1 || q === 3 || q >= 5 ? 1 : -1;
    return key === 'home' ? homeDir : -homeDir;
  }
  fieldPos(key, ballOn) {
    const b = clamp(Math.round(ballOn), 1, 99);
    if (b === 50) return '50';
    return b < 50 ? `${this.teams[key].abbr} ${b}` : `${this.teams[other(key)].abbr} ${100 - b}`;
  }
  downStr() {
    const s = this.s;
    const tg = s.ballOn + s.toGo >= 100 ? 'Goal' : Math.max(1, Math.round(s.toGo));
    return `${ORD[s.down]} & ${tg}`;
  }
  addLog(type, text, extra = {}) {
    const s = this.s;
    this.log.push({ type, text, q: s.quarter, clock: s.clock, score: { ...s.score }, ...extra });
  }
  ctxFor(key) {
    const s = this.s;
    const diff = s.score[key] - s.score[other(key)];
    const q = s.quarter;
    const twoMin = (q === 2 && s.clock <= 120) || (q >= 4 && ((s.clock <= 150 && diff <= 0) || (s.clock <= 300 && diff < -8)));
    return {
      down: s.down, toGo: s.toGo, ballOn: s.ballOn, quarter: q, clock: s.clock, scoreDiff: diff, twoMin,
      timeouts: s.timeouts[key],
      defPrevent: false,
    };
  }
  kicker(key) { return depthChart(this.teams[key]).K[0] || depthChart(this.teams[key]).P[0]; }

  // ---------- flow ----------
  nextSim(opts = {}) {
    if (this.s.final) return null;
    this.checkQuarterEnd();
    if (this.s.final) return null;
    const s = this.s;
    const rng = this.rng;
    let cfg, meta;
    if (s.phase === 'kickoff') {
      const K = s.kicking, R = other(K);
      cfg = { kind: 'kickoff', offTeam: this.teams[K], defTeam: this.teams[R], los: s.kickFrom, ballY: MID_Y };
      meta = { type: 'kickoff', off: K, def: R, label: 'Kickoff' };
    } else if (s.phase === 'pat') {
      const off = s.poss, def = other(off);
      const two = this.goForTwo(off);
      if (two) {
        const ctx = { ...this.ctxFor(off), down: 1, toGo: 2, ballOn: 98, isConversion: true };
        const offCall = callOffense(this.teams[off], ctx, rng);
        const defCall = callDefense(this.teams[def], { ...ctx, scoreDiff: -ctx.scoreDiff }, offCall, rng);
        cfg = { kind: 'scrimmage', offTeam: this.teams[off], defTeam: this.teams[def], offCall, defCall, los: 98, ballY: MID_Y, firstDownX: 100, ctx };
        meta = { type: 'conversion', off, def, offCall, defCall, label: `2-PT: ${offCall.name} vs ${defCall.name}` };
      } else {
        cfg = { kind: 'xp', offTeam: this.teams[off], defTeam: this.teams[def], los: 85, ballY: MID_Y };
        meta = { type: 'xp', off, def, label: 'Extra Point' };
      }
    } else {
      const off = s.poss, def = other(off);
      const ctx = this.ctxFor(off);
      const defCtx = { ...ctx, scoreDiff: -ctx.scoreDiff, defPrevent: -ctx.scoreDiff > 3 && s.quarter >= 4 && s.clock < 150 };
      const decision = this.decide(off, ctx);
      const base = { offTeam: this.teams[off], defTeam: this.teams[def], los: s.ballOn, ballY: s.ballY };
      if (decision === 'punt') {
        cfg = { ...base, kind: 'punt' };
        meta = { type: 'punt', off, def, label: 'Punt' };
      } else if (decision === 'fg') {
        cfg = { ...base, kind: 'fg', ballY: clamp(s.ballY, HASH_R, HASH_L) };
        meta = { type: 'fg', off, def, label: `${Math.round(117 - s.ballOn)}-yd Field Goal` };
      } else {
        let offCall, kind = 'scrimmage';
        if (decision === 'kneel') {
          kind = 'kneel';
          offCall = { formation: 'singleback', flip: false, runDir: 1, name: 'QB Kneel',
            play: { kind: 'run', id: 'kneel', name: 'Kneel', scheme: 'sneak', aim: 0, carrierSlot: 'QB' } };
        } else offCall = callOffense(this.teams[off], ctx, rng);
        const defCall = callDefense(this.teams[def], defCtx, offCall, rng);
        const wantOOB = ctx.twoMin && ctx.scoreDiff <= 0 || (s.quarter === 2 && s.clock < 90);
        cfg = { ...base, kind, offCall, defCall, firstDownX: s.ballOn + s.toGo, ctx: { ...ctx, wantOOB, oobSide: 'O' } };
        meta = { type: kind === 'kneel' ? 'kneel' : 'scrimmage', off, def, offCall, defCall,
          label: decision === 'kneel' ? 'QB Kneel' : `${offCall.name} vs ${defCall.name}`,
          down: s.down, toGo: s.toGo, ballOn: s.ballOn, fourth: s.down === 4 };
      }
    }
    meta.dir = this.dirOf(meta.off);
    meta.pre = { down: s.down, toGo: s.toGo, ballOn: s.ballOn, clock: s.clock, quarter: s.quarter, dstr: this.downStr(), fpos: this.fieldPos(s.poss, s.ballOn) };
    cfg.rng = rng;
    cfg.skipLineup = !!opts.skipLineup;
    if (!opts.skipLineup && this.lastAbs) {
      const from = new Map();
      for (const [pid, p] of this.lastAbs) from.set(pid, this.fromAbs(p.x, p.y, meta.dir));
      cfg.from = from;
    }
    const sim = new PlaySim(cfg);
    sim.meta = meta;
    this.current = sim;
    return sim;
  }

  fromAbs(X, Y, dir) { return dir > 0 ? { x: X, y: Y } : { x: 100 - X, y: FIELD_W - Y }; }
  toAbs(x, y, dir) { return this.fromAbs(x, y, dir); }

  decide(off, ctx) {
    const s = this.s;
    const coach = this.teams[off].coach;
    const q = s.quarter, diff = ctx.scoreDiff, clock = s.clock;
    // kneel to run out the clock
    const defTO = s.timeouts[other(off)];
    if (q >= 4 && diff > 0) {
      const plays = 4 - s.down + 1;
      const burn = plays * 1.5 + (plays - 1) * 40 - Math.min(defTO, plays - 1) * 40;
      if (clock <= burn + 1) return 'kneel';
    }
    if (q === 2 && clock <= 25 && s.ballOn < 55 && diff >= 0) return 'kneel';
    const fgDist = 117 - s.ballOn;
    const pFG = fgProbability(this.kicker(off), fgDist);
    // end-of-half kicks on any down
    if (clock <= 7 && pFG > 0.2 && (q === 2 || (q >= 4 && diff <= 0 && diff >= -3))) return 'fg';
    if (s.down < 4) return 'play';
    const late = q >= 4;
    const desperate = late && ((diff < 0 && clock < 150) || (diff < -3 && clock < 330) || (diff < -8 && clock < 520) || (diff < -16 && clock < 800));
    if (desperate && !(diff >= -3 && pFG > 0.5 && clock < 60)) return 'play';
    const agg = coach.aggression;
    let go;
    if (s.toGo <= 1) go = 0.3 + agg * 0.55 + (s.ballOn >= 50 ? 0.15 : 0) - (s.ballOn < 30 ? 0.35 : 0);
    else if (s.toGo <= 3) go = agg * 0.45 * (s.ballOn >= 45 ? 1 : 0.25);
    else if (s.toGo <= 6) go = agg * 0.12;
    else go = 0.01;
    if (late && diff < 0) go += 0.15;
    if (late && diff > 0) go -= 0.2;
    go = clamp(go, 0, 0.95);
    if (pFG >= 0.45 && s.ballOn >= 55) return this.rng.chance(go * (s.toGo <= 2 ? 0.8 : 0.3)) ? 'play' : 'fg';
    if (s.ballOn >= 58) return this.rng.chance(Math.max(go, 0.2 + agg * 0.4)) ? 'play' : (pFG > 0.3 ? 'fg' : 'punt');
    return this.rng.chance(go) ? 'play' : 'punt';
  }

  goForTwo(key) {
    const s = this.s;
    const diff = s.score[key] - s.score[other(key)];
    const lateSet = new Set([-11, -10, -5, -2, 1, 5, 12]);
    if (s.quarter >= 4 && lateSet.has(diff)) return true;
    if (s.quarter >= 4 && s.clock < 120 && diff === -1) return this.rng.chance(this.teams[key].coach.aggression * 0.5);
    return this.rng.chance(0.02 + this.teams[key].coach.aggression * 0.04);
  }

  checkQuarterEnd() {
    const s = this.s;
    if (s.clock > 0 || s.phase === 'pat') return;
    const q = s.quarter;
    this.lastAbs = null;
    if (q === 1 || q === 3) {
      this.addLog('quarter', `End of ${qName(q)} quarter.`);
      s.quarter++; s.clock = this.qLen;
      if (s.quarter === 4) s.warned = false;
      return;
    }
    if (q === 2) {
      this.addLog('quarter', 'Halftime.');
      s.quarter = 3; s.clock = this.qLen; s.timeouts = { home: 3, away: 3 }; s.warned = false;
      s.phase = 'kickoff'; s.kicking = s.openingReceiver; s.kickFrom = 35;
      this.endDrive('Half');
      return;
    }
    if (q === 4 && s.score.home === s.score.away && !s.otDone) {
      this.addLog('quarter', 'End of regulation — we are headed to overtime!');
      s.quarter = 5; s.clock = Math.min(OT_LEN, this.qLen * 2 / 3); s.timeouts = { home: 2, away: 2 }; s.warned = false;
      const rec = this.rng.chance(0.5) ? 'home' : 'away';
      s.phase = 'kickoff'; s.kicking = other(rec); s.kickFrom = 35;
      s.ot = { ended: { home: 0, away: 0 } };
      s.qScores.home.push(0); s.qScores.away.push(0);
      this.addLog('info', `${this.teams[rec].name} win the overtime toss and will receive.`);
      this.endDrive('End of regulation');
      return;
    }
    this.finish();
  }

  finish() {
    const s = this.s;
    s.final = true;
    this.endDrive('End of game');
    const h = this.teams.home, a = this.teams.away;
    const w = s.score.home === s.score.away ? 'The game ends in a tie' :
      `${s.score.home > s.score.away ? h.name : a.name} win`;
    this.addLog('final', `FINAL: ${a.abbr} ${s.score.away}, ${h.abbr} ${s.score.home}. ${w}.`);
  }

  score(key, pts) {
    const s = this.s;
    s.score[key] += pts;
    const qi = Math.min(s.quarter, 5) - 1;
    s.qScores[key][qi] = (s.qScores[key][qi] || 0) + pts;
  }

  startDrive(key, ballOn) {
    const s = this.s;
    this.drive = { team: key, start: ballOn, plays: 0, yds: 0, startClock: s.clock, startQ: s.quarter, top: 0 };
  }
  endDrive(result) {
    const d = this.drive;
    if (!d) return;
    d.result = result;
    this.drives.push(d);
    this.drive = null;
    if (this.s.ot && result !== 'End of game') {
      this.s.ot.ended[d.team]++;
      const s = this.s;
      if (s.ot.ended.home >= 1 && s.ot.ended.away >= 1 && s.score.home !== s.score.away) this.pendingFinal = true;
    }
  }

  // ---------- apply a finished play ----------
  applyResult(sim) {
    const res = sim.result, meta = sim.meta, s = this.s;
    const off = meta.off, def = other(off);
    const T = this.stats.team;
    const clockBefore = s.clock;
    // record positions (absolute) for the next lineup walk
    this.lastAbs = new Map();
    for (const a of sim.agents) this.lastAbs.set(a.id, this.toAbs(a.x, a.y, meta.dir));

    const isConv = meta.type === 'conversion';
    if (!isConv) this.stats.apply(res.events);
    let elapsed = res.elapsed;
    if (meta.type === 'kickoff' && res.touchback) elapsed = 0;
    if (meta.type === 'xp' || isConv) elapsed = 0;
    s.clock = Math.max(0, s.clock - elapsed);
    T[off].top += elapsed;
    this._topOff = off;

    const prefix = meta.type === 'scrimmage' || meta.type === 'kneel' || meta.type === 'punt' || meta.type === 'fg'
      ? `${meta.pre.dstr} at ${meta.pre.fpos}` : meta.type === 'kickoff' ? 'Kickoff' : meta.type === 'xp' ? 'PAT' : '2-PT';
    let text = res.desc;
    let changed = false, scored = false;
    const newY = clamp(res.possession === 'O' ? sim.ball.y : FIELD_W - sim.ball.y, HASH_R, HASH_L);

    if (this.drive && meta.type !== 'xp' && !isConv && meta.type !== 'kickoff') this.drive.plays++;

    switch (meta.type) {
      case 'kickoff': {
        if (res.td) {
          const scorer = res.td === 'O' ? off : def;
          this.score(scorer, 6); scored = true;
          s.poss = scorer; s.phase = 'pat';
          text += ` ${this.teams[scorer].abbr} TOUCHDOWN.`;
          this.startDrive(scorer, 0); this.endDrive('TD (return)');
        } else {
          const poss = res.possession === 'D' ? def : off;
          s.poss = poss; s.ballOn = res.possession === 'D' ? 100 - res.spotX : res.spotX;
          s.down = 1; s.toGo = Math.min(10, 100 - s.ballOn); s.phase = 'scrimmage'; s.ballY = MID_Y;
          this.startDrive(poss, s.ballOn);
        }
        break;
      }
      case 'xp': {
        if (res.good) this.score(off, 1);
        s.phase = 'kickoff'; s.kicking = off; s.kickFrom = 35;
        break;
      }
      case 'conversion': {
        if (res.td === 'O') { this.score(off, 2); text = `Two-point conversion GOOD! ${text}`; }
        else if (res.td === 'D') { this.score(def, 2); text = `Defensive two-point return! ${text}`; }
        else text = `Two-point attempt fails. ${text}`;
        s.phase = 'kickoff'; s.kicking = off; s.kickFrom = 35;
        break;
      }
      case 'fg': {
        if (res.good) {
          this.score(off, 3); scored = true;
          s.phase = 'kickoff'; s.kicking = off; s.kickFrom = 35;
          this.endDrive('FG');
        } else {
          s.poss = def; s.ballOn = Math.max(20, 100 - (s.ballOn - 7)); s.down = 1; s.toGo = 10; s.ballY = MID_Y;
          changed = true;
          this.endDrive('Missed FG');
          this.startDrive(def, s.ballOn);
        }
        break;
      }
      default: { // scrimmage, kneel, punt
        const T0 = T[off];
        if (meta.type === 'scrimmage' || meta.type === 'kneel') {
          T0.plays++;
          const gain = res.td === 'O' ? Math.round(100 - s.ballOn) : res.possession === 'O' ? Math.round(res.spotX - s.ballOn) : 0;
          if (res.kind === 'pass') { T0.passAtt++; if (res.events.some((e) => e.type === 'pass' && e.cmp)) { T0.passCmp++; T0.passYds += gain; T0.totalYds += gain; } }
          else if (res.kind === 'sack') { T0.sacks++; T0.sackYds += -gain; T0.totalYds += gain; }
          else { T0.rushAtt++; T0.rushYds += gain; T0.totalYds += gain; }
          if (this.drive) this.drive.yds += gain;
          if (res.turnover) T0.turnovers++;
          if (meta.pre.down === 3) T0.thirdAtt++;
          if (meta.pre.down === 4) T0.fourthAtt++;
        }
        if (res.td) {
          const scorer = res.td === 'O' ? off : def;
          this.score(scorer, 6); scored = true;
          s.poss = scorer; s.phase = 'pat';
          if (scorer === off) {
            if (meta.pre.down === 3) T[off].thirdConv++;
            if (meta.pre.down === 4) T[off].fourthConv++;
            T[off].firstDowns++;
          }
          this.endDrive(scorer === off ? 'TD' : 'Def TD');
          if (scorer !== off) { this.startDrive(scorer, 0); this.endDrive('TD'); }
          break;
        }
        if (res.safety) {
          this.score(def, 2); scored = true;
          text += ` ${this.teams[def].abbr} +2.`;
          s.phase = 'kickoff'; s.kicking = off; s.kickFrom = 20;
          this.endDrive('Safety');
          break;
        }
        const newPoss = res.possession === 'O' ? off : def;
        const newBallOn = clamp(res.possession === 'O' ? res.spotX : 100 - res.spotX, 0.5, 99.5);
        if (newPoss === off && meta.type !== 'punt') {
          const line = s.ballOn + s.toGo;
          if (newBallOn >= line) {
            s.down = 1; s.toGo = Math.min(10, 100 - newBallOn);
            T[off].firstDowns++;
            if (meta.pre.down === 3) T[off].thirdConv++;
            if (meta.pre.down === 4) T[off].fourthConv++;
          } else {
            s.down++; s.toGo = line - newBallOn;
          }
          s.ballOn = newBallOn;
          s.ballY = res.kind === 'pass' && res.outcome === 'incomplete' ? s.ballY : newY;
          if (s.down > 4) {
            text += ` Turnover on downs.`;
            s.poss = def; s.ballOn = 100 - newBallOn; s.down = 1; s.toGo = Math.min(10, 100 - s.ballOn);
            s.ballY = FIELD_W - s.ballY; changed = true;
            this.endDrive('Downs');
            this.startDrive(def, s.ballOn);
          }
        } else {
          s.poss = newPoss; s.ballOn = newBallOn; s.down = 1; s.toGo = Math.min(10, 100 - newBallOn);
          s.ballY = newY; changed = newPoss !== off;
          if (changed) {
            this.endDrive(meta.type === 'punt' ? 'Punt' : res.kind === 'pass' && res.turnover ? 'INT' : 'Fumble');
            this.startDrive(newPoss, s.ballOn);
          }
        }
        s.phase = 'scrimmage';
      }
    }

    this.addLog(scored ? 'score' : res.turnover ? 'turnover' : 'play', text, { prefix, off, label: meta.label });

    // ----- clock management between plays -----
    const q = s.quarter;
    if ((q === 2 || q === 4) && !s.warned && clockBefore > 120 && s.clock <= 120 && s.clock > 0) {
      s.warned = true; this.addLog('info', 'Two-minute warning.');
    } else if (s.phase === 'scrimmage' && !res.clockStops && !changed && !scored && meta.type !== 'kickoff' && s.clock > 0) {
      const oobStops = res.oob && ((q === 2 && s.clock <= 120) || (q >= 4 && s.clock <= 300));
      if (!oobStops) this.runoff(res);
    }
    if (this.pendingFinal) { this.pendingFinal = false; this.finish(); }
    else if (s.ot && s.clock <= 0 && s.phase !== 'pat') this.finish();
    else if (s.ot && scored && s.phase === 'pat' && s.ot.ended.home + s.ot.ended.away >= 2 && s.score.home !== s.score.away) {
      // sudden death: TD ends it (no PAT needed)
      this.finish();
    }
    return { text, prefix };
  }

  runoff(res) {
    const s = this.s;
    const offK = s.poss, defK = other(offK);
    const ctx = this.ctxFor(offK);
    const q = s.quarter;
    let r;
    if (ctx.twoMin && (ctx.scoreDiff <= 0 || q === 2)) r = 13 + this.rng.range(0, 5);
    else if (q >= 4 && ctx.scoreDiff > 0) r = 38 + this.rng.range(0, 2);
    else r = 45 - this.teams[offK].coach.tempo * 8 + this.rng.range(-2, 2);
    if (res.oob) r *= 0.55;
    // timeouts
    const dDiff = -ctx.scoreDiff;
    if (q >= 4 && s.clock <= 150 && dDiff <= 0 && dDiff >= -16 && s.timeouts[defK] > 0 && s.clock > 5) {
      s.timeouts[defK]--; this.addLog('timeout', `Timeout ${this.teams[defK].abbr} (${s.timeouts[defK]} left).`); return;
    }
    if (((q >= 4 && ctx.scoreDiff <= 0 && ctx.scoreDiff >= -16 && s.clock <= 110) || (q === 2 && s.clock <= 40 && s.ballOn >= 40))
        && s.timeouts[offK] > 0 && s.clock > 3) {
      s.timeouts[offK]--; this.addLog('timeout', `Timeout ${this.teams[offK].abbr} (${s.timeouts[offK]} left).`); return;
    }
    if ((q === 2 || q === 4) && !s.warned && s.clock > 120 && s.clock - r <= 120) {
      s.clock = 120; s.warned = true; this.addLog('info', 'Two-minute warning.'); return;
    }
    const before = s.clock;
    s.clock = Math.max(0, s.clock - r);
    if (this._topOff) this.stats.team[this._topOff].top += before - s.clock;
  }

  // Simulate the rest of the game instantly
  simToEnd(limitQuarter = 99) {
    let n = 0;
    while (!this.s.final && n++ < 400) {
      if (this.s.quarter > limitQuarter) break;
      const sim = this.nextSim({ skipLineup: true });
      if (!sim) break;
      sim.runToEnd();
      this.applyResult(sim);
    }
  }
}
