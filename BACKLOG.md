# Domino Advisor - Feature Backlog

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

### AI Tournament Harness & A/B Testing Framework (May 2026)
Headless Node harness (`tools/tournament.js`) for measuring AI-strength changes with statistical rigor, plus the instrumentation to diagnose AI behavior. Added a root `package.json` so `docs/js` loads as ES modules under Node (browsers ignore it; the static site is unaffected).

**Harness capabilities** (`node tools/tournament.js --help`):
- Runs N AI-vs-AI matches (expert-vs-expert by default); reports per-team and per-seat win rates, hands/match, hand-outcome mix, score margins, and AI decision timing
- `--ab --variant NAME` — Champion (current code) vs Challenger A/B with 95% confidence intervals; the challenger team alternates each match to cancel out seat bias
- `--instrument` — per-decision breakdown: which priority fired (pass / only-move / winning / block / partner-support / fallback), dominant scoring-factor histogram, score-margin distribution, decision-flexibility metric, and closing-effectiveness analysis (offensive / defensive / incidental closes with win rate + pip margin)
- `--all-variant NAME` — apply a variant to all four seats to measure its effect on a metric in isolation

**Instrumentation added to SmartAI / PlayerView (all default-off, no production impact):**
- `SmartAI.onDecision` hook emitting a structured record per move
- Experiment flags: `defensiveCloseThreshold`, `pipAwareClose`, `useLookahead2`, `randomizeTolerance`, and `PlayerView.useMcDerivedPassProb`
- Block-type tagging (offensive vs defensive cuadrar)

**Key findings (expert-vs-expert self-play):**
- AI-vs-AI is symmetric (~50/50, balanced across all four seats) — no structural bias
- Closing effectiveness: offensive cuadrar wins ~90%; defensive cuadrar wins ~44% (by design — accepts a pip loss to stop an imminent domino); incidental closes ~57% and near coin-flip on pips (the real pip-management gap)
- Five move-quality levers were all statistical washes vs. current code over 500–1500 matches each: MC-derived pass/block probabilities, defensive-close threshold (0/1/2), late-game pip-dumping, and 2-ply lookahead. Tuning move quality does **not** move self-play win rate
- The exploitable weakness is **determinism**: ~24% of fallback decisions have ≥2 near-equal moves (within 5 pts), and randomizing among them is essentially free in self-play (rand5 ≈ 48.8% over 1000 matches)

**Shipped:** master-level AIs now randomize among moves within 5 score points of the best (`main.js`) — less predictable to human opponents at no measured self-play cost. Still to validate: re-run the rand5 A/B against the v1.0.5 inference rewrite, and confirm it lowers the human win rate in real play.

### Claude API Model Update (May 2026)
- The Cloudflare Worker proxy (`domino-api`) was pinned to the retired `claude-3-haiku-20240307`, breaking post-game play-style analysis with a `not_found_error`
- Updated to `claude-haiku-4-5-20251001` and redeployed
- Hardened `ClaudeService.js` to surface the real API error message (reads `data.error.message`) instead of the generic "Unexpected response format from API"

### Fixed Chain Position / Stable Tile Layout (Mar 2026)
- Start tile (la salida) pinned to horizontal center of the table at all times
- Left arm folds upward above the anchor row; right arm folds downward below it
- Each continuation row uses the full container width (not half-width)
- Turn connectors (L-shaped) indicate which wall each arm wraps at
- `Chain.firstTileIndex` tracks the split point between left arm, start tile, and right arm
- Pip flip logic preserves connecting-pip alignment after each wall turn

### Monte Carlo Look-Ahead Simulation (Feb 2026)
- Probability-weighted hand sampling using HandTracker distributions
- Certainty calculated from actual tile distributions, not game stage
- Adaptive depth (1-6 moves) and samples (30-100) based on certainty
- Blends static scoring with MC scores: `finalScore = (1-certainty)*static + certainty*MC`
- Position evaluation for terminal (domino, blocked) and non-terminal states
- Higher certainty = deeper simulation = trust MC more
- Example: holding 5/5 remaining tiles of a suit = high certainty → deep projection

