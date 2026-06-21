// Exhaustive search for the maximum cerrar pip haul reachable on a single
// fixed deal. The deal is set up with a specific intra-team seat assignment
// (which 7 of team A's 14 tiles go to seat 0 vs seat 2; same for team B), and
// the search recursively explores every legal play sequence, treating both
// teams as cooperatively maximizing the eventual losing-team pip total at
// cerrar. Used to put a hard ceiling on the friend's "118 pips is achievable"
// claim and to compare against the harness empirical max of 92.
//
// Usage:
//   node tools/cerrado-search.js                   # default deal + partition
//   node tools/cerrado-search.js --partition N     # 0..5 (which 2 of 4 pip-6 in heavy)
//   node tools/cerrado-search.js --sweep K         # K random seat splits per partition
//   node tools/cerrado-search.js --verbose         # print every search progress update

globalThis.window = { location: { search: '' } };
globalThis.localStorage = { getItem: () => null, setItem: () => {} };
globalThis.document = { querySelectorAll: () => [], documentElement: { lang: 'en' } };

const { Tile } = await import('../docs/js/models/Tile.js');
const { Hand } = await import('../docs/js/models/Hand.js');
const { Chain } = await import('../docs/js/models/Chain.js');
const { Rules } = await import('../docs/js/engine/Rules.js');

// ─── Partition definitions ──────────────────────────────────────────────────
// Six 50/118 partitions distinguished by which 2 of the 4 pip-6 tiles are heavy.
const PIP6 = [[6,0],[5,1],[4,2],[3,3]];
const CORE = [
    [6,1],[6,2],[6,3],[6,4],[6,5],[6,6],
    [5,2],[5,3],[5,4],[5,5],
    [4,3],[4,4],
];
const FIXED_LIGHT = [
    [0,0],[0,1],[0,2],[0,3],[0,4],[0,5],
    [1,1],[1,2],[1,3],[1,4],
    [2,2],[2,3],
];
function partitionLabel(idx) {
    // 0: {6|0,5|1}  1: {6|0,4|2}  2: {6|0,3|3}  3: {5|1,4|2}  4: {5|1,3|3}  5: {4|2,3|3}
    const heavyIdxs = [[0,1],[0,2],[0,3],[1,2],[1,3],[2,3]][idx];
    return heavyIdxs.map(i => `${Math.max(PIP6[i][0], PIP6[i][1])}|${Math.min(PIP6[i][0], PIP6[i][1])}`).join(',');
}
function buildPartitionHands(idx) {
    const heavyIdxs = [[0,1],[0,2],[0,3],[1,2],[1,3],[2,3]][idx];
    const lightIdxs = [0,1,2,3].filter(i => !heavyIdxs.includes(i));
    const heavy = [...CORE, ...heavyIdxs.map(i => PIP6[i])];
    const light = [...FIXED_LIGHT, ...lightIdxs.map(i => PIP6[i])];
    return { heavy, light };
}

// ─── Deep clone helpers ─────────────────────────────────────────────────────
function cloneChain(chain) {
    const c = new Chain();
    c.placedTiles = chain.placedTiles.map(p => ({ ...p }));
    c.leftEnd = chain.leftEnd;
    c.rightEnd = chain.rightEnd;
    c.firstTileIndex = chain.firstTileIndex;
    return c;
}
function cloneHand(hand) {
    const h = new Hand();
    h.tiles = [...hand.tiles];
    return h;
}
function cloneState(s) {
    return {
        hands: s.hands.map(cloneHand),
        chain: cloneChain(s.chain),
        currentPlayer: s.currentPlayer,
        consecutivePasses: s.consecutivePasses,
        moveLog: [...s.moveLog],
    };
}

// ─── Helpers ────────────────────────────────────────────────────────────────
function teamPips(s, team) {
    const seats = team === 0 ? [0, 2] : [1, 3];
    return seats.reduce((sum, p) => sum + s.hands[p].pipCount(), 0);
}
function isCerrar(s) { return s.chain.isClosed(); }
function isBlocked(s) { return s.consecutivePasses >= 4; }
function isDomino(s) { return s.hands.some(h => h.tiles.length === 0); }

// At a terminal state, return the cerrar haul (-1 means not a cerrar terminal).
function terminalHaul(s) {
    if (isCerrar(s)) {
        const a = teamPips(s, 0), b = teamPips(s, 1);
        return Math.max(a, b); // losing team's pip total
    }
    return -1;
}

// Apply a move and produce the next state.
function applyMove(s, move) {
    const next = cloneState(s);
    next.chain.play(move.tile, move.end, next.currentPlayer);
    next.hands[next.currentPlayer].remove(move.tile);
    next.consecutivePasses = 0;
    next.moveLog.push({ player: next.currentPlayer, tile: move.tile.toString(), end: move.end });
    next.currentPlayer = (next.currentPlayer + 1) % 4;
    return next;
}
function applyPass(s) {
    const next = cloneState(s);
    next.consecutivePasses++;
    next.moveLog.push({ player: next.currentPlayer, tile: null });
    next.currentPlayer = (next.currentPlayer + 1) % 4;
    return next;
}

