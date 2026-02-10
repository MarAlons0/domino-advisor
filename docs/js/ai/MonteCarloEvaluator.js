import { Rules } from '../engine/Rules.js';
import { GameState } from '../models/GameState.js';
import { Tile } from '../models/Tile.js';
import { Hand } from '../models/Hand.js';

// Check for debug mode via URL parameter (?debug=ai)
const DEBUG_AI = new URLSearchParams(window.location.search).get('debug') === 'ai';

/**
 * MonteCarloEvaluator - Probability-weighted look-ahead simulation
 *
 * Uses HandTracker probabilities to:
 * 1. Calculate certainty from actual probability distributions
 * 2. Sample likely hand configurations
 * 3. Simulate play forward
 * 4. Evaluate outcomes
 *
 * Depth and samples adapt based on certainty, not game stage.
 */
export class MonteCarloEvaluator {
    constructor(handTracker) {
        this.handTracker = handTracker;
    }

    /**
     * Evaluate a move using Monte Carlo simulation
     * @param {object} move - The move to evaluate {tile, end}
     * @param {GameState} gameState - Current game state
     * @param {number} playerIndex - Which player is making the move
     * @returns {{score: number, certainty: number, depth: number, samples: number}}
     */
    evaluateMove(move, gameState, playerIndex) {
        const chain = gameState.chain;

        // Calculate certainty based on probability distributions
        const certainty = this.calculateCertainty(gameState, chain);

        // Adaptive depth and samples based on certainty
        const depth = Math.ceil(1 + certainty * 5);  // Range: 2-6
        const samples = Math.ceil(100 * (1 - certainty * 0.7));  // Range: 30-100

        let totalScore = 0;
        const outcomes = [];

        for (let i = 0; i < samples; i++) {
            // Sample a possible hand distribution weighted by probabilities
            const sampledHands = this.sampleHands(gameState);

            // Create a simulated game state with sampled hands
            const simState = this.createSimulatedState(gameState, sampledHands);

            // Apply the move we're evaluating
            this.applyMove(simState, playerIndex, move);

            // Simulate forward play
            const outcome = this.simulate(simState, playerIndex, depth - 1);

            // Evaluate the outcome from our perspective
            const score = this.evaluateOutcome(outcome, playerIndex);
            totalScore += score;
            outcomes.push(score);
        }

        const avgScore = totalScore / samples;

        if (DEBUG_AI) {
            this._logMCDebug(move, certainty, depth, samples, avgScore, outcomes);
        }

        return {
            score: avgScore,
            certainty,
            depth,
            samples
        };
    }

    /**
     * Calculate certainty based on actual probability distributions
     * Higher certainty = more peaked distributions = we know more
     * @returns {number} Certainty from 0 to 1
     */
    calculateCertainty(gameState, chain) {
        if (!this.handTracker) return 0.3;

        const unknownTiles = this.handTracker.getUnplayedTiles();

        if (unknownTiles.length === 0) return 1.0;

        let totalCertainty = 0;
        let relevantCount = 0;

        // Get open ends for relevance weighting
        const leftEnd = chain.isEmpty() ? null : chain.leftEnd;
        const rightEnd = chain.isEmpty() ? null : chain.rightEnd;

        for (const tile of unknownTiles) {
            // Skip tiles in human's hand (we know where those are)
            const key = tile.toKey();
            if (this.handTracker.knownLocations.get(key) === 'human') continue;

            // Get probability distribution for this tile
            const probs = [1, 2, 3].map(p => this.handTracker.getProbability(p, tile));

            // Certainty for this tile = max probability (how peaked is distribution?)
            const maxProb = Math.max(...probs);

            // Weight by relevance: tiles playable on current ends matter more
            const isRelevant = (leftEnd !== null && tile.hasValue(leftEnd)) ||
                              (rightEnd !== null && tile.hasValue(rightEnd));
            const weight = isRelevant ? 2.0 : 1.0;

            totalCertainty += maxProb * weight;
            relevantCount += weight;
        }

        // Also factor in dead suit information (passes give us certainty)
        const deadSuitBonus = this.calculateDeadSuitCertainty();

        const baseCertainty = relevantCount > 0 ? totalCertainty / relevantCount : 0.5;

        // Combine base certainty with dead suit info
        return Math.min(1.0, baseCertainty * 0.7 + deadSuitBonus * 0.3);
    }

