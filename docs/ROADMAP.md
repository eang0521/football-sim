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

---

# Round 2: 19 improvements

Round 2 follows the same rules as round 1. Every sim change is checked in two ways:
- the 48-game headless check on both leagues (`tools/headless.mjs 48`, with and without `--league private/nfl-league.json`);
- a full NFL season (`tools/nflseason.mjs`) compared with NFL leader and distribution norms.

Status key: ☐ not started · ◐ in progress · ☑ done

## Phase 6: Game realism (items 6–11)

| # | Item | Approach | Status |
|---|------|----------|--------|
| 6 | Personnel packages | Each coach gets a personnel mix (10/11/12/21/22) that depends on the situation: heavier on short yardage and at the goal line, lighter on long yardage and in the two-minute drill. Offensive calls pick personnel first, then a formation in that grouping, then a play that fits. Add a 12-personnel shotgun formation. The defense matches personnel with base, nickel or dime (already partly done), and the play-by-play shows the personnel. | ☑ |
| 7 | Formation-aware calling and self-scouting | The offense tracks its run/pass split by formation during the game. When a formation becomes predictable (say 80% run), the caller pushes against its tendency from that look. The defense reads the same tendency: it loads the box or plays two-high based on what the offense has shown from that formation. | ☑ |
| 8 | Returners and special teams | Choose kick and punt returners by skill: speed, agility and elusiveness, favoring backups and skill players. Special-teams ratings come from existing ratings (gunners use speed and tackling, blocking units use strength). Add blocked FGs, PATs and punts, with the chance depending on the rush against the protection and the kick's trajectory. A blocked kick can be returned. | ☑ |
| 9 | Win-probability decisions | A small win-probability model built from score, time, field position, down and distance, and timeouts. Fourth-down calls (go, kick or punt) and two-point tries compare the WP after each choice, using each team's own success rates (kicker range, short-yardage success), shifted by coach aggression. The play-by-play notes aggressive calls. | ☑ |
| 10 | Clock edge cases | The defense calls timeouts to get the ball back when trailing late. The offense hurries (no-huddle, spike, sideline routes) when trailing on the last drive. Hail Mary from 40+ yards out with 5 seconds or less left in a half, as a max-protect verticals play with a jump-ball resolution. Kneel-downs before halftime. | ☑ |
| 11 | Injury realism | In-game severity drives time out: day-to-day, weeks, IR (4+ weeks) or season-ending. For NFL players the risk uses Madden's injury and toughness ratings, and fictional players get a durability value. Season mode tracks IR and return weeks, and the injury table shows the designation. | ☑ |

## Phase 7: NFL mode (items 12–15)

| # | Item | Approach | Status |
|---|------|----------|--------|
| 12 | Real schedule | The importer fetches the current NFL regular-season schedule from ESPN, with weeks, home and away teams, and byes. A season for the NFL league uses it, and falls back to the generated 17-game schedule when it's missing. | ☑ |
| 13 | Live refresh | `import-nfl.mjs --refresh` re-pulls the latest Madden ratings iteration plus ESPN injuries and transactions. Injured players are flagged out, so they start the season injured, and rosters follow Madden's current team assignments. A "last updated" stamp appears in the editor. | ☑ |
| 14 | Compare to reality | The season leaders view can show each player's real stat line from last season next to his simulated line, and the player card shows both. | ☑ |
| 15 | Real depth charts | The importer pulls ESPN depth charts (the offense, defense and special-teams charts) and stores a depth rank per position. The depth chart then uses ESPN's order, falling back to Madden's order, and imported returners come from ESPN's KR and PR slots. | ☑ |

## Phase 8: Tuning (items 1–5)

Tuning is done after phases 6 and 7, since those change the balance.

| # | Item | Approach | Target | Status |
|---|------|----------|--------|--------|
| 1 | DT TFL / LB gap-shooting | Linebackers scrape and shoot gaps on run blitzes and when they read run early, so some TFLs come from linebackers. Interior linemen seldom beat a double team. | DT leader ≤ 25 TFL; LBs ~30% of TFL | ☑ |
| 2 | CB vs LB coverage stats | Corners in tight man or trail coverage get more pass breakups at the catch point. Underneath lane deflections are rarer. | CB > LB for PD and INT; CB ~50% of PD | ☑ |
| 3 | Re-center the fictional league | Make the generated league's defensive depth match the NFL league's so both run the same mechanics near the same averages. | fictional ~22–23 pts, ~39% 3rd | ☑ |
| 4 | Squash the shed curve | Replace the pure exponential rating edge in block sheds with a saturating (logistic) curve, so wider talent spreads don't inflate sacks and stuffs. | leagues within 0.3 sacks/g | ☑ |
| 5 | Fumbles | Lower fumble rates on routine tackles; keep strip-sacks and hits by hard hitters. | ~0.4 lost per team-game | ☑ |

