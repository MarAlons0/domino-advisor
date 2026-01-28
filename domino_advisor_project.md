# Domino Advisor - Project Definition

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

---

### Project Architecture

```
domino-advisor/
├── docs/                          # Deployed to GitHub Pages
│   ├── index.html                 # Main HTML with game layout
│   ├── css/
│   │   └── styles.css             # All styling (table, modals, debrief)
│   └── js/
│       ├── main.js                # UI controller, event handling
│       ├── models/
│       │   ├── Tile.js            # Tile representation
│       │   ├── Hand.js            # Player hand management
│       │   ├── Chain.js           # Board chain with placed tiles
│       │   ├── GameState.js       # Complete game state
│       │   └── MatchHistory.js    # Match tracking for debrief
│       ├── engine/
│       │   ├── TileSet.js         # Full set generation
│       │   ├── Dealer.js          # Dealing logic
│       │   ├── Rules.js           # Move validation, win detection
│       │   └── Game.js            # Game controller, event callbacks
│       ├── ai/
│       │   ├── RandomAI.js        # Simple random AI (unused)
│       │   ├── SmartAI.js         # Strategic AI with principles
│       │   └── StrategicExplainer.js  # Terminology-based explanations
│       ├── services/
│       │   └── ClaudeService.js   # Claude API integration
│       └── ui/
│           ├── SettingsUI.js      # Settings modal
│           └── DebriefUI.js       # Match debrief modal
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
