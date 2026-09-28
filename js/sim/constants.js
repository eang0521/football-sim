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
