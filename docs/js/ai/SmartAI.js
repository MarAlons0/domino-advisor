import { Rules } from '../engine/Rules.js';
import { GameState } from '../models/GameState.js';
import { StrategicExplainer } from './StrategicExplainer.js';
import { MonteCarloEvaluator } from './MonteCarloEvaluator.js';
import { Hand } from '../models/Hand.js';

// Check for debug mode via URL parameter (?debug=ai)
const DEBUG_AI = new URLSearchParams(window.location.search).get('debug') === 'ai';

/**
 * SmartAI - An AI that follows strategic principles for partnership dominoes.
 *
 * Scoring factors (9):
 * 1. Suit Dominance - team control of the suit left open (-50 to +50)
 * 2. Double Management - unload doubles when you have cover
 * 3. Partner Support - support partner's lead (la salida)
 * 4. Own Suit Protection - don't kill your own signaled suit
 * 5. Firme Protection - preserve guaranteed plays on locked ends
 * 6. Blocking Potential - exploit opponent passes and inferred weaknesses
 * 7. Pip Management - prefer playing high-pip tiles early
 * 8. Hand Flexibility - maintain diverse playable values
 * 9. Pace Control - defensive/aggressive based on who's leading
 *
 * Priority Override System (v0.3):
 * Before weighted scoring, check priority conditions in order:
 * 1. Winning move (domino)
 * 2. High-confidence blocking (cuadrar with P > 0.7)
 * 3. Partner support (first 8 plays of hand)
 * Falls back to weighted scoring for all other decisions.
 *
 * Debug mode: Add ?debug=ai to URL to see AI decision logs in console.
 */
export class SmartAI {
    constructor() {
        this.explainer = new StrategicExplainer();
        this.handTracker = null; // Set by game controller
        this.playerViews = null; // Set by game controller (array of 4 PlayerViews)
        this.difficulties = ['master', 'master', 'master', 'master'];
        this.cerrarLog = []; // Session-wide cerrar decision outcomes (dev diagnostic)
        // Per-seat threshold for the "defensive close": take a P2 cuadrar block
        // at a pip disadvantage only when an opponent's tile count is at or below
        // this value. Default 2 = current behavior. 1 = only when an opponent has
        // a single tile left. 0 = never (disable defensive closing). Used by the
        // tournament harness to A/B the threshold.
        this.defensiveCloseThreshold = [2, 2, 2, 2];
        // Per-seat experiment flag: when true, that seat boosts pip-dumping in
        // the late game so it steers incidental (non-block) closes toward a pip
        // advantage. A/B'd via the tournament harness. Default false.
        this.pipAwareClose = [false, false, false, false];
        // Per-seat experiment flag: when true, the fallback path re-scores moves
        // with a 2-ply lookahead (my move + next opponent's adversarial reply on
        // the most-likely deal) instead of the Monte Carlo blend. Default false.
        this.useLookahead2 = [false, false, false, false];
        // Per-seat tolerance for move randomization: in the fallback path, pick
        // uniformly among moves whose finalScore is within this many points of
        // the top. Default 0 = always pick the single best move (deterministic).
        // Used to measure the self-play cost of unpredictability.
        this.randomizeTolerance = [0, 0, 0, 0];
        // Optional instrumentation hook; called at the end of chooseMove with a
        // structured record describing which decision path fired. Left null in
        // production so there's no overhead when nothing is listening.
        this.onDecision = null;
        this.resetForNewHand();

        if (DEBUG_AI) {
            console.log('%c🎲 AI Debug Mode Enabled', 'color: #00d4ff; font-weight: bold; font-size: 14px');
            console.log('AI decisions will be logged to console.');
        }
    }

    /**
     * Set the HandTracker reference for probability-based decisions
     * @param {HandTracker} tracker
     */
    setHandTracker(tracker) {
        this.handTracker = tracker;
        this.monteCarloEvaluator = new MonteCarloEvaluator(tracker);
    }

    /**
     * Set the per-player PlayerView array for perspective-aware probability lookups
     * @param {PlayerView[]} views - Array of 4 PlayerViews (index = player)
     */
    setPlayerViews(views) {
        this.playerViews = views;
    }

    setDifficulty(playerIndex, level) {
        this.difficulties[playerIndex] = level;
    }

    /**
     * Reset state for a new hand
     */
    resetForNewHand() {
        // Track the opening play (la salida) for each player
        this.playerSalida = [null, null, null, null];

        // Track suit counts: how many of each number (0-6) have been played
        // Each number appears on exactly 7 tiles in a double-six set
        this.suitCounts = [0, 0, 0, 0, 0, 0, 0]; // Index = suit value (0-6)

        // Track inferred "dead" suits for each player — PASSES ONLY (hard constraints)
        // Soft inferences from play choices are tracked separately in suitSkipCount
        this.inferredDeadSuits = [new Set(), new Set(), new Set(), new Set()];

        // Soft suit avoidance evidence: how many times each player bypassed playing
        // on a suit when they had the opportunity (and hadn't already passed on it).
        // suitSkipCount[player][value] — graduated, not binary.
        this.suitSkipCount = [
            new Array(7).fill(0),
            new Array(7).fill(0),
            new Array(7).fill(0),
            new Array(7).fill(0)
        ];

        // Track each player's "signaled" strong suit (from their plays)
        this.signaledSuits = [null, null, null, null];

        // Track if a player has "killed" their own signaled suit
        // Used for signal-reliability checks only — does NOT feed inferredDeadSuits
        this.killedOwnSuit = [false, false, false, false];

        // Track number of plays in this hand (for early-game priority rules)
        this.playCount = 0;

        // Pending cerrar decision for this hand (set when AI commits to cerrar, cleared at hand end)
        this._pendingCerrar = null;
    }

    /**
     * Update tracking when a tile is played.
     * Called by the game controller after each play.
     * @param {number} playerIndex - Who played
     * @param {Tile} tile - What they played
     * @param {string} end - Which end ('left' or 'right')
     * @param {number} leftEnd - Left end value before play (null if first play)
     * @param {number} rightEnd - Right end value before play (null if first play)
     */
    recordPlay(playerIndex, tile, end, leftEnd, rightEnd) {
        // Increment play count
        this.playCount++;

        // Update suit counts
        if (tile.isDouble()) {
            this.suitCounts[tile.high] += 2; // Double counts as 2 for that suit
        } else {
            this.suitCounts[tile.high]++;
            this.suitCounts[tile.low]++;
        }

        // First play of hand - record as salida
        if (leftEnd === null) {
            this.playerSalida[playerIndex] = tile.isDouble() ? tile.high : tile.high;
            this.signaledSuits[playerIndex] = this.playerSalida[playerIndex];
            return;
        }

        // Analyze play choice for inferences
        this.analyzePlayChoice(playerIndex, tile, end, leftEnd, rightEnd);
    }

