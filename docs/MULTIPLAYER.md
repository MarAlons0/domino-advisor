# Multiplayer (networked) — Design

**Status:** P1 (rooms and play) — v1.10.0; P2 (Genín in multiplayer) — v1.11.0, 2026-10-23. Next: P3 (polish). Backlog: 🔴 High "Multiplayer game".

**Decided:**
- Networked play — each human on their own device — not hot-seat; 2–4 humans, same or opposing
  teams; AI fills empty seats.
- **No paid services.** Everything must run on Cloudflare's free plan; if it can't, the item goes
  back to the backlog.
- Multiplayer matches **count** in lifetime stats and badges.
- **Host only:** the room creator starts the match, sets AI levels, and can hand a disconnected
  player's seat to the AI.

---

## Goals and non-goals

**Goals (v1)**
- 2–4 humans in one match, each on their own phone or computer, joined by an invite link / room code.
- Any seating: partners vs. AI, humans on opposing teams, or a full table of four humans.
- Same rules, table effects and Genín coaching as single player.
- Survive a dropped connection: rejoin the same seat.
- Keep every player's hand secret from the others (no peeking via browser dev tools).

**Not in v1:** accounts or logins, matchmaking with strangers, chat, spectators, ranked play,
server-side history across matches.

---

## What the research found

### 1. The game engine can run on a server almost as-is
Importing the engine, AI and coaching modules with **no browser globals** (as in a Cloudflare
Worker) fails only because of:
- `i18n/i18n.js` — reads the saved language (`localStorage`, `navigator`) and updates the page
  (`document`) when the module loads;
- `SmartAI.js` and `MonteCarloEvaluator.js` — read `window.location` for the `?debug=ai` flag.

Everything else is plain JavaScript. Guarding those few lines lets the **same modules run in the
browser and on the server** — one source of truth for the rules and the AI.

### 2. CPU per operation (Node, same V8 engine as Workers; 8 matches per level)

| Operation | Median | 90th pct | Worst | Over 10 ms |
|---|---|---|---|---|
| Apply a play (rules engine) | ~0 ms | ~0 ms | 2 ms | 0% |
| AI move — Beginner | ~0 ms | ~0 ms | 0.2 ms | 0% |
| AI move — Intermediate | 2.8 ms | 6.2 ms | 18 ms | 4% |
| AI move — Master | 12.5 ms | 17.4 ms | 31 ms | **70%** |
| Genín's analysis (Master grading) | 19 ms | 26 ms | 46 ms | **88%** |

