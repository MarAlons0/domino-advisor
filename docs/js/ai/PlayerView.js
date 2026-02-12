/**
 * PlayerView - Per-player probability adapter with Bayesian suit affinity inference.
 *
 * Each player gets their own view of the game that:
 * 1. Knows their own tiles exactly
 * 2. Does NOT know other players' exact tiles (computer views don't see human's hand)
 * 3. Tracks suit affinities from observed play patterns (Bayesian updates)
 * 4. Exposes the same API as HandTracker for seamless integration
 *
 * The human's view (player 0) produces identical base probabilities to the old
 * HandTracker, plus Bayesian adjustments for other players' suit preferences.
 * Computer views (players 1-3) treat the human's tiles as unknown.
 */
export class PlayerView {
    /**
     * @param {number} playerIndex - Which player this view belongs to (0-3)
     * @param {HandTracker} handTracker - Shared data store (read-only reference)
     */
    constructor(playerIndex, handTracker) {
        this.playerIndex = playerIndex;
        this.handTracker = handTracker;

        // Own hand tile keys (exact knowledge)
        this.ownTileKeys = new Set();

        // Suit affinities: A[player][suit] multiplier, initialized to 1.0
        // Updated via Bayesian inference from observed plays
        this.affinities = this._createAffinityMatrix();

        // Track whether this is the first play of the hand (salida)
        this.isFirstPlay = true;

        // Cache for view-adjusted knownLocations
        this._locationCache = null;
        this._locationCacheGeneration = -1;
    }

    // ==================== Lifecycle ====================

    /**
     * Store own hand tiles at the start of a hand
     * @param {Hand} hand - This player's hand
     */
    initOwnHand(hand) {
        this.ownTileKeys = new Set(hand.getTiles().map(t => t.toKey()));
    }

    /**
     * Reset all suit affinities to 1.0 for a new hand
     */
    resetAffinities() {
        this.affinities = this._createAffinityMatrix();
        this.isFirstPlay = true;
        this._locationCache = null;
        this._locationCacheGeneration = -1;
    }

    /**
     * Observe a play and update Bayesian suit affinities.
     * All 4 views call this with the same data — affinities are shared knowledge.
     *
     * @param {number} player - Who played (0-3)
     * @param {Tile} tile - The tile played
     * @param {string} end - 'left' or 'right'
     * @param {number|null} leftEnd - Left open end before play (null if first play)
     * @param {number|null} rightEnd - Right open end before play (null if first play)
     */
    recordPlayObservation(player, tile, end, leftEnd, rightEnd) {
        // Remove from own hand if it's our tile
        if (player === this.playerIndex) {
            this.ownTileKeys.delete(tile.toKey());
        }

        if (this.isFirstPlay) {
            // Salida: strong signal about preferred suit
            if (tile.isDouble()) {
                this._updateAffinity(player, tile.high, 2.0);
            } else {
                // Non-double salida: moderate signal for the higher value
                this._updateAffinity(player, tile.high, 1.5);
                this._updateAffinity(player, tile.low, 1.5);
            }
            this.isFirstPlay = false;
            return;
        }

        // Subsequent play: the value introduced to the chain shows suit preference
        if (leftEnd === null) return; // safety check

        const playedOn = (end === 'left') ? leftEnd : rightEnd;
        const newValue = tile.isDouble() ? tile.high : tile.getOtherValue(playedOn);

        if (newValue !== -1 && newValue !== playedOn) {
            // Player introduced a new value — mild positive signal
            this._updateAffinity(player, newValue, 1.2);
        }

        // End avoidance: if both ends were different and tile could have played on
        // the other end but player chose this end, slight negative for avoided suit
        if (leftEnd !== rightEnd && !tile.isDouble()) {
            const avoided = (end === 'left') ? rightEnd : leftEnd;
            if (tile.hasValue(avoided)) {
                // Player had a choice and avoided this suit
                this._updateAffinity(player, avoided, 0.85);
            }
        }
    }

    // ==================== Properties (MonteCarloEvaluator compatibility) ====================

    get allTiles() {
        return this.handTracker.allTiles;
    }

