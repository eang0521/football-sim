export const FIELD_W = 53.33;
export const MID_Y = FIELD_W / 2;
export const HASH_L = MID_Y + 3.08;
export const HASH_R = MID_Y - 3.08;
export const DT = 1 / 60;
export const GRAVITY = 10.72; // yd/s^2
export const PLAYER_R = 0.42;
export const ENGAGE_R = 1.1;
export const TACKLE_R = 1.22;
export const MAX_PLAY_TIME = 16;
export const QUARTER_LEN = 900;
export const OT_LEN = 600;

// Yardage is measured between yard lines: each spot is rounded to the nearest yard line first, and a
// ball in the field of play is never on a goal line (a foot short of the goal line is the 1).
// Down and distance keep the exact spot, so a 10-yard gain can still leave 2nd & inches.
export const yardLine = (x) => (x > 0 && x < 100 ? Math.min(99, Math.max(1, Math.round(x))) : Math.round(x));
export const yardsBetween = (from, to) => yardLine(to) - yardLine(from);

// Physical capability from ratings
export function physFromRatings(p) {
  const r = p.ratings;
  const wt = p.weight || 230;
  return {
    maxSpd: 5.0 + r.spd * 0.056,           // yd/s: 99 spd ~ 10.5
    acc: 3.6 + r.acc * 0.055,              // yd/s^2
    agi: r.agi,
    mass: wt / 230,
    height: (p.height || 74) / 36,          // yards
  };
}