    /**
     * Analyze a player's choice to make inferences about their hand.
     */
    analyzePlayChoice(playerIndex, tile, end, leftEnd, rightEnd) {
        // If both ends were the same, no choice was made
        if (leftEnd === rightEnd) return;

        // Which end did they play on?
        const playedOn = (end === 'left') ? leftEnd : rightEnd;
        const avoided = (end === 'left') ? rightEnd : leftEnd;

        // Get this player's signaled suit (before any updates)
        const signaledSuit = this.signaledSuits[playerIndex];

        // INFERENCE 0: CUADRAR - squaring the board is a strong suit signal
        // Cuadrar happens when the new end value introduced equals the other end
        // (doubles can never create cuadrar from a non-cuadrar board)
        let isCuadrar = false;
        if (!tile.isDouble()) {
            const newEndValue = tile.getOtherValue(playedOn);
            if (newEndValue === avoided) {
                isCuadrar = true;
                // Override signaled suit — cuadrar is a stronger commitment than salida
                this.signaledSuits[playerIndex] = avoided;
                // If they cuadrar on a previously killed suit, the earlier inference
                // was likely wrong — restore signal reliability and reset soft evidence
                if (this.killedOwnSuit[playerIndex] && signaledSuit === avoided) {
                    this.killedOwnSuit[playerIndex] = false;
                    this.suitSkipCount[playerIndex][avoided] = 0;
                }
            }
        }

        // INFERENCE 1: If they avoided their own signaled suit, they might be out
        // Only applies if the tile COULD have played on the signaled suit end
        // (i.e., the tile has a value matching the avoided end)
        // Skip if this was a cuadrar — cuadrar on the signaled suit reinforces it,
        // and cuadrar on a different suit updates the signal rather than killing it
        if (!isCuadrar &&
            signaledSuit !== null &&
            avoided === signaledSuit &&
            playedOn !== signaledSuit &&
            tile.hasValue(avoided)) {
            // They had a choice to play on their signaled suit but chose not to
            // Mark signal as unreliable; accumulate soft evidence (not a hard inference)
            this.killedOwnSuit[playerIndex] = true;
            this.suitSkipCount[playerIndex][signaledSuit]++;
        }

        // Compute partner context (shared by INFERENCE 2, 2b, and 2c below)
        const partnerIndex = GameState.getPartner(playerIndex);
        const partnerSuit = this.signaledSuits[partnerIndex];

        // INFERENCE 2: General end-choice soft evidence
        // Every time a player ends up NOT playing on the avoided end, it is soft
        // evidence they may lack tiles for that suit. Weighted by team context:
        //   - Playing on partner's suit end (expected team support) → skip, no new info
        //   - Avoiding partner's suit end (surprising choice) → stronger evidence (+1)
        //   - Neither end is partner's suit (neutral) → moderate evidence (+0.5)
        //
        // Guards:
        //   - Skip if suit already confirmed absent via pass (no new information)
        //   - Skip if suit nearly dead (≤1 tile remaining — unremarkable not to have it)
        //   - Skip if cuadrar (the play IS on the avoided end's value, introduced as newEnd)
        if (!isCuadrar && !this.inferredDeadSuits[playerIndex].has(avoided)) {
            const remainingInAvoided = this.getRemainingInSuit(avoided);
            if (remainingInAvoided >= 2) {
                if (playedOn === partnerSuit) {
                    // Expected team play — not informative about avoided suit
                } else if (avoided === partnerSuit) {
                    // Surprising: avoided partner's suit end — stronger soft evidence
                    this.suitSkipCount[playerIndex][avoided] += 1;
                } else {
                    // Neutral — moderate soft evidence
                    this.suitSkipCount[playerIndex][avoided] += 0.5;
                }

                // INFERENCE 2b: Team-contextual affinity signal to PlayerViews.
                // Only fires when the tile actually had the avoided suit (real choice was made).
                // Replaces the context-free 0.85× that PlayerView.recordPlayObservation()
                // previously applied for end-avoidance — now weighted by partnership context:
                //   playedOn === partnerSuit → 1.0 (expected play, no negative signal)
                //   avoided === partnerSuit  → 0.70 (surprising avoidance, stronger signal)
                //   neutral                  → 0.85 (standard signal)
                if (this.playerViews && tile.hasValue(avoided)) {
                    const multiplier = (playedOn === partnerSuit) ? 1.0
                                     : (avoided === partnerSuit)  ? 0.70
                                     : 0.85;
                    if (multiplier !== 1.0) {
                        for (const view of this.playerViews) {
                            view.applyAffinitySignal(playerIndex, avoided, multiplier);
                        }
                    }
                }
            }
        }

        // INFERENCE 2c: Cuadrar affinity boost.
        // recordPlayObservation() already applies 1.2× for the value introduced;
        // cuadrar is a stronger commitment (both ends now show that value) so we
        // add an extra 1.3× on top — combined effect ≈ 1.56× for the cuadrar suit.
        if (isCuadrar && this.playerViews) {
            for (const view of this.playerViews) {
                view.applyAffinitySignal(playerIndex, avoided, 1.3);
            }
        }

        // INFERENCE 3: Update their signaled suit based on what they're playing
        // Skip if cuadrar already updated the signal
        if (!isCuadrar && !tile.isDouble()) {
            const newEnd = tile.getOtherValue(playedOn);
            if (newEnd !== -1 && this.signaledSuits[playerIndex] === null) {
                // First non-double play, establish signal with the value introduced
                this.signaledSuits[playerIndex] = newEnd;
            }
        }
    }

    /**
     * Record when a player passes.
     */
    recordPass(playerIndex, leftEnd, rightEnd) {
        // Player couldn't play on either end
        this.inferredDeadSuits[playerIndex].add(leftEnd);
        if (rightEnd !== leftEnd) {
            this.inferredDeadSuits[playerIndex].add(rightEnd);
        }
    }

    /**
     * Check if a suit is "dead" (all 7 tiles played).
     */
    isSuitDead(suit) {
        return this.suitCounts[suit] >= 7;
    }

    /**
     * Check if a suit is "nearly dead" (6 tiles played, only 1 left).
     */
    isSuitNearlyDead(suit) {
        return this.suitCounts[suit] >= 6;
    }

    /**
     * Get remaining tiles in a suit.
     */
    getRemainingInSuit(suit) {
        return 7 - this.suitCounts[suit];
    }

    /**
     * Check if a player has hard-confirmed absence of a suit (from passes only).
     * For soft avoidance evidence use suitSkipCount[player][suit] directly.
     */
    playerLacksSuit(playerIndex, suit) {
        return this.inferredDeadSuits[playerIndex].has(suit);
    }

