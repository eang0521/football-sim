// Formations, route tree, offensive plays and defensive calls.
// Frame convention (see playsim): offense attacks +x, +y is the offense's LEFT.
// Formation slot: dx = yards behind (negative) the ball, dy = lateral (+ left).
// `field:true` means dy is measured from the middle of the field instead of the ball.

const OL = {
  C: { pos: 'OL', dx: -0.6, dy: 0 },
  LG: { pos: 'OL', dx: -0.7, dy: 1.3 },
  RG: { pos: 'OL', dx: -0.7, dy: -1.3 },
  LT: { pos: 'OL', dx: -0.8, dy: 2.6 },
  RT: { pos: 'OL', dx: -0.8, dy: -2.6 },
};

export const FORMATIONS = {
  gun_doubles: {
    name: 'Shotgun Doubles', personnel: '11', qb: 'gun',
    slots: {
      ...OL, QB: { pos: 'QB', dx: -5, dy: 0 },
      F: { pos: 'RB', dx: -5, dy: 1.6 },
      X: { pos: 'WR', dx: -0.8, dy: 15, field: true },
      H: { pos: 'WR', dx: -1.6, dy: 8.5, field: true },
      Z: { pos: 'WR', dx: -1.6, dy: -15, field: true },
      Y: { pos: 'TE', dx: -1.0, dy: -3.9 },
    },
  },
  gun_trips: {
    name: 'Shotgun Trips', personnel: '11', qb: 'gun',
    slots: {
      ...OL, QB: { pos: 'QB', dx: -5, dy: 0 },
      F: { pos: 'RB', dx: -5, dy: 1.6 },
      X: { pos: 'WR', dx: -0.8, dy: 15, field: true },
      Z: { pos: 'WR', dx: -1.6, dy: -16, field: true },
      H: { pos: 'WR', dx: -1.6, dy: -10.5, field: true },
      Y: { pos: 'TE', dx: -1.0, dy: -3.9 },
    },
  },
  gun_spread: {
    name: 'Shotgun Spread', personnel: '10', qb: 'gun',
    slots: {
      ...OL, QB: { pos: 'QB', dx: -5, dy: 0 },
      F: { pos: 'RB', dx: -5, dy: -1.6 },
      X: { pos: 'WR', dx: -0.8, dy: 16, field: true },
      H: { pos: 'WR', dx: -1.6, dy: 9.5, field: true },
      Z: { pos: 'WR', dx: -0.8, dy: -16, field: true },
      A: { pos: 'WR', dx: -1.6, dy: -9.5, field: true },
    },
  },
  singleback: {
    name: 'Singleback', personnel: '11', qb: 'uc',
    slots: {
      ...OL, QB: { pos: 'QB', dx: -1.2, dy: 0 },
      F: { pos: 'RB', dx: -7, dy: 0 },
      X: { pos: 'WR', dx: -0.8, dy: 15, field: true },
      H: { pos: 'WR', dx: -1.6, dy: 8.5, field: true },
      Z: { pos: 'WR', dx: -1.6, dy: -15, field: true },
      Y: { pos: 'TE', dx: -1.0, dy: -3.9 },
    },
  },
  ace_12: {
    name: 'Singleback Ace (12)', personnel: '12', qb: 'uc',
    slots: {
      ...OL, QB: { pos: 'QB', dx: -1.2, dy: 0 },
      F: { pos: 'RB', dx: -7, dy: 0 },
      X: { pos: 'WR', dx: -1.6, dy: 15, field: true },
      Z: { pos: 'WR', dx: -1.6, dy: -15, field: true },
      Y: { pos: 'TE', dx: -1.0, dy: -3.9 },
      H: { pos: 'TE', dx: -1.0, dy: 3.9 },
    },
  },
  iform: {
    name: 'I-Form Pro', personnel: '21', qb: 'uc',
    slots: {
      ...OL, QB: { pos: 'QB', dx: -1.2, dy: 0 },
      A: { pos: 'FB', dx: -4.5, dy: 0 },
      F: { pos: 'RB', dx: -7.2, dy: 0 },
      X: { pos: 'WR', dx: -0.8, dy: 15, field: true },
      Z: { pos: 'WR', dx: -1.6, dy: -15, field: true },
      Y: { pos: 'TE', dx: -1.0, dy: -3.9 },
    },
  },
  pistol: {
    name: 'Pistol', personnel: '11', qb: 'pistol',
    slots: {
      ...OL, QB: { pos: 'QB', dx: -4, dy: 0 },
      F: { pos: 'RB', dx: -7, dy: 0 },
      X: { pos: 'WR', dx: -0.8, dy: 15, field: true },
      H: { pos: 'WR', dx: -1.6, dy: 8.5, field: true },
      Z: { pos: 'WR', dx: -1.6, dy: -15, field: true },
      Y: { pos: 'TE', dx: -1.0, dy: -3.9 },
    },
  },
  goal_line: {
    name: 'Goal Line', personnel: '22', qb: 'uc',
    slots: {
      ...OL, QB: { pos: 'QB', dx: -1.2, dy: 0 },
      A: { pos: 'FB', dx: -4.5, dy: 0 },
      F: { pos: 'RB', dx: -7, dy: 0 },
      X: { pos: 'WR', dx: -0.8, dy: 9, field: true },
      Y: { pos: 'TE', dx: -1.0, dy: -3.9 },
      H: { pos: 'TE', dx: -1.0, dy: 3.9 },
    },
  },
};

