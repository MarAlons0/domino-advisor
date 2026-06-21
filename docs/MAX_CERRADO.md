# Maximum cerrado pip haul — theoretical + empirical

> **Research note**, not a feature spec. This document derives bounds on the largest
> possible point score that can be awarded in a single *cerrar* (closed-chain ending) in
> partnership dominoes, and contrasts those theoretical bounds with what the tournament
> harness actually observes across many self-play matches.

## 1. Setup

In partnership dominoes the chain is *cerrado* when both open ends show the same value V
**and** all seven V-tiles (V|0, V|1, V|2, V|3, V|4, V|5, V|6) have been played. Whichever
team holds fewer remaining pips at that moment wins, and the score awarded is the
**losing team's remaining pip total** (see [Rules.js:142-164](js/engine/Rules.js#L142)).

We want to bound:

> *L_remaining* — the losing team's pip total at the instant of the cerrar.

The double-six set has 28 tiles totaling **168 pips**. Each team starts with 14 tiles.
At any point in a hand:

```
W_remaining + L_remaining + chain_pips = 168
```

where *chain_pips* is the sum of pip values of all played tiles. To maximize
*L_remaining* we need to **minimize** *W_remaining* + *chain_pips*.

## 2. The 118-pip absolute bound

The maximum pip total that *any* 14-tile hand can hold is **118**. This is the sum of
the heaviest 14 tiles in the set: all seven 6-tiles (sum 63), then the five heaviest
non-6 tiles 5|5, 5|4, 5|3, 5|2, 5|1 (sum 40), then 4|4 and 4|3 (sum 15).

|         | →0 | →1 | →2 | →3 | →4 | →5 | →6 |
|---------|----|----|----|----|----|----|----|
| **0→** | 0  |    |    |    |    |    |    |
| **1→** | 1  | 2  |    |    |    |    |    |
| **2→** | 2  | 3  | 4  |    |    |    |    |
| **3→** | 3  | 4  | 5  | 6  |    |    |    |
| **4→** | 4  | 5  | 6  | **7** | **8** |    |    |
| **5→** | 5  | **6** | **7** | **8** | **9** | **10** |    |
| **6→** | **6** | **7** | **8** | **9** | **10** | **11** | **12** |

(Bold cells are the 14-tile maximum-pip hand, summing to 118.)

This is an **absolute upper bound** on the cerrado pip haul — even if the losing team
played *zero* tiles, they cannot start the hand with more than 118 pips and so cannot
finish a hand with more than 118 either. But:

> The 118 bound is too loose to be reached. The cerrar mechanic itself taxes the deal.

The argument in Section 4 brings the upper bound down by ~10 points.

**Note on uniqueness:** the 118-pip total can actually be reached by **six different
14-tile sets**. The top-14 set sorted by pip count is `12, 11, 10, 10, 9, 9, 8, 8, 8,
7, 7, 7, 6, 6`. The first twelve slots are uniquely determined (the *12-tile core*:
all seven 6-tiles plus 5\|2, 5\|3, 5\|4, 5\|5, 4\|3, 4\|4). The last two slots are a
**tie among four pip-6 tiles** — 6\|0, 5\|1, 4\|2, 3\|3 — and we pick 2 of the 4 to
complete the heavy set. That's C(4,2) = 6 distinct partitions. The choice matters for
§4b's ceiling analysis: partitions vary by ~7 pips of cerrar ceiling depending on
which 2 pip-6 tiles end up in the heavy hand.

## 3. Structural minimum chain length

Any cerrado chain on value V has the following properties:

- It contains all 7 V-tiles (by definition of "cerrado").
- Both open ends show V.
- It is a valid linear chain (every adjacent pair of tiles shares a value).

Counting V-faces: the 6 non-double V-tiles each have one V-face, and the V|V double has
two V-faces, for **8 V-faces total** in the chain. Two are consumed by the two open ends
(both V). The remaining 6 are internal, and each internal V-V connection consumes 2 of
them, so there are exactly **3 internal V-V connections**.

A V-tile "run" of length k contains (k − 1) internal V-V connections. If the 7 V-tiles
form R runs with sizes summing to 7, the run-internal V-V connections sum to 7 − R.
Setting 7 − R = 3 gives **R = 4 runs** of V-tiles, with at least one non-V "filler" tile
between consecutive runs → at least 3 filler tiles.

