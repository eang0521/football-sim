// Player traits: behavioral tendencies layered on top of ratings.
// `bump` = rating adjustments applied when the player takes the field.
export const TRAITS = {
  scrambler: { name: 'Scrambler', pos: ['QB'], desc: 'Escapes the pocket early and often' },
  gunslinger: { name: 'Gunslinger', pos: ['QB'], desc: 'Throws into tight windows and takes deep shots (more picks)' },
  pocket_passer: { name: 'Pocket Passer', pos: ['QB'], desc: 'Clean, quick reads; rarely leaves the pocket' },
  game_manager: { name: 'Game Manager', pos: ['QB'], desc: 'Avoids risky throws; checks it down' },
  workhorse: { name: 'Workhorse', pos: ['RB', 'FB'], desc: 'Tires slowly; can carry a heavy load' },
  elusive: { name: 'Elusive', pos: ['RB', 'WR'], desc: 'Makes defenders miss in space', bump: { btk: 3 } },
  power_back: { name: 'Power Back', pos: ['RB', 'FB'], desc: 'Falls forward and runs through arm tackles', bump: { str: 4 } },
  deep_threat: { name: 'Deep Threat', pos: ['WR', 'TE'], desc: 'Extra gear on vertical routes', bump: { spd: 2 } },
  possession: { name: 'Possession Receiver', pos: ['WR', 'TE'], desc: 'Catches in traffic' },
  route_tech: { name: 'Route Technician', pos: ['WR', 'TE'], desc: 'Separates at the break', bump: { rte: 4 } },
  road_grader: { name: 'Road Grader', pos: ['OL', 'TE', 'FB'], desc: 'Dominant run blocker', bump: { rbk: 5 } },
  pass_protector: { name: 'Pass Protector', pos: ['OL', 'TE', 'RB'], desc: 'Anchors in pass protection', bump: { pbk: 5 } },
  pass_rusher: { name: 'Pass Rush Specialist', pos: ['DE', 'DT', 'LB'], desc: 'Wins quickly off the edge', bump: { prs: 5 } },
  run_stopper: { name: 'Run Stopper', pos: ['DE', 'DT', 'LB'], desc: 'Sheds blocks against the run', bump: { rds: 5 } },
  ball_hawk: { name: 'Ball Hawk', pos: ['CB', 'S', 'LB'], desc: 'Turns breakups into interceptions' },
  shutdown: { name: 'Shutdown Corner', pos: ['CB'], desc: 'Mirrors receivers in man coverage', bump: { mcv: 4 } },
  hard_hitter: { name: 'Hard Hitter', pos: ['S', 'LB', 'CB'], desc: 'Forces fumbles, jars balls loose', bump: { tak: 3 } },
  clutch: { name: 'Clutch', pos: ['QB', 'WR', 'TE', 'RB', 'K', 'CB', 'S', 'DE'], desc: 'Raises his game late in close games' },
  iron_man: { name: 'Iron Man', pos: ['OL', 'DT', 'DE', 'LB', 'WR', 'CB', 'S', 'TE'], desc: 'Rarely tires or gets hurt' },
};

export const hasTrait = (p, t) => !!p?.traits && p.traits.includes(t);

export function traitsFor(pos) {
  return Object.entries(TRAITS).filter(([, t]) => t.pos.includes(pos)).map(([k]) => k);
}

// 0–2 traits; better players are a bit more likely to have one.
export function rollTraits(rng, pos, ovr) {
  const pool = traitsFor(pos);
  const out = [];
  const p1 = 0.3 + Math.max(0, ovr - 70) / 60;
  if (pool.length && rng.next() < p1) out.push(pool[Math.floor(rng.next() * pool.length)]);
  if (pool.length > 1 && rng.next() < p1 * 0.3) {
    const t = pool[Math.floor(rng.next() * pool.length)];
    if (!out.includes(t) && !(out.includes('scrambler') && t === 'pocket_passer') && !(out.includes('pocket_passer') && t === 'scrambler')
      && !(out.includes('gunslinger') && t === 'game_manager') && !(out.includes('game_manager') && t === 'gunslinger')) out.push(t);
  }
  return out;
}
