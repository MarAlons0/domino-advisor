import { Tile } from '../models/Tile.js';
import { t } from '../i18n/i18n.js';

/**
 * HandTracker - Maintains tile probability distributions for each player.
 *
 * Tracks where each of the 28 domino tiles might be located:
 * - Known locations: 'played', 'human', or 'unknown'
 * - Probability distributions for unknown tiles across computer players
 *
 * Used for:
 * - Quiz mode: testing player's ability to predict opponent hands
 * - Debrief: showing what could have been known at each point
 */
export class HandTracker {
    constructor() {
        this.reset();
    }

    /**
     * Reset all tracking data for a new hand
     */
    reset() {
        // All 28 tiles in a double-six set
        this.allTiles = Tile.createFullSet();

        // Known tile locations: tile key -> 'played' | 'human' | 'unknown'
        this.knownLocations = new Map();

        // For each tile, which players could have it (before it's played)
        // tile key -> Set of player indices (1, 2, 3 for computer players)
        this.possibleHolders = new Map();

        // For each player, suits they definitely lack (from passes)
        // Player index -> Set of suit values (0-6)
        this.deadSuits = [new Set(), new Set(), new Set(), new Set()];

        // Human's hand (known tiles)
        this.humanHand = new Set();

        // Count of tiles each player has
        this.tileCounts = [7, 7, 7, 7];

        // Track all tiles that have been played (for reference)
        this.playedTiles = new Set();

        // Generation counter for cache invalidation (PlayerView uses this)
        this._generation = 0;

        // History of deductions for timeline
        this.deductionHistory = [];

        // Initialize all tiles as unknown with all computer players as possible holders
        for (const tile of this.allTiles) {
            const key = tile.toKey();
            this.knownLocations.set(key, 'unknown');
            this.possibleHolders.set(key, new Set([1, 2, 3]));
        }
    }

    /**
     * Initialize tracking at the start of a hand with the human's known tiles
     * @param {Hand} humanHand - The human player's hand
     */
    initHand(humanHand) {
        this.reset();
        this._generation++;

        // Mark human's tiles as known
        const humanTiles = humanHand.getTiles();
        for (const tile of humanTiles) {
            const key = tile.toKey();
            this.knownLocations.set(key, 'human');
            this.humanHand.add(key);
            // No computer player can have this tile
            this.possibleHolders.set(key, new Set());
        }

        this.deductionHistory.push({
            playIndex: 0,
            type: 'init',
            description: t('tracker.init')
        });
    }

    /**
     * Record a tile being played
     * @param {number} player - Player index (0-3)
     * @param {Tile} tile - The tile played
     */
    recordPlay(player, tile) {
        this._generation++;
        const key = tile.toKey();

        // Mark as played
        this.knownLocations.set(key, 'played');
        this.playedTiles.add(key);
        this.possibleHolders.set(key, new Set());

        // Decrease that player's tile count
        this.tileCounts[player]--;

        // Remove from human hand if applicable
        if (player === 0) {
            this.humanHand.delete(key);
        }
    }

    /**
     * Record a player passing (they lack both open end values)
     * @param {number} player - Player index (0-3)
     * @param {number} leftEnd - Left open end value
     * @param {number} rightEnd - Right open end value
     */
    recordPass(player, leftEnd, rightEnd) {
        this._generation++;
        // Player lacks both suits
        this.deadSuits[player].add(leftEnd);
        if (rightEnd !== leftEnd) {
            this.deadSuits[player].add(rightEnd);
        }

        // Remove this player from possible holders of any tile with these values
        let tilesEliminated = 0;
        for (const tile of this.allTiles) {
            const key = tile.toKey();
            if (this.knownLocations.get(key) !== 'unknown') continue;

            if (tile.hasValue(leftEnd) || tile.hasValue(rightEnd)) {
                const holders = this.possibleHolders.get(key);
                if (holders.has(player)) {
                    holders.delete(player);
                    tilesEliminated++;
                }
            }
        }

        // Record this deduction
        const playerName = this.getPlayerName(player);
        const suitNames = leftEnd === rightEnd
            ? t('tracker.passedOnSingle', leftEnd)
            : t('tracker.passedOnDouble', leftEnd, rightEnd);
        const lacksSuits = rightEnd !== leftEnd ? `${leftEnd}, ${rightEnd}` : `${leftEnd}`;

        this.deductionHistory.push({
            playIndex: this.playedTiles.size,
            type: 'pass',
            player: player,
            description: t('tracker.passedOn', playerName, suitNames, lacksSuits),
            tilesEliminated: tilesEliminated
        });
    }

