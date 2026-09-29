// AI play-calling for offense and defense.
import { FORMATIONS, PASS_PLAYS, RUN_PLAYS, DEF_CALLS, COVERAGES } from './playbook.js';
import { clamp } from '../util/vec.js';

// ctx (offense perspective): { down, toGo, ballOn, quarter, clock, scoreDiff, twoMin, isConversion }
export function passProbability(coach, ctx) {
  let p = coach.passRate - 0.16;
  const { down, toGo, ballOn, quarter, clock, scoreDiff } = ctx;
  if (down === 1) p += toGo > 10 ? 0.15 : 0;
  if (down === 2) p += toGo >= 8 ? 0.14 : toGo <= 3 ? -0.14 : 0;
  if (down >= 3) p = toGo >= 7 ? 0.9 : toGo >= 4 ? 0.74 : toGo >= 2 ? 0.5 : 0.28;
  if (ballOn >= 97) p -= 0.12;
  const late = quarter >= 4 || (quarter === 3 && clock < 300);
  if (late) {
    if (scoreDiff < -8) p += 0.25 * (1 - clock / 900) + 0.1;
    else if (scoreDiff < 0) p += 0.1;
    else if (scoreDiff > 8) p -= 0.3;
    else if (scoreDiff > 0 && quarter >= 4) p -= 0.15;
  }
  if (ctx.twoMin) p = Math.max(p, 0.82);
  if (ctx.isConversion) p = 0.62;
  return clamp(p, 0.08, 0.96);
}

// adapt (optional): in-game learning { passAdj, concept: { id: multiplier } }
export function callOffense(team, ctx, rng, adapt) {
  const coach = team.coach;
  const pPass = clamp(passProbability(coach, ctx) + (adapt?.passAdj || 0), 0.08, 0.96);
  const goalLine = ctx.ballOn >= 97 || (ctx.toGo <= 1 && ctx.down >= 3 && rng.chance(0.5));
  if (rng.chance(pPass)) {
    // choose concept depth
    const { toGo, down } = ctx;
    const long = toGo >= 12 || (ctx.twoMin && ctx.clock < 60);
    const w = { short: 1, medium: 1.2, deep: 0.35 + coach.deepShot * 0.6, screen: 0.18 };
    if ((down === 2 && toGo >= 8) || (down === 3 && toGo >= 10)) w.screen = 0.5;
    if (toGo <= 4) { w.short = 2.2; w.deep *= 0.5; }
    if (long) { w.short = 0.3; w.medium = 1.3; w.deep += 0.6; }
    if (down === 1 || (down === 2 && toGo <= 3)) w.deep += coach.deepShot * 0.4;
    if (ctx.ballOn >= 88) { w.deep = 0.15; w.short += 0.8; }
    if (down >= 3) {
      // money downs: call concepts whose routes get to the sticks
      if (toGo <= 3) { w.short = 2.5; w.medium = 0.9; w.deep *= 0.3; }
      else if (toGo <= 9) { w.short = 0.45; w.medium = 2.4; w.deep *= 0.5; }
      else { w.short = 0.25; w.medium = 1.8; w.deep *= 1.0; }
    }
    let plays = PASS_PLAYS.filter((p) => !(goalLine ? false : p.forms.every((f) => f === 'goal_line')));
    if (goalLine) plays = plays.filter((p) => p.forms.includes('goal_line') || p.depth === 'short');
    else if (ctx.ballOn < 80) plays = plays.filter((p) => !p.id.startsWith('gl_'));
    if (ctx.twoMin) plays = plays.filter((p) => !p.pa);
    const play = rng.weighted(plays, (p) => (adapt?.concept?.[p.id] ?? 1) * (w[p.depth] || 1) * (p.pa ? coach.playAction * 2 * (down === 1 ? 1.4 : 0.6) : 1)
      * (ctx.twoMin && p.id === 'bubble' ? 0.3 : 1));
    let forms = play.forms.filter((f) => goalLine ? true : f !== 'goal_line');
    if (goalLine && play.forms.includes('goal_line')) forms = ['goal_line', 'goal_line', ...forms];
    if (ctx.twoMin) forms = forms.filter((f) => FORMATIONS[f].qb !== 'uc').concat(forms.length ? [] : play.forms);
    const formation = rng.pick(forms.length ? forms : play.forms);
    return { formation, flip: rng.chance(0.5), play: { kind: 'pass', ...play }, name: play.name, motion: !play.screen && rng.chance(0.4) };
  }
  // run
  const scheme = coach.runScheme;
  const qbSpd = (team.roster.filter((p) => p.pos === 'QB').sort((a, b) => b.ovr - a.ovr)[0]?.ratings.spd) ?? 60;
  const w = (r) => {
    let x = 1;
    if (scheme === 'zone' && (r.id === 'iz' || r.id === 'oz')) x *= 1.9;
    if (scheme === 'power' && (r.id === 'power' || r.id === 'dive')) x *= 1.9;
    if (r.id === 'sneak') x = ctx.toGo <= 1 && ctx.down >= 3 ? 1.6 : ctx.toGo <= 1 ? 0.3 : 0;
    if (r.id === 'toss') x *= ctx.toGo <= 2 ? 0.3 : 0.45;
    if (r.id === 'draw') x *= ctx.toGo >= 7 ? 0.7 : 0.25;
    if (r.id === 'dive' && ctx.toGo <= 2) x *= 1.6;
    if (r.option) x *= clamp((qbSpd - 62) / 22, 0.05, 1.3);
    if (r.rpo) x *= 0.25 + coach.passRate * 0.3;
    return x;
  };
  const run = rng.weighted(RUN_PLAYS, (r) => w(r) * (adapt?.concept?.[r.id] ?? 1));
  let forms = run.forms;
  if (goalLine && run.forms.includes('goal_line')) forms = ['goal_line', 'goal_line', ...forms];
  else forms = forms.filter((f) => f !== 'goal_line') ;
  if (!forms.length) forms = run.forms;
  if (ctx.twoMin) { const g = forms.filter((f) => FORMATIONS[f].qb !== 'uc'); if (g.length) forms = g; }
  const formation = rng.pick(forms);
  const flip = rng.chance(0.5);
  const f = flip ? -1 : 1;
  const yDy = FORMATIONS[formation].slots.Y?.dy ?? -3.9;
  const strong = Math.sign(yDy) * f;
  const runDir = rng.chance(0.62) ? strong : -strong;
  return {
    formation, flip, runDir, motion: run.scheme !== 'sneak' && rng.chance(0.25),
    play: { kind: 'run', ...run, carrierSlot: run.scheme === 'sneak' ? 'QB' : 'F' },
    name: `${run.name} ${runDir > 0 ? 'Left' : 'Right'}`,
  };
}

