# Gridiron Sim

A 3D, 11-on-11 American football simulation that runs entirely in the browser: no build step and no server, just static files that deploy to GitHub Pages.

Pick two teams and watch the game play itself. Each snap, both coaching AIs call a play. Then all 22 players run the play with their own movement physics:

- The QB drops back, reads his progression, and feels pressure.
- Receivers run the route tree.
- Linemen engage, drive, and shed.
- Defenders play man or zone, read run vs. pass, pursue, and tackle.

Every play feeds a full box score and a play-by-play log.

## Running locally

ES modules require an HTTP server; opening `index.html` from `file://` won't work. Any static server will do:

```bash
python -m http.server 8765
```

Then open http://localhost:8765.

Three.js is loaded from the jsDelivr CDN through an import map, so there is nothing to install.

## Deploying to GitHub Pages

1. Push this folder to a GitHub repository.
2. In the repo, go to **Settings → Pages** and set **Source** to "Deploy from a branch".
3. Pick your branch and the `/ (root)` folder, then save.

The site will be served at `https://<user>.github.io/<repo>/`. All paths are relative, so it works from a project subpath. `.nojekyll` is included so Pages serves the files as-is.

## Controls

| Control | Action |
| --- | --- |
| **Space** | Pause / resume |
| **N** / **Next play** | Finish the current play instantly (or start the next one) |
| **Sim quarter / Sim game** | Simulate ahead instantly, then resume live play |
| **1–6** | Cameras: TV, All-22, QB view, Follow, Sky, Free orbit (drag and scroll) |
| Speed menu | 0.25× to 4× playback |
| Play art | Pre-snap routes, run aiming point, zone landmarks, man matchups, blitzers |
| Names | Floating jersey numbers and names |
| Auto-advance | Off = pause after every play |
| **Teams** | Edit teams, colors, coach tendencies, and every player's ratings and traits (saved in your browser) |
| **Season** | Start a season, then watch or simulate each week's games; view standings, leaders, injuries and history |

## How it works

```
js/
  main.js            app wiring: game loop, controls, modals
  sim/               pure JS, no DOM: runs identically in Node for testing
    game.js          rules engine: clock, downs, scoring, 4th-down/2-pt/kneel/timeout logic, OT, stats
    playcaller.js    offensive and defensive play-calling AI
    playbook.js      formations, route tree, pass concepts, run schemes, fronts and coverages
    setup.js         personnel, alignment, and assignments (blocking, man matchups, zone drops)
    ai.js            per-player decision making (QB, receivers, blockers, runner, rush, coverage, pursuit)
    playsim.js       60 Hz physics: steering, blocking engagement, ball flight, catches, tackles, fumbles
    special.js       kickoffs (2024+ dynamic format), punts, field goals, PATs
    penalties.js     foul definitions, pre-snap rolls, enforcement and accept/decline logic
    stats.js         box-score accumulation
    weather.js       game-day conditions and their effects
  season/            season mode: schedule, standings, playoffs, leaders, development
  render/            Three.js stadium, field texture, player rigs, cameras
  ui/                scorebug, play-by-play, box score, team editor
  data/              fictional league generation and localStorage persistence
tools/               Node harnesses for tuning realism
```

### Simulation highlights

- **Movement physics.** Each player has a top speed, acceleration, and agility derived from ratings. Players steer with separate forward, braking, and lateral acceleration limits. Facing matters: backpedaling and shuffling are slower, and hard cuts cost speed.
- **Blocking.** Blocks engage on contact. Rating-weighted forces push each pair. In pass protection, blockers can only absorb and give ground, so the pocket compresses. In the run game they drive defenders. Sheds, double teams, pancakes, and whiffed open-field blocks are all modeled.
- **QB.** Drop depth depends on the concept, with play-action fakes. The QB reads the progression in order and holds on a primary read until it breaks. He judges each window by predicting where the receiver will be and how fast each defender can get there, allowing for which way the defender is moving. Awareness adds read noise. He feels pressure by time-to-contact and chooses to throw it away, scramble, force a throw, or take the sack.
- **Ball flight.** Passes are real projectiles with lead, loft for deep balls, and arm-strength limits. Accuracy error runs mostly along the throw line, which produces over- and under-throws. Catches resolve at the ball's closest approach and are contested by nearby defenders, leading to breakups, tips, drops, and interceptions.
- **Coverage.**
  - *Man:* cushion that shrinks through the route, trail or on-top technique depending on safety help, and reaction lag that depends on the defender's skill versus the receiver's route running.
  - *Zone:* drops to landmarks (flats, hooks, curl-flat, thirds, halves, quarters) and matches threats. Deep defenders turn and run on vertical routes. Everyone reacts to the QB's eyes and breaks on the throw.