    /**
     * Choose the best move for the AI player.
     * Uses priority override system before falling back to weighted scoring.
     *
     * Priority order:
     * 1. Winning move (domino)
     * 2. Cerrar (close) when probability-weighted pip edge favors our team
     * 3. High-confidence blocking (cuadrar with P > 0.7)
     * 4. Partner support (first 8 plays)
     * 5. Weighted scoring (fallback)
     *
     * @param {GameState} gameState - The current game state
     * @param {number} playerIndex - Which player the AI is playing as
     * @returns {{tile: Tile, end: string, reasoning: string}|null}
     */
    chooseMove(gameState, playerIndex) {
        const hand = gameState.hands[playerIndex];
        const chain = gameState.chain;
        const mustPlayDoubleSix = gameState.isFirstHand && chain.isEmpty();
        const playerName = GameState.getPlayerName(playerIndex);

        // Use per-player view if available, fall back to shared HandTracker
        const activeView = this.playerViews?.[playerIndex] || this.handTracker;

        const validMoves = Rules.getValidMoves(hand, chain, mustPlayDoubleSix);

        // Debug: Start decision log
        const debugInfo = DEBUG_AI ? {
            player: playerName,
            playerIndex,
            tilesInHand: hand.size(),
            playCount: this.playCount,
            validMoves: validMoves.length,
            priorities: {},
            scoredMoves: [],
            chosen: null,
            chosenReason: ''
        } : null;

        if (validMoves.length === 0) {
            if (DEBUG_AI) {
                this._logDebug({ ...debugInfo, chosen: 'PASS', chosenReason: 'No valid moves' }, activeView);
            }
            this._emitDecision({ playerIndex, priority: 'pass', validMovesCount: 0, handSize: hand.size(), playCount: this.playCount });
            return null; // Must pass
        }

        if (validMoves.length === 1) {
            const move = { ...validMoves[0], reasoning: 'Only valid move' };
            if (DEBUG_AI) {
                debugInfo.chosen = validMoves[0].tile.toString();
                debugInfo.chosenReason = 'Only valid move';
                this._logDebug(debugInfo, activeView);
            }
            this._emitDecision({ playerIndex, priority: 'only-move', validMovesCount: 1, handSize: hand.size(), playCount: this.playCount });
            return move;
        }

        if (this.difficulties[playerIndex] === 'beginner') {
            return this._chooseMoveSimple(gameState, playerIndex);
        }

        // PRIORITY 1: Check for winning move (domino)
        const winningMove = this._findWinningMove(validMoves, hand);
        if (DEBUG_AI) {
            debugInfo.priorities.winningMove = winningMove ? winningMove.tile.toString() : null;
        }
        if (winningMove) {
            if (DEBUG_AI) {
                debugInfo.chosen = winningMove.tile.toString();
                debugInfo.chosenReason = 'PRIORITY 1: Winning move (domino)';
                this._logDebug(debugInfo, activeView);
            }
            this._emitDecision({ playerIndex, priority: 'winning', validMovesCount: validMoves.length, handSize: hand.size(), playCount: this.playCount });
            return { ...winningMove, reasoning: 'Winning move - domino!' };
        }

        // PRIORITY 2: Cerrar — close the game when probability-weighted pip edge favors us
        const { move: cerrarMove, excludeCerrar } = this._findCerrarMove(validMoves, gameState, playerIndex, chain, activeView);
        if (DEBUG_AI) {
            debugInfo.priorities.cerrarMove = cerrarMove ? cerrarMove.tile.toString() : null;
            debugInfo.priorities.excludeCerrar = excludeCerrar;
        }
        if (cerrarMove) {
            if (DEBUG_AI) {
                debugInfo.scoredMoves = validMoves.map(move => {
                    const staticScore = this.scoreMove(move, gameState, playerIndex, activeView);
                    return {
                        tile: move.tile.toString(),
                        end: move.end,
                        staticTotal: staticScore.total,
                        factors: staticScore.factors,
                        isChosen: move.tile.equals(cerrarMove.tile) && move.end === cerrarMove.end
                    };
                }).sort((a, b) => b.staticTotal - a.staticTotal);
                debugInfo.chosen = cerrarMove.tile.toString();
                debugInfo.chosenReason = `PRIORITY 2: Cerrar (${cerrarMove.reasoning})`;
                this._logDebug(debugInfo, activeView);
            }
            return cerrarMove;
        }

        // If closing is unfavorable, exclude cerrar candidates from remaining evaluation
        const candidateMoves = excludeCerrar
            ? validMoves.filter(m => !this._willCerrar(m, chain))
            : validMoves;
        const evalMoves = candidateMoves.length > 0 ? candidateMoves : validMoves;

        // PRIORITY 3: Check for high-confidence blocking opportunity
        const blockingMove = this._findHighConfidenceBlock(evalMoves, gameState, playerIndex, chain, activeView);
        if (DEBUG_AI) {
            debugInfo.priorities.blockingMove = blockingMove ? {
                tile: blockingMove.tile.toString(),
                prob: blockingMove.blockProb
            } : null;
        }
        if (blockingMove) {
            if (DEBUG_AI) {
                debugInfo.scoredMoves = evalMoves.map(move => {
                    const staticScore = this.scoreMove(move, gameState, playerIndex, activeView);
                    return {
                        tile: move.tile.toString(),
                        end: move.end,
                        staticTotal: staticScore.total,
                        factors: staticScore.factors,
                        isChosen: move.tile.equals(blockingMove.tile) && move.end === blockingMove.end
                    };
                }).sort((a, b) => b.staticTotal - a.staticTotal);
                debugInfo.chosen = blockingMove.tile.toString();
                debugInfo.chosenReason = `PRIORITY 3: High-confidence block (P=${blockingMove.blockProb.toFixed(2)})`;
                this._logDebug(debugInfo, activeView);
            }
            this._emitDecision({ playerIndex, priority: 'block', validMovesCount: validMoves.length, blockProb: blockingMove.blockProb, blockType: blockingMove.blockType, pipAdvantage: blockingMove.pipAdvantage, handSize: hand.size(), playCount: this.playCount });
            return blockingMove;
        }

        // PRIORITY 4: Partner support in early game (first 8 plays)
        const partnerSupportMove = this._findPartnerSupportMove(evalMoves, gameState, playerIndex, chain, activeView);
        if (DEBUG_AI) {
            debugInfo.priorities.partnerSupport = partnerSupportMove ? partnerSupportMove.tile.toString() : null;
            debugInfo.priorities.partnerSupportActive = this.playCount < 8;
        }
        if (partnerSupportMove && this.playCount < 8) {
            if (DEBUG_AI) {
                debugInfo.scoredMoves = evalMoves.map(move => {
                    const staticScore = this.scoreMove(move, gameState, playerIndex, activeView);
                    return {
                        tile: move.tile.toString(),
                        end: move.end,
                        staticTotal: staticScore.total,
                        factors: staticScore.factors,
                        isChosen: move.tile.equals(partnerSupportMove.tile) && move.end === partnerSupportMove.end
                    };
                }).sort((a, b) => b.staticTotal - a.staticTotal);
                debugInfo.chosen = partnerSupportMove.tile.toString();
                debugInfo.chosenReason = 'PRIORITY 4: Partner support (early game)';
                this._logDebug(debugInfo, activeView);
            }
            this._emitDecision({ playerIndex, priority: 'partner-support', validMovesCount: validMoves.length, handSize: hand.size(), playCount: this.playCount });
            return partnerSupportMove;
        }

        // FALLBACK: Score each move with static scoring + Monte Carlo
        const scoredMoves = evalMoves.map(move => {
            const staticScore = this.scoreMove(move, gameState, playerIndex, activeView);
            return {
                ...move,
                score: staticScore,
                staticTotal: staticScore.total,
                mcResult: null,
                finalScore: staticScore.total,
                reasoning: ''
            };
        });

        // Apply Monte Carlo evaluation if available
        let certainty = 0;
        if (this.useLookahead2[playerIndex] && this.monteCarloEvaluator) {
            // 2-ply lookahead variant: re-score against the most-likely deal,
            // accounting for the next opponent's adversarial best reply.
            const mostLikely = this._mostLikelyHands(gameState, playerIndex, activeView);
            for (const move of scoredMoves) {
                const laValue = this._lookahead2Value(move, gameState, playerIndex, mostLikely);
                move.lookaheadValue = laValue;
                move.finalScore = move.staticTotal + laValue;
            }
        } else if (this.monteCarloEvaluator && this.handTracker) {
            certainty = this.monteCarloEvaluator.calculateCertainty(gameState, gameState.chain, activeView);

            for (const move of scoredMoves) {
                const mcOptions = this.difficulties[playerIndex] === 'experienced'
                    ? { maxDepth: 3, maxSamples: 50 } : {};
                const mcResult = this.monteCarloEvaluator.evaluateMove(move, gameState, playerIndex, activeView, mcOptions);
                move.mcResult = mcResult;

                // Blend static and MC scores based on certainty
                // Higher certainty = trust MC more
                // Normalize MC score to similar range as static (roughly -50 to 150)
                const normalizedMC = mcResult.score * 0.5;  // Scale factor

                move.finalScore = (1 - certainty) * move.staticTotal + certainty * normalizedMC;
            }
        }

        // Sort by final score descending
        scoredMoves.sort((a, b) => b.finalScore - a.finalScore);

        if (DEBUG_AI) {
            debugInfo.certainty = certainty;
            debugInfo.scoredMoves = scoredMoves.map(m => ({
                tile: m.tile.toString(),
                end: m.end,
                staticTotal: m.staticTotal,
                mcScore: m.mcResult ? m.mcResult.score.toFixed(1) : '-',
                finalScore: m.finalScore.toFixed(1),
                factors: m.score.factors
            }));
        }

        // Flexibility metric: how many moves are within a small band of the top
        // (i.e. how much "free" unpredictability is available at this decision).
        const topScore = scoredMoves[0].finalScore;
        const movesWithin5 = scoredMoves.filter(m => topScore - m.finalScore <= 5).length;
        const movesWithin10 = scoredMoves.filter(m => topScore - m.finalScore <= 10).length;

        // Optional move randomization: pick uniformly among moves within the
        // configured tolerance of the top score. Default tolerance 0 = best move.
        let bestMove = scoredMoves[0];
        const tol = this.randomizeTolerance[playerIndex];
        if (tol > 0 && scoredMoves.length > 1) {
            const band = scoredMoves.filter(m => topScore - m.finalScore <= tol);
            bestMove = band[Math.floor(Math.random() * band.length)];
        }
        // Use strategic explainer for rich reasoning
        bestMove.reasoning = this.explainer.explainBrief(
            bestMove,
            bestMove.score,
            gameState,
            playerIndex,
            this
        );

        if (DEBUG_AI) {
            debugInfo.chosen = bestMove.tile.toString();
            const mcInfo = bestMove.mcResult ?
                ` | MC: ${bestMove.mcResult.score.toFixed(1)} (cert: ${(certainty * 100).toFixed(0)}%)` : '';
            debugInfo.chosenReason = `FALLBACK: Best combined score (${bestMove.finalScore.toFixed(1)})${mcInfo}`;
            debugInfo.chosenExplanation = bestMove.reasoning;
            this._logDebug(debugInfo, activeView);
        }

        if (this.onDecision) {
            const topFactors = bestMove.score?.factors || {};
            let topFactor = null, topFactorValue = 0;
            for (const [k, v] of Object.entries(topFactors)) {
                if (Math.abs(v) > Math.abs(topFactorValue)) { topFactor = k; topFactorValue = v; }
            }
            const margin = scoredMoves.length > 1
                ? bestMove.finalScore - scoredMoves[1].finalScore
                : null;
            this._emitDecision({
                playerIndex,
                priority: 'fallback',
                validMovesCount: validMoves.length,
                topFactor,
                topFactorValue,
                scoreMargin: margin,
                topScore,
                movesWithin5,
                movesWithin10,
                certainty,
                usedMC: bestMove.mcResult !== null,
                handSize: hand.size(),
                playCount: this.playCount,
            });
        }

        return bestMove;
    }

    _emitDecision(record) {
        if (this.onDecision) this.onDecision(record);
    }

