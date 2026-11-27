// One record across devices, end to end (docs/CROSS_DEVICE_STATS.md, P2): the
// app's own PlayerStats and StatsSync on several "devices", each with its own
// storage, talking through the Worker's fetch handler to StatsRecord Durable
// Objects (Node's SQLite in place of Cloudflare's). Each run is compared with
// one device that plays the same matches at the same times and never syncs.
// Nothing leaves the machine.
import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';

// The trace's game modules load with a localStorage around (devices get their own).
globalThis.localStorage ??= { getItem: () => null, setItem: () => {}, removeItem: () => {}, key: () => null, length: 0 };

const worker = (await import('../src/index.js')).default;
const { StatsRecord } = await import('../src/StatsRecord.js');
const { normalizeCode, MAX_ENTRIES } = await import('../src/StatsRecordStore.js');
const { PlayerStats } = await import('../../docs/js/stats/PlayerStats.js');
const { StatsSync } = await import('../../docs/js/stats/StatsSync.js');
const { BadgeSystem } = await import('../../docs/js/stats/BadgeSystem.js');
const SM = await import('../../docs/js/stats/StatsMerge.js');
const { makeTrace, recordMatch, assertSameStats, seeded, T0, MINUTE } = await import('./helpers/stats-trace.mjs');

const URL_BASE = 'https://rooms.test';
const TRACE = makeTrace(Number(process.env.STATS_MATCHES || 40));
const badgeSystem = new BadgeSystem();
const clone = (x) => JSON.parse(JSON.stringify(x));
const STREAKS = ['matches.currentStreak', 'matches.bestWinStreak'];
const WON = TRACE.find(m => m.end?.data.winner === 0);

// One clock for the devices (entries, badges) and the server.
const clock = { t: T0 };
const realNow = Date.now;
const tick = () => { clock.t += MINUTE; };

/** A device: the app's stats recorder and sync over its own storage and network. */
class Device {
    constructor(env, name) {
        this.env = env;
        this.name = name;
        this.mem = new Map();
        this.storage = {
            get: (k) => (this.mem.has(k) ? JSON.parse(this.mem.get(k)) : null),
            set: (k, v) => { this.mem.set(k, JSON.stringify(v)); return true; },
        };
        // 'up' | 'down' | 'lose-reply' (the server gets it, the answer is lost) | 'once' (one request, then down)
        this.net = 'up';
        this.requests = [];
        this.boot();
    }

    /** The app starting, or reloading: everything from this device's storage. */
    boot() {
        this.ps = new PlayerStats({ storage: this.storage });
        this.ps.load();
        this.sync = new StatsSync({
            storage: this.storage, baseUrl: URL_BASE, now: () => clock.t,
            fetch: async (url, init) => {
                this.requests.push({ url: String(url), body: JSON.parse(init.body) });
                if (this.net === 'down') throw new TypeError('offline');
                if (this.net === 'once') this.net = 'down';
                const res = await worker.fetch(new Request(url, init), this.env, {});
                if (this.net === 'lose-reply') { this.net = 'up'; throw new TypeError('connection lost'); }
                return res;
            },
        });
        this.ps.attachSync(this.sync);
        // As main.js does after each answer: badges the combined record earned.
        this.sync.onChange = () => {
            const s = this.ps.get();
            badgeSystem.checkHandBadges(s);
            badgeSystem.checkMatchBadges(s);
            this.ps.save(s);
        };
    }

    play(match) { recordMatch(this.ps, match, { badgeSystem, tick }); }
    stats() { return clone(this.ps.get()); }
}