- **Runner vision.** The runner evaluates headings by how far he can get before a defender could intercept, with reaction time based on awareness. Jukes, broken tackles, and cutbacks emerge from this.
- **Tackling.** Pursuit uses analytic intercept angles with outside contain. Arm tackles at the edge of reach, gang tackles, momentum, diving tackles, forward progress, and fumbles are all modeled.
- **Penalties.** Flags come out of what happens on the field, not a dice roll after the play:
  - *Holding:* a beaten blocker grabs instead of letting the rusher shed.
  - *Pass interference and defensive holding:* contact on contested balls and while routes develop.
  - *Roughing the passer:* late hits on the QB.
  - *Face masks and unnecessary roughness:* on tackles.
  - *Return fouls:* holding and blocks in the back on kick returns.
  - *Pre-snap fouls:* false start, offside, neutral zone, and delay of game. Rates scale with unit awareness and road-crowd noise.

  Enforcement follows NFL rules: previous spot or spot of the foul, half the distance to the goal, automatic first downs, offsetting fouls, and dead-ball personal fouls tacked on after the play. The non-offending team accepts or declines using an expected-points comparison. A yellow flag lands on the turf where the foul happened.
- **Injuries.** Hard hits (tackles, sacks, pancakes, late hits) can injure players. Severity ranges from missing a few snaps, to questionable, to out for the game; concussions are always out. Injured players stay down, the depth chart sends in the backup, and returning players are announced. Injuries appear in the play-by-play and the box score.
- **Playbook depth.** RB and WR screens (linemen sell pass protection, then release), pre-snap motion (a man defender trails the motion man, which tells the QB man vs. zone), zone read and RPOs (the QB reads a key defender at the mesh), audibles when the box outnumbers the blockers, hot routes against 6+ rushers, and disguised coverages and simulated pressure that muddy the QB's pre-snap read.
- **Players.** Fatigue drains with effort and recovers on the sideline, so linemen, backs and defensive backs rotate. Traits change behavior, not just ratings: Scrambler, Gunslinger, Game Manager, Possession Receiver, Ball Hawk, Workhorse and more, all editable in the team editor. Team momentum swings on big plays and turnovers, and late in close games clutch players rise while shaky ones tighten up.
- **Game day.** Weather (rain, snow, wind, cold) affects catching, ball security, throwing, footing and kicking, and is rendered in the stadium. Coaches learn in-game what's working and make halftime adjustments; defenses adapt to an offense's tendencies. Officials sometimes miss close calls (sideline catches, spots, goal-line plunges, fumbles), leading to booth reviews and coach's challenges. Special-teams situations include onside kicks, squib kicks, and fake punts and field goals.
- **Season mode.** An 8-team, 14-week season with standings, tiebreakers and a 4-team playoff. You can watch or simulate any game. Injuries carry over week to week, players develop in the offseason, and the league tracks season and career leaders and a champions history.
- **Game management.** Clock rules include runoff by tempo and out of bounds late in halves, the two-minute warning, timeouts, hurry-up, spiking the ball, the 10-second runoff, victory formation, intentional safeties, and kneel-downs. Also modeled: 4th-down and field goal decisions from kicker range and coach aggression, a 2-point chart, and the 2025 overtime rules.

### Realism checks

`node tools/headless.mjs 24` simulates 24 full games and prints league averages next to NFL norms. At the time of writing it produces about 25 points, 63 plays, 7.5 yards per attempt, and a 58–64% completion rate per team-game, with realistic punt, turnover, and field goal rates, about 4–5 accepted penalties per team, and 1–1.5 in-game injuries per team. Sacks (about 1 per game vs. the NFL's 2.3) and third-down conversion (about 32–38% vs. 39%) still run a little low. Other harnesses:

- `tools/playstats.mjs [run|pass] N`: outcome distributions per play and coverage
- `tools/passdiag.mjs N`: throw timing, air yards vs YAC, completion by depth
- `tools/rushdiag.mjs`: pressure and sack timing when the QB never throws
- `tools/openfield.mjs depth lateral`: one-on-one open-field tackling
- `tools/trace.mjs <play> <coverage> <seed> [-a]`: a single play, including an ASCII field view
- `tools/stdiag.mjs`: onside, squib and fake success rates
- `tools/eventcount.mjs N`: how often reviews, spikes, onside kicks, fakes and audibles happen
- `tools/weatherdiag.mjs`: scoring and turnovers by weather type
- `tools/snapdiag.mjs`: snap shares by depth-chart slot (rotation check)
- `tools/seasondiag.mjs`: simulates a full season

## Customizing

- **Teams and players:** use the in-app editor, or export, edit, and import the league as JSON.
- **Playbook:** add formations, routes (waypoints relative to alignment), and concepts in `js/sim/playbook.js`. The play-caller picks them up automatically.
- **Tuning knobs:** tackle probability and reach (`checkTackles` in `playsim.js`), block shed rates (`engagements`), QB read thresholds (`qbPass` in `ai.js`), and man-coverage lag (`manThink`). Penalty rates are set where each flag is thrown (`foul(...)` calls in `playsim.js`, plus `rollPreSnap` in `penalties.js`). Injury rates are the `maybeInjure(...)` calls in `playsim.js`.
