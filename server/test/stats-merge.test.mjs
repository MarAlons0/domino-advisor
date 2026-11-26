// One lifetime record across devices (docs/CROSS_DEVICE_STATS.md, P0).
// The same matches, recorded on one device or spread over three devices that
// sync now and then, in any order, must end in the same record — every count,
// every "largest", Your signals, the badges and (in time order) the streaks.
// The matches are real self-play (Beginner, seeded); the coaching, quiz and
// signal inputs the recorder also takes are made up, so every stat moves.
import test from 'node:test';
import assert from 'node:assert/strict';

// A tiny localStorage for PlayerStats.save (set before the app modules load).
const mem = new Map();
globalThis.localStorage = {
    getItem: (k) => (mem.has(k) ? mem.get(k) : null), setItem: (k, v) => mem.set(k, String(v)),
    removeItem: (k) => mem.delete(k), key: (i) => [...mem.keys()][i] ?? null, get length() { return mem.size; },
};

const { PlayerStats } = await import('../../docs/js/stats/PlayerStats.js');
const { BadgeSystem } = await import('../../docs/js/stats/BadgeSystem.js');
const SM = await import('../../docs/js/stats/StatsMerge.js');
const { makeTrace, recordMatch, assertSameStats, seeded, MINUTE } = await import('./helpers/stats-trace.mjs');

const MATCHES = Number(process.env.STATS_MATCHES || 40);
const clone = (x) => JSON.parse(JSON.stringify(x));
const TRACE = makeTrace(MATCHES);
const badgeSystem = new BadgeSystem();

/** A recorder with nothing saved yet. */
function freshRecorder() {
    mem.delete('7fichas_stats');
    const ps = new PlayerStats();
    ps.load();
    return ps;
}

/** A device that never syncs: today's app. */
function oneDevice(matches, { resetAt = null } = {}) {
    const ps = freshRecorder();
    for (const m of matches) {
        if (resetAt !== null && m.at > resetAt && ps.get().since !== resetAt) {
            ps.reset();
            ps.get().since = resetAt;
        }
        recordMatch(ps, m, { badgeSystem });
    }
    return ps.get();
}

/** One match recorded on its own, from nothing — that is its delta. */
function matchEntry(match) {
    const ps = freshRecorder();
    recordMatch(ps, match);
    return { at: match.at, won: match.end ? match.end.data.winner === 0 : null, delta: ps.get() };
}

function checkBadges(stats) {
    badgeSystem.checkHandBadges(stats);
    badgeSystem.checkMatchBadges(stats);
}

/** The StatsRecord Durable Object of P2, in memory: keeps what it got, so a late reset can rebuild. */
class ServerSim {
    constructor() { this.record = SM.emptyRecord(); this.stored = []; }
    snapshot(stats, at, first) {
        SM.addSnapshot(this.record, stats, { first });
        this.stored.push({ at, snapshot: clone(stats) });
        return clone(this.record.totals);
    }
    sync({ entries = [], badges = [], reset = null }) {
        if (reset !== null && SM.resetRecord(this.record, reset)) {
            for (const s of this.stored) {
                if (s.at < reset) continue;
                if (s.snapshot) SM.addSnapshot(this.record, s.snapshot);
                else SM.addEntries(this.record, [s.entry]);
            }
        }
        for (const entry of entries) this.stored.push({ at: entry.at, entry: clone(entry) });
        SM.addEntries(this.record, entries);
        SM.mergeBadges(this.record.totals, badges);
        return clone(this.record.totals);
    }
}

/** A linked device: base (the record as last seen) + pending (its unsynced matches). */
class Device {
    constructor(server) {
        this.server = server;
        this.base = SM.emptyStats();
        this.pending = [];
        this.badges = [];
        this.reset = null;
    }
    /** What the Stats screen shows: base + pending. */
    view() {
        const r = SM.recordFrom(this.base);
        r.resetAt = this.reset;
        SM.addEntries(r, this.pending);
        SM.mergeBadges(r.totals, this.badges);
        return r.totals;
    }
    play(match) {
        this.pending.push(matchEntry(match));
        const v = this.view();
        checkBadges(v);
        this.badges = v.badges;
    }
    resetStats(at) {
        this.reset = at;
        this.pending = this.pending.filter(e => e.at >= at);
        const badges = this.base.badges;
        this.base = SM.emptyStats();
        this.base.badges = badges;
        this.base.since = at;
    }
    sync() {
        this.base = this.server.sync({ entries: this.pending, badges: this.badges, reset: this.reset });
        this.pending = [];
        this.reset = null;
        // Badges the combined record earns: checked here, sent with the next sync.
        const v = clone(this.base);
        checkBadges(v);
        this.badges = v.badges;
    }
}

