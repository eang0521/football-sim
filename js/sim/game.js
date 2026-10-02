// Game state machine: clock, downs, scoring, possession, decisions, stats.
import { RNG } from '../util/rng.js';
import { clamp } from '../util/vec.js';
import { PlaySim } from './playsim.js';
import { callOffense, callDefense } from './playcaller.js';
import { FORMATIONS } from './playbook.js';
import { winProb, conversionProb } from './winprob.js';
import { finishRecording } from './replay.js';
import { fgProbability } from './special.js';
import { Stats } from './stats.js';
import { depthChart, teamRatings } from '../data/teamgen.js';
import { FOULS, rollPreSnap, enforce, stateValue, describeFoul } from './penalties.js';
import { makeWeather, describeWeather, effectiveKickDist } from './weather.js';
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
    this.scoring = []; // scoring recap: { team, pts, q, clock, text, score, pat?, drive? }
    const receiver = this.rng.chance(0.5) ? 'home' : 'away';
    this.s = {
      quarter: 1, clock: this.qLen, poss: receiver, ballOn: 25, ballY: MID_Y, down: 1, toGo: 10,
      score: { home: 0, away: 0 }, qScores: { home: [0, 0, 0, 0], away: [0, 0, 0, 0] },
      timeouts: { home: 3, away: 3 }, phase: 'kickoff', kicking: other(receiver), kickFrom: 35,
      openingReceiver: receiver, warned: false, final: false, ot: null,
    };
    this.lastAbs = null;
    this.injuries = new Map(); // pid -> { team, p, part, status, returnAt, returned }
    this.snapCount = 0;
    this.energy = new Map();   // pid -> 0..1 (fatigue)
    this.snaps = new Map();    // pid -> snaps played on offense/defense
    for (const t of [home, away]) for (const p of t.roster) this.energy.set(p.id, 1);
    this.momentum = 0;         // -1 (away) .. +1 (home)
    this.weather = makeWeather(opts.weather || 'random', this.rng, { home: this.teams.home, date: opts.date ? new Date(opts.date) : new Date() });
    const blankT = () => ({ run: { n: 0, s: 0 }, pass: { n: 0, s: 0 }, concept: {}, form: {} });
    this.tend = { home: blankT(), away: blankT() };  // in-game success by play type / concept
    this.challenges = { home: 2, away: 2 };
    this.preOut = opts.out || new Set(); // players already hurt coming into the game (season mode)
    this.noTie = !!opts.noTie;           // playoff games keep playing overtime periods
    this.addLog('info', `Weather: ${describeWeather(this.weather)}.`);
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
    // last snap of a half from beyond field-goal range: throw it up
    const hail = s.clock <= 8 && s.ballOn >= 38 && s.ballOn < 75 && (q === 2 || (q === 4 && diff < 0 && diff >= -8));
    return {
      down: s.down, toGo: s.toGo, ballOn: s.ballOn, quarter: q, clock: s.clock, scoreDiff: diff, twoMin,
      timeouts: s.timeouts[key],
      defPrevent: false, hail,
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
      const diffK = s.score[K] - s.score[R];
      let kickType = 'normal';
      if (s.kickFrom === 35 && ((s.quarter >= 4 && diffK < 0 && diffK >= -16 && s.clock <= 180) || (s.quarter >= 4 && diffK <= -9 && diffK >= -16 && s.clock <= 330))) kickType = 'onside';
      else if (s.kickFrom === 35 && s.quarter >= 4 && diffK < 0 && rng.chance(0.004)) kickType = 'onside';
      else if ((s.quarter === 2 || s.quarter >= 4) && s.clock <= 22 && diffK >= 0) kickType = 'squib';
      cfg = { kind: 'kickoff', offTeam: this.teams[K], defTeam: this.teams[R], los: s.kickFrom, ballY: MID_Y, kickType };
      meta = { type: 'kickoff', off: K, def: R, label: kickType === 'onside' ? 'Onside Kick' : kickType === 'squib' ? 'Squib Kick' : 'Kickoff' };
    } else if (s.phase === 'pat') {
      const off = s.poss, def = other(off);
      const two = this.goForTwo(off);
      if (two) {
        const ctx = { ...this.ctxFor(off), down: 1, toGo: 2, ballOn: 98, isConversion: true };
        const offCall = callOffense(this.teams[off], ctx, rng, this.adapt(off));
        const defCall = callDefense(this.teams[def], { ...ctx, scoreDiff: -ctx.scoreDiff }, offCall, rng, this.oppTend(off));
        cfg = { kind: 'scrimmage', offTeam: this.teams[off], defTeam: this.teams[def], offCall, defCall, los: 98, ballY: MID_Y, firstDownX: 100, ctx };
        meta = { type: 'conversion', off, def, offCall, defCall, label: `2-PT: ${offCall.name} vs ${defCall.name}` };
      } else {
        cfg = { kind: 'xp', offTeam: this.teams[off], defTeam: this.teams[def], los: 85, ballY: MID_Y };
        meta = { type: 'xp', off, def, label: 'Extra Point' };
      }
    } else {
      const off = s.poss, def = other(off);
      const ctx = this.ctxFor(off);
      const defCtx = { ...ctx, scoreDiff: -ctx.scoreDiff, defPrevent: ctx.hail || (-ctx.scoreDiff > 3 && s.quarter >= 4 && s.clock < 150) };
      const decision = this.decide(off, ctx);
      const base = { offTeam: this.teams[off], defTeam: this.teams[def], los: s.ballOn, ballY: s.ballY };
      const aggr = this.teams[off].coach.aggression;
      const fakeOK = s.toGo <= 3 && !(s.quarter >= 4 && ctx.scoreDiff > 0);
      if (decision === 'punt') {
        const fake = fakeOK && s.ballOn >= 25 && s.ballOn <= 60 && rng.chance(aggr * 0.09);
        cfg = { ...base, kind: 'punt', fake };
        meta = { type: 'punt', off, def, label: 'Punt', down: s.down, fake };
      } else if (decision === 'fg') {
        const fake = fakeOK && s.clock > 30 && rng.chance(aggr * 0.05);
        cfg = { ...base, kind: 'fg', ballY: clamp(s.ballY, HASH_R, HASH_L), fake };
        meta = { type: 'fg', off, def, label: `${Math.round(117 - s.ballOn)}-yd Field Goal`, fake };
      } else {
        let offCall, kind = 'scrimmage';
        const special = decision === 'kneel' || decision === 'spike' || decision === 'safety';
        if (special) {
          kind = 'kneel';
          const nm = decision === 'spike' ? 'Spike' : decision === 'safety' ? 'Intentional Safety' : s.quarter >= 4 ? 'Victory Formation' : 'QB Kneel';
          offCall = { formation: decision === 'spike' ? 'gun_doubles' : 'singleback', flip: false, runDir: 1, name: nm,
            play: { kind: 'run', id: 'kneel', name: nm, scheme: 'sneak', aim: 0, carrierSlot: 'QB' } };
        } else offCall = callOffense(this.teams[off], ctx, rng, this.adapt(off));
        const defCall = callDefense(this.teams[def], defCtx, offCall, rng, this.oppTend(off));
        if (!special) offCall = this.maybeAudible(off, ctx, offCall, defCall) || offCall;
        const wantOOB = ctx.twoMin && ctx.scoreDiff <= 0 || (s.quarter === 2 && s.clock < 90);
        cfg = { ...base, kind, offCall, defCall, firstDownX: s.ballOn + s.toGo, ctx: { ...ctx, wantOOB, oobSide: 'O' },
          spike: decision === 'spike', intSafety: decision === 'safety' };
        meta = { type: kind === 'kneel' ? 'kneel' : 'scrimmage', off, def, offCall, defCall,
          label: special ? offCall.name : `${FORMATIONS[offCall.formation].name.replace(/ \(\d+\)$/, '')} (${FORMATIONS[offCall.formation].personnel}): ${offCall.name}${offCall.motion ? ' (motion)' : ''} vs ${defCall.name}`,
          down: s.down, toGo: s.toGo, ballOn: s.ballOn, fourth: s.down === 4 };
      }
    }
    meta.dir = this.dirOf(meta.off);
    cfg.energy = this.energy;
    cfg.record = !!this.recording;
    if (this.recording) meta.wp0 = this.wpHome();
    cfg.weather = this.weather;
    cfg.dir = meta.dir;
    cfg.mod = (p, side) => this.ratingMod(p, side === 'O' ? meta.off : meta.def);
    // injured players sit; players whose injury window has passed return
    cfg.unavailable = new Set(this.preOut);
    for (const [pid, inj] of this.injuries) {
      if (inj.returnAt > this.snapCount) cfg.unavailable.add(pid);
      else if (!inj.returned) {
        inj.returned = true;
        this.addLog('injury', `${this.teams[inj.team].abbr} #${inj.p.num} ${inj.p.first[0]}.${inj.p.last} (${inj.part}) returns to the game.`);
      }
    }
    if (cfg.kind === 'scrimmage' && meta.type === 'scrimmage') {
      cfg.preSnap = rollPreSnap(rng, cfg.offTeam, cfg.defTeam, meta.off === 'away', cfg.ctx);
    }
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
    if (s.spikeNext) { s.spikeNext = false; if (s.down < 4 && clock > 2) return 'spike'; }
    // protect a late lead by conceding two points instead of punting from the end zone
    if (q >= 4 && s.down === 4 && s.ballOn <= 6 && diff >= 3 && clock <= 45) return 'safety';
    if (q >= 4 && diff > 0) {
      const plays = 4 - s.down + 1;
      const burn = plays * 1.5 + (plays - 1) * 40 - Math.min(defTO, plays - 1) * 40;
      if (clock <= burn + 1) return 'kneel';
    }
    if (q === 2 && clock <= 25 && !ctx.hail && (s.ballOn < 45 || (clock <= 8 && s.ballOn < 55)) && (diff >= 0 || s.ballOn < 35)) return 'kneel';
    const fgDist = 117 - s.ballOn;
    const pFG = Math.max(0, fgProbability(this.kicker(off), effectiveKickDist(this.weather, fgDist, this.dirOf(off))) - this.weather.fgPen);
    // end-of-half kicks on any down
    if (clock <= 7 && pFG > 0.2 && (q === 2 || (q >= 4 && diff <= 0 && diff >= -3))) return 'fg';
    if (s.down < 4) return 'play';
    const late = q >= 4;
    const desperate = late && ((diff < 0 && clock < 150) || (diff < -3 && clock < 330) || (diff < -8 && clock < 520) || (diff < -16 && clock < 800));
    if (desperate && !(diff >= -3 && pFG > 0.5 && clock < 60)) return 'play';
    // 4th down: compare win probability after going for it, kicking, and punting.
    const W = this.fourthDownWP(off, pFG);
    const agg = coach.aggression;
    // Coaches still lean conservative: going for it needs a clear edge in win probability,
    // a smaller one for aggressive coaches. Otherwise kick or punt, whichever is better.
    const kick = W.fg != null && W.fg >= W.punt ? 'fg' : 'punt';
    const kickWP = kick === 'fg' ? W.fg : W.punt;
    const need = 0.03 - agg * 0.025 + this.rng.normal(0, 0.004);
    const pick = desperate || W.go - kickWP > need ? 'play' : kick;
    if (pick === 'play' && !desperate) {
      const alt = W.fg != null && W.fg >= W.punt ? ['a field goal', W.fg] : ['a punt', W.punt];
      const pc = (x) => `${Math.round(x * 100)}%`;
      this.addLog('info', `${this.teams[off].name} keep the offense on the field on 4th & ${s.toGo}: win probability ${pc(W.go)} going for it vs ${pc(alt[1])} with ${alt[0]}.`);
    }
    return pick;
  }

  secsLeft() {
    const s = this.s;
    return s.quarter <= 4 ? s.clock + (4 - s.quarter) * this.qLen : s.clock;
  }

  // Win probability for the offense, from the offense's point of view, after a score / change of possession.
  wpAfterPossessionChange(off, diff, oppBallOn, secs) {
    const def = other(off), s = this.s;
    return 1 - winProb({ diff: -diff, secs, ballOn: oppBallOn, toOff: s.timeouts[def], toDef: s.timeouts[off] });
  }

  fourthDownWP(off, pFG) {
    const s = this.s, def = other(off);
    const diff = s.score[off] - s.score[def];
    const secs = Math.max(0, this.secsLeft() - 6);
    const tr = (k) => teamRatings(this.teams[k]);
    const edge = clamp((tr(off).offRaw - tr(def).defRaw) * 0.008, -0.08, 0.08);
    const pConv = clamp(conversionProb(s.toGo, s.ballOn) + edge, 0.1, 0.85);
    const goal = s.ballOn + s.toGo >= 100;
    const wpSucc = goal ? this.wpAfterPossessionChange(off, diff + 7, 30, secs)
      : winProb({ diff, secs, ballOn: Math.min(99, s.ballOn + s.toGo + 1.5), down: 1, toGo: 10, toOff: s.timeouts[off], toDef: s.timeouts[def] });
    const wpFail = this.wpAfterPossessionChange(off, diff, 100 - s.ballOn, secs);
    const go = pConv * wpSucc + (1 - pConv) * wpFail;
    let fg = null;
    if (pFG > 0.05) fg = pFG * this.wpAfterPossessionChange(off, diff + 3, 30, secs) + (1 - pFG) * this.wpAfterPossessionChange(off, diff, Math.max(20, 107 - s.ballOn), secs);
    const land = s.ballOn + 42;
    const oppAt = land >= 100 ? 20 : land > 92 ? 12 : 100 - land;
    const punt = this.wpAfterPossessionChange(off, diff, oppAt, secs);
    return { go, fg, punt, pConv };
  }

  // Two-point decision by win probability (after the try, the other team gets a kickoff).
  goForTwo(key) {
    const s = this.s;
    const diff = s.score[key] - s.score[other(key)];
    const secs = Math.max(0, this.secsLeft() - 5);
    const wp = (d) => this.wpAfterPossessionChange(key, d, 30, secs);
    const p2 = 0.48, p1 = 0.95;
    const two = p2 * wp(diff + 2) + (1 - p2) * wp(diff);
    const one = p1 * wp(diff + 1) + (1 - p1) * wp(diff);
    const agg = this.teams[key].coach.aggression;
    if (two - one > 0.009 - (agg - 0.5) * 0.01 + (secs > 900 ? 0.01 : 0)) return true;
    // early in games the numbers are close to even; a few aggressive coaches still go
    return secs > 1200 && this.rng.chance(0.01 + agg * 0.03);
  }

  checkQuarterEnd() {
    const s = this.s;
    if (s.clock > 0 || s.phase === 'pat') return;
    const q = s.quarter;
    this.lastAbs = null;
    if (q === 1 || q === 3) {
      this.addLog('quarter', `End of ${qName(q)} quarter.`);
      s.quarter++; s.clock = this.qLen;
      for (const [k, e] of this.energy) this.energy.set(k, Math.min(1, e + 0.08)); // quarter break
      if (s.quarter === 4) s.warned = false;
      return;
    }
    if (q === 2) {
      this.addLog('quarter', 'Halftime.');
      this.halftimeAdjustments();
      s.quarter = 3; s.clock = this.qLen; s.timeouts = { home: 3, away: 3 }; s.warned = false;
      for (const k of this.energy.keys()) this.energy.set(k, 1); // halftime
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
    if (q >= 5 && this.noTie && s.score.home === s.score.away) {
      this.addLog('quarter', `End of ${qName(q)} — still tied. Another overtime period.`);
      s.quarter++; s.clock = Math.min(OT_LEN, this.qLen * 2 / 3); s.warned = false;
      s.qScores.home.push(0); s.qScores.away.push(0);
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
    if (s.phase === 'pat' && pts < 6) return; // PATs are attached to their touchdown after the play
    this.scoring.push({ team: key, pts, q: s.quarter, clock: s.clock, score: { ...s.score } });
  }

  // Fill in the scoring recap for this play: the play text and drive summary, or the PAT result on the TD.
  recordScoring(meta, text, nScoring, nDrives) {
    const s = this.s;
    if (meta.type === 'xp' || meta.type === 'conversion') {
      const td = this.scoring.findLast((e) => e.pts === 6);
      if (!td || td.pat) return;
      const tag = meta.type === 'xp' ? (s.score[td.team] > td.score[td.team] ? 'PAT good' : 'PAT no good')
        : s.score[td.team] > td.score[td.team] ? 'Two-point conversion good' : 'Two-point conversion failed';
      td.pat = tag;
      if (s.score[other(td.team)] > td.score[other(td.team)]) { // defensive 2-point return: its own entry
        this.scoring.push({ team: other(td.team), pts: 2, q: s.quarter, clock: s.clock, text: 'Defensive two-point return.', def2: true, score: { ...s.score } });
      }
      td.score = { ...s.score };
      return;
    }
    const drive = this.drives.slice(nDrives).find((d) => d.result === 'TD' || d.result === 'FG');
    for (const e of this.scoring.slice(nScoring)) {
      e.text = text;
      if (drive && drive.team === e.team && drive.plays > 0) {
        const secs = (drive.startQ === e.q ? drive.startClock - e.clock : drive.startClock + (e.q - drive.startQ - 1) * this.qLen + (this.qLen - e.clock));
        e.drive = { plays: drive.plays, yds: Math.round(drive.yds), secs: Math.max(0, Math.round(secs)) };
      }
    }
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
  // Home team's win probability in the current state (used for highlights and the scorebug).
  wpHome() {
    const s = this.s;
    if (s.final) return s.score.home > s.score.away ? 1 : s.score.home < s.score.away ? 0 : 0.5;
    const secs = this.secsLeft();
    let poss = s.poss, diff, st;
    if (s.phase === 'kickoff') { poss = other(s.kicking); st = { ballOn: 30 }; }
    else if (s.phase === 'pat') st = { ballOn: null };
    else st = { ballOn: s.ballOn, down: s.down, toGo: s.toGo };
    diff = s.score[poss] - s.score[other(poss)] + (s.phase === 'pat' ? 1 : 0);
    let wp;
    if (s.phase === 'pat') wp = 1 - winProb({ diff: -diff, secs, ballOn: 30, toOff: s.timeouts[other(poss)], toDef: s.timeouts[poss] });
    else wp = winProb({ diff, secs, ...st, toOff: s.timeouts[poss], toDef: s.timeouts[other(poss)] });
    return poss === 'home' ? wp : 1 - wp;
  }

  applyResult(sim) {
    const out = this.applyResultCore(sim);
    if (sim.rec && sim.meta.wp0 != null) this.noteHighlight(sim);
    return out;
  }

  // Keep the last few plays for instant replay and the biggest plays of the game for a highlights reel.
  noteHighlight(sim) {
    const wp1 = this.wpHome();
    const res = sim.result || {};
    const swing = Math.abs(wp1 - sim.meta.wp0);
    const last = this.log[this.log.length - 1];
    const gain = res.possession === 'O' && res.spotX != null && sim.meta.pre ? res.spotX - sim.meta.pre.ballOn : 0;
    const score = swing + (res.td ? 0.08 : 0) + (res.turnover ? 0.06 : 0) + (gain >= 25 ? 0.04 : 0) + (res.kind === 'sack' ? 0.01 : 0);
    const rec = finishRecording(sim, { desc: last?.text || '', prefix: last?.prefix || '', q: this.s.quarter, clock: this.s.clock, score, wp0: sim.meta.wp0, wp1 });
    sim.rec = null;
    if (!rec) return;
    this.replays = [...(this.replays || []), rec].slice(-3);
    const H = (this.highlights ||= []);
    if (sim.meta.type !== 'kneel' && score >= 0.03) {
      H.push(rec);
      H.sort((a, b) => b.score - a.score);
      if (H.length > 10) H.length = 10;
    }
  }

  applyResultCore(sim) {
    const res = sim.result, meta = sim.meta, s = this.s;
    const off = meta.off, def = other(off);
    const T = this.stats.team;
    const clockBefore = s.clock;
    // record positions (absolute) for the next lineup walk
    this.lastAbs = new Map();
    for (const a of sim.agents) this.lastAbs.set(a.id, this.toAbs(a.x, a.y, meta.dir));

    const isConv = meta.type === 'conversion';
    this.snapCount++;
    this.updateFatigue(sim);
    const injuryLogs = this.processInjuries(sim);
    const reviewLogs = this.reviewPlay(sim);
    const pen = isConv ? { mode: 'none' } : this.resolveFouls(sim);
    if (pen.mode !== 'nullify') this.learn(sim);
    if (!isConv && pen.mode !== 'nullify') this.stats.apply(res.events);
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
    const nScoring = this.scoring.length, nDrives = this.drives.length;
    if (pen.mode === 'nullify') {
      s.ballOn = pen.state.ballOn; s.down = pen.state.down; s.toGo = pen.state.toGo; s.phase = 'scrimmage';
      if (pen.offense && (s.quarter === 2 || s.quarter === 4) && clockBefore <= 60 && this.clockRunning) {
        s.clock = Math.max(0, s.clock - 10);
        pen.text += ' 10-second runoff.';
      }
      if (pen.state.firstDown) T[off].firstDowns++;
      this.addLog('penalty', pen.text, { prefix, off, label: meta.label });
      for (const l of reviewLogs) this.addLog('review', l);
      for (const l of injuryLogs) this.addLog('injury', l);
      if (this.drive) this.drive.plays++;
      return { text: pen.text, prefix };
    }
    if (pen.suffix) text += ' ' + pen.suffix;
    const newY = clamp(res.possession === 'O' ? sim.ball.y : FIELD_W - sim.ball.y, HASH_R, HASH_L);

    if (this.drive && meta.type !== 'xp' && !isConv && meta.type !== 'kickoff') this.drive.plays++;

    switch (res.fake ? 'scrimmage' : meta.type) {
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
        } else if (res.blocked && res.returnTD) {
          this.score(def, 6); scored = true;
          s.poss = def; s.phase = 'pat';
          this.endDrive('Blocked FG'); this.startDrive(def, 0); this.endDrive('TD');
        } else if (res.blocked) {
          // live ball recovered behind the line: the defense takes over there
          s.poss = def; s.ballOn = clamp(100 - res.recoverX, 1, 99); s.down = 1; s.toGo = 10; s.ballY = MID_Y;
          changed = true;
          this.endDrive('Blocked FG');
          this.startDrive(def, s.ballOn);
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
        if (meta.type === 'scrimmage' || meta.type === 'kneel' || res.fake) {
          T0.plays++;
          const intercepted = res.events.some((e) => e.type === 'pass' && e.int);
          const gain = res.td === 'O' ? Math.round(100 - s.ballOn) : res.td === 'D' || intercepted ? 0 : Math.round(res.spotX - s.ballOn);
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
        if (newPoss === off && (meta.type !== 'punt' || res.fake)) {
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
            this.endDrive(meta.type === 'punt' && !res.fake ? 'Punt' : res.kind === 'pass' && res.turnover ? 'INT' : 'Fumble');
            this.startDrive(newPoss, s.ballOn);
          }
        }
        s.phase = 'scrimmage';
      }
    }

    if (pen.post && !scored && !changed && s.phase === 'scrimmage' && s.poss === off) {
      const f = pen.post;
      const y = Math.min(15, (100 - s.ballOn) / 2);
      s.ballOn += y; s.down = 1; s.toGo = Math.min(10, 100 - s.ballOn);
      this.countPenalty(def, y);
      text += ` PENALTY: ${describeFoul(f, this.teams[def])}, ${Math.round(y)} yard${Math.round(y) === 1 ? '' : 's'}${y < 15 ? ' (half the distance)' : ''}, automatic first down.`;
    } else if (pen.post) text += ` (${FOULS[pen.post.type].name} on ${this.teams[def].abbr} enforced on the kickoff.)`;
    this.updateMomentum(sim, { scored, changed });
    this.recordScoring(meta, text, nScoring, nDrives);
    this.addLog(scored ? 'score' : res.turnover ? 'turnover' : pen.flag ? 'penalty' : 'play', text, { prefix, off, label: meta.label });
    for (const l of reviewLogs) this.addLog('review', l);
    for (const l of injuryLogs) this.addLog('injury', l);

    // ----- clock management between plays -----
    const q = s.quarter;
    this.clockRunning = false;
    if ((q === 2 || q === 4) && !s.warned && clockBefore > 120 && s.clock <= 120 && s.clock > 0) {
      s.warned = true; this.addLog('info', 'Two-minute warning.');
    } else if (s.phase === 'scrimmage' && !res.clockStops && !changed && !scored && meta.type !== 'kickoff' && s.clock > 0
      && !pen.flag && !injuryLogs.length) {
      const oobStops = res.oob && ((q === 2 && s.clock <= 120) || (q >= 4 && s.clock <= 300));
      if (!oobStops) this.runoff(res);
    }
    if (this.pendingFinal) { this.pendingFinal = false; this.finish(); }
    else if (s.ot && s.clock <= 0 && s.phase !== 'pat' && !(this.noTie && s.score.home === s.score.away)) this.finish();
    else if (s.ot && scored && s.phase === 'pat' && s.ot.ended.home + s.ot.ended.away >= 2 && s.score.home !== s.score.away) {
      // sudden death: TD ends it (no PAT needed)
      this.finish();
    }
    return { text, prefix };
  }

  // Pre-snap check: count the box and get out of a bad play.
  maybeAudible(off, ctx, offCall, defCall) {
    const rng = this.rng;
    const qb = depthChart(this.teams[off]).QB[0];
    const awr = qb ? qb.ratings.awr : 60;
    const base = { base: 7, nickel: 6, dime: 5, goal: 8 }[defCall.front] ?? 6;
    const shown = defCall.shownShell ?? 1;
    const box = base + (shown === 1 ? 1 : 0) + (defCall.blitz?.length || 0) + (defCall.simPressure ? 1 : 0);
    // blockers available in this formation: five linemen plus tight ends / fullback
    const slots = Object.values(FORMATIONS[offCall.formation].slots);
    const blockers = 5 + slots.filter((x) => x.pos === 'TE' || x.pos === 'FB').length;
    const recognizes = rng.chance(0.25 + (awr - 60) / 80);
    if (!recognizes || ctx.twoMin || offCall.play.id === 'kneel') return null;
    let next = null;
    if (offCall.play.kind === 'run' && !offCall.play.rpo && box >= blockers + 2 && ctx.toGo > 1) {
      for (let i = 0; i < 8 && !next; i++) {
        const c = callOffense(this.teams[off], { ...ctx, down: 3, toGo: 5 }, rng, null, { formation: offCall.formation, kind: 'pass' });
        if (c.play.kind === 'pass' && c.play.depth !== 'deep') next = { ...c, flip: offCall.flip };
      }
    } else if (offCall.play.kind === 'pass' && !offCall.play.screen && box <= blockers - 1 && ctx.toGo <= 4 && ctx.down >= 2) {
      for (let i = 0; i < 8 && !next; i++) {
        const c = callOffense(this.teams[off], { ...ctx, down: 1, toGo: 2, twoMin: false }, rng, null, { formation: offCall.formation, kind: 'run' });
        if (c.play.kind === 'run' && !c.play.option) next = { ...c, flip: offCall.flip };
      }
    }
    if (!next) return null;
    next.audible = true;
    next.name = `${next.name} (audible from ${offCall.name})`;
    return next;
  }

  // Momentum (+/-3 on mental ratings) and clutch play late in close games.
  ratingMod(p, teamKey) {
    const s = this.s;
    let m = (teamKey === 'home' ? this.momentum : -this.momentum) * 3;
    const close = s.quarter >= 4 && s.clock < 300 && Math.abs(s.score.home - s.score.away) <= 8;
    if (close) {
      if (p.traits && p.traits.includes('clutch')) m += 5;
      else if (p.ratings.awr < 60) m -= 2;
      if (teamKey === 'away') m -= 1; // road crowd at its loudest
    }
    return m;
  }

  updateMomentum(sim, { scored }) {
    const res = sim.result, meta = sim.meta;
    const sign = (k) => (k === 'home' ? 1 : -1);
    const off = meta.off, def = other(off);
    let d = 0;
    if (res.td) d += 0.35 * sign(res.td === 'O' ? off : def);
    else if (scored && meta.type === 'fg') d += 0.1 * sign(off);
    if (res.turnover) d += 0.3 * sign(res.possession === 'D' ? def : off);
    if (res.safety) d += 0.25 * sign(def);
    if (res.kind === 'sack') d += 0.08 * sign(def);
    if (meta.type === 'fg' && !res.good) d += 0.12 * sign(def);
    const gain = res.possession === 'O' && !res.td ? res.spotX - (meta.pre?.ballOn ?? res.spotX) : 0;
    if ((meta.type === 'scrimmage') && gain >= 20) d += 0.14 * sign(off);
    if (meta.pre?.down === 4 && meta.type === 'scrimmage' && this.s.poss === def) d += 0.2 * sign(def);
    this.momentum = clamp(this.momentum * 0.94 + d, -1, 1);
  }

  // Energy drains with effort and recovers on the sideline; halftime resets.
  updateFatigue(sim) {
    const onField = new Set();
    const scrimmage = sim.meta.type === 'scrimmage' || sim.meta.type === 'conversion';
    for (const a of sim.agents) {
      onField.add(a.id);
      const slow = (a.p.traits || []).some((t) => t === 'workhorse' || t === 'iron_man') ? 0.6 : 1;
      const posK = { OL: 0.6, QB: 0.4, K: 0.2, P: 0.2 }[a.pos] ?? 1;
      const drain = (0.008 + a.work * 0.045) * posK * slow;
      this.energy.set(a.id, Math.max(0.3, (this.energy.get(a.id) ?? 1) - drain + 0.01));
      if (scrimmage) this.snaps.set(a.id, (this.snaps.get(a.id) || 0) + 1);
    }
    for (const [pid, e] of this.energy) if (!onField.has(pid) && e < 1) this.energy.set(pid, Math.min(1, e + 0.05));
  }

  // ---------- in-game learning ----------
  learn(sim) {
    const meta = sim.meta, res = sim.result, pre = meta.pre;
    if (meta.type !== 'scrimmage' || !meta.offCall || res.kind === 'penalty') return;
    const gain = res.td === 'O' ? 99 : res.possession === 'O' ? res.spotX - pre.ballOn : -10;
    const need = pre.down === 1 ? 0.4 : pre.down === 2 ? 0.6 : 1;
    const ok = gain >= pre.toGo * need ? 1 : 0;
    const T = this.tend[meta.off];
    const k = meta.offCall.play.kind === 'run' && res.kind !== 'pass' ? 'run' : 'pass';
    T[k].n++; T[k].s += ok;
    const c = (T.concept[meta.offCall.play.id] ||= { n: 0, s: 0 });
    c.n++; c.s += ok;
    const f = (T.form[meta.offCall.formation] ||= { run: 0, pass: 0 });
    f[meta.offCall.play.kind === 'run' ? 'run' : 'pass']++;
  }

  adapt(key) {
    const T = this.tend[key];
    const sr = (x) => (x.s + 2.2) / (x.n + 5); // shrink toward ~45% early
    const passAdj = T.run.n + T.pass.n >= 12 ? clamp((sr(T.pass) - sr(T.run)) * 0.6, -0.12, 0.12) : 0;
    const concept = {};
    for (const [id, c] of Object.entries(T.concept)) if (c.n >= 2) concept[id] = clamp(1 + (sr(c) - 0.45) * 1.6, 0.55, 1.6);
    return { passAdj, concept, scout: T.form };
  }

  oppTend(key) {
    const T = this.tend[key];
    const n = T.run.n + T.pass.n;
    const sr = (x) => (x.s + 2.2) / (x.n + 5);
    return { n, passRate: n ? T.pass.n / n : 0.55, runSR: sr(T.run), passSR: sr(T.pass), form: T.form };
  }

  halftimeAdjustments() {
    for (const k of ['home', 'away']) {
      const a = this.adapt(k), T = this.tend[k];
      if (Math.abs(a.passAdj) < 0.04) continue;
      const lean = a.passAdj > 0 ? 'the pass' : 'the run';
      const sr = (x) => Math.round(100 * x.s / Math.max(1, x.n));
      this.addLog('info', `Halftime adjustments: ${this.teams[k].name} will lean on ${lean} (run success ${sr(T.run)}%, pass success ${sr(T.pass)}%).`);
    }
  }

  // ---------- officiating: close calls and replay review ----------
  reviewPlay(sim) {
    const res = sim.result, meta = sim.meta, s = this.s, rng = this.rng, st = sim.st;
    if (!res || (meta.type !== 'scrimmage' && meta.type !== 'conversion') || res.kind === 'penalty') return [];
    const off = meta.off, def = other(off);
    const pre = meta.pre;
    let call = null;
    // 1) toe-tap catches along the sideline
    if (res.kind === 'pass' && st.catcher && res.outcome !== 'incomplete' && !res.turnover && Math.min(st.catcher.y, FIELD_W - st.catcher.y) < 1.1 && rng.chance(0.15)) {
      call = { what: 'catch', wrong: 'incomplete', hurt: off, apply: () => this.ruleIncomplete(res, sim) };
    }
    // 2) spot at the line to gain on 3rd/4th down
    const line = pre.ballOn + pre.toGo;
    if (!call && res.possession === 'O' && !res.td && pre.down >= 3 && Math.abs(res.spotX - line) < 0.5 && res.outcome !== 'incomplete' && rng.chance(0.18)) {
      const made = res.spotX >= line;
      const newSpot = made ? line - 0.2 : line + 0.1;
      call = { what: made ? 'first down' : 'short', wrong: made ? 'short of the line' : 'a first down', hurt: made ? off : def, apply: () => this.respot(res, newSpot) };
    }
    // 3) goal-line plunges
    if (!call && res.possession === 'O' && (res.td === 'O' || (res.spotX > 99.3 && res.spotX < 100 && !res.td)) && res.kind !== 'pass' && rng.chance(0.15)) {
      const td = res.td === 'O';
      call = { what: td ? 'touchdown' : 'short', wrong: td ? 'short of the goal line' : 'a touchdown', hurt: td ? off : def,
        apply: () => (td ? this.respot(res, 99.6, true) : this.respot(res, 100, false, true)) };
    }
    // 4) fumble vs down by contact
    if (!call && st.fumble?.lost && rng.chance(0.12)) {
      call = { what: 'fumble', wrong: 'down by contact', hurt: def, apply: () => this.ruleDown(res, sim) };
    }
    if (!call) {
      // a close play the officials got right: occasionally a coach challenges it anyway
      const close = (res.kind === 'pass' && st.catcher && Math.min(st.catcher.y, FIELD_W - st.catcher.y) < 1.1)
        || (res.possession === 'O' && pre.down >= 3 && Math.abs(res.spotX - line) < 0.6);
      const team = res.kind === 'pass' && st.catcher ? def : (res.spotX >= line ? def : off);
      if (close && rng.chance(0.18) && this.challenges[team] > 0 && s.timeouts[team] > 0 && !(s.clock <= 120 && (s.quarter === 2 || s.quarter >= 4))) {
        this.challenges[team]--; s.timeouts[team]--;
        return [`${this.teams[team].abbr} challenges the ruling... after review, the ruling on the field STANDS. ${this.teams[team].abbr} loses a timeout.`];
      }
      return [];
    }
    // The officials get it wrong on the field...
    const truth = JSON.stringify(res);
    call.apply();
    const logs = [`Ruled ${call.wrong} on the field.`];
    const scoringOrTO = res.td || call.what === 'touchdown' || call.what === 'fumble' || res.turnover;
    const booth = scoringOrTO || s.clock <= 120 && (s.quarter === 2 || s.quarter >= 4);
    const overturn = rng.chance(0.7); // is the video conclusive?
    const revert = () => { Object.assign(res, JSON.parse(truth)); };
    if (booth) {
      logs.push(`The play is under booth review... ${overturn ? `REVERSED: ${call.what}.` : 'the ruling STANDS.'}`);
      if (overturn) revert();
      return logs;
    }
    const team = call.hurt;
    const lev = pre.down >= 3 || call.what === 'touchdown' ? 0.85 : 0.6;
    if (this.challenges[team] > 0 && s.timeouts[team] > 0 && rng.chance(lev)) {
      this.challenges[team]--;
      logs.push(`${this.teams[team].abbr} throws the challenge flag... ${overturn ? `REVERSED: ${call.what}.` : `the ruling STANDS. ${this.teams[team].abbr} loses a timeout.`}`);
      if (overturn) revert(); else s.timeouts[team]--;
    }
    return logs;
  }

  ruleIncomplete(res, sim) {
    res.kind = 'pass'; res.outcome = 'incomplete'; res.spotX = sim.los; res.td = null; res.clockStops = true; res.oob = false;
    res.events = res.events.filter((e) => e.type === 'pass' || e.type === 'rec').map((e) => (e.type === 'pass' ? { type: 'pass', pid: e.pid, att: 1 } : { type: 'rec', pid: e.pid, tgt: 1 }));
    res.desc = `${res.desc.split(' for ')[0].replace(' pass ', ' pass incomplete ')} (ruled out of bounds).`;
  }

  respot(res, spot, removeTD, makeTD) {
    const d = Math.round(spot) - Math.round(res.td === 'O' ? 100 : res.spotX);
    res.spotX = spot;
    if (removeTD) { res.td = null; res.clockStops = false; res.desc = res.desc.replace(', TOUCHDOWN!', ', short of the goal line.'); }
    if (makeTD) { res.td = 'O'; res.clockStops = true; res.desc += ' TOUCHDOWN!'; }
    for (const e of res.events) {
      if ((e.type === 'rush' || e.type === 'pass' || e.type === 'rec') && e.yds != null) {
        e.yds += d;
        if (removeTD) e.td = 0;
        if (makeTD) e.td = 1;
      }
    }
  }

  ruleDown(res) {
    res.possession = 'O'; res.turnover = false; res.clockStops = false;
    res.events = res.events.filter((e) => e.type !== 'fum' && !(e.type === 'def' && (e.ff || e.fr)));
    res.desc = res.desc.replace(/ FUMBLE.*$/, ' Ruled down by contact.');
  }

  countPenalty(key, yds) {
    const T = this.stats.team[key];
    T.penalties++; T.penYds += Math.round(Math.abs(yds));
  }

  // Where the offense would stand if the play result stands (for accept/decline decisions).
  outcomeState(res, pre) {
    if (res.td) return { td: res.td };
    if (res.safety) return { safety: true };
    if (res.possession === 'D') return { turnover: true, ballOn: clamp(res.spotX, 1, 99) };
    const nb = clamp(res.spotX, 0.5, 99.5);
    if (nb >= pre.ballOn + pre.toGo) return { ballOn: nb, down: 1, toGo: Math.min(10, 100 - nb) };
    return { ballOn: nb, down: pre.down + 1, toGo: pre.ballOn + pre.toGo - nb };
  }

  // Decide and enforce flags. Returns { mode: 'none'|'nullify'|'declined'|'kick', text, state, suffix, post, flag }.
  resolveFouls(sim) {
    const res = sim.result, meta = sim.meta, pre = meta.pre;
    const fouls = sim.fouls || [];
    if (!fouls.length) return { mode: 'none' };
    const off = meta.off, def = other(off);
    const teamOf = (side) => (side === 'O' ? off : def);
    const yardsWord = (y) => { const n = Math.round(Math.abs(y)); return `${n} yard${n === 1 ? '' : 's'}`; };

    // Kick returns: holding / illegal block by the return team (yard lines below are the return team's).
    // Enforced from the spot of the foul when it is behind the basic spot, otherwise from the basic spot:
    // the end of the run, or for a punt foul before the catch, where the kick ended (post-scrimmage kick spot).
    if (meta.type === 'kickoff' || meta.type === 'punt') {
      const f = fouls.find((x) => x.side === 'R');
      const returned = res.outcome === 'tackle' || res.outcome === 'oob' || res.outcome === 'td';
      if (!f || res.possession !== 'D' || res.touchback || !returned) return { mode: 'none' };
      const R = res.td === 'D' ? 100 : 100 - res.spotX;
      const st = sim.st || {};
      const duringKick = meta.type === 'punt' && st.catchX != null && !(f.t >= st.catchT);
      const basic = duringKick ? Math.min(R, 100 - st.catchX) : R;
      const F = clamp(Math.min(100 - f.x, basic), 1, 99);
      const y = Math.min(10, F / 2);
      const newR = F - y;
      if (newR >= R) return { mode: 'none', suffix: `(${FOULS[f.type].name} on ${this.teams[def].abbr} declined.)`, flag: true };
      res.spotX = 100 - newR;
      const wasTD = !!res.td;
      res.td = null;
      this.countPenalty(def, R - newR);
      return { mode: 'kick', flag: true, suffix: `${wasTD ? 'TOUCHDOWN NULLIFIED. ' : ''}PENALTY: ${describeFoul(f, this.teams[def])}, ${yardsWord(y)} from the ${100 - f.x < basic ? 'spot of the foul' : duringKick ? 'end of the kick' : 'end of the return'}.` };
    }
    if (meta.type !== 'scrimmage') return { mode: 'none' };

    const live = fouls.filter((f) => !f.post);
    const postF = fouls.find((f) => f.post && f.side === 'D' && res.possession === 'O');
    if (res.outcome === 'presnap') {
      const f = live[0];
      const st = enforce(f, pre);
      this.countPenalty(teamOf(f.side), st.moved);
      const offenseFoul = f.side === 'O';
      const dn = st.firstDown ? 'First down' : `Replay ${['', '1st', '2nd', '3rd', '4th'][st.down]} down`;
      return { mode: 'nullify', state: st, flag: true, offense: offenseFoul,
        text: `PENALTY: ${describeFoul(f, this.teams[teamOf(f.side)])}, ${yardsWord(st.moved)}${st.halfDist ? ' (half the distance)' : ''}. ${dn}.` };
    }
    const offF = live.filter((f) => f.side === 'O'), defF = live.filter((f) => f.side === 'D');
    if (offF.length && defF.length) {
      return { mode: 'nullify', state: { ...pre }, flag: true,
        text: `${res.desc} Offsetting penalties (${describeFoul(offF[0], this.teams[off])}; ${describeFoul(defF[0], this.teams[def])}). Replay the down.` };
    }
    const playSt = this.outcomeState(res, pre);
    const worst = (arr) => arr.slice().sort((a, b) => (FOULS[b.type].yds ?? 20) - (FOULS[a.type].yds ?? 20))[0];
    if (offF.length) {
      const f = worst(offF);
      const penSt = enforce(f, pre);
      const accept = stateValue(penSt) < stateValue(playSt); // defense picks what hurts the offense most
      if (!accept) return { mode: 'declined', flag: true, post: postF, suffix: `(${FOULS[f.type].name} on ${this.teams[off].abbr} declined.)` };
      this.countPenalty(off, penSt.moved);
      return { mode: 'nullify', state: penSt, flag: true, offense: true,
        text: `${res.td === 'O' ? 'TOUCHDOWN NULLIFIED. ' : ''}${res.desc} PENALTY: ${describeFoul(f, this.teams[off])}, ${yardsWord(penSt.moved)}. No play.` };
    }
    if (defF.length) {
      const f = worst(defF);
      const penSt = enforce(f, pre, f.x);
      const accept = !playSt.td && stateValue(penSt) > stateValue(playSt); // offense picks the better outcome
      if (!accept) return { mode: 'declined', flag: true, post: postF, suffix: `(${FOULS[f.type].name} on ${this.teams[def].abbr} declined.)` };
      this.countPenalty(def, penSt.moved);
      return { mode: 'nullify', state: penSt, flag: true,
        text: `${res.desc} PENALTY: ${describeFoul(f, this.teams[def])}, ${yardsWord(penSt.moved)}${penSt.firstDown ? ', automatic first down' : ''}.` };
    }
    return { mode: 'declined', flag: true, post: postF };
  }

  processInjuries(sim) {
    const logs = [];
    const rng = this.rng;
    for (const inj of sim.injuries || []) {
      const team = inj.side === 'O' ? sim.meta.off : sim.meta.def;
      if (this.injuries.has(inj.p.id)) continue;
      const W = { ankle: 20, knee: 14, hamstring: 14, shoulder: 12, concussion: 9, hand: 8, ribs: 8, groin: 7 };
      const part = rng.weighted(Object.keys(W), (x) => W[x]);
      const r = rng.next();
      let status, returnAt;
      if (part === 'concussion' || r > 0.72) { status = 'out for the game'; returnAt = Infinity; }
      else if (r > 0.45) { status = 'questionable to return'; returnAt = this.snapCount + rng.int(18, 45); }
      else { status = 'shaken up, will miss a few plays'; returnAt = this.snapCount + rng.int(3, 10); }
      const weeks = injuryWeeks(rng, part, returnAt === Infinity, inj.p.dur ?? 75);
      this.injuries.set(inj.p.id, { team, p: inj.p, part, status, returnAt, returned: returnAt === Infinity, q: this.s.quarter, weeks });
      const outlook = weeks >= 99 ? ' Feared to be season-ending.' : weeks >= 4 ? ' Expected to miss significant time.' : '';
      logs.push(`INJURY: ${this.teams[team].abbr} #${inj.p.num} ${inj.p.first[0]}.${inj.p.last} (${inj.p.pos}), ${part}. ${status[0].toUpperCase() + status.slice(1)}.${outlook}`);
    }
    return logs;
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
    const toWindow = dDiff >= -8 ? 150 : 240; // down two scores: start stopping the clock earlier
    if (q >= 4 && s.clock <= toWindow && dDiff <= 0 && dDiff >= -16 && s.timeouts[defK] > 0 && s.clock > 5) {
      s.timeouts[defK]--; this.addLog('timeout', `Timeout ${this.teams[defK].abbr} (${s.timeouts[defK]} left).`); return;
    }
    if (((q >= 4 && ctx.scoreDiff <= 0 && ctx.scoreDiff >= -16 && s.clock <= 110) || (q === 2 && s.clock <= 40 && s.ballOn >= 40))
        && s.timeouts[offK] > 0 && s.clock > 3) {
      s.timeouts[offK]--; this.addLog('timeout', `Timeout ${this.teams[offK].abbr} (${s.timeouts[offK]} left).`); return;
    }
    if ((q === 2 || q === 4) && !s.warned && s.clock > 120 && s.clock - r <= 120) {
      s.clock = 120; s.warned = true; this.addLog('info', 'Two-minute warning.'); return;
    }
    // hurry-up with no timeouts to burn: rush to the line and spike it
    const hurry = (q === 2 && s.clock <= 60 && s.ballOn >= 35) || (q >= 4 && ctx.scoreDiff <= 0 && ctx.scoreDiff >= -16 && s.clock <= 120);
    if (hurry && s.down <= 3 && s.timeouts[offK] === 0 && s.clock > 8 && s.clock <= 45 && s.ballOn >= 35 && this.rng.chance(0.65)) {
      r = 6 + this.rng.range(0, 3); s.spikeNext = true;
    }
    const before = s.clock;
    s.clock = Math.max(0, s.clock - r);
    this.clockRunning = true;
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

// Weeks an injury costs (0 = day-to-day). Serious ones go to IR (4+); 99 = out for the season.
export function injuryWeeks(rng, part, outForGame, dur) {
  if (part === 'concussion') return rng.int(1, 2);
  if (!outForGame) return rng.chance(0.2) ? 1 : 0;
  const r = rng.next() * (1.25 - dur / 400); // durable players tend to land on the light end
  const bad = part === 'knee' ? 1.25 : part === 'ankle' || part === 'hamstring' ? 1.05 : 0.9;
  const x = r * bad;
  if (x < 0.3) return 0;
  if (x < 0.62) return rng.int(1, 2);
  if (x < 0.85) return rng.int(3, 5);
  if (x < 0.97) return rng.int(6, 10);
  return 99;
}
