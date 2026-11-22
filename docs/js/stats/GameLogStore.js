// Your finished single-player matches, move by move, kept on this device for
// Stats → Export my games: a JSON file download. Nothing is sent anywhere.
// The logs show how people really play (which salidas, how they push a number,
// when they pass), to calibrate the simulated players in tools/personas.js.
// Read an export with tools/human-games.js.

import { StorageService } from './StorageService.js';

export const GAME_LOGS_KEY = '7fichas_game_logs';
export const GAME_LOG_FORMAT = 1;
// Newest matches kept. A match is about 10 KB, and localStorage holds about
// 5 million characters per site, shared with stats and quiz history, so the
// character cap usually binds first (~150 matches).
export const MAX_MATCHES = 200;
export const MAX_CHARS = 1_500_000;

/** What each entry of a hand's `moves` holds, in order (written into every export). */
export const MOVE_FIELDS = ['seat', 'tile', 'end', 'leftEnd', 'rightEnd', 'coach'];

const key = (tile) => (tile ? `${tile.high}-${tile.low}` : null);
const side = (end) => (end === 'left' ? 'L' : end === 'right' ? 'R' : null);

/**
 * One hand's move: [seat, tile, end, leftEnd, rightEnd] plus, on your own
 * plays, a coach object. tile is null for a pass; end ('L'/'R') and the two
 * board ends are null on the salida (empty board). The board ends are the ones
 * showing before the move.
 */
function serializeMove(play) {
    const snap = play.stateSnapshot || {};
    const salida = !!play.tile && !snap.chainSize;
    const move = [
        play.player,
        key(play.tile),
        salida ? null : side(play.end),
        snap.leftEnd ?? null,
        snap.rightEnd ?? null,
    ];
    if (play.isHuman && play.tile) {
        // Genín's pick for that turn, whether you had asked him before playing,
        // and the grade the debrief gave the play.
        const coach = {};
        const rec = play.aiRecommendation;
        if (rec?.tile) coach.genin = [key(rec.tile), salida ? null : side(rec.end)];
        if (play.turnAnalysis?.adviceShown) coach.asked = true;
        if (play.evaluation) coach.grade = play.evaluation;
        if (Object.keys(coach).length) move.push(coach);
    }
    return move;
}

/**
 * A finished match as a plain object for the game log.
 * @param {import('../models/MatchHistory.js').MatchHistory} history
 * @param {object} info
 * @param {string[]} info.levels - per seat: 'human' for seat 0, else the AI level
 * @param {number[]} info.finalScore - [your team, opponents]
 * @param {number} info.winner - winning team (0 = yours)
 * @param {number} info.target - points to win the match
 * @param {string} info.version - app version, e.g. '1.21.0'
 * @param {Date} [info.date]
 */
export function serializeMatch(history, { levels, finalScore, winner, target, version, date = new Date() }) {
    const running = [0, 0];
    return {
        date: date.toISOString(),
        version,
        levels,
        target,
        score: [...finalScore],
        winner,
        hands: history.hands.map(hand => {
            const r = hand.result;
            if (r && r.winner >= 0) running[r.winner] += r.points;
            return {
                n: hand.handNumber,
                opener: hand.startingPlayer,
                start: hand.startingHands || null,
                moves: hand.plays.map(serializeMove),
                result: r ? { reason: r.reason, winner: r.winner, points: r.points, score: [...running] } : null,
            };
        }),
    };
}

/** Drop the oldest matches until the list fits both caps. */
function trim(list) {
    while (list.length > MAX_MATCHES) list.shift();
    const sizes = list.map(m => JSON.stringify(m).length + 1);
    let total = sizes.reduce((a, b) => a + b, 1);
    while (list.length > 1 && total > MAX_CHARS) {
        list.shift();
        total -= sizes.shift();
    }
    return list;
}

export const GameLogStore = {
    /** All saved matches, oldest first. */
    all() {
        const v = StorageService.get(GAME_LOGS_KEY);
        return Array.isArray(v) ? v : [];
    },

    count() {
        return this.all().length;
    },

    /**
     * Save a finished match, keeping the newest ones. If storage is full, older
     * matches make room; if even this one can't be stored, nothing changes.
     * Never throws.
     */
    add(match) {
        try {
            const list = trim([...this.all(), match]);
            while (list.length) {
                // !== false: a StorageService cached from before 1.21 returns nothing.
                if (StorageService.set(GAME_LOGS_KEY, list) !== false) return true;
                // Quota: free about a tenth of the log and try again.
                list.splice(0, Math.max(1, Math.floor(list.length / 10)));
            }
        } catch (e) {
            console.warn('GameLogStore: could not save the match', e);
        }
        return false;
    },

    /** The export file's content. @param {string} version - current app version */
    exportJSON(version) {
        return JSON.stringify({
            app: '7 Fichas',
            kind: 'game-logs',
            format: GAME_LOG_FORMAT,
            exportedAt: new Date().toISOString(),
            version,
            seats: 'Seat 0 is you and seat 2 your partner (team 0); seats 1 and 3 are the opponents (team 1). Play goes 0 → 1 → 2 → 3.',
            moveFields: MOVE_FIELDS,
            matches: this.all(),
        });
    },
};
