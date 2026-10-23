// Keeps your multiplayer coaching record across a reload. Phones often drop a
// background tab and reload it when you come back: the room restores the table,
// and this restores Genín's analysis of your earlier plays, so the hand-end card
// and the debrief still cover the whole match. One room at a time — saving drops
// any other room's record. See docs/MULTIPLAYER.md.

import { StorageService } from '../stats/StorageService.js';
import { TileSet } from '../engine/TileSet.js';

const PREFIX = '7fichas_mp_history_';
const TILE_BY_KEY = new Map(TileSet.create().map(t => [t.toKey(), t]));

// JSON turns each Tile into {high, low}; turn those back into Tile objects.
function revive(v) {
    if (Array.isArray(v)) return v.map(revive);
    if (!v || typeof v !== 'object') return v;
    const keys = Object.keys(v);
    if (keys.length === 2 && 'high' in v && 'low' in v) return TILE_BY_KEY.get(`${v.high}-${v.low}`) ?? v;
    const out = {};
    for (const k of keys) out[k] = revive(v[k]);
    return out;
}

export class MatchHistoryStore {
    constructor(code) {
        this.key = PREFIX + code;
    }

    /** @param {number} matchNumber @param {number} seat - server seat @param {MatchHistory} history */
    save(matchNumber, seat, history) {
        try {
            for (let i = localStorage.length - 1; i >= 0; i--) {
                const k = localStorage.key(i);
                if (k && k.startsWith(PREFIX) && k !== this.key) localStorage.removeItem(k);
            }
        } catch { /* storage unavailable */ }
        StorageService.set(this.key, { matchNumber, seat, hands: history.hands });
    }

    /** The saved hands for this match and seat, or null. */
    load(matchNumber, seat) {
        const saved = StorageService.get(this.key);
        if (!saved || saved.matchNumber !== matchNumber || saved.seat !== seat || !Array.isArray(saved.hands)) return null;
        return revive(saved.hands);
    }
}