/** A Worker with StatsRecord objects on in-memory SQLite, and the clock at T0. */
function setup(t) {
    clock.t = T0;
    Date.now = () => clock.t;
    t.after(() => { Date.now = realNow; });
    const objects = new Map(); // name → { obj, db }
    const env = {
        RECORDS: {
            idFromName: (name) => name,
            get: (name) => {
                if (!objects.has(name)) {
                    const db = new DatabaseSync(':memory:');
                    const storage = {
                        sql: { exec: (q, ...p) => { const rows = db.prepare(q).all(...p); return { toArray: () => rows }; } },
                        deleteAll: async () => {
                            for (const { name: table } of db.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all()) db.exec(`DROP TABLE "${table}"`);
                        },
                    };
                    const obj = new StatsRecord({ storage });
                    obj.store.now = () => clock.t;
                    objects.set(name, { obj, db });
                }
                const { obj } = objects.get(name);
                return { fetch: (url, init) => obj.fetch(new Request(url, init)) };
            },
        },
    };
    const call = async (path, body, { method = 'POST', origin, raw } = {}) => {
        const headers = { 'Content-Type': 'application/json' };
        if (origin) headers.Origin = origin;
        const res = await worker.fetch(new Request(URL_BASE + path, {
            method, headers, body: method === 'GET' ? undefined : (raw ?? JSON.stringify(body ?? {})),
        }), env, {});
        const text = await res.text();
        return { status: res.status, headers: res.headers, json: text ? JSON.parse(text) : null };
    };
    const tables = (name) => (objects.has(name)
        ? objects.get(name).db.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all().length : 0);
    const rows = (name, q) => objects.get(name).db.prepare(q).all();
    return { env, call, objects, tables, rows, device: (name) => new Device(env, name) };
}

/** Play a match on `device` and, at the same times, on the one-device reference. */
function playBoth(device, ref, match) {
    const start = clock.t;
    device.play(match);
    const end = clock.t;
    clock.t = start;
    ref.play(match);
    assert.equal(clock.t, end);
}

const ids = (s) => s.badges.map(b => b.id).sort();
/**
 * Every badge one device would have, and extras only of the kinds a device can
 * earn early from numbers it can't yet see corrected: a streak (losses on a
 * device that is offline), or with `afterLateReset` any (totals a late reset
 * then removes). Badges are never taken back.
 */
function assertBadges(actual, expected, label, { afterLateReset = false } = {}) {
    for (const id of ids(expected)) assert.ok(ids(actual).includes(id), `${label}: missing badge ${id}`);
    const extra = ids(actual).filter(id => !ids(expected).includes(id));
    if (!afterLateReset) assert.ok(extra.every(id => /^win_streak_/.test(id)), `${label}: extra badges ${extra.join(', ')}`);
}

function assertSame(devices, ref, opts = {}) {
    for (const d of devices) {
        assertSameStats(assert, d.stats(), ref.stats(), opts);
        assertBadges(d.stats(), ref.stats(), d.name, opts);
    }
}

async function syncAll(devices) {
    for (let i = 0; i < 2; i++) for (const d of devices) await d.sync.sync();
    for (const d of devices) assert.equal(d.sync.status, 'ok', `${d.name} synced`);
}

// ---- The record ---------------------------------------------------------------

test('three devices that sync now and then, drop answers and reload keep one record: the same as one device', async (t) => {
    const env = setup(t);
    const ref = env.device('one device');
    const devices = ['phone', 'laptop', 'tablet'].map(env.device);
    const [phone, laptop, tablet] = devices;
    await phone.sync.create(phone.stats());
    const code = phone.sync.code;
    assert.match(code, /^[A-HJ-NP-Z2-9]{12}$/);
    assert.equal(await laptop.sync.joinCase(code, laptop.stats()), 'fresh');
    await laptop.sync.join(code, laptop.stats());
    await tablet.sync.join(code, tablet.stats());

    const rng = seeded(31);
    for (const m of TRACE) {
        const d = devices[Math.floor(rng() * 3)];
        playBoth(d, ref, m);
        const r = rng();
        if (r < 0.1) d.net = 'lose-reply';
        else if (r < 0.2) d.net = 'down';
        if (rng() < 0.6) await d.sync.sync();
        d.net = 'up';
        if (rng() < 0.1) d.boot();
    }
    await syncAll(devices);
    assertSame(devices, ref);
    assert.ok(ref.stats().matches.played > 25, 'the record moved');
    assert.equal(phone.sync.state.devices, 3);
    // The code goes in request bodies only, never in an address.
    for (const d of devices) for (const r of d.requests) assert.ok(!r.url.includes(code), r.url);
    // The record is stored under a hash of the code.
    for (const name of env.objects.keys()) assert.match(name, /^[0-9a-f]{64}$/);
});

