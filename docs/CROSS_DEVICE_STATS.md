# Consolidated record across devices — Design

**Status:** design agreed 2026-11-25. P0 and P1 done 2026-11-25, shipped in v1.21.2: `StatsMerge.js`,
and `PlayerStats` recording through it. P2 built 2026-11-26: the `StatsRecord` Durable Object,
`StatsSync.js` and **Your devices** on the Stats screen (see [P0 results](#p0-results-2026-11-25),
[P1 results](#p1-results-2026-11-25), [P2 results](#p2-results-2026-11-26)). Next: deploy the
Worker, then release P2 as v1.22.0. Backlog: 🟡 Medium "Consolidated record across devices".

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
| `since` | set by the record: the last reset, or the earliest start among the devices that linked |
| `currentStreak`, `bestWinStreak` | **can't be added** — depend on the order of wins and losses across devices (below); worked out again from the results on every change, never kept as a running max |

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
- **`pending`** — what it recorded since then that the record hasn't confirmed yet: a list of
  **entries**, one per thing recorded — a hand, its suit signals, a match's coaching data, a match
  result — each a delta (counts added, maxima kept) with its time, and the result for a match
  result. Plus any newly earned badges. (P1 changed this from one entry per match: with one per
  thing recorded there's no open match entry to close when a match is abandoned or the app reloads
  mid-match, and a reset in the middle of a match splits exactly as it does today.) Entries keep
  their own times so a reset made on another device can drop exactly what came before it. About
  10–15 entries a match; sent with their zero fields dropped. On a device that stays offline a long
  time, entries past a few hundred fold into one.

The Stats screen shows `merge(base, pending)`. When nothing is linked, `pending` folds straight into
`base` — the same numbers as today, from the same code path.

**Recording a hand or match** stays in `PlayerStats` (same methods, same callers) with one change,
made in P1: each method writes into a fresh zero object (that *is* the delta — `max(0, x) = x` for
the max fields), and `StatsMerge.addEntries` adds it to the device's record. Unlinked, that record
is the saved `7fichas_stats`, as today. In P2, a linked device also keeps the entries in `pending`.
The pure module `docs/js/stats/StatsMerge.js` (built in P0) holds `DEFAULT_STATS`, the merge rules
above and the streak calculation: `addStats`, `mergeBadges`, `streaks`, and for a record
`emptyRecord`, `recordFrom(base)` (base + pending, for the screen), `addSnapshot`, `addEntries`,
`resetRecord`. It has no browser globals, so the Worker bundles the same file.

### 3. Syncing

One request does both directions:

```
POST /records/sync
{ code, device, leave?, batch: { id, entries:[{ at, won, delta }, …], badges:[…], reset, snapshot } | null }
→ { totals, resetAt, devices, syncedAt }
```

(As built in P2: `totals` carries the badges and `since`; `snapshot` is the device's own stats as it
links, `reset` a Reset stats made on it, `leave` an unlinking device.)

- The Worker hashes the code and passes the request to that record's Durable Object.
- The DO checks it hasn't seen `batch.id` before (so a retry after a dropped connection doesn't count
  twice), drops entries older than the record's last reset, merges the rest into the totals, inserts
  their results into the streak list, unions badges, and returns the new totals.
- The device sets `base = totals` and empties `pending`. A batch that's still being sent gets frozen
  with its id; anything recorded in the meantime starts a new `pending`.
- **When:** after each match ends, when the app opens, when the browser comes back online
  (`online` event), right after a Reset stats, and — if the last sync was a while ago — when the app
  comes back to the foreground (1 min) or the Stats screen opens (30 s). Roughly 3 requests per
  match — far under the free plan's 100,000 a day.
- **Badges from merging:** after a sync the device runs the badge checks on the merged totals. If
  the combined record crosses a threshold no single device had reached (e.g. 12 + 9 domino wins), the
  badge is earned then and goes up in the next batch. Badges arriving from another device show in the
  list with **no toast** — that device already celebrated.

### 4. Server: a `StatsRecord` Durable Object

- New SQLite-backed class `StatsRecord`, one instance per record (`idFromName(sha256(code))`),
  wrangler migration `v3`. Tables:
  - `record` — **one JSON row**: the `StatsMerge` record (totals with badges, the results list,
    the streak seeds, the last reset). One row keeps a sync to a few rows read however long the
    history is (the free plan counts every row read); at ~20 bytes a match the results fit the
    8 MB row limit for hundreds of thousands of matches.
  - `batches (id, device, received_at, with_matches, json)` — every batch as received: its entries
    with their times, its reset, and the device's stats if it brought them as it linked (its
    snapshot, dated when it arrived). For de-duplication (`id`) and **rebuilding after a late
    reset** (§6). `with_matches` marks a snapshot with matches in it (§5). (The design had a
    separate `snapshots` table; P2 keeps each snapshot in its batch.)
  - `devices (id, first_seen, last_seen)` for the "3 devices" line.
- Endpoints (all `POST`, code in the body — never in the URL):
  - `/records` → `{ code }` — create an empty record. The device then sends its stats in its first
    sync, as a batch like any other, so a retry can't count them twice.
  - `/records/sync` — as above. `404` if there's no record with that code.
  - `/records/delete` — wipe the record (Stats screen: **Delete synced record**). The other devices
    learn on their next sync (`404`), unlink and keep the stats they show.
- **Checks before anything is stored:** body under 64 KB, every number non-negative and finite
  within sane bounds (an entry adds at most one match and only a match result does, at most 200
  hands for a folded entry), keys plain names, at most 300 numbers an entry or snapshot. Times later
  than the server's clock (a device clock running ahead) are **capped** at it, not refused. A code
  nobody made leaves nothing stored. A record nobody has synced for 2 years can be deleted (P3).
- Same `ALLOWED_ORIGINS` and CORS as rooms and suggestions.

### 5. Linking a device that already has stats

| Situation | What happens |
|---|---|
| First device creates the record | Its current stats go up as the snapshot in its first batch. The first snapshot **with matches in it** seeds the record's current streak and `since` — so a fresh phone creating the record doesn't take that place from the laptop that joins with a streak running. |
| Another device joins | Its stats are **added** as the snapshot in its first batch. Its `bestWinStreak` counts as a max; its `currentStreak` is dropped (only one streak can be the current one). |
| Fresh device joins | Nothing to add; it just downloads the totals. |
| Device unlinks | It keeps a **copy** of the record's totals as its own stats (nothing disappears from its screen) and remembers which record they came from. |
| That device re-links to the same record | Only what it played **after** unlinking goes up — its `pending` — not the copy, which would count everything twice. |
| A device with a copy joins a *different* record | Asks: "These stats came from another synced record. Add them to this one?" |

### 6. Reset stats

Reset on any linked device resets **the record**, i.e. every device (badges kept, as today). It goes
up as a reset event with its time; the server zeroes the totals, clears the streak list, sets
`since`, and drops any match entry finished **before** that time that arrives later (an offline
device catching up); its matches after the reset still count. The two-tap reset button text becomes "Tap again to reset on all linked devices".

The reset itself can arrive late, from a device that reset while offline after other devices had
already synced matches played **after** it. So the server rebuilds: `resetRecord`, then adds back
every stored entry and snapshot dated after the reset (`batches`), and empties what came before it
from the stored batches (their ids stay, so a retried batch still counts once). A reset older than
the record's last one changes nothing. The P0 and P2 tests cover both orders.

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
- **Streak badges can come early.** While a device is offline, the others can't see its losses, so a
  streak looks longer until it syncs. A `win_streak_*` badge earned in that gap stays: badges are never
  taken back. The streak **numbers** always settle to the true values once everything has synced. Only
  streak badges can be affected — every other badge reads totals that only grow (P0 test).
- **Free-plan limits** (confirmed in P0, below): a sync writes about 5 rows and reads about 3, so
  the 100,000 rows written a day allow roughly 20,000 syncs a day; storage is a few KB per record plus
  about 1–2 KB per match against 1 GB per object and 5 GB per account. A rounding error at personal
  scale.

---

## P0 results (2026-11-25)

### Free-plan limits

From Cloudflare's [Durable Objects pricing](https://developers.cloudflare.com/durable-objects/platform/pricing/)
and [limits](https://developers.cloudflare.com/durable-objects/platform/limits/) pages (updated
2026-11-13) and [Workers limits](https://developers.cloudflare.com/workers/platform/limits/)
(2026-11-25):

| Free plan | Limit |
|---|---|
| Durable Object requests | 100,000 a day |
| Durable Object duration | 13,000 GB-s a day |
| SQLite rows read / written | 5 million / 100,000 a day |
| SQLite stored data | 5 GB per account; 1 GB per object (the limits page's FAQ; its table says 10 GB without naming the plan) |
| One row, string or BLOB | 8 MB; one SQL statement 100 KB |
| Worker requests | 100,000 a day; 10 ms CPU per request |
| Over a daily limit | further operations of that type fail until 00:00 UTC |

The pricing page puts the start of storage billing for SQLite-backed objects in January 2026 (no
earlier than the 7th). At a few KB per record it doesn't matter here. The rows-per-sync figures
under Risks are estimates for the P2 schema, not measured yet.

### The test

`server/test/stats-merge.test.mjs`, part of `npm test` in `server/`. It plays 40 seeded self-play
matches (all seats Beginner; `STATS_MATCHES=200` passes too) and adds made-up Genín grades, quizzes,
questionable plays and suit signals so every stat moves; about one match in seven is abandoned (hands
count, the match doesn't). Then:

1. **Three devices that sync at random times** (three seeds) end with the same record as one device:
   every number equal (Your signals within float rounding), streaks included, and every badge one
   device would earn. Each device's screen shows the same once it has synced.
2. **Arrival order** doesn't matter: the same matches folded in three shuffled orders give the same
   totals.
3. **Reset on one device**, synced at once or arriving late, with older matches from offline devices
   arriving after it: the same as one device that reset then; badges from before are kept.
4. **Devices with stats from before linking:** everything but the streaks equals one device; the
   streaks follow §5.
5. Unit checks: streaks, badge dates, unknown future fields, an old reset.

Planted bugs each make tests fail: adding a "largest" instead of keeping the max, a loss that doesn't
break the streak, a reset that keeps older matches, a badge that takes the later date.

### Findings

- **Fixed — the best streak can't be a running max.** With one device offline, the record can hold
  wins without the losses between them (wins on the phone sync, the laptop's losses come later). A
  running max kept that too-long streak forever (the test caught 5 against a true 4). Both streaks
  are now worked out again from all the results on every change, plus the best streak any device
  brought when it linked (`bestSeed`).
- **Streak badges can come early** (above, Risks). Accepted.
- **A late reset needs the stored matches and snapshots** with their times, so the server can add back
  what came after it (§4, §6).
- **One row for the record**, so the free plan's rows-read count doesn't grow with the history (§4).
- `DEFAULT_STATS` moved from `PlayerStats.js` to `StatsMerge.js` (identical; `PlayerStats` imports
  it). No change in play or stats; the app loads and the Stats screen works.
- Under the current rules a hand is never `blocked` or tied: four passes means the chain is closed,
  and the closer wins a tie on pips. Those counters stay at 0.

---

## P1 results (2026-11-25)

`PlayerStats` now records through `StatsMerge`: each method (`recordHandResult`, `recordStyleHand`,
`recordCoachingData`, `recordMatchResult`) fills a zero delta and adds it as an entry. Its callers
(`main.js`, `StatsUI`) and the saved `7fichas_stats` are unchanged: no migration, and an older
cached copy of the app still reads the same object.

### The test

`server/test/player-stats.test.mjs`, part of `npm test`. A frozen copy of the v1.21.1 recorder
(`server/test/fixtures/PlayerStats-v1.21.1.mjs`) and today's play the same 40 matches, with a reset
a third of the way in and an app reload in the middle of a match two thirds in. They start from:
nothing saved; a stats object the app really saved (`fixtures/stats-saved.json`); and an older saved
shape, from before Your signals and the newer cerrado and coaching fields. Right after loading and
after **every** match, all numbers must be equal, the badges equal **with their dates**, and the
saved object the same as what the screen shows. Also: the streaks follow the matches in the order
played even when the device clock goes back, and `get()` keeps returning the same object (the Stats
screen holds it).

The trace (shared with P0's test, `server/test/helpers/stats-trace.mjs`) gained two made-up
matches. Beginner self-play never came back from 80 down, so the comeback stat and badge were never
tested: one win from 75 down (not a comeback) and one from 95 down.

Ten planted bugs, six in the recorder and four in `StatsMerge`, each make tests fail. Two only
failed after the test compared after every match: loading an older shape without filling in its
missing fields (the first hand recorded fills them with zeros, which hid it), and the comeback
threshold (hidden behind the larger comeback).

### Findings

- **Entries per thing recorded, not per match** (§2): simpler, and exact around resets and
  reloads.
- **Entry times never go backwards on a device:** each entry gets at least the last one's time + 1
  ms, so a clock moved back can't reorder the streak. The old recorder counted in order of play
  too.
- **Adding a delta fills in missing fields**, so a saved object of an older shape repairs itself on
  the first hand, besides the defaults filled in at load.
- **Your signals sums** can differ from the old recorder in the last digit of a float: a hand's
  sum is added at once instead of signal by signal. Invisible on the Stats screen.
- **In the app:** a full match played through the app's own handlers (timers sped up from the
  console, the person's moves made by script) recorded 7 hands (2 won, 5 lost), the loss, the
  streak 2 → 0 with the best staying 2, the Genín grades and the signals. Saved equals shown, the
  Stats screen after a reload shows the new totals, and there were no console errors.
- **Shipping:** `StatsMerge.js` is a new file, so a returning visitor's service worker can't serve
  a stale copy of it. A cached v1.21.1 `PlayerStats.js` stands alone (its defaults are inline). The
  `domino-rooms` Worker doesn't import either, so it needs no redeploy.

---

## P2 results (2026-11-26)

**Server:** `server/src/StatsRecordStore.js` (the checks and the record, pure logic over SQL like
`SuggestionStore`, merging with the app's own `StatsMerge.js`), `StatsRecord.js` (the Durable
Object), `records.js` (the `/records` routes). `wrangler.toml` adds the `RECORDS` binding and
migration `v3`. **App:** `docs/js/stats/StatsSync.js` (the code, what's unsent, the requests),
`PlayerStats.attachSync` (a linked device shows the record's totals plus what isn't confirmed yet),
`docs/js/ui/SyncUI.js` (**Your devices** on the Stats screen), the wiring in `main.js` and 45 strings
in English and Spanish.

### The test

`server/test/stats-record.test.mjs`, 15 tests, part of `npm test` (59 in all). Each "device" is the
app's own `PlayerStats` + `StatsSync` + badge checks (as `main.js` wires them) with its own storage,
talking to the real `/records` routes through a fake Durable Object namespace on Node's SQLite, on
one shared clock. A device's network can be up, down, lose the answer after the server applied the
batch, or fail once. They replay the self-play trace and compare with one device that played
everything:

- three devices that sync now and then, lose answers and reload: the same totals, streaks and badges
  as one device;
- linking adds what each device had; the first device's current streak keeps running;
- a reset synced at once and one arriving late; a reset made while a batch is on its way;
- a lost answer counts once; a long offline backlog goes up in parts;
- unlink keeps a copy; linking to the same record again sends only what came since; switching to
  another record; delete; a code nobody made; joining with no answer;
- a badge earned only from the combined record;
- the server's checks: what's refused, times capped, the same batch twice, leaving, origin and CORS;
- `stripStats` and `foldEntries`.

Also passing with 60 and 120 matches in the trace (`STATS_MATCHES`). Sixteen planted bugs, each
caught.

### In the browser

`wrangler dev` with the app served locally, two browser origins as two devices (one in Spanish):
an unlinked device makes no requests; **Link my devices** gave a code; opening `#sync=<code>` on the
other opened Stats with the question and cleared the link from the address bar; joining added
5 + 5 matches and 33 + 40 hands, and earned a badge neither device had (with no toast); a full match
played through the app's handlers went up at match end in one request; a reset on either device
reached the other, kept the badges and set the same "counting since"; unlink, a mistyped code, an
unknown code, linking again to the same record ("Linked: 2 devices"), and **Delete synced record**
(the other device then says so and keeps its stats) all behaved. No console errors apart from the
two expected `404`s.

### Changes from the design

- **Create, then sync.** `/records` makes an empty record; the device's stats go up in its first
  sync as a normal batch with a `snapshot` (§4).
- **Snapshots live in their batches**, no `snapshots` table (§4).
- **The first snapshot with matches** seeds the current streak and `since`, not simply the creating
  device (§5).
- **Times are capped, not refused** (§4).
- **A long offline backlog:** past 500 unsent entries they fold to one a match (hands with no result,
  100 at a time), and go up 250 entries / about 40 KB a request, at most 20 requests a sync.
- **A batch the server refuses** (`400`) is dropped and logged, so a device can't get stuck resending
  it. A `404` means the record was deleted: the device unlinks and keeps its stats.
- **Reset syncs at once** instead of waiting for the next match (§3).
- **Known limit:** when a reset arrives late, a badge other than the streak ones may already have
  been earned from matches the reset then took out. It stays, as badges always survive a reset.

---

## Phases

| Phase | What | Ships as |
|---|---|---|
| **P0** ✅ 2026-11-25 | Confirm the free-plan limits. Build `StatsMerge.js` and a test that replays self-play matches **in sequence on one device** and **split at random across 3 "devices" then merged**: every total and badge must match exactly; streaks must match when the split keeps time order. | nothing user-facing |
| **P1** ✅ 2026-11-25 (v1.21.2) | `PlayerStats` records through `StatsMerge` entries. No network. Stats must be identical before and after (test on a saved real stats object). Keeping `pending` for a linked device comes with P2. | patch |
| **P2** ✅ 2026-11-26 (to ship as v1.22.0, after the Worker deploy) | `StatsRecord` DO + `/records` endpoints + server tests (`server/test/stats-record.test.mjs`), `StatsSync.js` client, Stats screen UI, `#sync=` link, EN/ES strings. | minor |
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
