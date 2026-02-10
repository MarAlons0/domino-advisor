import { Rules } from '../engine/Rules.js';
import { GameState } from '../models/GameState.js';
import { StrategicExplainer } from './StrategicExplainer.js';

// Check for debug mode via URL parameter (?debug=ai)
const DEBUG_AI = new URLSearchParams(window.location.search).get('debug') === 'ai';

/**
 * SmartAI - An AI that follows strategic principles for partnership dominoes.
 *
 * Principles implemented:
 * 1. Suit Strength - prefer playing from strong suits
 * 2. Partner Coordination - support partner's lead (la salida)
 * 3. Double Management - unload doubles when you have cover
 * 4. Blocking - exploit opponent passes and inferred weaknesses
 * 5. Pip Management - prefer playing high-pip tiles early
 * 6. Tile Counting - track what's been played to know what's out
 * 7. Play Choice Inference - deduce holdings from what players choose to play
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

        // Get this player's signaled suit
        const signaledSuit = this.signaledSuits[playerIndex];

        // INFERENCE 1: If they avoided their own signaled suit, they might be out
        if (signaledSuit !== null && avoided === signaledSuit && playedOn !== signaledSuit) {
            // They had a choice and avoided their signaled suit
            // This suggests they may be out of that suit
            this.killedOwnSuit[playerIndex] = true;
            this.inferredDeadSuits[playerIndex].add(signaledSuit);
        }

        // INFERENCE 2: If they could play on a suit but consistently avoid it
        // (This is tracked cumulatively through passes)

        // INFERENCE 3: Update their signaled suit based on what they're playing
        // If they keep playing a particular suit, that becomes their signal
        if (!tile.isDouble()) {
            const newEnd = tile.getOtherValue(playedOn);
            if (newEnd !== -1 && this.signaledSuits[playerIndex] === null) {
                // First non-double play, establish signal
                this.signaledSuits[playerIndex] = tile.high; // Use the higher value as signal
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
                this._logDebug({ ...debugInfo, chosen: 'PASS', chosenReason: 'No valid moves' });
            }
            return null; // Must pass
        }

        if (validMoves.length === 1) {
            const move = { ...validMoves[0], reasoning: 'Only valid move' };
            if (DEBUG_AI) {
                debugInfo.chosen = validMoves[0].tile.toString();
                debugInfo.chosenReason = 'Only valid move';
                this._logDebug(debugInfo);
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
                this._logDebug(debugInfo);
            }
            return { ...winningMove, reasoning: 'Winning move - domino!' };
        }

        // PRIORITY 2: Check for high-confidence blocking opportunity
        const blockingMove = this._findHighConfidenceBlock(validMoves, gameState, playerIndex, chain);
        if (DEBUG_AI) {
            debugInfo.priorities.blockingMove = blockingMove ? {
                tile: blockingMove.tile.toString(),
                prob: blockingMove.blockProb
            } : null;
        }
        if (blockingMove) {
            if (DEBUG_AI) {
                debugInfo.chosen = blockingMove.tile.toString();
                debugInfo.chosenReason = `PRIORITY 2: High-confidence block (P=${blockingMove.blockProb.toFixed(2)})`;
                this._logDebug(debugInfo);
            }
            return blockingMove;
        }

        // PRIORITY 3: Partner support in early game (first 8 plays)
        const partnerSupportMove = this._findPartnerSupportMove(validMoves, gameState, playerIndex, chain);
        if (DEBUG_AI) {
            debugInfo.priorities.partnerSupport = partnerSupportMove ? partnerSupportMove.tile.toString() : null;
            debugInfo.priorities.partnerSupportActive = this.playCount < 8;
        }
        if (partnerSupportMove && this.playCount < 8) {
            if (DEBUG_AI) {
                debugInfo.chosen = partnerSupportMove.tile.toString();
                debugInfo.chosenReason = 'PRIORITY 3: Partner support (early game)';
                this._logDebug(debugInfo);
            }
            return partnerSupportMove;
        }

        // FALLBACK: Score each move and pick the best
        const scoredMoves = validMoves.map(move => ({
            ...move,
            score: this.scoreMove(move, gameState, playerIndex),
            reasoning: ''
        }));

        // Sort by score descending
        scoredMoves.sort((a, b) => b.score.total - a.score.total);

        if (DEBUG_AI) {
            debugInfo.scoredMoves = scoredMoves.map(m => ({
                tile: m.tile.toString(),
                end: m.end,
                total: m.score.total,
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
            debugInfo.chosenReason = `FALLBACK: Highest score (${bestMove.score.total})`;
            debugInfo.chosenExplanation = bestMove.reasoning;
            this._logDebug(debugInfo);
        }

        return bestMove;
    }

    /**
     * Log debug information to console
     * @private
     */
    _logDebug(info) {
        const playerColors = {
            0: '#00d4ff', // You - cyan
            1: '#ff6b6b', // Opp 1 - coral
            2: '#22c55e', // Partner - green
            3: '#ffa500'  // Opp 2 - orange
        };
        const color = playerColors[info.playerIndex] || '#fff';

        console.group(`%c🎲 AI Decision: ${info.player}`, `color: ${color}; font-weight: bold`);

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

        // Scored moves table
        if (info.scoredMoves && info.scoredMoves.length > 0) {
            console.group('Move Scores (sorted by total)');
            console.table(info.scoredMoves.map(m => ({
                'Move': `${m.tile} (${m.end})`,
                'Total': m.total,
                'SuitStr': m.factors.suitStrength,
                'Double': m.factors.doubleManagement,
                'Partner': m.factors.partnerSupport,
                'Block': m.factors.blockingPotential,
                'Pip': Math.round(m.factors.pipManagement * 10) / 10,
                'EndCtl': m.factors.endControl,
                'TileCnt': m.factors.tileCountingBonus,
                'AvoidDead': m.factors.avoidDeadSuits
            })));
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
     * Find a high-confidence blocking opportunity (cuadrar)
     * @private
     */
    _findHighConfidenceBlock(validMoves, gameState, playerIndex, chain) {
        if (!this.handTracker) return null;

        const opponents = this.getOpponents(playerIndex);
        const BLOCK_THRESHOLD = 0.7; // 70% confidence required

        let bestBlockMove = null;
        let bestBlockProb = 0;

        for (const move of validMoves) {
            // Determine what ends would be after this play
            const { newLeftEnd, newRightEnd } = this._getEndsAfterPlay(move, chain);

            // Check blocking probability against each opponent
            for (const opp of opponents) {
                const blockProb = this.handTracker.getBlockingProbability(opp, newLeftEnd, newRightEnd);

                if (blockProb >= BLOCK_THRESHOLD && blockProb > bestBlockProb) {
                    bestBlockProb = blockProb;
                    bestBlockMove = {
                        ...move,
                        blockProb: blockProb,
                        reasoning: `High-confidence block (${Math.round(blockProb * 100)}%) - cuadrar to force opponent pass`
                    };
                }
            }
        }

        return bestBlockMove;
    }

    /**
     * Find a move that supports partner's signaled suit
     * @private
     */
    _findPartnerSupportMove(validMoves, gameState, playerIndex, chain) {
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
            score: this.scoreMove(move, gameState, playerIndex)
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
     * @returns {{total: number, factors: object}}
     */
    scoreMove(move, gameState, playerIndex) {
        const { tile, end } = move;
        const hand = gameState.hands[playerIndex];
        const chain = gameState.chain;
        const partnerIndex = GameState.getPartner(playerIndex);

        const factors = {
            suitStrength: 0,
            doubleManagement: 0,
            partnerSupport: 0,
            blockingPotential: 0,
            pipManagement: 0,
            endControl: 0,
            tileCountingBonus: 0,
            avoidDeadSuits: 0
        };

        // Determine what end value we're leaving open after this play
        const currentEndValue = chain.isEmpty() ? null : (end === 'left' ? chain.leftEnd : chain.rightEnd);
        const newEndValue = chain.isEmpty() ? tile.high : tile.getOtherValue(currentEndValue);

        // 1. SUIT STRENGTH - prefer playing from strong suits
        const highCount = this.countSuitInHand(hand, tile.high);
        const lowCount = this.countSuitInHand(hand, tile.low);
        const suitStrength = Math.max(highCount, lowCount);
        factors.suitStrength = suitStrength * 10;

        // 2. DOUBLE MANAGEMENT - prioritize playing doubles when you have cover
        if (tile.isDouble()) {
            const hasCover = this.hasCoverForDouble(hand, tile, chain);
            if (hasCover) {
                factors.doubleManagement = 25;
            } else {
                // Check if the suit is nearly dead - less risky to play
                if (this.isSuitNearlyDead(tile.high)) {
                    factors.doubleManagement = 10; // Less risky, suit is drying up
                } else {
                    factors.doubleManagement = -15; // Risky
                }
            }
        }

        // 3. PARTNER SUPPORT - support partner's signaled suit
        const partnerSuit = this.signaledSuits[partnerIndex];
        if (partnerSuit !== null && !this.killedOwnSuit[partnerIndex]) {
            if (tile.hasValue(partnerSuit)) {
                factors.partnerSupport = 15;
            }
            if (newEndValue === partnerSuit) {
                factors.partnerSupport += 10; // Leaving partner's suit open
            }
        }

        // 4. BLOCKING - exploit inferred weaknesses (passes + play choices)
        const opponents = this.getOpponents(playerIndex);
        let blockingScore = 0;

        for (const opp of opponents) {
            // Check both pass history and inferred dead suits
            const passedSuits = gameState.passHistory[opp];
            const inferredDead = this.inferredDeadSuits[opp];

            if (newEndValue !== null && newEndValue !== -1) {
                if (passedSuits.has(newEndValue)) {
                    blockingScore += 20;
                }
                if (inferredDead.has(newEndValue)) {
                    blockingScore += 15; // Slightly less certain than a pass
                }
            }
        }
        factors.blockingPotential = blockingScore;

        // 5. PIP MANAGEMENT - prefer playing high-pip tiles early
        const tilesPlayed = chain.size();
        if (tilesPlayed < 10) {
            factors.pipManagement = tile.pipCount() * 1.5;
        } else {
            factors.pipManagement = tile.pipCount() * 0.5;
        }

        // 6. END CONTROL - prefer keeping our strong suits open
        if (newEndValue !== null && newEndValue !== -1) {
            const ourStrengthInNewEnd = this.countSuitInHand(hand, newEndValue);
            factors.endControl = ourStrengthInNewEnd * 5;
        }

        // 7. TILE COUNTING BONUS - prefer leaving open suits that still have tiles out
        if (newEndValue !== null && newEndValue !== -1) {
            const remaining = this.getRemainingInSuit(newEndValue);
            if (remaining > 3) {
                factors.tileCountingBonus = 10; // Plenty of tiles still out
            } else if (remaining <= 1) {
                factors.tileCountingBonus = -10; // Suit is almost dead, bad to leave open
            }
        }

        // 8. AVOID DEAD SUITS - don't leave dead suits as the only option
        if (newEndValue !== null && this.isSuitDead(newEndValue)) {
            factors.avoidDeadSuits = -30; // Very bad - will force passes
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

        if (score.factors.suitStrength >= 20) dominated.push('strong suit');
        if (score.factors.doubleManagement >= 20) dominated.push('unload double with cover');
        if (score.factors.doubleManagement < 0) dominated.push('risky double');
        if (score.factors.partnerSupport >= 15) dominated.push('support partner');
        if (score.factors.blockingPotential >= 20) dominated.push('block opponent');
        if (score.factors.pipManagement >= 10) dominated.push('high pip tile');
        if (score.factors.endControl >= 10) dominated.push('maintain control');
        if (score.factors.tileCountingBonus >= 10) dominated.push('good suit availability');
        if (score.factors.avoidDeadSuits < 0) dominated.push('avoid dead suit');

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