// Route tree: waypoints [downfield, lateral-toward-outside] from the receiver's alignment.
export const ROUTES = {
  go: { pts: [[12, 0.5], [70, 2]] },
  fade: { pts: [[6, 1.8], [70, 4.5]] },
  seam: { pts: [[8, -0.8], [70, -2]] },
  slant: { pts: [[2, 0], [6, -4.5], [30, -24]], quick: true },
  quickout: { pts: [[5, 0], [5.5, 25]], quick: true },
  out: { pts: [[10, 0], [9.5, 25]] },
  hitch: { pts: [[6, 0], [5, -0.3]], sit: true, quick: true },
  curl: { pts: [[12, 0], [10.5, -1.5]], sit: true },
  comeback: { pts: [[15, 0], [13, 3]], sit: true },
  dig: { pts: [[12, 0], [12.5, -35]] },
  in5: { pts: [[5, 0], [5.5, -30]], quick: true },
  post: { pts: [[12, 0], [45, -16]] },
  corner: { pts: [[11, 0], [25, 11], [40, 15]] },
  drag: { pts: [[2, -1.5], [4.5, -6], [5.5, -40]] },
  drag6: { pts: [[3, -1], [6.5, -6], [7, -40]] },
  cross: { pts: [[4, -1], [14, -12], [17, -40]] },
  wheel: { pts: [[1.5, 4], [5, 7], [60, 8]] },
  flat: { pts: [[1, 3], [4, 9], [5, 30]], quick: true },
  arrow: { pts: [[3, 5], [6, 30]], quick: true },
  stick: { pts: [[6, 0], [5.8, 0.3]], sit: true, quick: true },
  snag: { pts: [[5, -2.5], [5.5, -3]], sit: true, quick: true },
  hook: { pts: [[7, 0], [6.3, -0.6]], sit: true },
  check: { pts: [[4, -1.5], [4.2, -1.8]], sit: true, delay: 0.9 },
  swing: { pts: [[-1, 4], [1, 12], [4, 30]], quick: true },
  angle: { pts: [[2, 4], [5, 1], [8, -12]] },
  bubble: { pts: [[-1.5, 3], [-0.8, 8], [2, 25]], quick: true },
  // screens: sell pass pro / a stem, then settle behind the line for the throw
  screen: { pts: [[-2.5, 4.5], [-2.2, 6.5]], sit: true, delay: 0.9, screen: true },
  tunnel: { pts: [[-0.5, -1.5], [-1.5, -5.5]], sit: true, quick: true, screen: true },
};

// Default role for a label not referenced by a play.
export function defaultRoute(pos) {
  if (pos === 'TE') return 'block';
  if (pos === 'RB') return 'check';
  if (pos === 'FB') return 'block';
  return 'go';
}

const QUICK = ['gun_doubles', 'gun_trips', 'gun_spread', 'singleback', 'pistol'];
const GUNS = ['gun_doubles', 'gun_trips', 'gun_spread', 'pistol'];
const UC = ['singleback', 'ace_12', 'iform', 'pistol'];
const ALLF = Object.keys(FORMATIONS).filter((f) => f !== 'goal_line');

