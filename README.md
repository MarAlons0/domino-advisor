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
| **Suit Strength** | 0-60+ | `count_in_hand × 10`. Prefer playing from suits you have many of. |
| **Double Management** | -15 to +25 | +25 if double has cover (other tiles in suit), -15 if exposed, +10 if suit nearly dead |
| **Partner Support** | 0-25 | +15 for playing partner's suit, +10 for leaving it open |
| **Blocking Potential** | 0-40+ | +20 per opponent who passed on the new end value, +15 per inferred dead suit |
| **Pip Management** | 0-20 | `pips × 1.5` early game (plays < 10), `pips × 0.5` late game. Unload high tiles early. |
| **End Control** | 0-30 | `our_strength_in_new_end × 5`. Keep suits we're strong in open. |
| **Tile Counting Bonus** | -10 to +10 | +10 if >3 tiles remain in suit, -10 if ≤1 remain (dead suit) |
| **Avoid Dead Suits** | -30 to 0 | -30 penalty for leaving a completely dead suit open |

### Scoring Example

Move: `[5|3]` on left end, leaving 5 open

| Factor | Calculation | Score |
|--------|------------|-------|
| Suit Strength | 2 fives in hand × 10 | +20 |
| Double Management | Not a double | 0 |
| Partner Support | Partner signaled 5s | +15 |
| Blocking Potential | Opp 1 passed on 5 | +20 |
| Pip Management | 8 pips × 1.5 (early) | +12 |
| End Control | 2 fives remaining × 5 | +10 |
| Tile Counting | 4 fives still out | +10 |
| Avoid Dead Suits | Not dead | 0 |
| **TOTAL** | | **87** |

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
  ┌──────────────┬───────┬─────────┬────────┬─────────┬───────┬─────┬────────┬─────────┬───────┐
  │ Move         │ Total │ SuitStr │ Double │ Partner │ Block │ Pip │ EndCtl │ TileCnt │ Avoid │
  ├──────────────┼───────┼─────────┼────────┼─────────┼───────┼─────┼────────┼─────────┼───────┤
  │ [5|3] (left) │ 87    │ 20      │ 0      │ 15      │ 20    │ 12  │ 10     │ 10      │ 0     │
  │ [4|2] (right)│ 44    │ 10      │ 0      │ 0       │ 0     │ 9   │ 5      │ 0       │ -10   │
  └──────────────┴───────┴─────────┴────────┴─────────┴───────┴─────┴────────┴─────────┴───────┘

  → Chosen: [5|3] | FALLBACK: Highest score (87)
```

---

# Future: Monte Carlo Look-Ahead Simulation

The current AI makes decisions based on the immediate state. A Monte Carlo approach would:

1. **Sample possible hands**: Generate N random distributions of unknown tiles consistent with known constraints
2. **Simulate play**: For each sample, simulate several moves ahead
3. **Evaluate outcomes**: Score terminal positions or use heuristics
4. **Average results**: Choose the move with best average outcome across samples

### Considerations for Implementation

**Computational cost:**
- 21 unknown tiles distributed among 3 players
- Combinatorial explosion of possible hands
- Need efficient sampling that respects constraints (passes, tile counts)

**Simulation depth:**
- Full game simulation is expensive
- 2-4 moves ahead may be sufficient
- Need fast evaluation heuristic for non-terminal states

**Key scenarios where look-ahead helps:**
- Endgame with few tiles remaining
- Deciding whether to block or keep playing
- Sacrificing short-term score for positional advantage

### Proposed Architecture

```javascript
class MonteCarloAI extends SmartAI {
    chooseMoveWithLookahead(gameState, playerIndex, simulations = 100, depth = 3) {
        const validMoves = getValidMoves(...);
        const scores = new Map();

        for (const move of validMoves) {
            let totalScore = 0;

            for (let i = 0; i < simulations; i++) {
                // Sample a consistent hand distribution
                const sampledState = this.sampleHands(gameState);

                // Simulate play for 'depth' moves
                const outcome = this.simulate(sampledState, move, depth);

                totalScore += this.evaluateOutcome(outcome, playerIndex);
            }

            scores.set(move, totalScore / simulations);
        }

        return getBestMove(scores);
    }
}
```

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