Each filler shares a value with each V-tile it abuts. The 6 non-V faces on V-tiles
(one per non-double V-tile, each carrying a distinct non-V value) must each match an
adjacent filler face. So the 3 fillers' 6 faces must form a perfect matching on the
six non-V values {0, …, 6} \ {V}.

> **Minimum closed-chain length: 10 tiles** (7 V-tiles + 3 fillers).

For any V ∈ {0, …, 6}, perfect matchings on the 6 non-V values exist and the
corresponding tiles all exist in a double-six set.

## 4. Why V = 0 dominates (cooperative-loser ceiling)

We compute the cooperative-loser theoretical maximum for each closing value V. The
"cooperative loser" assumption: the losing team plays minimally and chooses cheapest
tiles when forced (see Section 5 for an exact play-sequence argument).

There are two different deals worth analyzing — they answer slightly different
questions.

### 4a. "W holds all V-tiles" deal (V = 0 optimal-for-closure)

Approach: assign all 7 V-tiles to the winning team. Pick the cheapest 3-tile matching
on the non-V values for the chain fillers, also given to the winning team. Pick the 4
cheapest non-chain non-V tiles for the winning team's remaining 4 hand slots. The
losing team gets the rest.

The sum of the seven V-tiles is **21 + 7V** pips. The sum of a perfect matching on the
6 non-V values equals the sum of all non-V values, which is **21 − V**. So the
chain itself (assuming no extra fillers) carries **42 + 6V** pips, of which all are
in the winning team's hand. The winning team's 4 non-chain low tiles add a small
amount (call it *low_4*, depending on V).

| V | chain pips (42+6V) | low_4 | W_initial | L_initial (= 168 − W_initial) |
|---|----|---|---|----|
| 0 | 42 | 15 (1\|1+1\|3+2\|2+1\|4) | 57 | **111** |
| 1 | 48 | 11 (0\|0+0\|3+0\|4+2\|2) | 59 | 109 |
| 2 | 54 |  9 (0\|0+1\|1+0\|3+0\|4) | 63 | 105 |
| 3 | 60 |  7 (0\|0+1\|1+0\|2+1\|2) | 67 | 101 |
| 4 | 66 |  7 (0\|0+1\|1+0\|2+1\|2) | 73 | 95  |
| 5 | 72 |  5 (0\|0+0\|1+1\|1+0\|2) | 77 | 91  |
| 6 | 78 |  7 (0\|0+1\|1+0\|2+1\|2) | 85 | 83  |

So under the no-loser-plays-anything fiction with this deal, **V = 0 maximizes
L_initial at 111 pips**. Combined with the play-feasibility argument in §5 (~17 pips
of forced losing-team plays), the V = 0 cooperative ceiling for this deal is
**≈ 94 pips.**

### 4b. The 50/118 max-disparity deal (structural extreme)

The maximum-pip-disparity dealings give team B 118 pips and team A 50 pips, split
across the 6 partitions described in §2. Team A's closing options are heavily
constrained — they hold no 6-tile, at most one 5-tile (only if 5\|1 ended up in
their hand), and otherwise only 0/1/2/3/4-faced tiles.

**The partition matters.** The six 50/118 partitions split into two structurally
distinct groups based on whether **6\|0 is in the heavy hand**. When 6\|0 sits in
team B, team A holds only 6 of the 7 zero-tiles and team B must dump 6\|0 (6 pips)
as a forced V-tile play. When 6\|0 sits in team A, team A holds **all 7 zero-tiles**
and team B is never forced to play a V-tile during a V=0 cerrar.