### 3. Cloudflare free plan
Sources: [DO limits](https://developers.cloudflare.com/durable-objects/platform/limits/),
[DO pricing](https://developers.cloudflare.com/durable-objects/platform/pricing/),
[Workers limits](https://developers.cloudflare.com/workers/platform/limits/).

- Durable Objects are included (SQLite-backed): **100,000 requests/day** and **13,000 GB-s/day**;
  once a daily limit is exceeded, further operations fail until 00:00 UTC.
- WebSockets: opening a connection is one request; incoming messages bill at 20:1; outgoing
  messages are free. With the **Hibernation API** an idle room isn't billed for duration.
- **CPU per message — measured (P0 spike, below):** the 10 ms Workers Free cap does **not**
  limit Durable Objects in practice; a full second of CPU per message ran fine, consistent with
  the DO docs' 30-second default.
- **Usage at personal scale:** a match is ~7 hands and ~200 moves/passes → roughly 15–25 billable
  requests — thousands of matches a day would still fit.

### 4. Genín can run in each player's own browser — proven
Two tests on real game positions:
- **Scramble test:** decide twice with the same random seed — once with the true hidden hands,
  once with the other players' tiles reshuffled (same sizes, same unseen tiles). Results were
  **identical in every case**: 1,275 AI decisions (Intermediate and Master) and 177 Genín analyses
  (grade inputs, reason, cerrar read).
- **Tripwire test:** during AI decisions, any read of another seat's hand beyond its size is
  logged. The only read is the search's starting copy, which is re-sampled from that seat's own
  knowledge on every iteration. AI seats treat the human's tiles as unknown.

So Genín's advice and play analysis need **only the player's own hand plus public play** — exactly
what each player's browser has. They can run there, costing no server CPU, with the same results
as single player. (The hand-end "what if you had closed" check needs everyone's pip totals; the
server computes that — it's simple arithmetic — once hands are revealed.)

### 5. P0 spike — measured on the free plan (2026-10-23)
A throwaway Worker (`domino-rooms-spike`, deleted afterwards) bundled the real engine and AI into
a Durable Object on Mario's free Cloudflare account:

| Test | Result |
|---|---|
| Pure CPU over HTTP, up to ~1 s per request (30M loop iterations) | ✅ 5/5 at every size |
| Real AI moves: Intermediate; Master at 1,000 / 2,000 / 4,000 iterations | ✅ 31/31 (75–210 ms wall incl. network) |
| The same work as WebSocket messages (Hibernation API) | ✅ 8/8; ping round trip 26 ms |
| 5 chained alarms of ~34 ms each, in-memory state kept between them | ✅ 5/5 |
| Bundle size (engine + AI) | 58 KB gzipped |

**Conclusion:** everything — rules, secret hands, AI seats at every level, and Genín's analysis —
can run on the server on the free plan. No time-slicing is needed. (Measured, not documented by
Cloudflare for the free plan; client-side Genín, section 4, remains a proven fallback if limits
ever tighten.)

---

## Architecture (free plan)

```
 Each player's browser (GitHub Pages)          Cloudflare free plan — Worker "domino-rooms"
 ┌──────────────────────────────────┐          ┌──────────────────────────────────────────┐
 │ main.js UI (largely unchanged)   │  wss://  │ POST /rooms → new room code                │
 │  ├─ RemoteGame adapter ◄─────────┼─────────►│ GET /rooms/CODE/ws → that room             │
 │  │   (same API as Game; you = 0) │          │ Durable Object "GameRoom" (one per room):   │
 │  ├─ Genín (advice, grading) from │          │   deal · secret hands · rule checks ·       │
 │  │   your information only       │          │   scores · AI seats                         │
 │  └─ hand-end card / debrief      │          │                                            │
 └──────────────────────────────────┘          └──────────────────────────────────────────┘
```

**Server (Durable Object, one per room)** — the authority: deals, holds every hand, validates
each play, keeps turn order and scores, runs the AI seats (all levels, as today), and sends each
player only their own hand and public information. It announces every move before applying it, so
a hand's last move always reaches clients before `handEnd`.

**Each player's browser:**
- `RemoteGame` adapter with the slice of `Game`'s interface that `main.js` already uses
  (`getState`, `playTurn`, `pass`, `newHand`, `getMatchHistory`, the `on…` callbacks), translated
  to and from WebSocket messages — so the table, hand, effects, hand-end card and debrief keep
  working.
- **Seat rotation:** you are always seat 0 at the bottom; rotating keeps partners opposite, so
  "your team / opponents" stays correct. Other humans show by their chosen names.
- **Genín runs in your browser (P2).** The plan was to run him on the server, but section 4
  proved he needs only your own information, which your browser already has — so he runs there,
  with the same code as single player and no server cost. Advice, grading, the hand-end card and
  the debrief all work from `RemoteGame`'s state and match history. Two multiplayer details:
  "what closing would have scored" needs everyone's pips, so it is settled from the revealed hands
  at hand end (`settleCloseOutcomes`); and a `HiddenHand` keeps its size when the search copies the
  table. Your analysis is attached to your play when the room confirms it, kept through a reconnect,
  and saved in your browser (`MatchHistoryStore`, current room only) so a reload keeps the match's
  coaching. Prediction quizzes stay single player (grading one needs the hidden hands).
- AI "thinking" pauses are animated on the client, so the room can hibernate between messages.

### Message protocol (as built)
- Client → server: `hello {name, token?}`, `takeSeat {seat}`, `setSeat {seat, kind, level}` (host),
  `start` (host; also the rematch), `play {tile, end}`, `pass`, `ready` (next hand),
  `replaceWithAI {seat}` (host).
- Server → client: `welcome {playerId, token}`, `lobby {lobby}`, `sync {matchNumber, handNumber,
  yourHand, plays, counts, currentPlayer, matchScores, …}`, `played {seat, tile, end}`,
  `passed {seat}`, `handEnd {reason, points, matchScores, hands, …}`, `matchEnd {winner,
  finalScores}`, `error {code}`. No Genín messages: he runs in the browser.

### Room lifecycle
1. **Create** → 6-character room code + invite link (`…/domino-advisor/?room=K7Q2XM`).
2. **Lobby** → players join with a display name and pick seats (team colors shown); the host sets
   AI levels for empty seats and starts.
3. **Play** → turn by turn; AI seats move on the server.
4. **Hand / match end** → the same modals; rematch keeps the seats.
5. **Disconnects** → the seat is held and others see "waiting for Ana…"; the player rejoins via a
   seat token saved in their browser; after a timeout the host can hand the seat to the AI.
6. **Cleanup** → an alarm deletes the room after a few hours idle.

### Stats
Multiplayer matches count in lifetime stats and badges like any other match (recorded locally by
each player's browser, from their own seat's perspective).

---

## Phases

| Phase | Scope | Ships as |
|---|---|---|
| **P0 — Spike** ✅ done | Throwaway room on the free plan: CPU, WebSockets + hibernation, alarms — all fine (section 5). Remaining P0 item: guard the browser-only lines in the app (an ordinary release, no visible change). | v1.9.x |
| **P1 — Rooms and play** ✅ v1.10.0 | `domino-rooms` Worker + `GameRoom`; lobby (create / join / seats / AI levels); `RemoteGame` adapter; seat rotation and names; AI seats at every level; reconnect. | MINOR |
| **P2 — Genín in multiplayer** ✅ v1.11.0 | Advice, grading, hand-end card and debrief for each player, computed in their own browser from their own information; coaching kept across a reload; stats. | MINOR |
| **P3 — Polish** | Rematch flow, quick reactions, optional turn timer. | PATCH / MINOR |

## How it's built (P1 + P2)

| Piece | File |
|---|---|
| Room rules, lobby, AI seats, what each player sees, save/replay | `server/src/RoomEngine.js` (pure — runs in Node) |
| Durable Object: WebSockets (Hibernation API), storage, alarms | `server/src/GameRoom.js` |
| Worker routes (`POST /rooms`, `/rooms/CODE/info`, `/rooms/CODE/ws`), allowed origins | `server/src/index.js`, `server/wrangler.toml` |
| Browser stand-in for `Game` (rotation, hidden hands, AI pacing) | `docs/js/multiplayer/RemoteGame.js` |
| Connection, reconnect, name + seat token | `docs/js/multiplayer/MultiplayerSession.js` |
| Lobby window | `docs/js/ui/LobbyUI.js` |
| Multiplayer mode in the app (only when the URL has `?room=`) | `docs/js/main.js` |
| Your coaching record across a reload (current room only) | `docs/js/multiplayer/MatchHistoryStore.js` |

The engine is shared: `Game.newMatch(tiles)` / `newHand(tiles)` accept a fixed deal (for replay),
and the browser-only lines (`i18n`, `?debug=ai`) are guarded so the same modules run on the server.

### Running it
```bash
# from server/ (wrangler 4.61 — `npm install` once, or use any wrangler on the PATH)
npm run dev      # local rooms server on http://localhost:8798 (app pages on localhost use it)
npm test         # RoomEngine, RemoteGame and Genín-in-multiplayer tests (Node)
npm run e2e      # full match over real WebSockets against `npm run dev`
npm run deploy   # publish to Cloudflare (free plan) — needs `wrangler login`
```
Local two-player test on one computer: open the app at `http://localhost:8791/?room=CODE` and at
`http://127.0.0.1:8791/?room=CODE` (different addresses keep separate saved names and seat tokens).

## Testing
- Unit tests for the room logic with fake sockets and fixed deals (Node).
- `wrangler dev` locally with several browser tabs as separate players.
- An automated 4-client bot run over real WebSockets (full matches, reconnect mid-hand).
- Genín in multiplayer (`server/test/genin.test.mjs`): at every decision of a player in a room, a
  Genín that knows only that browser's information must give the same advice, grades, win rates
  and reasons as one that sees the whole table (same random seed) — 825 of 825 identical over 20
  matches; closing figures settled at hand end must equal the live values; every move must arrive
  before `handEnd`; your analysis must survive a reconnect and a reload.
- The existing regression scripts, since the engine is shared.

## Open questions
1. ~~Free-plan CPU cap for Durable Objects~~ — answered by P0: not a constraint.
2. ~~Disconnect timeout~~ — decided: **60 s** before the host may give a seat to the AI.
3. ~~Names~~ — decided: free-text display names per room (no accounts), **max 12 characters**.
