# Realism roadmap

This roadmap covers 18 additions, grouped into phases. Each phase keeps the existing constraints:

- `js/sim` stays DOM-free, so it runs in Node.
- There is no build step.
- Every simulation change is checked against NFL norms with `node tools/headless.mjs 24` before and after.

Status key: ☐ not started · ◐ in progress · ☑ done

**Status: all 18 items ☑ done.** Notes on deviations from the plan are inline below.

## Phase 1: Calibration (items 1–3) ☑
Fix the stats that are measurably off first, so later features are layered onto a sound baseline.

| # | Item | Approach | Target |
|---|------|----------|--------|
| 1 | Completion % | Reduce breakups at the catch point. Defenders should only contest when in phase: arriving before the ball, or with the receiver's back turned to the ball. Trailing defenders get a small chance. | ~64–66% cmp, PBU ~11% of attempts |
| 2 | 3rd-down conversion | On 3rd and 4th down, the QB weights reads by whether the catch point reaches the first-down marker, and the play-caller picks concepts whose route depths reach the sticks. | ~38–40% |
| 3 | Sack rate | Trim the pass-rush shed rate after the scramble-sack fix. | ~2.3 / team-game |

## Phase 2: Offense and defense playbook (items 4–8) ☑

| # | Item | Approach |
|---|------|----------|
| 5 | Screens | Add new routes: RB screen, WR tunnel, and bubble (already exists). Linemen pass-set for about 1 second, then release to a screen landmark and block the nearest defender. The QB throws on a fixed timing to the screen target, not through a progression. |
| 4 | Pre-snap motion | A formation slot can have a `motion` path run during the set phase. A man defender follows the motion man across the formation; zone defenders don't. The QB's pre-snap read gets a man-or-zone "tell" that biases progression order, for example beating man with crossers. |
| 6 | RPO / read option | New `rpo` and `option` run schemes. The QB reads a key defender at the mesh: for the read option, the edge defender (hand off if he stays wide, keep if he crashes); for an RPO, the overhang defender (throw the quick route if he fills against the run). |
| 7 | Audibles / hot routes | Before the snap, the QB compares box count against the play type (run into 7 or more defenders in the box leads to a pass check; pass into a light box can check to a run). A blitz look turns a vulnerable route into a hot route: the receiver breaks early on a slant or sit route. |
| 8 | Disguised coverage | Defenses align in a "shown" shell and rotate to the real one at the snap: two-high to single-high rotation, and simulated pressure, where a lineman drops into a zone and a linebacker rushes. The QB's pre-snap read is based on the shown shell, so a successful disguise produces worse reads. |

## Phase 3: Players (items 10–12) ☑

| # | Item | Approach |
|---|------|----------|
| 10 | Fatigue and rotations | Each player has an energy level from 0 to 1 that drains with snaps and effort (sprinting, blocking) and recovers between plays and on the sideline. Effective speed, acceleration and strength scale with energy. The depth chart rotates tired defensive linemen and running backs, and personnel packages sub by formation. |
| 11 | Player traits | Each player gets 0–2 traits from a trait list, generated per archetype and editable in the team editor. Examples: scrambler, gunslinger, pocket passer, possession receiver, deep threat, workhorse, run stopper, pass-rush specialist, ball hawk. Traits change behavior (read thresholds, route tendencies, pursuit), not just ratings. |
| 12 | Momentum and clutch play | A team momentum value that shifts on big plays, turnovers and scores, plus crowd noise. Momentum and clutch ratings give small, capped rating modifiers late in close games. The home crowd raises the chance of false starts and slows the QB's reads. |

## Phase 4: Game day (items 9, 13–16) ☑

| # | Item | Approach |
|---|------|----------|
| 9 | Adaptive play-calling | The play-caller tracks per-game results (yards per play by run/pass, by concept family, and against man/zone) and shifts weights toward what works. At halftime it recomputes tendencies. The defense adapts to the offense's run/pass mix and favorite concepts. |
| 13 | Weather | Weather is chosen per game in New Game: clear, rain, snow, wind, or cold. It affects ball security, catching, throw accuracy and distance, kick range, and footing (acceleration and cuts). Rendered with particles, a darker sky, and wind shown on the scorebug. |
| 14 | Coach's challenges / replay | Close calls (catch vs. no catch at the sideline, spot of the ball on 3rd and short, fumble vs. down) are flagged as reviewable. The coach challenges based on how likely the call is to be overturned and on game leverage, with 2 challenges per game. Turnovers and scores get automatic review. Overturns replay the result with the corrected outcome. |
| 15 | Onside kicks, fakes, squib kicks | An onside kick when trailing late, with a recovery chance of about 10–15% under current rules. Fake punts and fake field goals are called by aggressive coaches on 4th and short. Squib kicks come late in halves. |
| 16 | Clock nuances | Spiking the ball to stop the clock; the 10-second runoff on offensive fouls in the last minute; a runner stepping out of bounds on purpose (already partly done); victory formation; burning the play clock when leading; an intentional safety when deep in their own territory and protecting a lead. |

## Phase 5: Beyond one game (items 17–18) ☑

| # | Item | Approach |
|---|------|----------|
| 17 | Season mode | A new `js/season/` module with a 14-week schedule for 8 teams (a double round-robin; with 8 teams, each plays every opponent home and away), standings, tiebreakers, and a 4-team playoff. Games can be watched or simulated. Injuries carry over from week to week, player development happens in the offseason, and the season is saved in localStorage. |
| 18 | Stat leaders and history | Season and career leaderboards (passing, rushing, receiving, sacks, INTs), game logs, and past champions, with JSON export/import. |

## Order of work
Phase 1, then 5, 4, 6, 7, 8, then 10, 11, 12, then 13, 15, 16, 14, 9, then 17 and 18. Each item is complete when it:
1. is implemented,
2. shows its effect in the play-by-play or on screen,
3. passes the 24-game headless check within NFL tolerance.

## Notes from implementation
- **Fakes:** both fakes ended up as a pass to a wing who leaks out. Direct-snap runs stalled against the rush lanes, while the pass version converts at believable rates (about 30–45%).
- **Screens, RPOs and pass accuracy:** screens and RPOs are high-percentage plays, so adding them raised completion rates. This was rebalanced with baseline throw placement error and pass-rate tuning.
- **Performance:** a simulated game takes about 2 seconds, so a full season takes about 2 minutes. The season screen simulates in chunks with a progress line so the page stays responsive.