    /**
     * Build a single most-likely full deal: assign each unknown tile to the
     * player with the highest marginal probability, respecting tile counts.
     * The viewer keeps their real hand. Returns Map<playerIndex, Hand> for the
     * three non-viewer players.
     * @private
     */
    _mostLikelyHands(gameState, playerIndex, view) {
        const src = view || this.handTracker;
        const locations = src.knownLocations || this.handTracker.knownLocations;
        const players = [0, 1, 2, 3].filter(p => p !== playerIndex);
        const target = new Map(players.map(p => [p, this.handTracker.tileCounts[p]]));
        const hands = new Map(players.map(p => [p, new Hand()]));

        const unknown = [];
        for (const tile of this.handTracker.allTiles) {
            if (locations.get(tile.toKey()) === 'unknown') unknown.push(tile);
        }

        // Greedy: assign the most-confident (tile, player) pairings first.
        const cands = [];
        for (const tile of unknown) {
            for (const p of players) {
                const pr = src.getProbability(p, tile);
                if (pr > 0) cands.push({ tile, p, pr });
            }
        }
        cands.sort((a, b) => b.pr - a.pr);

        const assigned = new Set();
        for (const c of cands) {
            const key = c.tile.toKey();
            if (assigned.has(key)) continue;
            if (hands.get(c.p).size() >= target.get(c.p)) continue;
            hands.get(c.p).add(c.tile);
            assigned.add(key);
        }
        // Fill any leftover unknown tiles (capacity edge cases) into any open seat.
        for (const tile of unknown) {
            if (assigned.has(tile.toKey())) continue;
            for (const p of players) {
                if (hands.get(p).size() < target.get(p)) {
                    hands.get(p).add(tile);
                    assigned.add(tile.toKey());
                    break;
                }
            }
        }

        return hands;
    }

    /**
     * 2-ply lookahead value for a candidate move: apply the move on the
     * most-likely deal, then let the next opponent pick their adversarial best
     * reply (the one minimizing our team's position), and return the resulting
     * position value from our perspective. Terminal outcomes after our move are
     * scored directly.
     * @private
     */
    _lookahead2Value(move, gameState, playerIndex, mostLikelyHands) {
        const mce = this.monteCarloEvaluator;
        const simState = mce.createSimulatedState(gameState, mostLikelyHands, playerIndex);
        mce.applyMove(simState, playerIndex, move);

        // Terminal check after our move.
        for (let p = 0; p < 4; p++) {
            if (simState.hands[p].isEmpty()) {
                return mce.evaluateOutcome({ type: 'domino', winner: p, state: simState }, playerIndex);
            }
        }
        if (simState.chain.isClosed && simState.chain.isClosed()) {
            return mce.evaluateOutcome({ type: 'blocked', state: simState }, playerIndex);
        }

        // Next opponent's adversarial reply.
        const nextPlayer = simState.currentPlayer; // (playerIndex + 1) % 4 — always an opponent
        const replies = Rules.getValidMoves(simState.hands[nextPlayer], simState.chain, false);
        if (replies.length === 0) {
            // Opponent must pass; evaluate position as-is.
            return mce.evaluatePosition(simState, playerIndex);
        }

        let worstForUs = Infinity;
        for (const reply of replies) {
            const branch = this._cloneSimState(simState);
            mce.applyMove(branch, nextPlayer, reply);
            let value;
            const dominoer = branch.hands.findIndex(h => h.isEmpty());
            if (dominoer >= 0) {
                value = mce.evaluateOutcome({ type: 'domino', winner: dominoer, state: branch }, playerIndex);
            } else {
                value = mce.evaluatePosition(branch, playerIndex);
            }
            if (value < worstForUs) worstForUs = value;
        }
        return worstForUs;
    }

    /** Deep-clone a simulated state (hands + chain). @private */
    _cloneSimState(s) {
        return {
            hands: s.hands.map(h => h.clone()),
            chain: s.chain.clone(),
            currentPlayer: s.currentPlayer,
            passHistory: s.passHistory ? s.passHistory.map(set => new Set(set)) : [],
            consecutivePasses: s.consecutivePasses,
            gamePhase: s.gamePhase,
        };
    }

    /**
     * Simplified move selection for Beginner difficulty.
     * Only uses own hand + chain. Scores by how many remaining tiles connect
     * to the new open end after the move. Tie-break: higher pip count.
     * @private
     */
    _chooseMoveSimple(gameState, playerIndex) {
        const hand = gameState.hands[playerIndex];
        const chain = gameState.chain;
        const validMoves = Rules.getValidMoves(hand, chain);
        if (!validMoves.length) return null;
        if (validMoves.length === 1) return { ...validMoves[0], reasoning: 'Only valid move' };

        let best = validMoves[0], bestScore = -Infinity;
        for (const move of validMoves) {
            const playedValue = chain.isEmpty() ? null
                : (move.end === 'left' ? chain.leftEnd : chain.rightEnd);
            const newEnd = move.tile.isDouble() ? move.tile.high
                : (playedValue === move.tile.high ? move.tile.low : move.tile.high);
            const connecting = hand.getTiles()
                .filter(t => t !== move.tile && (t.high === newEnd || t.low === newEnd)).length;
            const score = connecting + move.tile.pipCount() * 0.1;
            if (score > bestScore) { bestScore = score; best = move; }
        }
        return { ...best, reasoning: 'Beginner: keep strongest suit open' };
    }

