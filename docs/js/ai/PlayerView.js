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

        // Monte Carlo marginal probability cache
        this._mcMarginals = null;        // Map<tileKey, Map<playerIndex, probability>>
        this._mcGeneration = -1;         // Generation when marginals were computed
        this._mcSampleCount = 500;       // Number of valid deals to sample

        // Per-deal, per-player suit-value bitmask (bits 0-6). Populated alongside
        // _mcMarginals; consumed by getPassProbability / getBlockingProbability
        // when useMcDerivedPassProb is true.
        this._mcDealMasks = null;

        // Variant flag: when true, pass/block probabilities are computed
        // directly from MC sample deals (captures correlations between tile
        // holdings) instead of the binomial approximation. Off by default so
        // existing behavior is unchanged.
        this.useMcDerivedPassProb = false;

        // When true, _sampleValidDeals falls back to a backtracking assignment
        // whenever the greedy sampler comes up short. Without it, constrained
        // mid-hand positions can fail all greedy attempts, and ISMCTS's
        // cloneAndRandomize then silently reuses the REAL hands — a perfect-
        // information leak measured at ~2% of determinizations (peak 3.7% at
        // 12-15 tiles played). On by default; the harness `no-det-backstop`
        // variant disables it to reproduce the old behavior in A/Bs.
        this.useSamplerBackstop = true;

        // (Platt-scaling recalibration on getProbability is now always on.
        // The useCalibratedProbs flag was a transitional gate; confirmed
        // non-regressive in a 500-match A/B and locked in for v1.1.1.)
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
        this._mcMarginals = null;
        this._mcGeneration = -1;
        this._mcDealMasks = null;
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

        // Note: end-avoidance affinity updates are now driven by SmartAI.analyzePlayChoice()
        // via applyAffinitySignal(), which applies team-contextual multipliers instead of
        // the former context-free 0.85×.
    }

    /**
     * Apply an affinity signal to a player's suit preference from external context.
     * Called by SmartAI to inject team-contextual play inference, replacing the
     * context-free 0.85× end-avoidance signal that was previously applied in
     * recordPlayObservation().
     * @param {number} player - Which player's affinity to update (0-3)
     * @param {number} suit - Which suit (0-6)
     * @param {number} multiplier - Affinity adjustment (< 1 = negative, > 1 = positive)
     */
    applyAffinitySignal(player, suit, multiplier) {
        this._updateAffinity(player, suit, multiplier);
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

        // Try MC marginals first
        this._computeMCMarginals();
        if (this._mcMarginals && this._mcMarginals.has(key)) {
            return this._calibrate(this._mcMarginals.get(key).get(player) || 0);
        }

        // Fallback: original heuristic (if MC sampling failed)
        return this._calibrate(this._heuristicProbability(player, key, tileObj, holders));
    }

    /**
     * Platt-scaling recalibration of a probability. Fitted to the calibration
     * curve measured in BACKLOG item 0c (300 matches, May 2026):
     *   logit(P_cal) = a · logit(P_raw) + b,  with a ≈ 1.10, b ≈ 0.04.
     * Stretches mid-high predictions slightly upward and compresses low ones
     * to match observed frequencies. Trivial values (0, 1) pass through.
     *
     * NOTE: re-fit if the underlying inference layers (HandTracker constraint
     * propagation, PlayerView affinity Bayesian updates, or MC sampling
     * weights) change in a way that meaningfully shifts the calibration curve.
     * Use `tools/tournament.js --all-variant ... --prob-accuracy` to measure.
     * @private
     */
    _calibrate(p) {
        if (p <= 0 || p >= 1) return p;
        const a = 1.10;
        const b = 0.04;
        const logit = Math.log(p / (1 - p));
        const calLogit = a * logit + b;
        return 1 / (1 + Math.exp(-calLogit));
    }

    /**
     * Original heuristic probability: N/M with affinity adjustment.
     * Used as fallback when MC sampling fails.
     * @private
     */
    _heuristicProbability(player, key, tileObj, holders) {
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

        return rawProbs.get(player) / totalRaw;
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

        // MC-derived path: fraction of sampled deals where the player holds
        // zero tiles with this value. Naturally captures the negative
        // correlation between tile holdings that the binomial approximation
        // ignores.
        if (this.useMcDerivedPassProb) {
            this._computeMCMarginals();
            if (this._mcDealMasks && this._mcDealMasks.length >= 50) {
                const bit = 1 << value;
                let count = 0;
                for (const masks of this._mcDealMasks) {
                    if ((masks[player] & bit) === 0) count++;
                }
                return count / this._mcDealMasks.length;
            }
            // Fall through to the binomial fallback if MC sampling failed.
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

        // MC-derived joint: fraction of sampled deals where the player holds
        // zero tiles with either end value. Captures negative correlation
        // (lacking suit V1 makes lacking V2 less likely) that the independent
        // product formula misses.
        if (this.useMcDerivedPassProb) {
            this._computeMCMarginals();
            if (this._mcDealMasks && this._mcDealMasks.length >= 50) {
                const mask = (1 << value1) | (1 << value2);
                let count = 0;
                for (const masks of this._mcDealMasks) {
                    if ((masks[player] & mask) === 0) count++;
                }
                return count / this._mcDealMasks.length;
            }
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

    // ==================== Monte Carlo Marginals ====================

    /**
     * Compute MC marginal probabilities if cache is stale.
     * Lazily called on first getProbability() after a generation change.
     * @private
     */
    _computeMCMarginals() {
        if (this._mcGeneration === this.handTracker._generation) {
            return; // cache valid
        }

        const deals = this._sampleValidDeals(this._mcSampleCount);

        if (deals.length < 50) {
            this._mcMarginals = null; // signal to fall back to heuristic
            this._mcDealMasks = null;
            this._mcGeneration = this.handTracker._generation;
            return;
        }

        // Precompute per-deal suit-value bitmasks per player (bits 0-6 = which
        // suit values that player holds in this sampled deal). Used by
        // MC-derived pass/block probabilities. Built here so we walk deals once.
        const keyToValues = new Map();
        for (const tile of this.handTracker.allTiles) {
            keyToValues.set(tile.toKey(), [tile.high, tile.low]);
        }
        let ownMask = 0;
        for (const key of this.ownTileKeys) {
            const vs = keyToValues.get(key);
            if (vs) ownMask |= (1 << vs[0]) | (1 << vs[1]);
        }
        const dealMasks = new Array(deals.length);
        for (let d = 0; d < deals.length; d++) {
            const masks = [0, 0, 0, 0];
            masks[this.playerIndex] = ownMask;
            for (const [key, player] of deals[d]) {
                const vs = keyToValues.get(key);
                if (vs) masks[player] |= (1 << vs[0]) | (1 << vs[1]);
            }
            dealMasks[d] = masks;
        }
        this._mcDealMasks = dealMasks;

        const marginals = new Map();

        // Collect unknown tile keys (same set used in sampling)
        for (const tile of this.handTracker.allTiles) {
            const key = tile.toKey();
            const htLocation = this.handTracker.knownLocations.get(key);
            if (htLocation === 'played') continue;
            if (this.ownTileKeys.has(key)) continue;
            if (this.playerIndex === 0 && htLocation === 'human') continue;

            const counts = new Map();
            for (let p = 0; p < 4; p++) counts.set(p, 0);

            for (const deal of deals) {
                const holder = deal.get(key);
                if (holder !== undefined) {
                    counts.set(holder, counts.get(holder) + 1);
                }
            }

            const probs = new Map();
            for (const [p, count] of counts) {
                if (count > 0) {
                    probs.set(p, count / deals.length);
                }
            }
            marginals.set(key, probs);
        }

        this._mcMarginals = marginals;
        this._mcGeneration = this.handTracker._generation;
    }

    /**
     * Sample valid deal completions consistent with all known constraints.
     * Each deal assigns every unknown tile to a player such that each player
     * ends up with exactly the right number of tiles.
     *
     * @param {number} numSamples - Target number of valid deals
     * @returns {Array<Map<string, number>>} Array of valid deals (tileKey → playerIndex)
     * @private
     */
    _sampleValidDeals(numSamples) {
        // Collect unknown tiles and their possible holders
        const unknownTiles = [];   // [{key, tile, holders}]
        for (const tile of this.handTracker.allTiles) {
            const key = tile.toKey();
            const htLocation = this.handTracker.knownLocations.get(key);
            if (htLocation === 'played') continue;
            if (this.ownTileKeys.has(key)) continue;
            if (this.playerIndex === 0 && htLocation === 'human') continue;

            const holders = this._getViewPossibleHolders(key);
            if (holders.size > 0) {
                unknownTiles.push({ key, tile, holders: Array.from(holders) });
            }
        }

        if (unknownTiles.length === 0) return [];

        // Build target counts: how many tiles each player needs
        const targetCounts = new Map();
        for (let p = 0; p < 4; p++) {
            if (p === this.playerIndex) continue;
            // For human view (p=0), human tiles are known, so exclude self
            // For computer views, self tiles are known, so exclude self
            targetCounts.set(p, this.handTracker.tileCounts[p]);
        }
        // Own tiles are known, so our target for sampling is 0
        // (we don't sample our own tiles)

        const validDeals = [];
        const maxAttempts = 3 * numSamples;

        for (let attempt = 0; attempt < maxAttempts && validDeals.length < numSamples; attempt++) {
            // Shuffle unknown tiles to randomize assignment order
            const shuffled = unknownTiles.slice();
            for (let i = shuffled.length - 1; i > 0; i--) {
                const j = Math.floor(Math.random() * (i + 1));
                [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
            }

            const deal = new Map();
            const currentCounts = new Map();
            for (const [p, target] of targetCounts) {
                currentCounts.set(p, 0);
            }

            let valid = true;
            for (const { key, tile, holders } of shuffled) {
                // Filter to eligible players (in holders AND still need tiles)
                const eligible = holders.filter(p =>
                    targetCounts.has(p) && currentCounts.get(p) < targetCounts.get(p)
                );

                if (eligible.length === 0) {
                    valid = false;
                    break;
                }

                // Affinity-weighted random selection
                const weights = eligible.map(p => this._getTileAffinity(p, tile));
                const totalWeight = weights.reduce((a, b) => a + b, 0);
                let r = Math.random() * totalWeight;
                let selected = eligible[eligible.length - 1];
                for (let i = 0; i < eligible.length; i++) {
                    r -= weights[i];
                    if (r <= 0) { selected = eligible[i]; break; }
                }
                deal.set(key, selected);
                currentCounts.set(selected, currentCounts.get(selected) + 1);
            }

            if (valid) {
                // Verify all players hit their target counts
                let countsMatch = true;
                for (const [p, target] of targetCounts) {
                    if (currentCounts.get(p) !== target) {
                        countsMatch = false;
                        break;
                    }
                }
                if (countsMatch) {
                    validDeals.push(deal);
                }
            }
        }

        // Backstop: the greedy pass assigns tiles in shuffled order with no
        // backtracking, so tight positions can dead-end every attempt. The true
        // deal is always consistent with the constraints, so a full assignment
        // exists — find the missing samples by backtracking search instead of
        // returning short (which leaks real hands into ISMCTS determinization).
        if (this.useSamplerBackstop) {
            while (validDeals.length < numSamples) {
                const deal = this._backtrackingDeal(unknownTiles, targetCounts);
                if (deal === null) break; // constraint model inconsistent; give up
                validDeals.push(deal);
            }
        }

        return validDeals;
    }

    /**
     * Single affinity-weighted random deal via backtracking search.
     * Assigns most-constrained tiles first (fewest possible holders); at each
     * tile, tries eligible holders in affinity-weighted random order and
     * backtracks on dead ends. Guaranteed to find a deal when one exists
     * (the real deal always does), unlike the greedy pass above.
     *
     * @param {Array<{key: string, tile: Tile, holders: number[]}>} unknownTiles
     * @param {Map<number, number>} targetCounts - tiles each player needs
     * @returns {Map<string, number>|null} tileKey → playerIndex, or null
     * @private
     */
    _backtrackingDeal(unknownTiles, targetCounts) {
        // Most-constrained-first ordering; random tiebreak keeps samples diverse.
        const tiles = unknownTiles
            .map(t => ({ t, r: Math.random() }))
            .sort((a, b) => (a.t.holders.length - b.t.holders.length) || (a.r - b.r))
            .map(x => x.t);

        const counts = new Map();
        for (const p of targetCounts.keys()) counts.set(p, 0);
        const deal = new Map();
        // Step budget bounds pathological cases; normal positions resolve with
        // little to no backtracking thanks to the MRV ordering.
        let steps = 0;
        const MAX_STEPS = 20000;

        const assign = (i) => {
            if (i === tiles.length) return true;
            if (++steps > MAX_STEPS) return false;
            const { key, tile, holders } = tiles[i];
            const pool = [];
            for (const p of holders) {
                if (targetCounts.has(p) && counts.get(p) < targetCounts.get(p)) {
                    pool.push({ p, w: this._getTileAffinity(p, tile) });
                }
            }
            // Affinity-weighted random order without replacement.
            while (pool.length > 0) {
                const total = pool.reduce((s, e) => s + e.w, 0);
                let r = Math.random() * total;
                let idx = pool.length - 1;
                for (let j = 0; j < pool.length; j++) {
                    r -= pool[j].w;
                    if (r <= 0) { idx = j; break; }
                }
                const p = pool.splice(idx, 1)[0].p;
                deal.set(key, p);
                counts.set(p, counts.get(p) + 1);
                if (assign(i + 1)) return true;
                counts.set(p, counts.get(p) - 1);
                deal.delete(key);
            }
            return false;
        };

        if (!assign(0)) return null;
        // Mirror the greedy path's final guard: every player at target count.
        for (const [p, target] of targetCounts) {
            if (counts.get(p) !== target) return null;
        }
        return deal;
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
        const a1 = this.affinities[player][tile.high];
        const a2 = this.affinities[player][tile.low];
        if (tile.isDouble()) return a1;
        return Math.sqrt(a1 * a2);
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
