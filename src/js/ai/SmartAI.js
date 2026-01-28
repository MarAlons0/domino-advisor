import { Rules } from '../engine/Rules.js';
import { GameState } from '../models/GameState.js';
import { StrategicExplainer } from './StrategicExplainer.js';

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
 */
export class SmartAI {
    constructor() {
        this.explainer = new StrategicExplainer();
        this.resetForNewHand();
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
     * @param {GameState} gameState - The current game state
     * @param {number} playerIndex - Which player the AI is playing as
     * @returns {{tile: Tile, end: string, reasoning: string}|null}
     */
    chooseMove(gameState, playerIndex) {
        const hand = gameState.hands[playerIndex];
        const chain = gameState.chain;
        const mustPlayDoubleSix = gameState.isFirstHand && chain.isEmpty();

        const validMoves = Rules.getValidMoves(hand, chain, mustPlayDoubleSix);

        if (validMoves.length === 0) {
            return null; // Must pass
        }

        if (validMoves.length === 1) {
            return { ...validMoves[0], reasoning: 'Only valid move' };
        }

        // Score each move and pick the best
        const scoredMoves = validMoves.map(move => ({
            ...move,
            score: this.scoreMove(move, gameState, playerIndex),
            reasoning: ''
        }));

        // Sort by score descending
        scoredMoves.sort((a, b) => b.score.total - a.score.total);

        const bestMove = scoredMoves[0];
        // Use strategic explainer for rich reasoning
        bestMove.reasoning = this.explainer.explainBrief(
            bestMove,
            bestMove.score,
            gameState,
            playerIndex,
            this
        );

        return bestMove;
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