// Offensive pass plays. `prog` = QB progression order. `depth` tag used by the play-caller.
export const PASS_PLAYS = [
  { id: 'slants', name: 'Double Slants', forms: QUICK, drop: 'quick', depth: 'short',
    routes: { X: 'slant', Z: 'slant', H: 'arrow', A: 'arrow', Y: 'stick', F: 'check' }, prog: ['X', 'Z', 'H', 'Y', 'A', 'F'] },
  { id: 'stick', name: 'Stick', forms: QUICK, drop: 'quick', depth: 'short',
    routes: { X: 'fade', H: 'hitch', A: 'stick', Z: 'quickout', Y: 'stick', F: 'flat' }, prog: ['Y', 'H', 'A', 'F', 'Z', 'X'] },
  { id: 'hitches', name: 'All Hitch', forms: QUICK, drop: 'quick', depth: 'short',
    routes: { X: 'hitch', Z: 'hitch', H: 'hitch', A: 'hitch', Y: 'flat', F: 'check' }, prog: ['X', 'Z', 'H', 'A', 'Y', 'F'] },
  { id: 'bubble', name: 'Bubble Screen', forms: ['gun_doubles', 'gun_trips', 'gun_spread'], drop: 'quick', depth: 'short',
    routes: { H: 'bubble', A: 'bubble', X: 'stalk', Z: 'stalk', Y: 'block', F: 'block' }, prog: ['H', 'A'] },
  { id: 'rb_screen', name: 'RB Screen', forms: ['gun_doubles', 'gun_trips', 'gun_spread', 'singleback', 'pistol'], drop: '5', depth: 'screen',
    screen: { slot: 'F', throwT: 1.75, release: 0.95 },
    routes: { F: 'screen', X: 'go', Z: 'go', H: 'go', A: 'go', Y: 'seam' }, prog: ['F'] },
  { id: 'wr_tunnel', name: 'WR Tunnel Screen', forms: ['gun_doubles', 'gun_trips', 'gun_spread', 'singleback', 'pistol'], drop: 'quick', depth: 'screen',
    screen: { slot: 'X', throwT: 0.75, release: 0.3 },
    routes: { X: 'tunnel', H: 'stalk', Z: 'go', A: 'go', Y: 'block', F: 'block' }, prog: ['X'] },
  { id: 'mesh', name: 'Mesh', forms: ALLF, drop: '5', depth: 'medium',
    routes: { X: 'drag', Y: 'drag6', H: 'corner', A: 'corner', Z: 'dig', F: 'swing' }, prog: ['X', 'Y', 'H', 'A', 'Z', 'F'] },
  { id: 'smash', name: 'Smash', forms: QUICK, drop: '5', depth: 'medium',
    routes: { X: 'hitch', H: 'corner', A: 'corner', Z: 'hitch', Y: 'corner', F: 'check' }, prog: ['H', 'X', 'A', 'Y', 'Z', 'F'] },
  { id: 'flood', name: 'Flood', forms: ALLF, drop: '5', depth: 'medium',
    routes: { Z: 'go', H: 'out', A: 'out', Y: 'flat', X: 'dig', F: 'check' }, prog: ['H', 'A', 'Y', 'Z', 'X', 'F'] },
  { id: 'levels', name: 'Levels', forms: ALLF, drop: '5', depth: 'medium',
    routes: { X: 'dig', H: 'in5', A: 'in5', Z: 'post', Y: 'hook', F: 'check' }, prog: ['X', 'H', 'A', 'Y', 'Z', 'F'] },
  { id: 'curlflat', name: 'Curl Flat', forms: ALLF, drop: '5', depth: 'medium',
    routes: { X: 'curl', H: 'flat', A: 'flat', Z: 'curl', Y: 'hook', F: 'check' }, prog: ['X', 'H', 'Z', 'A', 'Y', 'F'] },
  { id: 'drive', name: 'Drive', forms: ALLF, drop: '5', depth: 'medium',
    routes: { H: 'drag', A: 'drag', X: 'dig', Z: 'go', Y: 'hook', F: 'check' }, prog: ['H', 'X', 'A', 'Y', 'F'] },
  { id: 'ycross', name: 'Y-Cross', forms: ['gun_doubles', 'gun_trips', 'singleback', 'pistol', 'ace_12', 'iform'], drop: '5', depth: 'medium',
    routes: { Y: 'cross', X: 'go', H: 'seam', Z: 'comeback', A: 'flat', F: 'flat' }, prog: ['Y', 'Z', 'X', 'F', 'A'] },
  { id: 'verts', name: 'Four Verticals', forms: ['gun_doubles', 'gun_spread', 'gun_trips', 'pistol'], drop: '7', depth: 'deep',
    routes: { X: 'go', Z: 'go', H: 'seam', A: 'seam', Y: 'seam', F: 'check' }, prog: ['H', 'A', 'Y', 'X', 'Z', 'F'] },
  { id: 'dagger', name: 'Dagger', forms: ALLF, drop: '7', depth: 'deep',
    routes: { H: 'seam', A: 'seam', X: 'dig', Z: 'post', Y: 'hook', F: 'check' }, prog: ['X', 'Z', 'Y', 'F'] },
  { id: 'postcorner', name: 'Post-Corner', forms: ALLF, drop: '7', depth: 'deep',
    routes: { X: 'post', H: 'corner', A: 'corner', Z: 'corner', Y: 'drag', F: 'check' }, prog: ['X', 'H', 'Z', 'A', 'Y', 'F'] },
  { id: 'pa_shot', name: 'PA Deep Shot', forms: UC, drop: '7', depth: 'deep', pa: true,
    routes: { X: 'post', Z: 'go', Y: 'cross', H: 'dig', A: 'flat', F: 'block' }, prog: ['X', 'Z', 'Y', 'H', 'A'] },
  { id: 'pa_cross', name: 'PA Crossers', forms: UC, drop: '5', depth: 'medium', pa: true,
    routes: { X: 'dig', Z: 'post', Y: 'cross', H: 'drag', A: 'flat', F: 'block' }, prog: ['Y', 'X', 'H', 'A', 'Z'] },
  { id: 'gl_fade', name: 'Goal Line Fade', forms: ['goal_line', 'iform', 'ace_12'], drop: 'quick', depth: 'short',
    routes: { X: 'fade', Y: 'flat', H: 'stick', A: 'flat', Z: 'slant', F: 'block' }, prog: ['X', 'Y', 'H', 'A', 'Z'] },
  { id: 'gl_pa', name: 'PA Flat', forms: ['goal_line', 'iform', 'ace_12'], drop: '5', depth: 'short', pa: true,
    routes: { X: 'slant', Y: 'drag6', H: 'flat', A: 'flat', Z: 'corner', F: 'block' }, prog: ['H', 'A', 'Y', 'X', 'Z'] },
];

