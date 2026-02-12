# 7 Fichas - Partnership Dominoes vs. AI

A web-based domino game that simulates 4-player partnership dominoes (Cuban/Puerto Rican style) with an intelligent AI opponent. Built as a training tool to help players improve their strategic thinking.

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
docs/js/
├── main.js                 # Application entry point, UI controller
├── ai/
│   ├── SmartAI.js          # Strategic AI decision engine
│   ├── MonteCarloEvaluator.js # Probability-weighted look-ahead simulation
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
├── services/
│   ├── ClaudeService.js    # Claude API integration for analysis
│   └── QuizStorage.js      # localStorage for quiz history
├── ui/
│   ├── DebriefUI.js        # Post-match review modal
│   └── SettingsUI.js       # Settings modal
└── i18n/
    ├── i18n.js             # Translation engine
    └── translations.js     # EN/ES strings
```

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
│  3. PRIORITY 1: Winning move? ──Yes──► Play it (domino!)    │
│                    │                                        │
│                   No                                        │
│                    ▼                                        │
│  4. PRIORITY 2: Block with P > 0.7? ──Yes──► Play it        │
│                    │                                        │
│                   No                                        │
│                    ▼                                        │
│  5. PRIORITY 3: Partner support (plays < 8)? ──Yes──► Play  │
│                    │                                        │
│                   No                                        │
│                    ▼                                        │
│  6. FALLBACK: Score all moves, pick highest                 │
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

When no priority triggers, the AI scores every valid move using 9 strategic factors:

| Factor | Weight Range | Description |
|--------|-------------|-------------|
| **Suit Dominance** | -50 to +50 | `((myTeam - oppTeam) / remaining) × 50`. Team-aware: uses HandTracker to estimate who controls the suit. Negative when opponents dominate (e.g., their salida + partner passed). |
| **Double Management** | -15 to +25 | +25 if double has cover (other tiles in suit), -15 if exposed, +10 if suit nearly dead |
| **Partner Support** | 0-37 | +15 for playing partner's suit, +10 for leaving it open. ×1.5 when partner leads (fewer tiles), ×0.5 when I lead. |
| **Own Suit Protection** | -25 to +20 | +20 for keeping own salida open, -25 for killing it. ×0.5 when partner leads (defer to them). |
| **Firme Protection** | -35 to +40 | A "firme" = you hold ALL remaining tiles of a suit on an open end. -35 for spending last firme tile, +10 to +40 for preserving it (scaled by count). |
| **Blocking Potential** | 0-70+ | +20 per opponent who passed on the new end value, +15 per inferred dead suit (×2 opponents) |
| **Pip Management** | 0-18 | `pips × 1.5` early game (plays < 10), `pips × 0.5` late game. Unload high tiles early. |
| **Hand Flexibility** | 0-21 | `distinct_playable_values × 3`. More unique values after play = harder to block. |
| **Pace Control** | 0-20 | Defensive when opponent ≤2 tiles (leave values they lack). Aggressive when partner ≤2 tiles (open for them). |

### Key Design Decisions

**Suit Dominance (team-aware)** uses HandTracker probability distributions to estimate how many tiles of a suit each team holds. The formula `((myTeamCount - oppTeamCount) / remaining) × 50` produces positive scores when your team controls the suit and negative when opponents do. For example, if opponents led with [5|5] and your partner passed on 5, opening the 5 end scores strongly negative because opponents hold most remaining 5-tiles.

**Hand Flexibility** is separate from Suit Dominance. A hand with [5|3], [5|4], [5|1], [5|0] has great dominance in 5s but terrible flexibility - only two distinct non-5 values. This factor penalizes moves that reduce your breadth of playable values.

**Lead/Follow Dynamics** modulate Partner Support and Own Suit Protection. When partner is leading (fewer tiles), support is amplified ×1.5 and own suit protection drops to ×0.5 - the AI defers to whoever is closer to winning. When I'm leading, support drops to ×0.5 so I focus on finishing rather than helping.

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

> **Status (v0.4.2):** Affinities are temporarily disabled pending calibration. Brier score analysis showed the previous weights (2.0x/1.5x/1.2x/0.85x) degraded prediction accuracy. Empirical measurement of salida suit correlation shows ~1.2x signal strength, significantly less than the 2.0x weight that was used.

Each `(player, suit)` pair has a multiplier `A[player][suit]`, initialized to 1.0 per hand.

| Event | Old Weight | Measured Signal | Status |
|-------|-----------|----------------|--------|
| Salida with double [V\|V] | 2.0x | ~1.2x | Pending recalibration |
| Salida non-double (introduces V) | 1.5x | ~1.2x | Pending recalibration |
| Subsequent play introduces V | 1.2x | Not measured | Disabled |
| End avoidance (could play B, chose A) | 0.85x | Not measured | Disabled |

Affinities are clamped to [0.1, 5.0]. When enabled, probability formula for tile T with values (H, L), target player P:

1. `base(P, T) = tileCounts[P] / possibleTilesForPlayer(P)`
2. `affinity(P, T) = sqrt(A[P][H] × A[P][L])` (geometric mean; for doubles just `A[P][V]`)
3. `raw(P, T) = base(P, T) × affinity(P, T)`
4. Normalize per tile: `P(P has T) = raw(P, T) / Σ raw(Q, T)` across all possible holders Q

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

# Monte Carlo Look-Ahead Simulation

The AI uses Monte Carlo simulation with **probability-weighted sampling** to evaluate moves. Unlike traditional approaches that use fixed depth based on game stage, our implementation adapts based on **actual certainty** from probability distributions.

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

Instead of uniform random sampling, hands are generated proportionally to HandTracker probabilities:

```javascript
for (tile of unknownTiles) {
    // Get probability each player holds this tile
    probs = [handTracker.getProbability(p, tile) for p in [1,2,3]]

    // Weighted random selection respecting tile counts
    selectedPlayer = weightedRandomSelect(players, probs)
    assignTileToPlayer(tile, selectedPlayer)
}
```

This means simulations reflect our **best knowledge**, not random possibilities

---

# Features

- **Partnership Dominoes**: 4-player teams (You + Partner vs. Opponents)
- **Smart AI**: Priority-based decisions with weighted scoring
- **Quiz Mode**: Test your ability to predict opponent hands
- **Debrief**: Post-match analysis with play-by-play review
- **Claude Integration**: Optional AI-powered play style analysis
- **Bilingual**: Full English/Spanish support
- **Genín Mascot**: Your friendly domino coach

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
