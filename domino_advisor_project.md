# Domino Advisor - Project Definition

**Current Version**: v0.2.1 (Beta)

## Version History

| Version | Date | Highlights |
|---------|------|------------|
| v0.2.1 | Feb 2026 | Mobile viewport fix, responsive chain layout, turn connectors |
| v0.2 | Jan 2026 | Probability-based AI with priority overrides, partner support fix, help modal, quiz mode, hand tracking, player color coding, tile attribution |
| v0.1 | Jan 2026 | Initial release: game engine, SmartAI, match debrief, Claude analysis |

---

## Project Overview

**Domino Advisor** is a web-based training tool and game simulator for Mexican-style partnership dominoes. The application teaches strategic thinking through detailed, principle-based explanations of optimal plays while allowing users to play against AI opponents or analyze specific game situations.

---

## Game Rules: Mexican Partnership Dominoes

### Basic Setup
- **Players**: 4 players in 2 fixed teams (partners sit across from each other)
- **Tiles**: Standard double-six set (28 tiles)
- **Deal**: All tiles dealt, 7 per player (no boneyard)
- **Direction**: Counter-clockwise play

### Game Flow
1. **First hand**: Player with double-six leads and must play it
2. **Subsequent hands**: Winning team starts; either partner may lead with any tile
3. **Play**: Each player must play a matching tile if able; otherwise pass
4. **End conditions**:
   - **Domino**: One player plays all their tiles (team wins)
   - **Blocked game**: All four players pass consecutively (team with lowest pip count wins)

### Scoring
- **Domino win**: Winning team scores the pip total of the losing team's remaining tiles
- **Blocked game**: Winning team scores the losing team's pip total
- **Target**: First team to 100 points wins the match

---

## Core Features

### 1. Game Simulator (Play Mode)
- Play against 3 AI opponents (you + AI partner vs. 2 AI opponents)
- Full game with proper rules enforcement
- Visual tile representation (graphical domino pips)
- Chain visualization that bends at configurable thresholds (mimicking table play)
- Track score across hands toward 100-point target

### 2. Training Mode
- **Concept + Practice format**: Each lesson introduces a strategic principle, then walks through a full hand demonstrating it
- Example concepts:
  - Opening strategy and suit strength
  - Supporting vs. leading as partner
  - When and how to unload doubles
  - Blocking and forcing passes
  - Endgame calculation and closing decisions

### 3. Position Analyzer
- Manual entry of game state (your hand, tiles played, passes observed)
- OR step-by-step recording from hand start
- Detailed recommendations with principle-based explanations

### 4. Game Review
- Save and replay completed games
- Move-by-move commentary on optimal vs. actual plays
- Highlight decision points and alternatives

---

## Strategic Principles (Advisor Knowledge Base)

The advisor must articulate recommendations using these principles. Each recommendation should cite which principles apply and explain the tradeoffs.

### Traditional Terminology (Glossary)

The advisor should use and teach these traditional terms from Latin American domino culture:

| Term | Definition |
|------|------------|
| **La Salida** | The opening play; signals strategy to partner |
| **Tranque / Trancado** | A blocked game, or a blocking play |
| **Capicú** | Winning with a non-double playable on either end (100 pt bonus) |
| **Chuchazo** | Winning by playing only the double-blank as last tile (100 pt bonus) |
| **Ahorcado** | A "hanged" double—can no longer be played because all 6 other tiles in that suit have been played |
| **La Puerta** | Holding the last remaining tile of a specific number ("the door") |
| **Matar Cabeza** | Stealing opponent's intended play by blocking |
| **Darle Pase** | Playing a tile you know forces opponent to pass |
| **Cuadrar** | Squaring the board—making both ends show the same number |
| **Tocar** | Knocking/tapping the table to indicate a pass |
| **Ficha** | A domino tile |

---

### Tier 1: Fundamentals

