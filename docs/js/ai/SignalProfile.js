// Per-player reading of the suit signals (BACKLOG 0h phase 1, docs/DESIGN.md).
//
// Every AI reads every player's suit signals (the salida, a newly introduced
// number, an avoided end, a cuadrar) through the same affinity multipliers,
// which were tuned on Master's own play. Players differ: some lead from their
// longest suit, some hold it back. Once a hand is over its tiles are public,
// so for each signal a player gave we can check how many tiles of the
// signaled suit they still held, against what public information predicted.
// Relative to Master's (REFERENCE_LOG_RATIO), that says how honest this
// player's signals of each type are, and the AI reads them with the
// multiplier raised to that power. Light touch: shrunk toward 1 while the
// evidence is thin, capped, and exactly today's reading with no history.

export const SIGNAL_TYPES = ['leadDouble', 'lead', 'newNumber', 'avoid', 'cuadrar'];

// ln(held / expected) per signal type for Master players: v1.16.0 self-play,
// 300 matches, tools/tournament.js --signal-honesty (shard spread ±0.02 for
// newNumber, ±0.05 for the rest). A player whose ratio matches gets scale 1
// (read as today). `avoid` has no reference and is never scaled: SmartAI
// doesn't send it in play (SmartAI.avoidSignal is off). When on, Master's
// ln ratio is −0.217 over 19,953 signals.
export const REFERENCE_LOG_RATIO = {
    leadDouble: 0.242,  // 1,952 signals
    lead: 0.193,        // 824
    newNumber: 0.174,   // 40,577
    avoid: null,
    cuadrar: 0.271,     // 4,510
};

const PRIOR_EVENTS = 30;            // shrinkage: the evidence weighs n / (n + 30)
const MIN_SCALE = 0.5;              // cap, in log space: 0.5×–1.5× the default
const MAX_SCALE = 1.5;

/**
 * How many tiles of `suit` a player still holds right after a signal, and how
 * many public information predicts: their hand size times the share of
 * `suit` among the unplayed tiles they could hold (their passes rule out
 * whole suits).
 * @param {Tile[]} handTiles - the player's hand after the play
 * @param {number} suit
 * @param {Tile[]} unplayedTiles - every tile not yet on the board
 * @param {Set<number>} deadSuits - suits the player has passed on
 * @returns {{held: number, expected: number}}
 */
export function measureSignal(handTiles, suit, unplayedTiles, deadSuits) {
    const possible = unplayedTiles.filter(t => !deadSuits.has(t.high) && !deadSuits.has(t.low));
    const inSuit = possible.filter(t => t.hasValue(suit)).length;
    return {
        held: handTiles.filter(t => t.hasValue(suit)).length,
        expected: possible.length ? handTiles.length * inSuit / possible.length : 0,
    };
}

export class SignalProfile {
    /** @param {object} [saved] - a previous toJSON() */
    constructor(saved = null) {
        this.counts = Object.fromEntries(SIGNAL_TYPES.map(t => [t, { n: 0, held: 0, expected: 0 }]));
        if (saved) for (const t of SIGNAL_TYPES) if (saved[t]) Object.assign(this.counts[t], saved[t]);
        this._pending = [];
    }

    /** A signal measured during the hand; it counts once the hand is over. */
    observe(type, held, expected) {
        this._pending.push({ type, held, expected });
    }

    /** The hand is over and its tiles are public: its signals count. */
    commitHand() {
        for (const { type, held, expected } of this._pending) {
            const c = this.counts[type];
            c.n++; c.held += held; c.expected += expected;
        }
        this._pending = [];
    }

    /** ln(held / expected) over all of this player's signals of a type; null with none. */
    logRatio(type) {
        const c = this.counts[type];
        if (c.n === 0) return null;
        return Math.log((c.held + 0.5) / (c.expected + 0.5));
    }

    /** Honesty relative to Master (1 = as honest), from all the evidence, unshrunk; null if unknown. */
    rawScale(type) {
        const ref = REFERENCE_LOG_RATIO[type];
        const lr = this.logRatio(type);
        return ref && lr !== null ? lr / ref : null;
    }

    /** The exponent the AI applies to this type's multiplier: shrunk toward 1, capped. */
    scale(type) {
        const raw = this.rawScale(type);
        if (raw === null) return 1;
        const n = this.counts[type].n;
        const shrunk = 1 + (Math.max(-1, Math.min(3, raw)) - 1) * n / (n + PRIOR_EVENTS);
        return Math.max(MIN_SCALE, Math.min(MAX_SCALE, shrunk));
    }

    /** All scales, in the shape PlayerView.signalScales[p] takes. */
    scales() {
        return Object.fromEntries(SIGNAL_TYPES.map(t => [t, this.scale(t)]));
    }

    toJSON() {
        return this.counts;
    }
}
