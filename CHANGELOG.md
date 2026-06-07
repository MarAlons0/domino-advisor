# Changelog

All notable changes to 7 Fichas are documented in this file.
Format: [Keep a Changelog](https://keepachangelog.com/en/1.0.0/). Versioning: [SemVer](https://semver.org/) — see [VERSIONING.md](VERSIONING.md).

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