#### 1. Tile Counting & Tracking
- Track which tiles have been played throughout the hand
- Track suits by count (how many of each number 0-6 remain)
- **Mathematical board control**: With 28 tiles distributed 7 per player, calculate probabilities of who holds remaining tiles
- **Reverse engineering**: Deduce opponent hands from played tiles + observed passes
- Keep a mental ledger of suits opponents lack (indicated by passes)
- When 6 tiles of a number have been played and you hold the 7th, you have *la puerta*—complete control of that suit

#### 2. Remaining Points Calculation
- Calculate pip totals remaining in each player's likely hand
- Critical when deciding whether to close (block) the game
- Factor in score differential—be more aggressive when behind
- Remember: "Dying with double-six = 12 points"—often the difference between winning and losing
- In close games near 100 points, pip counting determines strategy

#### 3. Suit Strength & Control
- **Strong suit**: A suit where you hold 3+ tiles (the more, the stronger)
- Lead with your strongest suit (preferably with a double) to signal partner
- Maintain control by keeping your strong suit on the open ends
- Yield weak suits to avoid getting stuck
- **Zone control**: Dominate specific numerical areas of the board; if you control most tiles with numbers 4 and 5, create positions where those numbers dominate the endpoints

#### 4. Double Management
- Doubles are liabilities if not played (no flexibility—only one playable end)
- **Unload doubles when**:
  - You have *cover* (tiles to play afterward on both ends)
  - The suit is active and likely to stay open
  - You can use the double to limit opponent options (forces them to match that specific number)
- **Hold doubles when**:
  - Partner controls the suit (let them open it)
  - You lack cover and may get stuck
- **Ahorcado risk**: A double becomes permanently unplayable when all 6 other tiles in that suit are played—track this carefully
- Double-6 on opening hand is mandatory—plan your entire hand around it

---

### Tier 2: Partnership

#### 5. Partner Coordination (La Salida & Support)
- **Reading la salida**: Partner's opening tile signals their strong suit—play to it consistently
- **The golden rule**: "Avoid hitting the tile played by your partner unless you have no other choice"
- Keep partner's original suit open; don't cover their salida with a different number
- **Leading vs. Supporting roles**:
  - *Lead partner*: Sets the suit direction via la salida, plays offensively
  - *Supporting partner*: Reinforces lead partner's suit, plays defensively, keeps their ends open
- Support partner's suit even at cost to your own hand
- **Role switching**: Recognize when to take over leadership vs. continue supporting (e.g., when partner passes on their own suit)
- **Sacrificial play**: Sometimes pass even when you can play, to preserve partner's options when they have limited plays
- **Consistency principle**: Once you start playing to a number, repeat that play as much as possible—this also "bleeds" opponents of that suit

#### 6. Partner Communication Through Play
- Your tile choices communicate information—be consistent so partner can read you
- Playing the same suit repeatedly signals strength; switching signals weakness or necessity
- If partner suddenly plays off-suit, they may be signaling distress or lack of options
- **Implicit signaling**: Note that explicit signals (verbal, gestures) are illegal in competitive play—all communication must be through tile selection

---

### Tier 3: Tactical