    /**
     * Get probability that a specific player holds a specific tile.
     * Uses Bayesian reasoning: P(player has tile) = (player's tiles) / (possible tiles for player)
     * adjusted by whether this specific tile is possible for them.
     *
     * @param {number} player - Player index (1-3 for computer players)
     * @param {Tile|string} tile - Tile or tile key
     * @returns {number} Probability 0-1
     */
    getProbability(player, tile) {
        const key = typeof tile === 'string' ? tile : tile.toKey();

        // If tile location is known, return 0 or 1
        const location = this.knownLocations.get(key);
        if (location === 'played' || location === 'human') {
            return 0;
        }

        const holders = this.possibleHolders.get(key);
        if (!holders || holders.size === 0) {
            return 0;
        }

        if (!holders.has(player)) {
            return 0;
        }

        // Count how many tiles this player could possibly hold
        const possibleTilesForPlayer = this._countPossibleTilesForPlayer(player);
        const playerTileCount = this.tileCounts[player];

        if (possibleTilesForPlayer === 0) {
            return 0;
        }

        // Base probability: player has N tiles out of M possible
        // P(player has this specific tile) ≈ N / M
        return Math.min(1, playerTileCount / possibleTilesForPlayer);
    }

    /**
     * Count how many unknown tiles a player could possibly hold
     * (tiles where they are still a possible holder)
     * @private
     */
    _countPossibleTilesForPlayer(player) {
        let count = 0;
        for (const tile of this.allTiles) {
            const key = tile.toKey();
            if (this.knownLocations.get(key) !== 'unknown') continue;

            const holders = this.possibleHolders.get(key);
            if (holders && holders.has(player)) {
                count++;
            }
        }
        return count;
    }

    /**
     * Get probability that a player will pass on a given value.
     * P(pass on V) = P(player has no tile containing V)
     *
     * @param {number} player - Player index (1-3 for computer players)
     * @param {number} value - The suit value (0-6)
     * @returns {number} Probability 0-1 that player cannot play on this value
     */
    getPassProbability(player, value) {
        // If we know they've already passed on this value, 100% they'll pass again
        if (this.deadSuits[player].has(value)) {
            return 1.0;
        }

        // Count tiles with this value that the player could have
        const tilesWithValue = [];
        for (const tile of this.allTiles) {
            if (!tile.hasValue(value)) continue;

            const key = tile.toKey();
            if (this.knownLocations.get(key) !== 'unknown') continue;

            const holders = this.possibleHolders.get(key);
            if (holders && holders.has(player)) {
                tilesWithValue.push(tile);
            }
        }

        if (tilesWithValue.length === 0) {
            // No possible tiles with this value - certain pass
            return 1.0;
        }

        // Probability they have NONE of these tiles
        // Simplified: if they have N tiles and M possible tiles contain value V
        // P(has at least one V) ≈ 1 - ((possible - M) / possible) ^ N
        // But for simplicity, we use: P(has at least one V) ≈ M * (N / possible)
        const possibleTiles = this._countPossibleTilesForPlayer(player);
        const playerTileCount = this.tileCounts[player];

        if (possibleTiles === 0) return 1.0;

        // Expected number of tiles with this value they hold
        const expectedCount = tilesWithValue.length * (playerTileCount / possibleTiles);

        // P(they have at least one) ≈ 1 - e^(-expectedCount) for Poisson approximation
        // Simplified: use 1 - (1 - p)^n where p = 1/possibleTiles for each tile
        const probHasNone = Math.pow(1 - (playerTileCount / possibleTiles), tilesWithValue.length);

        return Math.max(0, Math.min(1, probHasNone));
    }

