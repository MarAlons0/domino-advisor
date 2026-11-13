# Domino Advisor — Design Notes & Detailed Specs

> Full design detail for backlog items (schemas, AI/ML experiments, UX specs). The summary lives
> in [`BACKLOG.md`](../BACKLOG.md); this is the deep reference it links to.
> Shipped features are recorded in `CHANGELOG.md`.

---

## Pending Features

### ~~STATS-1. Player Stats, Achievements & Badges~~ *(completed v1.0.3, Mar 2026; final-hand + cerrado-label fixes v1.5.1)*
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

### ~~STATS-2. PWA (Progressive Web App)~~ *(completed v1.0.0, Mar 2026)*
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
**Status:** Phase 1 (instrumentation + baseline) and Phase 2 (layer attribution, 2026-10-28) complete; Phase 3 optional.
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

**Phase 2 — Layer attribution (done 2026-10-28):**
Harness mode `--prob-layers` (with `--prob-out` / `--prob-merge` for parallel shards) scores every
prediction at each layer, so all layers are compared on identical positions. Run: 500 Master
self-play matches, 15.0M predictions per layer; per-shard step sizes agree within ~0.0002.
(`HandTracker`'s own N/M was dropped as a layer: the tracker is shared by all seats and knows the
human's hand, so it is not any one viewer's belief. Its view-correct form is the `passes` layer.)

| Layer | Brier | Log-loss | Step | Share |
|---|---|---|---|---|
| Uniform 1/3 (no information) | 0.2222 | 0.6365 | | |
| Tile counts | 0.2199 | 0.6312 | +0.0023 | 14% |
| Passes, one tile at a time (N/M over allowed holders) | 0.2091 | 0.6016 | +0.0108 | 66% |
| Sampled deals, passes only (passes solved jointly) | 0.2085 | 0.5994 | +0.0006 | 4% |
| Sampled deals + suit signals (raw MC marginals) | 0.2059 | 0.5935 | +0.0026 | 16% |
| + Platt calibration (`getProbability`, what the AI uses) | 0.2059 | 0.5934 | +0.0000 | 0% |
| *Side branch:* passes + suit signals, one tile at a time (`_heuristicProbability`) | 0.2062 | 0.5950 | | |

Findings:
- **Passes are the backbone** — two-thirds of all hand-reading. Tile counts add 14%, the suit
  signals 16%; solving the passes jointly (sampling whole deals instead of one tile at a time)
  only 4%.
- **The one-tile-at-a-time fallback is nearly as good overall** (0.2062 vs 0.2059). Sampling
  earns its keep late in the hand, where the constraints interlock (20–23 tiles played: 0.1594 vs
  0.1641; 24–27: 0.1511 vs 0.1615), and is a hair worse early (0–7 tiles: +0.0003). ISMCTS needs
  whole deals anyway, so nothing to change.
- **Where the Phase 1 drift came from: the suit signals are too timid.** Sampling on passes alone
  is well calibrated (drift within ±0.011 in every bin). Adding the affinities makes the marginals
  under-confident — observed minus predicted −0.012 at 10–20%, +0.02 across 50–90%. The signals
  point the right way but are not trusted enough. The one-tile-at-a-time layers are far worse
  calibrated (up to +0.12), because one-at-a-time N/M ignores how passes interlock.
- **Platt calibration fixes the drift but is worth ~0 Brier.** After it, every bin is within
  ±0.007. The fix changes little because the drift sits in sparse bins and 76% of predictions are
  in 20–40%. A refit on today's sampler (a = 1.091, b = 0.058, vs 1.10 / 0.04) would gain 0.0001
  Brier, so the curve stays.
- Late in the hand, predictions about the partner are less sharp than about the opponents (20–23
  tiles: 0.1637 vs 0.1573), presumably because opponents pass more. Earlier in the hand they are
  equal, as Phase 1 found.
- The samplers never came up short (0.0% of 398K view snapshots under 50 deals).

**Implication.** A post-hoc curve is the wrong tool for the remaining drift, because the
miscalibration belongs to the signal layer. The lever is the signal strength itself: for example,
sample with `affinity^k`, k > 1, and measure Brier, calibration and win rate. This is the same
quantity 0h phase 1 calibrates per human, so a global `k` measured here is also the population
prior for that work.

**Follow-up: signal strength (2026-10-28).** New knob `PlayerView.affinityPower`: the sampler
weights each holder by `affinity^k` (1 until v1.16.0, now 3). Harness: `--signal-powers K1,K2,…` adds a
sampled layer per `k`, scored on the same positions (paired, so differences are precise), and
the variant family `affinity-powK` gives a team that sampler for A/Bs.
- Accuracy sweep (400 Master matches, 11.7M predictions per layer; all 10 shards agree on the
  ordering):

  | k | Brier | Log-loss | Best-fit Platt a / b | Note |
  |---|---|---|---|---|
  | 1 (app) | 0.2061 | 0.5940 | 1.085 / 0.054 | under-confident, Platt patches it |
  | 1.5 | 0.2052 | 0.5919 | 1.103 / 0.065 | |
  | 2 | 0.2045 | 0.5903 | 1.089 / 0.056 | |
  | **3** | **0.2038** | **0.5887** | **1.006 / 0.003** | calibrated by itself (best fit ≈ identity) |
  | 4 | 0.2038 | 0.5888 | 0.900 / −0.062 | over-confident at 20–60%; worse early in the hand |

  At k = 3 the suit signals are worth 0.0048 instead of 0.0025, nearly double. The gain grows
  through the hand (4–7 tiles: −0.0018; 20–23: −0.0041; 24–27: −0.0063). The first plays are the
  exception: they are unchanged at k = 3 and worse at k = 4, presumably because the salida
  multipliers (×2.0 / ×1.5) are already the strongest signals.
- Win rate, Master with k = 3 vs current Master: **54.1% ± 2.2%** (2,000 matches, CI 51.9–56.3;
  as team A 53.7%, as B 54.5%). That is about +4 points, twice what the whole affinity layer was
  worth against flat sampling (0g.5).
- Against personas (opponents with k = 3 vs current on alternate matches, 1,500 matches): opponents
  win 73.6% vs 69.2% (+4.4 ± 4.6). Same size and direction as self-play, so stronger signals do
  not mislead against human-like play.
- Experienced (static scorer + MC blend, which reads the same marginals), k = 3 vs k = 1:
  **50.6% ± 2.2%** (2,000 matches, CI 48.5–52.8). Neutral: its moves barely depend on a few
  points of probability, as the 0e calibration A/B found. Shipped for all levels anyway, since
  there is one sampler.

**Shipped k = 3 in v1.16.0** (`affinityPower = 3`, keeping the Platt curve exactly as tested;
at k = 3 it costs 0.0001 Brier and could be retired later). The `domino-rooms` Worker bundles the
AI, so multiplayer AI seats get it with a Worker redeploy. Genín uses the same sampler for
his advice and grading, so his advice should sharpen too. The grade bands were calibrated on the
old sampler, so it's worth a look at the grade mix after release. For 0h, k = 3 becomes the
population prior that phase 1 calibrates per human.