    /**
     * Log debug information to console
     * @private
     */
    _logDebug(info, activeView) {
        const playerColors = {
            0: '#00d4ff', // You - cyan
            1: '#ff6b6b', // Opp 1 - coral
            2: '#22c55e', // Partner - green
            3: '#ffa500'  // Opp 2 - orange
        };
        const color = playerColors[info.playerIndex] || '#fff';
        const src = activeView || this.handTracker;

        console.group(`%c🎲 AI Decision: ${info.player}`, `color: ${color}; font-weight: bold`);

        // Show whose view is being used
        if (activeView && activeView.playerIndex !== undefined) {
            const viewNames = ['You', 'Opp 1', 'Partner', 'Opp 2'];
            console.log(`%cView: ${viewNames[activeView.playerIndex]}`, 'color: #c084fc; font-style: italic');
        }

        // Basic info
        console.log(`Play #${info.playCount + 1} | Tiles in hand: ${info.tilesInHand} | Valid moves: ${info.validMoves}`);

        // Priority checks
        console.group('Priority Checks');
        console.log(`1. Winning move: ${info.priorities.winningMove || 'No'}`);
        console.log(`2. Cerrar: ${info.priorities.cerrarMove
            ? `Yes - ${info.priorities.cerrarMove}`
            : info.priorities.excludeCerrar ? 'Excluded (pip disadvantage)' : 'No'}`);
        console.log(`3. High-confidence block: ${info.priorities.blockingMove ?
            `Yes - ${info.priorities.blockingMove.tile} (P=${info.priorities.blockingMove.prob.toFixed(2)})` : 'No'}`);
        console.log(`4. Partner support: ${info.priorities.partnerSupport || 'No'} ${
            info.priorities.partnerSupportActive === false ? '(disabled after play 8)' : ''}`);
        console.groupEnd();

        // Certainty info (if Monte Carlo was used)
        if (info.certainty !== undefined) {
            console.log(`%cMonte Carlo: Certainty ${(info.certainty * 100).toFixed(1)}%`, 'color: #ffd93d');
        }

        // Probability view from active perspective
        if (src && info.playerIndex !== undefined) {
            console.groupCollapsed('Tile Probability View');

            // Show dead suits per player
            const playerNames = ['You', 'Opp 1', 'Partner', 'Opp 2'];
            const deadSuitsInfo = {};
            for (let p = 0; p < 4; p++) {
                const dead = Array.from(src.deadSuits[p]);
                if (dead.length > 0) {
                    deadSuitsInfo[playerNames[p]] = dead.sort().join(', ');
                }
            }
            if (Object.keys(deadSuitsInfo).length > 0) {
                console.log('Dead suits (from passes):');
                console.table(deadSuitsInfo);
            }

            // Suit affinity table (if activeView has affinities)
            if (activeView && activeView.getAffinities) {
                const affinities = activeView.getAffinities();
                const affinityTable = [];
                let hasNonDefault = false;
                for (let suit = 0; suit <= 6; suit++) {
                    const row = { 'Suit': suit };
                    for (let p = 0; p < 4; p++) {
                        const val = affinities[p][suit];
                        if (val !== 1.0) hasNonDefault = true;
                        row[playerNames[p]] = val === 1.0 ? '-' : val.toFixed(2);
                    }
                    affinityTable.push(row);
                }
                if (hasNonDefault) {
                    console.log('%cSuit Affinities (Bayesian):', 'color: #c084fc');
                    console.table(affinityTable);
                }
            }

            // Suit distribution: estimated count per suit per player
            const suitTable = [];
            for (let suit = 0; suit <= 6; suit++) {
                const row = { 'Suit': suit };
                const remaining = this.getRemainingInSuit(suit);
                row['Remaining'] = remaining;
                for (let p = 0; p < 4; p++) {
                    if (p === info.playerIndex) {
                        // Viewer: exact count from own hand
                        row[playerNames[p]] = '(self)';
                    } else {
                        row[playerNames[p]] = Math.round(this._estimateSuitCount(p, suit, undefined, src) * 10) / 10;
                    }
                }
                suitTable.push(row);
            }
            console.log('Estimated suit counts per player:');
            console.table(suitTable);

            // Most likely tiles per other player
            for (let p = 0; p <= 3; p++) {
                if (p === info.playerIndex) continue;
                const facts = src.getKnownFacts(p);
                const likely = src.getMostLikely(p, facts.tileCount);
                if (likely.length > 0) {
                    console.groupCollapsed(`${playerNames[p]} (${facts.tileCount} tiles, ${facts.possibleTileCount} possible)`);
                    console.table(likely.map(t => ({
                        'Tile': t.tile.toString(),
                        'P': Math.round(t.probability * 100) + '%'
                    })));
                    console.groupEnd();
                }
            }
            console.groupEnd();
        }

        // Scored moves table
        if (info.scoredMoves && info.scoredMoves.length > 0) {
            const hasMC = info.scoredMoves[0].mcScore !== undefined;
            const isPriorityChoice = info.scoredMoves[0].isChosen !== undefined;
            const label = isPriorityChoice ? 'All Move Scores (priority override active)' :
                          `Move Scores (sorted by ${hasMC ? 'final' : 'static'} score)`;
            console.group(label);

            if (hasMC) {
                // Show combined static + MC scores
                console.table(info.scoredMoves.map(m => ({
                    'Move': `${m.tile} (${m.end})${m.isChosen ? ' ✓' : ''}`,
                    'Static': m.staticTotal,
                    'MC': m.mcScore,
                    'Final': m.finalScore,
                    'Domin': Math.round(m.factors.suitDominance),
                    'Dbl': m.factors.doubleManagement,
                    'Partn': m.factors.partnerSupport,
                    'Own': m.factors.ownSuitProtection,
                    'Firme': m.factors.firmeProtection,
                    'OppSt': m.factors.oppSuitAvoidance,
                    'Block': m.factors.blockingPotential,
                    'Pip': Math.round(m.factors.pipManagement * 10) / 10,
                    'Flex': m.factors.handFlexibility,
                    'Pace': m.factors.paceControl
                })));
            } else {
                // Show static scores only
                console.table(info.scoredMoves.map(m => ({
                    'Move': `${m.tile} (${m.end})${m.isChosen ? ' ✓' : ''}`,
                    'Total': m.total || m.staticTotal,
                    'Domin': Math.round(m.factors.suitDominance),
                    'Dbl': m.factors.doubleManagement,
                    'Partn': m.factors.partnerSupport,
                    'Own': m.factors.ownSuitProtection,
                    'Firme': m.factors.firmeProtection,
                    'OppSt': m.factors.oppSuitAvoidance,
                    'Block': m.factors.blockingPotential,
                    'Pip': Math.round(m.factors.pipManagement * 10) / 10,
                    'Flex': m.factors.handFlexibility,
                    'Pace': m.factors.paceControl
                })));
            }
            console.groupEnd();
        }

        // Final decision
        console.log(`%c→ Chosen: ${info.chosen} | ${info.chosenReason}`, 'color: #22c55e; font-weight: bold');
        if (info.chosenExplanation) {
            console.log(`  Explanation: ${info.chosenExplanation}`);
        }

        console.groupEnd();
    }

    /**
     * Check whether a move would legally close (cerrar) the game.
     * Closing requires: both ends equal the same value after play AND that value
     * is dead (all 7 tiles with that value are on the chain).
     * @private
     */
    _willCerrar(move, chain) {
        if (chain.isEmpty()) return false;
        const { newLeftEnd, newRightEnd } = this._getEndsAfterPlay(move, chain);
        if (newLeftEnd !== newRightEnd) return false;
        // chain.countValue counts every tile (including doubles) as 1 for each of its
        // values, so playing this tile adds exactly 1 more instance of newLeftEnd.
        return chain.countValue(newLeftEnd) + 1 >= 7;
    }

    /**
     * Evaluate whether to cerrar (close) when a closing move exists.
     * Uses probability-weighted expected pip counts (Σ pipCount(t) × P(player holds t))
     * to estimate the team pip edge without needing to see opponents' cards.
     *
     * Returns:
     *   { move, excludeCerrar: false }  — a specific cerrar move to play
     *   { move: null, excludeCerrar: true }  — cerrar is bad; caller should filter it out
     *   { move: null, excludeCerrar: false } — too close to call; let normal scoring decide
     * @private
     */
    _findCerrarMove(validMoves, gameState, playerIndex, chain, view) {
        const cerrarMoves = validMoves.filter(m => this._willCerrar(m, chain));
        if (cerrarMoves.length === 0) return { move: null, excludeCerrar: false };

        const src = view || this.handTracker;
        const { pipAdvantage } = src
            ? this._estimateTeamPips(gameState, playerIndex, src)
            : { pipAdvantage: 0 };
        // pipAdvantage = E[oppTeamPips] - E[myTeamPips]; positive means we hold fewer pips

        const opponents = this.getOpponents(playerIndex);
        const minOppTiles = Math.min(
            gameState.hands[opponents[0]].size(),
            gameState.hands[opponents[1]].size()
        );

        if (DEBUG_AI) {
            console.log(
                `%c  Cerrar eval: expected pip edge ${pipAdvantage >= 0 ? '+' : ''}${Math.round(pipAdvantage)} | min opp tiles: ${minOppTiles}`,
                'color: #ffd93d'
            );
        }

        // Require a small minimum edge to avoid closing on near-ties (floating point noise)
        const MIN_EDGE = 3;

        if (pipAdvantage >= MIN_EDGE) {
            const best = cerrarMoves[0];
            this._pendingCerrar = { playerIndex, expectedPipEdge: pipAdvantage, defensive: false };
            return {
                move: { ...best, reasoning: `Cerrar — expected pip edge +${Math.round(pipAdvantage)}` },
                excludeCerrar: false
            };
        }

        if (pipAdvantage < -MIN_EDGE) {
            if (minOppTiles <= 2) {
                // Opponent is about to domino — defensive close beats conceding the hand
                const best = cerrarMoves[0];
                this._pendingCerrar = { playerIndex, expectedPipEdge: pipAdvantage, defensive: true };
                return {
                    move: { ...best, reasoning: `Defensive cerrar — opponent at ${minOppTiles} tile(s) (pip edge ${Math.round(pipAdvantage)})` },
                    excludeCerrar: false
                };
            }
            // Unfavorable: suppress cerrar moves so normal scoring ignores them
            return { move: null, excludeCerrar: true };
        }

        // Edge within ±MIN_EDGE: no strong signal, let weighted scoring decide
        return { move: null, excludeCerrar: false };
    }

    /**
     * Record the actual outcome of the pending cerrar decision.
     * Called from main.js when a hand ends with reason === 'closed'.
     *
     * @param {object} handData  - data from onHandEnd (winningTeam, points)
     * @param {Hand[]} hands     - final hands array (for actual pip counts)
     */
    finalizeCerrarOutcome(handData, hands) {
        if (!this._pendingCerrar) return;

        const { playerIndex, expectedPipEdge, defensive } = this._pendingCerrar;
        this._pendingCerrar = null;

        const closingTeam = GameState.getTeam(playerIndex);
        const won = handData.winningTeam === closingTeam;

        const team0Pips = hands[0].pipCount() + hands[2].pipCount();
        const team1Pips = hands[1].pipCount() + hands[3].pipCount();
        // actualPipEdge: E[opp] - E[mine], same sign convention as expectedPipEdge
        const actualPipEdge = closingTeam === 0
            ? team1Pips - team0Pips
            : team0Pips - team1Pips;

        const entry = {
            player: GameState.getPlayerName(playerIndex),
            expectedPipEdge,
            actualPipEdge,
            delta: actualPipEdge - expectedPipEdge,
            won,
            points: won ? handData.points : -handData.points,
            defensive
        };

        this.cerrarLog.push(entry);

        if (DEBUG_AI) {
            const sign = v => (v >= 0 ? '+' : '') + Math.round(v);
            const status = won ? '%c✓ WON' : '%c✗ LOST';
            const color = won ? 'color:#22c55e;font-weight:bold' : 'color:#ff6b6b;font-weight:bold';
            console.log(
                `%c🔒 Cerrar outcome [${entry.player}${defensive ? ' DEFENSIVE' : ''}]: ` +
                `${status} ${sign(entry.points)} pts | ` +
                `predicted edge ${sign(expectedPipEdge)} | actual ${sign(actualPipEdge)} | Δ ${sign(entry.delta)}`,
                'color:#ffd93d', color
            );
        }
    }

