// Headless AI-vs-AI tournament harness for 7 Fichas.
// Runs N matches with all four seats playing SmartAI at the given difficulty
// and reports per-team, per-seat, and per-hand statistics. Use as the
// measurement loop when tuning AI strategy or probability inference.
//
// Usage:
//   node tools/tournament.js                       # 50 matches, master vs master
//   node tools/tournament.js --games 200
//   node tools/tournament.js --games 100 --difficulty hard
//   node tools/tournament.js --games 20 --verbose  # print every hand

// SmartAI / MonteCarloEvaluator read window.location.search at import time, and
// i18n calls localStorage + navigator.language during its top-level init().
// Stub the browser globals before importing.
globalThis.window = { location: { search: '' } };
globalThis.localStorage = { getItem: () => null, setItem: () => {} };
globalThis.document = { querySelectorAll: () => [], documentElement: { lang: 'en' } };
// navigator already exists in Node and exposes .language — leave it alone.

const { Game } = await import('../docs/js/engine/Game.js');
const { SmartAI } = await import('../docs/js/ai/SmartAI.js');
const { HandTracker } = await import('../docs/js/ai/HandTracker.js');
const { PlayerView } = await import('../docs/js/ai/PlayerView.js');
const { Rules } = await import('../docs/js/engine/Rules.js');
const { Tile } = await import('../docs/js/models/Tile.js');
const { Hand } = await import('../docs/js/models/Hand.js');

// Max-disparity 50/118 deal. There are SIX distinct 14-tile partitions that achieve
// the maximum pip total of 118, because the top-14 set by pip count contains a tie
// among the four pip-6 tiles (6|0, 5|1, 4|2, 3|3) for the last two slots. We pick
// 2 of those 4 randomly per hand so the simulation spans all 6 partitions evenly.
// See docs/MAX_CERRADO.md §4b for the per-partition theoretical ceilings.
const MAX_DISPARITY_CORE = [
    // 12 always-heavy tiles (sum 106). The 12-tile uniquely-determined core.
    [6,1],[6,2],[6,3],[6,4],[6,5],[6,6],
    [5,2],[5,3],[5,4],[5,5],
    [4,3],[4,4],
];
const MAX_DISPARITY_FIXED_LIGHT = [
    // 12 always-light tiles (sum 38).
    [0,0],[0,1],[0,2],[0,3],[0,4],[0,5],
    [1,1],[1,2],[1,3],[1,4],
    [2,2],[2,3],
];
const MAX_DISPARITY_PIP6 = [
    // 4 ambiguous pip-6 tiles. 2 go to heavy, 2 to light.
    [6,0],[5,1],[4,2],[3,3],
];

const VARIANTS = ['mc-pass', 'no-def-close', 'def-close-1', 'pip-close', 'lookahead2', 'rand5', 'rand10'];

function parseArgs(argv) {
    const opts = { games: 50, difficulty: 'master', verbose: false, ab: false, instrument: false, probAccuracy: false, pipAccuracy: false, maxCerrado: false, cooperativeLosers: false, maxDisparityDeals: false, randomLosers: false, forceCerrar: false, variant: 'mc-pass', allVariant: null };
    for (let i = 2; i < argv.length; i++) {
        const a = argv[i];
        if (a === '--games') opts.games = parseInt(argv[++i], 10);
        else if (a === '--difficulty') opts.difficulty = argv[++i];
        else if (a === '--verbose') opts.verbose = true;
        else if (a === '--ab') opts.ab = true;
        else if (a === '--variant') opts.variant = argv[++i];
        else if (a === '--all-variant') { opts.allVariant = argv[++i]; }
        else if (a === '--instrument') opts.instrument = true;
        else if (a === '--prob-accuracy') opts.probAccuracy = true;
        else if (a === '--pip-accuracy') opts.pipAccuracy = true;
        else if (a === '--max-cerrado') opts.maxCerrado = true;
        else if (a === '--cooperative-losers') opts.cooperativeLosers = true;
        else if (a === '--max-disparity-deals') opts.maxDisparityDeals = true;
        else if (a === '--random-losers') opts.randomLosers = true;
        else if (a === '--force-cerrar') opts.forceCerrar = true;
        else if (a === '--help' || a === '-h') {
            console.log('Usage: node tools/tournament.js [--games N] [--difficulty LEVEL] [--ab] [--variant NAME] [--instrument] [--verbose]');
            console.log('  --ab            Champion (current code) vs Challenger (a variant). Challenger');
            console.log('                  team alternates each match to cancel seat bias.');
            console.log(`  --variant NAME  Challenger variant for --ab. One of: ${VARIANTS.join(', ')}.`);
            console.log('                    mc-pass       MC-derived pass/block probabilities.');
            console.log('                    no-def-close  Disable defensive cuadrar (block only at pip advantage).');
            console.log('                    def-close-1   Defensive close only when an opponent has 1 tile left.');
            console.log('                    pip-close     Boost late-game pip-dumping before a likely close.');
            console.log('                    lookahead2    2-ply search (move + opponent reply) on most-likely deal.');
            console.log('                    rand5/rand10  Randomize among moves within 5/10 pts of the top score.');
            console.log('  --instrument    Collect per-decision records; report priority breakdown,');
            console.log('                  factor histogram, score margins, and closing effectiveness.');
            console.log('  --prob-accuracy Snapshot per-view tile-holding predictions before each play;');
            console.log('                  report Brier / log-loss bucketed by tiles played and a');
            console.log('                  10-bin calibration curve. Significantly slower (~3-5× baseline).');
            console.log('  --pip-accuracy  Snapshot AI pip-advantage estimate vs ground truth from');
            console.log('                  state.hands at each chooseMove; report mean signed error,');
            console.log('                  RMSE, and sign-mismatch rate (= false cuadrar trigger rate).');
            console.log('  --max-cerrado   Record the largest cerrar pip haul (losing-team pip total)');
            console.log('                  across all matches; report distribution and per-V breakdown.');
            console.log('                  See docs/MAX_CERRADO.md for the theoretical analysis.');
            console.log('  --cooperative-losers');
            console.log('                  Seats 1 and 3 (team B) play a stripped-down "cooperative"');
            console.log('                  behavior: pass whenever legal, otherwise play the lowest-pip');
            console.log('                  tile in hand. Combined with --max-cerrado, measures the');
            console.log('                  cooperative-ceiling scenario from MAX_CERRADO.md §6.');
            console.log('  --max-disparity-deals');
            console.log('                  Rig every hand so team B holds the maximum-pip 14-tile set');
            console.log('                  (118 pips) and team A holds the complement (50 pips). The');
            console.log('                  intra-team seat split is still randomized. Pair with');
            console.log('                  --cooperative-losers to probe the absolute theoretical max.');
            console.log('  --random-losers Seats 1, 3 play a uniform-random legal move when forced.');
            console.log('                  Unlike --cooperative-losers, no pip preference or pass bias.');
            console.log('                  Used as unbiased exploration of the play space.');
            console.log('  --force-cerrar  Seats 0, 2 take any move that closes the chain (cerrar)');
            console.log('                  ahead of master AI strategy. Removes "did team A even try');
            console.log('                  to close?" as a confound from max-haul measurements.');
            process.exit(0);
        }
    }
    if (opts.ab && !VARIANTS.includes(opts.variant)) {
        console.error(`Unknown variant "${opts.variant}". Choose one of: ${VARIANTS.join(', ')}`);
        process.exit(1);
    }
    if (opts.allVariant && !VARIANTS.includes(opts.allVariant)) {
        console.error(`Unknown --all-variant "${opts.allVariant}". Choose one of: ${VARIANTS.join(', ')}`);
        process.exit(1);
    }
    return opts;
}

