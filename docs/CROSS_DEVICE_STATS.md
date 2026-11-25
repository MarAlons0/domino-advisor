# Consolidated record across devices — Design

**Status:** design agreed 2026-11-25; not started (next: P0). Backlog: 🟡 Medium "Consolidated
record across devices".

**Decided:**
- Devices link with a **sync code + share link** — no accounts, logins or emails.
- **Stats, badges and Your signals** sync. Quiz history, settings and Export my games logs stay on
  the device.
- A device that already has stats when it links **adds** them to the record.
- **Reset stats resets the record** on every linked device (badges kept).
- Runs on Cloudflare's free plan, on the existing `domino-rooms` Worker.

**The goal in one line:** someone who plays on a phone, a laptop and a tablet sees **one** lifetime
record (stats, badges, "Your signals") on all of them, counting every match from every device.

---

## Goals and non-goals

**Goals (v1)**
- Every device you link shows the same totals, badges and "Counting since" date.
- Matches played on any linked device (single player **and** multiplayer) count toward the total.
- Linking a device **adds** what it already has — nobody loses the record they built so far.
- Works offline: you can play with no signal and the device catches up when it's back online.
- Runs on Cloudflare's free plan, like multiplayer. No paid services.

**Not in v1:** accounts, logins, emails or passwords; leaderboards or comparing with other people;
syncing settings (language, difficulty) or quiz history; syncing Export my games logs (they stay on
the device — see [Privacy](#privacy)).

---

## What the code does today

- **Stats** live in `localStorage['7fichas_stats']` (`docs/js/stats/PlayerStats.js`). Each hand
  calls `recordHandResult`; each match end calls `recordCoachingData` and `recordMatchResult`.
  Every device has its own separate object.
- **Badges** (`BadgeSystem.js`) are stored inside that object as `{ id, earnedAt }`. All 12
  conditions read **only** the stats totals (e.g. `domino_master`: `hands.byReason.domino.won >= 20`),
  so they can be checked again on merged totals.
- **"Your signals"** (`SignalProfile`) is stored as plain sums per signal type (`n, held, expected,
  hands, hh, he, ee`), so two devices' profiles add up exactly.
- **Reset stats** zeroes everything except badges and sets `since`.
- **Multiplayer already counts** in stats (docs/MULTIPLAYER.md) — `RemoteGame` rotates seats so you
  are always team 0, and the same recorder runs.
- **Server:** the `domino-rooms` Worker already hosts two Durable Objects (`GameRoom`,
  `SuggestionBox`) and bundles modules from `docs/js` so the browser and server share one copy.

### Which stats merge, and how

| Field(s) | Merge rule |
|---|---|
| All counts — matches played/won/lost, zapatos, hands played/won/lost/tied, `byReason.*`, cerrado counts, Genín agreements, overrides won, quiz totals | **add** |
| `largestWinMargin`, `largestDeficitOvercome`, `hands.largestScore`/`largestSurrender`, cerrado `largestScore`/`largestSurrender`/`youClosedLargestScore`, `bestQuizScore` | **max** |
| `style` (Your signals) | **add** each sum |
| `badges` | **union** by id, keeping the earliest `earnedAt` |
| `since` | the latest reset on any device |
| `currentStreak`, `bestWinStreak` | **can't be added** — depend on the order of wins and losses across devices (below) |

Everything except the two streaks is order-independent: totals come out the same in whatever order
the devices report. That's what makes offline play and late syncs easy.

**Streaks** need the actual sequence. Win on the phone, lose on the laptop, win on the phone: the
phone alone sees a 2-win streak, the real one is 1. So the record keeps a compact list of match
results — `(finishedAt, won)`, about 20 bytes a match — and works out the streaks from it in time
order.

---

## Proposed design

### 1. Linking: a sync code, no accounts

- On the Stats screen, **Link my devices** creates a record on the server and shows a **sync code**
  like `K7QM-4RTX-9HPB` (12 characters, same alphabet as room codes — no 0/O/1/I — about 60 bits).
- **Share** sends a link via the phone's share sheet:
  `https://maralons0.github.io/domino-advisor/#sync=K7QM-4RTX-9HPB`. The code is after `#`, so it
  never reaches GitHub's servers or their logs.
- Opening that link on another device **asks first** ("Add this device's stats to this record?").
  It never links on its own — otherwise anyone could send you a link and pull your stats into their
  record.
- Or type the code under **I have a code**.
- The code **is** the key: anyone who has it can see and add to that record. The screen says to keep
  it private, like a password. The server stores the record under a SHA-256 of the code, never the
  code itself.

Why not sign-in (Google / Apple / email link): it means accounts, storing email addresses, a sign-in
provider and more privacy text, all for a game record. A code covers one person with a few devices,
which is the request. (See [Alternatives considered](#alternatives-considered).)

### 2. What each device keeps: `base` + `pending`

Each device keeps two objects of the same shape as today's stats:

- **`base`** — the last totals it got from the record (or, before linking, its own stats).
- **`pending`** — what it recorded since then that the record hasn't confirmed yet: a short list
  of **per-match entries**, each a delta (counts added, maxima kept) with its finish time and result
  — the hands of an abandoned match make an entry too — plus any newly earned badges. Entries keep
  their own times so a reset made on another device can drop exactly the matches before it. On a
  device that stays offline or unlinked a long time, entries past about 50 fold into one.

The Stats screen shows `merge(base, pending)`. When nothing is linked, `pending` folds straight into
`base` — the same numbers as today, from the same code path.

**Recording a hand or match** stays in `PlayerStats` with one change: it records into a fresh zero
object (that *is* the delta — `max(0, x) = x` for the max fields), then merges that into `pending`.
A new pure module `docs/js/stats/StatsMerge.js` holds `DEFAULT_STATS`, the merge rules above and
the streak calculation. It has no browser globals, so the Worker bundles the same file.

### 3. Syncing

One request does both directions:

```
POST /records/sync
{ code, deviceId, batch: { id, entries:[{ at, won, delta }, …], badges:[…] } | null }
→ { totals, badges, since, devices, syncedAt }
```

- The Worker hashes the code and passes the request to that record's Durable Object.
- The DO checks it hasn't seen `batch.id` before (so a retry after a dropped connection doesn't count
  twice), drops entries older than the record's last reset, merges the rest into the totals, inserts
  their results into the streak list, unions badges, and returns the new totals.
- The device sets `base = totals` and empties `pending`. A batch that's still being sent gets frozen
  with its id; anything recorded in the meantime starts a new `pending`.
- **When:** after each match ends, when the app opens, and when the browser comes back online
  (`online` event) if something is pending. Roughly 3 requests per match — far under the free plan's
  100,000 a day.
- **Badges from merging:** after a sync the device runs the badge checks on the merged totals. If
  the combined record crosses a threshold no single device had reached (e.g. 12 + 9 domino wins), the
  badge is earned then and goes up in the next batch. Badges arriving from another device show in the
  list with **no toast** — that device already celebrated.

### 4. Server: a `StatsRecord` Durable Object

- New SQLite-backed class `StatsRecord`, one instance per record (`idFromName(sha256(code))`),
  wrangler migration `v3`. Tables: `totals` (one JSON row), `results (at, won)`, `badges (id,
  earnedAt)`, `batches (id, device, at, receivedAt, json)` for de-duplication and debugging,
  `devices (id, firstSeen, lastSeen)` for the "3 devices" line.
- Endpoints (all `POST`, code in the body — never in the URL):
  - `/records` → `{ code }` — create a record, with the first device's stats as its first batch.
  - `/records/sync` — as above.
  - `/records/delete` — wipe the record (Stats screen: **Delete synced record**).
- **Checks before anything is stored:** body under 64 KB, every number a non-negative integer within
  sane bounds (a match entry adds one match and at most ~20 hands, a folded entry at most its own
  match count; a hand is at most a few hundred points), timestamps not in the future. A record nobody has synced for 2 years can be deleted.
- Same `ALLOWED_ORIGINS` and CORS as rooms and suggestions.

### 5. Linking a device that already has stats

| Situation | What happens |
|---|---|
| First device creates the record | Its current stats go up as the first batch (`snapshot:<deviceId>`). Its `currentStreak` seeds the record's streak. |
| Another device joins | Its stats are **added** as a `snapshot:<deviceId>` batch. Its `bestWinStreak` counts as a max; its `currentStreak` is dropped (only one streak can be the current one). |
| Fresh device joins | Nothing to add; it just downloads the totals. |
| Device unlinks | It keeps a **copy** of the record's totals as its own stats (nothing disappears from its screen) and remembers which record they came from. |
| That device re-links to the same record | Only what it played **after** unlinking goes up — its `pending` — not the copy, which would count everything twice. |
| A device with a copy joins a *different* record | Asks: "These stats came from another synced record. Add them to this one?" |

### 6. Reset stats

Reset on any linked device resets **the record**, i.e. every device (badges kept, as today). It goes
up as a reset event with its time; the server zeroes the totals, clears the streak list, sets
`since`, and drops any match entry finished **before** that time that arrives later (an offline
device catching up); its matches after the reset still count. The two-tap reset button text becomes "Tap again to reset on all linked devices".

### 7. Stats screen

- **Not linked:** "Play on more than one device? Link them and keep one record." → **Link my
  devices** · **I have a code**.
- **Linked:** "Synced across 3 devices · last synced 2 min ago" (or "waiting to sync — offline") →
  **Show code / Share** · **Unlink this device** · **Delete synced record** (two taps, like reset).
- English and Spanish strings, as everywhere.

---

## Privacy

- **Sent:** the stats totals, badges, Your signals sums, match result times, and a random device id.
  No name, no email, no game moves.
- **Not sent, unchanged:** Export my games logs (`7fichas_game_logs`) stay on the device. The hint
  "kept on this device only and never sent anywhere" stays true. Quiz history stays local too.
- The link section's hint says plainly what is stored on the server and that the code works like a
  password.
- Delete removes the whole record from the server.

---

## Risks

- **Lost code:** if every linked device is gone, the code is the only way back. The screen nudges you
  to save it (Share to yourself). No recovery without accounts — an accepted trade-off.
- **Shared code = shared record:** two people using one code get one combined record. Their choice;
  the hint says one record per person.
- **Device clocks** order the streak list and the reset cut-off. A badly wrong clock can misorder a
  streak by a match or two; the server rejects future times, which covers the worst case.
- **Free-plan daily cap:** flooding `/records` could use up the daily Durable Object requests and stop
  multiplayer rooms until 00:00 UTC. Rooms already have this exposure. The Worker rejects malformed
  requests before they reach a DO; guessing a 60-bit code isn't feasible within the cap.
- **Two tabs on one device** both write `pending` — the same last-write-wins risk as today's stats.
  Low impact; it could use the `storage` event later.
- **Free-plan storage and row-write limits** for SQLite Durable Objects: check the current limits page
  in P0. At personal scale (a few KB per record plus about 1 KB per match) it should be a rounding
  error.

---

## Phases

| Phase | What | Ships as |
|---|---|---|
| **P0** | Confirm the free-plan limits. Build `StatsMerge.js` and a test that replays self-play matches **in sequence on one device** and **split at random across 3 "devices" then merged**: every total and badge must match exactly; streaks must match when the split keeps time order. | nothing user-facing |
| **P1** | `PlayerStats` → `base` + `pending` via `StatsMerge`. No network. Stats must be identical before and after (test on a saved real stats object). | patch |
| **P2** | `StatsRecord` DO + `/records` endpoints + server tests (`server/test/stats-record.test.mjs`), `StatsSync.js` client, Stats screen UI, `#sync=` link, EN/ES strings. | minor |
| **P3** | QR code for the link, new-code ("rotate") option, delete records idle for 2 years, maybe the `storage` event for multiple tabs. | patch/minor |

---

## Alternatives considered

Decided 2026-11-25 (see **Decided** at the top). The options that weren't chosen:

1. **How devices link**
   - Sign in with Google/Apple/email link: needs accounts and email handling, and more privacy text.
   - File export/import of stats: no server, but each device has to import the others' files by
     hand, and the totals drift apart again right after. Doesn't really consolidate.
2. **What syncs**: quiz history and settings too. Left out to keep v1 small. Game logs stay local
   to keep the Export my games privacy promise.
3. **A joining device's existing stats**: drop them and take the record's totals. Rejected because
   people would lose the record they built on that device.
4. **Reset**: a reset only unlinks and restarts that device. Rejected because one shared record
   with a per-device reset would be confusing.