test('linking adds what each device had; the first device\'s current streak keeps running', async (t) => {
    const env = setup(t);
    const ref = env.device('one device');          // every match
    const refStreak = env.device('streak');        // the first device's matches, then the record's
    const [phone, laptop] = ['phone', 'laptop'].map(env.device);
    const laptopOwn = env.device('laptop alone');  // the laptop's matches before linking
    const alsoOn = (other, d, m) => { const s = clock.t; playBoth(d, ref, m); clock.t = s; other.play(m); };
    for (const m of TRACE.slice(0, 6)) alsoOn(refStreak, phone, m);
    for (const m of TRACE.slice(6, 12)) alsoOn(laptopOwn, laptop, m);
    const laptopBefore = laptop.stats();
    assert.equal(await laptop.sync.joinCase('K7QM4RTX9HPB', laptop.stats()), 'add');

    await phone.sync.create(phone.stats());
    await laptop.sync.join(phone.sync.code, laptop.stats());
    // Linked: the laptop shows the record — both devices' matches; the phone once it syncs.
    assertSameStats(assert, laptop.stats(), ref.stats(), { skip: STREAKS });
    await phone.sync.sync();
    assertSameStats(assert, phone.stats(), ref.stats(), { skip: STREAKS });

    const rng = seeded(7);
    for (const m of TRACE.slice(12)) {
        const d = rng() < 0.5 ? phone : laptop;
        alsoOn(refStreak, d, m);
        if (rng() < 0.5) await d.sync.sync();
    }
    await syncAll([phone, laptop]);
    for (const d of [phone, laptop]) {
        assertSameStats(assert, d.stats(), ref.stats(), { skip: STREAKS });
        assertBadges(d.stats(), ref.stats(), d.name);
        assert.equal(d.stats().matches.currentStreak, refStreak.stats().matches.currentStreak, 'current streak');
        assert.equal(d.stats().matches.bestWinStreak,
            Math.max(refStreak.stats().matches.bestWinStreak, laptopOwn.stats().matches.bestWinStreak), 'best streak');
    }
    assert.ok(laptopBefore.matches.played > 0);
});

test('reset on a linked device resets the record, synced at once or arriving late', async (t) => {
    const env = setup(t);
    const ref = env.device('one device');
    const devices = ['phone', 'laptop', 'tablet'].map(env.device);
    const [phone, laptop, tablet] = devices;
    await phone.sync.create(phone.stats());
    for (const d of [laptop, tablet]) await d.sync.join(phone.sync.code, d.stats());
    const third = Math.floor(TRACE.length / 3);
    const rng = seeded(11);
    const playSome = async (matches, who, syncs = true) => {
        for (const m of matches) {
            const d = who[Math.floor(rng() * who.length)];
            playBoth(d, ref, m);
            if (syncs && rng() < 0.6) await d.sync.sync();
        }
    };

    await playSome(TRACE.slice(0, third), devices);
    await syncAll(devices);
    // Reset on the tablet, online.
    tick();
    tablet.ps.reset();
    ref.ps.reset();
    assert.equal(tablet.stats().matches.played, 0);
    assert.notEqual(tablet.sync.state.reset, null, 'the reset waits to be sent');
    await tablet.sync.sync();
    await phone.sync.sync();
    assert.equal(phone.stats().matches.played, 0, 'the phone sees the reset');
    assert.deepEqual(ids(phone.stats()), ids(ref.stats()), 'badges kept');

    // The laptop goes offline: a match, then a reset, while the others play on and sync.
    laptop.net = 'down';
    await playSome(TRACE.slice(third, third + 2), [laptop], false);
    await playSome(TRACE.slice(third + 2, third + 4), [phone, tablet]);
    tick();
    laptop.ps.reset();
    ref.ps.reset();
    const lateReset = clock.t;
    await playSome(TRACE.slice(third + 4, 2 * third), [phone, tablet]);
    await playSome(TRACE.slice(2 * third, 2 * third + 2), [laptop], false);
    // Before the laptop is back, the others haven't heard of its reset.
    await phone.sync.sync();
    assert.notEqual(phone.stats().since, lateReset);
    laptop.net = 'up';
    await playSome(TRACE.slice(2 * third + 2), devices);
    await syncAll(devices);
    assertSame(devices, ref, { afterLateReset: true });
    assert.equal(phone.stats().since, lateReset);

    // What came before the reset can't count again, so it's no longer kept.
    const [name] = env.objects.keys();
    for (const row of env.rows(name, 'SELECT json FROM batches')) {
        for (const e of JSON.parse(row.json).entries) assert.ok(e.at >= lateReset, 'an entry from before the reset is gone');
    }
});

