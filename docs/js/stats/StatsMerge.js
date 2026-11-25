// One lifetime record from several devices (docs/CROSS_DEVICE_STATS.md).
//
// Every stat is a count that adds up, a "largest" that keeps the larger value,
// or a "Your signals" sum, so the totals don't depend on the order the
// devices report in. The two win streaks are the exception: they come from a
// list of match results in time order (streaks()).
//
// A record is { totals, results, streakSeed, bestSeed, resetAt }:
//   totals      a stats object (same shape as DEFAULT_STATS)
//   results     [[finishedAt, 1 = won | 0 = lost], …], for the streaks
//   streakSeed  the first device's current streak when it linked
//   bestSeed    the best streak any device had when it linked
//   resetAt     the last "Reset stats"; matches that finished before it don't count
// Both streaks are worked out again from all the results on every change,
// never kept as a running max: while one device is offline the record can
// briefly hold wins without the losses between them (P0 test), and a max
// would keep that too-long streak for good.
//
// Pure — no browser globals — so the domino-rooms Worker can bundle it too.

import { SignalProfile } from '../ai/SignalProfile.js';

export const DEFAULT_STATS = {
    version: 1,
    since: null, // timestamp of the last reset; null = counting since first play
    matches: {
        played: 0, won: 0, lost: 0,
        currentStreak: 0, bestWinStreak: 0,
        largestWinMargin: 0, largestDeficitOvercome: 0,
        zapatosGiven: 0, zapatosReceived: 0
    },
    hands: {
        played: 0, won: 0, lost: 0, tied: 0,
        byReason: {
            domino: { won: 0, lost: 0 },
            closed: { won: 0, lost: 0 },
            blocked: { won: 0, lost: 0 }
        },
        largestScore: 0, largestSurrender: 0
    },
    cerrado: {
        // teamTotal / teamWon: ALL cerrado hands (any closer) and those our team won.
        // teamClosed / teamClosedWon: closes initiated by our team (you or partner).
        // youClosed / partnerClosed: closes by that seat that our team WON.
        teamTotal: 0, teamWon: 0, teamClosed: 0, teamClosedWon: 0,
        youClosed: 0, partnerClosed: 0,
        opponentTotal: 0, largestScore: 0, largestSurrender: 0,
        youClosedLargestScore: 0
    },
    coaching: {
        geninAgreements: 0, geninTotal: 0,
        handOverridesWon: 0,
        quizTotalScore: 0, quizAttempts: 0, bestQuizScore: 0
    },
    // Your suit signals vs public expectation, per type (ai/SignalProfile.js):
    // the Stats screen's "Your signals".
    style: new SignalProfile().toJSON(),
    badges: []
};

/** A fresh, all-zero stats object. */
export function emptyStats() {
    return JSON.parse(JSON.stringify(DEFAULT_STATS));
}

/** Leaves that keep the larger value. Every other number adds up. */
export const MAX_FIELDS = new Set([
    'matches.largestWinMargin',
    'matches.largestDeficitOvercome',
    'hands.largestScore',
    'hands.largestSurrender',
    'cerrado.largestScore',
    'cerrado.largestSurrender',
    'cerrado.youClosedLargestScore',
    'coaching.bestQuizScore',
]);

// Not merged by addStats: the streaks come from the results list (and the
// seeds addSnapshot keeps), `since` belongs to the record (resets, linking),
// `version` is the format.
const SKIP_FIELDS = new Set(['matches.currentStreak', 'matches.bestWinStreak', 'since', 'version']);

/**
 * Add badges into `target.badges`: one per id, the earliest earnedAt wins.
 * @param {object} target - stats object (changed in place)
 * @param {Array<{id: string, earnedAt: number}>} badges
 */
export function mergeBadges(target, badges) {
    if (!Array.isArray(target.badges)) target.badges = [];
    for (const b of badges || []) {
        if (!b || typeof b.id !== 'string') continue;
        const have = target.badges.find(x => x.id === b.id);
        if (!have) target.badges.push({ id: b.id, earnedAt: b.earnedAt });
        else if (Number.isFinite(b.earnedAt) && !(have.earnedAt <= b.earnedAt)) have.earnedAt = b.earnedAt;
    }
    return target;
}