// Run plays. aim = lateral yards from ball of the designed hole (toward play side).
export const RUN_PLAYS = [
  { id: 'iz', name: 'Inside Zone', scheme: 'zone', aim: 2.0, forms: Object.keys(FORMATIONS) },
  { id: 'oz', name: 'Outside Zone', scheme: 'zone', aim: 6.5, forms: ['singleback', 'ace_12', 'iform', 'pistol', 'gun_doubles', 'gun_trips'] },
  { id: 'dive', name: 'Dive', scheme: 'zone', aim: 0.7, forms: ['iform', 'singleback', 'ace_12', 'goal_line', 'pistol'] },
  { id: 'power', name: 'Power', scheme: 'power', aim: 2.6, forms: ['iform', 'ace_12', 'singleback', 'goal_line', 'pistol', 'gun_doubles'] },
  { id: 'toss', name: 'Toss', scheme: 'toss', aim: 8.5, forms: ['iform', 'singleback', 'ace_12', 'pistol'] },
  { id: 'draw', name: 'Draw', scheme: 'draw', aim: 0.8, forms: ['gun_doubles', 'gun_trips', 'gun_spread', 'pistol'] },
  { id: 'sneak', name: 'QB Sneak', scheme: 'sneak', aim: 0.4, forms: ['singleback', 'ace_12', 'iform', 'goal_line'] },
  // option family: the QB reads one defender at the mesh
  { id: 'zone_read', name: 'Zone Read', scheme: 'zone', aim: 2.0, option: 'read', forms: ['gun_doubles', 'gun_trips', 'gun_spread', 'pistol'] },
  { id: 'rpo_slant', name: 'RPO Slant', scheme: 'zone', aim: 2.0, rpo: { slot: 'X', route: 'slant' }, forms: ['gun_doubles', 'gun_trips', 'gun_spread', 'pistol'] },
  { id: 'rpo_bubble', name: 'RPO Bubble', scheme: 'zone', aim: 2.0, rpo: { slot: 'H', route: 'bubble' }, forms: ['gun_doubles', 'gun_trips', 'gun_spread'] },
];