test('a lost answer and a retry count once; a device offline for long sends its backlog in parts', async (t) => {
    const env = setup(t);
    const ref = env.device('one device');
    const [phone, laptop] = ['phone', 'laptop'].map(env.device);
    await phone.sync.create(phone.stats());
    await laptop.sync.join(phone.sync.code, laptop.stats());

    playBoth(phone, ref, TRACE[0]);
    phone.net = 'lose-reply';
    await phone.sync.sync();
    assert.equal(phone.sync.status, 'offline');
    phone.boot();
    assertSameStats(assert, phone.stats(), ref.stats(), 'the batch on its way still shows, after a reload too');
    const lost = phone.sync.state.sending.id;
    const n = phone.requests.length;
    await phone.sync.sync();
    assert.ok(phone.requests.slice(n).some(r => r.body.batch?.id === lost), 'sent again with the same id');
    await laptop.sync.sync();
    assertSame([phone, laptop], ref);

    // The laptop plays everything else offline: its pending entries fold to one a match.
    laptop.net = 'down';
    for (const m of TRACE.slice(1)) {
        playBoth(laptop, ref, m);
        await laptop.sync.sync();
        assertSameStats(assert, laptop.stats(), ref.stats());
        assert.ok(laptop.sync.state.pending.length <= 520, 'folded');
    }
    assert.ok(laptop.sync.state.pending.some(e => (e.delta.hands?.played || 0) > 1), 'some entries hold a whole match');
    laptop.net = 'up';
    const before = laptop.requests.length;
    await laptop.sync.sync();
    const sent = laptop.requests.slice(before).filter(r => r.body.batch?.entries.length);
    assert.ok(sent.length >= 1 && sent.every(r => r.body.batch.entries.length <= 250));
    await syncAll([phone, laptop]);
    assertSame([phone, laptop], ref);
});

test('unlink keeps a copy; linking to the same record again sends only what was played since', async (t) => {
    const env = setup(t);
    const ref = env.device('one device');
    const [phone, laptop] = ['phone', 'laptop'].map(env.device);
    await phone.sync.create(phone.stats());
    const code = phone.sync.code;
    await laptop.sync.join(code, laptop.stats());
    for (const [i, m] of TRACE.slice(0, 8).entries()) playBoth(i % 2 ? phone : laptop, ref, m);
    await syncAll([phone, laptop]);

    const shown = laptop.stats();
    await laptop.sync.unlink();
    assert.equal(laptop.sync.linked, false);
    assert.deepEqual(laptop.stats(), shown, 'it keeps what it showed');
    await phone.sync.sync();
    assert.equal(phone.sync.state.devices, 1, 'one device left');

    for (const m of TRACE.slice(8, 11)) playBoth(laptop, ref, m);   // unlinked
    playBoth(phone, ref, TRACE[11]);
    laptop.boot();                                                   // and the app reloads
    assert.equal(await laptop.sync.joinCase(code, laptop.stats()), 'same');
    await laptop.sync.join(code, laptop.stats());
    await syncAll([phone, laptop]);
    assertSame([phone, laptop], ref);

    // A record of someone else's: the laptop's stats are a copy of this one, so adding them is a choice.
    const other = env.device('other phone');
    playBoth(other, env.device('scratch'), TRACE[12]);
    await other.sync.create(other.stats());
    assert.equal(await laptop.sync.joinCase(other.sync.code, laptop.stats()), 'switch');
    await laptop.sync.join(other.sync.code, laptop.stats(), { addStats: false });
    assertSameStats(assert, laptop.stats(), other.stats());
    await phone.sync.sync();
    assertSame([phone], ref);
});

