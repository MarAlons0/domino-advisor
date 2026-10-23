# Domino Coach — Backlog
_Last updated: 2026-10-23 (Master grading by simulated win rate shipped as v1.9.0; multiplayer items merged)_

> Deep specs (stats schemas, AI/ML experiments, UX details) live in [docs/DESIGN.md](docs/DESIGN.md).

## 🔴 High
- [ ] 🚧 **Multiplayer game** — Enable multiple humans to play, either as part of the same team or opposing teams. Anywhere from 2 to 4 humans should be able to play `[feature]`
  - 🚧 Design: [docs/MULTIPLAYER.md](docs/MULTIPLAYER.md) — networked (chosen over hot-seat), **free Cloudflare plan only**: a Durable Object per room keeps hands secret and runs the AI seats; Genín runs in each player's browser (proven to need only their own information). Next: P0 spike to measure the free-plan CPU cap.
  - Seat choice at match start: same team vs. opposing teams; AI fills empty seats.

## 🟡 Medium
- [ ] **Match-score-aware ISMCTS reward (0g.3b)** — thread match score into `ISMCTSGameState` terminal values (play safe at match point, gamble when far behind). Follow-up to the shipped 0g.3/0g.4 margin reward. See [docs/DESIGN.md](docs/DESIGN.md). `[feature]`
- [ ] **Determinization distribution A/B (0g.5)** — uniform vs. affinity-weighted sampling, now uncontaminated by the v1.2.6 leak fix. See [docs/DESIGN.md](docs/DESIGN.md). `[feature]`
- [ ] **PWA (installable app)** — service worker + manifest for home-screen install / offline. `[feature]`
- [ ] 🚧 **Quantify tile-probability predictions at scale (0c)** — Phase 1 (instrumentation) done; Phase 2 (layer attribution) pending. See [docs/DESIGN.md](docs/DESIGN.md). `[feature]`
- [ ] **AI enhancements (0)** — validate any weight/strategy change with the A/B tournament harness. See [docs/DESIGN.md](docs/DESIGN.md). `[feature]`
- [ ] **Team-contextual play inference (0b)** — infer partner/opponent hands from play to sharpen advice. See [docs/DESIGN.md](docs/DESIGN.md). `[feature]`
- [ ] **Design of experiments for scoring weights (0d)** — structured tuning of AI scoring weights. See [docs/DESIGN.md](docs/DESIGN.md). `[feature]`
- [ ] **Position analyzer (3)** — analyze a board position for the best plays. `[feature]`
- [ ] **Pass indicators on UI (5)** — show when a player passed. `[feature]`
- [ ] **Named AI players (UX-B)** — give the AI opponents names. `[feature]`
- [ ] **AI thinking indicator (UX-D)** — show the AI "thinking" before it plays. `[feature]`
- [ ] **Re-run the max-cerrado harness numbers** — before v1.5.1 the harness dropped every match-ending hand, so the empirical maxima in [docs/MAX_CERRADO.md](docs/MAX_CERRADO.md) and the white paper (≈92 rigged / ≈78 natural) were sampled without the hands most likely to carry big hauls. Re-run `--max-cerrado` (with `--max-disparity-deals`, `--cooperative-losers`, `--random-losers --force-cerrar`) and update both docs if the maxima move. The exhaustive 103-pip ceiling (`tools/cerrado-search.js`) is unaffected. `[chore]`