// ─── The search ─────────────────────────────────────────────────────────────
// State key for memoization: chain ends + dead-suit indicators + per-seat
// hand contents + currentPlayer + consecutivePasses. The chain's placed-tile
// ORDER doesn't affect future play; only the end values and what's been
// consumed matter, so we hash only the consumed-tile set per seat.
function stateKey(s) {
    const handKey = s.hands.map(h =>
        h.tiles.map(t => `${Math.max(t.high, t.low)}|${Math.min(t.high, t.low)}`).sort().join(',')
    ).join('#');
    return `${s.chain.leftEnd},${s.chain.rightEnd}|${handKey}|p=${s.currentPlayer}|cp=${s.consecutivePasses}`;
}

let nodesVisited = 0;
let bestSoFar = -1;
const memo = new Map();
const MEMO_CAP = 5_000_000; // V8 Map hard-limit is ~16M; stay well below
const MAX_DEPTH = 20; // cerrars in our setup happen by depth ~15; this is slack

let prunedBranches = 0;
let bestPlaySequence = null;

function search(s, depth) {
    nodesVisited++;
    if (isCerrar(s)) {
        const haul = terminalHaul(s);
        if (haul > bestSoFar) {
            bestSoFar = haul;
            bestPlaySequence = [...s.moveLog];
        }
        return haul;
    }
    if (isBlocked(s) || isDomino(s)) return -1;
    if (depth > MAX_DEPTH) return -1;

    const teamARemaining = s.hands[0].pipCount() + s.hands[2].pipCount();
    const teamBRemaining = s.hands[1].pipCount() + s.hands[3].pipCount();
    const branchUpperBound = Math.max(teamARemaining, teamBRemaining);
    if (branchUpperBound <= bestSoFar) {
        prunedBranches++;
        return -1;
    }

    const key = stateKey(s);
    const memoed = memo.get(key);
    if (memoed !== undefined) return memoed;

    const hand = s.hands[s.currentPlayer];
    const chain = s.chain;
    const validMoves = Rules.getValidMoves(hand, chain);

    let best = -1;
    if (validMoves.length === 0) {
        const next = applyPass(s);
        best = search(next, depth + 1);
    } else {
        for (const move of validMoves) {
            const next = applyMove(s, move);
            const result = search(next, depth + 1);
            if (result > best) best = result;
        }
    }
    if (best >= 0 && memo.size < MEMO_CAP) memo.set(key, best);
    return best;
}

