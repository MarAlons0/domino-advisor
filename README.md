# 7 Fichas - Partnership Dominoes vs. AI

**v1.2.0** — A web-based domino game that simulates 4-player partnership dominoes (Cuban/Puerto Rican style) with an intelligent AI opponent. Built as a training tool to help players improve their strategic thinking.

**Live Demo:** [https://maralons0.github.io/domino-advisor/](https://maralons0.github.io/domino-advisor/)

## Game Overview

7 Fichas implements traditional partnership dominoes where:
- 4 players sit at a table (you at bottom, partner across, opponents on sides)
- Players 0 & 2 form Team A (You & Partner)
- Players 1 & 3 form Team B (Opponents)
- Each player receives 7 tiles from a double-six set (28 tiles total)
- First team to reach 100 points wins the match

### Scoring
- **Domino**: A player plays their last tile. Their team scores the total pips in opponents' hands.
- **Blocked (Tranque)**: No one can play. The team with fewer pips wins the difference.

## Architecture

```
docs/
├── manifest.json           # PWA manifest (name, icons, display: standalone)
├── service-worker.js       # Cache-first SW; pre-caches core assets, caches JS modules on first fetch
├── icons/
│   └── icon.svg            # [3|4] domino tile icon (navy + cyan dots)
└── js/
    (see below)

docs/js/
├── main.js                 # Application entry point, UI controller
├── ai/
│   ├── SmartAI.js          # Strategic AI decision engine
│   ├── MonteCarloEvaluator.js # Probability-weighted look-ahead simulation (Experienced)
│   ├── ISMCTSEvaluator.js  # Information Set MCTS algorithm core (Master)
│   ├── ISMCTSGameState.js  # Adapter wrapping Chain/Hand for the ISMCTS interface
│   ├── HandTracker.js      # Tile probability tracking with constraint propagation
│   ├── PlayerView.js       # Per-player probability view with Bayesian inference
│   ├── ProbabilityAnalyzer.js # Debug: Brier score accuracy measurement
│   ├── StrategicExplainer.js # Human-readable move explanations
│   └── RandomAI.js         # Simple random move selection (unused)
├── engine/
│   ├── Game.js             # Game loop and state management
│   ├── Rules.js            # Valid move calculation
│   ├── Dealer.js           # Tile shuffling and dealing
│   └── TileSet.js          # Tile set utilities
├── models/
│   ├── Tile.js             # Single domino tile
│   ├── Hand.js             # Player's hand of tiles
│   ├── Chain.js            # The played tile chain
│   ├── GameState.js        # Complete game state snapshot
│   └── MatchHistory.js     # Record of plays for debrief
├── stats/
│   ├── StorageService.js   # localStorage abstraction (swap-ready for IndexedDB/cloud)
│   ├── PlayerStats.js      # Lifetime stats tracking (matches, hands, cerrado, coaching)
│   └── BadgeSystem.js      # 12 achievement badges with unlock conditions
├── services/
│   ├── ClaudeService.js    # Claude API integration for analysis
│   └── QuizStorage.js      # localStorage for quiz history
├── ui/
│   ├── DebriefUI.js        # Post-match review modal
│   ├── SettingsUI.js       # Settings modal
│   ├── StatsUI.js          # Lifetime stats & badges modal
│   └── BadgeToast.js       # Achievement unlock toast notifications
└── i18n/
    ├── i18n.js             # Translation engine
    └── translations.js     # EN/ES strings
```

---

# AI Difficulty Levels

Each AI player (Opp 1, Partner, Opp 2) can be set independently via the Settings (⚙) panel. The setting is stored in localStorage under `7fichas_difficulty` and takes effect immediately — no need to start a new game.

| Layer | Beginner | Experienced | Master |
|---|---|---|---|
| Priority system (winning / blocking / partner support) | ✗ | ✓ | P1 (winning) only — P2–P4 searched in-tree (v1.3.0) |
| 10-factor heuristic scoring | ✗ (simplified) | ✓ | ✓ |
| Bayesian inference (suit affinities, PlayerView) | ✗ | ✓ | ✓ |
| HandTracker pass constraints | ✗ | ✓ | ✓ |
| Probability calibration (Platt-scaled `getProbability`) | ✗ | ✓ | ✓ |
| Firme strategy + cuadrar pip-advantage threshold | ✗ | ✓ | ✓ |
| Fallback evaluation | — | **Monte Carlo blend** (probability-weighted lookahead) | **ISMCTS** (Information Set Monte Carlo Tree Search) |

**Beginner** uses `_chooseMoveSimple()`: reads only its own hand and the chain. For each valid move it counts how many remaining hand tiles connect to the new open end (staying in a strong suit), with high-pip count as a tie-breaker. No inference about what other players hold.

**Experienced** runs the complete rule-based engine — priorities, 10-factor heuristic scoring, Bayesian suit-affinity inference, firme reasoning, the cuadrar pip-advantage threshold, calibrated probabilities — and blends static scoring with Monte Carlo lookahead (adaptive depth 1-6, 30-100 samples driven by certainty). This is the strongest rule-based configuration the project has shipped (it was the Master level through v1.1.x).

**Master (v1.2.0+, reworked v1.3.0)** hands nearly every decision to **Information Set Monte Carlo Tree Search (ISMCTS)** — a proper tree search that builds one unified search tree across thousands of sampled determinizations and selects the most-visited root move. Since v1.3.0 Master is *pure* search: only Priority 1 (an immediate winning move) short-circuits; cerrar, blocking, and partner-support decisions — previously hand-coded priorities — are evaluated in-tree, and terminal values blend the winner's actual point haul into the reward (`0.8·win + 0.2·margin`), so the search distinguishes winning by 60 from winning by 5. The pure+margin configuration beat the v1.2.x priority hybrid **58.8% (CI 54.5–63.1%)** in a 500-match A/B — the hand-coded priorities, designed to compensate for a weaker fallback, were measurably underperforming the search. (The v1.2.0 hybrid itself won ~66% against Experienced.) See the ISMCTS section below for details, attribution, and references.

---

# AI Decision-Making Engine

The SmartAI implements a **priority-based decision system** with **weighted scoring fallback**. This section documents exactly how the AI chooses its moves.

## Decision Flow

```
┌─────────────────────────────────────────────────────────────┐
│                    AI DECISION FLOW                         │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  1. Get valid moves from Rules.getValidMoves()              │
│                    │                                        │
│                    ▼                                        │
│  2. Only 1 valid move? ──Yes──► Return it immediately       │
│                    │                                        │
│                   No                                        │
│                    ▼                                        │
│  3. Difficulty = Beginner? ──Yes──► _chooseMoveSimple()     │
│                    │                                        │
│                   No                                        │
│                    ▼                                        │
│  4. PRIORITY 1: Winning move? ──Yes──► Play it (domino!)    │
│                    │                                        │
│                   No                                        │
│                    ▼                                        │
│  5. PRIORITY 2: Block with P > 0.7? ──Yes──► Play it        │
│                    │                                        │
│                   No                                        │
│                    ▼                                        │
│  6. PRIORITY 3: Partner support (plays < 8)? ──Yes──► Play  │
│                    │                                        │
│                   No                                        │
│                    ▼                                        │
│  7. FALLBACK (Experienced): Score moves with 10-factor      │
│     heuristic + Monte Carlo blend, pick highest             │
│                                                             │
│  7. FALLBACK (Master): Score moves statically, then run     │
│     ISMCTS (1000 iterations) and pick the most-visited      │
│     root move                                               │
│                                                             │
│  NOTE (v1.3.0): at Master, steps 5-6 (and the cerrar        │
│  priority) are skipped — those decisions are evaluated      │
│  inside the ISMCTS tree. Only steps 1-4 + 7 apply.          │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

## Priority System

### Priority 1: Winning Move (Domino)
If the AI has only 1 tile remaining and can play it, always play it. Victory takes absolute precedence.

### Priority 2: High-Confidence Blocking (Cuadrar)
The AI calculates the probability of forcing an opponent to pass by "cuadrar" (making both ends the same value or values the opponent lacks).

**Trigger conditions:**
1. `P(opponent passes) >= 0.7` (70% confidence threshold)
2. **Pip advantage check** - Only block if our team has fewer estimated pips (we'd win points from a closed game)
3. **Exception:** Block defensively even with pip disadvantage if opponent has ≤2 tiles (about to domino)

**Pip estimation** uses HandTracker probability distributions:
```
For each unknown tile:
    expected_pips_for_player += tile.pipCount × P(player has tile)

myTeamPips = exact(my hand) + estimated(partner)
oppTeamPips = estimated(opp1) + estimated(opp2)
pipAdvantage = oppTeamPips - myTeamPips  // positive = good to block
```

The blocking probability is calculated by HandTracker:
```javascript
getBlockingProbability(player, value1, value2) {
    if (value1 === value2) {
        // Cuadrar - both ends same value
        return getPassProbability(player, value1);
    }
    // Player must lack BOTH values
    return P(lacks value1) * P(lacks value2);
}
```

### Priority 3: Partner Support (Early Game)
During the first 8 plays of a hand, the AI prioritizes supporting partner's signaled suit (la salida). After play 8, this priority is disabled to allow more flexible endgame play.

**Support criteria:**
- Play tiles that match partner's signaled suit
- Leave partner's suit open on the chain ends

## Scoring System (Fallback)

When no priority triggers, the AI scores every valid move using 10 strategic factors:

| Factor | Weight Range | Description |
|--------|-------------|-------------|
| **Suit Dominance** | -50 to +50 | `((myTeam - oppTeam) / remaining) × 50`. Team-aware: uses HandTracker to estimate who controls the suit. Negative when opponents dominate (e.g., their salida + partner passed). |
| **Double Management** | -15 to +25 | +25 if double has cover (other tiles in suit), -15 if exposed, +10 if suit nearly dead |
| **Partner Support** | -37 to +30 | +20 if partner's suit stays open after the move, -25 if the move kills partner's open suit. ×1.5 when partner leads (fewer tiles), ×0.5 when I lead. |
| **Own Suit Protection** | -25 to +20 | +20 for keeping own salida open, -25 for killing it. ×0.5 when partner leads (defer to them). |
| **Firme Protection** | -35 to +40 | A "firme" = you hold ALL remaining tiles of a suit on an open end. -35 for spending last firme tile, +10 to +40 for preserving it (scaled by count). Includes A+B1+C move-effect logic (v1.1.0): bonus for newly exposing a latent firme, penalty for handing an opponent firme, partner-leading damper. |
| **Opponent Suit Avoidance** | -40 to 0 | −20 per opponent whose signaled suit ends up on an open end after the move. Penalizes leaving the chain in a suit the opponent dominates. |
| **Blocking Potential** | 0-70+ | +20 per opponent who passed on the new end value, +15 per inferred dead suit (×2 opponents) |
| **Pip Management** | 0-18 | `pips × 1.5` early game (plays < 10), `pips × 0.5` late game. Unload high tiles early. |
| **Hand Flexibility** | 0-21 | `distinct_playable_values × 3`. More unique values after play = harder to block. |
| **Pace Control** | 0-20 | Defensive when opponent ≤2 tiles (leave values they lack). Aggressive when partner ≤2 tiles (open for them). |

### Key Design Decisions

**Suit Dominance (team-aware)** uses HandTracker probability distributions to estimate how many tiles of a suit each team holds. The formula `((myTeamCount - oppTeamCount) / remaining) × 50` produces positive scores when your team controls the suit and negative when opponents do. For example, if opponents led with [5|5] and your partner passed on 5, opening the 5 end scores strongly negative because opponents hold most remaining 5-tiles.

**Hand Flexibility** is separate from Suit Dominance. A hand with [5|3], [5|4], [5|1], [5|0] has great dominance in 5s but terrible flexibility - only two distinct non-5 values. This factor penalizes moves that reduce your breadth of playable values.

**Lead/Follow Dynamics** modulate Partner Support and Own Suit Protection. When partner is leading (fewer tiles), support is amplified ×1.5 and own suit protection drops to ×0.5 — the AI defers to whoever is closer to winning. When I'm leading, support drops to ×0.5 so I focus on finishing rather than helping. Partner Support is now board-position-aware: it checks whether partner's suit remains open on the chain after the move, and penalizes moves that close it (-25).

**Firme Protection** rewards preserving guaranteed plays. When you hold ALL remaining tiles of a suit on an open end (a "firme"), you have guaranteed future plays on that end. Spending the last firme tile (-35) is heavily penalized since it eliminates the advantage entirely. Playing on the other end while preserving the firme earns a bonus scaled by how many firme tiles you hold (+15 to +40). This is separate from Suit Dominance because a firme is a binary condition (you either own the entire suit remainder or you don't).

**Pace Control** adjusts play style based on who's winning. When opponents are about to domino (≤2 tiles), the AI plays defensively - leaving values opponents lack. When partner is about to win, it opens the game up. This implements the "llave" concept: holding the last tile of a suit blocks that end for everyone.

### Scoring Example

Move: `[5|3]` on left end, leaving 5 open (3 of 5 remaining fives in hand)

| Factor | Calculation | Score |
|--------|------------|-------|
| Suit Dominance | 3/5 fives = 60% × 50 | +30 |
| Double Management | Not a double | 0 |
| Partner Support | Partner signaled 5s | +15 |
| Own Suit Protection | Own suit (3s) still open | +20 |
| Firme Protection | No firme on either end | 0 |
| Opponent Suit Avoidance | No opponent signaled 5s | 0 |
| Blocking Potential | Opp 1 passed on 5 | +20 |
| Pip Management | 8 pips × 1.5 (early) | +12 |
| Hand Flexibility | 5 distinct values × 3 | +15 |
| Pace Control | No urgency | 0 |
| **TOTAL** | | **112** |

---

# Probability Calculations (HandTracker)

The HandTracker maintains probability distributions for tile locations and calculates key probabilities used by the AI.

## Tile Location Tracking

Each of the 28 tiles is tracked as:
- `'played'` - On the chain
- `'human'` - In player 0's hand (known)
- `'unknown'` - In one of the 3 computer players' hands

For unknown tiles, a set of "possible holders" is maintained and narrowed based on:
1. **Passes**: If a player passes when ends are 3 and 5, they lack ALL tiles containing 3 AND all tiles containing 5
2. **Play inference**: Deductions from what players choose to play

## Constraint Propagation

After every play and pass, `_propagateConstraints()` detects forced tile assignments and cascades deductions:

**Rule**: If player P has N tiles remaining and exactly N possible tiles, all N tiles are forced to P. This removes P from all other tiles and removes other players from those N tiles. The process repeats until no more forced assignments can be made.

**Example cascade:**
1. Player 1 passed on suits 0,1,2,3,5,6 → only suit 4 tiles possible
2. Player 1 has 2 tiles, only `[4|2]` and `[4|4]` are possible → **forced**
3. Remove `[4|2]` and `[4|4]` from Player 2 and 3's possible sets
4. Player 2 now has 2 tiles and exactly 2 possible tiles → **forced** (cascade)

## getProbability(player, tile)

Returns the probability that a specific player holds a specific tile. Computed via PlayerView, which normalizes per-tile so probabilities sum to exactly 1.0 across all possible holders.

**Algorithm:**
```
If tile is played or in own hand: return 0 or 1 (known)

If player is not in possibleHolders: return 0

For each possible holder Q:
  base(Q) = tileCounts[Q] / possibleTilesForPlayer(Q)
  raw(Q)  = base(Q) × affinity(Q, tile)

P(player has tile) = raw(player) / Σ raw(Q)   // normalized to sum to 1.0
```

**Example:**
- Player 1: 5 tiles remaining, 12 possible → base = 5/12 = 0.417
- Player 2: 4 tiles remaining, 8 possible → base = 4/8 = 0.500
- Player 3: 3 tiles remaining, 10 possible → base = 3/10 = 0.300
- Sum = 1.217
- P(Player 1 has tile X) = 0.417 / 1.217 = **0.342** (properly normalized)

## getPassProbability(player, value)

Returns the probability that a player will pass if the only open end has this value.

**Algorithm:**
```
If player has passed on this value before: return 1.0

Count tiles with this value that player could have (N)
Count player's remaining tiles (M)

If N = 0: return 1.0 (definitely lacks the suit)
If N >= M: return 0.0 (definitely has at least one)

// Using complementary probability
P(lacks all) = Product of (1 - P(has each tile))
             ≈ ((N-M)/N)^(number of tiles with value player could have)
```

## getBlockingProbability(player, value1, value2)

Returns the probability of blocking a player with ends showing value1 and value2.

```javascript
if (value1 === value2) {
    // Cuadrar - both ends same
    return getPassProbability(player, value1);
}

// Must lack BOTH values
return getPassProbability(player, value1) * getPassProbability(player, value2);
```

**Note:** The multiplication assumes independence, which is an approximation. In reality, lacking one suit slightly increases the probability of having another.

---

# Per-Player Probability Views (PlayerView)

Each of the 4 players gets an independent `PlayerView` that reflects only what that player could legitimately know. This prevents computer players from "cheating" by seeing the human's exact tiles.

## Architecture

```
HandTracker (shared data store — unchanged)
├── allTiles, playedTiles, knownLocations
├── possibleHolders, deadSuits, tileCounts
└── _generation counter (cache invalidation)

PlayerView[0..3] (per-player probability adapter)
├── wraps HandTracker (read-only reference)
├── knows own hand tiles (exact)
├── tracks suit affinities from observed plays (Bayesian)
└── exposes same API: getProbability, getPassProbability, getBlockingProbability
```

| View | Own tiles | Human tiles | Other computer tiles |
|------|-----------|-------------|---------------------|
| Player 0 (human) | exact | exact | unknown + Bayesian |
| Player 1 (Opp 1) | exact | **unknown** | unknown + Bayesian |
| Player 2 (Partner) | exact | **unknown** | unknown + Bayesian |
| Player 3 (Opp 2) | exact | **unknown** | unknown + Bayesian |

## Bayesian Suit Affinity Model

Each `(player, suit)` pair has a multiplier `A[player][suit]`, initialized to 1.0 per hand. Affinities are updated from observed play patterns and used to weight both heuristic probabilities and Monte Carlo deal sampling.

| Event | Weight | Description |
|-------|--------|-------------|
| Salida with double [V\|V] | 2.0x | Strong signal: player chose to open with this suit |
| Salida non-double (introduces V) | 1.5x | Moderate signal for both suit values |
| Subsequent play introduces V | 1.2x | Mild signal: player introduced a new value to the chain |
| End avoidance (could play B, chose A) | 0.85x | Mild negative: player avoided a suit they could have played |

Affinities are clamped to [0.1, 5.0]. The probability formula for tile T with values (H, L), target player P:

1. `base(P, T) = tileCounts[P] / possibleTilesForPlayer(P)`
2. `affinity(P, T) = sqrt(A[P][H] × A[P][L])` (geometric mean; for doubles just `A[P][V]`)
3. `raw(P, T) = base(P, T) × affinity(P, T)`
4. Normalize per tile: `P(P has T) = raw(P, T) / Σ raw(Q, T)` across all possible holders Q

Affinities also weight the Monte Carlo deal sampler: when assigning unknown tiles to players, each eligible player's selection probability is proportional to their affinity for that tile rather than uniform. This produces sampled deals that reflect behavioral signals, not just structural constraints.

---

# Developer Debug Mode

Enable detailed AI decision logging by adding `?debug=ai` to the URL:

```
https://maralons0.github.io/domino-advisor/?debug=ai
```

Open browser DevTools (F12) → Console tab to see:

### Probability Accuracy (Brier Score)

At the end of each hand, the `ProbabilityAnalyzer` compares predicted probabilities against ground truth:

```
=== PROBABILITY ACCURACY — Hand 3 ===
Turn-by-Turn Brier Score (lower = better, uniform ≈ 0.22):
Columns = predictor view (how well each view predicts the other 3 players)

 Turn │ Event          │ Overall │ V:You │ V:Opp1 │ V:Ptnr │ V:Opp2
    1 │ You: [6|6]→L   │  0.135  │ 0.137 │  0.136 │  0.134 │  0.133
   ...
   25 │ Ptnr: [1|0]→L  │  0.050  │ 0.048 │  0.052 │  0.049 │  0.051

Summary:
  Start: 0.135 → End: 0.050 (63% improvement)
  Salida: Opp 1 opened with [6|6] (double)
    Suit tiles in original hand (excl. salida): 2 (base rate: 1.33)
```

At match end, a cross-hand summary shows trends and salida suit correlation data.

### AI Decision Logs

```
🎲 AI Decision: Opp 1
  Play #5 | Tiles in hand: 6 | Valid moves: 3

  Priority Checks
    1. Winning move: No
    2. High-confidence block: No
    3. Partner support: [5|3]

  Move Scores (sorted by total)
  ┌──────────────┬───────┬───────┬─────┬───────┬─────┬───────┬───────┬─────┬──────┬──────┐
  │ Move         │ Total │ Domin │ Dbl │ Partn │ Own │ Firme │ Block │ Pip │ Flex │ Pace │
  ├──────────────┼───────┼───────┼─────┼───────┼─────┼───────┼───────┼─────┼──────┼──────┤
  │ [5|3] (left) │ 112   │ 30    │ 0   │ 15    │ 20  │ 0     │ 20    │ 12  │ 15   │ 0    │
  │ [4|2] (right)│ 40    │ 7     │ 0   │ 0     │ 0   │ 0     │ 0     │ 9   │ 12   │ 0    │
  └──────────────┴───────┴───────┴─────┴───────┴─────┴───────┴───────┴─────┴──────┴──────┘

  → Chosen: [5|3] | FALLBACK: Highest score (87)
```

---

# Monte Carlo Look-Ahead Simulation (Experienced Fallback)

At the **Experienced** difficulty, the fallback path blends static scoring with Monte Carlo simulation that uses **probability-weighted sampling** to evaluate moves. Unlike traditional approaches that use fixed depth based on game stage, our implementation adapts based on **actual certainty** from probability distributions.

At **Master**, the fallback is replaced by ISMCTS (see the section below) — flat MC sampling is superseded by a proper tree search.

## Key Insight: Certainty-Driven Depth

Certainty should come from the probability distributions, not the game stage:

**Example**: On move 2, Opp 1 plays [6|6], Partner plays [6|0], and you hold [6|5], [6|4], [6|3], [6|2], [6|1]
- All 7 tiles with a 6 are now accounted for
- Certainty about the 6-suit is **100%** on move 2
- Deep simulation is valuable here despite being early game

## Certainty Calculation

```javascript
calculateCertainty() {
    for (tile of unknownTiles) {
        // Get probability distribution across possible holders
        probs = [P(player1), P(player2), P(player3)]

        // Certainty = how peaked is the distribution?
        maxProb = max(probs)  // Higher = more certain

        // Weight by relevance (tiles playable on current ends matter more)
        if (tile.canPlayOnCurrentEnds) weight = 2.0
        else weight = 1.0

        totalCertainty += maxProb * weight
    }

    // Also factor in dead suit information from passes
    return baseCertainty * 0.7 + deadSuitBonus * 0.3
}
```

## Adaptive Parameters

| Certainty | Depth | Samples | Situation |
|-----------|-------|---------|-----------|
| 0.0 - 0.3 | 2 | 85 | Low info, uniform distributions |
| 0.3 - 0.5 | 3 | 65 | Some passes recorded |
| 0.5 - 0.7 | 4 | 50 | Good picture forming |
| 0.7 - 0.9 | 5 | 40 | High confidence |
| 0.9 - 1.0 | 6 | 30 | Near-deterministic |

## Score Blending

Static scoring and Monte Carlo are blended based on certainty:

```javascript
finalScore = (1 - certainty) * staticScore + certainty * mcScore
```

- **Low certainty** → Trust static heuristics (they don't depend on knowing exact hands)
- **High certainty** → Trust Monte Carlo (simulations are accurate when we know the hands)

## Probability-Weighted Sampling

Instead of uniform random sampling, hands are generated using **affinity-weighted selection**:

```javascript
for (tile of unknownTiles) {
    // Filter to eligible players (in possible holders AND still need tiles)
    eligible = players.filter(p => canHold(p, tile) && needsTiles(p))

    // Weight by suit affinity: sqrt(A[player][high] × A[player][low])
    weights = eligible.map(p => getTileAffinity(p, tile))

    // Weighted random selection
    selectedPlayer = weightedRandomSelect(eligible, weights)
    assignTileToPlayer(tile, selectedPlayer)
}
```

This means simulations reflect **behavioral signals** (salida choice, suit introduction, end avoidance) in addition to structural constraints (passes, tile counts). The affinity weights are mild (typically 0.85x–1.5x), so they nudge sampling without overriding hard constraints.

---

# Information Set Monte Carlo Tree Search (Master Fallback)

At the **Master** difficulty, the fallback path is replaced with a proper hidden-information tree search. Where the Monte Carlo blend above samples ~30–100 determinizations and evaluates each move independently on each, **ISMCTS builds one unified search tree across thousands of determinizations, pooling statistics with UCB1 to focus search on moves that look strong *in expectation* across the distribution of possible hidden states.**

## Why ISMCTS and not regular MCTS

Standard MCTS assumes perfect information. Dominoes is a hidden-information game — each player knows their own tiles, observed plays, and observed passes, but the other three hands are uncertain. ISMCTS handles this by *determinizing* on each iteration: it samples one consistent possible full-state from the observer's information set, walks the tree once on that determinization, and pools the result with previous iterations. After thousands of iterations, the tree's visit counts reflect "moves that tend to do well across many possible hidden states" — exactly what we want from an AI making an uncertain decision.

## How it integrates

Since **v1.3.0**, Master is *pure* search. Only Priority 1 (an immediate winning move) short-circuits; every other decision — including cerrar, high-confidence blocking, and partner support, which were hand-coded priorities through v1.2.x — reaches the search and is evaluated in-tree. The Master AI:
1. Constructs an `ISMCTSGameState` wrapping the current `GameState`, `Chain`, and player `Hand`s
2. Calls `ismcts(rootstate, 1000)` from `ISMCTSEvaluator.js`
3. Receives the most-visited root move and plays it

Terminal values use **margin-aware reward shaping** (v1.3.0): `0.8·win + 0.2·(0.5 + 0.5·points/60)`, where `points` is the losing team's remaining pips — the score the winner actually banks under `Rules.calculateHandResult`. Win/loss stays dominant (the margin term shifts a terminal value by at most ±0.1), so the search breaks ties between near-equal win-probability lines in favor of bigger point hauls instead of trading wins for points. Measured in 500-match A/Bs against the v1.2.x hybrid: pure search with binary reward wins 57.0% (CI 52.7–61.3%); pure + margin wins 58.8% (CI 54.5–63.1%). Margin shaping *without* pure mode was an exact wash — the decisions where margin matters (closes) never reached the search while the P2 priority preempted them. The harness variants `legacy-hybrid` and `reward-binary` reproduce the old configurations for regression A/Bs.

The static 10-factor scoring still runs, so decision instrumentation (factor breakdowns, top-factor records) stays populated for the debrief and debug logs — only the *selection* of the chosen move shifts from "highest scored" to "most-visited in the ISMCTS tree." The P2–P4 priority code paths remain active at Experienced. At Master, the v1.1.2 `cuadrarPipThreshold` no longer gates closes — the search weighs closing moves directly against the sampled distribution of hidden hands.

## Iteration count

The default is **1000 iterations per decision**. Mean wall time per AI move at this setting is **~7 ms** (v1.3.0 pure mode — more decisions reach the search than under the v1.2.x hybrid), with a long tail up to **~310 ms** in complex positions. Both are imperceptible behind the UI's existing AI "thinking" delay.

This number was chosen empirically by running A/Bs at 200, 1000, 2000, 5000, and 10000 iterations against the Experienced fallback. At 200 iterations the search was too thin (~50% win rate, indistinguishable from Experienced). From 1000 iterations onward the result becomes a clear win and the marginal benefit of more iterations flattens — at 500 matches the win rate at 1000 and 5000 iterations is statistically indistinguishable (65.6% vs 63.4%), while 1000 is ~3.5× faster. At 10000 iterations the result *regressed* due to garbage-collection pauses on a very large tree, with worst-case decision latencies up to ~25 seconds. **1000 iterations is the sweet spot of strength vs. latency.**

## Determinization

Each iteration calls `ISMCTSGameState.cloneAndRandomize(observer)`, which delegates to `PlayerView._sampleValidDeals(1)` — the same affinity-weighted hand sampler the Monte Carlo blend already uses. This means our ISMCTS determinization respects everything the AI has observed (played tiles, passes, dead-suit inferences, suit-affinity signals) by construction. Since v1.2.6 the sampler carries a backtracking backstop (`PlayerView._backtrackingDeal`): if the greedy assignment dead-ends in a constrained position, a most-constrained-first backtracking search completes the deal instead of failing — previously ~2% of determinizations silently fell back to the *real* hands, an information leak into the search. Pure uniform sampling within the information set may be A/B'd as a future variant; the current default uses affinity-weighted sampling.

## Attribution

The ISMCTS algorithm was introduced by:

> **Peter I. Cowling, Edward J. Powley, Daniel Whitehouse.**
> *"Information Set Monte Carlo Tree Search."*
> IEEE Transactions on Computational Intelligence and AI in Games, vol. 4, no. 2, pp. 120–143, June 2012.
> [doi:10.1109/TCIAIG.2012.2200894](https://doi.org/10.1109/TCIAIG.2012.2200894)

The authors (at the University of York, UK) also released a **canonical Python reference implementation** alongside the paper, distributed under a permissive use-and-distribute license. Our JavaScript port in [`docs/js/ai/ISMCTSEvaluator.js`](docs/js/ai/ISMCTSEvaluator.js) is a near line-for-line translation of that reference — the `Node` class, the UCB1 selection formula (`wins/visits + c·√(log(avails)/visits)` with `c ≈ √2/2`), and the determinize/select/expand/simulate/backpropagate iteration loop. The original Python remains the simplest and clearest exposition of the algorithm. A copy is preserved at `~/Documents/Claude-code-projects/ISMCTS-Dominoes/president/framework.py`.

Two further references that informed the integration design:

- **[isaacbuckman/Dominoes](https://github.com/isaacbuckman/Dominoes)** — an ISMCTS implementation for 4-person partnership dominoes (sibling variant to our Cuban/Puerto Rican rules). Useful for understanding how the ISMCTS state interface (`getMoves`, `doMove`, `cloneAndRandomize`, `getResult`) maps onto a partnership-dominoes game state.
- **[angeris/DominAI](https://github.com/angeris/DominAI)** — Stanford CS221 final project exploring Negamax + PIMC/IMS search for dominoes. A sound technical alternative; we chose ISMCTS over PIMC for its simpler implementation and stronger theoretical guarantees in hidden-information settings.

---

# Features

- **Partnership Dominoes**: 4-player teams (You + Partner vs. Opponents)
- **Configurable AI Difficulty**: Set each AI player (Opp 1, Partner, Opp 2) independently to Beginner, Experienced, or Master. Settings persist in localStorage.
- **ISMCTS-Powered Master**: At Master difficulty, nearly every decision runs through Information Set Monte Carlo Tree Search (Cowling, Powley, Whitehouse 2012) with margin-aware reward shaping (v1.3.0 pure-search rework: 58.8% head-to-head vs. the v1.2.x priority hybrid, which itself won ~66% vs. Experienced).
- **Smart AI**: Priority-based decisions with calibrated probabilities, firme reasoning, cuadrar pip-advantage threshold, weighted 10-factor scoring, and Monte Carlo look-ahead (Experienced) or pure ISMCTS (Master)
- **Genín Coach**: Ask Genín for move advice with strategic explanations — firme detection, cuadrar/cerrar analysis, opponent reads, and partner support guidance
- **Bayesian Inference**: AI tracks suit affinities from play patterns (salida, suit introduction, end avoidance) to sharpen probability estimates
- **Quiz Mode**: Test your ability to predict opponent hands
- **Debrief**: Post-match analysis with play-by-play review
- **Lifetime Stats & Badges**: Trophy icon opens a stats modal with match history, hand breakdown, cerrado records, and coaching metrics. Twelve achievement badges unlock as you hit milestones and appear as toast notifications.
- **Tile Attribution**: Toggle "Show who played" to overlay semi-transparent color masks (cyan/red/purple/yellow) on each chain tile, identifying its player at a glance. Desktop also shows a shape indicator (●■▲◆) for a second visual cue.
- **Claude Integration**: Optional AI-powered play style analysis in the debrief. Requires a personal API key from [console.anthropic.com](https://console.anthropic.com) — each user needs their own.
- **PWA / Installable**: Add to home screen on iPhone (Safari) or Android (Chrome) — runs full-screen with no browser chrome and works offline after first load
- **Bilingual**: Full English/Spanish support
- **Mobile-Optimized**: Portrait-mode layout stacks the header vertically so buttons never overlap the title

---

# Genín Coach — Advice System

During your turn, click **"Ask Genín"** to get a move recommendation with a strategic explanation. **As of v1.2.2** Genín's recommendation goes through the full **Master** decision pipeline — which since **v1.3.0** means pure ISMCTS tree search at 1000 iterations with margin-aware reward (only an immediate winning move short-circuits; cerrar, blocking, and partner-support trade-offs are weighed inside the search). The static factor breakdown is computed on top of the chosen move so the explanation below still describes *why* the move is strong in factor terms. (Previously Genín used only single-ply static scoring, which Mario observed as "very focused on single plays rather than the longitudinal game" — accurate, because no priorities or lookahead ran.)

Genín shows:

1. **The recommended tile** rendered as a domino, with play direction (left/right)
2. **A brief reason** — the dominant strategic factor (e.g., "support partner", "unload double with cover")
3. **A detail line** — deeper context from one of these priority tiers:

| Priority | Trigger | Detail shown |
|----------|---------|-------------|
| **Firme** | You hold ALL remaining tiles of a suit on an open end | "You are firme on 5s (3 tiles)" + whether the move preserves or spends it |
| **Cuadrar/Cerrar** | The move makes both ends the same value | Blocking probabilities for opponents |
| **Blocking** | The new end is a suit an opponent lacks | "Opp 1 lacks 3s" |
| **Partner support** | Partner has a signaled suit | Partner's most likely tiles in that suit |
| **Opponent reads** | Late game (16+ tiles played), opponent has ≤3 tiles | Estimated likely tiles for opponents |

**Special cases:**
- Only one legal move → Genín switches to a "thinking" pose and quips about it
- La salida (first play) → "La Salida — open strong!"
- Must pass → "Nothing to play — you must pass."

---

# Development

```bash
# Serve locally
npx serve docs

# Open in browser
open http://localhost:3000

# Enable AI debug mode
open http://localhost:3000?debug=ai
```

---

# License

MIT License - Created by Mario Alonso

**Live at:** [https://maralons0.github.io/domino-advisor/](https://maralons0.github.io/domino-advisor/)
