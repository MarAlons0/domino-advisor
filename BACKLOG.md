# Domino Advisor - Feature Backlog

## Pending Features

### 0. AI Decision Transparency (Developer Tool)
**Priority:** Medium
**Complexity:** Low

Add developer-only debugging interface to inspect AI decision-making process in real-time.

**Requirements:**
- View scoring breakdown for each valid move the AI is considering
- Show weight contributions from each strategic factor:
  - Suit strength, double management, partner support
  - Blocking potential, pip management, end control
  - Tile counting bonus, dead suit penalties
- Display probability calculations from HandTracker:
  - P(player holds tile) for each opponent/partner
  - P(player lacks suit) based on passes
  - P(blocking success) for cuadrar attempts
- Toggle via URL parameter or keyboard shortcut (e.g., `?debug=true` or Ctrl+D)
- Console logging or dedicated debug panel overlay
- Does NOT appear in production/normal play
- Helps validate AI logic and tune weights

**Potential UI:**
- Floating panel that appears on AI turns
- Expandable table showing all valid moves with scores
- Highlight chosen move and runner-up
- Show probability matrix for tile locations

---

### 0. AI Enhancements (Future)
**Priority:** Medium
**Complexity:** Medium

Further enhancements to AI decision-making beyond initial implementation.

**Potential additions:**
- Defensive priority (when opponent has 1-2 tiles)
- Look-ahead simulation (Monte Carlo)
- Configurable blocking threshold (currently 0.7)
- AI personalities (aggressive, conservative, etc.)

---

### 1. Configurable AI Strategy Weights
**Priority:** Medium
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

### 2. Training Mode
**Priority:** High
**Complexity:** High

Structured lessons teaching strategic concepts through guided play.

**Requirements:**
- Concept + Practice format: introduce principle, then walk through a hand
- Topics: opening strategy, supporting partner, double management, blocking, endgame
- Guided play with hints
- "Why this play?" explanations on demand
- Progress tracking through lessons

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

### 6. Real-time vs Review Feedback Mode
**Priority:** Low
**Complexity:** Medium

Toggle between immediate feedback and end-of-hand review.

**Requirements:**
- Real-time mode: Show optimal play after each move
- Review mode: Play without interruption, analyze at hand end
- Toggle in settings

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
- Tooltips on hover/tap for terms (la salida, tranque, cuadrar, etc.)
- Help section with full glossary
- Use terms consistently in explanations

---

## Completed Features

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