// ─── Search driver ──────────────────────────────────────────────────────────
function shuffle(arr, rng = Math.random) {
    const a = [...arr];
    for (let i = a.length - 1; i > 0; i--) {
        const j = Math.floor(rng() * (i + 1));
        [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
}

function runOneDeal(partitionIdx, splitSeed) {
    // Build the partition's heavy/light sets.
    const { heavy, light } = buildPartitionHands(partitionIdx);
    // Use a seeded RNG for reproducibility within one run.
    let seed = splitSeed;
    const rng = () => { seed = (seed * 9301 + 49297) % 233280; return seed / 233280; };
    const lightShuf = shuffle(light, rng);
    const heavyShuf = shuffle(heavy, rng);
    const seat0 = lightShuf.slice(0, 7).map(([a, b]) => new Tile(a, b));
    const seat2 = lightShuf.slice(7, 14).map(([a, b]) => new Tile(a, b));
    const seat1 = heavyShuf.slice(0, 7).map(([a, b]) => new Tile(a, b));
    const seat3 = heavyShuf.slice(7, 14).map(([a, b]) => new Tile(a, b));
    const hands = [new Hand(), new Hand(), new Hand(), new Hand()];
    seat0.forEach(t => hands[0].add(t));
    seat1.forEach(t => hands[1].add(t));
    seat2.forEach(t => hands[2].add(t));
    seat3.forEach(t => hands[3].add(t));
    // Find who holds 6|6 — they'd open in a first hand. But since we're
    // searching the cooperative maximum, we let the opener be chosen too:
    // try every possible salida holder for the absolute best haul. For now,
    // start with whoever holds 6|6 (team B per the partition rules), since
    // that matches harness behavior.
    let opener = -1;
    const sixSix = new Tile(6, 6);
    for (let p = 0; p < 4; p++) if (hands[p].has(sixSix)) { opener = p; break; }
    if (opener === -1) throw new Error("6|6 not found — partition setup is broken");

    const state = {
        hands,
        chain: new Chain(),
        currentPlayer: opener,
        consecutivePasses: 0,
        moveLog: [],
    };

    nodesVisited = 0;
    prunedBranches = 0;
    bestSoFar = -1;
    bestPlaySequence = null;
    memo.clear();
    const t0 = Date.now();
    const haul = search(state, 0);
    const elapsedMs = Date.now() - t0;
    return {
        partition: partitionLabel(partitionIdx),
        partitionIdx,
        splitSeed,
        haul,
        nodesVisited,
        prunedBranches,
        memoSize: memo.size,
        elapsedMs,
        opener,
        seat0: seat0.map(t => t.toString()),
        seat1: seat1.map(t => t.toString()),
        seat2: seat2.map(t => t.toString()),
        seat3: seat3.map(t => t.toString()),
        playSequence: bestPlaySequence ? [...bestPlaySequence] : null,
    };
}

// ─── CLI ────────────────────────────────────────────────────────────────────
function parseArgs() {
    const opts = { partition: null, sweep: 1, verbose: false, seed: 42 };
    for (let i = 2; i < process.argv.length; i++) {
        const a = process.argv[i];
        if (a === '--partition') opts.partition = parseInt(process.argv[++i], 10);
        else if (a === '--sweep') opts.sweep = parseInt(process.argv[++i], 10);
        else if (a === '--seed') opts.seed = parseInt(process.argv[++i], 10);
        else if (a === '--verbose') opts.verbose = true;
        else if (a === '--help' || a === '-h') {
            console.log('Usage: node tools/cerrado-search.js [--partition 0..5] [--sweep K] [--seed N] [--verbose]');
            console.log('');
            console.log('  --partition N  Restrict to one partition (0-5). Default: sweep all 6.');
            console.log('  --sweep K      K random seat-split trials per partition. Default 1.');
            console.log('  --seed N       RNG seed for split sampling. Default 42.');
            console.log('  --verbose      Print per-trial detail (every trial, not just the best).');
            console.log('');
            console.log('Partition indices:');
            for (let i = 0; i < 6; i++) console.log(`  ${i}: heavy contains ${partitionLabel(i)}`);
            process.exit(0);
        }
    }
    return opts;
}

const opts = parseArgs();
const partitions = opts.partition !== null ? [opts.partition] : [0, 1, 2, 3, 4, 5];

console.log(`Exhaustive max-cerrar search: ${partitions.length} partition(s) × ${opts.sweep} split(s) per partition`);
console.log(`Seed: ${opts.seed}`);
console.log('');

const allResults = [];
let globalBest = { haul: -1 };
const startAll = Date.now();
for (const p of partitions) {
    let partitionBest = { haul: -1 };
    for (let k = 0; k < opts.sweep; k++) {
        const seed = opts.seed * 1000 + p * 100 + k;
        const result = runOneDeal(p, seed);
        allResults.push(result);
        if (opts.verbose) {
            console.log(`  [P=${p} ${result.partition} k=${k}] haul=${result.haul}  nodes=${result.nodesVisited.toLocaleString()}  memo=${result.memoSize.toLocaleString()}  time=${result.elapsedMs}ms`);
        }
        if (result.haul > partitionBest.haul) partitionBest = result;
        if (result.haul > globalBest.haul) globalBest = result;
    }
    console.log(`Partition ${p} (heavy=${partitionLabel(p)}): best haul = ${partitionBest.haul} pips  (out of ${opts.sweep} trial(s))`);
}
const totalMs = Date.now() - startAll;
console.log('');
console.log('═══════════════════════════════════════════════════════════');
console.log(` Global optimum across all trials`);
console.log('═══════════════════════════════════════════════════════════');
console.log(`  Max cerrar pip haul: ${globalBest.haul}`);
console.log(`  Partition: ${globalBest.partition} (idx ${globalBest.partitionIdx})`);
console.log(`  Split seed: ${globalBest.splitSeed}`);
console.log(`  Opener seat: ${globalBest.opener}`);
console.log(`  seat 0 (A1): ${globalBest.seat0.join(' ')}`);
console.log(`  seat 1 (B1): ${globalBest.seat1.join(' ')}`);
console.log(`  seat 2 (A2): ${globalBest.seat2.join(' ')}`);
console.log(`  seat 3 (B2): ${globalBest.seat3.join(' ')}`);
console.log(`  Search visited ${globalBest.nodesVisited.toLocaleString()} nodes, pruned ${globalBest.prunedBranches.toLocaleString()} branches, memo ${globalBest.memoSize.toLocaleString()} entries, ${globalBest.elapsedMs}ms`);
console.log(`  Total elapsed: ${totalMs}ms across ${allResults.length} trials`);
if (globalBest.playSequence) {
    console.log('');
    console.log('  Optimal play sequence:');
    for (let i = 0; i < globalBest.playSequence.length; i++) {
        const m = globalBest.playSequence[i];
        const seatName = ['A1', 'B1', 'A2', 'B2'][m.player];
        const action = m.tile ? `plays ${m.tile} on ${m.end}` : 'PASS';
        console.log(`    T${(i + 1).toString().padStart(2)}  seat ${m.player} (${seatName}): ${action}`);
    }
}