function applyVariant(variant, ai, playerViews, seat) {
    switch (variant) {
        case 'mc-pass':
            playerViews[seat].useMcDerivedPassProb = true;
            break;
        case 'no-def-close':
            ai.defensiveCloseThreshold[seat] = 0; // never defensively close
            break;
        case 'def-close-1':
            ai.defensiveCloseThreshold[seat] = 1; // only when opponent has 1 tile
            break;
        case 'pip-close':
            ai.pipAwareClose[seat] = true;
            break;
        case 'lookahead2':
            ai.useLookahead2[seat] = true;
            break;
        case 'rand5':
            ai.randomizeTolerance[seat] = 5;
            break;
        case 'rand10':
            ai.randomizeTolerance[seat] = 10;
            break;
    }
}

function setupMatch(difficulty, challengerSeats = null, variant = null, allVariant = null) {
    const game = new Game();
    const ai = new SmartAI();
    const handTracker = new HandTracker();
    ai.setHandTracker(handTracker);
    const playerViews = [0, 1, 2, 3].map(i => new PlayerView(i, handTracker));
    if (allVariant) {
        for (let seat = 0; seat < 4; seat++) applyVariant(allVariant, ai, playerViews, seat);
    } else if (challengerSeats && variant) {
        for (const seat of challengerSeats) {
            applyVariant(variant, ai, playerViews, seat);
        }
    }
    ai.setPlayerViews(playerViews);
    for (let i = 0; i < 4; i++) ai.setDifficulty(i, difficulty);

    game.onPlay = (data) => {
        const leftEnd = data.openEndsBefore?.left ?? null;
        const rightEnd = data.openEndsBefore?.right ?? null;
        ai.recordPlay(data.player, data.tile, data.end, leftEnd, rightEnd);
        handTracker.recordPlay(data.player, data.tile);
        for (const view of playerViews) {
            view.recordPlayObservation(data.player, data.tile, data.end, leftEnd, rightEnd);
        }
    };
    game.onPass = (data) => {
        const state = game.getState();
        ai.recordPass(data.player, state.chain.leftEnd, state.chain.rightEnd);
        handTracker.recordPass(data.player, state.chain.leftEnd, state.chain.rightEnd);
    };

    return { game, ai, handTracker, playerViews };
}

// Random-play behavior used by --random-losers. Uniform pick over valid moves;
// no pip preference, no pass bias. Used as unbiased exploration of the play
// space — random will eventually sample sequences close to the structural
// optimum without requiring us to design those sequences explicitly.
function chooseMoveRandom(gameState, playerIndex) {
    const hand = gameState.hands[playerIndex];
    const chain = gameState.chain;
    const mustPlayDoubleSix = gameState.isFirstHand && chain.isEmpty();
    const validMoves = Rules.getValidMoves(hand, chain, mustPlayDoubleSix);
    if (validMoves.length === 0) return null;
    const pick = validMoves[Math.floor(Math.random() * validMoves.length)];
    return { ...pick, reasoning: 'Random loser' };
}

// Returns true if playing `move` would cause the chain to be closed (cerrar):
// both ends equal to some value V and all 7 V-tiles played. Used by
// --force-cerrar to prioritize closing moves over master AI's strategic choice.
function moveClosesChain(state, move) {
    const chain = state.chain;
    if (chain.isEmpty()) return false; // opening move can't close
    const tile = move.tile;
    const currentEnd = move.end === 'left' ? chain.leftEnd : chain.rightEnd;
    const otherEnd = move.end === 'left' ? chain.rightEnd : chain.leftEnd;
    const newExposed = tile.getOtherValue(currentEnd); // face after playing
    if (newExposed !== otherEnd) return false;
    const V = newExposed;
    // Chain.countValue counts each played tile's contribution to value V.
    // The candidate tile contributes: 1 if it has a V-face (always true here
    // since newExposed === V means one of its faces is V — actually both ends
    // are V meaning the played tile is V|V; or one face is V and the other is V).
    // Simpler: count what the candidate tile adds.
    let addedToV = 0;
    if (tile.high === V) addedToV++;
    if (tile.low === V && !tile.isDouble()) addedToV++;
    return (chain.countValue(V) + addedToV) >= 7;
}

// Wrapper used by --force-cerrar for team A's seats. Scans valid moves for
// any that closes the chain; if found, returns it. Otherwise falls through
// to the master AI's normal strategic choice.
function chooseMoveForceCerrar(ai, gameState, playerIndex) {
    const hand = gameState.hands[playerIndex];
    const chain = gameState.chain;
    const validMoves = Rules.getValidMoves(hand, chain);
    for (const move of validMoves) {
        if (moveClosesChain(gameState, move)) {
            return { ...move, reasoning: 'Force-cerrar' };
        }
    }
    return ai.chooseMove(gameState, playerIndex);
}

// Stripped-down "cooperative loser" behavior used by --cooperative-losers.
// When forced to play, choose the lowest-pip tile; otherwise pass. Defined
// in the harness rather than SmartAI because it's tooling-only — it has no
// place in the shipped AI.
function chooseMoveCooperative(gameState, playerIndex) {
    const hand = gameState.hands[playerIndex];
    const chain = gameState.chain;
    const mustPlayDoubleSix = gameState.isFirstHand && chain.isEmpty();
    const validMoves = Rules.getValidMoves(hand, chain, mustPlayDoubleSix);
    if (validMoves.length === 0) return null;
    let best = validMoves[0];
    let bestPips = best.tile.pipCount();
    for (let i = 1; i < validMoves.length; i++) {
        const p = validMoves[i].tile.pipCount();
        if (p < bestPips) { bestPips = p; best = validMoves[i]; }
    }
    return { ...best, reasoning: 'Cooperative loser: lowest-pip tile' };
}

// Rigs the deal so team B (seats 1, 3) holds 118 pips and team A (seats 0, 2) holds
// 50 pips. The specific 50/118 partition is randomly picked from the 6 equivalent
// partitions each hand (heavy = 12-tile core + 2 of 4 pip-6 tiles). Within each
// team the 14 tiles are then randomly split 7+7 between the two seats. For the
// first hand only, currentPlayer is reset to whichever team-B seat ended up
// holding the double-six (the salida rule). Returns the partition descriptor.
function applyMaxDisparityDeal(game) {
    const state = game.getState();
    // Shuffle the 4 ambiguous pip-6 tiles and split 2 to heavy, 2 to light.
    const pip6 = MAX_DISPARITY_PIP6.map(p => [...p]);
    for (let i = pip6.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [pip6[i], pip6[j]] = [pip6[j], pip6[i]];
    }
    const pip6Heavy = pip6.slice(0, 2);
    const pip6Light = pip6.slice(2, 4);
    const heavyTiles = [...MAX_DISPARITY_CORE, ...pip6Heavy].map(([a, b]) => new Tile(a, b));
    const lightTiles = [...MAX_DISPARITY_FIXED_LIGHT, ...pip6Light].map(([a, b]) => new Tile(a, b));
    // Fisher-Yates shuffle within each team's tile set for the intra-team 7+7 split.
    for (let arr of [heavyTiles, lightTiles]) {
        for (let i = arr.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [arr[i], arr[j]] = [arr[j], arr[i]];
        }
    }
    state.hands[0] = new Hand();
    state.hands[2] = new Hand();
    state.hands[1] = new Hand();
    state.hands[3] = new Hand();
    for (let i = 0; i < 7; i++) state.hands[0].add(lightTiles[i]);
    for (let i = 7; i < 14; i++) state.hands[2].add(lightTiles[i]);
    for (let i = 0; i < 7; i++) state.hands[1].add(heavyTiles[i]);
    for (let i = 7; i < 14; i++) state.hands[3].add(heavyTiles[i]);
    if (state.isFirstHand) {
        const sixSix = new Tile(6, 6);
        for (const seat of [1, 3]) {
            if (state.hands[seat].has(sixSix)) { state.currentPlayer = seat; break; }
        }
    }
    // Return partition descriptor — which pip-6 tiles ended up in heavy. Sort
    // so each partition has a canonical string key (e.g. "4|2,6|0").
    const heavyKey = pip6Heavy
        .map(([a, b]) => `${Math.max(a, b)}|${Math.min(a, b)}`)
        .sort()
        .join(',');
    return { partition: heavyKey, sixZeroInHeavy: pip6Heavy.some(([a, b]) => (a === 6 && b === 0) || (a === 0 && b === 6)) };
}