function addInto(target, delta, path) {
    for (const key of Object.keys(delta)) {
        const p = path ? `${path}.${key}` : key;
        if (SKIP_FIELDS.has(p)) continue;
        const d = delta[key];
        if (p === 'badges') {
            mergeBadges(target, d);
        } else if (d !== null && typeof d === 'object' && !Array.isArray(d)) {
            if (target[key] === null || typeof target[key] !== 'object') target[key] = {};
            addInto(target[key], d, p);
        } else if (typeof d === 'number' && Number.isFinite(d)) {
            const t = typeof target[key] === 'number' ? target[key] : 0;
            target[key] = MAX_FIELDS.has(p) ? Math.max(t, d) : t + d;
        }
    }
}

/**
 * Add one device's stats (a match's delta, or a whole device's totals) into
 * `target`, in place. Unknown fields are added too, so a newer app's counters
 * survive an older one's merge.
 */
export function addStats(target, delta) {
    if (delta) addInto(target, delta, '');
    return target;
}

/**
 * The win streaks from match results in time order.
 * @param {Array<[number, number|boolean]>} results - [finishedAt, won], any order
 * @param {number} [seed] - a streak already running before the first result
 * @returns {{current: number, best: number}}
 */
export function streaks(results, seed = 0) {
    const sorted = [...results].sort((a, b) => a[0] - b[0]);
    let run = seed;
    let best = seed;
    for (const [, won] of sorted) {
        run = won ? run + 1 : 0;
        if (run > best) best = run;
    }
    return { current: run, best };
}

/** An empty record. */
export function emptyRecord() {
    return { totals: emptyStats(), results: [], streakSeed: 0, bestSeed: 0, resetAt: null };
}

/**
 * A record that starts from `base` (the totals a device last got from the
 * record), so addEntries can show base + that device's unsynced matches.
 */
export function recordFrom(base) {
    return {
        totals: JSON.parse(JSON.stringify(base)),
        results: [],
        streakSeed: base.matches?.currentStreak || 0,
        bestSeed: base.matches?.bestWinStreak || 0,
        resetAt: null,
    };
}

function refreshStreaks(record) {
    const { current, best } = streaks(record.results, record.streakSeed);
    const m = record.totals.matches;
    m.currentStreak = current;
    m.bestWinStreak = Math.max(record.bestSeed || 0, best);
}

/**
 * A device's existing stats, added as it links. The first device's current
 * streak keeps running; a joining device's is dropped (only one can be the
 * current one), its best streak still counts. "Counting since" becomes the
 * earliest start among the linked devices (null = since first play).
 * @param {object} record - changed in place
 * @param {object} stats - that device's stats object
 * @param {{first?: boolean}} [opts]
 */
export function addSnapshot(record, stats, { first = false } = {}) {
    addStats(record.totals, stats);
    record.bestSeed = Math.max(record.bestSeed || 0, stats.matches?.bestWinStreak || 0);
    const since = stats.since ?? null;
    if (first) {
        record.streakSeed = stats.matches?.currentStreak || 0;
        record.totals.since = since;
    } else if (record.totals.since !== null && (since === null || since < record.totals.since)) {
        record.totals.since = since;
    }
    refreshStreaks(record);
    return record;
}

/**
 * Finished (or abandoned) matches from one device.
 * Entries that finished before the record's last reset are dropped.
 * @param {object} record - changed in place
 * @param {Array<{at: number, won: boolean|null, delta: object}>} entries
 *        won is null for an abandoned match (its hands count, the match doesn't)
 */
export function addEntries(record, entries) {
    for (const e of entries) {
        if (record.resetAt !== null && e.at < record.resetAt) continue;
        addStats(record.totals, e.delta);
        if (e.won === true || e.won === false) record.results.push([e.at, e.won ? 1 : 0]);
    }
    refreshStreaks(record);
    return record;
}

/**
 * "Reset stats" at time `at`: everything starts over except badges. A reset
 * older than the record's last one changes nothing. Matches that finished
 * after `at` and already reached the record must be added again by the caller
 * (addEntries), since a reset can arrive late from a device that was offline.
 * @returns {boolean} whether the record was reset
 */
export function resetRecord(record, at) {
    if (record.resetAt !== null && at <= record.resetAt) return false;
    const badges = record.totals.badges;
    record.totals = emptyStats();
    record.totals.badges = badges;
    record.totals.since = at;
    record.results = [];
    record.streakSeed = 0;
    record.bestSeed = 0;
    record.resetAt = at;
    return true;
}