test('delete: the record is gone from the server, and every device keeps the stats it shows', async (t) => {
    const env = setup(t);
    const [phone, laptop] = ['phone', 'laptop'].map(env.device);
    await phone.sync.create(phone.stats());
    await laptop.sync.join(phone.sync.code, laptop.stats());
    for (const [i, m] of TRACE.slice(0, 4).entries()) (i % 2 ? phone : laptop).play(m);
    await syncAll([phone, laptop]);
    const shown = laptop.stats();

    await phone.sync.deleteRecord();
    assert.equal(phone.sync.linked, false);
    assert.deepEqual(phone.stats(), shown);
    const [name] = env.objects.keys();
    assert.equal(env.tables(name), 0, 'nothing left on the server');

    await laptop.sync.sync();
    assert.equal(laptop.sync.status, 'deleted');
    assert.equal(laptop.sync.linked, false);
    assert.deepEqual(laptop.stats(), shown);
    // On its own again: it keeps counting.
    laptop.play(TRACE[4]);
    assert.equal(laptop.stats().matches.played, shown.matches.played + (TRACE[4].end ? 1 : 0));
    assert.equal(laptop.stats().hands.played, shown.hands.played + TRACE[4].hands.length);
});

test('join: a code nobody made is refused and changes nothing; with no answer the device stays linked and sends later', async (t) => {
    const env = setup(t);
    const ref = env.device('one device');
    const [phone, laptop] = ['phone', 'laptop'].map(env.device);
    // A win: the laptop brings a current streak, which keeps running (the phone that made the record has no matches).
    playBoth(laptop, ref, WON);
    assert.equal(laptop.stats().matches.currentStreak, 1);
    const before = { stats: laptop.stats(), state: clone(laptop.sync.state) };
    await assert.rejects(laptop.sync.join('K7QM4RTX9HPB', laptop.stats()), (e) => e.status === 404 && e.code === 'not-found');
    assert.deepEqual(laptop.stats(), before.stats);
    assert.deepEqual(laptop.sync.state, before.state);
    assert.equal(env.tables([...env.objects.keys()][0]), 0, 'a code nobody made leaves nothing stored');

    await phone.sync.create(phone.stats());
    laptop.net = 'down';
    await assert.rejects(laptop.sync.join(phone.sync.code, laptop.stats()), (e) => e.code === 'network');
    assert.equal(laptop.sync.linked, true);
    assert.equal(laptop.sync.status, 'offline');
    laptop.net = 'up';
    laptop.boot();
    await syncAll([laptop, phone]);
    assertSame([phone, laptop], ref);
});

test('a reset made while a batch is on its way shows at once, and stays until it reaches the record', async (t) => {
    const env = setup(t);
    const ref = env.device('one device');
    const [phone, laptop] = ['phone', 'laptop'].map(env.device);
    await phone.sync.create(phone.stats());
    await laptop.sync.join(phone.sync.code, laptop.stats());
    for (const m of TRACE.slice(0, 3)) playBoth(laptop, ref, m);
    laptop.net = 'down';
    await laptop.sync.sync();
    assert.ok(laptop.sync.state.sending?.entries.length, 'a batch on its way');
    laptop.boot();
    assertSameStats(assert, laptop.stats(), ref.stats(), 'its matches still show');

    tick();
    laptop.ps.reset();
    ref.ps.reset();
    laptop.boot();
    assertSameStats(assert, laptop.stats(), ref.stats(), 'reset, after a reload too');
    assert.equal(laptop.stats().matches.played, 0);
    // One request gets through (the old batch), then the connection drops: the
    // record still has those matches, but this device shows its reset.
    laptop.net = 'once';
    await laptop.sync.sync();
    assert.equal(laptop.sync.status, 'offline');
    assertSameStats(assert, laptop.stats(), ref.stats(), 'still reset');
    playBoth(laptop, ref, TRACE[3]);
    laptop.net = 'up';
    await syncAll([laptop, phone]);
    assertSame([phone, laptop], ref);
});

test('a badge earned from the combined record goes up on its own', async (t) => {
    const env = setup(t);
    const [phone, laptop] = ['phone', 'laptop'].map(env.device);
    await phone.sync.create(phone.stats());
    await laptop.sync.join(phone.sync.code, laptop.stats());
    // As the badge check after a sync does when the combined numbers cross a threshold.
    const s = laptop.ps.get();
    s.badges.push({ id: 'domino_master', earnedAt: clock.t });
    laptop.ps.save(s);
    await laptop.sync.sync();
    await phone.sync.sync();
    assert.deepEqual(ids(phone.stats()), ['domino_master']);
});

// ---- The server on its own ---------------------------------------------------------