### AI Decision Transparency - Debug Mode (Feb 2026)
- Developer tool to inspect AI decision-making in real-time
- Enable via URL parameter: `?debug=ai`
- Console logs for each AI turn showing:
  - Priority checks (winning move, blocking P>0.7, partner support)
  - Move scores table with all 8 factors (suit strength, double mgmt, partner support, blocking, pip mgmt, end control, tile counting, avoid dead suits)
  - Chosen move and reasoning
- Color-coded output by player
- Does not appear in normal play

### Quiz Deferred Results (Feb 2026)
- Quiz predictions stored but results hidden until hand ends
- Shows confirmation: "Prediction recorded, results at end of hand"
- Results visible in debrief Predictions tab
- Player can continue playing after making predictions

### 10. Spanish Language Support & Rebranding (Feb 2026)
- Rebranded from "Domino Advisor" to "7 Fichas"
- Full i18n system with EN/ES translations (~250 keys)
- Language toggle in header (EN / ES)
- Browser language detection with localStorage persistence
- Traditional domino terminology preserved (tranque, cerró, dominó)
- All UI elements, game messages, modals translated

**Genín Mascot Integration (Completed):**
- Mascot character "Genín" (doodle-style illustration based on Mario's father)
- Genín serves as the "advisor" persona for didactic elements
- 4 poses: thinking (debrief), questioning (quiz), advising (help), celebrating (match win)
- Black line art on light circular background for visibility
- Introduces himself as "your domino coach" in the help modal
- Appears in: Debrief modal header, Quiz modal header, Help modal header, Match win message

### Mobile Viewport Fix (Feb 2026)
- Responsive layout for phones (480px) and very small screens (360px)
- Smaller dominoes on chain and hand for mobile
- Horizontal scrolling for hand tiles (prevents overflow)
- Larger touch targets (44px minimum) for buttons
- Full-width modal buttons for easier tapping
- Scrollable debrief tabs
- Compact table layout with adjusted grid cells
- Responsive tilesPerRow calculation based on screen width
- L-shaped turn connectors with arrows showing chain flow direction

### Probability-Based AI Decision Making (Jan 2026)
- Enhanced HandTracker with Bayesian probability calculations
  - `getProbability(player, tile)` - P(player holds tile) using N/M reasoning
  - `getPassProbability(player, value)` - P(player lacks all tiles with value)
  - `getBlockingProbability(player, v1, v2)` - P(cuadrar forces pass)
- Priority override system in SmartAI:
  - Priority 1: Winning move (domino)
  - Priority 2: High-confidence blocking (cuadrar with P > 0.7)
  - Priority 3: Partner support in first 8 plays
  - Fallback: Weighted scoring
- Fixes "mata la mano" where pip management overrode partner support

### User Manual / Help Modal (Jan 2026)
- In-app help button in header (? icon)
- Modal with game overview, how to play, scoring rules
- Feature explanations (Quiz, Attribution, Debrief)
- Strategy tips for beginners

### Player Color Coding & Tile Attribution (Jan 2026)
- 4 distinct player colors: You (cyan), Opp 1 (coral), Partner (green), Opp 2 (orange)
- Toggle to show who played each tile on the chain
- Player indicator dots with initials (Y, 1, P, 2)
- Subtle glow effect on attributed tiles
- Color legend when attribution is enabled
- Updated log colors to match individual players

### Hand Prediction Tracking & Quiz Mode (Jan 2026)
- HandTracker.js for probability tracking
- Quiz modal to test prediction skills
- Predictions tab in debrief with accuracy trends
- localStorage persistence for quiz history

---

## Notes

- Features should maintain mobile responsiveness
- Keep UI clean and uncluttered
- Consider accessibility (color blindness) for color coding
- Reference `domino_advisor_project.md` for detailed specs and strategic principles
- Test edge cases: blocked games, close scores, many doubles, ahorcado scenarios