// ---- Comparing ---------------------------------------------------------------

const badgeIds = (s) => s.badges.map(b => b.id).sort();
const STREAK_BADGE = /^win_streak_/;

/**
 * The record has every badge one device would have earned. It may have more,
 * but only streak badges: a device that can't yet see a loss on another
 * (offline) device sees a longer streak, and badges are never taken back.
 */
function assertBadges(actual, expected, label) {
    const a = badgeIds(actual), e = badgeIds(expected);
    for (const id of e) assert.ok(a.includes(id), `${label}: missing badge ${id}`);
    const extra = a.filter(id => !e.includes(id));
    assert.ok(extra.every(id => STREAK_BADGE.test(id)), `${label}: extra badges ${extra.join(', ')}`);
}

const assertSameRecord = (actual, expected, opts) => assertSameStats(assert, actual, expected, opts);

// ---- Tests -------------------------------------------------------------------

test('the trace moves every stat', () => {
    const s = oneDevice(TRACE);
    const zero = [];
    const walk = (o, path) => {
        for (const [k, v] of Object.entries(o)) {
            const p = path ? `${path}.${k}` : k;
            if (v !== null && typeof v === 'object' && !Array.isArray(v)) walk(v, p);
            else if (v === 0) zero.push(p);
        }
    };
    walk(s, '');
    // Never happen under the rules: a tie (the closer wins equal pips) and a
    // blocked hand (four passes means the chain is closed). Can be 0 by chance
    // on a short trace: zapatos, the current streak at the end.
    const allowed = /^(hands\.tied|hands\.byReason\.blocked\.|matches\.(zapatos|currentStreak))/;
    const unexpected = zero.filter(p => !allowed.test(p));
    assert.deepEqual(unexpected, [], `stats the trace never moved: ${unexpected.join(', ')}`);
    assert.ok(s.matches.played >= MATCHES * 0.7 && s.hands.played > s.matches.played, 'played matches and hands');
    assert.ok(s.badges.length >= 3, `badges: ${badgeIds(s).join(', ')}`);
});

test('three devices that sync now and then end with the same record as one device', () => {
    for (const seed of [1, 2, 3]) {
        const r = seeded(seed);
        const server = new ServerSim();
        const devices = [0, 1, 2].map(() => new Device(server));
        for (const m of TRACE) {
            const d = devices[Math.floor(r() * 3)];
            d.play(m);
            if (r() < 0.3) d.sync();
        }
        for (const d of devices) d.sync();
        for (const d of devices) d.sync(); // the badges the combined record earned

        const expected = oneDevice(TRACE);
        assertSameRecord(server.record.totals, expected);
        assertBadges(server.record.totals, expected, `seed ${seed}`);
        for (const d of devices) assertSameRecord(d.view(), expected);
    }
});