    get tileCounts() {
        return this.handTracker.tileCounts;
    }

    get deadSuits() {
        return this.handTracker.deadSuits;
    }

    /**
     * View-adjusted known locations.
     * - Own tiles: marked as 'own' (this player knows them exactly)
     * - Human tiles (for computer views): treated as 'unknown'
     * - Everything else: delegates to HandTracker
     */
    get knownLocations() {
        this._rebuildLocationCache();
        return this._locationCache;
    }

    get playedTiles() {
        return this.handTracker.playedTiles;
    }

    get humanHand() {
        // For player 0 (human), expose real humanHand
        // For computer views, return empty set (they don't know human's tiles)
        if (this.playerIndex === 0) {
            return this.handTracker.humanHand;
        }
        return new Set();
    }

    get possibleHolders() {
        return this.handTracker.possibleHolders;
    }

    // ==================== Probability API ====================

    /**
     * Get probability that a specific player holds a specific tile.
     * Uses Bayesian affinity adjustments and per-tile normalization.
     *
     * @param {number} player - Player index (0-3)
     * @param {Tile|string} tile - Tile or tile key
     * @returns {number} Probability 0-1
     */
    getProbability(player, tile) {
        const key = typeof tile === 'string' ? tile : tile.toKey();
        const tileObj = typeof tile === 'string' ? this._findTile(key) : tile;

        // If tile is played, no one has it
        const htLocation = this.handTracker.knownLocations.get(key);
        if (htLocation === 'played') return 0;

        // If tile is in our own hand
        if (this.ownTileKeys.has(key)) {
            return player === this.playerIndex ? 1 : 0;
        }

        // For human view: human tiles are known exactly
        if (this.playerIndex === 0 && htLocation === 'human') {
            return player === 0 ? 1 : 0;
        }

        // Get view-adjusted possible holders for this tile
        const holders = this._getViewPossibleHolders(key);
        if (holders.size === 0) return 0;
        if (!holders.has(player)) return 0;

        // Calculate raw (affinity-adjusted) probabilities for all possible holders
        // then normalize so they sum correctly per tile
        let totalRaw = 0;
        const rawProbs = new Map();

        for (const p of holders) {
            const possibleCount = this._countPossibleTilesForPlayer(p);
            if (possibleCount === 0) {
                rawProbs.set(p, 0);
                continue;
            }
            const base = this.handTracker.tileCounts[p] / possibleCount;
            const affinity = tileObj ? this._getTileAffinity(p, tileObj) : 1.0;
            const raw = base * affinity;
            rawProbs.set(p, raw);
            totalRaw += raw;
        }

        if (totalRaw === 0) return 0;

        // Normalize: P(player has T) = raw(player, T) / sum(raw(Q, T))
        // Then scale so the max doesn't exceed 1
        const normalized = rawProbs.get(player) / totalRaw;

        // Scale by the number of holders to convert from share to probability
        // The total probability across all holders for one tile should not exceed
        // the sum of individual base probabilities
        const avgBase = Array.from(holders).reduce((sum, p) => {
            const pc = this._countPossibleTilesForPlayer(p);
            return sum + (pc > 0 ? this.handTracker.tileCounts[p] / pc : 0);
        }, 0);

        return Math.min(1, normalized * avgBase);
    }

    /**
     * Get probability that a player will pass on a given value.
     * @param {number} player - Player index (0-3)
     * @param {number} value - Suit value (0-6)
     * @returns {number} Probability 0-1
     */
    getPassProbability(player, value) {
        if (this.handTracker.deadSuits[player].has(value)) {
            return 1.0;
        }

        // If asking about our own hand, we know exactly
        if (player === this.playerIndex) {
            for (const key of this.ownTileKeys) {
                const parts = key.split('-').map(Number);
                if (parts[0] === value || parts[1] === value) {
                    return 0; // We have at least one tile with this value
                }
            }
            return 1.0; // We have no tiles with this value
        }

        // Count tiles with this value that the player could have
        const tilesWithValue = [];
        for (const tile of this.handTracker.allTiles) {
            if (!tile.hasValue(value)) continue;
            const key = tile.toKey();
            const holders = this._getViewPossibleHolders(key);
            if (holders.has(player)) {
                tilesWithValue.push(tile);
            }
        }

        if (tilesWithValue.length === 0) return 1.0;

        const possibleTiles = this._countPossibleTilesForPlayer(player);
        const playerTileCount = this.handTracker.tileCounts[player];

        if (possibleTiles === 0) return 1.0;

        const probHasNone = Math.pow(1 - (playerTileCount / possibleTiles), tilesWithValue.length);
        return Math.max(0, Math.min(1, probHasNone));
    }

