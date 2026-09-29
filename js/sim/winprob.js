// Win probability from a possession model.
// The current drive can end in a TD, a field goal or nothing, with odds from field position and
// how far the clock lets the offense go. After it, the teams trade league-average drives for the
// time that's left. Adding those up gives an exact distribution of the final margin (points come in
// chunks, so a 3-point deficit with the ball late is very different from a 4-point one).
// A tie at the end goes to overtime, counted as a coin flip.
import { clamp } from '../util/vec.js';

const SECS_PER_DRIVE = 156;                      // ~11.5 possessions per team per game
const AVG_DRIVE = [[7, 0.215], [3, 0.155], [0, 0.63]]; // TD (incl. PAT), FG, no score

// Odds for the drive in progress. st: { ballOn, down, toGo, secs, toOff }
export function driveOdds(st) {
  const x = clamp(st.ballOn ?? 25, 1, 99) / 100;
  let pScore = 0.2 + 0.68 * x ** 1.5;
  const tdShare = clamp(0.33 + 0.55 * x, 0.35, 0.92);
  const down = st.down ?? 1, toGo = st.toGo ?? 10;
  pScore *= clamp(1 - 0.08 * (down - 1) - 0.012 * Math.max(0, toGo - 10) - (down >= 3 ? 0.01 * toGo : 0), 0.3, 1);
  let pTD = pScore * tdShare, pFG = pScore * (1 - tdShare);
  // not enough clock to finish the drive: roughly 22 yards per 30 seconds in a hurry, timeouts help
  const t = (st.secs ?? 3600) + (st.toOff ?? 0) * 12;
  if (t < 240) {
    const yds = t * 0.75;
    const needTD = 100 - x * 100, needFG = Math.max(0, 63 - x * 100);
    const reachTD = clamp(yds / needTD, 0, 1) ** 1.4, reachFG = needFG <= 0 ? 1 : clamp(yds / needFG, 0, 1) ** 1.4;
    pTD *= reachTD;
    pFG = Math.min(pFG * reachFG + (pScore * tdShare - pTD) * 0.6 * reachFG, 0.95 - pTD); // stalled short of the end zone: kick
  }
  return { pTD, pFG, pNone: Math.max(0, 1 - pTD - pFG) };
}

function convolve(dist, outcomes, sign) {
  const out = new Map();
  for (const [m, p] of dist) for (const [pts, q] of outcomes) {
    const k = m + sign * pts;
    out.set(k, (out.get(k) || 0) + p * q);
  }
  return out;
}

// st: { diff, secs, ballOn?, down?, toGo?, toOff?, toDef? } from the point of view of the team with the ball
// (ballOn omitted = nobody has it yet, e.g. right before a kickoff to the opponent is handled by callers).
export function winProb(st) {
  const diff = Math.round(st.diff), secs = Math.max(0, st.secs);
  if (secs <= 0) return diff > 0 ? 1 : diff < 0 ? 0 : 0.5;
  let dist = new Map([[diff, 1]]);
  let used = 0;
  if (st.ballOn != null) {
    const d = driveOdds(st);
    dist = convolve(dist, [[7, d.pTD], [3, d.pFG], [0, d.pNone]], 1);
    used = Math.min(secs, SECS_PER_DRIVE * (0.35 + 0.65 * (1 - (st.ballOn ?? 25) / 100)));
  }
  // remaining drives alternate, the opponent first; a fractional drive is weighted in
  const n = Math.max(0, (secs - used) / SECS_PER_DRIVE);
  const whole = Math.floor(n), frac = n - whole;
  let sign = -1;
  for (let i = 0; i < whole; i++) { dist = convolve(dist, AVG_DRIVE, sign); sign = -sign; }
  if (frac > 0.05) {
    const partial = AVG_DRIVE.map(([pts, p]) => [pts, pts ? p * frac : 1 - (1 - p) * frac]);
    dist = convolve(dist, partial, sign);
  }
  let wp = 0;
  for (const [m, p] of dist) wp += m > 0 ? p : m === 0 ? p * 0.5 : 0;
  // late timeouts are worth a little (clock control)
  wp += ((st.toOff ?? 3) - (st.toDef ?? 3)) * 0.006 * Math.max(0, 1 - secs / 600);
  return clamp(wp, 0.001, 0.999);
}

// League-typical conversion odds by distance (4th down and 2-point tries use the same curve).
export function conversionProb(toGo, ballOn) {
  let p = toGo <= 1 ? 0.7 : clamp(0.72 - 0.05 * toGo, 0.18, 0.62);
  if (ballOn + toGo >= 100) p -= 0.04; // the field is compressed at the goal line
  return p;
}
