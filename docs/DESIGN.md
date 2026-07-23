# Domino Advisor — Design Notes & Detailed Specs

> Full design detail for backlog items (schemas, AI/ML experiments, UX specs). The summary lives
> in [`BACKLOG.md`](../BACKLOG.md); this is the deep reference it links to.
> Shipped features are recorded in `CHANGELOG.md`.

---

## Pending Features

### STATS-1. Player Stats, Achievements & Badges
**Priority:** High
**Complexity:** Medium

Track lifetime player statistics, surface them on a dedicated stats page, and award badges as pop-up notifications when milestones are reached.

**Storage approach:**
- All data in `localStorage` via a thin `StorageService` abstraction so future upgrades (IndexedDB, cloud sync, Capacitor native storage) only touch one file
- Start with **lifetime aggregates** (option 1); schema designed to extend to per-match history (option 2) later without breaking changes

**Stats to track:**

*Matches*
- Played, won, lost, win %
- Current streak, best win streak
- Largest win margin, largest deficit overcome (comeback record)
- Zapatos given (won match with opponent at 0) / received (lost match at 0)

*Hands*
- Played, won, lost, tied
- By end reason: domino / cerrado / blocked × won/lost
- Largest single-hand score, largest single-hand surrender

*Cerrado*
- Your team total cerrados, win rate on cerrados attempted
- You vs. partner as closer (breakdown)
- Opponent cerrados against you
- Largest cerrado score (most points won), largest cerrado surrender

*Coaching*
- Genín agreement rate (your moves matching AI recommendation)
- Quiz accuracy lifetime and best session score

**Badge set (initial ~12):**
- `first_win` — Win your first match
- `first_cerrado` — Win your first hand by cerrar
- `cerrado_40` — Win a cerrado hand with 40+ points
- `cerrado_50` — Win a cerrado hand with 50+ points
- `zapato` — Win a match with opponent scoring 0
- `comeback` — Win a match after trailing 0–80
- `win_streak_3` / `win_streak_5` — Win 3 / 5 matches in a row
- `domino_master` — Domino 20 total hands
- `cerrado_master` — Win 10 hands by cerrar
- `genin_student` — Agree with Genín 20 times
- `independent_mind` — Override Genín's recommendation and win 5 times

**New files:**
- `docs/js/stats/StorageService.js` — thin localStorage wrapper (swap-friendly)
- `docs/js/stats/PlayerStats.js` — read/write stats, called from game events
- `docs/js/stats/BadgeSystem.js` — badge definitions + condition checks
- `docs/js/ui/StatsUI.js` — renders the stats page/panel
- `docs/js/ui/BadgeToast.js` — pop-up notification on badge earned

**Integration points in existing code:**
- `showHandEndMessage()` → record hand result, check hand/cerrado badges
- `showMatchEndMessage()` → record match result, check match/streak/zapato badges
- Quiz flow → record quiz score, check coaching badges

---

### STATS-2. PWA (Progressive Web App)
**Priority:** Medium
**Complexity:** Low
**Vision:** Installable iPhone/Android app without requiring App Store

Add a web app manifest and service worker to make 7 Fichas installable directly from the browser ("Add to Home Screen" on Safari/Chrome). This is the lowest-effort path toward a downloadable app experience.

**What it enables:**
- App icon on home screen, launches full-screen (no browser chrome)
- Works offline (service worker caches assets)
- localStorage / `StorageService` stats persist across sessions just as in the browser

**Requirements:**
- `docs/manifest.json` — name, icons, theme color, display: standalone
- `docs/service-worker.js` — cache-first strategy for all static assets
- Register service worker in `index.html`
- App icons at required sizes (192×192, 512×512 minimum)

**iOS limitations to be aware of:**
- Safari PWAs support offline + home screen but have limited push notification support
- localStorage in PWA mode persists unless user deletes the app

**Future path (not in scope here):**
- App Store distribution via a thin Capacitor wrapper (reuses all existing web code)
- `StorageService` swap to Capacitor's Preferences API for native-grade persistence
- Cloud sync / user accounts for cross-device stats

---

### 0. AI Enhancements (Future)
**Priority:** Medium
**Complexity:** Medium

Further enhancements to AI decision-making beyond initial implementation.

**Potential additions:**
- ~~Defensive priority (when opponent has 1-2 tiles)~~ *(implemented at threshold 2; A/B shows threshold 0/1/2 are all neutral in self-play)*
- Configurable blocking threshold (currently 0.7 — instrumentation shows blocks actually fire at mean P≈0.94, so it rarely binds)
- AI personalities (aggressive, conservative, etc.)
- Monte Carlo tuning (depth/sample parameters, evaluation function) — *2-ply scoring-based lookahead variant tested, only marginal vs. current MC blend*

