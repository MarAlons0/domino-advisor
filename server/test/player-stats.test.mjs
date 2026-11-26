// PlayerStats records through StatsMerge (docs/CROSS_DEVICE_STATS.md, P1).
// It must keep exactly the numbers the v1.21.1 recorder kept: the same
// matches, from the same saved stats, give the same stats, badges (with their
// dates) and saved object. A frozen copy of that recorder is in fixtures/.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

// A tiny localStorage (set before the app modules load).
const mem = new Map();
globalThis.localStorage = {
    getItem: (k) => (mem.has(k) ? mem.get(k) : null), setItem: (k, v) => mem.set(k, String(v)),
    removeItem: (k) => mem.delete(k), key: (i) => [...mem.keys()][i] ?? null, get length() { return mem.size; },
};

const { PlayerStats } = await import('../../docs/js/stats/PlayerStats.js');
const { LegacyPlayerStats } = await import('./fixtures/PlayerStats-v1.21.1.mjs');
const { BadgeSystem } = await import('../../docs/js/stats/BadgeSystem.js');
const { makeTrace, recordMatch, assertSameStats, T0, MINUTE } = await import('./helpers/stats-trace.mjs');

const KEY = '7fichas_stats';
const TRACE = makeTrace(Number(process.env.STATS_MATCHES || 40));
const badgeSystem = new BadgeSystem();

// Saved stats to start from: none; a real object the app saved (fixtures/);
// and an older shape, from before Your signals and the newer cerrado and
// coaching fields, that load() fills in from the defaults.
const STARTS = {
    'nothing saved': null,
    'stats the app saved': JSON.parse(readFileSync(new URL('./fixtures/stats-saved.json', import.meta.url), 'utf8')),
    'an older saved shape': {
        version: 1,
        matches: { played: 9, won: 6, lost: 3, currentStreak: 3, bestWinStreak: 4, largestWinMargin: 120, zapatosGiven: 1 },
        hands: { played: 61, won: 35, lost: 26, byReason: { domino: { won: 30, lost: 20 }, closed: { won: 5, lost: 6 } }, largestScore: 64 },
        cerrado: { teamTotal: 11, teamWon: 5, youClosed: 3, partnerClosed: 2, opponentTotal: 4, largestScore: 64 },
        coaching: { geninAgreements: 80, geninTotal: 110 },
        badges: [{ id: 'first_win', earnedAt: T0 - 86_400_000 }],
    },
};

// The clock: each hand and each match end a minute apart, so badge dates and
// the reset time come out the same from both recorders.
let clock = T0;
const realNow = Date.now;
const tick = () => { clock += MINUTE; };

/**
 * Play the whole trace on one recorder class, as main.js would: a reset after
 * a third of the matches, and the app reloaded (a new recorder, loading what
 * was saved) in the middle of a match two thirds in.
 */
function run(Recorder, start, matches = TRACE) {
    mem.clear();
    if (start) mem.set(KEY, JSON.stringify(start));
    clock = T0;
    Date.now = () => clock;
    try {
        const snap = () => JSON.parse(JSON.stringify(ps.get()));
        let ps = new Recorder();
        ps.load();
        const snapshots = [snap()]; // right after loading, then after every match
        const resetAfter = Math.floor(matches.length / 3);
        const reloadIn = Math.floor((2 * matches.length) / 3);
        matches.forEach((m, i) => {
            if (i === resetAfter) { tick(); ps.reset(); }
            if (i === reloadIn && m.hands.length > 1) {
                // Half the match, reload, the rest (the deficit so far is lost, as in the app).
                const half = Math.ceil(m.hands.length / 2);
                recordMatch(ps, { ...m, hands: m.hands.slice(0, half), end: null }, { badgeSystem, tick });
                ps = new Recorder();
                ps.load();
                recordMatch(ps, { ...m, hands: m.hands.slice(half) }, { badgeSystem, tick });
            } else {
                recordMatch(ps, m, { badgeSystem, tick });
            }
            snapshots.push(snap());
        });
        return { snapshots, stats: snap(), saved: JSON.parse(mem.get(KEY)) };
    } finally {
        Date.now = realNow;
    }
}

for (const [name, start] of Object.entries(STARTS)) {
    test(`records the same stats as v1.21.1, starting from ${name}`, () => {
        const before = run(LegacyPlayerStats, start);
        const now = run(PlayerStats, start);
        // Right after loading (an older shape filled in) and after every match.
        now.snapshots.forEach((s, i) => {
            assertSameStats(assert, s, before.snapshots[i]);
            assert.deepEqual(s.badges, before.snapshots[i].badges, `badges after match ${i}`);
        });
        assert.ok(now.snapshots.some(s => s.matches.largestDeficitOvercome >= 80), 'a comeback');
        assertSameStats(assert, now.stats, before.stats);
        assert.deepEqual(now.stats.badges, before.stats.badges, 'badges and their dates');
        assertSameStats(assert, now.saved, before.saved);
        assert.deepEqual(now.saved.badges, before.saved.badges);
        // What it saved is what it shows.
        assert.deepEqual(now.saved, now.stats);
        // The run moved the stats past the reset (not only zeros compared).
        assert.ok(now.stats.matches.played > 5 && now.stats.since > T0, 'played after the reset');
    });
}

test('the win streaks follow the matches in the order played, even if the clock goes back', () => {
    const ended = TRACE.filter(m => m.end);
    const results = (ps, Recorder) => {
        mem.clear();
        clock = T0;
        Date.now = () => clock;
        try {
            const p = new Recorder();
            p.load();
            const seen = [];
            ended.forEach((m, i) => {
                // Every fourth match the clock jumps back an hour.
                clock += i % 4 === 3 ? -60 * MINUTE : 30 * MINUTE;
                p.recordMatchResult(m.end.data);
                seen.push([p.get().matches.currentStreak, p.get().matches.bestWinStreak]);
            });
            return seen;
        } finally {
            Date.now = realNow;
        }
    };
    assert.deepEqual(results(null, PlayerStats), results(null, LegacyPlayerStats));
});

test('get() keeps returning the same object while recording', () => {
    mem.clear();
    const ps = new PlayerStats();
    const s = ps.load();
    recordMatch(ps, TRACE.find(m => m.end), { badgeSystem });
    assert.equal(ps.get(), s);
    assert.ok(s.hands.played > 0 && s.matches.played === 1);
    const r = ps.reset();
    assert.equal(ps.get(), r);
    assert.equal(r.matches.played, 0);
    assert.deepEqual(r.badges, s.badges, 'badges kept through a reset');
});