test('server: a new record, codes in any case, and what is refused before it reaches a record', async (t) => {
    const env = setup(t);
    const created = await env.call('/records', {});
    assert.equal(created.status, 201);
    const { code } = created.json;
    assert.match(code, /^[A-HJ-NP-Z2-9]{12}$/);
    assert.equal(normalizeCode(`${code.slice(0, 4).toLowerCase()}-${code.slice(4, 8)} ${code.slice(8)}`), code);

    const sync = (body) => env.call('/records/sync', { code, device: 'device-0001', ...body });
    const entry = (over = {}) => ({ at: clock.t, won: null, delta: { hands: { played: 1, won: 1 } }, ...over });
    const batch = (over = {}) => ({ id: `batch-${Math.random().toString(36).slice(2, 10)}`, entries: [entry()], ...over });
    const good = await sync({ batch: batch() });
    assert.equal(good.status, 200);
    assert.equal(good.json.totals.hands.played, 1);
    assert.equal(good.json.devices, 1);

    const refused = [
        [{ code: 'ABC' }, 'bad-code'],
        [{ code: 'K7QM4RTX9HP0' }, 'bad-code'],
        [{ device: 'x' }, 'bad-device'],
        [{ batch: batch({ id: 'short' }) }, 'bad-batch'],
        [{ batch: batch({ entries: Array.from({ length: MAX_ENTRIES + 1 }, () => entry()) }) }, 'bad-batch'],
        [{ batch: batch({ reset: -5 }) }, 'bad-batch'],
        [{ batch: batch({ entries: [entry({ delta: { hands: { played: -1 } } })] }) }, 'bad-entry'],
        [{ batch: batch({ entries: [entry({ delta: { hands: { played: '1' } } })] }) }, 'bad-entry'],
        [{ batch: batch({ entries: [entry({ delta: { hands: { played: null } } })] }) }, 'bad-entry'],
        [{ batch: batch({ entries: [entry({ delta: { hands: { played: 20_000 } } })] }) }, 'bad-entry'],
        [{ batch: batch({ entries: [entry({ delta: { hands: { played: 201 } } })] }) }, 'bad-entry'],
        [{ batch: batch({ entries: [entry({ delta: { a: { b: { c: { d: { e: { f: 1 } } } } } } })] }) }, 'bad-entry'],
        [{ batch: batch({ entries: [entry({ delta: { constructor: { x: 1 } } })] }) }, 'bad-entry'],
        [{ batch: batch({ entries: [entry({ won: true })] }) }, 'bad-entry'],
        [{ batch: batch({ entries: [entry({ delta: { matches: { played: 1, won: 1 } } })] }) }, 'bad-entry'],
        [{ batch: batch({ entries: [entry({ won: 'yes' })] }) }, 'bad-entry'],
        [{ batch: batch({ entries: [entry({ at: 1000 })] }) }, 'bad-entry'],
        [{ batch: batch({ badges: [{ id: 'First Win', earnedAt: clock.t }] }) }, 'bad-badges'],
        [{ batch: batch({ snapshot: { since: 'yesterday' } }) }, 'bad-snapshot'],
        [{ batch: batch({ snapshot: { hands: { played: -3 } } }) }, 'bad-snapshot'],
    ];
    for (const [body, error] of refused) {
        const r = await sync(body);
        assert.equal(r.status, 400, JSON.stringify(body).slice(0, 120));
        assert.equal(r.json.error, error, JSON.stringify(body).slice(0, 120));
    }
    const proto = await env.call('/records/sync', null, {
        raw: `{"code":"${code}","device":"device-0001","batch":{"id":"batch-proto1","entries":[{"at":${clock.t},"won":null,"delta":{"__proto__":{"played":1}}}]}}`,
    });
    assert.equal(proto.json.error, 'bad-entry');
    const big = await env.call('/records/sync', null, { raw: JSON.stringify({ code, device: 'device-0001', pad: 'x'.repeat(70_000) }) });
    assert.equal(big.status, 413);
    assert.equal((await env.call('/records/sync', null, { raw: '{not json' })).status, 400);
    assert.equal((await env.call('/records/sync', null, { method: 'GET' })).status, 404);
    assert.equal((await env.call('/records/nope', { code })).status, 404);

    // Nothing refused reached the record.
    assert.equal((await sync({ batch: null })).json.totals.hands.played, 1);
    // A code nobody made: not found, and nothing stored for it.
    const missing = await env.call('/records/sync', { code: 'K7QM4RTX9HPB', device: 'device-0001' });
    assert.equal(missing.status, 404);
    assert.equal((await env.call('/records/delete', { code: 'K7QM4RTX9HPB' })).status, 404);
    const names = [...env.objects.keys()];
    assert.equal(names.filter(n => env.tables(n) > 0).length, 1, 'only the one record is stored');
});

