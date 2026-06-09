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

const VARIANTS = ['mc-pass', 'no-def-close', 'def-close-1', 'pip-close', 'lookahead2', 'rand5', 'rand10'];

function parseArgs(argv) {
    const opts = { games: 50, difficulty: 'master', verbose: false, ab: false, instrument: false, probAccuracy: false, variant: 'mc-pass', allVariant: null };
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

function initTrackersForHand(handTracker, playerViews, state) {
    handTracker.initHand(state.hands[0]);
    for (let i = 0; i < 4; i++) {
        playerViews[i].resetAffinities();
        playerViews[i].initOwnHand(state.hands[i]);
    }
}

function runMatch({ verbose, difficulty, challengerSeats = null, challengerTeam = null, variant = null, allVariant = null, decisionSink = null, closeSink = null, probAcc = null }) {
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
    initTrackersForHand(handTracker, playerViews, game.getState());

    const aiTimings = [];
    let safetyTicks = 0;
    const MAX_TICKS = 200000; // generous; a normal match is well under this

    while (matchResult === null && safetyTicks++ < MAX_TICKS) {
        const state = game.getState();

        if (state.gamePhase === 'playing') {
            if (probAcc) captureProbSnapshot(playerViews, state, probAcc);
            const t0 = process.hrtime.bigint();
            const move = ai.chooseMove(state, state.currentPlayer);
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
            initTrackersForHand(handTracker, playerViews, game.getState());
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

const opts = parseArgs(process.argv);
console.log(`Running ${opts.games} matches at difficulty=${opts.difficulty}${opts.ab ? ` (A/B: ${opts.variant})` : ''}${opts.allVariant ? ` (all-seats: ${opts.allVariant})` : ''}${opts.instrument ? ' (instrumented)' : ''}${opts.probAccuracy ? ' (prob-accuracy)' : ''}...`);

const matches = [];
const decisions = opts.instrument ? [] : null;
const closes = opts.instrument ? [] : null;
const probAcc = opts.probAccuracy ? new ProbAccumulator() : null;
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
    matches.push(runMatch(perMatchOpts));
}
const elapsed = (Date.now() - start) / 1000;
console.log(`\nCompleted in ${elapsed.toFixed(1)}s (${(elapsed / opts.games).toFixed(2)}s per match)`);

report(aggregate(matches), opts);
if (opts.ab) reportAB(matches, opts.variant);
if (opts.instrument) reportInstrumentation(decisions);
if (opts.instrument) reportClosing(closes);
if (opts.probAccuracy) reportProbAccuracy(probAcc);
