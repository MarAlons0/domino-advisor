# Changelog

All notable changes to 7 Fichas are documented in this file.
Format: [Keep a Changelog](https://keepachangelog.com/en/1.0.0/). Versioning: [SemVer](https://semver.org/) — see [VERSIONING.md](VERSIONING.md).

## [1.14.0] – 2026-10-28

### Changed
- **Master now plays the match, not just the hand (BACKLOG 0g.3b).** Master's search used to judge every simulated hand the same way at any score: win the hand, plus a little extra for points. It now judges each hand by the team's chance of winning the match from the score that hand leaves. Ahead 90–40, any win ends the match, so Master goes for the safest win. Behind 20–85, small wins barely help, so it takes risks for a big haul. And all match long it values points more, since points are what reach 100. In a 2,000-match A/B against the previous reward, it won **56.0% ± 2.2%** of matches (CI 53.8–58.2; 57.6% / 54.4% by seat assignment). This covers the AI partner and opponents at Master, and the AI seats at multiplayer tables.
- **Genín is unchanged.** His advice, the "Why?" percentages and the play grades still use the hand-level reward, so his numbers still mean how often the hand was won and the 5 / 15-point grade bands keep their calibration.

### Changed (internal)
- New `ai/MatchEquity.js`: the chance of winning the race to 100 from any score, computed at load from the points-per-hand distribution of 600 Master self-play matches (4,535 hands, mean 21 points, no ties). `ISMCTSGameState` reads the match score from the game state and has a new reward mode, `'match'`, which is now the SmartAI default. Genín's searches run with `'margin'` (`COACH_REWARD_SHAPING`).
- Isolation A/B: the same equity curve, but scoring every hand as if played at 0–0 (`reward-match-blind`), won only **47.3% ± 2.2%** (CI 45.1–49.5) against the score-aware default. Reading the match score is worth about 2–3 points of match win rate on its own; the rest of the gain comes from valuing points more throughout the match.
- Harness: new `--hand-points` report; new variants `reward-match` and `reward-match-blind`; `reward-margin` now reproduces the v1.3.0 reward.

## [1.13.0] – 2026-10-25

### Added
- **Help has a "How do I…?" index.** Help now opens with 25 plain questions in 7 groups — Getting started, Playing a hand, Scoring, Genín's coaching, After the match, Playing with friends, Playing better. Each one jumps to its answer and highlights it for a moment; every section has an "↑ Index" link back. In English and Spanish.
- **"?" where you need it.** A small "?" opens Help at the right section from the room window (Play with Friends), Settings, the match debrief, and the hand-end card (Genín's advice). Help opens on top, and the window you came from stays open behind it.
- **New Help sections** for what it didn't cover: who leads each hand, the puntas, the cerrado and how it scores, table moments (capicú, cerrado, slam, zapato, comeback), asking Genín, the hand-end card and Why?, how plays are graded (including the win-rate bands and what isn't graded), Quiz Me, each debrief tab, and the language switch.

### Fixed
- **Help said a blocked game's winners score "the difference".** They score the other team's remaining pips (and a cerrado tie goes to the team that closed) — now explained under Scoring as the cerrado, which is how a game is blocked here.
- **Help listed the wrong colors for "Show who played"** (cyan / purple); they are white (you), blue (partner), red (Opp 1) and yellow (Opp 2).
- Help no longer says the Play Style Analysis needs your own Claude API key — it works through 7 Fichas' own server.

### Removed
- **The "Claude API Key" section in Settings.** It asked players for their own key, but the Play Style Analysis has gone through 7 Fichas' own server for a while and never used it — so Settings now has just Player Difficulty. A key saved there by an earlier version is deleted from your browser the next time the app opens. The debrief's "configure your key" note (which could no longer appear) is gone too, and the README no longer says a personal key is required.

### Changed (internal)
- New `ui/HelpUI.js` (index, jump + highlight, `data-help="<section>"` context buttons); Help moved out of `main.js`. `ClaudeService` keeps only the analysis call; `SettingsUI` only the difficulty buttons. Icon-only buttons with a translated tooltip now get the same translated screen-reader label.

## [1.12.0] – 2026-10-24

### Added
- **Rematch, everyone together (play with friends, part 3).** After a match each player taps **Rematch** — on the match-end card or at the bottom of the debrief — and the new match deals, same seats, once everyone at the table has. Until then the button shows who you're waiting for, so nobody is pulled out of their debrief. The host can also **Start now** from the room (for a friend who stepped away), and **Room** (top) still lets you change seats or AI levels first; a seat left empty is filled by the AI.
- **Quick reactions.** Tap 😀 for 6 emojis (👍 👏 😂 😮 😬 🔥) and 6 table phrases — ¡Buena! / Nice!, ¡Qué suerte! / Lucky!, ¡Dale, juega! / Your move!, ¡Bien jugado, pareja! / Well played, partner!, ¡Ay! / Ouch!, ¡Te lo dije! / Told you!. A reaction pops up by your seat on everyone's screen (phrases in each player's own language) and is noted in the game log. Fixed choices only — no free text; one every 1.5 s.
- **Turn timer (optional).** The host can set 30 s or 60 s per turn in the room (off by default). A countdown shows on the seat whose turn it is — yellow in the last 10 s — and when it runs out the seat flashes **¡Tiempo!** (your hand glows if it's you). It's a nudge only: nobody plays for you. Each screen counts from when the turn appears there, after the AI's paced moves.
- Help → Play with Friends explains reactions, the timer and the new rematch.

### Changed (internal)
- Room messages: `rematch`, `setTimer {seconds}`, `react {id}` → `reaction {seat, id}`; the room status (`lobby`) now carries `rematch` and `turnTimer` and is re-sent at each hand and match end (the room window now shows "Match over" after a match). Rooms saved by earlier versions load with the timer off.
- Every new match fills open seats with the AI (it used to happen only on the host's Start).
- New `multiplayer/reactions.js` (must match the room's list — tested). Server tests: rematch, reactions, timer.

## [1.11.0] – 2026-10-23

### Added
- **Genín in multiplayer (play with friends, part 2).** Everything Genín does in single player now works at a multiplayer table, for each person separately:
  - **Advice:** tap Genín on your turn for his pick and the reason, at Master strength.
  - **Hand-end card:** after each hand, the outcome, a verdict and your key moment — "why" and the simulated win rates included.
  - **Debrief:** **Review Game** at the end of the match opens the full debrief (summary, lessons, key moments, every play, your grades); its button takes you back to the room for a rematch.
  - Your plays are graded and count toward your lifetime Genín agreement, as in single player.
- **Genín runs in your own browser** and uses only what you can see: your hand, the plays, and how many tiles each player holds — the free room server does no extra work. Tested against a Genín that sees the whole table: identical advice, grades, win rates and reasons in 825 of 825 decisions.
- **Help → "Play with Friends"** (en + es): how to create a room and invite friends, choose seats (partners or opponents) and AI levels, what changes at the table (the room passes for you; Genín coaches each player), getting your seat back after a lost connection, and rematch / leave.
- **Your coaching survives a reload.** Phones often drop a background tab and reload it when you come back; the room restores the table, and your browser now keeps Genín's analysis of your earlier plays, so the hand-end card and the debrief still cover the whole match. (Kept for the current room only; a rematch starts clean.)

### Fixed
- **The winning (or closing) tile of each hand reached other players after "hand over".** The room announced the end of the hand before the move that ended it, so capicú / cerrado effects were worked out before that tile was on the board. The room now sends the move first. (Server fix; applies to everyone on v1.10.x too.)

### Changed (internal)
- Prediction quizzes stay single player: grading a prediction needs the other players' hands at that moment.
- "What closing would have scored" needs everyone's pips; in multiplayer it is settled from the revealed hands when the hand ends (`settleCloseOutcomes`, same rule as before).
- A hidden hand keeps its size when Genín's search copies the table (otherwise the search would think that player had dominoed and skip the simulation).
- New `multiplayer/MatchHistoryStore.js`; the room's `sync` now includes the match number. New tests in `server/test/genin.test.mjs` (included in `npm test`).

## [1.10.1] – 2026-10-23

### Fixed
- **The first visit after an update could run a mix of old and new code.** Only `main.js` and `styles.css` carry a `?v=` cache-buster; the other ~40 modules were served from the previous version's service-worker cache until the new worker took over, so the page could load the new `main.js` with old modules. Seen in Safari on v1.10.0 as raw labels in the multiplayer window (`mp.title`, `mp.name`, …) and a `v1.5.0` version chip; a mismatch like this could also break a release outright. Now, when a new version's service worker takes over a page the previous one served, the page reloads itself once (only within 30 s of loading — never mid-game, and not on a first-ever visit). Reproduced and verified in headless Chrome: v1.5.0 cached → new release → one automatic reload → all v1.10.x.
- The service worker now bypasses the browser's HTTP cache (GitHub Pages sends `max-age=600`) when pre-caching and when caching new files, so a new version can't store leftovers from the previous one.

## [1.10.0] – 2026-10-23

### Added
- **Play with friends (networked multiplayer, part 1).** 2–4 people, each on their own phone or computer, at one table — partners, opponents, or a full table of four — with the AI filling any empty seat at Beginner, Experienced or Master.
  - **Create or join a room** from the new 👥 button: a 6-character room code and an invite link (`…/domino-advisor/?room=K7Q2XM`). Opening the link asks for your name once, then seats you.
  - **Lobby:** the four seats drawn like the table from your point of view (your team cyan, opponents red); anyone can move to a free seat; the host (room creator) sets AI levels and starts the match, and can rematch with the same seats.
  - **At the table you are always at the bottom**; other people show by name, AI seats show their level. AI moves are paced so everyone can follow; your own move appears as soon as the room confirms it.
  - **Your hand stays secret:** the room server holds every hand and sends each player only their own — other hands are revealed at the end of each hand, as in single player.
  - **Dropped connection or reload:** you rejoin the same seat with the same hand. If someone stays away for 60 s the host can give their seat to the AI; it comes back to them when they reconnect.
  - Multiplayer matches count in your lifetime stats and badges, from your seat. Genín's advice, the hand-end card and the debrief are not in multiplayer yet (next part).
  - Runs entirely on Cloudflare's free plan (one Durable Object per room); design and measurements in [docs/MULTIPLAYER.md](docs/MULTIPLAYER.md).

### Changed (internal)
- New `server/` (Cloudflare Worker `domino-rooms`): `RoomEngine` (pure room logic — rules, lobby, AI seats, per-player views, save/replay of the deal + plays record), `GameRoom` Durable Object (WebSocket Hibernation API, storage, alarms), Worker routes; Node tests (`server/test/`: room engine incl. a 25-match soak with reloads and a hidden-tile leak check, the browser adapter mirroring the server, an end-to-end WebSocket match).
- Client: `multiplayer/RemoteGame.js` (stand-in for `Game` — seat rotation, hidden hands, AI pacing), `multiplayer/MultiplayerSession.js`, `ui/LobbyUI.js`; `main.js` enters multiplayer mode only when the page URL has `?room=`.
- The engine runs outside a browser: `Game.newMatch(tiles)` / `newHand(tiles)` accept a fixed deal; `i18n` and the `?debug=ai` flags no longer assume `localStorage` / `window` / `document`. `GameState.nameOverrides` shows player names. Single player is unchanged.

## [1.9.0] – 2026-10-23

### Changed
- **At Master, plays are graded by Genín's simulation, not the static score.** Genín's pick at Master comes from ISMCTS, but grades used the static score gap, and the two disagreed often (in testing they agreed on only 43% of deviations; the biggest static "mistake" had a 0-point win-rate difference). Now a play that isn't Genín's exact pick is graded by how much simulated win rate it gave up — **good ≤ 5 points, questionable ≤ 15, mistake > 15** — computed from the same rounded numbers the explanation shows ("~60% vs ~55%"), so a grade never contradicts them. When the search barely explored your move (< 30 visits) or there is no simulation (priority shortcuts like a forced domino or cerrar, and all other levels), the static score is used as before. This flows into the hand-end card, the debrief (stat strip, patterns, key moments), lifetime Genín agreement, and the Claude analysis.
- **The grading search is twice as large (2,000 iterations)** for steadier grades — about +15 ms per play. Measured over 40 Master matches: a grade now jumps between "good" and "mistake" on re-analysis ~2% of the time (vs 6–7% for static grades).
- **Genín's advice is the reference when you asked for it.** He computes advice once per turn: reopening his bubble shows the same tile, following his advice is always graded optimal, and if you play something else the explanation compares against the tile he showed you (a fresh search could prefer a near-tied different tile about a third of the time).
- The hand-end card now picks its key moment by the same impact ranking as the debrief (simulated cost first).

### Added
- When no single strategic factor explains why Genín's tile is better, the explanation still shows the simulation's numbers ("… was stronger. Simulating many possible opponent hands, the AI won ~52% with [2|1] vs ~46% with [3|2]") instead of a bare statement.

### Changed (internal)
- `MatchHistory`: `WR_GOOD_PTS`, `WR_QUESTIONABLE_PTS`, `WR_MIN_VISITS`, `winRateDropPts()`; `_evaluatePlay` grades by simulation first. `SmartAI.analyzeHumanTurn(…, adviceMove)` with a `GRADING_ITERATIONS = 2000` search, plus `recVisits` / `playedVisits`; `getRecommendation()` also returns the chosen `move`. `MatchLessons.impactOf` / `byImpact` shared with `HandFeedback`.
- Backlog: merged the duplicate Medium "Multi-human play" into the High "Multiplayer game" item (networked play chosen).

## [1.8.0] – 2026-10-23

### Added
- **Visual effects for key moments (UX-A).** Short, subtle table effects (about 1.5 s) for any player, in team color — cyan for your team, red for the opponents:
  - **Capicú** — when the winning tile joins two *different* puntas (so it could go on either end), it slams in gold, both puntas pulse gold, and a **"¡Capicú!"** banner pops over the table. Equal puntas never make a capicú. In testing, about 1 hand in 12.
  - **Cerrado** — the closing tile slams and both locked puntas pulse in the closing team's color, with a **"Closed on 4s!" / "¡Cerrado a 4s!"** banner; the end-of-hand modal now waits 1.5 s so you see the locked board first.
  - **Domino** — the existing slam (also on any [6|6]) now glows in the player's team color.
  - **Zapato** and **comeback** on the match-end screen when your team wins: a gold **"¡Zapato! 118–0"** (opponents at 0) or a green **"¡Remontada! Ibas perdiendo por 88"** (won after trailing by 50+).
  - Respects the system "reduce motion" setting: no scaling or pulsing, just color and a fade.

### Changed (internal)
- `docs/js/coach/MatchMoments.js` — pure detection: `isCapicu`, `maxDeficit`, `matchHighlights` (`COMEBACK_MIN_DEFICIT = 50`).
- `main.js`: `_prepareHandEndEffect` sets the effect inside `onHandEnd` (before the engine's re-render); the two puntas are marked during `renderChain`; one `_handEndDelay(reason)` is shared by the hand-end and match-end timers (they must stay equal so the final hand's stats land before the match's).
- Backlog: UX-E (tile slam) was already built; marked shipped with the team colors added here.

## [1.7.0] – 2026-10-22

### Added
- **Match debrief, part 2 (UX-0 complete).**
  - **Full Match is one scrollable timeline** of every hand, replacing the one-hand-at-a-time dropdown. Each hand opens with a sticky divider showing that hand's hand-end verdict ("Hand 3 · Won +26 · Won, but watch one play") and a collapsible **Why?** with its key moment, then one compact line per play (who · tile · end, or *salida* / *passed* · your grade or the AI's reason — tap a line for the full reason), then the result. Your weak plays get a second line with Genín's pick and why it's better.
  - **Hand by hand** on the Overview: one row per hand with its result and verdict (including the match-ending hand, which never got a hand-end card during play); tapping a row opens that hand in the timeline.
- **Your Plays reads naturally:** "You played [6|1] on the right" / "You opened with [6|6]" / "You passed", with Genín's view underneath — "Genín agrees — Double with cover", or "Genín: [4|4] on the left — it backs your partner's suit" (the reason his tile beats yours, as in the key moments).

### Fixed
- **Spanish:**
  - The hand-end card now says **"Saliste con…"** when the moment was your salida, and "En tu jugada N tiraste…" otherwise.
  - The debrief no longer mixes in English: ends are *a la izquierda / a la derecha*, and the AI's reasons that were hard-coded English ("Only valid move", "High-confidence block…", "Supporting partner's 3s (la salida)", cerrar and darle pase reasons…) are now translated in both languages.
- The hand-end card's reason follows the current language, even if you switched languages during the hand.

### Changed (internal)
- `docs/js/ui/feedbackText.js` — shared `feedbackTexts(fb)` used by the hand-end card and the debrief; HandFeedback moment args may be nested i18n references (`{ i18n, args }`) resolved at render time.
- SmartAI's priority-shortcut reasons use new `reason.*` i18n keys. Removed the hand-selector UI and seven debrief strings nothing uses anymore.

## [1.6.0] – 2026-10-22

### Added
- **Match debrief, part 1 (UX-0): the Overview now teaches lessons instead of listing moves.**
  - **Match header** — the result and score ("Match lost 48–118 · 6 hands"), and accuracy over your *real decisions* only.
  - **Lessons from this match** — up to two recurring patterns, lesson first: the strategic dimension you gave up on at least two costly plays (e.g. *"Back your partner's suit — your partner's salida names their strong suit; keep it open so they keep playing. You missed this in 3 of your 4 costly plays (hands 1, 3, 6)."*). Ten bilingual lessons, one per scoring factor; a clean or one-off match says so instead.
  - **Top 3 key moments by impact**, not every weak play. Each leads with its lesson, says where it happened ("Hand 2 · your play 4", matching the hand-end card), shows a **mini board** — the open ends (or the empty board for a salida), your partner's, your own and the opponents' signaled suits, and the hand you held with your tile ringed red and Genín's ringed green — then explains why the other tile was stronger, with the simulated win rates at Master. At Master, moments are ranked by the simulated win-rate drop, which often disagrees with the static score gap; plays the simulation found about equally good are ranked last. In Spanish, a salida reads "Saliste con…" and any later play "Tiraste…".
- Your Plays numbers plays as "Hand N · your play M" and dims forced moves with a **Forced** badge (also in Full Match).

### Changed
- **Forced moves no longer count toward accuracy.** A play with only one legal move isn't a decision; it used to count as "optimal" and inflated the headline (in testing about a third of all tile plays were forced). This applies to the debrief, the lifetime **Genín agreement** stat and *Genín Student* badge (from now on — past totals can't be corrected), and the Claude play-style analysis.
- The four grade counters are now a compact one-row strip under the accuracy line.
- Spanish: the open ends are now *puntas* throughout (the mini board and Genín's *firme*, *darle pase* and opponent-suit explanations), as players say it.

### Fixed
- On phones, the debrief tab bar could collapse to a sliver when the content was long; the header, tabs and footer now keep their height.

### Added (internal)
- `docs/js/coach/MatchLessons.js` — `buildMatchLessons(matchHistory)` pure builder (result, decisions, patterns, ranked moments).
- `SmartAI.analyzeHumanTurn` also records `forced`, `legalMoves`, `recFactor` (the contrast factor key — language-independent, so the debrief resolves it in the current UI language), `handBefore`, and `signals` (own / partner / opponents' suits).
- `StrategicExplainer.contrastFactor()` (the key behind `explainContrast`); `MatchHistory.isForced()`; `getHumanStats()` reports `forced` separately.
- Tile rendering helpers moved from `main.js` to `docs/js/ui/dominoRender.js`, shared with the debrief.

## [1.5.1] – 2026-10-21

### Fixed
- **The match-ending hand is now counted in lifetime stats.** The engine skipped the hand-end event for the hand that ends a match, so that hand never reached Player Stats: hand counts, by-reason breakdowns, cerrado stats, and hand badges (*Cerrado!*, *Power Cerrado*, *Cerrado Master*, *Domino Master*) all missed it. A 40-match headless run showed 40 of 262 hands missing, including 26 of 127 cerrados — the match-winning cerrado is exactly the hand most likely to earn a cerrado badge. Now every hand is recorded; the match-ending one still goes straight to the match-end screen. Past matches can't be backfilled (only lifetime totals are stored).
- **Cerrado stats now say what they count.** "Team Cerrados" was counting every cerrado hand, including the opponents' closes (which were also listed under "Opp Cerrados"). It is relabeled **Cerrado Hands**, and the section adds **Team Closes** (closes by you or your partner) and **Close Win %** (how often your team's closes won). "You Closed" / "Partner Closed" are relabeled **… & Won** to match what they count, and "Opp Cerrados" becomes **Opp Closes**. The two new counters start from zero.
- Stats storage can no longer stop the app from loading: unreadable or corrupt saved stats fall back to defaults instead of throwing during startup.

### Changed (internal)
- `Game` now fires `onHandEnd` for every hand, flagging the last one `isMatchEnding: true` before `onMatchEnd`. The tournament harness inherits this, so its per-hand outputs (hand results, cerrado samples, close classification) now include match-ending hands that were previously dropped — results from earlier harness runs undercounted those hands.

## [1.5.0] – 2026-10-17

### Added
- **Score-gap mano feedback now explains *why* and *how*.** When a hand's key moment is a weaker-than-recommended play, the "Why?" detail no longer just names the better tile — it gives the strategic principle and the probability behind the AI's pick. Example: *"On your play 5 you played [6|3]; [6|5] was stronger — it backs your partner's suit. Simulating many possible opponent hands, the AI won ~58% with [6|5] vs ~41% with [6|3]."* The win-rate comparison appears at Master (from ISMCTS root stats); static difficulties show the principle alone. This replaces the old opaque "(N points more per the AI)" number, which was misleading — at Master that delta came from the static scorer, not from what actually chose the move.

  The principle comes from a **factor contrast**: the single scoring dimension on which the recommended tile most out-scores the one played (partner support, firme, darle pase, pip unloading, pace…) — an inherently positive differentiator, so the reason reads as a clean "why it was better" rather than a mixed pros-and-cons breakdown.

### Added (internal)
- `StrategicExplainer.explainContrast(recFactors, playedFactors)` — returns a short bilingual phrase naming the recommended move's strongest single advantage over the played move, or `null` when no dimension stands out. Backed by new `explain.contrast.*` i18n keys (10 factors × en/es).
- `SmartAI.analyzeHumanTurn` now captures `recReason` (via `explainContrast`), `recWinRate`, and `playedWinRate` (per-move ISMCTS win estimates) when the played move differs from the recommendation.
- `HandFeedback.scoreGapMoment` emits `coach.moment.scoreGapWhy` / `scoreGapPrinciple` / `scoreGap` by data availability.

### Fixed
- Score-gap verdicts routed correctly. The enriched `scoreGapWhy` / `scoreGapPrinciple` moments had fallen through to the "Well played" default; a weaker-than-recommended play now shows "One costly play" (lost) or "Won, but watch one play" (won).

## [1.4.1] – 2026-10-17

### Fixed
- **Spanish mano-feedback copy: "saliste" → "tiraste".** The score-gap feedback line read "En tu jugada N saliste con [ficha]" — but *salir* applies only to *la salida* (the hand's opening play); a mid-hand play is *tirar*. Now reads "En tu jugada N tiraste [ficha]".

### Changed (internal)
- Service worker `fetch` is now **network-first for navigations** (the HTML shell), cache-first for other assets — so returning users get the latest app shell on the first load instead of after a reload. `CACHE_NAME` bumped to `7fichas-v1.4.1` (it had been stale at v1.0.1 through v1.4.0, which is why the v1.4.0 shell initially did not reach installed clients). Both shipped in the v1.4.1 deploy window.

## [1.4.0] – 2026-10-16

### Added
- **Mano-level feedback — per-hand coaching at the hand-end modal.** After every hand, the result modal now shows a compact Genín coaching card: an outcome-plus-verdict line (e.g. "Won +24 · Sharp close", "Lost −8 · Missed close") with an expandable "Why?" detail. It is local and rule-based (no Claude API) — immediate, free, and complementary to the longitudinal Claude match analysis. Always on, independent of difficulty.

  The design separates **outcome** (did the team win/lose, by how much) from **process** (how good the human's decisions were given the information available), because the human is 1 of 4 players — a loss is not necessarily bad play, nor a win good. Moment selection prioritizes the **cerrar decision** (taken or declined) over the biggest score-gap play over a positive highlight.

  The cerrar feedback is **process-first**: it contrasts what the player could *infer* at the moment — the pip edge readable from observed passes/fallas, via `_estimateTeamPips` on the human's own `PlayerView` — against the ground-truth outcome. So it teaches reading the signals under uncertainty rather than hindsight-nagging: good process with a bad outcome is praised ("the decision was sound; the tiles didn't cooperate"), and a lucky win against an unclear read is gently flagged.

### Added (internal)
- `SmartAI.analyzeHumanTurn(gameState, playerIndex, playedMove)` — per-turn coaching instrumentation: the played move's static score (so different-tile plays grade by true score gap, not the old shared-value heuristic), cerrar availability/decision, and both the ground-truth cerrar counterfactual and the information-set pip edge + readable tells (opponent fallas, tiles remaining).
- `docs/js/coach/HandFeedback.js` — `buildHandFeedback(hand, data, humanSeat)` pure generator returning `{outcome, verdict, moment}` with i18n keys + positional args.
- Play records now carry `turnAnalysis`; `MatchHistory._evaluatePlay` consumes the played-move score; `Game.playTurn` forwards the analysis. New `coach.*` i18n keys (en + es).

## [1.3.0] – 2026-07-23

### Changed
- **Master is now pure ISMCTS with margin-aware reward (BACKLOG 0g.3 + 0g.4).** Through v1.2.x, the hand-coded priorities P2 (cerrar at pip advantage > threshold), P3 (high-confidence block), and P4 (early-game partner support) preempted the ISMCTS fallback. Those priorities were designed to compensate for a weaker fallback than the project now has — and measurably underperform the search. As of v1.3.0, at Master only P1 (an immediate winning move) short-circuits; every other decision, including closes, goes to ISMCTS, and terminal values blend the winner's actual point haul into the reward: `0.8·win + 0.2·(0.5 + 0.5·points/60)`, where points = losing team's remaining pips per `Rules.calculateHandResult`. Win/loss stays dominant (margin shifts a terminal value ≤ ±0.1) so the search prefers bigger hauls among near-equal win-probability lines without trading wins for points.

  The experiment sequence that got here (500-match A/Bs vs. the v1.2.x hybrid champion):
  - `reward-margin` alone (priorities intact): **exact 250/250 wash** — closes never reached the search, so the margin term had nothing to act on.
  - `pure-ismcts` (P2–P4 skipped, binary reward): **57.0% ± 4.3%** (CI 52.7–61.3%).
  - `pure-margin` (both): **58.8% ± 4.3%** (CI 54.5–63.1%, seats 58.4/59.2) → new default. Not statistically separable from pure-ismcts at N=500; chosen on trend plus principle (optimizes the points actually banked).

  Consequences at Master: the v1.1.2 `cuadrarPipThreshold` no longer gates closes (the search weighs closing moves against the sampled hidden-hand distribution directly); defensive closes and partner support emerge in-tree. **Experienced and Beginner are unchanged** — the P2–P4 code paths remain active there (`ismctsPure` gates on `difficulty === 'master'`). Genín and debrief grading inherit the new pipeline automatically (v1.2.2 precedent). Move timing: mean ~7 ms, max ~310 ms (up from ~4/75 ms — more decisions now reach the search), still invisible behind the UI thinking delay.

### Added (internal)
- `SmartAI.ismctsPure` and `ismctsRewardShaping` per-seat flags (defaults `true` / `'margin'`); `ISMCTSGameState` `rewardShaping` option.
- Harness variants: `pure-ismcts`, `pure-margin`, `reward-margin` (the 0g.3/0g.4 experiment set, now ≈ no-ops vs. the new default, kept for reproducibility), `legacy-hybrid` (restores the full v1.2.x master configuration for regression A/Bs), `reward-binary` (isolates the margin term).

## [1.2.7] – 2026-07-23

### Added (internal)
- **ISMCTS rollout-policy parameter and variants (BACKLOG 0g.2).** `ismcts()` now takes a third argument `rolloutPolicy` — `'random'` (canonical uniform rollouts, unchanged default), `'decisive'` (a rollout player one tile from domino always plays it), or `'greedy'` (decisive check + ε-greedy highest-pip shed, ε = 0.25). Per-seat `SmartAI.ismctsRolloutPolicy` flag; harness variants `rollout-decisive` / `rollout-greedy`.

### Notes — experiment results
- Both informed-rollout policies **washed** in 500-match A/Bs vs. random rollouts: decisive 49.6% ± 4.4% (CI 45.2–54.0%), greedy 48.6% ± 4.4% (CI 44.2–53.0%), both seat-balanced. No default change. This disconfirms the "rollout noise explains the 1000 ≈ 5000 iteration plateau" hypothesis: domino rollouts are short (≤ ~20 plies) and the tree covers the near horizon, so rollout informedness isn't the binding constraint. Remaining 0g leverage shifts to reward shaping (0g.3) and determinization distribution (0g.5). Variants stay in the harness for interaction tests with later 0g work.

## [1.2.6] – 2026-07-23

### Fixed
- **ISMCTS determinization silently searched with real hands ~2% of the time.** `PlayerView._sampleValidDeals` assigns unknown tiles greedily in shuffled order with no backtracking and gives up after 3 attempts per requested sample. In constrained positions every attempt can dead-end; `ISMCTSGameState.cloneAndRandomize` then kept the clone's **real hands**, so that search iteration ran with perfect information. Measured over 20 master self-play matches (1.39M determinizations): **2.06% of iterations leaked, peaking at 3.71%** in the 12–15 tiles-played bucket — precisely where affinity weights are most skewed and honest inference matters most.

  Fix: when the greedy pass comes up short, `_sampleValidDeals` now completes the missing samples with a backtracking search (`PlayerView._backtrackingDeal`): most-constrained-tiles-first (MRV) ordering with random tiebreak, affinity-weighted random holder order, backtrack on dead ends, 20k-step safety budget. The true deal is always consistent with the observed constraints, so a full assignment always exists and the sampler can no longer come up empty. Gated by `PlayerView.useSamplerBackstop` (default **on**); new harness variant `no-det-backstop` reproduces the old behavior for A/Bs. Side benefit: `_computeMcMarginals` (500-sample marginals) no longer silently under-samples constrained positions either.

  Verification: re-measurement over 20 matches / 1.52M determinizations shows **0 failures** and 0 constraint violations across all sampled deals, with no wall-time regression. 500-match A/B (champion = fixed, challenger = leaky): challenger 53.8% ± 4.4% (CI 49.4–58.2%, seat-balanced 53.6/54.0) — statistically inconclusive, trending in the *expected* direction: the old behavior was an occasional-omniscience **cheat**, so the leaky variant holds a slight edge over the honest one. The fix is locked in on correctness grounds; the delta is the measured size of the cheat, not a regression.

## [1.2.5] – 2026-06-14

### Changed
- **Debug mode now exposes the ISMCTS tree-search reasoning.** When the master fallback picks a move via Information Set MCTS, the debug log (enabled via `?debug=ai`) now renders a `🌳 ISMCTS @ N iter — root visit distribution` table showing every root-child move with its visit count, percentage of total iterations, and empirical win rate from the rollouts. A top-vs-runner-up ratio + plain-English verdict (decisive / clear / modest / close call) tells you at a glance how confident the search was. The "FALLBACK: Best combined score (1000000.0)" line previously had no indication that ISMCTS was the actual selector — it now reads as `MASTER FALLBACK: ISMCTS pick (1000 iter) — factor table below is static-scorer context`, making the chain of responsibility explicit.

### Changed (internal)
- **`ismcts()` return shape**: was `string | null` (the best move key). Now `{ bestMove: string|null, rootStats: Array<{move, visits, wins, winRate}> }`. The added stats are sorted by visits descending. The forced-single-move case returns one entry with zero visits (no search ran); the no-moves case returns an empty array.
- **`SmartAI` master fallback** attaches `ismctsStats` and `ismctsIterations` to the chosen move object, which the DEBUG_AI block in the fallback passes through to `_logDebug`. No behavior change at runtime — these fields are inert unless debug mode reads them.

## [1.2.4] – 2026-06-14

### Changed
- **Structured Claude analysis output.** The prompt now asks Claude to return its response as three explicitly delimited Markdown sections (`## What you did well`, `## Patterns to watch across hands`, `## Try this next match` — translated to `## Lo que hiciste bien`, `## Patrones para corregir`, `## Intenta esto la próxima vez` in Spanish). The DebriefUI renders these as styled `<h4>` sections with proper paragraph blocks and bold/italic emphasis, so the analysis reads as visually distinct coaching sections instead of a single block of text.
- **Per-hand recap replaces the JSON dump.** Instead of including the full play-by-play JSON in the prompt, the builder now generates a compact one-line-per-hand summary: salida (who opened and with what), the human's noteworthy plays in that hand with AI alternatives, and how the hand ended (domino / cerrar / blocked + winning team + points). Result: prompts went from ~5–8 KB of mostly noise to a few hundred tokens of strategically focused context, while giving Claude *more* signal per token. New helper: `ClaudeService._buildPerHandRecap()`.
- **Expanded terminology glossary in the prompt.** Cuban/Puerto Rican vocabulary is now defined inline at the top of the prompt (la salida, cuadrar, cerrar, domino, tranque, firme, ahorcado, darle pase, llave) so Claude can use these terms precisely instead of paraphrasing them in English.
- **More directive task instructions.** The "Try this next match" section explicitly asks for *one* concrete habit change phrased as a falsifiable rule of thumb (good: "Before playing a double, count tiles in that suit — if zero, find another move"; bad: "be careful with doubles"). The cross-hand pattern instruction was tightened: "if a mistake only happened once, it's noise, not a pattern".

### Added
- **Minimal Markdown renderer in DebriefUI** (~30 lines). Handles `## headers`, `**bold**`, `*italic*`, paragraph breaks, and single-line breaks within paragraphs. HTML is escaped first so model output cannot inject script tags.
- **CSS for the analysis sections** — accent-colored section headers with a divider rule, comfortable line height inside paragraphs, distinct emphasis colors for bold and italic. Cache-busted via `styles.css?v=38`.

### Notes
- Backwards compatible: if a future model response doesn't include any `##` headers, it just renders as styled paragraphs.

## [1.2.3] – 2026-06-12

### Changed
- **Post-match Claude analysis prompt rewritten.** The prompt sent to Claude for the play-style analysis had been unchanged since v1.0.x — it described the AI as a 10-factor heuristic scorer with no awareness of priorities, calibration, firme strategy, the cuadrar pip-advantage threshold, or ISMCTS. Rewrite:
  - **AI-context section** at the top explains the master decision pipeline (P1/P2/P3 priorities, the cuadrar threshold of +5 with its noise-floor rationale, the 10-factor scorer with v1.1.0 firme A+B1+C logic, Platt-calibrated probabilities, ISMCTS @ 1000 iterations in the fallback). When the AI's recommendation looks counter-intuitive at the single-play level, Claude now has the context to explain *why* (tree-search saw a distribution outcome the static principles can't see).
  - **Balanced highlights**: the prompt now surfaces up to 3 *optimal/good* plays alongside the mistakes, so the analysis can call out strengths concretely instead of reading as a critique. New `MatchHistory.getHighlightMoments(limit)` API.
  - **Cross-hand pattern directive**: the task instructions explicitly ask for recurring patterns across hands rather than one-off mistakes ("if a mistake only happened once, it's noise, not a pattern").
  - **JSON guidance**: the full match-data JSON is still included as reference but the prompt now directs Claude to *focus on the Strengths and Weaknesses sections* and treat the JSON only as quotable evidence, not as something to summarize.
  - **Conversational tone**: replaces the rigid "Provide a 2-3 paragraph analysis" with three short conversational paragraphs (strengths / cross-hand patterns / one concrete next-match improvement), styled as a coach speaking to a student.

- **Worker model upgraded to Claude Sonnet 4.6** (was Haiku 4.5). The longitudinal-pattern analysis the new prompt asks for benefits noticeably from Sonnet's reasoning depth. Cost per analysis is small either way (cents per match). Requires redeploy of the `domino-api` Worker (`npm run deploy` from `~/Documents/Claude-code-projects/domino-api`).

### Notes
- A "structured output + per-hand drill-down" follow-up is queued in BACKLOG (Medium) — that's the deeper polish on top of v1.2.3's prompt rework.

## [1.2.2] – 2026-06-12

### Fixed
- **Genín advice now reflects the latest AI logic.** `SmartAI.getRecommendation()` (called by Genín and by the post-move debrief evaluation) had been a parallel, simpler code path that only ran the 10-factor static `scoreMove()` — no priorities, no Monte Carlo lookahead, no ISMCTS. Mario observed this as Genín being "very focused on single plays rather than the longitudinal game", which was accurate by construction: no lookahead or priorities were running.

  As of v1.2.2, `getRecommendation` delegates to `chooseMove`, so Genín now benefits from the full master pipeline: priorities (P1 winning, P2 high-confidence cuadrar, P3 partner support), the calibrated 10-factor scoring with firme strategy and `cuadrarPipThreshold = 5`, and ISMCTS tree search at 1000 iterations in the fallback path. Player 0 defaults to master in the `SmartAI` constructor and `main.js` does not override it, so the human's own advice has always been "what would master do" — that's now actually master-quality.

  Two side effects worth knowing:
  - Genín may return slightly different recommendations on repeated clicks at the same position (ISMCTS has rollout / determinization variance). The moves are comparable in strength; not the same.
  - Post-match debrief grading shifts: the "AI recommendation" column now benchmarks against the master ISMCTS pick instead of the static-score top. Historical matches are unaffected (their snapshots are stored at play time), but new matches will grade against the stronger benchmark.

### Documentation
- **README** Genín section now explicitly documents that as of v1.2.2 advice goes through the master decision pipeline (priorities + scoring + ISMCTS).

## [1.2.1] – 2026-06-12

### Fixed
- **Master-level freeze on the first non-forced turn.** In v1.2.0, the ISMCTS branch bumped its chosen move's `finalScore` to `Infinity` so the subsequent sort would put it first. Production main.js then sets `randomizeTolerance = 5` for master, which feeds into a filter `topScore − finalScore <= tol`. For the ISMCTS pick that's `Infinity − Infinity = NaN`, and `NaN <= 5` is **false** — the chosen move gets excluded from its own randomization band, the band becomes empty, `band[Math.floor(Math.random() * 0)]` returns `undefined`, and `bestMove.score` throws `TypeError: undefined is not an object`.

  The harness self-play tests didn't catch this because `setupMatch` leaves `randomizeTolerance = 0`, which short-circuits the randomization branch entirely.

  Fix: bump the ISMCTS-picked move to `1e6` (a large finite value safely above any realistic static score, which is in the ±200 range) instead of `Infinity`. The arithmetic `1e6 − 1e6 = 0` is well-defined, the chosen move makes it into the band, randomization picks it deterministically (the band collapses to one move), and the rest of the fallback path completes normally. Verified with a master-difficulty + `randomizeTolerance = 5` integration script that mirrors the production main.js setup.

## [1.2.0] – 2026-06-12

### Added
- **ISMCTS-powered Master difficulty (backlog item 0f).** At Master, the AI's fallback decision path is now an Information Set Monte Carlo Tree Search (Cowling, Powley, Whitehouse — IEEE TCIAIG 2012) at 1000 iterations per move, replacing the previous static-score + Monte Carlo blend. New modules: `docs/js/ai/ISMCTSEvaluator.js` (algorithm core, near line-for-line port of the canonical Cowling et al. Python reference) and `docs/js/ai/ISMCTSGameState.js` (adapter wrapping `GameState`/`Chain`/`Hand` with the ISMCTS interface; determinization delegates to `PlayerView._sampleValidDeals(1)`).
  - 500-match A/B vs. the prior Master configuration: **63.4% ± 4.2% (CI 59.2–67.6%)** at 1000 iterations, with healthy seat balance (64.4 / 62.4). Equivalent results at 5000 iterations (65.6% in the parallel 500-match run); 1000 chosen for ~3.5× lower latency. Mean wall time per AI move ~4 ms; max ~75 ms — imperceptible behind the UI's existing AI thinking delay.
  - Algorithm summary: each iteration *determinizes* (samples one possible hidden-state consistent with everything the observer has seen), descends the tree with UCB1, expands one new child, plays a random rollout to terminal, backpropagates wins/visits. The most-visited move at the root is chosen.

### Changed
- **Difficulty ladder rewired.** **Master** now uses ISMCTS in the fallback (above). **Experienced** now uses the *default* adaptive Monte Carlo blend (depth 1–6, samples 30–100) — i.e. the configuration that was Master in v1.1.x. The previous "experienced → light MC" override (`maxDepth: 3, maxSamples: 50`) was dropped: Experienced is now the strongest *rule-based* configuration the project has shipped.
- **Beginner** unchanged.
- **`SmartAI.useISMCTS[]` per-seat flag removed** — Master enables ISMCTS unconditionally based on `difficulties[playerIndex] === 'master'`.
- **At Master, the existing `randomizeTolerance = 5` becomes a no-op** because ISMCTS sets `finalScore = Infinity` on its chosen move, collapsing the "within 5 of top" set to that single move. ISMCTS already has stochasticity from random rollouts and determinization, and the most-visited-root pick is itself an ensemble across thousands of sampled hidden states — so the AI doesn't become brittlely deterministic. Adding randomness among ISMCTS top-N picks is queued as a possible follow-up if needed.

### Documentation
- **README.md** rewritten for v1.2.0: file tree adds `ISMCTSEvaluator.js` / `ISMCTSGameState.js`; the difficulty ladder table contrasts MC-blend (Experienced) vs ISMCTS (Master) fallbacks; AI Decision Flow diagram updated; the long-standing 9-vs-10 scoring-table inconsistency fixed (Opponent Suit Avoidance row added); new "Information Set Monte Carlo Tree Search (Master Fallback)" section with full attribution to Cowling/Powley/Whitehouse (DOI link, paper citation), pointers to the canonical Python reference (`~/Documents/Claude-code-projects/ISMCTS-Dominoes/president/framework.py`), and acknowledgment of [isaacbuckman/Dominoes](https://github.com/isaacbuckman/Dominoes) (4-person partnership ISMCTS adaptation) and [angeris/DominAI](https://github.com/angeris/DominAI) (Negamax + PIMC/IMS alternative we considered).
- **BACKLOG item 0f** moved to `## ✅ Shipped` (v1.2.0).
- **`docs/DESIGN.md`** — the v1.1.2 design doc for item 0f remains as-is; it accurately documents the implementation approach that shipped.

## [1.1.2] – 2026-06-09

### Fixed
- **AI takes bad offensive cuadrar decisions.** The trigger in `_findHighConfidenceBlock` was `pipAdvantage > 0` — any positive estimated pip advantage would fire an offensive close. New `--pip-accuracy` instrumentation in the harness measured the underlying pip-advantage estimator: **RMSE ≈ 9.3 pips, false-profitable rate 24.9%** (1 in 4 times the AI said "closing is profitable" the actual pip-advantage was zero or negative). The threshold was a knife-edge against a noisy signal. Mario observed the failure in real play: partner created a cuadrar that lost the cerrar by 35 points despite the AI estimating a positive pip advantage.

  Fix: introduced per-seat `cuadrarPipThreshold`, default 5. Offensive cuadrar now requires the estimate to exceed the noise floor before firing. Measured impact at threshold 5 over 200 matches (`--all-variant cuadrar-thresh-5 --instrument`):
  - Offensive cuadrar volume dropped 15× (37.6% of closes → 2.4%)
  - **Offensive cerrado win rate rose 90% → 100%**
  - Mean pip margin on winning closes rose +12.6 → +20.8
  - Total closed hands fell ~16% (more games now end via domino instead of premature close)

  500-match win-rate A/B: 51.4% (CI 47.0–55.8%) — slightly positive trend, consistent with the established self-play pattern that move-quality fixes don't move symmetric win rate but do produce real-world correctness gains.

### Added
- **`--pip-accuracy` mode in the tournament harness.** At each `chooseMove`, snapshots the AI's `_estimateTeamPips.pipAdvantage` and compares against ground truth computed directly from `state.hands`. Reports mean signed error, RMSE, sign-mismatch rate, and false-profitable rate, bucketed by tiles played. Used to fit the v1.1.2 threshold; will inform any future cuadrar / pip-estimation work.

## [1.1.1] – 2026-06-09

### Fixed
- **Tile-probability calibration drift.** Measurement under backlog item 0c (300 matches, 7.44M predictions) showed `PlayerView.getProbability` was systematically under-confident across the 50–90% range (+0.02 drift per bin, monotone, well above sampling noise) and slightly over-confident in the 10–30% range. Fit a Platt-scaling recalibration in logit space — `P_cal = σ(1.10·logit(P_raw) + 0.04)` — and applied it as a thin post-hoc layer at the end of `PlayerView.getProbability`. Verification with `--all-variant calibrate --prob-accuracy` over 200 matches: max bin drift dropped from +0.023 to +0.008, and the 50–90% range mean drift went from +0.022 to −0.002. Win-rate A/B over 500 matches was neutral (49.2% ± 4.4%, CI 44.8–53.6%) — locked in on the same correctness-fix precedent as v1.1.0's accurate-firme and accurate-dominance. Constants a, b should be re-fit if `HandTracker`, `PlayerView` affinities, or MC sampling change meaningfully (use `tools/tournament.js --all-variant ... --prob-accuracy`).

### Added
- **`--prob-accuracy` mode in the AI tournament harness** (backlog item 0c, phase 1). Snapshots every `PlayerView`'s belief about who holds each unplayed, not-own tile before each `chooseMove`. Scores Brier and log-loss against ground truth from `state.hands`, bucketed by tiles-played (0–3, 4–7, …, 24–27) and partner-vs-opponent, plus a 10-bin calibration curve. Used to validate v1.1.1 calibration; will drive future inference work (item 0c phases 2–3 + item 0d).

### Notes on 0c phase 1
- Overall Brier 0.207; sharpens monotonically from 0.220 (early game) to 0.155 (very late) — a ~30% reduction across the hand. Inference *does* improve with information, primarily in the mid-late game (tiles 12+).
- Partner and opponent predictions are statistically indistinguishable at scale.
- 57% of all predictions land in the 30–40% "weak evidence" bin (3 candidates, near 1/3 base rate). Sharper inference signals would push more predictions out of this bin — that's where future Brier gains live.

## [1.1.0] – 2026-05-28

### Added
- **AI firme strategy.** `firmeProtection` now evaluates three move-effect signals beyond preserve/spend:
  - Bonus for moves that newly expose a latent firme on the new open end (you already hold every remaining V-tile, you're just turning the chain to show V).
  - Penalty for moves that play your *last* V-tile when an opponent likely holds every other unplayed V-tile — by playing it you'd hand them a firme on V.
  - Partner-leading damper: when your partner is the overall leader (fewest tiles), the preserve bonus is scaled down by P(partner can play the other end) — i.e. hoarding a firme costs less when partner can keep the chain alive, more when partner is blocked on the other side.
- **Master-AI move randomization.** Expert-level AI players now pick uniformly among moves within 5 score points of the best instead of always selecting the single top move. Reduces predictability against humans at no measured self-play cost (500-match A/B: 48.8% ± 4.4%).
- **AI tournament harness** (`tools/tournament.js`). Headless Node CLI runs N AI-vs-AI matches and reports per-team / per-seat stats, decision-priority breakdown, scoring-factor histogram, score-margin distribution, and closing-effectiveness analysis. Supports `--ab --variant NAME` Champion-vs-Challenger testing with 95% confidence intervals (challenger team alternates each match to cancel seat bias), `--all-variant` for measuring a change in isolation, and `--instrument` for full decision telemetry. Added a root `package.json` (`type: module`) so `docs/js` loads as ES modules under Node; browsers and the deployed static site are unaffected.
- **SmartAI `onDecision` instrumentation hook.** Optional callback emitting a structured per-move record (priority taken, score margin, dominant factor, block type, certainty, etc.). Default null — no production overhead when nothing is listening.
- **Decision-flexibility metric** in the harness instrumentation: counts what fraction of fallback decisions have ≥2 moves within 5/10 score points of the top.

### Fixed
- **Firme detection off-by-one.** `getRemainingInSuit()` counts suit *faces* (a played double counts as 2), so once V|V is played it under-reports the unplayed V-tile count by 1. Firme detection compared face count against a hand-tile count, producing both false negatives (missing a real firme after the double is played) and false positives (claiming a firme when an opponent still holds a V-tile). Added `getRemainingTilesInSuit()` and wired firme detection through it. Confirmed non-regressive in a 500-match A/B (48.8% ± 4.4%, seats 122/122).
- **`suitDominance` factor inherited the same bug** in its denominator: `(myTeamCount − oppCount) / remaining × 50`, where the numerator was in tile units but the denominator was face count. Migrated to `getRemainingTilesInSuit`. Confirmed non-regressive in a separate 500-match A/B (49.6% ± 4.4%).
- **Claude API model.** The Cloudflare Worker proxy was pinned to `claude-3-haiku-20240307`, which Anthropic has retired. Post-game play-style analysis returned `not_found_error` on every call. Updated the Worker to `claude-haiku-4-5-20251001` and redeployed.
- **Claude API error surfacing.** `ClaudeService.analyzePlayStyle` only checked `data.message`, so an Anthropic error envelope (`{ type: 'error', error: { message } }`) was missed and reported to the user as the generic "Unexpected response format". Now reads `data.error.message` so the real cause (e.g. retired-model) reaches the UI and the console.

### Changed
- **`firmeProtection` factor structure** internally split into `preserveScore` (existing spend/preserve + new latent-firme creation bonus) and `oppPenalty` (new opp-firme trigger). Only `preserveScore` is damped by the partner-leading override; handing an opponent firme is bad regardless of partner state.

### Documentation
- **`BACKLOG.md`** updated with the harness/A-B capability writeup, the closing-effectiveness findings (offensive cuadrar ~90% win rate, defensive ~44% by design, incidental ~57%), and the meta-finding that move-quality tweaks consistently wash out in symmetric self-play.
- **`CHANGELOG.md`** introduced (this file) per `VERSIONING.md` procedure.
- **`VERSION`** file introduced at project root, single-string SemVer.

### Notes on AI-strength experiments
Eight tuning variants were measured this release (`mc-pass`, `no-def-close`, `def-close-1`, `pip-close`, `lookahead2`, `rand5`/`rand10`, `accurate-firme`, `accurate-dominance`, `firme-strategy`). All ranged 47.8–51.3% over 500–1500 matches — within or right at the edge of noise. Two patterns:
1. Move-quality calibration tweaks do not move symmetric self-play win rate. The static scorer is well-balanced.
2. The exploitable gap appears to be AI determinism, not scoring. `rand5` shipped on that basis.

The firme-strategy variant is locked in even though its self-play impact is neutral: the encoded reasoning (your three notions) is strategically correct, and self-play is the wrong yardstick for changes that target *human* play patterns.

---

## [1.0.5] – 2026-05-23

### Added
- **Team-Contextual Play Inference (backlog 0b).** End-choice inference now interprets each play in the context of team strategy rather than as an isolated event: playing on the partner-suit end is the expected team move and carries little information, while playing *against* the partner-suit end is surprising and updates the unchosen-end suit-probability more strongly. Drives `SmartAI.analyzePlayChoice` → `PlayerView.applyAffinitySignal`. Cuadrar plays now amplify the upward affinity for the squared value and override `signaledSuits`.

## [1.0.4] – 2026-04-18

### Added
- **Smarter cerrar AI.** Cerrar (closing) decisions improved by tracking the outcome of each close attempt (`SmartAI.cerrarLog`) and feeding it back into the decision criteria. Cerrar-log dev diagnostic added for offline analysis.

### Fixed
- **Match-end modal touch bleed-through on iPad.** Modal could appear with a touch already registered, causing immediate dismissal. Now the `New Match` button locks for 2.5s after the modal appears, and an explicit button press is required to start a new game.
- **Cerrar log missing match-ending hands.** The final hand of a match wasn't being recorded in the cerrar diagnostics.

## [1.0.3] – 2026-03-03

### Added
- **Configurable AI difficulty levels.** Per-seat difficulty selector (beginner / hard / master), wired through `SmartAI.difficulties` and persisted in settings.

### Fixed
- Cerrado badge condition.

## [1.0.1] – 2026-03-03

### Changed
- Skip the AI thinking delay when a player has only one tile left — the move is forced and the deliberation indicator is misleading.

## [1.0.0] – 2026-03-02

### Added
- **PWA support — installable on iPhone and Android.** Added `manifest.json`, `service-worker.js` (cache-first for static assets), iOS-friendly icons (192/512/apple-touch). The site is now installable from Safari/Chrome with "Add to Home Screen": app icon, full-screen launch (no browser chrome), works offline, localStorage persists.

## [0.4.6] – 2026-03-02

### Changed
- **Fixed chain position / stable tile layout.** Start tile (la salida) pinned to the horizontal center of the table at all times. Left arm folds upward above the anchor row, right arm folds downward below it; each continuation row uses the full container width. L-shaped turn connectors indicate where each arm wraps at the wall. `Chain.firstTileIndex` tracks the split point between left arm, start tile, and right arm. Pip flip logic preserves connecting-pip alignment after each wall turn.

## [0.4.5] – 2026-02-17

### Added
- Opponent suit avoidance factor (`factors.oppSuitAvoidance`) — penalize moves that leave end values in opponents' signaled suits.
- Cuadrar vs. cerrar distinction in the AI's strategic vocabulary.
- Mexican domino terminology surfaced in the explainer and translations.

## [0.4.4] – 2026-02-17

### Added
- **Affinity-weighted Monte Carlo sampling.** MC deal sampling now weights tile assignments by `PlayerView` Bayesian affinities so simulated deals respect inferred suit preferences.
- **Firme advice from Genín** — coaching text identifies firme situations and explains spend vs preserve choices.
- **Partner-support rework** — Priority 3 (early-game partner support) now uses the affinity-weighted view rather than raw HandTracker.

## [0.4.3] – 2026-02-16

### Added
- Enriched advice detail for Genín — richer per-move explanations including factor attribution and traditional terminology.

## [0.4.2] – 2026-02-12

### Fixed
- Probability engine bugs surfaced by the accuracy analyzer.

### Added
- Probability accuracy analyzer continues from v0.4.1.

## [0.4.1] – 2026-02-12

### Added
- **Probability accuracy analyzer with Brier scoring.** Debug-mode tool that captures probability snapshots before each play, compares to ground truth at hand-end, and reports Brier scores per factor. Useful for diagnosing where the inference layer is over- or under-confident.

## [0.4.0] – 2026-02-11

### Added
- **Per-player probability views with Bayesian play-pattern inference.** Introduced `PlayerView` so each computer player has its own perspective on the game: knows own tiles exactly, doesn't know other players' tiles, and tracks Bayesian suit affinities from observed plays (salida, end choices, cuadrar). Replaces direct `HandTracker` access in `SmartAI.scoreMove` with `activeView`-aware probability lookups.

## [0.3.6] – 2026-02-11

### Added
- Pulsing pass badge on player position when they pass on a suit.
- Debug-mode probability tables (enabled with `?debug=ai`) showing per-player suit-count estimates and Bayesian affinities.

## [0.3.5] – 2026-02-11

### Changed
- Pass events now visually prominent — pass badge animation and log color updates.

## [0.3.4] – 2026-02-11

### Fixed
- Suit-signal detection (`signaledSuits`) and `suitDominance` double-counting when the same tile contributed to both teams' counts.

## [0.3.3] – 2026-02-11

### Added
- Team-aware suit dominance — `suitDominance` factor uses team totals instead of self-only.

### Fixed
- Pip column display in debug tables.

## [0.3.2] – 2026-02-11

### Added
- **Firme protection scoring factor** introduced (`factors.firmeProtection`). Initial implementation: spend penalty / preserve bonus on current open-end firmes. Detection uses `getRemainingInSuit` (face-count); the off-by-one when V|V has been played wasn't recognized until v1.1.0.

## [0.3.1] – 2026-02-10

### Fixed
- Partner-support inference — `signaledSuits` for the partner now correctly reflects their opening play.

## [0.3.0] – 2026-02-09

### Changed
- **Rebrand to 7 Fichas with EN/ES language support.** Renamed from "Domino Advisor" to "7 Fichas". Full i18n system with ~250 translation keys across English and Spanish, language toggle in header, browser-language auto-detection with localStorage persistence. Traditional domino terminology preserved (tranque, cerró, dominó). All UI elements, game messages, modals translated.
- **Genín mascot** — doodle-style illustration introduced as the coaching persona. Four poses (thinking / questioning / advising / celebrating) used in debrief, quiz, help, and match-win contexts. Introduces himself as "your domino coach" in the help modal.

## [0.3] – 2026-01-31

### Added
- **Probability-based AI decision-making.** `HandTracker` with Bayesian probability calculations: `getProbability(player, tile)`, `getPassProbability(player, value)`, `getBlockingProbability(player, v1, v2)`. Priority-override system in `SmartAI`:
  - Priority 1: winning move (domino)
  - Priority 2: high-confidence blocking (cuadrar with P > 0.7)
  - Priority 3: partner support in the first 8 plays
  - Fallback: weighted scoring across factors
- Fixes "mata la mano" failure where pip management overrode partner support.

## [0.2.1] – 2026-02-01

### Changed
- **Mobile viewport improvements.** Responsive layout for phones (480px) and very small screens (360px). Smaller dominoes on chain and hand, horizontal scrolling for hand tiles, 44px-minimum touch targets, full-width modal buttons, scrollable debrief tabs, compact table layout, responsive tilesPerRow based on screen width. L-shaped turn connectors with arrows indicating chain flow direction.

## [Pre-0.2.1] – January 2026

The following capabilities shipped before the changelog existed (drawn from the BACKLOG's prior `Completed Features` entries; specific versions not recorded in git):

### Added
- **User manual / help modal** — in-app `?` button in the header opens a modal with game overview, how-to-play, scoring rules, feature explanations (Quiz, Attribution, Debrief), and beginner strategy tips.
- **Player color coding & tile attribution** — four distinct player colors (You cyan, Opp 1 coral, Partner green, Opp 2 orange). Toggle to show who played each tile on the chain; subtle glow on attributed tiles; player indicator dots with initials (Y, 1, P, 2); color legend; log colors matched.
- **Hand prediction tracking & quiz mode** — `HandTracker.js` for probability tracking; quiz modal to test prediction skills; Predictions tab in debrief showing accuracy trends; localStorage persistence for quiz history.

---

*Earlier history (v0.1.x and pre-rebrand "Domino Advisor" work) lives only in git commit history.*
