# Domino Advisor - Feature Backlog

## Pending Features

### 0. Mobile Viewport Fix
**Priority:** High
**Complexity:** Low

Fix viewable area on mobile devices where some tiles get hidden/cut off. Ensure all tiles in hand and on chain are visible and scrollable.

**Issues to address:**
- Hand area may overflow on small screens
- Chain area scrolling may not work properly
- Controls may be hard to tap

---

### 1. Bayesian Probability for AI Decision Making
**Priority:** High
**Complexity:** Medium

Enhance computer player decision-making by incorporating the statistical probability tracking (HandTracker) into SmartAI move selection.

**Current state:** HandTracker tracks tile probabilities based on passes and plays, but SmartAI uses simpler heuristics (inferredDeadSuits, signaledSuits).

**Proposed changes:**
- Use Bayesian inference to estimate opponent hand compositions
- Factor probability distributions into move scoring
- Weight blocking decisions by likelihood of success
- Consider partner's likely holdings when choosing plays

---

### 2. Configurable AI Strategy Weights
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

### 4. Training Mode (Phase 4 from Project Doc)
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

### 5. Position Analyzer
**Priority:** Medium
**Complexity:** Medium

Analyze arbitrary game positions without playing a full game.

**Requirements:**
- Manual entry of: your hand, tiles played, passes observed
- OR step-by-step recording from hand start
- Detailed recommendations with principle-based explanations
- Show probability distributions for opponent hands

---

### 6. Game Save/Replay
**Priority:** Low
**Complexity:** Medium

Save and replay completed games for study.

**Requirements:**
- Save game history to localStorage
- Load and replay with move-by-move navigation
- Commentary on optimal vs. actual plays
- Highlight decision points

---

### 7. Pass Indicators on UI
**Priority:** Medium
**Complexity:** Low

Show visual indicators when players have passed on specific suits.

**Requirements:**
- Display near each player's position
- Show which numbers they've passed on
- Update in real-time as passes occur
- Help track opponent weaknesses visually

---

### 8. Real-time vs Review Feedback Mode
**Priority:** Low
**Complexity:** Medium

Toggle between immediate feedback and end-of-hand review.

**Requirements:**
- Real-time mode: Show optimal play after each move
- Review mode: Play without interruption, analyze at hand end
- Toggle in settings

---

### 9. "Why Did I Lose?" Analysis
**Priority:** Low
**Complexity:** Medium

Explain blocked game outcomes.

**Requirements:**
- Analyze blocked games to explain why one team won
- Identify key decision points that led to the block
- Show pip counts and what could have been different

---

### 10. Bonus Scoring (Regional Variants)
**Priority:** Low
**Complexity:** Low

Support optional regional scoring bonuses.

**Requirements:**
- Capicú: Win with non-double playable on either end (+100)
- Chuchazo: Win by playing double-blank as last tile (+100)
- Configurable on/off in settings

---

### 11. Glossary Tooltips
**Priority:** Low
**Complexity:** Low

Teach traditional terminology through the UI.

**Requirements:**
- Tooltips on hover/tap for terms (la salida, tranque, cuadrar, etc.)
- Help section with full glossary
- Use terms consistently in explanations

---

### 12. Spanish Language Support
**Priority:** Low
**Complexity:** Medium

Add Spanish language option.

**Requirements:**
- Translate all UI text
- Keep traditional terminology unchanged
- Language toggle in settings

---

## Completed Features

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