test('the order matches reach the record in does not change it', () => {
    const entries = TRACE.map(m => matchEntry(m));
    const fold = (list) => SM.addEntries(SM.emptyRecord(), clone(list)).totals;
    const inOrder = fold(entries);
    for (const seed of [4, 5, 6]) {
        const r = seeded(seed);
        const shuffled = [...entries];
        for (let i = shuffled.length - 1; i > 0; i--) {
            const j = Math.floor(r() * (i + 1));
            [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
        }
        assertSameRecord(fold(shuffled), inOrder);
    }
    assertSameRecord(inOrder, oneDevice(TRACE));
});

test('a reset on one device resets the record, even when it or older matches arrive late', () => {
    const cut = TRACE[Math.floor(MATCHES / 2)].at - MINUTE; // between two matches
    for (const resetSyncsNow of [true, false]) {
        const r = seeded(resetSyncsNow ? 7 : 8);
        const server = new ServerSim();
        const devices = [0, 1, 2].map(() => new Device(server));
        let badgesBeforeReset = null;
        for (const m of TRACE) {
            if (m.at > cut && devices[0].reset === null && badgesBeforeReset === null) {
                badgesBeforeReset = badgeIds(server.record.totals);
                devices[0].resetStats(cut);
                if (resetSyncsNow) devices[0].sync();
            }
            // Devices 1 and 2 stay offline around the reset, so matches from
            // before it reach the record afterwards.
            const d = devices[Math.floor(r() * 3)];
            d.play(m);
            const offline = d !== devices[0] && Math.abs(m.at - cut) < 6 * 30 * MINUTE;
            if (!offline && (d !== devices[0] || resetSyncsNow) && r() < 0.5) d.sync();
        }
        for (const d of [devices[1], devices[2], devices[0]]) d.sync();

        const expected = oneDevice(TRACE, { resetAt: cut });
        assertSameRecord(server.record.totals, expected);
        assert.equal(server.record.totals.since, cut);
        const kept = badgeIds(server.record.totals);
        for (const id of badgesBeforeReset) assert.ok(kept.includes(id), `badge ${id} kept through the reset`);
    }
});

test('devices with stats from before linking add them; the first device keeps its streak', () => {
    const split = Math.floor(MATCHES / 2);
    const before = TRACE.slice(0, split), after = TRACE.slice(split);
    const r = seeded(9);
    // Before linking: each device on its own, as today.
    const own = [[], [], []];
    for (const m of before) own[Math.floor(r() * 3)].push(m);
    const legacy = own.map(ms => oneDevice(ms));

    const server = new ServerSim();
    const linkAt = after[0].at - MINUTE;
    const devices = [0, 1, 2].map(() => new Device(server));
    devices.forEach((d, i) => { d.base = server.snapshot(legacy[i], linkAt, i === 0); d.badges = clone(legacy[i].badges); });
    for (const m of after) {
        const d = devices[Math.floor(r() * 3)];
        d.play(m);
        if (r() < 0.3) d.sync();
    }
    for (const d of devices) d.sync();
    for (const d of devices) d.sync();

    // Everything but the streaks: as if every match had been on one device.
    const all = oneDevice(TRACE);
    assertSameRecord(server.record.totals, all, { skip: ['matches.currentStreak', 'matches.bestWinStreak'] });
    // Streak badges aside (devices' own streaks before linking can't be combined).
    for (const id of badgeIds(all).filter(id => !STREAK_BADGE.test(id))) {
        assert.ok(badgeIds(server.record.totals).includes(id), `badge ${id}`);
    }
    // Streaks: the first device's runs on into the matches after linking; any
    // device's own best still counts.
    const results = after.filter(m => m.end).map(m => [m.at, m.end.data.winner === 0 ? 1 : 0]);
    const { current, best } = SM.streaks(results, legacy[0].matches.currentStreak);
    assert.equal(server.record.totals.matches.currentStreak, current);
    assert.equal(server.record.totals.matches.bestWinStreak,
        Math.max(best, ...legacy.map(s => s.matches.bestWinStreak)));
});

test('streaks, badges and unknown fields', () => {
    assert.deepEqual(SM.streaks([]), { current: 0, best: 0 });
    assert.deepEqual(SM.streaks([[3, 1], [1, 1], [2, 0], [4, 1]]), { current: 2, best: 2 });
    assert.deepEqual(SM.streaks([[1, 1], [2, 1]], 3), { current: 5, best: 5 });
    assert.deepEqual(SM.streaks([[1, 0], [2, 1]], 3), { current: 1, best: 3 });

    const t = SM.emptyStats();
    SM.mergeBadges(t, [{ id: 'zapato', earnedAt: 20 }, { id: 'first_win', earnedAt: 5 }]);
    SM.mergeBadges(t, [{ id: 'zapato', earnedAt: 10 }, { id: 'zapato', earnedAt: 30 }]);
    assert.deepEqual(t.badges, [{ id: 'zapato', earnedAt: 10 }, { id: 'first_win', earnedAt: 5 }]);

    // A newer app's counter survives; the streaks, since and version aren't added.
    SM.addStats(t, { matches: { newCounter: 2, currentStreak: 4, bestWinStreak: 4 }, since: 99, version: 7, extra: { n: 1 } });
    SM.addStats(t, { matches: { newCounter: 3 }, extra: { n: 1 } });
    assert.equal(t.matches.newCounter, 5);
    assert.equal(t.extra.n, 2);
    assert.equal(t.matches.currentStreak, 0);
    assert.equal(t.matches.bestWinStreak, 0);
    assert.equal(t.since, null);
    assert.equal(t.version, 1);

    // Wins that arrive before the losses between them: the best streak goes
    // back down once the losses arrive (it isn't a running max).
    const late = SM.emptyRecord();
    const win = { matches: { played: 1, won: 1 } }, loss = { matches: { played: 1, lost: 1 } };
    SM.addEntries(late, [1, 2, 4, 5].map(at => ({ at, won: true, delta: win })));
    assert.equal(late.totals.matches.bestWinStreak, 4);
    SM.addEntries(late, [{ at: 3, won: false, delta: loss }]);
    assert.equal(late.totals.matches.bestWinStreak, 2);
    assert.equal(late.totals.matches.currentStreak, 2);

    // A reset older than the record's last one changes nothing.
    const rec = SM.emptyRecord();
    assert.equal(SM.resetRecord(rec, 100), true);
    assert.equal(SM.resetRecord(rec, 50), false);
    assert.equal(rec.resetAt, 100);
});