// opp (optional): the offense's tendencies this game { passRate, runSR, passSR, n }
export function callDefense(team, ctx, offCall, rng, opp) {
  const coach = team.coach;
  const pers = FORMATIONS[offCall.formation].personnel;
  const { down, toGo, ballOn } = ctx; // ballOn from offense perspective
  let front;
  if (pers === '22' || (ballOn >= 96 && pers !== '10')) front = 'goal';
  else if (pers === '10') front = rng.chance(0.6) ? 'dime' : 'nickel';
  else if (pers === '11') front = down >= 3 && toGo >= 7 ? (rng.chance(0.5) ? 'dime' : 'nickel') : rng.chance(0.15) ? 'base' : 'nickel';
  else front = down >= 3 && toGo >= 8 ? 'nickel' : 'base';
  if (ctx.toGo <= 1 && down >= 3 && front !== 'goal') front = rng.chance(0.5) ? 'goal' : 'base';

  let blitzP = coach.blitzRate;
  if (down >= 3 && toGo >= 4 && toGo <= 10) blitzP += 0.12;
  if (ballOn >= 90) blitzP += 0.08;
  if (ctx.defPrevent) blitzP *= 0.2;
  const manP = coach.manRate + (ballOn >= 90 ? 0.15 : 0);
  let twoHigh = coach.twoHigh + (ctx.defPrevent ? 0.3 : 0) + (toGo >= 12 ? 0.15 : 0);
  // adjust to what the offense is doing today: shell up vs the pass, load the box vs the run
  if (opp && opp.n >= 10) {
    if (opp.passRate > 0.6 || opp.passSR > opp.runSR + 0.1) twoHigh += 0.15;
    if (opp.runSR > 0.5 && opp.runSR > opp.passSR) { twoHigh -= 0.2; if (down <= 2) blitzP += 0.08; }
  }
  const w = (c) => {
    const cov = COVERAGES[c.cov];
    const blitz = c.blitz.length > 0;
    let x = blitz ? blitzP : 1 - blitzP;
    x *= cov.man ? manP : 1 - manP;
    if (cov.shell === 2) x *= twoHigh;
    else if (cov.shell === 1) x *= 1 - twoHigh * 0.6;
    if (c.cov === 'C0') x *= ctx.defPrevent ? 0 : ballOn >= 90 || (down >= 3 && toGo <= 4) ? 1.2 : 0.35;
    if (front === 'goal' && (c.cov === 'C4' || c.cov === 'C2')) x *= 0.3;
    return x;
  };
  const call = rng.weighted(DEF_CALLS, w);
  const cov = COVERAGES[call.cov];
  // Disguise: show the opposite safety shell pre-snap and rotate at the snap
  let shownShell = cov.shell;
  if (cov.shell > 0 && front !== 'goal' && rng.chance(0.15 + coach.blitzRate * 0.2)) shownShell = cov.shell === 1 ? 2 : 1;
  // Simulated pressure: walk linebackers up into the A gaps, then drop them into coverage
  const simPressure = !call.blitz.length && !cov.man && front !== 'goal' && rng.chance(0.1 + coach.blitzRate * 0.2);
  const tags = [shownShell !== cov.shell ? 'disguised' : '', simPressure ? 'sim pressure' : ''].filter(Boolean);
  return { front, cov: call.cov, blitz: call.blitz, lurk: call.lurk, id: call.id, shownShell, simPressure,
    name: `${frontName(front)} ${call.name}${tags.length ? ` (${tags.join(', ')})` : ''}` };
}

function frontName(f) { return { base: '4-3', nickel: 'Nickel', dime: 'Dime', goal: 'Goal Line' }[f]; }