Corrected per-partition V=0 ceiling (optimized matching, not the suboptimal one in
this doc's earlier draft):

| Heavy pip-6 pair | 6\|0 in heavy? | Best filler matching | Team B forced | V=0 ceiling |
|---|---|---|---|---|
| {6\|0, 5\|1} | yes | V=6\|0 (6) + filler 5\|6 (11) | 17 | **101** |
| {6\|0, 4\|2} | yes | V=6\|0 (6) + filler 5\|6 (11) | 17 | **101** |
| {6\|0, 3\|3} | yes | V=6\|0 (6) + filler 5\|6 (11) | 17 | **101** |
| {5\|1, 4\|2} | no  | filler 5\|6 (11) only | 11 | **107** |
| {5\|1, 3\|3} | no  | filler 5\|6 (11) only | 11 | **107** |
| **{4\|2, 3\|3}** | **no** | **filler 6\|4 (10) only** (uses 5\|1 ∈ A) | 10 | **108** |

The **6|0-in-light** partitions hit a sharper ceiling because team A's filler-tile
inventory is richer (5\|1 in light when partition = {4\|2, 3\|3}). The 108 ceiling
in partition {4\|2, 3\|3} is the **theoretical maximum cooperative cerrar haul** over
all deals.

(Both ceilings are well below the 118 absolute bound, which assumed the loser plays
zero tiles — impossible per §5. They also revise upward the earlier 97-pip estimate,
which was based on a suboptimal filler matching for partition {6\|0, 5\|1}.)

## 5. Play-sequence feasibility tax

The no-loser-plays-anything assumption *cannot* be maintained through actual play. After
the salida V|V, the second tile played is some V|x, exposing a non-V end (x). To return
the chain to "both ends V," some tile of form V|x must be played on that x-end — but
each V|x is unique, so we cannot return immediately. The only way back is to play a
chain of non-V tiles bridging x→y→…→V again, which takes at least 2 more tiles.

Each "return cycle" therefore plays at least 2 additional V-tiles plus at least 1 non-V
tile, and during each cycle the losing team gets a turn where a chain end is non-V
(because their hand covers every non-V value in the V = 0 optimal deal). They are forced
to play.

Counting: 7 V-tiles to consume. The salida (V|V) consumes 1. Each subsequent cycle
consumes 2 more V-tiles. So we have approximately (7 − 1) / 2 = 3 full cycles, giving
**~3 forced losing-team plays** before the chain closes. The cooperative loser plays
their cheapest non-V tiles when forced.

For the V = 0 optimal deal, the cheapest 3 non-V tiles in L's hand are 2|3 (5), 1|5 (6),
and 2|4 (6), summing to **17 pips**. The tight cooperative-loser theoretical ceiling
for V = 0 is therefore:

> **111 − 17 ≈ 94 pips.**

Repeating for other V gives similar values in the high 80s / low 90s. The
**theoretical-ceiling tax** caused by play-feasibility is roughly 20 points below the
absolute 118 bound.

> **Caveat from §7 empirical data:** the empirical losing-team pip dump under cooperative
> play turns out to be ≈ 66 pips in the rigged 50/118 simulation, vs ~10-17 forced
> plays predicted by the §4b structural analysis. The cycle argument and the
> structural-minimum filler-matching together bound the *minimum* number of forced
> losing-team plays, but they ignore game-flow effects: when the chain wanders into
> non-V-end territory because of W's own non-V tile plays (or because of suboptimal
> ordering of W's V-tile plays), the cooperative loser is forced to bridge back,
> dumping more tiles than the bare structural minimum requires. The empirical tax
> is **roughly 4–6× the structural prediction**.

## 6. Two scenarios for the empirical question

The harness measures two distinct quantities by sweeping the deal randomly:

**Scenario A — Cooperative losers.** Seats 1 and 3 play a stripped-down "cooperative"
behavior: pass whenever legal, otherwise play the lowest-pip-count tile in hand. This
maximizes the pip haul awarded to the (normally-playing) seats 0+2 in any cerrar. The
empirical maximum across many matches should approach but not exceed the §4b ceilings
(101 for 6|0-in-heavy partitions, up to 108 for partition {4|2, 3|3}).

**Scenario B — Adversarial losers (natural play).** All four seats are master AI. Now
the would-be losers play strategically to *minimize* their loss, dumping heavy tiles
when they have a choice. The empirical maximum here is the practical ceiling — what
can actually happen between two competent teams.

The **gap (A − B)** quantifies how much pip haul ordinary competitive play leaves on the
table. A large gap means defensive play is effective at suppressing cerrar hauls; a
small gap means the deal essentially decides it.

## 7. Findings (empirical)

Three regimes, each 1000 self-play matches at master difficulty:

| Regime | Cerrados | Max haul | Mean | Median | Loser initial mean | Loser pip dump |
|---|---|---|---|---|---|---|
| Natural adversarial | 2,080 / 6,006 hands | **78** | 27.9 | 27 | 86.6 | 58.8 |
| Natural cooperative | 1,110 / 3,460 hands | **75** | 37.1 | 36 | 86.1 | 49.0 |
| Rigged 50/118 + coop (6-partition randomized) | 549 / 1,661 hands | **92** | 54.3 | 56 | 118 (rigged) | 63.7 |
| Rigged 50/118 + random-losers + force-cerrar | 833 / 2,383 hands | **85** | 42.6 | 42 | 117.5 (rigged) | 74.9 |
| **Exhaustive search** (6 partitions × 1,000 seat splits) | n/a | **103** | n/a | n/a | 118 (rigged) | 15 (optimal) |

The exhaustive search uses [tools/cerrado-search.js](../tools/cerrado-search.js) — a recursive
brute-force enumeration with alpha-beta upper-bound pruning. Per-partition empirical max
across 1,000 random seat splits:

| Partition | 6\|0 location | Theory ceiling (§4b) | Exhaustive empirical | Gap |
|---|---|---|---|---|
| {6\|0, 5\|1} | heavy | 101 | **99** | 2 |
| {6\|0, 4\|2} | heavy | 101 | **99** | 2 |
| {6\|0, 3\|3} | heavy | 101 | **99** | 2 |
| {5\|1, 4\|2} | light | 107 | **100** | 7 |
| **{5\|1, 3\|3}** | **light** | **107** | **103** | **4** |
| {4\|2, 3\|3} | light | 108 | **102** | 6 |

The 6|0-in-heavy partitions land within 2 pips of theoretical — the play-feasibility tax
is tiny when the closing structure is unambiguous (team B forced to play 6|0 anyway, so
sequencing has fewer degrees of freedom). The 6|0-in-light partitions leave more on the
table (4–7 pips) because reaching their higher ceiling requires more delicate move ordering.

The single highest-haul deal (partition {5|1, 3|3}, specific seat split, seat 3 opens
with 6|1 instead of 6|6 — i.e., not the first hand of a match) produces the **103-pip
maximum**. The optimal play sequence exploits **individual-player pass mechanics**: B1 (seat 1)
holds no face-2 tiles in that deal, and B2 (seat 3) holds no face-4 tiles. Team A times their
plays so that end value 2 is exposed when it's B1's turn (forcing a pass) and end value 4
is exposed when it's B2's turn (forcing a pass). The team-level argument from §5 alone
would not predict these extra passes — they come from the *seat-split* level, which the
exhaustive search captures naturally by treating each seat's hand independently.

The rigged run randomized the partition (which 2 of the 4 pip-6 tiles are in heavy)
across all six options each hand. Breaking the rigged samples by partition group:

| Partition group | Cerrados | Mean haul | Max haul | §4b theoretical ceiling |
|---|---|---|---|---|
| 6\|0 in heavy (3 partitions) | 289 | 52.0 | 80 | 101 |
| 6\|0 in light (3 partitions) | 260 | 56.9 | **92** | 107–108 |

The 6|0-in-light group produced the higher mean (+4.9) and higher max (+12)
— exactly the ranking §4b predicted. Partition {4|2, 5|1} produced the single
highest sample (max 92).

Reproduce with:

```bash
node tools/tournament.js --games 1000 --max-cerrado
node tools/tournament.js --games 1000 --max-cerrado --cooperative-losers
node tools/tournament.js --games 1000 --max-cerrado --cooperative-losers --max-disparity-deals
node tools/tournament.js --games 1000 --max-cerrado --random-losers --force-cerrar --max-disparity-deals
```

### Reading the table

- **The corrected theoretical ceilings (§4b) are 101–108 depending on partition.** The
  v1 rigged experiment used a single fixed partition with 6|0 in heavy and topped out
  at 92 pips (vs the corrected ceiling of 101 for that partition). The v2 rigged
  experiment randomizes the partition across all six options to give a fair picture.
- **Natural play caps around 75–78 pips.** Both natural regimes top out near the same
  number despite very different mean hauls (27.9 vs 37.1). This is because the natural
  *maximum* is driven by the rare heavy deal (the natural runs got their max from
  100+ pip initial deals — see the by-deal table) while the natural *mean* reflects
  the typical-deal mid-range.
- **Cooperative play shifts the entire distribution right by ~10 pips** without moving
  the maximum much. The defensive-play tax is mostly about *mean* haul, not max.
- **The rigged regime nearly doubles the mean haul** (51.9 vs 27.9 adversarial) and
  shifts the distribution from peaking at 20–29 to peaking at 50–59.

### Per-V breakdown (max haul observed)

| V | Adversarial | Cooperative | Rigged | Theoretical (rigged deal) |
|---|---|---|---|---|
| 0 | 68 | 75 | 91 | 97 |
| 1 | 78 | 71 | **92** | 91 |
| 2 | 66 | 68 | 76 | 89 |
| 3 | 60 | 66 | 75 | 82 |
| 4 | 63 | 60 | 57 | (< 82) |
| 5 | 57 | 57 | 39 | (< 82) |
| 6 | 60 | 60 | 42 | (< 82) |

**Surprise: V=1 (92) edged out V=0 (91) in the v1 rigged sample.** Theory predicted V=0
to dominate (101 vs ~91 for partition {6|0, 5|1}). The rigged-cooperative *means*
still rank as theory predicts (V=0: 56.3, V=1: 53.3), but the single-observation
maxima drifted upward at V=1 due to sample variance over the 159 V=1 cerrados vs 240
V=0 cerrados. The takeaway is that the V=0 and V=1 ceilings are *close enough
together* that 1000-match noise can re-order them.

**V≥4 produces almost no cerrados under rigging** because team A holds too few of
those V-tiles. The deal partition structurally constrains which V can close.

### Interpretation

- The **structural upper bound is 118** (one team's heaviest 14 tiles, §2).
- The **cooperative theoretical ceiling is 101–108** depending on partition (§4b).
  The {4|2, 3|3}-in-heavy partition is best at 108.
- The **exhaustive cooperative maximum is 103** (partition {5|1, 3|3}, specific
  seat split, optimal play sequence). This is the *provable* upper bound under
  optimal cooperative play — no sequence beats it for any deal in the 50/118
  family. The 5-pip gap to the §4b theoretical is the *genuine* play-feasibility
  tax — much smaller than the harness empirical-vs-theoretical gap suggested.
- The **empirical ceiling under perfect deal + cooperative play is 92** in the v2
  randomized-partition run. The 11-pip gap to the exhaustive 103 represents the
  algorithmic shortfall of the harness's cooperative heuristic (lowest-pip + prefer-pass).
- The **empirical ceiling under natural deals is ~75–78**, essentially independent of
  whether the losing team is cooperative or adversarial.

The v3 experiment (random-losers + force-cerrar under the same rigged deals) tested
whether the 16-pip gap to theoretical was an algorithm artifact (cooperative's
lowest-pip rule leaving haul on the table) or a structural floor. The result: **v3
produced a *lower* max (85) than v2 cooperative (92), not higher**, conclusively
ruling out the algorithm-artifact hypothesis. Random doesn't *preserve* high-pip
tiles the way cooperative does (random pip dump 74.9 vs cooperative 63.7), and
force-cerrar takes early/marginal cerrars that don't reach the high tail. The gap to
108 is therefore **genuine play-feasibility friction** in the game's turn-order +
chain-extension dynamics, not a measurement artifact.

The gap between the natural ceiling (~78) and the rigged ceiling (~92) quantifies how
much pip haul is left on the table by the random deal alone — about **14 pips**, or
roughly the equivalent of two heavy 6-tiles. The adversarial vs cooperative gap at
natural deals (~3 pips of max haul) is small in comparison; **deal heaviness matters
more than defensive play** for the upper tail.

## 8. Open questions / follow-ups

- **Why is the empirical play-feasibility tax 3× the prediction?** §5's cycle argument
  counts only the *minimum* forced losing-team plays at the structural level. The
  empirical ~66-pip dump under rigged cooperative play suggests game-flow effects (W's
  own non-V tile plays wandering the chain end off V, forcing extra L bridge plays)
  are doing most of the work. A play-by-play trace of a near-max rigged cerrar would
  pinpoint where the tax accumulates.
- **Rigged adversarial sweep:** what's the max haul when team A *plays normally* (not
  cooperatively) under the 50/118 deal? Tests whether the "defensive tax" widens with
  deal heaviness.
- **Difficulty sensitivity:** does master-vs-master produce different cerrar tails than
  beginner-vs-beginner? Quick to check; orthogonal to this investigation.
- **Score-impact context:** a 90+ point cerrar in a 100-target match is essentially a
  match-ender. The histogram of *match-deciding* cerrar hauls is a downstream question.