    /**
     * Get probability of blocking a player by making both ends show specific values.
     * @param {number} player - Player to block (0-3)
     * @param {number} value1 - First end value
     * @param {number} value2 - Second end value
     * @returns {number} Probability 0-1
     */
    getBlockingProbability(player, value1, value2) {
        if (value1 === value2) {
            return this.getPassProbability(player, value1);
        }
        return this.getPassProbability(player, value1) * this.getPassProbability(player, value2);
    }

    /**
     * Get the most likely tiles for a given player.
     * @param {number} player - Player index (0-3)
     * @param {number} count - Number of tiles to return
     * @returns {Array<{tile: Tile, key: string, probability: number}>}
     */
    getMostLikely(player, count = 7) {
        const tilesWithProb = [];

        for (const tile of this.handTracker.allTiles) {
            const key = tile.toKey();
            if (this.handTracker.knownLocations.get(key) === 'played') continue;
            if (this.ownTileKeys.has(key) && player !== this.playerIndex) continue;

            const prob = this.getProbability(player, tile);
            if (prob > 0) {
                tilesWithProb.push({ tile, key, probability: prob });
            }
        }

        tilesWithProb.sort((a, b) => b.probability - a.probability);
        return tilesWithProb.slice(0, count);
    }

    /**
     * Get what we know for certain about a player.
     * @param {number} player - Player index (0-3)
     * @returns {object} { tileCount, deadSuits, possibleTileCount }
     */
    getKnownFacts(player) {
        return this.handTracker.getKnownFacts(player);
    }

    /**
     * Get unplayed tiles (delegates to HandTracker)
     */
    getUnplayedTiles() {
        return this.handTracker.getUnplayedTiles();
    }

    /**
     * Get human tile keys (only for player 0 view, empty for others)
     */
    getHumanTileKeys() {
        if (this.playerIndex === 0) {
            return this.handTracker.getHumanTileKeys();
        }
        return [];
    }

    /**
     * Get the suit affinities for debug display.
     * @returns {number[][]} 4x7 matrix of affinity values
     */
    getAffinities() {
        return this.affinities;
    }

    // ==================== Internal Methods ====================

    /**
     * Create a 4x7 affinity matrix initialized to 1.0
     * @private
     */
    _createAffinityMatrix() {
        return [
            [1, 1, 1, 1, 1, 1, 1],
            [1, 1, 1, 1, 1, 1, 1],
            [1, 1, 1, 1, 1, 1, 1],
            [1, 1, 1, 1, 1, 1, 1]
        ];
    }

    /**
     * Update a suit affinity, clamped to [0.1, 5.0]
     * @private
     */
    _updateAffinity(player, suit, multiplier) {
        if (suit < 0 || suit > 6) return;
        this.affinities[player][suit] = Math.max(0.1,
            Math.min(5.0, this.affinities[player][suit] * multiplier));
    }

    /**
     * Get affinity multiplier for a tile held by a player.
     * Uses geometric mean of the two suit affinities (or single for doubles).
     * @private
     */
    _getTileAffinity(player, tile) {
        if (tile.isDouble()) {
            return this.affinities[player][tile.high];
        }
        return Math.sqrt(this.affinities[player][tile.high] * this.affinities[player][tile.low]);
    }

