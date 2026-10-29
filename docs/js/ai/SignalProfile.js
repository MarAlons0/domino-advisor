// Per-player reading of the suit signals (BACKLOG 0h phase 1, docs/DESIGN.md).
//
// Every AI reads every player's suit signals (the salida, a newly introduced
// number, an avoided end, a cuadrar) through the same affinity multipliers,
// which were tuned on Master's own play. Players differ: some lead from their
// longest suit, some hold it back. Once a hand is over its tiles are public,
// so for each signal a player gave we can check how many tiles of the
// signaled suit they still held, against what public information predicted.
// Relative to Master's (REFERENCE_LOG_RATIO), that says how honest this
// player's signals of each type are. The AI could read them with the
// multiplier raised to that power (light touch: shrunk toward 1 while the
// evidence is thin, capped) — tested in 0h phase 1, it gained nothing, so
// play doesn't use it. The Stats screen shows it as the player's style
// (interval()).

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
export const MIN_HANDS = 8;         // hands with the signal before interval() gives a reading

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
        // Per type: signals, tiles held and expected, and per-hand sums for the
        // interval (hands with the signal; Σ H², Σ H·E, Σ E² of each hand's totals).
        this.counts = Object.fromEntries(SIGNAL_TYPES.map(t => [t, { n: 0, held: 0, expected: 0, hands: 0, hh: 0, he: 0, ee: 0 }]));
        if (saved) for (const t of SIGNAL_TYPES) if (saved[t]) Object.assign(this.counts[t], saved[t]);
        this._pending = [];
    }

    /** A signal measured during the hand; it counts once the hand is over. */
    observe(type, held, expected) {
        this._pending.push({ type, held, expected });
    }

    /** The hand is over and its tiles are public: its signals count. */
    commitHand() {
        const byType = new Map();
        for (const { type, held, expected } of this._pending) {
            const c = this.counts[type];
            c.n++; c.held += held; c.expected += expected;
            const h = byType.get(type) || { held: 0, expected: 0 };
            h.held += held; h.expected += expected;
            byType.set(type, h);
        }
        for (const [type, h] of byType) {
            const c = this.counts[type];
            c.hands++; c.hh += h.held * h.held; c.he += h.held * h.expected; c.ee += h.expected * h.expected;
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

    /**
     * rawScale with a 95% interval. A hand's signals share one deal, so the
     * hand is the unit: the spread of each hand's held vs expected around the
     * overall ratio gives the ratio's standard error. Null until the type has
     * shown up in MIN_HANDS hands.
     * @returns {{estimate: number, low: number, high: number, n: number, hands: number}|null}
     */
    interval(type) {
        const c = this.counts[type];
        const ref = REFERENCE_LOG_RATIO[type];
        if (!ref || c.hands < MIN_HANDS || c.held === 0 || c.expected === 0) return null;
        const r = c.held / c.expected;
        const variance = Math.max(0, c.hh - 2 * r * c.he + r * r * c.ee) / (c.expected * c.expected)
            * c.hands / (c.hands - 1);
        const se = Math.sqrt(variance) / r;           // of ln r
        const lr = this.logRatio(type);
        const a = (lr - 1.96 * se) / ref, b = (lr + 1.96 * se) / ref;
        return { estimate: lr / ref, low: Math.min(a, b), high: Math.max(a, b), n: c.n, hands: c.hands };
    }

    /** All scales, in the shape PlayerView.signalScales[p] takes. */
    scales() {
        return Object.fromEntries(SIGNAL_TYPES.map(t => [t, this.scale(t)]));
    }

    toJSON() {
        return this.counts;
    }
}
