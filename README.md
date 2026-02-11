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
│   ├── HandTracker.js      # Tile probability tracking
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

**Trigger condition:** `P(opponent passes) >= 0.7` (70% confidence threshold)

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

When no priority triggers, the AI scores every valid move using 8 strategic factors:

| Factor | Weight Range | Description |
|--------|-------------|-------------|
| **Suit Dominance** | 0-50 | `(my_count / remaining_in_suit) × 50`. Fraction-based: 2/7 early = 14, 1/2 late = 25, 3/3 = 50 (total control). |
| **Double Management** | -15 to +25 | +25 if double has cover (other tiles in suit), -15 if exposed, +10 if suit nearly dead |
| **Partner Support** | 0-37 | +15 for playing partner's suit, +10 for leaving it open. ×1.5 when partner leads (fewer tiles), ×0.5 when I lead. |
| **Own Suit Protection** | -25 to +20 | +20 for keeping own salida open, -25 for killing it. ×0.5 when partner leads (defer to them). |
| **Blocking Potential** | 0-70+ | +20 per opponent who passed on the new end value, +15 per inferred dead suit (×2 opponents) |
| **Pip Management** | 0-18 | `pips × 1.5` early game (plays < 10), `pips × 0.5` late game. Unload high tiles early. |
| **Hand Flexibility** | 0-21 | `distinct_playable_values × 3`. More unique values after play = harder to block. |
| **Pace Control** | 0-20 | Defensive when opponent ≤2 tiles (leave values they lack). Aggressive when partner ≤2 tiles (open for them). |

### Key Design Decisions

**Suit Dominance (fraction-based)** replaces the previous absolute-count approach. Having 2 tiles of a suit early game (2/7 = 29%) is strategically weaker than having 1 tile late game (1/2 = 50%). The fraction captures actual control over a suit.

**Hand Flexibility** is separate from Suit Dominance. A hand with [5|3], [5|4], [5|1], [5|0] has great dominance in 5s but terrible flexibility - only two distinct non-5 values. This factor penalizes moves that reduce your breadth of playable values.

**Lead/Follow Dynamics** modulate Partner Support and Own Suit Protection. When partner is leading (fewer tiles), support is amplified ×1.5 and own suit protection drops to ×0.5 - the AI defers to whoever is closer to winning. When I'm leading, support drops to ×0.5 so I focus on finishing rather than helping.

**Pace Control** adjusts play style based on who's winning. When opponents are about to domino (≤2 tiles), the AI plays defensively - leaving values opponents lack. When partner is about to win, it opens the game up. This implements the "llave" concept: holding the last tile of a suit blocks that end for everyone.

### Scoring Example

Move: `[5|3]` on left end, leaving 5 open (3 of 5 remaining fives in hand)

| Factor | Calculation | Score |
|--------|------------|-------|
| Suit Dominance | 3/5 fives = 60% × 50 | +30 |
| Double Management | Not a double | 0 |
| Partner Support | Partner signaled 5s | +15 |
| Own Suit Protection | Own suit (3s) still open | +20 |
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

## getProbability(player, tile)

Returns the probability that a specific player holds a specific tile.

**Algorithm:**
```
If tile is played or in human hand: return 0

If player is not in possibleHolders: return 0

Otherwise:
  N = number of tiles this player could possibly have
  M = number of tiles this player actually has (tileCounts[player])

  P = M / N  (uniform distribution assumption)
```

**Example:**
- Player 1 has 5 tiles remaining
- There are 12 unknown tiles they could possibly hold
- P(Player 1 has tile X) = 5/12 = 0.417

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

# Developer Debug Mode

Enable detailed AI decision logging by adding `?debug=ai` to the URL:

```
https://maralons0.github.io/domino-advisor/?debug=ai
```

Open browser DevTools (F12) → Console tab to see:

```
🎲 AI Decision: Opp 1
  Play #5 | Tiles in hand: 6 | Valid moves: 3

  Priority Checks
    1. Winning move: No
    2. High-confidence block: No
    3. Partner support: [5|3]

  Move Scores (sorted by total)
  ┌──────────────┬───────┬───────┬─────┬───────┬─────┬───────┬─────┬──────┬──────┐
  │ Move         │ Total │ Domin │ Dbl │ Partn │ Own │ Block │ Pip │ Flex │ Pace │
  ├──────────────┼───────┼───────┼─────┼───────┼─────┼───────┼─────┼──────┼──────┤
  │ [5|3] (left) │ 112   │ 30    │ 0   │ 15    │ 20  │ 20    │ 12  │ 15   │ 0    │
  │ [4|2] (right)│ 40    │ 7     │ 0   │ 0     │ 0   │ 0     │ 9   │ 12   │ 0    │
  └──────────────┴───────┴───────┴─────┴───────┴─────┴───────┴─────┴──────┴──────┘

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
