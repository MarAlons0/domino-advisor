# Multiplayer (networked) — Design

**Status:** draft for review, 2026-10-23. Backlog: 🔴 High "Multiplayer game".

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
- **CPU per message is the one unknown.** Workers Free caps CPU at **10 ms per request**; the DO
  docs say objects share Workers' limits but quote only a 30-second default. A deployed test
  settles it (phase P0).
- **Usage at personal scale:** a match is ~7 hands and ~200 moves/passes → roughly 15–25 billable
  requests (plus ~500 if Master AI seats need time-slicing, below) — a few hundred matches a day
  would still fit.

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

---

## Architecture (free plan)

```
 Each player's browser (GitHub Pages)          Cloudflare free plan — Worker "domino-rooms"
 ┌──────────────────────────────────┐          ┌──────────────────────────────────────────┐
 │ main.js UI (largely unchanged)   │  wss://  │ POST /rooms → new room code                │
 │  ├─ RemoteGame adapter ◄─────────┼─────────►│ GET /rooms/CODE/ws → that room             │
 │  │   (same API as Game; you = 0) │          │ Durable Object "GameRoom" (one per room):   │
 │  └─ Genín: SmartAI on YOUR       │          │   deal · secret hands · rule checks ·       │
 │     information only (local)     │          │   scores · AI seats · cerrar pip facts      │
 └──────────────────────────────────┘          └──────────────────────────────────────────┘
```

**Server (Durable Object, one per room)** — the authority: deals, holds every hand, validates
each play, keeps turn order and scores, runs the AI seats, and sends each player only their own
hand plus public information.
- **Beginner / Intermediate AI seats:** run directly (Intermediate's slowest moves may need a
  small optimization if the 10 ms cap applies).
- **Master AI seats:** if the 10 ms cap applies, the search runs in **slices** — a few hundred
  iterations per invocation, chained with alarms, the search tree kept in memory between slices —
  so no single invocation exceeds the cap. If the cap doesn't apply, it runs as today.

**Each player's browser:**
- `RemoteGame` adapter with the slice of `Game`'s interface that `main.js` already uses
  (`getState`, `playTurn`, `pass`, `newHand`, `getMatchHistory`, the `on…` callbacks), translated
  to and from WebSocket messages — so the table, hand, effects, hand-end card and debrief keep
  working.
- **Seat rotation:** you are always seat 0 at the bottom; rotating keeps partners opposite, so
  "your team / opponents" stays correct. Other humans show by their chosen names.
- **Genín locally:** the same `SmartAI` + `HandTracker` / `PlayerView` setup as single player,
  initialized from your own hand, with placeholder tiles (right counts) for hidden hands — the
  tests above show that gives identical advice and grades.
- AI "thinking" pauses are animated on the client, so the room can hibernate between messages.

### Message protocol (sketch)
- Client → server: `join {name, token?}`, `takeSeat {seat}`, `setAI {seat, level}` (host),
  `start` (host), `play {tile, end}`, `pass`, `nextHand`, `rematch`.
- Server → client: `lobby {seats, host}`, `state {yourHand, chain, counts, scores, turn, phase}`,
  `played {seat, tile, end}`, `passed {seat}`, `handEnd {result, hands, cerrarFacts}`,
  `matchEnd {scores}`, `error {code}`.

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
| **P0 — Spike** (needs `wrangler login` by Mario) | Guard the browser-only lines (an ordinary release, no visible change). Deploy a throwaway room to the free plan; measure the real CPU cap, WebSocket + hibernation, latency from a phone. **Decides whether Master AI seats need slicing.** | v1.9.x + throwaway Worker |
| **P1 — Rooms and play** | `domino-rooms` Worker + `GameRoom`; lobby (create / join / seats / AI levels); `RemoteGame` adapter; seat rotation and names; Beginner/Intermediate AI seats; reconnect. | MINOR |
| **P2 — Genín + Master seats** | Local Genín in multiplayer (advice, hand-end card, debrief); server cerrar facts; Master AI seats (sliced if needed). | MINOR |
| **P3 — Polish** | Rematch flow, quick reactions, optional turn timer. | PATCH / MINOR |

## Testing
- Unit tests for the room logic with fake sockets and fixed deals (Node).
- `wrangler dev` locally with several browser tabs as separate players.
- An automated 4-client bot run over real WebSockets (full matches, reconnect mid-hand).
- Scramble/tripwire tests kept as regression checks that Genín and the AI use only the player's own
  information.
- The existing regression scripts, since the engine is shared.

## Open questions
1. **Free-plan CPU cap** for Durable Objects (10 ms or 30 s) — answered by P0.
2. **Disconnect timeout** before the host may give a seat to the AI (proposal: 60 s).
3. **Names:** free-text display names per room (no accounts) — proposal: yes, max 12 characters.
