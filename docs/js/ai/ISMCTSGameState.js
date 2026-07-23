// ISMCTS adapter wrapping our Game/Chain/Hand types with the interface that
// ISMCTSEvaluator.ismcts() expects. Backlog item 0f.
//
// Move keys are strings: "<tile-key>|<end>" (e.g. "6-4|left") or "pass".
// The adapter holds a reference to the AI's PlayerView so cloneAndRandomize()
// can sample valid hand assignments consistent with everything observed so far.

import { Rules } from '../engine/Rules.js';
import { Hand } from '../models/Hand.js';

const PASS = 'pass';

export class ISMCTSGameState {
    /**
     * Build the root state for an ISMCTS search.
     * @param {object} opts
     * @param {GameState} opts.realState     - the real game state to search from
     * @param {number}   opts.observerIndex  - the AI seat running ISMCTS
     * @param {PlayerView} opts.view         - that AI's PlayerView (used for sampling)
     * @param {HandTracker} opts.handTracker - shared tracker
     */
    constructor({ realState, observerIndex, view, handTracker }) {
        this.observerIndex = observerIndex;
        this.view = view;
        this.handTracker = handTracker;
        this.playerToMove = realState.currentPlayer;
        this.hands = realState.hands.map(h => h.clone());
        this.chain = realState.chain.clone();
        this.consecutivePasses = realState.consecutivePasses;
        this.isFirstHand = realState.isFirstHand;
        // Cache tile lookup for fast move-key → Tile resolution
        this._tileByKey = new Map();
        for (const tile of this.handTracker.allTiles) {
            this._tileByKey.set(tile.toKey(), tile);
        }
    }

    /**
     * Internal shallow-copy constructor used by cloneAndRandomize. Hands and
     * chain are deep-cloned because doMove mutates them.
     * @private
     */
    _clone() {
        const c = Object.create(ISMCTSGameState.prototype);
        c.observerIndex = this.observerIndex;
        c.view = this.view;
        c.handTracker = this.handTracker;
        c.playerToMove = this.playerToMove;
        c.chain = this.chain.clone();
        c.consecutivePasses = this.consecutivePasses;
        c.isFirstHand = this.isFirstHand;
        c._tileByKey = this._tileByKey; // immutable, share
        c.hands = this.hands.map(h => h.clone());
        return c;
    }

    /**
     * Produce a fresh state where the observer's hand is unchanged but the
     * other three players' hands are resampled to be consistent with all
     * observed information (played tiles, passes, dead suits).
     */
    cloneAndRandomize(observer) {
        const c = this._clone();
        // Use the PlayerView's MC sampler — it already enforces dead-suit
        // constraints and respects tile counts. We request 1 sample. With the
        // sampler's backtracking backstop this cannot come back empty unless
        // the constraint model itself is inconsistent; the bare `return c`
        // below (which keeps the REAL hands — an information leak) is a
        // last-resort guard, not an expected path.
        const deals = this.view._sampleValidDeals(1);
        if (deals.length === 0) return c; // sampler failed; keep current hands

        const deal = deals[0]; // Map<tileKey, playerIndex>
        // Replace non-observer hands with fresh Hand objects, then fill from
        // the deal. Observer keeps their real hand untouched.
        for (let p = 0; p < 4; p++) {
            if (p === observer) continue;
            c.hands[p] = new Hand();
        }
        for (const [tileKey, playerIdx] of deal) {
            if (playerIdx === observer) continue; // own tiles already in place
            const tile = this._tileByKey.get(tileKey);
            if (tile) c.hands[playerIdx].add(tile);
        }
        return c;
    }

    /**
     * Legal move keys for the current player. Returns [] iff the game is
     * terminal (someone dominoed, board is closed, or four consecutive passes).
     */
    getMoves() {
        if (this._isTerminal()) return [];
        const hand = this.hands[this.playerToMove];
        const mustPlayDoubleSix = this.isFirstHand && this.chain.isEmpty();
        const valid = Rules.getValidMoves(hand, this.chain, mustPlayDoubleSix);
        if (valid.length === 0) return [PASS];
        // Encode each {tile, end} as "tileKey|end"
        return valid.map(m => `${m.tile.toKey()}|${m.end}`);
    }

    /**
     * Apply a move key, mutating this state and advancing playerToMove.
     */
    doMove(moveKey) {
        if (moveKey === PASS) {
            this.consecutivePasses += 1;
        } else {
            const [tileKey, end] = moveKey.split('|');
            const tile = this._tileByKey.get(tileKey);
            const hand = this.hands[this.playerToMove];
            hand.remove(tile);
            this.chain.play(tile, end, this.playerToMove);
            this.consecutivePasses = 0;
        }
        this.playerToMove = (this.playerToMove + 1) % 4;
    }

    /**
     * Result from the perspective of `player`: 1 = their team won, 0 = lost,
     * 0.5 = tied. Must only be called at a terminal state.
     */
    getResult(player) {
        const myTeam = player % 2; // seats 0,2 = team 0; seats 1,3 = team 1
        // Domino: any player with empty hand wins for their team.
        for (let p = 0; p < 4; p++) {
            if (this.hands[p].size() === 0) {
                return (p % 2) === myTeam ? 1 : 0;
            }
        }
        // Otherwise blocked (or closed): compare team pip totals.
        const team0Pips = this.hands[0].pipCount() + this.hands[2].pipCount();
        const team1Pips = this.hands[1].pipCount() + this.hands[3].pipCount();
        if (team0Pips === team1Pips) return 0.5;
        const winnerTeam = team0Pips < team1Pips ? 0 : 1;
        return winnerTeam === myTeam ? 1 : 0;
    }

    /** @private */
    _isTerminal() {
        if (this.consecutivePasses >= 4) return true;
        if (this.chain.isClosed()) return true;
        for (let p = 0; p < 4; p++) {
            if (this.hands[p].size() === 0) return true;
        }
        return false;
    }
}