    /**
     * Get view-adjusted possible holders for a tile.
     * Key difference from HandTracker:
     * - Computer views don't know the human's tiles, so human tiles are treated as unknown
     * - Own tiles are only held by self
     * @private
     */
    _getViewPossibleHolders(tileKey) {
        const htLocation = this.handTracker.knownLocations.get(tileKey);

        // Played tiles: no holders
        if (htLocation === 'played') return new Set();

        // Own tiles: only self
        if (this.ownTileKeys.has(tileKey)) return new Set([this.playerIndex]);

        // Human view (player 0): same as HandTracker
        if (this.playerIndex === 0) {
            if (htLocation === 'human') return new Set();
            return new Set(this.handTracker.possibleHolders.get(tileKey) || []);
        }

        // Computer view: human tiles are NOT known
        // They could be held by player 0 or any non-eliminated computer player
        const htHolders = this.handTracker.possibleHolders.get(tileKey) || new Set();

        if (htLocation === 'human') {
            // HandTracker knows this is in human's hand, but this computer view doesn't
            // Could be held by player 0, or by any computer player not eliminated by passes
            const holders = new Set();
            holders.add(0); // human is a possible holder from this view
            // Also add computer players who haven't been eliminated for this tile
            // (We need to check if the tile's suits are dead for each player)
            const tile = this._findTile(tileKey);
            if (tile) {
                for (let p = 1; p <= 3; p++) {
                    if (p === this.playerIndex) continue; // not us (we'd know if we had it)
                    // Check if this player could hold this tile based on passes
                    const couldHold = !this.handTracker.deadSuits[p].has(tile.high) &&
                                     !this.handTracker.deadSuits[p].has(tile.low);
                    if (couldHold) holders.add(p);
                }
            }
            return holders;
        }

        // Unknown tile: HandTracker has possible holders among computer players
        // Computer view needs to add player 0 as possible holder (since they don't know human's hand)
        const holders = new Set(htHolders);
        // Add player 0 if they haven't been eliminated for this tile by passes
        const tile = this._findTile(tileKey);
        if (tile) {
            const humanCouldHold = !this.handTracker.deadSuits[0].has(tile.high) &&
                                   !this.handTracker.deadSuits[0].has(tile.low);
            if (humanCouldHold) holders.add(0);
        }
        // Remove self if tile is not in our hand
        if (!this.ownTileKeys.has(tileKey)) {
            holders.delete(this.playerIndex);
        }
        return holders;
    }

    /**
     * Count possible tiles a player could hold from this view's perspective.
     * @private
     */
    _countPossibleTilesForPlayer(player) {
        let count = 0;
        for (const tile of this.handTracker.allTiles) {
            const key = tile.toKey();
            if (this.handTracker.knownLocations.get(key) === 'played') continue;
            if (this.ownTileKeys.has(key) && player !== this.playerIndex) continue;
            if (this.ownTileKeys.has(key) && player === this.playerIndex) { count++; continue; }

            const holders = this._getViewPossibleHolders(key);
            if (holders.has(player)) count++;
        }
        return count;
    }

    /**
     * Rebuild the location cache if HandTracker generation has changed.
     * @private
     */
    _rebuildLocationCache() {
        if (this._locationCache && this._locationCacheGeneration === this.handTracker._generation) {
            return;
        }

        this._locationCache = new Map();
        this._locationCacheGeneration = this.handTracker._generation;

        for (const tile of this.handTracker.allTiles) {
            const key = tile.toKey();
            const htLocation = this.handTracker.knownLocations.get(key);

            if (htLocation === 'played') {
                this._locationCache.set(key, 'played');
            } else if (this.ownTileKeys.has(key)) {
                // Mark own tiles distinctly
                this._locationCache.set(key, this.playerIndex === 0 ? 'human' : 'own');
            } else if (this.playerIndex === 0 && htLocation === 'human') {
                this._locationCache.set(key, 'human');
            } else {
                // For computer views, human tiles appear as 'unknown'
                this._locationCache.set(key, 'unknown');
            }
        }
    }

    /**
     * Find a Tile object by its key.
     * @private
     */
    _findTile(key) {
        for (const tile of this.handTracker.allTiles) {
            if (tile.toKey() === key) return tile;
        }
        return null;
    }
}