**Phase 3 — Refinements (optional):**
- Per-tile-type splits (doubles vs non-doubles).
- Per-viewer-side splits (seat 0 has full info on own hand; seats 1–3 are symmetric — measure whether seat 0 is meaningfully sharper or not). 0h needs the seat-0 split anyway (Brier on the human's tiles).
- ~~Trivial baselines (uniform 1/3, tile-count proportional)~~ — done in Phase 2.

---

### 0e. Calibration Recalibration for Tile Probabilities
**Status:** Done — shipped in v1.1.1. See CHANGELOG for details. Re-checked 2026-10-28 (0c Phase 2): a refit on the current sampler (a = 1.091, b = 0.058) would gain 0.0001 Brier, so the fitted curve stays.
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
3. ~~**Margin-aware reward**~~ + 4. ~~**Let ISMCTS see more decisions**~~ *(shipped together in
   v1.3.0 — the interaction was the story.)* 500-match A/Bs vs. the v1.2.x hybrid champion:
   - `reward-margin` alone (priorities intact): **exact 250/250 wash** — the decisions where
     margin matters (closes) never reached the search; P2 preempted them.
   - `pure-ismcts` (P2/P3/P4 skipped, binary reward): **57.0% ± 4.3%** (CI 52.7–61.3) — the
     hand-coded priorities, built to compensate for a weaker fallback, were *costing* strength.
   - `pure-margin` (both): **58.8% ± 4.3%** (CI 54.5–63.1, seats 58.4/59.2) — new default.
   Reward shape: `0.8·win + 0.2·(0.5 + 0.5·points/60)`, points = losing team's remaining pips.
   The two pure variants aren't statistically separable at N=500; pure-margin chosen on trend +
   principle (optimizes real points). P1 (winning move) kept as a shortcut. Experienced is
   unaffected. Harness variants `legacy-hybrid` / `reward-binary` reproduce the old configs.
   ~~**Match-score-aware reward (0g.3b)**~~ *(shipped v1.14.0.)* Terminal value = the observer
   team's match-win probability from the score the hand leaves (`MatchEquity.js`: a race to 100
   where each hand is a coin flip worth points drawn from the measured distribution — 600 Master
   self-play matches, 4,535 hands, mean 21, no ties). 2,000-match A/Bs:
   - `reward-match` vs the v1.3.0 `margin` reward: **56.0% ± 2.2%** (CI 53.8–58.2, seats
     57.6/54.4) — new default.
   - `reward-match-blind` (same curve, every hand scored as if at 0–0) vs `match`:
     **47.3% ± 2.2%** (CI 45.1–49.5). Reading the score is worth ~2–3 points by itself; the rest
     of the gain is the heavier weight on points (at 0–0, +20 points ≈ +11 points of match
     equity, against the margin reward's fixed 0.8 win / 0.2 points split).
   Genín (advice, "Why?" win rates, grades) stays on `margin`: his percentages read as hand win
   rates and the 5/15-point grade bands were calibrated on that scale. Moving him to `match`
   would mean rewording to "chance of winning the match" and re-checking the bands (early-match
   errors would shrink, late-match ones grow).
5. ✅ **Determinization distribution A/B** (run 2026-10-28; harness variant `flat-sampling`,
   flag `PlayerView.useAffinitySampling`). The flat arm draws holders with equal weight, so deals
   reflect only the hard constraints (played tiles, passes, tile counts); it also flattens the MC
   marginals, which come from the same sampler. Flat greedy sampling is uniform in practice:
   across 40 mid-hand positions its marginals sat 0.004 (mean |ΔP|) from an exact rejection
   sampler, the size of the Monte Carlo noise, while the affinities moved them 0.019 (max 0.09).
   - Master vs Master, `flat-sampling` challenger: **47.9% ± 2.2%** (2,000 matches, CI
     45.8–50.1; seats 50.0/45.9). The affinities are worth about +2 points.
   - Hand-reading (Brier, ~2.3M predictions per arm, Master play): affinity **0.2066** vs flat
     **0.2085** (shard noise ≈ 0.001); the gap peaks mid-hand at 0.004 (12–19 tiles played).
     Against the trivial 1/3 baseline (~0.222), the hard constraints deliver ~88% of the
     improvement and the affinities ~12%.
   - Against personas (opponents flat vs current on alternate matches, 900 matches): opponents
     win 68.0% flat vs 71.8% current (−3.8 ± 6.0) — same direction, so affinities tuned on
     AI play don't mislead against human-like play.
   **Keep affinity-weighted sampling** (no change). The affinity layer is a small, real edge;
   0b and 0c Phase 2 can only sharpen that ~2-point layer, and 0h phase 1 (per-human
   calibration of the same multipliers) can only win back part of it — see the 0h section.
6. **Longer shots** — tree reuse between consecutive moves; per-move time budget instead of fixed
   iterations; MAST-style rollout learning; a learned (DNN) rollout policy as the natural entry
   point for the backlog DNN item, trained on harness self-play.

Also worth tracking: **Experienced** still runs the old MC-blend and inherits none of this. If
the gap to Master grows too large, a reduced-iteration ISMCTS (100–200 iters) could become the
new Experienced.

---

### 0h. Learn the Human's Style of Play and Adapt to It
**Priority:** Medium. **Status (2026-10-28):** phase 1 built and tested in the harness. It gave no measurable gain, so it is not used in play; phase 2 is shelved. Results below.
**Complexity:** Medium–High
**Depends on:** ISMCTS Master (0f/0g). Related: 0b/0c (inference quality), 0g.5 (determinization
distribution), UX-C (AI personalities — the persona layer below is most of it).

Every AI reads every player through the same fixed assumptions. ISMCTS samples hidden hands
weighted by suit *affinities*, and those affinities move by hand-tuned multipliers that assume a
generic player; the search then simulates everyone's future moves at random. A human is not
generic. They have habits, and those habits are both readable (they leak information about the
hand) and exploitable (predictable mistakes).

**Guiding principle — light touch.** Learning nudges the AI; it never becomes the deciding
criterion. Concretely: it changes how the AI *reads* the human's hand, not what the AI is trying
to do; it grows only with evidence; it is capped; and with no history the AI is exactly today's.

#### Phase 1 — calibrate how much the human's signals reveal

The signals the AI reads today, identical for every player (`PlayerView.recordPlayObservation`,
`SmartAI.analyzePlayChoice`):

| Signal | Current assumption (affinity multiplier) |
|---|---|
| Lead (*salida*) with a double | ×2.0 for that suit |
| Lead with a non-double | ×1.5 for both numbers |
| Introducing a new number to the board | ×1.2 for that number |
| Avoiding an end you could have played on | ×0.85 for that suit (×0.70 if it's your partner's) |
| Making both ends the same number (*cuadrar*) | extra ×1.3 for that number |

Phase 1 learns, per human, how honest each signal actually is, and scales that signal's
multiplier accordingly.

- **Ground truth is fair.** After each hand all tiles are revealed, so the human's full starting
  hand is known from public information. For every signal they gave, we can check what they
  actually held (e.g. did their lead come from their longest suit? when they avoided an end, how
  many of that suit did they hold?). An attentive human opponent could learn the same; the AI
  never looks at a hand in progress.
- **Estimate:** per signal type, the observed likelihood ratio (how much more/less of the
  signaled suit the human held than the baseline), expressed as a learned multiplier.
- **Shrinkage:** learned = default blended with observed, weight n / (n + k), k ≈ 30 signal events
  — a few hands barely move it.
- **Cap:** in log space the learned strength stays within 0.5×–1.5× of the default's
  (×2.0 → between ×1.41 and ×2.83; ×0.85 → between ×0.92 and ×0.78).
- **Scope:** single player, the human seat. All three AI players use it — opponents read the human
  better, and so does the AI partner. Genín is unaffected (his reading of others doesn't involve
  the human's own signals). Multiplayer later: AI seats run on the server and can't see each
  device's profile.
- **Storage:** a small per-device profile next to the player's stats (counts per signal type), so
  it accumulates across matches. This is also the first per-play human data the app keeps.

**Phase 1 results (2026-10-28).**
*Built (no change to play):*
- `ai/SignalProfile.js`, the learner.
- Typed signals in `PlayerView` (`_signal`, `signalScales[p]`, `onSignal`); SmartAI passes `'avoid'` / `'cuadrar'`.
- Harness `--signal-honesty`, plus the `learn-signals` variant for `--persona --ab`. Shadow views for seats 1 and 3 read seat 0 the other way round, so every position is scored with and without the profile. `--shared-profile` for the strangers protocol.

*Estimator.* For each signal, it counts the tiles of the signaled suit the player still holds
right after the play. It compares that with what public information predicts: hand size × that
suit's share of the unplayed tiles the player could hold. Per type it takes ln(held / expected)
over all of the player's signals, divided by Master's own value (the reference below). That
ratio is the player's honesty relative to Master. The AI raises that type's multiplier to it,
shrunk toward 1 with weight n / (n + 30) and capped at 0.5–1.5. A hand counts only once it is
over, and the scales refresh at the start of each hand, so in-hand information never leaks.

*Master reference* (v1.16.0 self-play, 300 matches, `REFERENCE_LOG_RATIO`): ln(held / expected)
= 0.242 for a lead with a double (1,952 signals), 0.193 for a non-double lead (824), 0.174 for a
new number (40,577), 0.271 for a cuadrar (4,510). **The "avoided end" signal never fires.**
SmartAI only sends it when the played tile also carries the avoided number, and a tile that fits
one end while carrying the other end's number is exactly a cuadrar, which that branch excludes.
So avoided ends have not been read since 0b (v1.0.5).

*Avoided-end follow-up (same day).* Without the impossible condition, the signal fires about 60
times per match. It is honest: players hold 80% of the expected tiles in the suit they avoid
(ln −0.217 over 19,953 signals, Master self-play). But it doesn't help the hand-reading. Paired
over 300 matches (`--signal-ablation avoid:S`, all four seats shadowed):

| Real views (signal at 1) vs shadows at | Brier, real − shadow | Shards agreeing |
|---|---|---|
| 0 (never fires, as in v1.16.0) | +0.00018 (the signal hurts) | 9 of 10 |
| 0.5 | +0.00027 (half strength is better) | 10 of 10 |
| 1.5 | −0.00055 (stronger is worse still) | 10 of 10 |

The best strength, ~0.5, beats not reading it by only ~0.0001. A player avoids the same suit
over and over, and every repeat multiplies the affinity again; with k = 3 that over-counts a
single fact. **Kept off, explicitly:** `SmartAI.avoidSignal = false`, which reproduces the old
behaviour, so play is unchanged and there is no release. The harness turns it on with
`--avoid-signal`. A version that counts the avoided suit once per hand (instead of per play)
might be worth more, but the ceiling is small.

*Seasons:* 40 personas × 30 matches, profile carried, opponents learning on alternate matches;
1,200 matches.
- Personas' signals are clearly less honest than Master's. Unshrunk honesty: new number 0.69,
  cuadrar 0.36, non-double lead 0.43, double lead 0.72. Learned scales average 0.63–0.87,
  spread 0.50–1.27.
- **Reading seat 0's tiles: Brier 0.20716 → 0.20714** (−0.00003 over 5.8M paired predictions;
  shards −0.00024 to +0.00014). The profile helps a hair early in the hand (−0.0001) and costs a
  hair late (+0.0002).
- **Opponents' match win rate: 71.7% → 71.0%** (−0.7 ± 5.1, 600 matches per arm).

*Control*, plain Master in seat 0 (20 × 30): learned scales 1.005 (new number) to 1.07, Brier
+0.00009. The estimator is sound: it finds Master as honest as Master.

*Why no gain.* The reading barely depends on signal strength near today's setting: the k sweep
(0c follow-up) is flat between k = 3 and 4, and the whole step from 2 to 3 was worth 0.0007 on
all tiles. Scaling one player's signals by ~0.7 moves their reading along that flat stretch.
Meanwhile passes and tile counts carry two-thirds of the hand-reading whatever the profile says.
Per-human signal calibration is real but worth ~nothing. The global strength (k = 3, v1.16.0)
captured what was there. The strangers protocol was skipped: with no effect for the right
person, there is none to lose for the wrong one.

**Decision:** phase 1 is not shipped into play, and phase 2, which was conditional on it, is
shelved. The code stays; it is harmless while no scales are set. `SignalProfile` is still a
usable *style* measure ("your new numbers are 70% as readable as Master's"), which fits the
optional coaching view below.

**Phase 2 (only if phase 1 pays off — it did not):** use habits in the search — e.g. the human's real closing
rate for their seat in ISMCTS simulations instead of uniform random play — under the same
shrinkage and cap. **Optional coaching view** (separate decision, overlaps Genín): show the player
their profile ("opponents can read your leads 85% of the time").

#### Testing against human-like opponents (personas)

Harness opponents all play like the AI, so they can't stand in for humans. A **persona** is a
harness player with human-like variation in four layers:

1. **Population** — a distribution of players (below), so the learner is never tuned to one style.
2. **Player** — draws its trait values once from the population and keeps them across many
   matches (a seeded RNG makes the player reproducible: player identity = seed). This is what 0h
   should learn.
3. **Match** — each match the habits and the noise drift around that player's own values ("some
   nights you play looser"): w′ = w · e^N(0, 0.25), noise′ = noise · e^N(0, 0.15). Drift is
   multiplicative so a player with no habit stays habit-free.
4. **Move** — noisy judgement on every move (below), noisier after a painful hand (tilt).

**Habits** — each has a signed strength w ∈ [−1, 1]. When its situation comes up, with
probability |w| the habit decides the move: its best X move if w > 0, its best non-X move if
w < 0 ("best" = the brain's ranking). Otherwise the next habit gets its chance, and finally the
persona's own judgement. *(First drafted as "do X with probability t, else the opposite"; that
forces a deviation from the brain at almost every move, since `heavyFirst` applies nearly every
turn — changed while building.)*

| Trait | Applies when | X | Signal it bends |
|---|---|---|---|
| `close` | a move closes the board (cerrar) | take it | cuadrar / closing |
| `holdBack` | early in the hand (you hold ≥ 5 tiles), you hold ≥ 4 of one suit, and you can play inside or outside it — the lead included | play outside your strong suit (at the lead: don't open with it, so never with its double) | lead + new-number honesty — makes them misleading |
| `leadLongest` | leading a hand (not the forced [6\|6]) | lead from your longest suit | lead honesty |
| `partnerSupport` | partner's suit is on an end and you can play the other end | leave partner's suit open | end avoidance |
| `suitLoyalty` | you can play to your own lead suit or elsewhere | play your suit | new-number honesty |
| `doublesEarly` | a double is legal and you hold ≥ 4 tiles | play the double | lead / doubles |
| `heavyFirst` | legal moves differ in pips | play the heaviest | end avoidance (pip-driven, not suit-driven) |

`holdBack` comes from Mario's observation of real tables: some players sit on a very strong suit
early and won't open with its double, so their lead points away from their real strength. It
sits before `leadLongest`, so `leadLongest` describes lead honesty on ordinary hands and `holdBack`
on strong ones. It is the trait that most directly fools today's fixed signals — for such a
player a double lead is weak evidence, or even misleading. Under the phase-1 cap the learner can
only partly discount their leads (a ×2.0 signal can't drop below ×1.41) — the intended light touch.

**One move:** run the brain's search → habits in the table's order (each applicable one whose X
and non-X sets are both non-empty gets its |w| chance) → otherwise **noisy judgement**: pick each
legal move with probability ∝ exp(−(how far below the best it looks) / noise), in points of the
brain's simulated win rate (the brain's own pick counts as the best). Close calls are often
confused, clear blunders rarely. **Tilt:** after losing a hand by ≥ 30 points, noise × (1 + tilt)
for the next hand, tilt ∈ [0, 1] per player. *(First drafted as "occasional lapses with
probability λ, mostly near-misses"; a near-perfect player who slips now and then can't reach a
human's error rate without slipping on half its moves — replaced.)*

**Brain:** Master with Genín's reward (`margin`) so "agreement with Genín" is measured on the same
scale the app uses; 20% of the population plays at Experienced (noise then works on half the
static score — no win rates without a search).

**Placeholder population** (strengths; to be replaced by real data and Mario's judgement):
`close` −0.1 ± 0.25, `leadLongest` +0.3 ± 0.25, `partnerSupport` +0.2 ± 0.2,
`suitLoyalty` +0.2 ± 0.2, `doublesEarly` +0.2 ± 0.25, `heavyFirst` +0.15 ± 0.15 (normal, clamped);
`holdBack`: 25% of players 0.4–0.8, the rest 0–0.1; noise 2–12 points; tilt 0–1; brain 80% Master /
20% Experienced.

**Grounding in real play.** `PlayerStats.coaching` records how often the human's plays grade
good-or-better against Genín (`geninAgreements / geninTotal`). A persona in seat 0 — the seat the
app treats as the human — is graded by the app's own code (`SmartAI.analyzeHumanTurn` +
`MatchHistory`), so its agreement is directly comparable. The cerrado stats (`youClosed`) give a
partial anchor for `close` — opportunities aren't logged yet; phase 1's per-play profile adds them,
and later personas can be fitted to real players directly.

**Built and validated (2026-10-28)** — `tools/personas.js`, harness flags `--persona`
(seat 0 persona, Master partner, Master opponents), `--personas M --season K` (M players × K
matches in a row), `--persona-seed S`, `--persona-noise X` (calibration), `--persona-plain`
(control: Master brain, no habits, ~no noise). The report lists each persona's habits and how often
each actually decided, its agreement with Genín (overall and by where the move came from), wins and
off-pick rate.
- *Harness is sound:* a pass-through persona (plays its brain's pick) wins 50.9% ± 2.8 vs 49.2%
  for plain Master self-play (1,200 matches each). The plain control wins 47.1% ± 2.8 with 96%
  agreement — the few points below 50 are Genín's reward vs the opponents' `match` reward.
- *Grading has no side effects:* the plain control won 43.4% with and 43.4% without the grading
  call (1,600 matches each; that run still had a drift bug, fixed since). Good news for the app
  too — Genín's grading of the human doesn't change how the AI plays.
- *Habits are expensive:* that drift bug made zero-strength habits fire 5–14% of the time, which
  alone cost ~6 points of win rate. The default population (80 personas × 10 matches) wins
  **33.0% ± 3.3** as a team, ~14 points below the control.
- *Agreement saturates under today's grading:* the population agrees **87%** (per persona 79–94%,
  median 86%); even at noise 15 agreement stays ~83–85%. Moves off the brain's pick still grade
  good 77–82% of the time — many positions have several moves within the 5-point band.
- *So 73% may not be on the same scale:* Master plays have been graded by simulated win rate only
  since v1.9.0 (2026-10-23); before that, static-score grading was much harsher (it agreed with
  the simulation on only 43% of deviations). Mario's lifetime figure covers just 7 matches, and
  how many were played before v1.9.0 is unknown. If most came after, the gap to the population's
  87% is real. The per-match figure is the debrief's top line at the end of each match ("You
  matched Genín or came close on X% of your N decisions"). *Resolved:* after a stats reset,
  Mario's agreement under today's grading is **88%** (see the post-reset anchor below), so the
  73% was the old grading.
- *Win-rate anchor (Mario, 2026-10-28):* all matches vs Master opponents, **4 of 7 matches (57%,
  95% CI 18–90%) and 47% of hands** (≈ 50 hands, so ± 7 points). The hand rate is the sharper
  anchor. Re-run with hand counts (same definition as Stats: a tie is played, not won):

  | Seat 0 | Matches won | Hands won | Hands/match | Wins on fewer hands than the opponents |
  |---|---|---|---|---|
  | Persona population (80 × 10) | 31.5% | 44.3% of 5,924 | 7.4 | 3% of wins |
  | Plain Master control (20 × 10) | 43.5% | 50.6% of 1,552 | 7.8 | 1% of wins |
  | Mario, before the reset | 4 of 7 | 47% | — | — |
  | Mario, since the reset (v1.15.0) | 3 of 3 | 62.5% of 24 | 8.0 | — |

  Over a 100-point race, each point of hand win rate is worth ~2 points of match win rate, so 47%
  of hands predicts ~37% of matches — Mario's 4–3 is ~1.5 matches above that, ordinary luck at 7
  matches (a 33% player goes 4–3 or better 17% of the time). His hand rate sits between the
  population and plain Master, within one standard error of the population: **no retuning on this
  evidence.** Matches won while winning fewer hands are rare (1–3% of wins), so a gap between
  overall match and hand rates comes from how the matches split — close wins, lopsided losses —
  not from winning matches on fewer hands.
- *Post-reset anchor (Mario, 2026-10-28, v1.15.0 — the AI the personas were tested against):*
  3 of 3 matches, **15 of 24 hands** (62.5%, 95% CI ≈ 43–79%), Genín agreement **88%**.
  Agreement lands on the population (87%; median 86%, range 79–94%), so the personas' lapse
  level is on scale. The caveat from answer 3 below still applies: turns where he followed
  advice Genín showed grade Optimal. Hands pooled with the earlier ≈ 50: ≈ 52% of ≈ 74
  (± 11), between the population (44%) and plain Master (51%) and toward the top. A typical,
  slightly stronger-than-average member of the population: **still no retuning.** From v1.16.0,
  Master opponents are ~4 points stronger (suit signals), so later hand rates should be compared
  with persona runs on v1.16.0.

**Size of the prize (0g.5, 2026-10-28).** The whole affinity layer that phase 1 recalibrates is
worth about +2 points of match win rate for Master and 0.002 of Brier (0.004 mid-hand); the hard
constraints do ~88% of the hand-reading. Per-human calibration can only improve on part of that,
so expect a light effect — as intended — and judge phase 1 by Brier on the human's tiles from the
opponents' views, not by win rate, which would need tens of thousands of matches to see it.
0c Phase 2 (same day) adds that even against AI players the signals are under-trusted: the
affinity layer leaves the marginals under-confident (+0.02 across 50–90%). A global signal-strength
fix belongs before, or as the prior of, any per-human one. Measured: k = 3 (affinities cubed)
is worth about +4 points and becomes that prior (see the 0c follow-up).

**Persona sanity checks** (before any 0h test): realized trait rates match drawn values;
agreement-with-Genín lands near the human's figure; win rate against Master teams is plausible
for a club player; and each persona's measured signal honesty (from its own revealed hands — the
same estimator phase 1 uses) varies across the population, otherwise there is nothing to learn.

**0h test protocols.** Persona in seat 0 (the human seat), partner seat 2 = standard Master (not
learning, to isolate the effect), opponents seats 1 + 3 = Master with learning ON vs OFF.
- **Seasons:** one persona plays K ≈ 30 matches in a row with the profile carried between matches;
  repeat over M ≈ 40 personas (≈ 1,200 matches per arm; ~5 min on 8 shards). Metrics: hand-reading
  accuracy of seat 0's tiles from the opponents' views (Brier / log-loss — the existing
  `--prob-accuracy` machinery; far more sensitive than win rate), the opponents' match win rate,
  and profile convergence (learned honesty vs the persona's measured honesty, by match number).
- **Strangers:** a new persona every match, profile carried over anyway — the learned profile is
  always the wrong person's. Expect ≈ no change in win rate or accuracy: tests the cap and
  shrinkage directly.
- **Plain Master in seat 0:** learning ON vs OFF. If Master's own measured signal honesty differs
  from the hand-tuned defaults, learning may even help here — a finding about the defaults
  themselves (0b/0c territory), not harm.

**Where it lives:** `tools/personas.js`, harness-only. If UX-C (named AI personalities) goes
ahead, the habit layer moves to `docs/js/ai/` and becomes the in-app personalities. Still to add
for the 0h tests themselves: carrying the phase-1 profile across a season, and the
strangers protocol.

**Side finding — Master's randomness setting does nothing.** `main.js` sets
`randomizeTolerance = 5` for Master, meant to vary its moves among those within 5 points of the
best. But the ISMCTS pick is scored 1e6 (`SmartAI.chooseMove`, the v1.2.1 hotfix) while every
other move keeps its static score (≈ −50…150), so the band only ever contains the search's pick.
Master's only variety is the search's own sampling noise. Hence the persona lapses act on the
search's visit counts instead, and the "harness/production parity" backlog item's premise
(master differs between harness and production) has no effect on play.

**Mario's answers (2026-10-28):**
1. *Habits the trait list misses* — holding back a strong suit (4+) early and not opening with its
   double → added as `holdBack`.
2. *Placeholder population values* — plausible; they are the starting point.
3. *Your "matched Genín or came close" figure* — **73%** lifetime (Stats → Agreement Rate). The
   lapse target. Caveat: following advice Genín showed is always graded Optimal, so turns where
   Mario asked Genín pull the figure up — his unaided agreement is likely somewhat lower. *Update:*
   it covers 7 matches, some possibly graded before v1.9.0's simulation grading — see "Built and
   validated" above, with his win-rate anchor (4 of 7 matches, 47% of hands). *Post-reset
   (3 matches on v1.15.0):* **88%**, 15 of 24 hands — on the population's scale.
4. *Persona brains* — some players implicitly play at Experienced level → keep the 80% Master /
   20% Experienced split as the starting point, tuned with the agreement anchor.

---

### 0i. Reading a Withheld Double
**Priority:** Medium. **Status (2026-11-12):** shipped in v1.18.0. Master reading the clue won 53.1% ± 2.2% against Master not reading it. Every view reads it: AI seats at one weight, seats people sit in through the human table.
**Complexity:** Low
**Depends on:** the sampler (0g.5, k = 3 from the 0c follow-up). Related: 0h (reading the human),
the avoided-end signal (0h phase 1).

**The clue.** A player plays a non-double onto an end showing V while V|V is still out. V|V was
playable, so they either don't hold it or chose to keep it. Nothing read this before: the suit
affinities move a whole suit up or down, and this is about one tile.

**How it is read.** `SmartAI._sendWithheldDouble` reports every such play to the four views,
with the public situation it happened in (below). Each view reads it through `withheldDouble`,
one table per player: the flat table unless `setHumanSeats` named that seat as a person's
(`null` turns the clue off). The view multiplies its sampling weight for that player holding
V|V by the table's weight for the situation (`PlayerView.tileFactors`, applied in
`_samplingWeight`). The sampler feeds both the ISMCTS determinizations and the marginals behind
`getProbability`, so one weight covers both.
- The weight is an odds multiplier, never 0. With three possible holders, 0.35 turns a 33%
  chance into about 15%, 0.5 into 20%, and 1 leaves it alone.
- The lowest weight seen in the hand stands. Repeats don't compound, which is what made the
  avoided-end signal over-count, and a later play that says nothing doesn't erase an earlier
  one that did.

**Situations.** Mario's own play (2026-11-11): he plays a double right away, except that he may
keep V|V while his partner is on V (if the partner squares to V, he can extend V on both ends
and make the opponents pass or spend their V tiles), or when his partner, who is ahead for the
team, has no V tiles. So the clue should lower the chance, never remove it, and say less in
those two situations. `SmartAI.doubleHoldSituation` classifies each play from public information:

| Situation | Definition | `WITHHELD_DOUBLE.flat` (AI seats) | `WITHHELD_DOUBLE.human` |
|---|---|---|---|
| `partnerOnSuit` | the partner's signaled suit is V | 0.35 | 1 (no clue) |
| `partnerOutAhead` | the partner has passed on V and holds no more tiles than the player | 0.35 | 1 (no clue) |
| `ordinary` | anything else | 0.35 | 0.35 |

**Measurements (2026-11-12).** Every number comes from `tools/tournament.js`, 8 parallel
shards per run; the commands are at the end. Sections 1–4 were measured on v1.17.0 with the
clue as a challenger variant, before it was turned on; 5 and 6 were added for the v1.18.0
release (6 from the released code, with the clue on by default).

*1. How much the play says.* "Held / chance" is how often the player held V|V right after the
clue, relative to what tile counts and passes predict. 100% means the play says nothing.

| Who made the play | Clues per match | Any situation | Ordinary | Partner on V | Partner out of V and ahead |
|---|---|---|---|---|---|
| Master (self-play, 200 matches, all seats) | 58 | 49% | 51% | 33% | 85% (47 clues) |
| Default personas (seat 0, 224 matches) | 15 | 61% | 60% | 70% | too few (8) |
| Persona that never holds a double | 13 | 35% | 34% | 39% | too few (12) |
| Persona that holds in the two situations | 13 | 46% | 33% | 115% | 123% (42 clues) |

- The clue is strong and frequent: Master holds the double half as often as chance says, about
  58 times a match. For comparison, the avoided-end signal stood at 80% and "new number" at 120%.
- Master does the opposite of Mario when its partner is on V: it plays the double sooner (33%).
  So Master's habits can't stand in for a human's here.
- The default personas, which have no holding habit at all, already give a slightly weaker clue
  when their partner is on V (70%, 376 clues) than otherwise (60%).
- "Partner out of V and ahead" comes up for any one player about once in 10 to 25 matches. It
  can't be measured or learned per player in any reasonable time; it is kept as "no clue" on
  Mario's word.

*The two test personas* (`--persona-habits`): both play doubles early (`doublesEarly=0.7`); the
holder also has `holdDoubleCtx=-0.9`, a test habit outside the population that keeps a playable
double in the two situations about nine times in ten. The habit and the clue share
`doubleHoldSituation`, so they can't disagree about what the situation is.

*2. Hand-reading.* Paired: shadow views read the clue on the same positions the real views
play (`--double-read`). Brier score of the tile-holding predictions, reading − not reading;
lower is better. Every arm beat "not reading" in 8 of 8 shards.

| Run | Predictions scored | Flat 0.35 | Human table for seat 0 | Human table − flat |
|---|---|---|---|---|
| Master self-play (200 matches) | all tiles | **−0.00121** | n/a | n/a |
| Seat 0 = default personas (224) | about seat 0 | −0.00097 | −0.00107 | −0.00010 (better in 5 of 8 shards) |
| Seat 0 = never holds (224) | about seat 0 | −0.00152 | −0.00143 | +0.00009 (worse in 7 of 8) |
| Seat 0 = holds in the two situations (416) | about seat 0 | −0.00127 | −0.00153 | **−0.00026** (better in 8 of 8) |

- For scale: cubing the affinities (k = 1 → 3, v1.16.0) was worth 0.0023, and the whole
  suit-signal layer is worth 0.0048. This one clue is worth 0.0012.
- Other weights on the same Master positions: 0.5 gives −0.00109, 0.2 gives −0.00115. 0.35 is the
  best of the three, and the curve is flat around it.
- The human table costs 0.00009 against a player who never holds, a third of what it gains
  against one who does. Against the default personas the two readings are level.

What each reading says right after the clue, for the persona that holds (seat 0's clues, seen by
the players who don't hold the double):

| Situation | Truth | Not reading | Flat 0.35 | Human table |
|---|---|---|---|---|
| Ordinary (4,825 clues) | 11% | 26% | 15% | 15% |
| Partner on V (731) | 37% | 26% | 15% | 27% |
| Partner out of V and ahead (42) | 71% | 63% | 57% | 63% |

When the partner is on V the flat reading moves the wrong way: it says 15% where the truth is
37%. The human table stays at the no-clue value there, which is closer.
A table fitted to this persona on a separate run (`human-0.29:1.27:1.19`) reaches −0.00169, only
0.00016 better than the 0.35 : 1 : 1 table. That is the most per-player learning could add for a
player who holds nine times out of ten, so the fixed table is the right place to start.

*3. Win rate.* Master reading the clue (flat 0.35, `double-read`) against current Master:
**53.1% ± 2.2%** (1,063 of 2,000 matches, CI 51.0–55.3; as team A 51.7%, as B 54.6%; all 8
shards between 50.8% and 56.0%).

*4. Against personas.* Master opponents reading the clue (`double-read-human`: the persona in
seat 0 through the human table, the other seats flat) on alternate matches:

| Seat 0 | Opponents current | Opponents reading the clue | Difference |
|---|---|---|---|
| Default personas (1,520 matches) | 71.3% (542 of 760) | 72.2% (549 of 760) | +0.9 ± 4.5 |
| Persona that holds in the two situations (1,520) | 71.2% (541 of 760) | 72.9% (554 of 760) | +1.7 ± 4.5 |

Neither is significant by itself, and a run this size can't confirm a 3-point gain. Both point
the same way as self-play, so reading the clue does not mislead against human-like play,
including a player who holds doubles on purpose.

*5. The other levels.* The app lets each AI seat be Beginner or Experienced, and the 0.35 was
fitted to Master's play. Same paired check, each level playing itself (200 matches each,
all seats):

| Level | Clues per match | Held / chance (any) | Ordinary | Partner on V | Flat 0.35 | 0.5 | 0.7 |
|---|---|---|---|---|---|---|---|
| Beginner | 85 | 45% | 46% | 38% | **−0.00162** | −0.00143 | −0.00095 |
| Experienced | 46 | 32% | 33% | 2% (514 clues) | **−0.00195** | −0.00157 | −0.00097 |

- Every arm beat "not reading" in 8 of 8 shards at both levels, and 0.35 is the best of the
  three. So one flat table serves every AI seat; no table per level.
- Experienced almost never keeps a double while its partner is on that number (2%). A lower
  weight there would read it better, but that is 2.6 clues a match.
- Beginner picks by its own hand only, and still holds the double less than half as often as
  chance says.

*6. From the shipped setup.* With the clue on by default (v1.18.0), the same A/B from the other
side: the challenger does not read it (`no-double-read`), 2,000 matches per level.

| Level | Not reading vs reading | By seat assignment | Shards |
|---|---|---|---|
| Master | **47.0% ± 2.2%** (941 of 2,000, CI 44.9–49.2) | 47.8% / 46.3% | 43–52% (two of eight at 50% or above) |
| Experienced | 50.7% ± 2.2% (1,015 of 2,000, CI 48.6–52.9) | 51.0% / 50.5% | 49–54% |

- Master: the mirror image of run 3 (53.1%). The two independent runs together give the reader
  2,122 of 4,000 = 53.1% ± 1.5% (CI 51.5–54.6).
- Experienced plays the same with or without the clue, as it did when the affinities were
  cubed (v1.16.0, 50.6%).

**Decision (Mario, 2026-11-12).** Turned on, v1.18.0. The reading is better in every shard of
every run, Master wins about 3 points more against itself, and nothing gets worse against
personas.

**How it is on.**
- `PlayerView`: `withheldDouble` defaults to the flat table for all four players, so anything
  that builds views reads the clue. `setHumanSeats(seats)` swaps in the human table.
- `main.js`: seat 0 is a person. At a table with friends, every seat a person sits in, kept up
  to date with the lobby (`_applyTableLabels`). Genín reads the table through the same views,
  so his advice, the "Why?" percentages and the grades change with it, as they did in v1.16.0.
- `server/src/RoomEngine.js` (multiplayer AI seats): the human table for every seat a person
  sits in, updated when the AI takes over a seat or a player comes back (`_setDifficulties`).
  The `domino-rooms` Worker bundles this code, so the AI seats there read the clue only once
  the Worker is redeployed.
- Harness: play reads the clue as the app does (a persona's seat as a person's). The
  `no-double-read` variant is the pre-v1.18.0 behaviour; `--double-read` still plays without the
  clue so its numbers stay comparable with the tables above.

**Not done.**
- *Per-player learning.* A `SignalProfile`-style count per situation (0h phase 1) could move a
  player's weights off the table. The ordinary weight would be half-learned in about 3 matches
  and "partner on V" in about 17 (2 clues a match, shrinkage n / (n + 30)). The fitted-table
  result above caps the gain at about 0.0002.
- *The same clue on the other end.* When V is open and a player plays on the other end, V|V was
  playable too. Not measured.
- *Other reasons a human holds a double.* Mario named two and said there are others. The table
  only has to be less wrong than the flat reading; it never rules the double out.

**Reproduce** (each run 8 times in parallel with a different `--persona-seed`, then summed).
Since v1.18.0 play reads the clue, so the A/Bs are run from the other side: the challenger is
`no-double-read` and the expected result is the mirror image (6). For the persona A/B (4), use
`--variant no-double-read` in place of `double-read-human`. On v1.17.0 plus the harness, the
variants below are the originals.
```bash
# 6. From v1.18.0: the challenger does not read the clue (8 × 250; add --difficulty experienced)
node tools/tournament.js --ab --variant no-double-read --games 250
# 3. Master win rate (8 × 250), before v1.18.0
node tools/tournament.js --ab --variant double-read --games 250
# 1–2. Master self-play reading (8 × 25); merge with --double-read-merge FILE...
node tools/tournament.js --games 25 --double-read 0.35,0.5,0.2 --double-read-out FILE
# 5. The other levels (8 × 25 each)
node tools/tournament.js --games 25 --difficulty beginner --double-read 0.35,0.5,0.7 --double-read-out FILE
# 1–2. Personas in seat 0 (8 × 7 personas × 4 matches; 13 personas for the holder)
node tools/tournament.js --persona --personas 7 --season 4 --persona-seed S --double-read 0.35,human --double-read-out FILE
#    never holds:  add --persona-habits doublesEarly=0.7
#    holds:        add --persona-habits doublesEarly=0.7,holdDoubleCtx=-0.9  (and the arm human-0.29:1.27:1.19)
# 4. Persona win rate (8 × 19 personas × 10 matches), with and without the holder's habits
node tools/tournament.js --persona --personas 19 --season 10 --persona-seed S --ab --variant double-read-human
```

---

### 0j. Search Exploration Scaled to the Reward
**Priority:** Medium. **Status (2026-11-12):** shipped in v1.19.0. Master with it won 52.2% ± 1.1% of 8,000 matches against Master without it.
**Complexity:** Low
**Depends on:** the `match` reward (0g.3b).

**The problem.** The search picks which move to try next with UCB1: the move's average result
plus an exploration bonus, `C · sqrt(ln n / visits)`. `C` is fixed at 0.7071, the textbook value
for results that span all of 0 to 1 (win or lose). Since v1.14.0 the result is the chance of
winning the match after the hand, and one hand moves that chance only so far. So the bonus is
large next to the differences between moves, and the search spreads its visits almost evenly.
How selective it is depends on the match score by accident:

| Match score | Reward range (win a 21-point hand − lose one) | 0.7071 relative to the range |
|---|---|---|
| 0–0 | 0.23 | 3.0 |
| 50–50 | 0.34 | 2.1 |
| 60–30 | 0.28 | 2.5 |
| 70–70 | 0.41 | 1.7 |
| 80–80 | 1.00 | 0.71 |
| 90–10 | 0.10 | 7.0 |

Measured on v1.17.0 (67,000 Master decisions): with three legal moves the best one got 42% of
the visits at typical scores (72% of all decisions), against 58% when the range was full. Even
would be 33%.

**The change.** `ISMCTSGameState.rewardRange()` returns the range in the table for the reward
in use (1 for the win/loss rewards). With `SmartAI.ismctsExploreAuto` the search uses
`C × range`, with the range held between 0.1 and 1, so the exploration is the same relative to
the reward at every score. `ismcts()` takes the constant as a fourth argument.

**Win rate (2026-11-12).** 2,000 matches per run (8 shards × 250).

*1. The sweep.* Master with the variant against Master v1.18.1 (fixed 0.7071), before the
scaling was turned on.

| Variant | Exploration relative to the reward | Result | By seat assignment |
|---|---|---|---|
| `explore-auto-0.35` (scaled, base 0.35) | 0.35 at every score | 44.0% ± 2.2% (881, CI 41.9–46.2) | 43.1% / 45.0% |
| `explore-auto-0.5` | 0.5 | 49.4% ± 2.2% (987, CI 47.2–51.5) | 48.4% / 50.3% |
| **`explore-auto`** (base 0.7071) | 0.71 | **53.2% ± 2.2%** (1,064, CI 51.0–55.4) | 52.7% / 53.7% |
| `explore-auto`, second run | 0.71 | **52.9% ± 2.2%** (1,058, CI 50.7–55.1) | 53.5% / 52.3% |
| `explore-auto-1` | 1.0 | 53.8% ± 2.2% (1,077, CI 51.7–56.0) | 55.2% / 52.5% |
| `explore-auto-1.4` | 1.4 | 48.9% ± 2.2% (978, CI 46.7–51.1) | 50.6% / 47.2% |
| `explore-0.2` (fixed, not scaled) | 0.9 at 0–0, 0.2 at 80–80 | 47.9% ± 2.2% (959, CI 45.8–50.1) | 48.2% / 47.7% |
| v1.18.1 (fixed 0.7071) | 3.0 at 0–0, 0.71 at 80–80 | 50% (the reference) | |

- The second `explore-auto` run was made because the first was the best of six variants. Seven
  of eight shards were above 50% in the first run and six of eight in the second.
- The gain comes from the scaling. A fixed 0.2 is about what the scaling gives at typical
  scores, and it loses: late in a close match one hand decides everything, the range is full,
  and 0.2 explores too little there.
- 0.71 to 1.0 is a plateau, with clear drops at half the base (44.0%) and at double (48.9%).
  The textbook 0.7071 is on the plateau, so there is no new constant to tune. Base 1.0 is one
  run, and the four runs at 0.7071 (below) range from 50.6% to 53.2%, so the two bases are not
  separable at this size.
- The earlier 56.0% for the `match` reward over `margin` (0g.3b) was won while exploring two to
  three times more, at most scores, than the best setting found here.

*2. From the shipped setup.* With the scaling on by default (v1.19.0), the same A/B from the
other side: the challenger plays the old fixed constant (`explore-0.7071`).

| Run | Fixed constant vs scaled | By seat assignment | Shards |
|---|---|---|---|
| First | 49.5% ± 2.2% (989 of 2,000, CI 47.3–51.6) | 48.4% / 50.5% | 47–57% (three of eight at 50% or above) |
| Second | 47.9% ± 2.2% (958 of 2,000, CI 45.7–50.1) | 47.6% / 48.2% | 43–52% (two of eight) |

*3. All four runs of the same comparison.* The scaled side won 1,064, 1,058, 1,011 and 1,042
of 2,000: 4,175 of 8,000 = **52.2% ± 1.1%** (CI 51.1–53.3).
- The two runs before the release gave 53.1% ± 1.5% and the two after it 51.3% ± 1.5%. The
  four agree within chance (chi-square 3.4 on 3 degrees of freedom), so the sum is the figure
  to use: a gain of about two points, not the three the first two runs suggested.
- The second shipped-side run was made because the first came in above the expected mirror
  image (46.9%). All four are counted, whatever they showed.

**Against personas.** Master opponents with `explore-auto` on alternate matches, default
personas in seat 0 (1,520 matches, on v1.18.1): opponents won 70.4% (535 of 760) without it and
72.0% (547 of 760) with it, +1.6 ± 4.6. Not significant by itself; same direction as self-play.

**Decision (Mario, 2026-11-12).** Turned on, v1.19.0. The decision was made on the first two
runs (53.1% ± 1.5%); the shipped-side runs came after and brought the figure to 52.2% ± 1.1%.

**How it is on.**
- `SmartAI`: `ismctsExploreAuto` defaults to `[true, true, true, true]`, so every Master seat
  searches with the scaled constant: the AI partner and opponents in the app, and the AI seats
  at multiplayer tables once the `domino-rooms` Worker is redeployed (it bundles this code).
- Genín's advice, the "Why?" percentages and the grades run on the `margin` reward, whose
  range is full, so they stay as they are (checked in the browser: his searches report a
  range of 1, the AI seats 0.23 at 0–0). Beginner and Experienced don't use the search.
- Harness: play uses the scaling as the app does. `explore-0.7071` is the behaviour before
  v1.19.0; `explore-C` fixes the constant at C, `explore-auto-C` scales from the base C.

**Not done.**
- *More iterations.* "1000 ≈ 5000 iterations" (v1.2.0) was measured with a win/loss reward.
  With the search more selective, a larger budget may now pay. Not measured.
- *A range from the position.* The range uses a 21-point hand at the current score. The real
  spread depends on the tiles left; the search could measure it from its own results.

**Reproduce** (each run 8 times in parallel, then summed). Since v1.19.0 play uses the
scaling, so the A/B is run from the other side and the expected result is the mirror image (2).
The sweep variants (1) still compare against whatever the default is, which is now the scaled
0.7071; on v1.18.1 plus the harness they are the originals.
```bash
# 2. From v1.19.0: the challenger plays the old fixed constant (8 × 250)
node tools/tournament.js --ab --variant explore-0.7071 --games 250
# 1. The sweep (8 × 250 each), before v1.19.0
node tools/tournament.js --ab --variant explore-auto --games 250      # or explore-auto-C, explore-C
# Personas (8 × 19 personas × 10 matches); from v1.19.0 use --variant explore-0.7071
node tools/tournament.js --persona --personas 19 --season 10 --persona-seed S --ab --variant explore-auto
```

---

### 0k. Match Equity That Knows Who Opens Next
**Priority:** Low. **Status (2026-11-12):** built and measured, off by default (play unchanged, no release). No gain that 4,000 matches can show: 50.9% ± 1.5%.
**Complexity:** Low
**Depends on:** `MatchEquity.js` (0g.3b).

**The idea.** `MatchEquity.js` treats every hand as a coin flip. But the team that wins a hand
opens the next one, and the opening team wins more than half of them. So winning a hand is
worth its points plus the next opening, and the search doesn't count the second part.

**The opening edge.** `--hand-points` now reports it (Master self-play, decided hands):

| Hands | Opening team won | Mean points when it won / lost |
|---|---|---|
| First hand, opened by the 6\|6 holder (600 matches, v1.18.1) | 56.7% ± 4.0% (340 of 600) | 19.9 / 17.7 |
| Later hands, opened by the last winner (v1.18.1) | 58.5% ± 1.5% (2,395 of 4,091) | 21.6 / 19.3 |
| Later hands, v1.17.0 (2026-11-11) | 58.7% ± 1.5% (2,417 of 4,118) | |

The two later-hand runs together: 4,812 of 8,209 = 58.6% ± 1.1%.

**The change.** `matchEquityOpening(mine, theirs, iOpen)` adds "who opens" to the table's
state, with `OPENER_WIN_RATE = 0.587`; points per hand come from the same distribution whoever
wins. Reward `'match-salida'` scores a finished hand with it: the winner opens the next hand
(after a hand nobody wins, the lead stays where it was).
- Opening is worth 4.3 points of match equity at 0–0, 6.3 at 50–50 and 11.3 at 80–80.
- It also moves the equity away from 50–50, because wins come in runs: the team on 10 against
  90 has 8.7% averaged over who opens, against 5.6% in the coin-flip table.

**Related mismatch: the pip-tied cerrado.** The rules give a cerrado with equal pips to the
closer's team (`Rules.calculateHandResult`); the search scored it as a hand nobody wins. That
was 91 of 4,691 hands (1.9%; 6.7% of the 1,353 cerrados). `tieToCloser` on `ISMCTSGameState`
(`SmartAI.ismctsTieToCloser`, variant `tie-close`) scores it as the rules do.

**Win rate (2026-11-12).** 2,000 matches per run, measured on v1.18.1.

| Challenger | Against | Result | By seat assignment |
|---|---|---|---|
| `reward-match-salida` | Master v1.18.1 | 51.1% ± 2.2% (1,022, CI 48.9–53.3) | 53.6% / 48.6% |
| `reward-match-salida+tie-close` | Master with the scaled exploration on both teams (0j; the default since v1.19.0) | 50.7% ± 2.2% (1,015, CI 48.6–52.9) | 51.2% / 50.3% |
| `tie-close` | Master v1.18.1 | 50.0% ± 2.2% (999, CI 47.8–52.1) | 49.5% / 50.4% |

- The two salida runs together: 2,037 of 4,000 = 50.9% ± 1.5% (CI 49.4–52.5). The second run
  has a different base and the tie fix added, so the sum is a rough guide. If there is a gain
  it is about one point, and settling that needs about 8,000 matches more (± 1.1).
- `tie-close` changes nothing that can be measured. It is a correction, not a strength gain.

**Decision.** Both left off (v1.19.0 shipped 0j only). The salida-aware table is the better
model, but it adds a measured constant that has to be re-measured when the AI's play changes,
for a gain this size. The harness variants stay for later tests.

**Reproduce** (each run 8 times in parallel, then summed):
```bash
node tools/tournament.js --games 300 --hand-points                    # the opening edge (2 runs)
node tools/tournament.js --ab --variant reward-match-salida --games 250
node tools/tournament.js --ab --variant tie-close --games 250
# On v1.18.1 the third run needed the scaled exploration as the base for both teams:
node tools/tournament.js --ab --all-variant explore-auto --variant reward-match-salida+tie-close --games 250
```

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

**Status (Nov 2026):** partly built. A "Pass" badge flashes on the player's position for 4 seconds when they pass (v0.3.5, v0.3.6), and the pass goes in the log. Still to do: the requirements below, a display that stays and shows which numbers each player has passed on.

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

### ~~UX-0. Streamlined Post-Game Feedback~~ *(completed v1.6.0 + v1.7.0, Oct 2026)*
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

### ~~UX-A. Visual Effects for Key Moments~~ *(completed v1.8.0, Oct 2026)*

**As built (definitions confirmed with Mario):** **capicú** = the winning tile joins two *different* puntas (equal puntas never count); **zapato** = your team wins the match with the opponents at 0 (match shutout — not the "partner still has tiles" wording below); **comeback** = your team wins after trailing by 50+. Effects play for any player in team color; zapato/comeback show on the match-end screen for your wins. See CHANGELOG 1.8.0.

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

### ~~UX-E. Tile Slam Effect~~ *(built earlier; team-colored glow added v1.8.0)*
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

### ~~UX-D. AI Thinking Indicator~~ *(completed v1.0.1, Mar 2026; delay shortened from 9 s to 6 s)*
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