function initTrackersForHand(handTracker, playerViews, state) {
    handTracker.initHand(state.hands[0]);
    for (let i = 0; i < 4; i++) {
        playerViews[i].resetAffinities();
        playerViews[i].initOwnHand(state.hands[i]);
    }
}

function runMatch({ verbose, difficulty, challengerSeats = null, challengerTeam = null, variant = null, allVariant = null, decisionSink = null, closeSink = null, probAcc = null, pipAcc = null, cerradoAcc = null, cooperativeLosers = false, maxDisparityDeals = false, randomLosers = false, forceCerrar = false }) {
    const { game, ai, handTracker, playerViews } = setupMatch(difficulty, challengerSeats, variant, allVariant);
    // Track each player's most recent decision so a close can be classified as
    // deliberate (had ≥2 legal moves) vs forced (closing tile was the only move).
    const lastDecision = [null, null, null, null];
    if (decisionSink || closeSink) {
        ai.onDecision = (rec) => {
            lastDecision[rec.playerIndex] = rec;
            if (decisionSink) decisionSink.push(rec);
        };
    }

    const handResults = [];
    let matchResult = null;
    let totalMoves = 0;
    let totalPasses = 0;

    game.onHandEnd = (data) => {
        handResults.push({
            reason: data.reason,
            winningTeam: data.winningTeam,
            points: data.points,
            dominoPlayer: data.dominoPlayer,
            closingPlayer: data.closingPlayer,
        });

        if (cerradoAcc && data.reason === 'closed') {
            const state = game.getState();
            const hands = state.hands;
            const closingValue = state.chain.leftEnd; // both ends equal V for a cerrado
            const chainLength = state.chain.size();
            const teamPips = [
                hands[0].pipCount() + hands[2].pipCount(),
                hands[1].pipCount() + hands[3].pipCount(),
            ];
            const losingTeam = data.winningTeam === 0 ? 1 : data.winningTeam === 1 ? 0 : -1;
            // data.points is the losing team's pip total per Rules.calculateHandResult.
            const losingPips = data.points;
            const winnersRemaining = losingTeam === -1 ? null : teamPips[1 - losingTeam];
            const losingInitial = losingTeam === -1 ? null : initialTeamPips[losingTeam];
            const winnersInitial = losingTeam === -1 ? null : initialTeamPips[1 - losingTeam];
            const pipDump = losingInitial != null ? losingInitial - losingPips : null;
            cerradoAcc.add({
                losingPips,
                winnersRemaining,
                losingInitial,
                winnersInitial,
                pipDump,
                closingValue,
                chainLength,
                winningTeam: data.winningTeam,
                closingPlayer: data.closingPlayer,
                partition: currentPartition?.partition ?? null,
                sixZeroInHeavy: currentPartition?.sixZeroInHeavy ?? null,
            });
        }

        if (closeSink && data.reason === 'closed' && data.closingPlayer != null) {
            // Hands still hold their remaining tiles at callback time, so we can
            // read pip totals directly.
            const hands = game.getState().hands;
            const teamPips = [
                hands[0].pipCount() + hands[2].pipCount(),
                hands[1].pipCount() + hands[3].pipCount(),
            ];
            const closerTeam = data.closingPlayer % 2; // seats 0,2 → A(0); 1,3 → B(1)
            const closerPips = teamPips[closerTeam];
            const oppPips = teamPips[1 - closerTeam];
            const dec = lastDecision[data.closingPlayer];
            // Classify by the AI's actual sealing-move decision:
            //  - 'offensive': sealed via a P2 cuadrar block taken for pip advantage
            //  - 'defensive': sealed via a P2 cuadrar block taken to stop an
            //                 imminent opponent domino (accepting a pip disadvantage)
            //  - 'incidental': board sealed through normal scoring, not a deliberate block
            let closeType = 'incidental';
            if (dec && dec.priority === 'block') {
                closeType = dec.blockType === 'defensive' ? 'defensive' : 'offensive';
            }
            closeSink.push({
                closeType,
                hadChoice: dec ? dec.validMovesCount >= 2 : null,
                closerWon: data.winningTeam === closerTeam,
                isTie: closerPips === oppPips, // closer wins ties by rule
                pipMargin: oppPips - closerPips, // positive ⇒ closer ahead on pips
            });
        }
    };
    game.onMatchEnd = (data) => { matchResult = data; };

    ai.resetForNewHand();
    game.newMatch();
    let currentPartition = null; // descriptor of the rigged partition in use this hand
    if (maxDisparityDeals) currentPartition = applyMaxDisparityDeal(game);
    initTrackersForHand(handTracker, playerViews, game.getState());
    // Snapshot team pip totals at the start of each hand so cerrado samples
    // can record the losing team's *initial* pips (and the pip dump). Updated
    // again whenever a new hand is dealt below.
    let initialTeamPips = (() => {
        const h = game.getState().hands;
        return [h[0].pipCount() + h[2].pipCount(), h[1].pipCount() + h[3].pipCount()];
    })();

    const aiTimings = [];
    let safetyTicks = 0;
    const MAX_TICKS = 200000; // generous; a normal match is well under this

    while (matchResult === null && safetyTicks++ < MAX_TICKS) {
        const state = game.getState();

        if (state.gamePhase === 'playing') {
            if (probAcc) captureProbSnapshot(playerViews, state, probAcc);
            if (pipAcc) capturePipSnapshot(ai, playerViews, state, pipAcc);
            const t0 = process.hrtime.bigint();
            // Per-seat dispatch. Seats 1 and 3 (team B) may use random or
            // cooperative behavior; seats 0 and 2 (team A) may use force-cerrar.
            // Falls through to normal SmartAI in all other cases.
            const isTeamB = state.currentPlayer === 1 || state.currentPlayer === 3;
            const isTeamA = state.currentPlayer === 0 || state.currentPlayer === 2;
            const useRandom = randomLosers && isTeamB;
            const useCooperative = !useRandom && cooperativeLosers && isTeamB;
            const useForceCerrar = forceCerrar && isTeamA;
            let move;
            if (useRandom) move = chooseMoveRandom(state, state.currentPlayer);
            else if (useCooperative) move = chooseMoveCooperative(state, state.currentPlayer);
            else if (useForceCerrar) move = chooseMoveForceCerrar(ai, state, state.currentPlayer);
            else move = ai.chooseMove(state, state.currentPlayer);
            const elapsedMs = Number(process.hrtime.bigint() - t0) / 1e6;
            aiTimings.push(elapsedMs);

            if (move === null) {
                game.pass();
                totalPasses++;
            } else {
                game.playTurn(move.tile, move.end, { reasoning: move.reasoning });
                totalMoves++;
            }
        } else if (state.gamePhase === 'handOver') {
            ai.resetForNewHand();
            game.newHand();
            if (maxDisparityDeals) currentPartition = applyMaxDisparityDeal(game);
            initTrackersForHand(handTracker, playerViews, game.getState());
            const h = game.getState().hands;
            initialTeamPips = [h[0].pipCount() + h[2].pipCount(), h[1].pipCount() + h[3].pipCount()];
        } else {
            break; // matchOver caught by onMatchEnd setter above
        }
    }

    if (matchResult === null) {
        throw new Error(`Match did not terminate within ${MAX_TICKS} ticks`);
    }

    if (verbose) {
        const tag = challengerTeam !== null
            ? ` [challenger=team ${challengerTeam}, ${matchResult.winner === challengerTeam ? 'WIN' : 'LOSS'}]`
            : '';
        console.log(`  Match: ${matchResult.finalScores[0]}–${matchResult.finalScores[1]} ` +
                    `(team ${matchResult.winner} wins) over ${handResults.length} hands${tag}`);
    }

    return { matchResult, handResults, totalMoves, totalPasses, aiTimings, challengerTeam };
}