    /**
     * Log a summary of all cerrar decisions taken this match.
     * Only prints in ?debug=ai mode.
     */
    logCerrarSummary() {
        if (!DEBUG_AI || this.cerrarLog.length === 0) return;

        const wins = this.cerrarLog.filter(e => e.won).length;
        const avgExpected = this.cerrarLog.reduce((s, e) => s + e.expectedPipEdge, 0) / this.cerrarLog.length;
        const avgActual  = this.cerrarLog.reduce((s, e) => s + e.actualPipEdge, 0)  / this.cerrarLog.length;
        const avgDelta   = this.cerrarLog.reduce((s, e) => s + e.delta, 0)           / this.cerrarLog.length;
        const sign = v => (v >= 0 ? '+' : '') + v.toFixed(1);

        console.group('%c🔒 Cerrar Decision Summary', 'color:#ffd93d;font-weight:bold');
        console.table(this.cerrarLog.map(e => ({
            'Player':      e.player,
            'Defensive':   e.defensive ? 'Yes' : '',
            'Won':         e.won ? '✓' : '✗',
            'Points':      (e.points >= 0 ? '+' : '') + e.points,
            'Exp edge':    sign(e.expectedPipEdge),
            'Act edge':    sign(e.actualPipEdge),
            'Δ (act-pred)': sign(e.delta)
        })));
        console.log(
            `Total: ${this.cerrarLog.length} cerrar(s) | ` +
            `W/L: ${wins}/${this.cerrarLog.length - wins} | ` +
            `Avg expected edge: ${sign(avgExpected)} | Avg actual: ${sign(avgActual)} | Avg Δ: ${sign(avgDelta)}`
        );
        console.groupEnd();
    }

    /**
     * Find a winning move (playing last tile)
     * @private
     */
    _findWinningMove(validMoves, hand) {
        if (hand.size() !== 1) return null;

        // If we only have one tile, any valid move is a winning move
        return validMoves.length > 0 ? validMoves[0] : null;
    }

    /**
     * Estimate pip counts for each team using probability distributions.
     * Own hand is exact; other players are estimated from the active view.
     * @param {GameState} gameState
     * @param {number} playerIndex
     * @param {PlayerView|HandTracker} [view] - Probability source
     * @returns {{myTeamPips: number, oppTeamPips: number, pipAdvantage: number}}
     */
    _estimateTeamPips(gameState, playerIndex, view) {
        const src = view || this.handTracker;
        const partnerIndex = GameState.getPartner(playerIndex);
        const opponents = this.getOpponents(playerIndex);

        // Own hand: exact count
        const myPips = gameState.hands[playerIndex].getTiles()
            .reduce((sum, t) => sum + t.pipCount(), 0);

        // Other players: expected pips from probability distributions
        const estimatePips = (player) => {
            let expected = 0;
            for (const tile of src.allTiles) {
                const prob = src.getProbability(player, tile);
                expected += tile.pipCount() * prob;
            }
            return expected;
        };

        const partnerPips = estimatePips(partnerIndex);
        const opp1Pips = estimatePips(opponents[0]);
        const opp2Pips = estimatePips(opponents[1]);

        const myTeamPips = myPips + partnerPips;
        const oppTeamPips = opp1Pips + opp2Pips;

        return {
            myTeamPips,
            oppTeamPips,
            pipAdvantage: oppTeamPips - myTeamPips // positive = we have fewer pips (good to block)
        };
    }

    /**
     * Estimate how many tiles of a given suit a player holds.
     * Uses probability distributions from the active view.
     * @param {number} player - Player index (0-3)
     * @param {number} suitValue - The suit value (0-6)
     * @param {Set<string>} [excludeKeys] - Tile keys to exclude (e.g., current player's hand)
     * @param {PlayerView|HandTracker} [view] - Probability source
     * @returns {number} Expected count of tiles with this suit
     * @private
     */
    _estimateSuitCount(player, suitValue, excludeKeys, view) {
        const src = view || this.handTracker;
        if (!src) return 0;
        let expected = 0;
        for (const tile of src.allTiles) {
            if (!tile.hasValue(suitValue)) continue;
            if (excludeKeys && excludeKeys.has(tile.toKey())) continue;
            const prob = src.getProbability(player, tile);
            expected += prob;
        }
        return expected;
    }

    /**
     * Find a high-confidence blocking opportunity (cuadrar)
     * Only blocks when pip count favors our team, unless defensive necessity.
     * @param {Array} validMoves
     * @param {GameState} gameState
     * @param {number} playerIndex
     * @param {Chain} chain
     * @param {PlayerView|HandTracker} [view] - Probability source
     * @private
     */
    _findHighConfidenceBlock(validMoves, gameState, playerIndex, chain, view) {
        const src = view || this.handTracker;
        if (!src) return null;

        const opponents = this.getOpponents(playerIndex);
        const BLOCK_THRESHOLD = 0.7; // 70% confidence required

        let bestBlockMove = null;
        let bestBlockProb = 0;

        for (const move of validMoves) {
            // Determine what ends would be after this play
            const { newLeftEnd, newRightEnd } = this._getEndsAfterPlay(move, chain);

            // Check blocking probability against each opponent
            for (const opp of opponents) {
                const blockProb = src.getBlockingProbability(opp, newLeftEnd, newRightEnd);

                if (blockProb >= BLOCK_THRESHOLD && blockProb > bestBlockProb) {
                    bestBlockProb = blockProb;
                    bestBlockMove = {
                        ...move,
                        blockProb: blockProb,
                        reasoning: ''
                    };
                }
            }
        }

        if (!bestBlockMove) return null;

        // Pip check: only block if it benefits our team
        const { myTeamPips, oppTeamPips, pipAdvantage } = this._estimateTeamPips(gameState, playerIndex, src);
        const minOppTiles = Math.min(
            gameState.hands[opponents[0]].size(),
            gameState.hands[opponents[1]].size()
        );

        if (DEBUG_AI) {
            console.log(`%c  Block pip check: Our team ~${Math.round(myTeamPips)} vs Opponents ~${Math.round(oppTeamPips)} (advantage: ${pipAdvantage > 0 ? '+' : ''}${Math.round(pipAdvantage)})`,
                'color: #ffa500');
        }

        if (pipAdvantage > 0) {
            // We have fewer pips - blocking is profitable
            bestBlockMove.blockType = 'offensive';
            bestBlockMove.pipAdvantage = pipAdvantage;
            bestBlockMove.reasoning = `High-confidence block (${Math.round(bestBlockMove.blockProb * 100)}%) - pip advantage ~${Math.round(pipAdvantage)} pts`;
            return bestBlockMove;
        } else if (minOppTiles <= this.defensiveCloseThreshold[playerIndex]) {
            // Opponent about to win - block defensively even with pip disadvantage
            bestBlockMove.blockType = 'defensive';
            bestBlockMove.pipAdvantage = pipAdvantage;
            bestBlockMove.reasoning = `Defensive block (${Math.round(bestBlockMove.blockProb * 100)}%) - opponent about to domino (pip disadvantage ~${Math.round(-pipAdvantage)})`;
            return bestBlockMove;
        } else {
            // We have more pips - blocking would give opponents points
            if (DEBUG_AI) {
                console.log(`%c  Block REJECTED: pip disadvantage ~${Math.round(-pipAdvantage)} pts`,
                    'color: #ff6b6b');
            }
            return null;
        }
    }

