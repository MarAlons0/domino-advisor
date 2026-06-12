# Domino Coach — Backlog
_Last updated: 2026-06-12_

> Deep specs (stats schemas, AI/ML experiments, UX details) live in [docs/DESIGN.md](docs/DESIGN.md).

## 🔴 High
- [ ] **Player stats, achievements & badges** — lifetime stats page + badge pop-ups; localStorage via a `StorageService`. See [docs/DESIGN.md](docs/DESIGN.md). `[feature]`
- [ ] **Streamlined post-game feedback (UX-0)** — tighten the debrief flow. See [docs/DESIGN.md](docs/DESIGN.md). `[feature]`
- [ ] **Visual effects for key moments (UX-A)** — highlight zapatos, cerrados, comebacks. `[feature]`

## 🟡 Medium
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
- [ ] **Explore DNN-driven AI** — investigate a neural net to replace/augment the rule-based scorer once the rule system's ceiling is in sight. `[idea]`
  - Key challenge: corpus of quality play-by-play training data. Harness produces AI-vs-AI cheaply; strong human play is harder to source.
- [ ] **Configurable AI strategy weights (1)** — expose strategy weights as settings. `[feature]`
- [ ] **Game save / replay (4)** — persist and replay past games. `[feature]`
- [ ] **"Why did I lose?" analysis (7)** — post-game explanation of the loss. `[feature]`
- [ ] **Bonus scoring / regional variants (8)** — support regional scoring rules. `[feature]`
- [ ] **Glossary tooltips (9)** — inline definitions for domino terms. `[chore]`
- [ ] **AI personalities (UX-C)** — distinct play styles per AI opponent. `[feature]`

## ✅ Shipped
_Full history in [CHANGELOG.md](CHANGELOG.md). Notable:_
- [x] **Cuadrar pip-advantage threshold** — v1.1.2
- [x] **Calibration recalibration for tile probabilities (0e)** — v1.1.1
- [x] **Fixed chain position (stable tile layout, UX-X)** — v0.4.6
- [x] **AI tournament harness & A/B testing framework**