function aggregate(matches) {
    const stats = {
        matchesPlayed: matches.length,
        teamWins: [0, 0],
        seatDominoes: [0, 0, 0, 0],
        handsByReason: { domino: 0, closed: 0, blocked: 0 },
        teamPointsBreakdown: [0, 0],
        totalHands: 0,
        totalMoves: 0,
        totalPasses: 0,
        aiTimings: [],
        marginSamples: [],
    };

    for (const m of matches) {
        stats.teamWins[m.matchResult.winner]++;
        stats.marginSamples.push(
            Math.abs(m.matchResult.finalScores[0] - m.matchResult.finalScores[1])
        );
        stats.totalMoves += m.totalMoves;
        stats.totalPasses += m.totalPasses;
        stats.aiTimings.push(...m.aiTimings);

        for (const h of m.handResults) {
            stats.totalHands++;
            stats.handsByReason[h.reason] = (stats.handsByReason[h.reason] || 0) + 1;
            if (h.winningTeam >= 0) stats.teamPointsBreakdown[h.winningTeam] += h.points;
            if (h.dominoPlayer != null) stats.seatDominoes[h.dominoPlayer]++;
        }
    }

    return stats;
}

function pct(n, d) { return d === 0 ? '0.0%' : `${(100 * n / d).toFixed(1)}%`; }
function avg(arr) { return arr.length === 0 ? 0 : arr.reduce((a, b) => a + b, 0) / arr.length; }
// Loop-based min/max: Math.max(...arr) overflows the call stack for large arrays
// (the spread is passed as function arguments, which are capped ~100k).
function maxOf(arr) { let m = -Infinity; for (const x of arr) if (x > m) m = x; return m; }
function minOf(arr) { let m = Infinity; for (const x of arr) if (x < m) m = x; return m; }
function median(arr) {
    if (arr.length === 0) return 0;
    const s = [...arr].sort((a, b) => a - b);
    const m = Math.floor(s.length / 2);
    return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

function report(stats, opts) {
    const N = stats.matchesPlayed;
    console.log('');
    console.log('═══════════════════════════════════════════════════════════');
    console.log(` Tournament: ${N} matches @ difficulty=${opts.difficulty}`);
    console.log('═══════════════════════════════════════════════════════════');
    console.log('');
    console.log('Team wins:');
    console.log(`  Team A (seats 0+2):  ${stats.teamWins[0]}  (${pct(stats.teamWins[0], N)})`);
    console.log(`  Team B (seats 1+3):  ${stats.teamWins[1]}  (${pct(stats.teamWins[1], N)})`);
    console.log('');
    console.log('Hands per match:');
    console.log(`  Total hands:         ${stats.totalHands}`);
    console.log(`  Avg hands / match:   ${(stats.totalHands / N).toFixed(2)}`);
    console.log('');
    console.log('Hand outcomes:');
    const tot = stats.totalHands;
    console.log(`  Domino:              ${stats.handsByReason.domino}  (${pct(stats.handsByReason.domino, tot)})`);
    console.log(`  Closed (cerrar):     ${stats.handsByReason.closed}  (${pct(stats.handsByReason.closed, tot)})`);
    console.log(`  Blocked (tranca):    ${stats.handsByReason.blocked}  (${pct(stats.handsByReason.blocked, tot)})`);
    console.log('');
    console.log('Seat dominoes (who closed out the hand):');
    for (let i = 0; i < 4; i++) {
        console.log(`  Seat ${i}:              ${stats.seatDominoes[i]}  (${pct(stats.seatDominoes[i], tot)})`);
    }
    console.log('');
    console.log('Team points scored across all hands:');
    console.log(`  Team A:              ${stats.teamPointsBreakdown[0]}`);
    console.log(`  Team B:              ${stats.teamPointsBreakdown[1]}`);
    console.log('');
    console.log('Final-score margin (winner – loser):');
    console.log(`  Mean:                ${avg(stats.marginSamples).toFixed(1)}`);
    console.log(`  Median:              ${median(stats.marginSamples).toFixed(1)}`);
    console.log('');
    console.log('AI move timing:');
    console.log(`  Total AI decisions:  ${stats.aiTimings.length}`);
    console.log(`  Mean (ms):           ${avg(stats.aiTimings).toFixed(2)}`);
    console.log(`  Median (ms):         ${median(stats.aiTimings).toFixed(2)}`);
    console.log(`  Max (ms):            ${maxOf(stats.aiTimings).toFixed(2)}`);
    console.log('');
}

function reportAB(matches, variant) {
    const N = matches.length;
    let challengerWins = 0;
    let championWins = 0;
    // Split by which team was challenger so we can sanity-check seat balance.
    const byTeam = { 0: { played: 0, won: 0 }, 1: { played: 0, won: 0 } };

    for (const m of matches) {
        byTeam[m.challengerTeam].played++;
        if (m.matchResult.winner === m.challengerTeam) {
            challengerWins++;
            byTeam[m.challengerTeam].won++;
        } else {
            championWins++;
        }
    }

    const p = challengerWins / N;
    const se = Math.sqrt(p * (1 - p) / N);
    const ci95 = 1.96 * se;

    console.log('');
    console.log('═══════════════════════════════════════════════════════════');
    console.log(` A/B Result: Champion (current) vs Challenger (${variant})`);
    console.log('═══════════════════════════════════════════════════════════');
    console.log('');
    console.log(`Total matches:       ${N}`);
    console.log(`Challenger wins:     ${challengerWins}  (${(100 * p).toFixed(1)}% ± ${(100 * ci95).toFixed(1)}%)`);
    console.log(`Champion wins:       ${championWins}`);
    console.log('');
    console.log('Sanity check — challenger win rate by seat assignment:');
    console.log(`  When challenger=A:  ${byTeam[0].won}/${byTeam[0].played}  (${pct(byTeam[0].won, byTeam[0].played)})`);
    console.log(`  When challenger=B:  ${byTeam[1].won}/${byTeam[1].played}  (${pct(byTeam[1].won, byTeam[1].played)})`);
    console.log('  (Large gap = residual seat bias; A/B alternation should keep these close.)');
    console.log('');

    // Interpretation hint
    const lower = p - ci95;
    const upper = p + ci95;
    if (lower > 0.5) {
        console.log(`Verdict: Challenger is BETTER (95% CI [${(100*lower).toFixed(1)}%, ${(100*upper).toFixed(1)}%], excludes 50%).`);
    } else if (upper < 0.5) {
        console.log(`Verdict: Challenger is WORSE (95% CI [${(100*lower).toFixed(1)}%, ${(100*upper).toFixed(1)}%], excludes 50%).`);
    } else {
        console.log(`Verdict: INCONCLUSIVE — 95% CI [${(100*lower).toFixed(1)}%, ${(100*upper).toFixed(1)}%] straddles 50%. Need more matches.`);
    }
    console.log('');
}

function reportInstrumentation(decisions) {
    const N = decisions.length;
    if (N === 0) return;

    // Priority breakdown
    const byPriority = {};
    for (const d of decisions) byPriority[d.priority] = (byPriority[d.priority] || 0) + 1;

    // Fallback-only: top-factor histogram, score margin distribution
    const fallback = decisions.filter(d => d.priority === 'fallback');
    const factorCounts = {};
    const factorTotals = {};
    const margins = [];
    const certainties = [];
    let usedMC = 0;
    for (const d of fallback) {
        if (d.topFactor) {
            factorCounts[d.topFactor] = (factorCounts[d.topFactor] || 0) + 1;
            factorTotals[d.topFactor] = (factorTotals[d.topFactor] || 0) + Math.abs(d.topFactorValue);
        }
        if (d.scoreMargin !== null && d.scoreMargin !== undefined) margins.push(d.scoreMargin);
        if (typeof d.certainty === 'number') certainties.push(d.certainty);
        if (d.usedMC) usedMC++;
    }

    // Blocking: prob distribution when fired
    const blocks = decisions.filter(d => d.priority === 'block');
    const blockProbs = blocks.map(d => d.blockProb).filter(p => typeof p === 'number');

    console.log('');
    console.log('═══════════════════════════════════════════════════════════');
    console.log(` Decision Instrumentation (${N} decisions across all matches)`);
    console.log('═══════════════════════════════════════════════════════════');
    console.log('');
    console.log('Priority breakdown (which path chose each move):');
    const priorityOrder = ['pass', 'only-move', 'winning', 'block', 'partner-support', 'fallback'];
    for (const k of priorityOrder) {
        if (byPriority[k]) {
            console.log(`  ${k.padEnd(20)} ${String(byPriority[k]).padStart(7)}  (${pct(byPriority[k], N)})`);
        }
    }

    console.log('');
    console.log('PRIORITY 2 (high-confidence block) when it fires:');
    if (blockProbs.length === 0) {
        console.log('  Never fired across all decisions.');
    } else {
        console.log(`  Fired ${blocks.length} times (${pct(blocks.length, N)})`);
        console.log(`  blockProb  mean=${avg(blockProbs).toFixed(3)} median=${median(blockProbs).toFixed(3)} min=${minOf(blockProbs).toFixed(3)} max=${maxOf(blockProbs).toFixed(3)}`);
    }

    console.log('');
    console.log('FALLBACK path — which scoring factor dominated:');
    const sortedFactors = Object.entries(factorCounts).sort(([, a], [, b]) => b - a);
    for (const [factor, count] of sortedFactors) {
        const avgWhenTop = factorTotals[factor] / count;
        console.log(`  ${factor.padEnd(22)} ${String(count).padStart(7)} (${pct(count, fallback.length)})  avg |value| when top: ${avgWhenTop.toFixed(1)}`);
    }

    console.log('');
    console.log('FALLBACK path — score margin (top - second):');
    if (margins.length > 0) {
        margins.sort((a, b) => a - b);
        console.log(`  mean=${avg(margins).toFixed(2)}  median=${median(margins).toFixed(2)}`);
        console.log(`  p10=${margins[Math.floor(margins.length * 0.1)].toFixed(2)}  p90=${margins[Math.floor(margins.length * 0.9)].toFixed(2)}`);
        const closeCalls = margins.filter(m => m < 1).length;
        console.log(`  Close calls (margin < 1.0): ${closeCalls} (${pct(closeCalls, margins.length)}) — these are decisions where the top move barely beat the alternative`);
    }

    console.log('');
    console.log('FALLBACK path — decision flexibility (available unpredictability):');
    const with5 = fallback.filter(d => d.movesWithin5 >= 2).length;
    const with10 = fallback.filter(d => d.movesWithin10 >= 2).length;
    const avgBand5 = avg(fallback.map(d => d.movesWithin5 || 1));
    const avgBand10 = avg(fallback.map(d => d.movesWithin10 || 1));
    console.log(`  Decisions with ≥2 moves within 5 pts:   ${with5} (${pct(with5, fallback.length)})  avg band size ${avgBand5.toFixed(2)}`);
    console.log(`  Decisions with ≥2 moves within 10 pts:  ${with10} (${pct(with10, fallback.length)})  avg band size ${avgBand10.toFixed(2)}`);
    console.log('  (Higher = more near-equal moves = more unpredictability available at ~no cost.)');

    console.log('');
    console.log(`MC evaluator activity (fallback only):`);
    console.log(`  Decisions using MC:    ${usedMC} / ${fallback.length} (${pct(usedMC, fallback.length)})`);
    if (certainties.length > 0) {
        console.log(`  Certainty   mean=${avg(certainties).toFixed(3)}  median=${median(certainties).toFixed(3)}`);
    }
    console.log('');
}

function reportClosing(closes) {
    const N = closes.length;
    console.log('');
    console.log('═══════════════════════════════════════════════════════════');
    console.log(` Closing Effectiveness (${N} closed hands)`);
    console.log('═══════════════════════════════════════════════════════════');
    console.log('');
    if (N === 0) {
        console.log('  No closed hands recorded.');
        console.log('');
        return;
    }

    const summarize = (label, subset) => {
        if (subset.length === 0) {
            console.log(`  ${label.padEnd(26)} 0 hands`);
            return;
        }
        const wins = subset.filter(c => c.closerWon).length;
        const ties = subset.filter(c => c.isTie).length;
        const margins = subset.map(c => c.pipMargin);
        const aheadOnPips = subset.filter(c => c.pipMargin > 0).length;
        console.log(`  ${label}`);
        console.log(`    Count:              ${subset.length}  (${pct(subset.length, N)} of closes)`);
        console.log(`    Closer win rate:    ${wins}/${subset.length}  (${pct(wins, subset.length)})`);
        console.log(`    Ties (→ closer):    ${ties}  (${pct(ties, subset.length)})`);
        console.log(`    Closer ahead pips:  ${aheadOnPips}/${subset.length}  (${pct(aheadOnPips, subset.length)})`);
        console.log(`    Pip margin (closer−opp):  mean=${avg(margins).toFixed(1)}  median=${median(margins).toFixed(1)}`);
    };

    const allWins = closes.filter(c => c.closerWon).length;
    console.log(`Overall closer win rate:  ${allWins}/${N}  (${pct(allWins, N)})`);
    console.log('  (Note: closer wins ties by rule, so a fair-coin pip outcome should yield >50%.)');
    console.log('');

    const offensive = closes.filter(c => c.closeType === 'offensive');
    const defensive = closes.filter(c => c.closeType === 'defensive');
    const incidental = closes.filter(c => c.closeType === 'incidental');

    summarize('OFFENSIVE close (deliberate cuadrar block, pip advantage):', offensive);
    console.log('');
    summarize('DEFENSIVE close (deliberate cuadrar block, stop a domino):', defensive);
    console.log('');
    summarize('INCIDENTAL close (board sealed via normal play, no block):', incidental);
    console.log('');
}

// ─────────────────────────────────────────────────────────────────────────────
// Probability prediction accuracy (backlog item 0c).
// At each play, snapshot every PlayerView's belief about who holds every
// not-yet-played, not-own tile. Score Brier and log-loss against ground truth
// (the actual hands at snapshot time). Bucket by tiles-played to see whether
// inference sharpens, plateaus, or degrades as the hand progresses; and split
// partner-vs-opponent to see whether the AI models its own team's holdings
// differently from the other team.
// ─────────────────────────────────────────────────────────────────────────────

class ProbAccumulator {
    constructor() {
        this.total = { brier: 0, ll: 0, n: 0 };
        this.byBucket = new Map();        // bucket → { brier, ll, n }
        this.byBucketRel = new Map();     // `${bucket}-${rel}` → { brier, ll, n }
        this.byCalBin = new Map();        // 0..9 → { sumActual, sumPred, n }
    }

    _bumpAt(map, key, brier, ll) {
        let e = map.get(key);
        if (!e) { e = { brier: 0, ll: 0, n: 0 }; map.set(key, e); }
        e.brier += brier; e.ll += ll; e.n += 1;
    }

    add(tilesPlayed, relation, predicted, actual) {
        // tilesPlayed is in [0, 27]. Buckets of 4 give 7 bins (0-3, 4-7, …, 24-27).
        const bucket = Math.min(6, Math.floor(tilesPlayed / 4));
        const brier = (predicted - actual) ** 2;
        const pC = Math.min(0.9999, Math.max(0.0001, predicted));
        const ll = -(actual * Math.log(pC) + (1 - actual) * Math.log(1 - pC));

        this.total.brier += brier; this.total.ll += ll; this.total.n += 1;
        this._bumpAt(this.byBucket, bucket, brier, ll);
        this._bumpAt(this.byBucketRel, `${bucket}-${relation}`, brier, ll);

        const bin = Math.min(9, Math.floor(predicted * 10));
        let c = this.byCalBin.get(bin);
        if (!c) { c = { sumActual: 0, sumPred: 0, n: 0 }; this.byCalBin.set(bin, c); }
        c.sumActual += actual; c.sumPred += predicted; c.n += 1;
    }
}

function captureProbSnapshot(playerViews, state, accumulator) {
    const tilesPlayed = state.chain.size();
    for (let viewer = 0; viewer < 4; viewer++) {
        const view = playerViews[viewer];
        const partner = (viewer + 2) % 4;
        for (const tile of view.allTiles) {
            const key = tile.toKey();
            const loc = view.handTracker.knownLocations.get(key);
            if (loc === 'played') continue;
            // Skip tiles trivially known to the viewer (own hand). Viewer 0
            // also has full info on its own seat through ownTileKeys, so this
            // single check covers all four perspectives.
            if (view.ownTileKeys.has(key)) continue;
            for (let p = 0; p < 4; p++) {
                if (p === viewer) continue; // viewer never predicts about itself
                const predicted = view.getProbability(p, tile);
                const actual = state.hands[p].has(tile) ? 1 : 0;
                const relation = (p === partner) ? 'partner' : 'opponent';
                accumulator.add(tilesPlayed, relation, predicted, actual);
            }
        }
    }
}

function reportProbAccuracy(acc) {
    const total = acc.total;
    if (total.n === 0) return;
    console.log('');
    console.log('═══════════════════════════════════════════════════════════');
    console.log(` Probability Prediction Accuracy (${total.n.toLocaleString()} predictions)`);
    console.log('═══════════════════════════════════════════════════════════');
    console.log('');
    console.log('Overall:');
    console.log(`  Brier:    ${(total.brier / total.n).toFixed(4)}`);
    console.log(`  Log-loss: ${(total.ll / total.n).toFixed(4)}`);
    console.log('');

    console.log('Brier by tiles played (lower = sharper predictions):');
    console.log('  tiles    Brier      Log-loss   n');
    const buckets = [...acc.byBucket.keys()].sort((a, b) => a - b);
    for (const b of buckets) {
        const r = acc.byBucket.get(b);
        const range = `${b * 4}-${b * 4 + 3}`;
        console.log(`  ${range.padStart(5)}    ${(r.brier / r.n).toFixed(4)}     ${(r.ll / r.n).toFixed(4)}     ${r.n.toLocaleString()}`);
    }
    console.log('');

    console.log('Brier by tiles played, split partner vs opponent:');
    console.log('  tiles    Partner Brier (n)        Opponent Brier (n)');
    for (const b of buckets) {
        const pE = acc.byBucketRel.get(`${b}-partner`);
        const oE = acc.byBucketRel.get(`${b}-opponent`);
        const pStr = pE ? `${(pE.brier / pE.n).toFixed(4)} (${pE.n.toLocaleString()})` : '—';
        const oStr = oE ? `${(oE.brier / oE.n).toFixed(4)} (${oE.n.toLocaleString()})` : '—';
        const range = `${b * 4}-${b * 4 + 3}`;
        console.log(`  ${range.padStart(5)}    ${pStr.padStart(22)}    ${oStr.padStart(22)}`);
    }
    console.log('');

    console.log('Calibration (well-calibrated = mean predicted ≈ observed):');
    console.log('  Predicted bin   n         Mean predicted    Observed frequency');
    for (let bin = 0; bin < 10; bin++) {
        const c = acc.byCalBin.get(bin);
        const range = `${(bin * 10).toString().padStart(2)}–${bin * 10 + 10}%`;
        if (!c || c.n === 0) {
            console.log(`  ${range}        —          —                 —`);
            continue;
        }
        const meanP = (c.sumPred / c.n).toFixed(3);
        const obs = (c.sumActual / c.n).toFixed(3);
        const drift = (c.sumActual / c.n) - (c.sumPred / c.n);
        const driftStr = (drift >= 0 ? '+' : '') + drift.toFixed(3);
        console.log(`  ${range}    ${c.n.toLocaleString().padStart(9)}    ${meanP.padStart(13)}    ${obs.padStart(8)}   (drift ${driftStr})`);
    }
    console.log('');
}

// ─────────────────────────────────────────────────────────────────────────────
// Pip-advantage estimation accuracy.
// At each chooseMove, compare the AI's estimated pip advantage (from
// _estimateTeamPips) against the actual pip advantage derived directly from
// state.hands. The estimate drives offensive cuadrar decisions in
// _findHighConfidenceBlock — when the sign of the estimate is wrong, the AI
// closes when it shouldn't (or vice versa). Triggered when investigating real
// hands where an offensive cuadrar backfired.
// ─────────────────────────────────────────────────────────────────────────────

class PipAccumulator {
    constructor() {
        this.total = { sumErr: 0, sumSqErr: 0, n: 0, signMismatch: 0, falseProfitable: 0, profitableClaims: 0 };
        this.byBucket = new Map(); // bucket → same shape as total
    }

    _bump(map, key, errSigned, signMismatch, falseProfitable, claimedProfitable) {
        let e = map.get(key);
        if (!e) { e = { sumErr: 0, sumSqErr: 0, n: 0, signMismatch: 0, falseProfitable: 0, profitableClaims: 0 }; map.set(key, e); }
        e.sumErr += errSigned;
        e.sumSqErr += errSigned * errSigned;
        e.n += 1;
        e.signMismatch += signMismatch;
        e.falseProfitable += falseProfitable;
        e.profitableClaims += claimedProfitable;
    }

    add(tilesPlayed, estimated, actual) {
        const errSigned = estimated - actual;       // positive = estimate too optimistic for our team
        // "Sign mismatch": one side says cuadrar would help, the other says it would hurt.
        // Skip when actual is exactly 0 (a tie — closer wins by rule, no false signal).
        const signMismatch = (estimated > 0) !== (actual > 0) && actual !== 0 ? 1 : 0;
        // "False profitable": the failure mode in Mario's hand — AI says close is profitable
        // (estimated > 0) but reality says it isn't (actual <= 0).
        const claimedProfitable = estimated > 0 ? 1 : 0;
        const falseProfitable = estimated > 0 && actual <= 0 ? 1 : 0;

        this.total.sumErr += errSigned;
        this.total.sumSqErr += errSigned * errSigned;
        this.total.n += 1;
        this.total.signMismatch += signMismatch;
        this.total.profitableClaims += claimedProfitable;
        this.total.falseProfitable += falseProfitable;

        const bucket = Math.min(6, Math.floor(tilesPlayed / 4));
        this._bump(this.byBucket, bucket, errSigned, signMismatch, falseProfitable, claimedProfitable);
    }
}

function capturePipSnapshot(ai, playerViews, state, accumulator) {
    const currentPlayer = state.currentPlayer;
    const view = playerViews[currentPlayer];
    const estimate = ai._estimateTeamPips(state, currentPlayer, view);
    const partner = (currentPlayer + 2) % 4;
    const opps = [(currentPlayer + 1) % 4, (currentPlayer + 3) % 4];
    const actualMyTeamPips = state.hands[currentPlayer].pipCount() + state.hands[partner].pipCount();
    const actualOppPips = state.hands[opps[0]].pipCount() + state.hands[opps[1]].pipCount();
    const actualAdv = actualOppPips - actualMyTeamPips;
    accumulator.add(state.chain.size(), estimate.pipAdvantage, actualAdv);
}

function reportPipAccuracy(acc) {
    const t = acc.total;
    if (t.n === 0) return;
    console.log('');
    console.log('═══════════════════════════════════════════════════════════');
    console.log(` Pip-Advantage Estimation Accuracy (${t.n.toLocaleString()} snapshots)`);
    console.log('═══════════════════════════════════════════════════════════');
    console.log('');
    const meanErr = t.sumErr / t.n;
    const rmse = Math.sqrt(t.sumSqErr / t.n);
    const signMismatchRate = t.signMismatch / t.n;
    const falseProfitRate = t.profitableClaims > 0 ? t.falseProfitable / t.profitableClaims : 0;
    console.log('Overall:');
    console.log(`  Mean signed error (est − actual): ${meanErr >= 0 ? '+' : ''}${meanErr.toFixed(2)} pips  ${meanErr > 0 ? '(AI over-optimistic about own team)' : meanErr < 0 ? '(AI over-pessimistic about own team)' : ''}`);
    console.log(`  RMSE:                              ${rmse.toFixed(2)} pips`);
    console.log(`  Sign mismatch rate:                ${(signMismatchRate * 100).toFixed(1)}%  (= AI thinks cuadrar profitable but actually it isn't, or vice versa)`);
    console.log(`  False "profitable" rate:           ${(falseProfitRate * 100).toFixed(1)}%  (of ${t.profitableClaims.toLocaleString()} cases where AI said pipAdv > 0, this fraction actually had pipAdv ≤ 0)`);
    console.log('');
    console.log('By tiles played:');
    console.log('  tiles    mean err    RMSE     sign-mismatch    false-profitable    n');
    const buckets = [...acc.byBucket.keys()].sort((a, b) => a - b);
    for (const b of buckets) {
        const e = acc.byBucket.get(b);
        const me = (e.sumErr / e.n);
        const r = Math.sqrt(e.sumSqErr / e.n);
        const sm = (e.signMismatch / e.n) * 100;
        const fp = e.profitableClaims > 0 ? (e.falseProfitable / e.profitableClaims) * 100 : 0;
        const range = `${b * 4}-${b * 4 + 3}`;
        const meStr = (me >= 0 ? '+' : '') + me.toFixed(2);
        console.log(`  ${range.padStart(5)}    ${meStr.padStart(7)}     ${r.toFixed(2).padStart(5)}    ${sm.toFixed(1).padStart(7)}%        ${fp.toFixed(1).padStart(6)}%       ${e.n.toLocaleString()}`);
    }
    console.log('');
}

// ─────────────────────────────────────────────────────────────────────────────
// Max cerrado pip-haul tracker. See docs/MAX_CERRADO.md for context. Records
// the losing team's pip total at every cerrar ending. The accumulator gives
// us: overall max, distribution histogram, and a per-closing-value breakdown
// (the theoretical analysis predicts low-V cerrados produce the high tails).
// ─────────────────────────────────────────────────────────────────────────────

class CerradoAccumulator {
    constructor() {
        this.samples = [];
        this.maxLosingPips = -Infinity;
        this.maxSample = null;
    }
    add(sample) {
        this.samples.push(sample);
        if (sample.losingPips > this.maxLosingPips) {
            this.maxLosingPips = sample.losingPips;
            this.maxSample = sample;
        }
    }
}

function reportMaxCerrado(acc, totalHands, opts) {
    console.log('');
    console.log('═══════════════════════════════════════════════════════════');
    console.log(` Max cerrado pip haul (${acc.samples.length.toLocaleString()} cerrados / ${totalHands.toLocaleString()} hands)`);
    const modeTags = [];
    if (opts.cooperativeLosers) modeTags.push('cooperative-losers');
    if (opts.randomLosers) modeTags.push('random-losers');
    if (opts.forceCerrar) modeTags.push('force-cerrar');
    if (opts.maxDisparityDeals) modeTags.push('max-disparity-deals');
    if (modeTags.length === 0) {
        console.log(' Mode: adversarial (all seats master AI)');
    } else {
        console.log(` Mode: ${modeTags.join(' + ')}`);
    }
    console.log('═══════════════════════════════════════════════════════════');
    if (acc.samples.length === 0) {
        console.log('  No cerrados observed across all matches.');
        console.log('');
        return;
    }
    const pips = acc.samples.map(s => s.losingPips);
    const meanPips = avg(pips);
    const medPips = median(pips);
    const cerradoRate = acc.samples.length / totalHands;
    console.log('');
    console.log(`  Max losing-team pip haul:      ${acc.maxLosingPips}`);
    console.log(`  Mean:                          ${meanPips.toFixed(1)}`);
    console.log(`  Median:                        ${medPips.toFixed(1)}`);
    console.log(`  Cerrado rate:                  ${(cerradoRate * 100).toFixed(1)}% (${acc.samples.length} / ${totalHands} hands)`);
    console.log('');
    console.log('  Record cerrar that produced the max:');
    const m = acc.maxSample;
    console.log(`    losing initial → final pips: ${m.losingInitial ?? '—'} → ${m.losingPips} (dumped ${m.pipDump ?? '—'})`);
    console.log(`    winners initial → remaining: ${m.winnersInitial ?? '—'} → ${m.winnersRemaining ?? '—'}`);
    console.log(`    closed on V=${m.closingValue}  chain length: ${m.chainLength}  closing seat: ${m.closingPlayer}`);
    console.log('');
    // Pip-dump distribution and initial-pip correlation for losing team
    const samplesWithInitial = acc.samples.filter(s => s.losingInitial != null);
    if (samplesWithInitial.length > 0) {
        const initials = samplesWithInitial.map(s => s.losingInitial);
        const dumps = samplesWithInitial.map(s => s.pipDump);
        console.log(`  Losing-team initial pips:  mean ${avg(initials).toFixed(1)}  median ${median(initials).toFixed(1)}  max ${maxOf(initials)}`);
        console.log(`  Losing-team pip dump:      mean ${avg(dumps).toFixed(1)}  median ${median(dumps).toFixed(1)}  max ${maxOf(dumps)}`);
        // Bucket losing-team initial by deal heaviness and show mean haul
        console.log('');
        console.log('  Mean cerrar haul by losing-team initial deal:');
        const dealBuckets = new Map(); // floor(initial/10)*10 → { n, sumPips }
        for (const s of samplesWithInitial) {
            const b = Math.floor(s.losingInitial / 10) * 10;
            let e = dealBuckets.get(b);
            if (!e) { e = { n: 0, sumPips: 0, maxPips: 0 }; dealBuckets.set(b, e); }
            e.n++;
            e.sumPips += s.losingPips;
            if (s.losingPips > e.maxPips) e.maxPips = s.losingPips;
        }
        const dKeys = [...dealBuckets.keys()].sort((a, b) => a - b);
        console.log('    initial    n      mean haul   max haul');
        for (const b of dKeys) {
            const e = dealBuckets.get(b);
            console.log(`    ${b}–${b+9}    ${e.n.toString().padStart(4)}   ${(e.sumPips / e.n).toFixed(1).padStart(6)}     ${e.maxPips}`);
        }
        console.log('');
    }
    console.log('  Distribution (10-pt buckets):');
    const buckets = new Array(13).fill(0); // 0–9, 10–19, …, 110–119, 120+
    for (const p of pips) {
        const b = Math.min(12, Math.floor(p / 10));
        buckets[b]++;
    }
    for (let b = 0; b < buckets.length; b++) {
        if (buckets[b] === 0) continue;
        const lo = b * 10;
        const hi = b === 12 ? '+' : `–${b * 10 + 9}`;
        const range = `${lo.toString().padStart(3)}${hi}`.padEnd(7);
        const bar = '█'.repeat(Math.min(40, Math.round((buckets[b] / acc.samples.length) * 40)));
        console.log(`    ${range}  ${buckets[b].toString().padStart(5)}  ${bar}`);
    }
    console.log('');
    console.log('  Max by closing value V (lower V → heavier tails in theory):');
    const byV = new Map();
    for (const s of acc.samples) {
        let e = byV.get(s.closingValue);
        if (!e) { e = { max: -Infinity, n: 0, sumPips: 0 }; byV.set(s.closingValue, e); }
        if (s.losingPips > e.max) e.max = s.losingPips;
        e.n++;
        e.sumPips += s.losingPips;
    }
    console.log('    V    count    mean    max');
    for (let v = 0; v <= 6; v++) {
        const e = byV.get(v);
        if (!e) { console.log(`    ${v}    ${'—'.padStart(5)}    ${'—'.padStart(4)}    —`); continue; }
        console.log(`    ${v}    ${e.n.toString().padStart(5)}    ${(e.sumPips / e.n).toFixed(1).padStart(4)}    ${e.max}`);
    }
    // Partition breakdown (only when --max-disparity-deals is in use).
    const samplesWithPartition = acc.samples.filter(s => s.partition != null);
    if (samplesWithPartition.length > 0) {
        console.log('');
        console.log('  Max by partition (which 2 of the 4 pip-6 tiles are in team B):');
        const byPart = new Map();
        for (const s of samplesWithPartition) {
            let e = byPart.get(s.partition);
            if (!e) { e = { max: -Infinity, n: 0, sumPips: 0 }; byPart.set(s.partition, e); }
            if (s.losingPips > e.max) e.max = s.losingPips;
            e.n++;
            e.sumPips += s.losingPips;
        }
        const partKeys = [...byPart.keys()].sort();
        console.log('    heavy pip-6   count   mean    max');
        for (const k of partKeys) {
            const e = byPart.get(k);
            console.log(`    ${k.padEnd(11)}   ${e.n.toString().padStart(5)}   ${(e.sumPips / e.n).toFixed(1).padStart(4)}    ${e.max}`);
        }
        // Group by whether 6|0 is in heavy. Theory predicts the 6|0-in-light group
        // hits the higher ceiling (~107-108 vs ~101) because team A holds all V=0 tiles.
        console.log('');
        console.log('  Max by partition group (6|0 location):');
        const inHeavy = samplesWithPartition.filter(s => s.sixZeroInHeavy);
        const inLight = samplesWithPartition.filter(s => !s.sixZeroInHeavy);
        const grpStats = arr => arr.length === 0 ? null : ({
            n: arr.length,
            mean: arr.reduce((s, x) => s + x.losingPips, 0) / arr.length,
            max: arr.reduce((m, x) => Math.max(m, x.losingPips), -Infinity),
        });
        const sH = grpStats(inHeavy);
        const sL = grpStats(inLight);
        if (sH) console.log(`    6|0 in heavy   n=${sH.n}  mean ${sH.mean.toFixed(1)}  max ${sH.max}   (theory ceiling ≈ 101)`);
        if (sL) console.log(`    6|0 in light   n=${sL.n}  mean ${sL.mean.toFixed(1)}  max ${sL.max}   (theory ceiling ≈ 107-108)`);
    }
    console.log('');
}

const opts = parseArgs(process.argv);
console.log(`Running ${opts.games} matches at difficulty=${opts.difficulty}${opts.ab ? ` (A/B: ${opts.variant})` : ''}${opts.allVariant ? ` (all-seats: ${opts.allVariant})` : ''}${opts.instrument ? ' (instrumented)' : ''}${opts.probAccuracy ? ' (prob-accuracy)' : ''}${opts.pipAccuracy ? ' (pip-accuracy)' : ''}${opts.maxCerrado ? ' (max-cerrado)' : ''}${opts.cooperativeLosers ? ' (coop-losers)' : ''}${opts.maxDisparityDeals ? ' (max-disparity)' : ''}...`);

const matches = [];
const decisions = opts.instrument ? [] : null;
const closes = opts.instrument ? [] : null;
const probAcc = opts.probAccuracy ? new ProbAccumulator() : null;
const pipAcc = opts.pipAccuracy ? new PipAccumulator() : null;
const cerradoAcc = opts.maxCerrado ? new CerradoAccumulator() : null;
const start = Date.now();
for (let i = 0; i < opts.games; i++) {
    if (!opts.verbose && (i + 1) % Math.max(1, Math.floor(opts.games / 10)) === 0) {
        process.stdout.write(`  ${i + 1}/${opts.games}\r`);
    }
    let perMatchOpts = opts;
    if (opts.ab) {
        // Alternate which team gets the challenger seats to cancel any
        // residual seat asymmetry.
        const challengerTeam = i % 2; // 0 = team A (seats 0,2), 1 = team B (seats 1,3)
        const challengerSeats = challengerTeam === 0 ? [0, 2] : [1, 3];
        perMatchOpts = { ...opts, challengerSeats, challengerTeam, variant: opts.variant };
    }
    if (decisions) perMatchOpts = { ...perMatchOpts, decisionSink: decisions, closeSink: closes };
    if (probAcc) perMatchOpts = { ...perMatchOpts, probAcc };
    if (pipAcc) perMatchOpts = { ...perMatchOpts, pipAcc };
    if (cerradoAcc) perMatchOpts = { ...perMatchOpts, cerradoAcc };
    if (opts.cooperativeLosers) perMatchOpts = { ...perMatchOpts, cooperativeLosers: true };
    if (opts.maxDisparityDeals) perMatchOpts = { ...perMatchOpts, maxDisparityDeals: true };
    if (opts.randomLosers) perMatchOpts = { ...perMatchOpts, randomLosers: true };
    if (opts.forceCerrar) perMatchOpts = { ...perMatchOpts, forceCerrar: true };
    matches.push(runMatch(perMatchOpts));
}
const elapsed = (Date.now() - start) / 1000;
console.log(`\nCompleted in ${elapsed.toFixed(1)}s (${(elapsed / opts.games).toFixed(2)}s per match)`);

report(aggregate(matches), opts);
if (opts.ab) reportAB(matches, opts.variant);
if (opts.instrument) reportInstrumentation(decisions);
if (opts.instrument) reportClosing(closes);
if (opts.probAccuracy) reportProbAccuracy(probAcc);
if (opts.pipAccuracy) reportPipAccuracy(pipAcc);
if (opts.maxCerrado) {
    const totalHands = matches.reduce((s, m) => s + m.handResults.length, 0);
    reportMaxCerrado(cerradoAcc, totalHands, opts);
}
