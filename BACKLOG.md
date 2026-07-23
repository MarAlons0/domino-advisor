# Domino Coach — Backlog
_Last updated: 2026-07-23 (0g.1 leak fix shipped; 0g.2 informed rollouts tested — washed)_

> Deep specs (stats schemas, AI/ML experiments, UX details) live in [docs/DESIGN.md](docs/DESIGN.md).

## 🔴 High
- [ ] **Player stats, achievements & badges** — lifetime stats page + badge pop-ups; localStorage via a `StorageService`. See [docs/DESIGN.md](docs/DESIGN.md). `[feature]`
- [ ] **Streamlined post-game feedback (UX-0)** — tighten the debrief flow. See [docs/DESIGN.md](docs/DESIGN.md). `[feature]`
- [ ] **Visual effects for key moments (UX-A)** — highlight zapatos, cerrados, comebacks. `[feature]`

## 🟡 Medium
- [ ] **ISMCTS margin/match-aware reward (0g.3)** — pip-margin-scaled terminal values + match-score context; validate at match level, not hand level. See [docs/DESIGN.md](docs/DESIGN.md). `[feature]`
- [ ] **Pure-ISMCTS vs. priority hybrid A/B (0g.4)** — let the search evaluate P2–P4 decisions instead of preempting it. See [docs/DESIGN.md](docs/DESIGN.md). `[feature]`
- [ ] **Determinization distribution A/B (0g.5)** — uniform vs. affinity-weighted sampling, now uncontaminated by the v1.2.6 leak fix. See [docs/DESIGN.md](docs/DESIGN.md). `[feature]`
- [ ] **PWA (installable app)** — service worker + manifest for home-screen install / offline. `[feature]`
- [ ] **Multi-human play** — share a game between 2–4 humans, with seat-choice (same vs. opposing teams) at match start. `[feature]`
  - Open question: hot-seat on one device vs. networked multiplayer — affects scope considerably.
- [ ] 🚧 **Quantify tile-probability predictions at scale (0c)** — Phase 1 (instrumentation) done; Phase 2 (layer attribution) pending. See [docs/DESIGN.md](docs/DESIGN.md). `[feature]`
- [ ] **AI enhancements (0)** — validate any weight/strategy change with the A/B tournament harness. See [docs/DESIGN.md](docs/DESIGN.md). `[feature]`
- [ ] **Team-contextual play inference (0b)** — infer partner/opponent hands from play to sharpen advice. See [docs/DESIGN.md](docs/DESIGN.md). `[feature]`
- [ ] **Design of experiments for scoring weights (0d)** — structured tuning of AI scoring weights. See [docs/DESIGN.md](docs/DESIGN.md). `[feature]`
- [ ] **Position analyzer (3)** — analyze a board position for the best plays. `[feature]`
- [ ] **Pass indicators on UI (5)** — show when a player passed. `[feature]`
- [ ] **Named AI players (UX-B)** — give the AI opponents names. `[feature]`
- [ ] **Tile slam effect (UX-E)** — satisfying tile-play animation. `[feature]`
- [ ] **AI thinking indicator (UX-D)** — show the AI "thinking" before it plays. `[feature]`

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
