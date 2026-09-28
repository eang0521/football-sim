// Penalty definitions, pre-snap rolls and NFL-style enforcement helpers.
import { clamp } from '../util/vec.js';

// side: which side of the snap commits it ('O' offense, 'D' defense, 'R' return team on kicks)
// spot: enforced from the spot of the foul; auto1st: automatic first down; post: dead-ball / after-the-play foul
export const FOULS = {
  false_start: { name: 'False Start', yds: 5, pre: true },
  offside: { name: 'Offside', yds: 5, pre: true },
  neutral_zone: { name: 'Neutral Zone Infraction', yds: 5, pre: true },
  delay_of_game: { name: 'Delay of Game', yds: 5, pre: true },
  off_holding: { name: 'Offensive Holding', yds: 10 },
  opi: { name: 'Offensive Pass Interference', yds: 10 },
  def_holding: { name: 'Defensive Holding', yds: 5, auto1st: true },
  illegal_contact: { name: 'Illegal Contact', yds: 5, auto1st: true },
  dpi: { name: 'Defensive Pass Interference', spot: true, auto1st: true },
  roughing_passer: { name: 'Roughing the Passer', yds: 15, auto1st: true, post: true },
  face_mask: { name: 'Face Mask', yds: 15, auto1st: true, post: true },
  unnecessary_roughness: { name: 'Unnecessary Roughness', yds: 15, auto1st: true, post: true },
  ret_holding: { name: 'Holding', yds: 10 },
  ret_block_back: { name: 'Illegal Block in the Back', yds: 10 },
};

// Roll for a pre-snap foul before the play. Returns a foul type or null.
export function rollPreSnap(rng, offTeam, defTeam, isRoadOffense, ctx) {
  const disc = (team, pos) => {
    const pl = team.roster.filter((p) => pos.includes(p.pos));
    const awr = pl.reduce((s, p) => s + p.ratings.awr, 0) / Math.max(1, pl.length);
    return clamp(1.6 - awr / 100, 0.6, 1.4);
  };
  const crowd = isRoadOffense ? 1.35 : 0.85;
  const late = ctx && ctx.toGo <= 2 && ctx.down >= 3 ? 1.3 : 1; // hard counts on short yardage
  if (rng.chance(0.0125 * disc(offTeam, ['OL', 'TE']) * crowd)) return 'false_start';
  if (rng.chance(0.009 * disc(defTeam, ['DE', 'DT', 'LB']) * late)) return rng.chance(0.5) ? 'offside' : 'neutral_zone';
  if (rng.chance(0.0025 * (isRoadOffense ? 1.3 : 1))) return 'delay_of_game';
  return null;
}

// Rough expected points for the team with the ball (used to accept/decline penalties).
export function expectedPoints(ballOn, down, toGo) {
  const g = Math.min(toGo, 20);
  let ep = -1.4 + 0.068 * ballOn - [0, 0.35, 0.95, 1.8][Math.min(down, 4) - 1] - 0.045 * g;
  if (down === 4 && toGo > 2) ep = Math.max(ep, -(-1.4 + 0.068 * clamp(100 - (ballOn + 40), 20, 99))); // would punt
  return ep;
}

// Value of a resulting state from the offense's point of view.
export function stateValue(st) {
  if (st.td === 'O') return 6.95;
  if (st.td === 'D') return -6.95;
  if (st.safety) return -2.5;
  if (st.turnover) return -expectedPoints(100 - st.ballOn, 1, 10);
  if (st.down > 4) return -expectedPoints(100 - st.ballOn, 1, 10);
  return expectedPoints(st.ballOn, st.down, st.toGo);
}

// Ball placement after enforcing a foul from the previous spot.
export function enforce(foul, pre, spotX) {
  const def = FOULS[foul.type];
  const B = pre.ballOn;
  const st = { down: pre.down, toGo: pre.toGo, ballOn: B, replay: true, moved: 0, halfDist: false };
  const offFoul = foul.side === 'O';
  if (offFoul) {
    const y = Math.min(def.yds, B / 2);
    st.halfDist = y < def.yds;
    st.ballOn = B - y; st.moved = -y; st.toGo = pre.toGo + y;
    return st;
  }
  let nb;
  if (def.spot) nb = clamp(Math.max(spotX ?? B + 1, B + 1), 0, 99);
  else { const y = Math.min(def.yds, (100 - B) / 2); st.halfDist = y < def.yds; nb = B + y; }
  st.ballOn = nb; st.moved = nb - B;
  if (def.auto1st || nb >= B + pre.toGo) { st.down = 1; st.toGo = Math.min(10, 100 - nb); st.firstDown = true; }
  else st.toGo = pre.toGo - (nb - B);
  return st;
}

export function describeFoul(foul, team) {
  const p = foul.p;
  return `${FOULS[foul.type].name}, ${team.abbr}${p ? ` #${p.num} ${p.first[0]}.${p.last}` : ''}`;
}