    /**
     * Find a move that supports partner's signaled suit
     * @private
     */
    _findPartnerSupportMove(validMoves, gameState, playerIndex, chain, view) {
        const partnerIndex = GameState.getPartner(playerIndex);
        const partnerSuit = this.signaledSuits[partnerIndex];

        // No partner signal yet, or partner has killed their suit
        if (partnerSuit === null || this.killedOwnSuit[partnerIndex]) {
            return null;
        }

        // Find moves that leave partner's suit open
        const partnerSupportMoves = [];

        for (const move of validMoves) {
            const { newLeftEnd, newRightEnd } = this._getEndsAfterPlay(move, chain);

            // Check if this move leaves partner's suit as one of the open ends
            if (newLeftEnd === partnerSuit || newRightEnd === partnerSuit) {
                partnerSupportMoves.push(move);
            }
        }

        if (partnerSupportMoves.length === 0) {
            return null;
        }

        // If multiple moves support partner, pick the one with best weighted score
        if (partnerSupportMoves.length === 1) {
            return {
                ...partnerSupportMoves[0],
                reasoning: `Supporting partner's ${partnerSuit}s (la salida)`
            };
        }

        // Score the support moves and pick best
        const scoredMoves = partnerSupportMoves.map(move => ({
            ...move,
            score: this.scoreMove(move, gameState, playerIndex, view)
        }));
        scoredMoves.sort((a, b) => b.score.total - a.score.total);

        return {
            ...scoredMoves[0],
            reasoning: `Supporting partner's ${partnerSuit}s (la salida)`
        };
    }

    /**
     * Get the open ends after a hypothetical play
     * @private
     */
    _getEndsAfterPlay(move, chain) {
        if (chain.isEmpty()) {
            // First play - both ends are the tile values
            return {
                newLeftEnd: move.tile.low,
                newRightEnd: move.tile.high
            };
        }

        const currentLeftEnd = chain.leftEnd;
        const currentRightEnd = chain.rightEnd;

        if (move.end === 'left') {
            // Playing on left end
            const connectValue = currentLeftEnd;
            const newLeftEnd = move.tile.getOtherValue(connectValue);
            return {
                newLeftEnd: newLeftEnd === -1 ? connectValue : newLeftEnd,
                newRightEnd: currentRightEnd
            };
        } else {
            // Playing on right end
            const connectValue = currentRightEnd;
            const newRightEnd = move.tile.getOtherValue(connectValue);
            return {
                newLeftEnd: currentLeftEnd,
                newRightEnd: newRightEnd === -1 ? connectValue : newRightEnd
            };
        }
    }

    /**
     * Get AI recommendation for a player's move (used for evaluating human moves).
     * @param {GameState} gameState - The current game state
     * @param {number} playerIndex - Which player to evaluate for
     * @returns {{tile: Tile, end: string, reasoning: string, score: number}|null}
     */
    getRecommendation(gameState, playerIndex) {
        const hand = gameState.hands[playerIndex];
        const chain = gameState.chain;
        const mustPlayDoubleSix = gameState.isFirstHand && chain.isEmpty();

        const validMoves = Rules.getValidMoves(hand, chain, mustPlayDoubleSix);

        if (validMoves.length === 0) {
            return null; // Must pass
        }

        if (validMoves.length === 1) {
            const move = validMoves[0];
            const score = this.scoreMove(move, gameState, playerIndex);
            return {
                ...move,
                reasoning: 'Only valid move',
                score: score.total
            };
        }

        // Score each move and pick the best
        const scoredMoves = validMoves.map(move => ({
            ...move,
            score: this.scoreMove(move, gameState, playerIndex)
        }));

        // Sort by score descending
        scoredMoves.sort((a, b) => b.score.total - a.score.total);

        const bestMove = scoredMoves[0];
        // Use strategic explainer for rich reasoning
        const reasoning = this.explainer.explain(
            bestMove,
            bestMove.score,
            gameState,
            playerIndex,
            this
        );

        return {
            tile: bestMove.tile,
            end: bestMove.end,
            reasoning: reasoning,
            score: bestMove.score.total
        };
    }