    /**
     * Get probability of successfully blocking a player by making both ends
     * show specific values (cuadrar).
     *
     * @param {number} player - Player to block (1-3)
     * @param {number} value1 - First end value
     * @param {number} value2 - Second end value (can be same as value1)
     * @returns {number} Probability 0-1 that player will be forced to pass
     */
    getBlockingProbability(player, value1, value2) {
        if (value1 === value2) {
            // Cuadrar - both ends same value
            return this.getPassProbability(player, value1);
        }

        // Player must lack BOTH values to be blocked
        const passProb1 = this.getPassProbability(player, value1);
        const passProb2 = this.getPassProbability(player, value2);

        // P(lacks both) ≈ P(lacks value1) * P(lacks value2)
        // This is approximate - assumes independence which isn't quite true
        return passProb1 * passProb2;
    }

    /**
     * Get the most likely tiles for a given player
     * @param {number} player - Player index (1-3 for computer players)
     * @param {number} count - Number of tiles to return
     * @returns {Array<{tile: Tile, probability: number}>}
     */
    getMostLikely(player, count = 7) {
        const tilesWithProb = [];

        for (const tile of this.allTiles) {
            const key = tile.toKey();
            if (this.knownLocations.get(key) !== 'unknown') continue;

            const prob = this.getProbability(player, tile);
            if (prob > 0) {
                tilesWithProb.push({ tile, key, probability: prob });
            }
        }

        // Sort by probability descending
        tilesWithProb.sort((a, b) => b.probability - a.probability);

        return tilesWithProb.slice(0, count);
    }

    /**
     * Get tiles that a player definitely doesn't have (based on passes)
     * @param {number} player - Player index (1-3)
     * @returns {Array<Tile>}
     */
    getKnownMissing(player) {
        const missing = [];

        for (const tile of this.allTiles) {
            const key = tile.toKey();
            if (this.knownLocations.get(key) !== 'unknown') continue;

            const holders = this.possibleHolders.get(key);
            if (!holders.has(player)) {
                missing.push(tile);
            }
        }

        return missing;
    }

    /**
     * Get what we know for certain about a player
     * @param {number} player - Player index (1-3)
     * @returns {object} { tileCount, deadSuits, possibleTileCount }
     */
    getKnownFacts(player) {
        const deadSuits = Array.from(this.deadSuits[player]);

        // Count how many tiles they could possibly have
        let possibleTileCount = 0;
        for (const tile of this.allTiles) {
            const key = tile.toKey();
            if (this.knownLocations.get(key) !== 'unknown') continue;

            const holders = this.possibleHolders.get(key);
            if (holders.has(player)) {
                possibleTileCount++;
            }
        }

        return {
            tileCount: this.tileCounts[player],
            deadSuits: deadSuits,
            possibleTileCount: possibleTileCount
        };
    }

    /**
     * Get all unplayed tiles (for quiz tile picker)
     * @returns {Array<Tile>}
     */
    getUnplayedTiles() {
        const unplayed = [];

        for (const tile of this.allTiles) {
            const key = tile.toKey();
            const location = this.knownLocations.get(key);
            if (location !== 'played' && location !== 'human') {
                unplayed.push(tile);
            }
        }

        return unplayed;
    }

    /**
     * Get tiles the human player currently holds
     * @returns {Array<string>} Array of tile keys
     */
    getHumanTileKeys() {
        return Array.from(this.humanHand);
    }