test('server: times from a clock running ahead are capped; the same batch counts once; leaving', async (t) => {
    const env = setup(t);
    const { code } = (await env.call('/records', {})).json;
    const DAY = 24 * 60 * MINUTE;
    const batch = {
        id: 'batch-future-1',
        entries: [{ at: clock.t + DAY, won: true, delta: { matches: { played: 1, won: 1 } } }],
        badges: [{ id: 'first_win', earnedAt: clock.t + DAY }],
    };
    const first = await env.call('/records/sync', { code, device: 'device-0001', batch });
    assert.equal(first.json.totals.matches.won, 1);
    assert.equal(first.json.totals.badges[0].earnedAt, clock.t);
    const [name] = [...env.objects.keys()];
    const stored = JSON.parse(env.rows(name, 'SELECT json FROM batches')[0].json);
    assert.equal(stored.entries[0].at, clock.t);

    const again = await env.call('/records/sync', { code, device: 'device-0002', batch });
    assert.equal(again.json.totals.matches.won, 1, 'counted once');
    assert.equal(again.json.devices, 2);
    const left = await env.call('/records/sync', { code, device: 'device-0002', leave: true });
    assert.equal(left.json.devices, 1);
});

test('server: origin check and CORS, as for rooms and suggestions', async (t) => {
    const env = setup(t);
    const ok = await env.call('/records', {}, { origin: 'https://maralons0.github.io' });
    assert.equal(ok.status, 201);
    assert.equal(ok.headers.get('Access-Control-Allow-Origin'), 'https://maralons0.github.io');
    assert.equal(ok.headers.get('Cache-Control'), 'no-store');
    const other = await env.call('/records', {}, { origin: 'https://evil.example' });
    assert.equal(other.status, 403);
});

// ---- Pieces ---------------------------------------------------------------------

test('stripStats keeps only the numbers worth sending', () => {
    const s = SM.emptyStats();
    s.since = T0;
    s.hands.played = 2;
    s.hands.byReason.closed.won = 1;
    s.style.newNumber.expected = 1.25;
    s.badges.push({ id: 'first_win', earnedAt: T0 });
    assert.deepEqual(SM.stripStats(s), { hands: { played: 2, byReason: { closed: { won: 1 } } }, style: { newNumber: { expected: 1.25 } } });
});

test('foldEntries: abandoned hands with no result fold 100 at a time', () => {
    const hand = (i) => ({ at: T0 + i, won: null, delta: { hands: { played: 1, won: 1 } } });
    const folded = SM.foldEntries(Array.from({ length: 250 }, (_, i) => hand(i)));
    assert.deepEqual(folded.map(e => e.delta.hands.played), [100, 100, 50]);
    assert.deepEqual(folded.map(e => e.at), [T0 + 99, T0 + 199, T0 + 249]);
});

test('foldEntries: one entry a match, the same totals and streaks', () => {
    const entries = [];
    const ps = new PlayerStats({ storage: { get: () => null, set: () => true } });
    ps.load();
    const sync = { view: () => null, record: (e) => entries.push({ ...e, delta: SM.stripStats(e.delta) }), noteBadges() {}, resetLocal() {} };
    ps._sync = sync;
    clock.t = T0;
    Date.now = () => clock.t;
    try {
        for (const m of TRACE) recordMatch(ps, m, { tick });
    } finally {
        Date.now = realNow;
    }
    const folded = SM.foldEntries(entries);
    // One a match; an abandoned match's hands go with the next one.
    assert.ok(folded.length <= TRACE.length && folded.length >= TRACE.filter(m => m.end).length, `${folded.length} entries`);
    const a = SM.addEntries(SM.emptyRecord(), entries);
    const b = SM.addEntries(SM.emptyRecord(), folded);
    assertSameStats(assert, b.totals, a.totals);
    assertSameStats(assert, a.totals, ps.get());
    assert.ok(folded.every(e => (e.delta.matches?.played || 0) <= 1));
});