## Phase 9: Quality of life (items 16–19)

| # | Item | Approach | Status |
|---|------|----------|--------|
| 16 | Web Worker sims | Bulk simulation (Sim game, Sim week or season) runs in a pool of Web Workers that post results back. The main thread stays responsive, and a week of NFL games takes a few seconds. Falls back to the chunked main-thread sim if workers fail. | ☑ |
| 17 | Stats pages | A Stats screen with sortable league-wide player tables (passing, rushing, receiving, defense, kicking), team stats (offense and defense per game), and a player page with a game log. | ☑ |
| 18 | Replays and highlights | Record per-frame positions of every player and the ball for each play (compact, quantized). Replay the last play from the controls, and after each game build a highlights reel of the biggest plays by EPA or WP swing. | ☑ |
| 19 | Mobile layout | Collapsible team list, horizontally scrolling stat tables, a sticky season header, and larger tap targets. Checked at 375px width. | ☑ |

**Status: all 19 items ☑ done.** Items 1 and 2 are only partly at target; the notes below say where.

## Order of work
Items 6, 7, 9 and 10, then 8 and 11 (sim features), then 12, 15, 13 and 14 (NFL data), then 1–5 (tuning), then 16–19 (UI).

## Notes from implementation
- **Personnel (6):** usage lands near the NFL: 11 at about 67%, 12 at 21%, 21 at 8%, 10 at 4%, 22 at 1%. Heavier groupings run more (12 at 43%, 21 at 51%).
- **Win probability (9):**
  - A smooth normal-curve model was too pessimistic late in games, because points come in chunks (a field goal ties a 3-point game). It was replaced with a possession model: the current drive's TD/FG odds from field position and clock, then alternating league-average drives, with an exact final-margin distribution.
  - Going for it needs a win-probability edge of 0.9–2.5 points (smaller for aggressive coaches). The result is about 1.2 fourth-down attempts per team-game outside late comebacks, and 0.25 two-point tries.
- **Hail Mary (10):** 5% touchdowns and 14% interceptions over 300 tries.
- **Blocked kicks (8):** FG 1.6%, punt 1%, PAT under 1%. Returners now come from backups.
- **NFL data (12–15):** live data is cached per day. Players not on any current NFL roster are dropped, players traded mid-season move to their new team, and ESPN depth charts set the starters and returners. A real-schedule season can start at the current week using the real results so far, with current injuries, IR and suspensions carried over.
- **Tuning (1–5):**
  - The biggest fix was **QB behavior under duress**. The QB used to scan every receiver when pressured and throw to the most open one, so pressure made passing *more* efficient and a stronger rush produced fewer sacks. Under duress he now sees only his current read and his checkdown, and reads them worse.
  - **NFL-league sacks** ran high for two reasons. Imported traits came from the same ratings they bumped (a Pass Rush Specialist got +5 on top of an already elite rating), so the bump is now removed for imported players. And the Scrambler trait went to nearly every mobile QB; it now goes only to true runners, since scrambles that start deep usually end behind the line and count as sacks.
  - Calibration now anchors on the actual depth-chart starters.
  - Block sheds use a saturating (logistic) rating edge instead of an exponential one.
  - Backfields share carries: RB2 gets about 26% of snaps, 12% behind a workhorse.
  - Fumbles are at about 0.4 lost per team-game.
- **Still short of target:**
  - **DT TFL leaders** post about 30–40 (NFL leaders about 20–25). DTs still make about 45% of TFLs, though linebackers now shoot gaps on some runs.
  - **Passes defended:** corners lead interceptions clearly (about 55%) but lead linebackers on passes defended only narrowly.
  - An occasional workhorse back still posts a 2,400-yard season.
- **Performance (16):** a Web Worker pool simulates a 16-game NFL week in about 12 seconds in the browser.
- **Replays (18):** watched and bulk-simulated games record frames at 30 fps. The last 3 plays and the top 10 by win-probability swing are kept, at about 15 KB per play.