**Status (May 2026):** Several of these can now be measured with the A/B harness (see Completed → *AI Tournament Harness & A/B Testing Framework*). Move-quality tweaks proved to be self-play washes; the productive direction was reducing AI predictability (rand5 shipped). Validate any future weight/strategy change with `node tools/tournament.js --ab --variant <name>`.

---

### 0b. Team-Contextual Play Inference
**Priority:** Medium
**Complexity:** High

Improve HandTracker's probability estimates by interpreting plays in the context of team strategy, not just as isolated events.

**The problem:**
Current Bayesian updates treat each play atomically: "player X played a 5." They don't ask *why* the player chose that end given their team situation. This leads to two missed signals:

1. ~~**Cuadrar plays underweighted**~~ *(implemented: cuadrar now overrides signaledSuit in `analyzePlayChoice`)*
2. **End-choice inference ignored** — when a player has multiple valid plays and chooses end A over end B, that choice is implicit evidence about their holdings on end B. Currently this is not modeled at all.

**Why team context is required:**
End-choice inference cannot be done per-player in isolation. Playing on the partner-suit end is the *expected* team move — it carries little information. Playing *against* the partner-suit end is surprising, and surprise carries far more inferential weight. Without knowing the player's team context (partner's signaled suit, team position), you cannot correctly weight the inference.

