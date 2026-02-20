import { Rules } from '../engine/Rules.js';
import { GameState } from '../models/GameState.js';
import { StrategicExplainer } from './StrategicExplainer.js';
import { MonteCarloEvaluator } from './MonteCarloEvaluator.js';

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

    /**
     * Reset state for a new hand
     */
    resetForNewHand() {
        // Track the opening play (la salida) for each player
        this.playerSalida = [null, null, null, null];

        // Track suit counts: how many of each number (0-6) have been played
        // Each number appears on exactly 7 tiles in a double-six set
        this.suitCounts = [0, 0, 0, 0, 0, 0, 0]; // Index = suit value (0-6)

        // Track inferred "dead" suits for each player (suits they likely don't have)
        // This goes beyond just passes - includes inferences from play choices
        this.inferredDeadSuits = [new Set(), new Set(), new Set(), new Set()];

        // Track each player's "signaled" strong suit (from their plays)
        this.signaledSuits = [null, null, null, null];

        // Track if a player has "killed" their own signaled suit
        this.killedOwnSuit = [false, false, false, false];

        // Track number of plays in this hand (for early-game priority rules)
        this.playCount = 0;
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
                // was likely wrong — restore it
                if (this.killedOwnSuit[playerIndex] && signaledSuit === avoided) {
                    this.killedOwnSuit[playerIndex] = false;
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
            // This suggests they may be out of that suit
            this.killedOwnSuit[playerIndex] = true;
            this.inferredDeadSuits[playerIndex].add(signaledSuit);
        }

        // INFERENCE 2: If they could play on a suit but consistently avoid it
        // (This is tracked cumulatively through passes)

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
     * Check if we think a player lacks a specific suit.
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
     * 2. High-confidence blocking (cuadrar with P > 0.7)
     * 3. Partner support (first 8 plays)
     * 4. Weighted scoring (fallback)
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
            return null; // Must pass
        }

        if (validMoves.length === 1) {
            const move = { ...validMoves[0], reasoning: 'Only valid move' };
            if (DEBUG_AI) {
                debugInfo.chosen = validMoves[0].tile.toString();
                debugInfo.chosenReason = 'Only valid move';
                this._logDebug(debugInfo, activeView);
            }
            return move;
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
            return { ...winningMove, reasoning: 'Winning move - domino!' };
        }

        // PRIORITY 2: Check for high-confidence blocking opportunity
        const blockingMove = this._findHighConfidenceBlock(validMoves, gameState, playerIndex, chain, activeView);
        if (DEBUG_AI) {
            debugInfo.priorities.blockingMove = blockingMove ? {
                tile: blockingMove.tile.toString(),
                prob: blockingMove.blockProb
            } : null;
        }
        if (blockingMove) {
            if (DEBUG_AI) {
                // Also compute and show all move scores for comparison
                debugInfo.scoredMoves = validMoves.map(move => {
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
                debugInfo.chosenReason = `PRIORITY 2: High-confidence block (P=${blockingMove.blockProb.toFixed(2)})`;
                this._logDebug(debugInfo, activeView);
            }
            return blockingMove;
        }

        // PRIORITY 3: Partner support in early game (first 8 plays)
        const partnerSupportMove = this._findPartnerSupportMove(validMoves, gameState, playerIndex, chain, activeView);
        if (DEBUG_AI) {
            debugInfo.priorities.partnerSupport = partnerSupportMove ? partnerSupportMove.tile.toString() : null;
            debugInfo.priorities.partnerSupportActive = this.playCount < 8;
        }
        if (partnerSupportMove && this.playCount < 8) {
            if (DEBUG_AI) {
                // Also compute and show all move scores for comparison
                debugInfo.scoredMoves = validMoves.map(move => {
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
                debugInfo.chosenReason = 'PRIORITY 3: Partner support (early game)';
                this._logDebug(debugInfo, activeView);
            }
            return partnerSupportMove;
        }

        // FALLBACK: Score each move with static scoring + Monte Carlo
        const scoredMoves = validMoves.map(move => {
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
        if (this.monteCarloEvaluator && this.handTracker) {
            certainty = this.monteCarloEvaluator.calculateCertainty(gameState, gameState.chain, activeView);

            for (const move of scoredMoves) {
                const mcResult = this.monteCarloEvaluator.evaluateMove(move, gameState, playerIndex, activeView);
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

        const bestMove = scoredMoves[0];
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

        return bestMove;
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
        console.log(`2. High-confidence block: ${info.priorities.blockingMove ?
            `Yes - ${info.priorities.blockingMove.tile} (P=${info.priorities.blockingMove.prob.toFixed(2)})` : 'No'}`);
        console.log(`3. Partner support: ${info.priorities.partnerSupport || 'No'} ${
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
            bestBlockMove.reasoning = `High-confidence block (${Math.round(bestBlockMove.blockProb * 100)}%) - pip advantage ~${Math.round(pipAdvantage)} pts`;
            return bestBlockMove;
        } else if (minOppTiles <= 2) {
            // Opponent about to win - block defensively even with pip disadvantage
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

        // 6. BLOCKING - exploit inferred weaknesses (passes + play choices)
        let blockingScore = 0;
        for (const opp of opponents) {
            const passedSuits = gameState.passHistory[opp];
            const inferredDead = this.inferredDeadSuits[opp];

            if (newEndValue !== null && newEndValue !== -1) {
                if (passedSuits.has(newEndValue)) {
                    blockingScore += 20;
                }
                if (inferredDead.has(newEndValue)) {
                    blockingScore += 15;
                }
            }
        }
        factors.blockingPotential = blockingScore;

        // 7. PIP MANAGEMENT - prefer playing high-pip tiles early
        const tilesPlayed = chain.size();
        if (tilesPlayed < 10) {
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