// ---------------- Defense ----------------
export const FRONTS = {
  base: { name: '4-3', slots: ['DE_L', 'DT_L', 'DT_R', 'DE_R', 'SAM', 'MIKE', 'WILL', 'CB_L', 'CB_R', 'FS', 'SS'] },
  nickel: { name: 'Nickel', slots: ['DE_L', 'DT_L', 'DT_R', 'DE_R', 'MIKE', 'WILL', 'CB_L', 'CB_R', 'NB', 'FS', 'SS'] },
  dime: { name: 'Dime', slots: ['DE_L', 'DT_L', 'DT_R', 'DE_R', 'MIKE', 'CB_L', 'CB_R', 'NB', 'DB', 'FS', 'SS'] },
  goal: { name: 'Goal Line', slots: ['DE_L', 'DT_L', 'NT', 'DT_R', 'DE_R', 'SAM', 'MIKE', 'WILL', 'CB_L', 'CB_R', 'SS'] },
};
export const SLOT_POS = {
  DE_L: 'DE', DE_R: 'DE', DT_L: 'DT', DT_R: 'DT', NT: 'DT', SAM: 'LB', MIKE: 'LB', WILL: 'LB',
  CB_L: 'CB', CB_R: 'CB', NB: 'CB', DB: 'CB', FS: 'S', SS: 'S',
};

// Coverages. shell: 1 = single-high, 2 = two-high, 0 = none.
export const COVERAGES = {
  C0: { name: 'Cover 0', man: true, shell: 0, deep: [] },
  C1: { name: 'Cover 1', man: true, shell: 1, deep: ['deepM'] },
  C2: { name: 'Cover 2', man: false, shell: 2, deep: ['halfL', 'halfR'], flats: 'squat' },
  C3: { name: 'Cover 3', man: false, shell: 1, deep: ['thirdL', 'thirdM', 'thirdR'], flats: 'curl' },
  C4: { name: 'Cover 4', man: false, shell: 2, deep: ['quarterL1', 'quarterL2', 'quarterR2', 'quarterR1'], flats: 'curl' },
  M2: { name: '2-Man', man: true, shell: 2, deep: ['halfL', 'halfR'] },
};

// Defensive calls: coverage + extra rushers (by slot priority)
export const DEF_CALLS = [
  { id: 'c3', name: 'Cover 3', cov: 'C3', blitz: [] },
  { id: 'c3_buzz', name: 'Cover 3 Sky', cov: 'C3', blitz: [] },
  { id: 'c2', name: 'Cover 2', cov: 'C2', blitz: [] },
  { id: 'c4', name: 'Quarters', cov: 'C4', blitz: [] },
  { id: 'c1', name: 'Cover 1', cov: 'C1', blitz: [] },
  { id: 'c1_rat', name: 'Cover 1 Lurk', cov: 'C1', blitz: [], lurk: true },
  { id: 'm2', name: '2-Man Under', cov: 'M2', blitz: [] },
  { id: 'c3_fire', name: 'Fire Zone 3', cov: 'C3', blitz: [['MIKE', 'NB', 'SAM']] },
  { id: 'c1_blitz', name: 'Cover 1 Blitz', cov: 'C1', blitz: [['WILL', 'NB', 'MIKE'], ['MIKE', 'SAM', 'DB']] },
  { id: 'c0', name: 'Cover 0 Blitz', cov: 'C0', blitz: [['MIKE', 'WILL', 'SAM'], ['WILL', 'SAM', 'NB', 'DB'], ['SS', 'NB']] },
  { id: 'c2_blitz', name: 'Cover 2 Sam Blitz', cov: 'C2', blitz: [['SAM', 'WILL', 'NB']] },
];