    /**
     * Calculate certainty bonus from dead suits (passes)
     */
    calculateDeadSuitCertainty() {
        if (!this.handTracker) return 0;

        let totalDeadSuits = 0;
        for (let player = 1; player <= 3; player++) {
            totalDeadSuits += this.handTracker.deadSuits[player].size;
        }

        // Max possible is 21 (3 players × 7 suits), but realistically much less
        // Normalize to something reasonable
        return Math.min(1.0, totalDeadSuits / 10);
    }

    /**
     * Sample hands for computer players weighted by HandTracker probabilities
     * @returns {Map<number, Hand>} Player index -> sampled hand
     */
    sampleHands(gameState) {
        const sampledHands = new Map();

        // Initialize empty hands for computer players
        for (let p = 1; p <= 3; p++) {
            sampledHands.set(p, new Hand());
        }

        // Get unknown tiles (not played, not in human's hand)
        const unknownTiles = [];
        for (const tile of this.handTracker.allTiles) {
            const key = tile.toKey();
            const location = this.handTracker.knownLocations.get(key);
            if (location === 'unknown') {
                unknownTiles.push(tile);
            }
        }

        // Shuffle to randomize assignment order
        this.shuffleArray(unknownTiles);

        // Track how many tiles each player should have
        const targetCounts = new Map();
        for (let p = 1; p <= 3; p++) {
            targetCounts.set(p, this.handTracker.tileCounts[p]);
        }

        // Assign tiles based on probabilities
        for (const tile of unknownTiles) {
            const eligiblePlayers = [];
            const weights = [];

            for (let p = 1; p <= 3; p++) {
                // Skip if player already has enough tiles
                if (sampledHands.get(p).size() >= targetCounts.get(p)) continue;

                // Check if this player could have this tile
                const prob = this.handTracker.getProbability(p, tile);
                if (prob > 0) {
                    eligiblePlayers.push(p);
                    weights.push(prob);
                }
            }

            if (eligiblePlayers.length > 0) {
                // Weighted random selection
                const selected = this.weightedRandomSelect(eligiblePlayers, weights);
                sampledHands.get(selected).add(tile);
            }
        }

        return sampledHands;
    }

    /**
     * Create a simulated game state with sampled hands
     */
    createSimulatedState(realState, sampledHands) {
        // Deep copy the relevant parts of game state
        const simState = {
            hands: [],
            chain: realState.chain.clone(),
            currentPlayer: realState.currentPlayer,
            passHistory: realState.passHistory.map(set => new Set(set)),
            consecutivePasses: realState.consecutivePasses,
            gamePhase: realState.gamePhase
        };

        // Player 0 keeps their real hand
        simState.hands[0] = realState.hands[0].clone();

        // Computer players get sampled hands
        for (let p = 1; p <= 3; p++) {
            simState.hands[p] = sampledHands.get(p);
        }

        return simState;
    }

    /**
     * Apply a move to a simulated state
     */
    applyMove(simState, playerIndex, move) {
        const hand = simState.hands[playerIndex];
        const tile = move.tile;
        const end = move.end;

        // Remove tile from hand
        hand.remove(tile);

        // Add to chain (play handles both first tile and subsequent)
        simState.chain.play(tile, end);

        // Reset consecutive passes
        simState.consecutivePasses = 0;

        // Advance to next player
        simState.currentPlayer = (playerIndex + 1) % 4;
    }

    /**
     * Simulate play forward for a number of moves
     * Uses simple greedy play for speed
     */
    simulate(simState, originalPlayer, remainingDepth) {
        if (remainingDepth <= 0) {
            return { type: 'depth_limit', state: simState };
        }

        // Check for game end conditions
        for (let p = 0; p < 4; p++) {
            if (simState.hands[p].isEmpty()) {
                return { type: 'domino', winner: p, state: simState };
            }
        }

        if (simState.consecutivePasses >= 4) {
            return { type: 'blocked', state: simState };
        }

        const currentPlayer = simState.currentPlayer;
        const hand = simState.hands[currentPlayer];
        const chain = simState.chain;

        // Get valid moves
        const validMoves = Rules.getValidMoves(hand, chain, false);

        if (validMoves.length === 0) {
            // Must pass
            simState.consecutivePasses++;
            simState.currentPlayer = (currentPlayer + 1) % 4;
            return this.simulate(simState, originalPlayer, remainingDepth - 1);
        }

        // Simple greedy: pick move with highest pip count (fast heuristic)
        // Could be improved with lightweight scoring
        let bestMove = validMoves[0];
        let bestPips = validMoves[0].tile.pipCount();

        for (const move of validMoves) {
            const pips = move.tile.pipCount();
            if (pips > bestPips) {
                bestPips = pips;
                bestMove = move;
            }
        }

        // Apply the move
        this.applyMove(simState, currentPlayer, bestMove);

        // Continue simulation
        return this.simulate(simState, originalPlayer, remainingDepth - 1);
    }