    /**
     * Score a potential move based on strategic principles.
     * @param {object} move
     * @param {GameState} gameState
     * @param {number} playerIndex
     * @param {PlayerView|HandTracker} [view] - Probability source
     * @returns {{total: number, factors: object}}
     */
    scoreMove(move, gameState, playerIndex, view) {
        const { tile, end } = move;
        const hand = gameState.hands[playerIndex];
        const chain = gameState.chain;
        const partnerIndex = GameState.getPartner(playerIndex);

        const factors = {
            suitDominance: 0,
            doubleManagement: 0,
            partnerSupport: 0,
            ownSuitProtection: 0,
            firmeProtection: 0,
            oppSuitAvoidance: 0,
            blockingPotential: 0,
            pipManagement: 0,
            handFlexibility: 0,
            paceControl: 0
        };

        // Determine what end value we're leaving open after this play
        const currentEndValue = chain.isEmpty() ? null : (end === 'left' ? chain.leftEnd : chain.rightEnd);
        const newEndValue = chain.isEmpty() ? tile.high : tile.getOtherValue(currentEndValue);
        const opponents = this.getOpponents(playerIndex);

        // Team dynamics: who's leading (fewer tiles)?
        const myTiles = hand.size();
        const partnerTiles = gameState.hands[partnerIndex].size();
        const partnerLeading = partnerTiles < myTiles;
        const iAmLeading = myTiles < partnerTiles;

        // 1. SUIT DOMINANCE - team control of the suit left open
        // Uses HandTracker to estimate who holds the remaining tiles.
        // Range: -50 (opponents control suit) to +50 (we control suit)
        if (newEndValue !== null && newEndValue !== -1) {
            const myCount = this.countSuitInHand(hand, newEndValue);
            const remaining = this.getRemainingInSuit(newEndValue);
            if (remaining > 0) {
                const src = view || this.handTracker;
                if (src) {
                    // Exclude own tiles from estimates to prevent double-counting
                    // (myCount is exact; HandTracker doesn't know which computer player has what)
                    const myTileKeys = new Set(hand.getTiles().map(t => t.toKey()));
                    const partnerCount = this._estimateSuitCount(partnerIndex, newEndValue, myTileKeys, src);
                    const oppCount = this._estimateSuitCount(opponents[0], newEndValue, myTileKeys, src)
                                   + this._estimateSuitCount(opponents[1], newEndValue, myTileKeys, src);
                    const myTeamCount = myCount + partnerCount;
                    factors.suitDominance = ((myTeamCount - oppCount) / remaining) * 50;
                } else {
                    // Fallback without HandTracker: personal count only
                    factors.suitDominance = (myCount / remaining) * 50;
                }
            }
        }

        // 2. DOUBLE MANAGEMENT - prioritize playing doubles when you have cover
        if (tile.isDouble()) {
            const hasCover = this.hasCoverForDouble(hand, tile, chain);
            if (hasCover) {
                factors.doubleManagement = 25;
            } else {
                if (this.isSuitNearlyDead(tile.high)) {
                    factors.doubleManagement = 10; // Less risky, suit is drying up
                } else {
                    factors.doubleManagement = -15; // Risky
                }
            }
        }

        // 3. PARTNER SUPPORT - keep partner's signaled suit open on the board
        // Modulated by who's leading: amplify when partner leads, reduce when I lead
        const partnerSuit = this.signaledSuits[partnerIndex];
        if (partnerSuit !== null && !this.killedOwnSuit[partnerIndex] && !chain.isEmpty()) {
            const { newLeftEnd: pNewLeft, newRightEnd: pNewRight } = this._getEndsAfterPlay(move, chain);
            const partnerSuitStillOpen = (pNewLeft === partnerSuit || pNewRight === partnerSuit);
            const partnerSuitWasOpen = (chain.leftEnd === partnerSuit || chain.rightEnd === partnerSuit);

            if (partnerSuitStillOpen) {
                factors.partnerSupport = 20; // Good: partner's suit remains open
            } else if (partnerSuitWasOpen) {
                factors.partnerSupport = -25; // Bad: we killed partner's suit
            }

            // Adjust based on who's leading on the team
            if (partnerLeading) {
                // Partner is leading (fewer tiles) - amplify support
                factors.partnerSupport = Math.round(factors.partnerSupport * 1.5);
            } else if (iAmLeading) {
                // I'm leading - reduce support, focus on finishing
                factors.partnerSupport = Math.round(factors.partnerSupport * 0.5);
            }
        }

        // 4. OWN SUIT PROTECTION - protect your own salida/signaled suit
        // Also modulated: protect more when I'm leading, less when partner leads
        const ownSuit = this.signaledSuits[playerIndex];
        if (ownSuit !== null && !this.killedOwnSuit[playerIndex] && !chain.isEmpty()) {
            const { newLeftEnd, newRightEnd } = this._getEndsAfterPlay(move, chain);
            const ownSuitStillOpen = (newLeftEnd === ownSuit || newRightEnd === ownSuit);
            const ownSuitWasOpen = (chain.leftEnd === ownSuit || chain.rightEnd === ownSuit);

            if (ownSuitStillOpen) {
                factors.ownSuitProtection = 20;
            } else if (ownSuitWasOpen) {
                factors.ownSuitProtection = -25;
            }

            // When partner is leading, own suit matters less
            if (partnerLeading) {
                factors.ownSuitProtection = Math.round(factors.ownSuitProtection * 0.5);
            }
        }

        // 5. FIRME PROTECTION - preserve guaranteed plays on locked ends
        // A "firme" exists when you hold ALL remaining tiles of a suit on an open end
        if (!chain.isEmpty()) {
            const leftEnd = chain.leftEnd;
            const rightEnd = chain.rightEnd;

            // Check each open end for firme
            const checkFirme = (endValue) => {
                const myCount = this.countSuitInHand(hand, endValue);
                const remaining = this.getRemainingInSuit(endValue);
                return myCount > 0 && myCount === remaining;
            };

            const leftFirme = checkFirme(leftEnd);
            const rightFirme = checkFirme(rightEnd);

            if (leftFirme || rightFirme) {
                // We have a firme! Check if this move spends a firme tile
                const playingOnFirmeEnd =
                    (end === 'left' && leftFirme) || (end === 'right' && rightFirme);

                if (playingOnFirmeEnd) {
                    // Spending a firme tile - how many do we have left?
                    const firmeEnd = (end === 'left') ? leftEnd : rightEnd;
                    const firmeCount = this.countSuitInHand(hand, firmeEnd);

                    if (firmeCount <= 1) {
                        // Last firme tile - strong penalty (losing the firme entirely)
                        factors.firmeProtection = -35;
                    } else {
                        // Still have backup firme tiles - mild penalty
                        factors.firmeProtection = -10;
                    }
                } else {
                    // Playing on the other end, preserving firme - bonus
                    // Bigger bonus for stronger firme (more tiles = more guaranteed plays)
                    const firmeEnd = leftFirme ? leftEnd : rightEnd;
                    const firmeCount = this.countSuitInHand(hand, firmeEnd);
                    factors.firmeProtection = 10 + (firmeCount * 5); // 15-40 range
                }
            }
        }

        // 5b. OPPONENT SUIT AVOIDANCE - penalize leaving ends in opponents' strong suits
        if (!chain.isEmpty()) {
            const { newLeftEnd: avLeft, newRightEnd: avRight } = this._getEndsAfterPlay(move, chain);
            let oppSuitPenalty = 0;
            for (const opp of opponents) {
                const oppSuit = this.signaledSuits[opp];
                if (oppSuit === null || this.killedOwnSuit[opp]) continue;
                if (avLeft === oppSuit || avRight === oppSuit) {
                    oppSuitPenalty -= 20;
                }
            }
            factors.oppSuitAvoidance = oppSuitPenalty;
        }

        // 6. BLOCKING - exploit inferred weaknesses (passes + soft avoidance evidence)
        let blockingScore = 0;
        for (const opp of opponents) {
            const passedSuits = gameState.passHistory[opp];

            if (newEndValue !== null && newEndValue !== -1) {
                if (passedSuits.has(newEndValue)) {
                    // Hard evidence: opponent passed on this suit — strong block signal
                    blockingScore += 20;
                } else {
                    // Soft evidence: graduated by how many times opponent avoided this suit
                    const skipCount = this.suitSkipCount[opp][newEndValue];
                    if (skipCount > 0) {
                        blockingScore += Math.min(10, skipCount * 5);
                    }
                }
            }
        }
        factors.blockingPotential = blockingScore;

        // 7. PIP MANAGEMENT - prefer playing high-pip tiles early
        const tilesPlayed = chain.size();
        if (this.pipAwareClose[playerIndex]) {
            // Pip-aware variant: keep dumping heavies attractive through the
            // mid-game, and ramp it up sharply in the late game (≥16 tiles down,
            // ~3 tiles left per hand) when a close or block is likely and the
            // hand will be decided on remaining pips. This lets pipManagement
            // compete with suitDominance instead of being swamped by it.
            let mult;
            if (tilesPlayed < 10) mult = 1.5;
            else if (tilesPlayed < 16) mult = 1.5;
            else mult = 3.0;
            factors.pipManagement = tile.pipCount() * mult;
        } else if (tilesPlayed < 10) {
            factors.pipManagement = tile.pipCount() * 1.5;
        } else {
            factors.pipManagement = tile.pipCount() * 0.5;
        }

        // 8. HAND FLEXIBILITY - prefer moves that keep diverse playable values
        // More distinct values = harder to block
        const playableValues = new Set();
        for (const t of hand.getTiles()) {
            if (!t.equals(tile)) {
                playableValues.add(t.high);
                playableValues.add(t.low);
            }
        }
        factors.handFlexibility = playableValues.size * 3; // 0-21 range

        // 9. PACE CONTROL - adjust strategy based on who's closest to winning
        const minOppTiles = Math.min(
            gameState.hands[opponents[0]].size(),
            gameState.hands[opponents[1]].size()
        );

        if (minOppTiles <= 2) {
            // Opponent close to winning - defensive: leave values they lack
            const { newLeftEnd, newRightEnd } = this._getEndsAfterPlay(move, chain);
            let defenseScore = 0;
            for (const opp of opponents) {
                if (gameState.hands[opp].size() <= 2) {
                    if (this.playerLacksSuit(opp, newLeftEnd)) defenseScore += 10;
                    if (this.playerLacksSuit(opp, newRightEnd)) defenseScore += 10;
                }
            }
            factors.paceControl = defenseScore;
        } else if (partnerTiles <= 2) {
            // Partner close to winning - open the game for them
            if (!chain.isEmpty()) {
                const { newLeftEnd, newRightEnd } = this._getEndsAfterPlay(move, chain);
                const pSuit = this.signaledSuits[partnerIndex];
                // Bonus for leaving partner's suit open
                if (pSuit !== null && (newLeftEnd === pSuit || newRightEnd === pSuit)) {
                    factors.paceControl = 15;
                }
                // Also bonus if we're NOT blocking both ends for partner
                if (!this.playerLacksSuit(partnerIndex, newLeftEnd) ||
                    !this.playerLacksSuit(partnerIndex, newRightEnd)) {
                    factors.paceControl += 5;
                }
            }
        }

        // Calculate total score
        const total = Object.values(factors).reduce((sum, val) => sum + val, 0);

        return { total, factors };
    }

    /**
     * Generate a human-readable explanation for why this move was chosen.
     */
    explainMove(score) {
        const dominated = [];

        if (score.factors.suitDominance >= 25) dominated.push('suit dominance');
        if (score.factors.doubleManagement >= 20) dominated.push('unload double with cover');
        if (score.factors.doubleManagement < 0) dominated.push('risky double');
        if (score.factors.partnerSupport >= 15) dominated.push('support partner');
        if (score.factors.ownSuitProtection >= 15) dominated.push('protect own suit');
        if (score.factors.ownSuitProtection < -15) dominated.push('kills own suit');
        if (score.factors.firmeProtection >= 15) dominated.push('preserve firme');
        if (score.factors.firmeProtection < -15) dominated.push('spends firme');
        if (score.factors.oppSuitAvoidance <= -20) dominated.push('plays opponent suit');
        if (score.factors.blockingPotential >= 20) dominated.push('block opponent');
        if (score.factors.pipManagement >= 10) dominated.push('high pip tile');
        if (score.factors.handFlexibility >= 18) dominated.push('keeps flexibility');
        if (score.factors.paceControl >= 10) dominated.push('pace control');
        if (score.factors.paceControl < 0) dominated.push('defensive');

        if (dominated.length === 0) {
            return 'Best available option';
        }
        return dominated.join(', ');
    }

    /**
     * Count how many tiles in hand contain a given value.
     */
    countSuitInHand(hand, value) {
        return hand.getTiles().filter(t => t.hasValue(value)).length;
    }

    /**
     * Check if we have cover for playing a double.
     */
    hasCoverForDouble(hand, doubleTile, chain) {
        const value = doubleTile.high;
        const tilesWithValue = hand.getTiles().filter(t =>
            t.hasValue(value) && !t.equals(doubleTile)
        );
        return tilesWithValue.length > 0;
    }

    /**
     * Get opponent player indices.
     */
    getOpponents(playerIndex) {
        const team = GameState.getTeam(playerIndex);
        return team === 0 ? [1, 3] : [0, 2];
    }

    /**
     * Get the name of this AI for display purposes.
     */
    getName() {
        return 'Smart AI';
    }
}