## 🟢 Low / Nice to have
- [ ] **Harness/production parity for master settings** — make `setupMatch` apply the same per-difficulty configuration that main.js does in real play (currently master gets `randomizeTolerance = 5` in production but 0 in the harness). The v1.2.0 → v1.2.1 freeze bug would have been caught by self-play if this parity existed. `[chore]`
- [ ] **Suit-consistency vs. opportunistic play** — when both your signaled suit and another value are playable on the open ends, is it better to stay in suit (preserving the signal your partner is reading) or take the locally-optimal move? Example: you opened `[3|3]` and played `[3|0]` (signal: 3s). Later the ends show 1 and 3; you have a 3-tile but also several 1-tiles. Play the 3 to stay consistent, or the 1 to keep your hand flexible? `[idea]`
  - Hypothesis test: add a `suitConsistencyBonus` flag to SmartAI that boosts moves matching the player's signaledSuits, A/B at 500 matches. If neutral → consistency is already adequately captured by `partnerSupport` + `ownSuitProtection`. If positive → there's a real signal-coordination value we're under-weighting.
  - Alternative angle: instrument human play traces (from Mario's own matches) and correlate suit-consistency rate within a hand with hand-level win rate. Self-coaching data.
- [ ] **Explore DNN-driven AI** — investigate a neural net to replace/augment the rule-based scorer once the rule system's ceiling is in sight. `[idea]`
  - Key challenge: corpus of quality play-by-play training data. Harness produces AI-vs-AI cheaply; strong human play is harder to source.
  - Precedent: [HowardDunn/Jamaican-Style-Dominoes-AI-Neural-Network](https://github.com/HowardDunn/Jamaican-Style-Dominoes-AI-Neural-Network) — 4-layer MLP + RL self-play, partnership variant. Cautionary: their metrics files show win rates 13–24% in 4-player games (random = 25%); the NN never clearly outperformed naive play. Useful as architecture reference, not as a result to match.
- [ ] **Configurable AI strategy weights (1)** — expose strategy weights as settings. `[feature]`
- [ ] **Game save / replay (4)** — persist and replay past games. `[feature]`
- [ ] **"Why did I lose?" analysis (7)** — post-game explanation of the loss. `[feature]`
- [ ] **Bonus scoring / regional variants (8)** — support regional scoring rules. `[feature]`
- [ ] **Glossary tooltips (9)** — inline definitions for domino terms. `[chore]`
- [ ] **AI personalities (UX-C)** — distinct play styles per AI opponent. `[feature]`

## ✅ Shipped
_Full history in [CHANGELOG.md](CHANGELOG.md). Notable:_
- [x] **Grade plays by simulated win rate at Master** — good ≤ 5 / questionable ≤ 15 / mistake > 15 points of win rate (static fallback under 30 visits), 2,000-iteration grading search, shown advice as the reference — v1.9.0
- [x] **Visual effects for key moments (UX-A)** — capicú (gold), cerrado (locked puntas + banner), team-colored slam; zapato / comeback (50+) on the match-end screen — v1.8.0
- [x] **Tile slam effect (UX-E)** — slam on any [6|6] and on every domino (built earlier; team-colored glow added in v1.8.0)
- [x] **Streamlined post-game feedback (UX-0)** — lessons-first Overview (patterns, top-3 moments with mini board, forced moves excluded) — v1.6.0; one-timeline Full Match, hand-by-hand recap, Spanish fixes — v1.7.0
- [x] **Player stats, achievements & badges (STATS-1)** — lifetime stats page, 12 badges with toasts, `StorageService` — v1.0.3; final-hand recording + cerrado stat labels fixed — v1.5.1
- [x] **Score-gap mano feedback explains why + how** — the "Why?" detail now gives the strategic principle (factor contrast: the dimension where the recommended tile most out-scores the one played) plus the ISMCTS win-rate comparison at Master, replacing the misleading static "N points more" number — v1.5.0
- [x] **Mano-level feedback (per-hand coaching)** — compact Genín card at hand-end: outcome+verdict with expandable "Why?"; local/rule-based; process-first cerrar coaching (inferable pip edge from observed fallas vs ground-truth outcome) — v1.4.0
- [x] **Pure ISMCTS with margin-aware reward at Master (0g.3 + 0g.4)** — P2–P4 priorities skipped at master (searched in-tree) + pip-margin reward shaping; 58.8% (CI 54.5–63.1%) vs the v1.2.x hybrid — v1.3.0
- [x] **ISMCTS informed rollouts (0g.2) — tested, washed** — decisive-move and ε-greedy pip-shed rollout policies both ~50% in 500-match A/Bs; default stays random, variants kept in harness. Disconfirms the rollout-noise hypothesis for the 1000≈5000-iteration plateau — v1.2.7
- [x] **ISMCTS determinization real-hand leak fix (0g.1)** — backtracking sampler backstop; 2.06% of determinizations were searching with perfect information — v1.2.6
- [x] **Maximum cerrado pip haul — theoretical + simulation** — analysis + `--max-cerrado` / `--cooperative-losers` / `--max-disparity-deals` harness modes. Empirical max ≈ 92 under rigged deal, ≈ 78 under natural deals; theoretical ceiling 97. See [docs/MAX_CERRADO.md](docs/MAX_CERRADO.md).
- [x] **ISMCTS visit distribution exposed in debug mode** — v1.2.5
- [x] **Structured Claude analysis with per-hand recap + glossary + Markdown rendering** — v1.2.4
- [x] **Claude analysis prompt rework + Sonnet 4.6** — v1.2.3
- [x] **Genín advice uses the master pipeline (priorities + ISMCTS)** — v1.2.2
- [x] **Fix Master freeze when ISMCTS bump meets rand5** — v1.2.1
- [x] **Information Set MCTS at Master level (0f)** — v1.2.0
- [x] **Cuadrar pip-advantage threshold** — v1.1.2
- [x] **Calibration recalibration for tile probabilities (0e)** — v1.1.1
- [x] **Fixed chain position (stable tile layout, UX-X)** — v0.4.6
- [x] **AI tournament harness & A/B testing framework**