    /**
     * Evaluate an outcome from a player's perspective
     * @returns {number} Score (positive = good for player's team)
     */
    evaluateOutcome(outcome, playerIndex) {
        const isTeamA = playerIndex === 0 || playerIndex === 2;
        const state = outcome.state;

        if (outcome.type === 'domino') {
            const winnerIsTeamA = outcome.winner === 0 || outcome.winner === 2;

            // Calculate pip difference
            const teamAPips = state.hands[0].pipCount() + state.hands[2].pipCount();
            const teamBPips = state.hands[1].pipCount() + state.hands[3].pipCount();

            if (winnerIsTeamA) {
                return isTeamA ? (50 + teamBPips) : -(50 + teamBPips);
            } else {
                return isTeamA ? -(50 + teamAPips) : (50 + teamAPips);
            }
        }

        if (outcome.type === 'blocked') {
            const teamAPips = state.hands[0].pipCount() + state.hands[2].pipCount();
            const teamBPips = state.hands[1].pipCount() + state.hands[3].pipCount();

            const diff = teamBPips - teamAPips;  // Positive = Team A wins
            return isTeamA ? diff : -diff;
        }

        // Depth limit - evaluate position heuristically
        return this.evaluatePosition(state, playerIndex);
    }

    /**
     * Heuristic evaluation of a non-terminal position
     */
    evaluatePosition(state, playerIndex) {
        const isTeamA = playerIndex === 0 || playerIndex === 2;

        // Pip advantage (fewer pips = better)
        const teamAPips = state.hands[0].pipCount() + state.hands[2].pipCount();
        const teamBPips = state.hands[1].pipCount() + state.hands[3].pipCount();
        const pipAdvantage = teamBPips - teamAPips;

        // Tile count advantage (fewer tiles = closer to winning)
        const teamATiles = state.hands[0].size() + state.hands[2].size();
        const teamBTiles = state.hands[1].size() + state.hands[3].size();
        const tileAdvantage = (teamBTiles - teamATiles) * 5;

        const totalAdvantage = pipAdvantage + tileAdvantage;
        return isTeamA ? totalAdvantage : -totalAdvantage;
    }

    /**
     * Weighted random selection from an array
     */
    weightedRandomSelect(items, weights) {
        const totalWeight = weights.reduce((sum, w) => sum + w, 0);
        let random = Math.random() * totalWeight;

        for (let i = 0; i < items.length; i++) {
            random -= weights[i];
            if (random <= 0) {
                return items[i];
            }
        }

        return items[items.length - 1];
    }

    /**
     * Fisher-Yates shuffle
     */
    shuffleArray(array) {
        for (let i = array.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [array[i], array[j]] = [array[j], array[i]];
        }
    }

    /**
     * Debug logging for Monte Carlo evaluation
     */
    _logMCDebug(move, certainty, depth, samples, avgScore, outcomes) {
        console.group(`%c🎰 Monte Carlo: ${move.tile.toString()} (${move.end})`, 'color: #ffd93d');
        console.log(`Certainty: ${(certainty * 100).toFixed(1)}% → Depth: ${depth}, Samples: ${samples}`);
        console.log(`Average Score: ${avgScore.toFixed(1)}`);

        // Distribution of outcomes
        const positive = outcomes.filter(o => o > 0).length;
        const negative = outcomes.filter(o => o < 0).length;
        const neutral = outcomes.filter(o => o === 0).length;
        console.log(`Outcomes: +${positive} / =${neutral} / -${negative}`);

        console.groupEnd();
    }
}