    /**
     * Score a quiz prediction against actual hands
     * @param {number} targetPlayer - Player being predicted (1-3)
     * @param {Array<string>} predictedTileKeys - Tile keys the user predicted
     * @param {Hand} actualHand - The actual hand of the target player
     * @returns {object} { score, correct, wrong, missed, details }
     */
    scoreQuizPrediction(targetPlayer, predictedTileKeys, actualHand) {
        const actualTileKeys = new Set(actualHand.getTiles().map(t => t.toKey()));
        const predictedSet = new Set(predictedTileKeys);

        let score = 0;
        const details = {
            correct: [],    // Predicted and actually held
            wrong: [],      // Predicted but not held
            missed: [],     // Not predicted but held
            correctExclusions: 0  // Correctly not predicted
        };

        // Check each prediction
        for (const key of predictedTileKeys) {
            if (actualTileKeys.has(key)) {
                score += 10;  // Correct prediction
                details.correct.push(key);
            } else {
                score -= 5;   // Wrong prediction
                details.wrong.push(key);
            }
        }

        // Check for missed tiles
        for (const key of actualTileKeys) {
            if (!predictedSet.has(key)) {
                score -= 2;  // Missed tile
                details.missed.push(key);
            }
        }

        // Count correct exclusions (tiles not in hand that weren't predicted)
        const unplayedTiles = this.getUnplayedTiles();
        for (const tile of unplayedTiles) {
            const key = tile.toKey();
            if (!actualTileKeys.has(key) && !predictedSet.has(key)) {
                details.correctExclusions++;
                score += 2;  // Correct exclusion
            }
        }

        return {
            score: Math.max(0, score),  // Don't go negative
            correct: details.correct.length,
            wrong: details.wrong.length,
            missed: details.missed.length,
            correctExclusions: details.correctExclusions,
            details
        };
    }

    /**
     * Score a quiz prediction against probability model (mid-game)
     * @param {number} targetPlayer - Player being predicted (1-3)
     * @param {Array<string>} predictedTileKeys - Tile keys the user predicted
     * @returns {object} { score, analysis }
     */
    scorePredictionAgainstModel(targetPlayer, predictedTileKeys) {
        const predictedSet = new Set(predictedTileKeys);
        let score = 0;
        const analysis = [];

        // Get most likely tiles for this player
        const likelyTiles = this.getMostLikely(targetPlayer, 21);
        const likelyKeys = new Set(likelyTiles.map(t => t.key));

        // Check predictions against probabilities
        for (const key of predictedTileKeys) {
            const prob = this.getProbability(targetPlayer, key);
            if (prob >= 0.5) {
                score += 5;  // Good prediction (likely tile)
                analysis.push({ key, prob, rating: 'likely' });
            } else if (prob > 0) {
                score += 2;  // Possible but not most likely
                analysis.push({ key, prob, rating: 'possible' });
            } else {
                score -= 5;  // Impossible (we know they don't have it)
                analysis.push({ key, prob, rating: 'impossible' });
            }
        }

        return { score: Math.max(0, score), analysis };
    }

    /**
     * Get deduction history for timeline display
     * @returns {Array}
     */
    getDeductionHistory() {
        return this.deductionHistory;
    }

    /**
     * Get player name for display
     * @param {number} player - Player index
     * @returns {string}
     */
    getPlayerName(player) {
        const keys = ['player.you', 'player.opponent1', 'player.partner', 'player.opponent2'];
        return keys[player] ? t(keys[player]) : `Player ${player}`;
    }

    /**
     * Get summary of current tracking state
     * @returns {object}
     */
    getSummary() {
        const unknownCount = Array.from(this.knownLocations.values())
            .filter(loc => loc === 'unknown').length;

        return {
            playedCount: this.playedTiles.size,
            humanTileCount: this.humanHand.size,
            unknownCount: unknownCount,
            tileCounts: [...this.tileCounts],
            deductionCount: this.deductionHistory.length
        };
    }
}