#### 7. Blocking & Disruption
- Force opponent passes by killing their suits (*darle pase*)
- Track opponent passes to identify their dead suits—then exploit these weaknesses
- **"Bleeding" opponents**: Repeatedly play the same number to deplete their matching tiles
- "Hanging" a double (playing one you can't cover) can trap opponents, but is risky
- Close ends with tiles your opponents likely can't match
- **Early identification**: Start identifying opponent weaknesses from the first pass, not reactively
- **Matar cabeza**: When you deduce opponent's intended play, block it preemptively

#### 8. Positional Play (End Control)
- Keep favorable suits open on the chain ends
- **Cuadrar (Squaring)**: Making both ends the same number gives you control if you have that double—opponents can only play tiles with that one number
- Squaring is powerful but risky: if you also lack that number, you may trap yourself
- Avoid leaving opponent's strong suits open
- When both ends match a number where you hold *la puerta*, you have complete control

#### 9. Endgame Technique
- With few tiles left, calculate forced sequences (which plays are inevitable)
- **"Pull the hand"**: Determine if you can force a win through remaining plays
- Decide whether to domino vs. block (*trancar*) based on point differential
- When losing, minimize pip count; when winning, accelerate to domino
- **Closing strategy**: Plan from early in the hand which combinations enable favorable closures
- Retain key tiles for endgame execution rather than playing them early

#### 10. Risk Assessment & Game State Awareness
- Score differential matters: adjust aggression based on match standing
- **When ahead (30+ points)**: Play conservatively, prioritize blocking, protect the lead
- **When behind**: Take calculated risks, hold heavy tiles for forcing scenarios
- Factor in who has control of the current hand
- Near game end (approaching 100 points): every pip counts—calculate precisely

---

### Tier 4: Advanced

#### 11. Jamming & Trapping
- **"Jam the game" (Trancar)**: Intentionally block the game when you have the lowest pip count
- **"Build a house"**: Set up a position where opponent cannot avoid giving you winning plays
- Recognize when opponent is attempting to trap you
- Use *ahorcado* strategically: if you can hang an opponent's double, they lose flexibility

#### 12. Tempo Control
- Establish game rhythm early, favoring your strongest tiles
- Force opponents to adapt to your strategic pace
- **Vary tempo**: Alternate between fast and deliberate plays to prevent opponent pattern prediction
- Scoring consistently keeps initiative—opponents struggle to recover momentum
- Control the pace especially when you have positional advantage

#### 13. Information Control & Deception
- **Chain strategy**: Create apparently predictable sequences with hidden continuations
- Example: Lead with 6-4, 4-2 to seem predictable, then surprise with 2-5, 5-3 connections
- Conceal numerical dominance until the optimal moment to reveal it
- Appear to have normal tile distribution while secretly holding control of key suits
- Don't telegraph your strong suits too early if you can afford to wait

#### 14. Game Reading & Psychology
- Monitor opponent behavior: hesitation, examination duration, play speed
- Quick plays often indicate forced moves or obvious choices; hesitation suggests multiple options
- **Psychological pressure**: Deliberately position numbers opponents avoid at endpoints, forcing repeated passes and frustration
- Exploit stress-induced errors, especially in close games
- The Cuban tradition holds that dominoes is "a psychological battle to invade, occupy, and destroy rivals' minds"

---

### Named Strategies (from Literature)

These named strategies come from competitive domino literature (primarily Miguel Lugo's *Competitive Dominoes*):

| Strategy | Description |
|----------|-------------|
| **Cover** | Ensuring you have follow-up plays after your current move |
| **Repeat** | Consistently playing your strong suit to maintain control and bleed opponents |
| **Square** | Making both ends show the same number (*cuadrar*) |
| **Pull the Hand** | Force a win through a calculated sequence of remaining plays |
| **Build a House** | Set up a position where opponent cannot avoid giving you winning plays |
| **Three Laws of Dominotics** | Lugo's foundational principles (see *Competitive Dominoes* for details) |

---

### Bonus Scoring (Regional Variants)

Some regional rule sets include bonus scoring that affects strategy:

| Bonus | Condition | Points | Strategic Implication |
|-------|-----------|--------|----------------------|
| **Capicú** | Win with non-double playable on either end | 100 | Worth taking risks to achieve |
| **Chuchazo** | Win by playing double-blank as only remaining tile | 100 | Hold chucha (0-0) when possible |
| **Dominao** | Win with a double playable on either end (non-blank) | Varies | Consider when holding key doubles |

*Note: Verify which bonuses apply in your rule set before adjusting strategy.*

---

## User Interface Requirements

### Visual Design
- **Mobile-first, responsive**: Works well on phones and tablets
- **Tile display**: Graphical dominoes with pips (not just numbers)
- **Chain layout**: 
  - Horizontal chain from the starting double (spinner)
  - Bends 90° to the right when reaching threshold (configurable, e.g., 6 tiles per branch)
  - Shows both open ends clearly

### Game Screen Elements
- Your hand (bottom)
- Chain/board (center)
- Score display (current hand + match total)
- Pass indicators for each player
- Current player indicator
- Play history sidebar (collapsible on mobile)

### Training Mode Elements
- Concept introduction panel
- Guided play with hints
- "Why this play?" explanations on demand
- Progress through lesson sequence

### Feedback Options
- **Real-time mode**: After each play, show optimal play and explanation
- **Review mode**: Play without interruption, then walk through analysis at hand's end
- Toggle between modes in settings

---

## Technical Specifications

### Platform
- Web application (HTML/CSS/JavaScript)
- React or vanilla JS (developer preference)
- No backend required for v1 (stateless)
- Local storage for settings only

### AI Engine
- Implement tile tracking and probability inference
- Minimax or Monte Carlo tree search for move evaluation
- Single difficulty level: competent AI that follows strategic principles
- AI should "explain" its reasoning using the principle vocabulary

### Data Structures
```
Tile: { high: 0-6, low: 0-6 }  // e.g., { high: 5, low: 3 }
Hand: Tile[]
GameState: {
  hands: [Hand, Hand, Hand, Hand],  // indexed by seat position
  chain: { tiles: Tile[], leftEnd: number, rightEnd: number },
  passes: [boolean[], boolean[], boolean[], boolean[]],  // pass history by suit
  currentPlayer: 0-3,
  scores: [teamAScore, teamBScore],
  matchScores: [teamAMatchScore, teamBMatchScore]
}
```

### Move Recommendation Format
```
Recommendation: {
  tile: Tile,
  end: 'left' | 'right',
  confidence: 0-100,
  primaryPrinciples: string[],  // e.g., ["Suit Strength", "Partner Coordination"]
  explanation: string,          // Natural language explanation
  alternatives: Alternative[]   // Other viable plays with reasons
}
```

---

## Development Phases

### Phase 1: Core Game Engine
- Implement tile set, dealing, valid move detection
- Build game state management
- Create basic AI (random legal moves)
- Simple text-based interface for testing

### Phase 2: Basic UI
- Graphical tile rendering
- Chain visualization with bending
- Player hand display
- Turn management and pass handling

### Phase 3: Smart AI + Advisor
- Implement tile counting logic
- Add probability inference from passes
- Build move evaluation using strategic principles
- Create explanation generator

### Phase 4: Training Mode
- Design lesson structure (concept + practice hand)
- Implement guided play with hints
- Build feedback system (real-time and review)

### Phase 5: Polish & Mobile
- Responsive design optimization
- Touch interactions for mobile
- Settings and preferences
- Game history/replay

---

## Out of Scope (v1)

- User accounts / authentication
- Online multiplayer
- Multiple AI difficulty levels
- Save/load games to cloud
- Tournament mode
- Spanish language (English only for v1)

---

## Success Criteria

1. User can play a complete game against AI opponents following Mexican rules
2. AI plays competently (doesn't make obviously bad moves)
3. Advisor provides clear, principle-based explanations for every recommendation
4. Training mode teaches at least 5 core concepts with practice hands
5. Interface works smoothly on both desktop and mobile browsers
6. Chain visualization correctly bends at threshold points

---

## References

### Books
- Miguel Lugo, *Competitive Dominoes: How to Play Like a Champion* (2nd Edition, Dog Ear Publishing, 2016) — Covers the Three Laws of Dominotics, Cover/Repeat/Square strategies, and advanced techniques like "pull a hand" and "build a house"
- Gabriel Antonio Tejeira Arias, *How to Play Latin Partnership Dominoes* (Hats Off Books, 2001) — Progressive strategy guide covering aggressive and conservative playing styles

### Online Resources
- [Pagat.com - Partnership Dominoes](https://www.pagat.com/domino/line/partnership.html) — Authoritative rules and strategy overview
- [Pagat.com - Cuban Dominoes](https://www.pagat.com/domino/line/cuban.html) — Cuban variant rules
- [Chess and Poker - Dominoes Strategy](https://www.chessandpoker.com/dominoes-strategy.html) — Board count analysis and scoring strategy
- [Cool Old Games - Cuban Dominoes](https://www.coololdgames.com/tile-games/dominoes/cuban/) — Cuban rules and blocking tactics
- [Three Guys From Miami - Cuban Dominoes](https://3guysfrommiami.com/domino.html) — Cultural context and terminology
- [Dominoes 365 - Advanced Strategies](https://www.dominoes365.io/blog/advanced-dominoes-strategies/) — 14 advanced strategic concepts
- [Caribbean Trading - Puerto Rican Dominoes](https://caribbeantrading.com/dominoes-rules-in-puerto-rico/) — Regional rules including Capicú and Chuchazo bonuses

### Cultural Context
- World Domino Federation rules
- Regional variations from Mexico, Cuba, Puerto Rico, and Panama inform the terminology and bonus scoring systems

---

## Implementation Status

### Completed Features

#### Phase 1: Core Game Engine ✅
- Tile set, dealing, and valid move detection
- Game state management with full rules enforcement
- Double-six first hand requirement
- Counter-clockwise play order (0 → 1 → 2 → 3)
- Domino, blocked, and closed game detection

#### Phase 2: Basic UI ✅
- Graphical tile rendering with pips
- Chain visualization with row wrapping
- Player hand display with playable tile highlighting
- Score tracking (hand and match)
- Game log with play history
- End selection modal for tiles playable on both ends

#### Phase 3: Smart AI + Advisor ✅
- **SmartAI**: Implements strategic principles (suit strength, partner support, blocking, pip management, double management, end control)
- **Tile counting**: Tracks played tiles and infers dead suits
- **Play choice inference**: Deduces holdings from what players choose to play
- **StrategicExplainer**: Generates rich explanations using traditional terminology

##### Strategic Terminology in Explanations
| Term | Usage in App |
|------|--------------|
| La Salida | Opening play signals strategy to partner |
| Ahorcado | Playing double without cover (risky) |
| Darle Pase | Forcing opponent to pass |
| Cuadrar | Squaring the board (both ends same) |
| La Puerta | Holding last tile of a suit (complete control) |
| Cover | Having follow-up plays after a double |
| Repeat | Playing to keep strong suit open |

#### Phase 3.5: Match Debrief & LLM Analysis ✅
- **MatchHistory**: Tracks all plays across entire match with state snapshots
- **Play Evaluation**: Compares human moves to AI recommendations
  - Optimal: Same tile and end as AI
  - Good: Same tile, different end OR close score
  - Questionable: Different tile, score difference 10-25 points
  - Mistake: Different tile, score difference > 25 points
- **DebriefUI**: Modal interface for post-match review
  - Overview tab: Stats, key moments, LLM analysis
  - Your Plays tab: All human moves with evaluations
  - Full Match tab: Play-by-play for each hand
- **Claude API Integration**: Play style analysis using Claude Haiku

#### v0.2: Quiz Mode & Hand Tracking ✅
- **HandTracker**: Probability tracking for all 28 tiles
  - Tracks known tile locations (played, in human's hand, unknown)
  - Maintains `possibleHolders` set for each unknown tile
  - Records passes to infer dead suits per player
  - Provides `getProbability(player, tile)` for likelihood estimates
  - Scores quiz predictions against actual hands
- **Quiz Mode**: Test ability to predict opponent hands mid-game
  - "Quiz Me" button opens prediction modal
  - Select target player (Opp 1, Partner, Opp 2)
  - Shows known facts (tile count, dead suits from passes)
  - Visual tile picker grid for predictions
  - Scoring: +10 correct, -5 wrong, -2 missed
- **QuizStorage**: Persists quiz history to localStorage
  - Tracks accuracy over time per player position
  - Calculates improvement trends
- **Predictions Tab**: New debrief tab showing quiz performance
  - Match quiz statistics
  - Historical accuracy by player
  - Deduction timeline (what you could have known)

#### v0.2: Player Color Coding ✅
- **4 distinct player colors**:
  - You (Player 0): Cyan `#00d4ff`
  - Opponent 1: Coral `#ff6b6b`
  - Partner (Player 2): Green `#22c55e`
  - Opponent 2: Orange `#f59e0b`
- **Tile Attribution Toggle**: Shows who played each tile on chain
  - Colored indicator dots with initials (Y, 1, P, 2)
  - Subtle glow effect on tiles
  - Color legend when enabled
- **Chain tracks player**: Each `PlacedTile` now stores `playedBy` index
- **Consistent colors**: Player names, game log, and tiles all use same colors

---

### Computer AI: How SmartAI Works

The three computer-controlled players (Opponent 1, Partner, Opponent 2) all use the same `SmartAI` class. There is no randomness or difficulty adjustment—all AI players use identical strategic logic.

#### AI Decision Process

1. **Get valid moves** from `Rules.getValidMoves()`
2. **If only one move**: Play it (no decision needed)
3. **Score each valid move** using 8 strategic factors
4. **Select highest-scoring move**
5. **Generate explanation** using `StrategicExplainer`

#### Move Scoring Factors

Each potential move is scored by summing these weighted factors:

| Factor | Weight | Logic |
|--------|--------|-------|
| **Suit Strength** | +10 per tile | Prefer playing from suits where you have multiple tiles |
| **Double Management** | +25 with cover, -15 without | Prioritize unloading doubles when you have follow-up plays |
| **Partner Support** | +15 to +25 | Play to partner's signaled suit (la salida) |
| **Blocking Potential** | +15 to +20 | Leave ends on suits opponents have passed on |
| **Pip Management** | +1.5 per pip (early), +0.5 (late) | Play high-pip tiles early to reduce risk |
| **End Control** | +5 per tile | Keep your strong suits on open ends |
| **Tile Counting Bonus** | +10 or -10 | Prefer leaving suits with many tiles still out |
| **Avoid Dead Suits** | -30 | Never leave a dead suit as the only option |

#### AI State Tracking

The AI maintains per-hand state that resets each hand:

```javascript
playerSalida[4]        // Opening play suit for each player
suitCounts[7]          // Tiles played per suit (0-6)
inferredDeadSuits[4]   // Sets of suits each player lacks
signaledSuits[4]       // Each player's strong suit signal
killedOwnSuit[4]       // Whether player abandoned their signal
```

#### Inference Logic

**From passes**: When a player passes, they lack tiles for both open end values:
```javascript
inferredDeadSuits[player].add(leftEnd);
inferredDeadSuits[player].add(rightEnd);
```

**From play choices**: If a player avoids their own signaled suit when they had a choice, they may be out:
```javascript
if (avoided === signaledSuit && playedOn !== signaledSuit) {
    killedOwnSuit[player] = true;
    inferredDeadSuits[player].add(signaledSuit);
}
```

#### AI Limitations (Current)

- **No look-ahead**: Evaluates only immediate move, not future consequences
- **No Monte Carlo simulation**: Doesn't simulate random hands to estimate outcomes
- **No Bayesian probability**: Uses binary "has/lacks" inference, not probability distributions
- **Uniform for all AI players**: Partner and opponents use identical logic
- **Fixed weights**: Strategic factor weights are hardcoded, not tunable
- **Strategy conflicts**: When multiple strategies suggest different moves (e.g., pip management vs. partner support), weighted scoring can produce suboptimal results

---

### Planned: Probability-Based AI Enhancement

This section documents the planned enhancement to integrate probability-based reasoning into SmartAI.

#### Problem Statement

Current strategies sometimes conflict. Example: Partner opens with 6|6, opponent plays 6|5. The partner's ally should attack the 5 (supporting partner's signal). But if pip management scores higher, the AI might play another 6 instead—"mata la mano" (killing the hand). We need a principled way to resolve such conflicts.

#### Design Philosophy

1. **Early hand**: Rely primarily on heuristic rules (current weighted scoring)
2. **As data accumulates**: Probability-based reasoning gradually takes precedence
3. **Key principle**: High-confidence tactical opportunities (e.g., blocking/cuadrar) should override general strategy when probability supports them

#### Strategy Priority Hierarchy

Instead of purely weighted scoring, moves are evaluated by priority level:

| Priority | Strategy | When It Applies |
|----------|----------|-----------------|
| 1 | **Winning move** | Can domino this turn |
| 2 | **High-confidence block** | Can cuadrar with P > 0.7 that opponent passes |
| 3 | **Partner support** | Partner signaled a suit (especially first 8 plays) |
| 4 | **Defensive** | Opponent close to winning (1-2 tiles) |
| 5 | **Double management** | Have exposed doubles without cover |
| 6 | **Suit/End control** | Maintain flexibility |
| 7 | **Pip management** | Tiebreaker only |

**Key rule**: Partner support in the first 8 plays of a hand should always trump pip management (except for winning moves).

#### Probability Model

For P(player X holds tile T):

**Hard constraints (P = 0):**
- Tile is in my hand
- Tile has been played
- Tile contains a value X passed on (dead suit)

**Soft inference:**
```
Remaining unknown tiles = 28 - played - myHand
Possible tiles for X = unknown tiles - tiles with X's dead suits
P(X holds T) = (X's tile count) / (possible tiles for X)
```

**Example calculation (mid-hand):**
- 10 tiles played, I have 5 → 13 unknown tiles among 3 players
- Opp 1 has 4 tiles, passed on 3s and 5s → eliminates ~8 tiles from possibilities
- Only ~5 tiles Opp 1 could possibly hold
- P(Opp 1 has any specific possible tile) ≈ 4/5 = 0.8

#### Blocking Probability (Cuadrar)

To evaluate "can I block player X with value V?":
```
P(X passes on V) = 1 - P(X has any tile containing V)
```

If a move makes both chain ends values where P(opponent passes) > 0.7, that's a high-confidence blocking opportunity worth pursuing even if other strategies suggest different plays.

#### Implementation Approach: Incremental Overrides

Rather than rewriting the scoring system entirely, we add **priority checks that can override** the weighted result:

```javascript
selectMove(moves) {
  // Priority overrides (checked first, in order)
  const winningMove = moves.find(m => this.isWinningMove(m));
  if (winningMove) return winningMove;

  const blockingMove = this.findHighConfidenceBlock(moves, probabilities);
  if (blockingMove) return blockingMove;

  const partnerSupport = this.findPartnerSupportMove(moves, turnNumber);
  if (partnerSupport && turnNumber <= 8) return partnerSupport;

  // Fall back to weighted scoring for everything else
  return this.selectByWeightedScore(moves);
}
```

**Benefits of this approach:**
- Lower risk than full rewrite
- Each override can be tested in isolation
- Gradual migration of logic into priority checks
- Weighted scoring remains as fallback/tiebreaker

#### Implementation Phases

**Phase 1**: Enhance HandTracker
- `getProbability(player, tile)` → 0.0 to 1.0
- `getPassProbability(player, value)` → chance they can't play on that value

**Phase 2**: Add "Partner Support" Override
- Detect when partner has signaled (la salida)
- In first 8 plays, prioritize supporting partner's suit
- Override pip management to prevent "mata la mano"

**Phase 3**: Add "High-Confidence Block" Override
- Use probability model to identify cuadrar opportunities
- Only trigger when confidence exceeds threshold (e.g., 0.7)

**Phase 4**: Add defensive and other priority checks

#### Future: AI Personalities

Once the priority system is stable, we could randomly assign "personalities" to each AI player at match start:

| Personality | Behavior Modification |
|-------------|----------------------|
| Aggressive | Lower blocking confidence threshold, more cuadrar attempts |
| Conservative | Higher confidence thresholds, prefer safe plays |
| Partner-focused | Stronger partner support priority |
| Opportunistic | More weight on pip management and double unloading |

This would make games more varied and realistic.

---

#### Future AI Improvements (Backlog)

1. **Bayesian probability integration**: Use HandTracker's probability model in move scoring (in progress)
2. **Configurable strategy weights**: Let users adjust AI aggressiveness, partner focus, etc.
3. **Difficulty levels**: Adjust inference depth or add controlled randomness
4. **AI personalities**: Randomly assign behavioral profiles to computer players

---

### Project Architecture

```
domino-advisor/
├── docs/                          # Deployed to GitHub Pages
│   ├── index.html                 # Main HTML with game layout
│   ├── css/
│   │   └── styles.css             # All styling (table, modals, debrief, quiz)
│   └── js/
│       ├── main.js                # UI controller, event handling, quiz modal
│       ├── models/
│       │   ├── Tile.js            # Tile representation
│       │   ├── Hand.js            # Player hand management
│       │   ├── Chain.js           # Board chain with placed tiles + playedBy
│       │   ├── GameState.js       # Complete game state
│       │   └── MatchHistory.js    # Match tracking for debrief + quiz results
│       ├── engine/
│       │   ├── TileSet.js         # Full set generation
│       │   ├── Dealer.js          # Dealing logic
│       │   ├── Rules.js           # Move validation, win detection
│       │   └── Game.js            # Game controller, event callbacks
│       ├── ai/
│       │   ├── RandomAI.js        # Simple random AI (unused)
│       │   ├── SmartAI.js         # Strategic AI with principles
│       │   ├── StrategicExplainer.js  # Terminology-based explanations
│       │   └── HandTracker.js     # Tile probability tracking for quiz mode
│       ├── services/
│       │   ├── ClaudeService.js   # Claude API integration
│       │   └── QuizStorage.js     # localStorage for quiz history
│       └── ui/
│           ├── SettingsUI.js      # Settings modal
│           └── DebriefUI.js       # Match debrief modal + predictions tab
├── BACKLOG.md                     # Feature backlog and roadmap
└── domino_advisor_project.md      # This document
```

---

### Deployment

#### GitHub Pages (Frontend)
- **Repository**: https://github.com/MarAlons0/domino-advisor
- **Live URL**: https://maralons0.github.io/domino-advisor/
- **Branch**: `main`
- **Folder**: `/docs`

#### Cloudflare Worker (API Proxy)
- **Worker URL**: https://domino-api.mario-alonso-account.workers.dev
- **Purpose**: Securely proxy Claude API requests without exposing API key

##### Security Protections
| Protection | Implementation |
|------------|----------------|
| API Key Security | Stored as Cloudflare secret, never exposed to client |
| Domain Restriction | Only accepts requests from `maralons0.github.io` and `localhost:8000` |
| Rate Limiting | 10 requests per hour per IP address |
| Daily Cap | 100 requests per day across all users |
| Spending Limits | Set in Anthropic dashboard as additional safeguard |

##### Worker Files (separate repo)
```
domino-api/
├── src/
│   └── index.js          # Worker code with rate limiting
├── wrangler.toml         # Cloudflare configuration
└── package.json
```

---

### Configuration

#### AI Settings
- **AI Delay**: 3000ms (3 seconds per move) for easier tracking
- **AI Reasoning**: Displayed in game log for each computer move

#### Rate Limits (Cloudflare Worker)
```javascript
const RATE_LIMIT_REQUESTS = 10;    // Per IP per hour
const RATE_LIMIT_WINDOW = 3600;    // 1 hour
const MAX_REQUESTS_PER_DAY = 100;  // Daily cap
```

---

### Key Design Decisions

1. **No user authentication required**: Game is fully playable without login
2. **LLM analysis is optional**: Debrief works without it; Claude analysis enhances it
3. **Secure by default**: Production uses Cloudflare Worker; users never see API keys
4. **Mobile-friendly**: Responsive design works on phones and tablets
5. **Strategic focus**: AI explains moves using traditional domino terminology

---

## Notes for Development

- The strategic principles section is the knowledge base—the AI and advisor should reference these explicitly
- Explanations should use both English terms and traditional Spanish terminology (e.g., "squaring the board (cuadrar)", "the opening play (la salida)", "a blocked game (tranque)")
- The tiered organization (Fundamentals → Partnership → Tactical → Advanced) can inform training mode lesson progression
- Testing should include edge cases: blocked games, close score situations, hands with many doubles, ahorcado scenarios
- Consider adding a "why did I lose?" analysis for blocked games
- Bonus scoring (Capicú, Chuchazo) could be a configurable option for regional rule variants
- The glossary terms should appear in tooltips/help throughout the UI to teach vocabulary