**Proposed approach:**
- For each play, compare chosen end vs. "expected" end given team context (`signaledSuits`, partner's suit)
- **Expected choice** (plays on partner-suit end): small or no update to unchosen-end probability
- **Surprising choice** (plays against partner-suit end): stronger downward update on unchosen-end suit probability
- **Cuadrar**: amplified upward affinity update for the squared value
- Implement in `SmartAI` (which holds team context) feeding into `HandTracker`, rather than inside HandTracker itself

**Depends on:** Understanding of `SmartAI.signaledSuits`, `HandTracker._bayesianUpdate()`

---

### 0c. Quantify Tile Probability Predictions at Scale
**Status:** In progress — Phase 1 (instrumentation + baseline) complete; Phase 2 (layer attribution) pending.
**Priority:** Medium-High
**Complexity:** Low–Medium
**Depends on:** Existing `ProbabilityAnalyzer` (v0.4.1, Brier scoring); AI tournament harness (v1.1.0)

The AI's tile-holding probabilities (`view.getProbability`, `getPassProbability`, MC marginals) drive most of `scoreMove`, but we currently only validate them in debug mode on individual games via `ProbabilityAnalyzer`. With the harness we can measure how accurate those probabilities are across hundreds of games **as a function of how many tiles have been played** — i.e. does inference get sharper or noisier as the hand progresses.

**Goal:** Quantify probability calibration over a tournament, bucketed by tiles-played, and identify where the inference layer is over- or under-confident.

**What to build:**
- Extend the harness with a `--prob-accuracy` flag that, per match, captures probability snapshots before each play (P(player p holds tile T) for every unknown tile from every player's view) and resolves them at hand-end against ground truth.
- Score with Brier (`(p − actual)^2`) and/or log-loss; aggregate per (tiles_played bucket × view perspective × tile type — own-suit vs cross-suit, doubles vs non-doubles).
- Report at end of tournament:
  - Calibration curve (predicted vs observed frequency, binned).
  - Brier score by tiles-played decile (does accuracy improve, plateau, or degrade?).
  - Per-layer breakdown so we can attribute accuracy gains/losses to `HandTracker` base, `PlayerView` affinity adjustments, or MC marginals.

**What we'd learn:**
- Whether inference accuracy degrades or improves with more plays (and where it bottoms out).
- Whether the affinity-driven adjustments are net-positive or net-noise at scale.
- Which inference signal each layer is actually contributing.

**Why this matters now:**
The v1.1.0 firme/dominance bug fixes were sanity-checked via win-rate A/Bs but inference accuracy was never measured directly. Without this telemetry, we can't tell whether future inference changes actually *improve probabilities* — only whether they shift win rate (which most don't, per the v1.1.0 experiments).

**Phase 1 results (300 matches, 7.44M predictions, May 2026):**
- Overall Brier 0.207 vs ~0.222 uniform baseline — meaningfully better than no information, modestly worse than ideal.
- Brier sharpens monotonically with tiles played: 0.220 (0–3 plays) → 0.155 (20+ plays), a ~30% reduction. Inference *does* improve with information.
- Partner and opponent predictions are statistically indistinguishable at scale (the 3-match smoke-test partner advantage was variance).
- Calibration curve shows a structural under-confidence in the 50–90% range: across four consecutive bins, the AI's predictions are ~+0.02 lower than reality (predicts 70%, actual 76%). Drift direction is consistent and the magnitude is well above SE at N=438K predictions across that range. The 0–30% bins show small over-confidence (~−0.01).
- 57% of all predictions land in the 30–40% bin — the "weak evidence" zone. Pushing predictions *out* of this bin (sharper inference signals) is where future Brier gains live.

**Phase 2 — Layer attribution (pending):**
Decompose the Brier and calibration drift across the three inference layers to attribute the source:
1. `HandTracker` raw N/M (no normalization, no affinity, constraint-propagation only)
2. `PlayerView._heuristicProbability` (affinity-adjusted, per-tile normalized, no MC)
3. `PlayerView` MC marginals (500-sample averaged)

Implementation: extend `captureProbSnapshot` in the harness to call each layer separately and accumulate Brier per layer. Knowing whether the +0.02 drift comes from affinity over-pulling toward the mean, MC sampling noise, or constraint propagation tells us whether to recalibrate post-hoc (cheap, no architectural change) or fix the layer (more principled).

**Phase 3 — Refinements (later):**
- Per-tile-type splits (doubles vs non-doubles).
- Per-viewer-side splits (seat 0 has full info on own hand; seats 1–3 are symmetric — measure whether seat 0 is meaningfully sharper or not).
- Trivial baselines computed in the harness (uniform 1/3, tile-count proportional) for direct comparison.

---

### 0e. Calibration Recalibration for Tile Probabilities
**Status:** Done — shipped in v1.1.1. See CHANGELOG for details.
**Priority:** Medium
**Complexity:** Low
**Depends on:** 0c Phase 1 (the calibration data)

The Phase 1 measurement (item 0c) found that `PlayerView.getProbability` has a structurally under-confident calibration curve in the 50–90% probability range (~+0.02 drift across four bins). The fix is textbook: fit a one-parameter logit-space recalibration (Platt scaling: `P_cal = σ(a · logit(P_raw) + b)`) to the measured calibration curve and apply it as a thin post-hoc layer at the end of `getProbability`.

**Fitted parameters (from the May 2026 data):** approximately `a ≈ 1.10, b ≈ 0.04`. This stretches predictions slightly away from the 30–40% baseline zone — lowers the over-confident low bins and raises the under-confident mid-high bins to match observed frequencies.

**What to build:**
1. Add `PlayerView.useCalibratedProbs` per-seat flag; when on, apply `_calibrate(p)` at the end of `getProbability`.
2. Add `calibrate` variant to the harness (`tools/tournament.js`).
3. Verification: run `--all-variant calibrate --prob-accuracy` over ~200 matches and check that the recalibrated calibration table shows ~zero drift across bins (validates the fit).
4. Impact: run `--ab --variant calibrate` over 500 matches.

**Expected effect:**
Most affected: `blockingPotential` (soft-evidence blocking signal in the 40–70% range), `_estimateTeamPips` / `_estimateSuitCount`, and the `suitDominance` factor (dominant 22–29% of fallback decisions). Priority 2 high-confidence blocks already fire at mean blockProb 0.94, well above the recalibrated zone, so P2 decisions should be largely unaffected.

**Caveat:**
A calibration A/B that *washes* would be informative — it would mean the AI's decisions are insensitive to a ~2pp probability shift, and we save the complexity. If it *helps*, lock in. Either way the recalibration improves the Brier and log-loss metrics from 0c regardless of win-rate impact, so it's a quality-of-inference fix even when the win-rate doesn't move.

---

### 0d. Design of Experiments for Scoring Weights
**Priority:** Medium
**Complexity:** High
**Depends on:** AI tournament harness (v1.1.0); per-seat scoring multipliers

The 10 scoring factors in `SmartAI.scoreMove` (`suitDominance`, `doubleManagement`, `partnerSupport`, `ownSuitProtection`, `firmeProtection`, `oppSuitAvoidance`, `blockingPotential`, `pipManagement`, `handFlexibility`, `paceControl`) have hand-tuned, frozen weights. The v1.1.0 instrumentation showed `suitDominance` dominates 22–29% of fallback decisions while `pipManagement` dominates only ~0.5% — strong evidence some weights are mis-tuned. Singleton A/Bs (8 of them in v1.1.0) all came back as washes because they tweak one knob at a time and miss interaction effects.

**Goal:** Empirically determine the win-rate-optimal weight set via Design of Experiments, and learn whether the static scorer is genuinely near-optimal or has interaction-driven improvements singleton A/Bs can't find.

**What to build:**
1. **Per-seat scoring multipliers** in `SmartAI` — `factorWeights[playerIndex]` defaulting to all 1.0, applied at the end of `scoreMove` (`factors.X *= factorWeights[p].X`).
2. **`--doe` mode in the harness**, two phases:
   - **Phase 1 — Screening.** Fractional factorial (Plackett-Burman or 2^(k−p) Resolution III–IV) varying 8 factor weights at ±50% with 16–32 design points. Identifies which weights actually move win rate. Each design point ≈ 300–500 matches A/B vs. baseline.
   - **Phase 2 — Response surface.** Central composite design over the 2–4 highest-impact factors from Phase 1. Quadratic regression fit to win-rate; locate the optimum and report a recommended weight set.
3. **Output:** ANOVA-style effects table for Phase 1, response-surface contour data + recommended weights for Phase 2.

**What we'd learn:**
- Whether the static scorer is genuinely well-calibrated (the working hypothesis from the v1.1.0 experiments) or has 1–2 weights that are notably mis-tuned.
- Whether interactions between factors matter — DoE catches these where singleton A/Bs cannot.
- Concrete recommended defaults for any future "Configurable AI Strategy Weights" UI (item #1 below — the user-facing sliders should be centered around the DoE-optimal values, not the hand-tuned ones).

**Caveat:**
If win rate is genuinely insensitive to weight perturbations (consistent with every singleton A/B coming back ~50%), DoE may also return "no significant effects." That's still a useful finding — it confirms scoring tuning isn't the lever and points future work at lookahead depth or anti-determinism instead.

---

### 0f. Information Set Monte Carlo Tree Search (ISMCTS)
**Priority:** Low / Nice-to-have
**Complexity:** High
**Depends on:** AI tournament harness (v1.1.0); `PlayerView._sampleValidDeals()` (already exists)

The existing `MonteCarloEvaluator` does flat sampling: draw ~50–100 determinizations, evaluate the move on each, average the result. This is sound but information-poor — each sample is evaluated independently, no statistics are shared across the distribution of hidden states. The v1.1.0 lookahead2 variant did one ply of opponent reasoning on a single most-likely deal — better but limited.

ISMCTS is the textbook approach for hidden-information games: build *one* search tree, pool statistics across thousands of sampled determinizations, use UCB1 to guide search toward branches that look strong *in expectation* across the distribution. It's the algorithm AlphaGo-style approaches would adopt for an imperfect-information game.

**Goal:** Evaluate whether replacing the flat MC evaluator with a proper ISMCTS search materially improves AI play, and what it costs to integrate.

**Background — algorithm in one paragraph:**
Each ISMCTS iteration: (1) *determinize* — sample one possible full hand state consistent with what the observer knows; (2) *select* — walk the tree from root using UCB1 (`wins/visits + c·√(log(avails)/visits)`); (3) *expand* — add one new child for an untried move; (4) *simulate* — random rollout to terminal; (5) *backpropagate* — increment visits and accumulate wins up the path. The move with the highest visit count at the root is returned. The "information set" prefix means moves are looked up by their game-tree position from the observer's POV, not by the true underlying state.

**Reference: [Cowling, Powley, Whitehouse — *Information Set Monte Carlo Tree Search* (IEEE TCIAIG, 2012)](https://ieeexplore.ieee.org/document/6203567).** A copy of the paper, the canonical Python reference implementation, and a 4-person-dominoes adaptation are cloned at `~/Documents/Claude-code-projects/ISMCTS-Dominoes/` (with `Papers/CowlingPowleyWhitehouse2012.pdf`, `president/framework.py`, and `framework.py` respectively). The algorithm core is ~100 lines.

**State-interface mapping (our types → ISMCTS interface):**

| ISMCTS requires | We have | Notes |
|---|---|---|
| `clone()` deep state copy | `Chain.clone()`, `Hand.clone()` | Need a top-level `state.clone()` wrapper |
| `clone_and_randomize(observer)` | `PlayerView._sampleValidDeals()` | The hard part of ISMCTS — and we already wrote it. See caveat under *Determinization*. |
| `do_move(move)` | `chain.play()` + state advance | Wrap as `ismctsState.doMove({tile, end})` |
| `get_moves()` | `Rules.getValidMoves(hand, chain)` | Returns array of `{tile, end}` |
| `get_result(player)` | `Rules.checkHandOver(...)` + pip counting | Map to `[0, 1]` for visits/wins accounting |

**Determinization strategy:**

`_sampleValidDeals()` currently uses *affinity-weighted* sampling — it biases the sampled deals using Bayesian suit affinities. ISMCTS theory assumes uniform sampling within the observer's information set. Using weighted sampling means ISMCTS will search the *weighted* distribution, which may or may not be what we want:
- **For**: the weights encode genuine evidence from observed plays; ISMCTS searching the weighted distribution should focus effort on plausible deals
- **Against**: the weights aren't perfectly calibrated; biased sampling can systematically push the search away from the true optimum

**Proposed**: support both. A per-seat or per-experiment flag chooses uniform vs. affinity-weighted determinization. A/B the two during validation. Default to affinity-weighted (matches existing AI's beliefs).

**Rollout policy:**

Vanilla ISMCTS uses uniform-random rollouts. This works but converges slowly. A common improvement: use a lightweight policy during simulation (e.g. a stripped-down version of our scorer, or the existing `_chooseMoveSimple` from beginner difficulty). The Cowling paper documents this trade-off.

**Proposed**: start with random rollouts (matches the canonical algorithm); add an optional scored-rollout variant if random underperforms.

**Integration mode:**

Three paths, in increasing scope:
1. **(A) Drop-in replacement of `MonteCarloEvaluator`.** Cleanest. The fallback path in `SmartAI.chooseMove` calls `monteCarloEvaluator.evaluateMove(move, ...)` for each candidate — replace with `ismctsEvaluator.bestMove(state)` and skip the static scorer's blend logic. P1/P2/P3 priorities (winning move, cuadrar block, partner support) stay unchanged.
2. **(B) ISMCTS as a per-seat variant** (flag `useISMCTS[]`, default false). Add as a harness variant alongside `lookahead2` / `rand5`. A/B against current code. Same pattern as every other v1.1.x experiment.
3. **(C) ISMCTS as the entire AI**, bypassing priorities and the 10-factor scorer entirely. Largest behavior shift, hardest to validate, most pure search-based approach.

**Recommended: (B) first.** Per-seat variant, A/B at 500 matches. If it wins or ties (even marginally), promote to (A) — that's the natural full deployment. (C) only after (A) is locked in and we understand its limits.

**Implementation plan:**

Estimate ~350 lines of new JS code in three modules:
1. **`docs/js/ai/ISMCTSEvaluator.js`** (~150 lines): the algorithm — `Node` class with UCB1, the `ismcts(rootstate, itermax)` main loop, tree statistics output.
2. **`docs/js/ai/ISMCTSGameState.js`** (~150 lines): adapter wrapping `GameState`/`Chain`/`Hand` with the ISMCTS interface (`clone`, `cloneAndRandomize`, `doMove`, `getMoves`, `getResult`).
3. **Integration glue** (~50 lines): `SmartAI.useISMCTS[]` flag, harness `ismcts` variant, optional config (iterations, exploration constant).

**Validation plan:**

1. **Smoke test**: 5-match run, confirm code executes end-to-end and AI moves complete in reasonable wall time.
2. **Determinization quality check**: instrument the rate at which `cloneAndRandomize` produces valid deals. If failure rate is high, sampling tuning is needed before A/B.
3. **A/B 500 matches** vs. current code. Watch the seat-balance sanity check.
4. **If borderline (CI straddles 50% but trends positive)**: extend to 1000–1500 matches per the def-close-1 false-positive lesson.
5. **Instrumentation overlap**: run `--all-variant ismcts --instrument` to see how decision-priority and factor distributions shift.

**Compute budget:**

Rough estimate per move:
- 1000 ISMCTS iterations × ~50–100 µs per iteration ≈ **50–100 ms per move decision**.
- For comparison: current AI is 1.94 ms mean (most decisions don't trigger MC); MC blend when it runs is ~10–30 ms per move.

In the harness: a 500-match A/B currently takes ~3 minutes. ISMCTS could push this to **15–30 minutes**. Still tractable. For production play: 50–100 ms is invisible to a human (we already gate AI moves behind a thinking delay).

**Tunables to surface:**
- `itermax` (iterations per decision) — primary speed/quality lever
- Exploration constant `c` (default √2/2 = 0.707 per Cowling)
- Rollout depth limit (if not running to terminal)
- Determinization strategy (uniform / affinity-weighted)
- Rollout policy (random / scored)

**Risks & open questions:**

- **Determinization quality is the biggest risk.** Bad sampling → searching the wrong distribution → garbage results. Need to validate that `_sampleValidDeals()` produces well-distributed samples across the observer's information set, not just the high-affinity corner of it.
- **JS deep-cloning cost.** ISMCTS does thousands of clones per move. `Chain.clone()` and `Hand.clone()` exist but weren't optimized for this volume. May need a lighter alternative (incremental state with undo) if profiling shows clones dominate.
- **Move-equality semantics.** ISMCTS looks up tree nodes by move equality (`child.move === legal_move`). Our `{tile, end}` move objects need a stable equality definition; a hash-string form (`"4-2/left"`) is the easy answer.
- **Could underperform our specialized priority logic.** P1/P2/P3 encode strategic knowledge (winning move, cuadrar trap, partner support) that ISMCTS would have to rediscover from rollouts. In integration mode (A) or (B), priorities are preserved; mode (C) would be where this risk fully bites.

**References:**
- Cowling, Powley, Whitehouse — *Information Set Monte Carlo Tree Search* (IEEE TCIAIG, 2012). PDF in `~/Documents/Claude-code-projects/ISMCTS-Dominoes/Papers/`.
- Cruz — domino-specific MCTS variant (2013, also in `Papers/`).
- DominAI Stanford CS221 writeup (also in `Papers/`), and the [angeris/DominAI](https://github.com/angeris/DominAI) PIMC/IMS implementation.
- The 4-person partnership dominoes adaptation: [isaacbuckman/Dominoes](https://github.com/isaacbuckman/Dominoes).
- Canonical Python reference (Cowling et al.): `~/Documents/Claude-code-projects/ISMCTS-Dominoes/president/framework.py` (~200 lines including comments).

**Decision after this design doc:**
Either (a) commit to the ~350-line build behind a harness variant, or (b) defer pending the outcome of other items (DoE, multi-human, DNN). The implementation surface is well-bounded; the open question is whether the gain justifies it before other lower-cost items are explored.

---

### 0g. ISMCTS Search-Quality Improvements
**Priority:** Medium-High
**Complexity:** Low–Medium (per item)
**Depends on:** ISMCTS Master fallback (v1.2.0)

The v1.2.0 A/B found 1000 and 5000 ISMCTS iterations perform identically — the search is not
compute-limited, it's limited by what each iteration measures. That points the remaining leverage
at the three quality components of the loop: determinization, rollouts, and reward. Ranked
roadmap (July 2026 exploration):

1. ~~**Fix the determinization real-hand leak.**~~ *(shipped v1.2.6 — see CHANGELOG. Measured
   2.06% of determinizations silently reused real hands when `_sampleValidDeals` dead-ended,
   peaking 3.71% mid-hand; fixed with a backtracking backstop, re-measured 0 in 1.52M.)*
2. ~~**Informed rollouts**~~ *(tested July 2026 — both washed; default stays `'random'`.)*
   Hypothesis: uniform-random rollouts make terminal evaluations noisy (a rollout player holding
   a domino-out move plays it only by chance), and that noise is why 1000 ≈ 5000 iterations.
   Tested as `ismcts(root, itermax, rolloutPolicy)` with harness variants:
   (a) `rollout-decisive` — a rollout player one tile from domino always plays it:
   **49.6% ± 4.4%** (CI 45.2–54.0, seats 49.2/50.0);
   (b) `rollout-greedy` — decisive + ε-greedy highest-pip shed (ε = 0.25):
   **48.6% ± 4.4%** (CI 44.2–53.0).
   Interpretation: domino rollouts are short (hands are 7 tiles; simulations run ≤ ~20 plies)
   and the tree already covers the near horizon at 1000 iterations, so rollout informedness is
   not the binding constraint — and the pip-shed bias may even distort evaluations slightly.
   The variants remain in the harness for interaction tests with later 0g items; the rollout
   hypothesis for the 1000 ≈ 5000 plateau is disconfirmed, shifting suspicion to the reward
   signal (0g.3) and determinization distribution (0g.5).
3. **Margin- and match-aware reward** — `getResult()` is binary hand win/loss: winning by 5 and
   by 60 look identical, and the search knows nothing about the match score. Blend pip margin
   into terminal values (e.g. `0.5 + 0.5·margin/maxMargin` folded into win/loss) so cerrar
   trade-offs are evaluated in-tree (potentially subsuming the noisy P2 pip estimator,
   RMSE ≈ 9.3); pass match score in for endgame behavior (safe at match point, gamble when far
   behind). **Validate at match level** — this can wash on hand win rate while improving match
   win rate.
4. **Let ISMCTS see more decisions** — P2 (cerrar), P3 (block), and P4 (partner support) preempt
   the search; they were designed to compensate for a weaker fallback than we now have. A/B a
   `pure-ismcts` variant keeping only P1 (winning move) as a shortcut.
5. **Determinization distribution A/B** — uniform vs. affinity-weighted sampling (proposed in 0f,
   never run; the leak fix removes the contamination that would have muddied it). Revives the
   strength value of 0b (end-choice inference) and 0c Phase 2: sharper affinities now have a
   direct consumer in the search.
6. **Longer shots** — tree reuse between consecutive moves; per-move time budget instead of fixed
   iterations; MAST-style rollout learning; a learned (DNN) rollout policy as the natural entry
   point for the backlog DNN item, trained on harness self-play.

Also worth tracking: **Experienced** still runs the old MC-blend and inherits none of this. If
the gap to Master grows too large, a reduced-iteration ISMCTS (100–200 iters) could become the
new Experienced.

---

### 1. Configurable AI Strategy Weights
**Priority:** Low
**Complexity:** Medium

Add a settings panel to let users adjust the relative importance of different strategic factors that control AI play.

**Current factors in SmartAI.scoreMove():**
- `suitStrength` - prefer playing from strong suits
- `doubleManagement` - unload doubles with cover
- `partnerSupport` - support partner's signaled suit
- `blockingPotential` - exploit opponent weaknesses
- `pipManagement` - play high-pip tiles early
- `endControl` - keep strong suits open
- `tileCountingBonus` - leave open suits with tiles remaining
- `avoidDeadSuits` - don't leave dead suits open

**Proposed UI:**
- Sliders or presets (Aggressive, Balanced, Defensive, Partner-focused)
- Apply to all AI players or per-player customization
- Save preferences to localStorage

---

## Features from Project Roadmap (Not Yet Implemented)

### 2. ~~Training Mode~~ *(removed — covered by Genín real-time advice + debrief)*

---

### 3. Position Analyzer
**Priority:** Medium
**Complexity:** Medium

Analyze arbitrary game positions without playing a full game.

**Requirements:**
- Manual entry of: your hand, tiles played, passes observed
- OR step-by-step recording from hand start
- Detailed recommendations with principle-based explanations
- Show probability distributions for opponent hands

---

### 4. Game Save/Replay
**Priority:** Low
**Complexity:** Medium

Save and replay completed games for study.

**Requirements:**
- Save game history to localStorage
- Load and replay with move-by-move navigation
- Commentary on optimal vs. actual plays
- Highlight decision points

---

### 5. Pass Indicators on UI
**Priority:** Medium
**Complexity:** Low

Show visual indicators when players have passed on specific suits.

**Requirements:**
- Display near each player's position
- Show which numbers they've passed on
- Update in real-time as passes occur
- Help track opponent weaknesses visually

---

### 6. ~~Real-time vs Review Feedback Mode~~ *(removed — both modes effectively covered by Genín advice + debrief)*

---

### 7. "Why Did I Lose?" Analysis
**Priority:** Low
**Complexity:** Medium

Explain blocked game outcomes.

**Requirements:**
- Analyze blocked games to explain why one team won
- Identify key decision points that led to the block
- Show pip counts and what could have been different

---

### 8. Bonus Scoring (Regional Variants)
**Priority:** Low
**Complexity:** Low

Support optional regional scoring bonuses.

**Requirements:**
- Capicú: Win with non-double playable on either end (+100)
- Chuchazo: Win by playing double-blank as last tile (+100)
- Configurable on/off in settings

---

### 9. Glossary Tooltips
**Priority:** Low
**Complexity:** Low

Teach traditional terminology through the UI.

**Requirements:**
- Tooltips on hover/tap for terms (la salida, cierre, cuadrar, cerrar, firme, ahorcado, etc.)
- Help section with full glossary
- Use terms consistently in explanations

---

### ~~UX-X. Fixed Chain Position (Stable Tile Layout)~~ *(completed v0.4.6, Mar 2026)*

---

### UX-0. Streamlined Post-Game Feedback
**Priority:** High
**Complexity:** Medium

The current debrief references specific moves from hands that the player no longer remembers, making it hard to internalize lessons. Feedback should be pattern-based and memorable, not move-by-move.

**Problem:**
- "Move 7: you played [3|5] on the right — partner's suit was 3" means little minutes later
- Too much detail obscures the 1–2 lessons worth remembering
- No visual context to anchor the feedback to

**Proposed directions (pick one or combine):**
- **Key moments only** — surface the 2–3 most impactful decisions per hand (biggest score deltas vs. optimal), not every move
- **Board snapshot** — show a mini chain state alongside each feedback point so the player can reconstruct what was happening
- **Pattern summary** — instead of listing moves, summarize tendencies: "You often killed partner's suit when leading" or "You held doubles too long in 3 of 5 hands"
- **Principle-first framing** — lead with the lesson ("Support partner's salida"), then cite the move as evidence, not the other way around
- **Partida Completa tab** — currently shows one hand at a time via a dropdown selector (not obvious). Should instead show all hands as a single scrollable timeline, or at minimum show all plays across all hands with clear hand dividers

**Notes:**
- Pattern summary across a full match is more memorable than per-move critique
- Could integrate with Genín's voice/persona for warmer delivery
- EN/ES translations required for any new text

---

### UX-A. Visual Effects for Key Moments
**Priority:** High
**Complexity:** Low–Medium

Celebrate and flag notable plays with animations or visual cues to make the game feel more alive.

**Candidates:**
- **Capicú** — played tile fits both ends; special banner/flash
- **Zapato** — player goes out while partner still has tiles; animation on the winning tile
- **Unloading [6|6]** mid-game (not as opening) — brief highlight since it signals strength
- **Cerrar** — locking the board; visual emphasis on both matched ends
- **Domino** — existing result screen, possibly enhance

**Notes:**
- Should work on mobile
- Keep subtle — informative, not intrusive
- EN/ES labels for any text overlays

---

### UX-B. Named AI Players
**Priority:** Medium
**Complexity:** Low

Give the three computer players distinct names and visual identities.

**Requirements:**
- Assign names to players 1, 2, 3 (e.g., regional/Mexican domino names or character names)
- Display names in the UI where player labels appear (game board, log, debrief)
- Optionally assign distinct avatar icons or color accents per player
- Names stored in settings / localStorage so they persist
- No AI changes required

**Notes:**
- Lays groundwork for AI personalities (#UX-C)
- Names could eventually reflect personality (e.g., "El Bloqueador")

---

### UX-E. Tile Slam Effect
**Priority:** Medium
**Complexity:** Low

Play a satisfying "slam" animation when a player plays the [6|6] or dominoes (plays their last tile). These are the two highest-drama moments in a hand — the opening power move and the winning strike.

**Triggers:**
- **[6|6] played** — anytime the double-six hits the chain, not just as the opener
- **Domino** — any player plays their last tile to win the hand

**Animation concept:**
- The tile drops onto the chain with a quick scale-up → overshoot → settle (`transform: scale`) — like a physical slam
- Brief table shake or ripple effect radiating from the tile (CSS `@keyframes` translate on the chain container)
- Optional: short flash or glow on the tile itself (cyan for your team, red for opponents)
- Duration should be snappy — ~400–600 ms total so it feels punchy, not sluggish

**Sound (optional / stretch goal):**
- A single short tap/thud sound effect on slam
- Must respect a mute toggle or system silent mode
- Only add if a suitable royalty-free sound can be sourced; skip otherwise

**Implementation notes:**
- Tile render happens in `Chain.js` / UI layer — add a CSS class (e.g. `.tile-slam`) triggered once on insertion
- Remove the class after the animation ends (`animationend` event) to allow re-triggering
- Should work on mobile (no hover dependency)
- EN/ES not required (pure visual)

---

### UX-D. AI Thinking Indicator
**Priority:** Medium
**Complexity:** Low

Before each AI player makes their move, show a brief "Thinking…" label (or lightbulb icon 💡) next to that player's position on the board. The total time between the previous move and the AI's actual move should feel like 8–10 seconds, giving human players time to absorb the board state and follow the game's cadence.

**Behavior:**
- Indicator appears as soon as it becomes an AI player's turn
- Stays visible for the bulk of the delay, disappears just before the tile is played
- Does **not** appear when a player passes (pass is instantaneous — no deliberation to signal)
- Applies to all 3 computer players (Opp 1, Partner, Opp 2)

**Design options (pick one):**
- Text label: "Thinking…" near the player name
- Lightbulb icon (💡) with a subtle pulse animation
- Animated ellipsis dots (·  · ·  · · ·) for a quieter look

**Implementation notes:**
- Current AI move delay is likely a short `setTimeout` in `Game.js` or `main.js` — extend it to ~8–10 s total
- Show indicator at turn start, clear it ~500 ms before the move fires so the tile play feels snappy
- EN/ES label required if using text ("Thinking…" / "Pensando…")

---

### UX-C. AI Personalities
**Priority:** Low
**Complexity:** Medium
**Depends on:** #1 (Configurable AI Strategy Weights), #UX-B (Named AI Players)

Give each named AI player a distinct playing style by parameterizing strategy weights.

**Requirements:**
- Define 3–4 personality profiles (e.g., Aggressive Blocker, Conservative, Partner-focused, Balanced)
- Parameterize `scoreMove()` factor weights per player instance
- Wire personality to named player (from #UX-B)
- Optional: expose personality presets in settings UI

---

## Completed Features

Migrated to [CHANGELOG.md](CHANGELOG.md) as of v1.1.0. The changelog is now the canonical record of shipped work.

---
## Notes

- Features should maintain mobile responsiveness
- Keep UI clean and uncluttered
- Consider accessibility (color blindness) for color coding
- Reference `domino_advisor_project.md` for detailed specs and strategic principles
- Test edge cases: blocked games, close scores, many doubles, ahorcado scenarios
