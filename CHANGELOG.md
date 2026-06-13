# Changelog

All notable changes to 7 Fichas are documented in this file.
Format: [Keep a Changelog](https://keepachangelog.com/en/1.0.0/). Versioning: [SemVer](https://semver.org/) — see [VERSIONING.md](VERSIONING.md).

## [1.2.0] – 2026-06-12

### Added
- **ISMCTS-powered Master difficulty (backlog item 0f).** At Master, the AI's fallback decision path is now an Information Set Monte Carlo Tree Search (Cowling, Powley, Whitehouse — IEEE TCIAIG 2012) at 1000 iterations per move, replacing the previous static-score + Monte Carlo blend. New modules: `docs/js/ai/ISMCTSEvaluator.js` (algorithm core, near line-for-line port of the canonical Cowling et al. Python reference) and `docs/js/ai/ISMCTSGameState.js` (adapter wrapping `GameState`/`Chain`/`Hand` with the ISMCTS interface; determinization delegates to `PlayerView._sampleValidDeals(1)`).
  - 500-match A/B vs. the prior Master configuration: **63.4% ± 4.2% (CI 59.2–67.6%)** at 1000 iterations, with healthy seat balance (64.4 / 62.4). Equivalent results at 5000 iterations (65.6% in the parallel 500-match run); 1000 chosen for ~3.5× lower latency. Mean wall time per AI move ~4 ms; max ~75 ms — imperceptible behind the UI's existing AI thinking delay.
  - Algorithm summary: each iteration *determinizes* (samples one possible hidden-state consistent with everything the observer has seen), descends the tree with UCB1, expands one new child, plays a random rollout to terminal, backpropagates wins/visits. The most-visited move at the root is chosen.

### Changed
- **Difficulty ladder rewired.** **Master** now uses ISMCTS in the fallback (above). **Experienced** now uses the *default* adaptive Monte Carlo blend (depth 1–6, samples 30–100) — i.e. the configuration that was Master in v1.1.x. The previous "experienced → light MC" override (`maxDepth: 3, maxSamples: 50`) was dropped: Experienced is now the strongest *rule-based* configuration the project has shipped.
- **Beginner** unchanged.
- **`SmartAI.useISMCTS[]` per-seat flag removed** — Master enables ISMCTS unconditionally based on `difficulties[playerIndex] === 'master'`.
- **At Master, the existing `randomizeTolerance = 5` becomes a no-op** because ISMCTS sets `finalScore = Infinity` on its chosen move, collapsing the "within 5 of top" set to that single move. ISMCTS already has stochasticity from random rollouts and determinization, and the most-visited-root pick is itself an ensemble across thousands of sampled hidden states — so the AI doesn't become brittlely deterministic. Adding randomness among ISMCTS top-N picks is queued as a possible follow-up if needed.

### Documentation
- **README.md** rewritten for v1.2.0: file tree adds `ISMCTSEvaluator.js` / `ISMCTSGameState.js`; the difficulty ladder table contrasts MC-blend (Experienced) vs ISMCTS (Master) fallbacks; AI Decision Flow diagram updated; the long-standing 9-vs-10 scoring-table inconsistency fixed (Opponent Suit Avoidance row added); new "Information Set Monte Carlo Tree Search (Master Fallback)" section with full attribution to Cowling/Powley/Whitehouse (DOI link, paper citation), pointers to the canonical Python reference (`~/Documents/Claude-code-projects/ISMCTS-Dominoes/president/framework.py`), and acknowledgment of [isaacbuckman/Dominoes](https://github.com/isaacbuckman/Dominoes) (4-person partnership ISMCTS adaptation) and [angeris/DominAI](https://github.com/angeris/DominAI) (Negamax + PIMC/IMS alternative we considered).
- **BACKLOG item 0f** moved to `## ✅ Shipped` (v1.2.0).
- **`docs/DESIGN.md`** — the v1.1.2 design doc for item 0f remains as-is; it accurately documents the implementation approach that shipped.

## [1.1.2] – 2026-06-09

### Fixed
- **AI takes bad offensive cuadrar decisions.** The trigger in `_findHighConfidenceBlock` was `pipAdvantage > 0` — any positive estimated pip advantage would fire an offensive close. New `--pip-accuracy` instrumentation in the harness measured the underlying pip-advantage estimator: **RMSE ≈ 9.3 pips, false-profitable rate 24.9%** (1 in 4 times the AI said "closing is profitable" the actual pip-advantage was zero or negative). The threshold was a knife-edge against a noisy signal. Mario observed the failure in real play: partner created a cuadrar that lost the cerrar by 35 points despite the AI estimating a positive pip advantage.

  Fix: introduced per-seat `cuadrarPipThreshold`, default 5. Offensive cuadrar now requires the estimate to exceed the noise floor before firing. Measured impact at threshold 5 over 200 matches (`--all-variant cuadrar-thresh-5 --instrument`):
  - Offensive cuadrar volume dropped 15× (37.6% of closes → 2.4%)
  - **Offensive cerrado win rate rose 90% → 100%**
  - Mean pip margin on winning closes rose +12.6 → +20.8
  - Total closed hands fell ~16% (more games now end via domino instead of premature close)

  500-match win-rate A/B: 51.4% (CI 47.0–55.8%) — slightly positive trend, consistent with the established self-play pattern that move-quality fixes don't move symmetric win rate but do produce real-world correctness gains.

### Added
- **`--pip-accuracy` mode in the tournament harness.** At each `chooseMove`, snapshots the AI's `_estimateTeamPips.pipAdvantage` and compares against ground truth computed directly from `state.hands`. Reports mean signed error, RMSE, sign-mismatch rate, and false-profitable rate, bucketed by tiles played. Used to fit the v1.1.2 threshold; will inform any future cuadrar / pip-estimation work.

## [1.1.1] – 2026-06-09

### Fixed
- **Tile-probability calibration drift.** Measurement under backlog item 0c (300 matches, 7.44M predictions) showed `PlayerView.getProbability` was systematically under-confident across the 50–90% range (+0.02 drift per bin, monotone, well above sampling noise) and slightly over-confident in the 10–30% range. Fit a Platt-scaling recalibration in logit space — `P_cal = σ(1.10·logit(P_raw) + 0.04)` — and applied it as a thin post-hoc layer at the end of `PlayerView.getProbability`. Verification with `--all-variant calibrate --prob-accuracy` over 200 matches: max bin drift dropped from +0.023 to +0.008, and the 50–90% range mean drift went from +0.022 to −0.002. Win-rate A/B over 500 matches was neutral (49.2% ± 4.4%, CI 44.8–53.6%) — locked in on the same correctness-fix precedent as v1.1.0's accurate-firme and accurate-dominance. Constants a, b should be re-fit if `HandTracker`, `PlayerView` affinities, or MC sampling change meaningfully (use `tools/tournament.js --all-variant ... --prob-accuracy`).

### Added
- **`--prob-accuracy` mode in the AI tournament harness** (backlog item 0c, phase 1). Snapshots every `PlayerView`'s belief about who holds each unplayed, not-own tile before each `chooseMove`. Scores Brier and log-loss against ground truth from `state.hands`, bucketed by tiles-played (0–3, 4–7, …, 24–27) and partner-vs-opponent, plus a 10-bin calibration curve. Used to validate v1.1.1 calibration; will drive future inference work (item 0c phases 2–3 + item 0d).

### Notes on 0c phase 1
- Overall Brier 0.207; sharpens monotonically from 0.220 (early game) to 0.155 (very late) — a ~30% reduction across the hand. Inference *does* improve with information, primarily in the mid-late game (tiles 12+).
- Partner and opponent predictions are statistically indistinguishable at scale.
- 57% of all predictions land in the 30–40% "weak evidence" bin (3 candidates, near 1/3 base rate). Sharper inference signals would push more predictions out of this bin — that's where future Brier gains live.

## [1.1.0] – 2026-05-28

### Added
- **AI firme strategy.** `firmeProtection` now evaluates three move-effect signals beyond preserve/spend:
  - Bonus for moves that newly expose a latent firme on the new open end (you already hold every remaining V-tile, you're just turning the chain to show V).
  - Penalty for moves that play your *last* V-tile when an opponent likely holds every other unplayed V-tile — by playing it you'd hand them a firme on V.
  - Partner-leading damper: when your partner is the overall leader (fewest tiles), the preserve bonus is scaled down by P(partner can play the other end) — i.e. hoarding a firme costs less when partner can keep the chain alive, more when partner is blocked on the other side.
- **Master-AI move randomization.** Expert-level AI players now pick uniformly among moves within 5 score points of the best instead of always selecting the single top move. Reduces predictability against humans at no measured self-play cost (500-match A/B: 48.8% ± 4.4%).
- **AI tournament harness** (`tools/tournament.js`). Headless Node CLI runs N AI-vs-AI matches and reports per-team / per-seat stats, decision-priority breakdown, scoring-factor histogram, score-margin distribution, and closing-effectiveness analysis. Supports `--ab --variant NAME` Champion-vs-Challenger testing with 95% confidence intervals (challenger team alternates each match to cancel seat bias), `--all-variant` for measuring a change in isolation, and `--instrument` for full decision telemetry. Added a root `package.json` (`type: module`) so `docs/js` loads as ES modules under Node; browsers and the deployed static site are unaffected.
- **SmartAI `onDecision` instrumentation hook.** Optional callback emitting a structured per-move record (priority taken, score margin, dominant factor, block type, certainty, etc.). Default null — no production overhead when nothing is listening.
- **Decision-flexibility metric** in the harness instrumentation: counts what fraction of fallback decisions have ≥2 moves within 5/10 score points of the top.

### Fixed
- **Firme detection off-by-one.** `getRemainingInSuit()` counts suit *faces* (a played double counts as 2), so once V|V is played it under-reports the unplayed V-tile count by 1. Firme detection compared face count against a hand-tile count, producing both false negatives (missing a real firme after the double is played) and false positives (claiming a firme when an opponent still holds a V-tile). Added `getRemainingTilesInSuit()` and wired firme detection through it. Confirmed non-regressive in a 500-match A/B (48.8% ± 4.4%, seats 122/122).
- **`suitDominance` factor inherited the same bug** in its denominator: `(myTeamCount − oppCount) / remaining × 50`, where the numerator was in tile units but the denominator was face count. Migrated to `getRemainingTilesInSuit`. Confirmed non-regressive in a separate 500-match A/B (49.6% ± 4.4%).
- **Claude API model.** The Cloudflare Worker proxy was pinned to `claude-3-haiku-20240307`, which Anthropic has retired. Post-game play-style analysis returned `not_found_error` on every call. Updated the Worker to `claude-haiku-4-5-20251001` and redeployed.
- **Claude API error surfacing.** `ClaudeService.analyzePlayStyle` only checked `data.message`, so an Anthropic error envelope (`{ type: 'error', error: { message } }`) was missed and reported to the user as the generic "Unexpected response format". Now reads `data.error.message` so the real cause (e.g. retired-model) reaches the UI and the console.

### Changed
- **`firmeProtection` factor structure** internally split into `preserveScore` (existing spend/preserve + new latent-firme creation bonus) and `oppPenalty` (new opp-firme trigger). Only `preserveScore` is damped by the partner-leading override; handing an opponent firme is bad regardless of partner state.

### Documentation
- **`BACKLOG.md`** updated with the harness/A-B capability writeup, the closing-effectiveness findings (offensive cuadrar ~90% win rate, defensive ~44% by design, incidental ~57%), and the meta-finding that move-quality tweaks consistently wash out in symmetric self-play.
- **`CHANGELOG.md`** introduced (this file) per `VERSIONING.md` procedure.
- **`VERSION`** file introduced at project root, single-string SemVer.

### Notes on AI-strength experiments
Eight tuning variants were measured this release (`mc-pass`, `no-def-close`, `def-close-1`, `pip-close`, `lookahead2`, `rand5`/`rand10`, `accurate-firme`, `accurate-dominance`, `firme-strategy`). All ranged 47.8–51.3% over 500–1500 matches — within or right at the edge of noise. Two patterns:
1. Move-quality calibration tweaks do not move symmetric self-play win rate. The static scorer is well-balanced.
2. The exploitable gap appears to be AI determinism, not scoring. `rand5` shipped on that basis.

The firme-strategy variant is locked in even though its self-play impact is neutral: the encoded reasoning (your three notions) is strategically correct, and self-play is the wrong yardstick for changes that target *human* play patterns.

---

## [1.0.5] – 2026-05-23

### Added
- **Team-Contextual Play Inference (backlog 0b).** End-choice inference now interprets each play in the context of team strategy rather than as an isolated event: playing on the partner-suit end is the expected team move and carries little information, while playing *against* the partner-suit end is surprising and updates the unchosen-end suit-probability more strongly. Drives `SmartAI.analyzePlayChoice` → `PlayerView.applyAffinitySignal`. Cuadrar plays now amplify the upward affinity for the squared value and override `signaledSuits`.

## [1.0.4] – 2026-04-18

### Added
- **Smarter cerrar AI.** Cerrar (closing) decisions improved by tracking the outcome of each close attempt (`SmartAI.cerrarLog`) and feeding it back into the decision criteria. Cerrar-log dev diagnostic added for offline analysis.

### Fixed
- **Match-end modal touch bleed-through on iPad.** Modal could appear with a touch already registered, causing immediate dismissal. Now the `New Match` button locks for 2.5s after the modal appears, and an explicit button press is required to start a new game.
- **Cerrar log missing match-ending hands.** The final hand of a match wasn't being recorded in the cerrar diagnostics.

## [1.0.3] – 2026-03-03

### Added
- **Configurable AI difficulty levels.** Per-seat difficulty selector (beginner / hard / master), wired through `SmartAI.difficulties` and persisted in settings.

### Fixed
- Cerrado badge condition.

## [1.0.1] – 2026-03-03

### Changed
- Skip the AI thinking delay when a player has only one tile left — the move is forced and the deliberation indicator is misleading.

## [1.0.0] – 2026-03-02

### Added
- **PWA support — installable on iPhone and Android.** Added `manifest.json`, `service-worker.js` (cache-first for static assets), iOS-friendly icons (192/512/apple-touch). The site is now installable from Safari/Chrome with "Add to Home Screen": app icon, full-screen launch (no browser chrome), works offline, localStorage persists.

## [0.4.6] – 2026-03-02

### Changed
- **Fixed chain position / stable tile layout.** Start tile (la salida) pinned to the horizontal center of the table at all times. Left arm folds upward above the anchor row, right arm folds downward below it; each continuation row uses the full container width. L-shaped turn connectors indicate where each arm wraps at the wall. `Chain.firstTileIndex` tracks the split point between left arm, start tile, and right arm. Pip flip logic preserves connecting-pip alignment after each wall turn.

## [0.4.5] – 2026-02-17

### Added
- Opponent suit avoidance factor (`factors.oppSuitAvoidance`) — penalize moves that leave end values in opponents' signaled suits.
- Cuadrar vs. cerrar distinction in the AI's strategic vocabulary.
- Mexican domino terminology surfaced in the explainer and translations.

## [0.4.4] – 2026-02-17

### Added
- **Affinity-weighted Monte Carlo sampling.** MC deal sampling now weights tile assignments by `PlayerView` Bayesian affinities so simulated deals respect inferred suit preferences.
- **Firme advice from Genín** — coaching text identifies firme situations and explains spend vs preserve choices.
- **Partner-support rework** — Priority 3 (early-game partner support) now uses the affinity-weighted view rather than raw HandTracker.

## [0.4.3] – 2026-02-16

### Added
- Enriched advice detail for Genín — richer per-move explanations including factor attribution and traditional terminology.

## [0.4.2] – 2026-02-12

### Fixed
- Probability engine bugs surfaced by the accuracy analyzer.

### Added
- Probability accuracy analyzer continues from v0.4.1.

## [0.4.1] – 2026-02-12

### Added
- **Probability accuracy analyzer with Brier scoring.** Debug-mode tool that captures probability snapshots before each play, compares to ground truth at hand-end, and reports Brier scores per factor. Useful for diagnosing where the inference layer is over- or under-confident.

## [0.4.0] – 2026-02-11

### Added
- **Per-player probability views with Bayesian play-pattern inference.** Introduced `PlayerView` so each computer player has its own perspective on the game: knows own tiles exactly, doesn't know other players' tiles, and tracks Bayesian suit affinities from observed plays (salida, end choices, cuadrar). Replaces direct `HandTracker` access in `SmartAI.scoreMove` with `activeView`-aware probability lookups.

## [0.3.6] – 2026-02-11

### Added
- Pulsing pass badge on player position when they pass on a suit.
- Debug-mode probability tables (enabled with `?debug=ai`) showing per-player suit-count estimates and Bayesian affinities.

## [0.3.5] – 2026-02-11

### Changed
- Pass events now visually prominent — pass badge animation and log color updates.

## [0.3.4] – 2026-02-11

### Fixed
- Suit-signal detection (`signaledSuits`) and `suitDominance` double-counting when the same tile contributed to both teams' counts.

## [0.3.3] – 2026-02-11

### Added
- Team-aware suit dominance — `suitDominance` factor uses team totals instead of self-only.

### Fixed
- Pip column display in debug tables.

## [0.3.2] – 2026-02-11

### Added
- **Firme protection scoring factor** introduced (`factors.firmeProtection`). Initial implementation: spend penalty / preserve bonus on current open-end firmes. Detection uses `getRemainingInSuit` (face-count); the off-by-one when V|V has been played wasn't recognized until v1.1.0.

## [0.3.1] – 2026-02-10

### Fixed
- Partner-support inference — `signaledSuits` for the partner now correctly reflects their opening play.

## [0.3.0] – 2026-02-09

### Changed
- **Rebrand to 7 Fichas with EN/ES language support.** Renamed from "Domino Advisor" to "7 Fichas". Full i18n system with ~250 translation keys across English and Spanish, language toggle in header, browser-language auto-detection with localStorage persistence. Traditional domino terminology preserved (tranque, cerró, dominó). All UI elements, game messages, modals translated.
- **Genín mascot** — doodle-style illustration introduced as the coaching persona. Four poses (thinking / questioning / advising / celebrating) used in debrief, quiz, help, and match-win contexts. Introduces himself as "your domino coach" in the help modal.

## [0.3] – 2026-01-31

### Added
- **Probability-based AI decision-making.** `HandTracker` with Bayesian probability calculations: `getProbability(player, tile)`, `getPassProbability(player, value)`, `getBlockingProbability(player, v1, v2)`. Priority-override system in `SmartAI`:
  - Priority 1: winning move (domino)
  - Priority 2: high-confidence blocking (cuadrar with P > 0.7)
  - Priority 3: partner support in the first 8 plays
  - Fallback: weighted scoring across factors
- Fixes "mata la mano" failure where pip management overrode partner support.

## [0.2.1] – 2026-02-01

### Changed
- **Mobile viewport improvements.** Responsive layout for phones (480px) and very small screens (360px). Smaller dominoes on chain and hand, horizontal scrolling for hand tiles, 44px-minimum touch targets, full-width modal buttons, scrollable debrief tabs, compact table layout, responsive tilesPerRow based on screen width. L-shaped turn connectors with arrows indicating chain flow direction.

## [Pre-0.2.1] – January 2026

The following capabilities shipped before the changelog existed (drawn from the BACKLOG's prior `Completed Features` entries; specific versions not recorded in git):

### Added
- **User manual / help modal** — in-app `?` button in the header opens a modal with game overview, how-to-play, scoring rules, feature explanations (Quiz, Attribution, Debrief), and beginner strategy tips.
- **Player color coding & tile attribution** — four distinct player colors (You cyan, Opp 1 coral, Partner green, Opp 2 orange). Toggle to show who played each tile on the chain; subtle glow on attributed tiles; player indicator dots with initials (Y, 1, P, 2); color legend; log colors matched.
- **Hand prediction tracking & quiz mode** — `HandTracker.js` for probability tracking; quiz modal to test prediction skills; Predictions tab in debrief showing accuracy trends; localStorage persistence for quiz history.

---

*Earlier history (v0.1.x and pre-rebrand "Domino Advisor" work) lives only in git commit history.*
