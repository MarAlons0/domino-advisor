// One lifetime record shared by a person's devices (docs/CROSS_DEVICE_STATS.md):
// checking what a device sends, and keeping the record. Pure logic over a SQL
// handle (`exec(query, ...params)` returning something with `toArray()`), like
// SuggestionStore, so it runs on the StatsRecord Durable Object's SQLite and,
// in the tests, on Node's. The merging itself is the app's own StatsMerge.

import { emptyRecord, addSnapshot, addEntries, mergeBadges, resetRecord } from '../../docs/js/stats/StatsMerge.js';

const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // no 0/O, 1/I: 5 bits a character
export const CODE_RE = /^[A-HJ-NP-Z2-9]{12}$/;              // 12 characters, 60 bits
export const MAX_BODY = 64 * 1024;                          // bytes
export const MAX_ENTRIES = 300;                             // per batch; the app sends fewer
const MIN_TIME = Date.UTC(2020, 0, 1);
const ID_RE = /^[A-Za-z0-9_-]{8,64}$/;
const KEY_RE = /^[A-Za-z][A-Za-z0-9_]{0,39}$/;              // also keeps out __proto__
const BAD_KEYS = new Set(['constructor', 'prototype']);
const BADGE_RE = /^[a-z0-9_]{1,40}$/;
// Largest number one entry may add (a match's coaching counts, a hand's
// points…) and one device's whole stats may hold.
const ENTRY_LIMIT = 10_000;
const SNAPSHOT_LIMIT = 10_000_000;
const MAX_LEAVES = 300;

/** A new random record code (the Worker makes it; the record only ever sees its hash). */
export function newRecordCode() {
    const b = new Uint8Array(12);
    crypto.getRandomValues(b);
    return [...b].map(x => CODE_ALPHABET[x % 32]).join('');
}

/** The code as typed or linked (any case, dashes and spaces) → 12 characters, or null. */
export function normalizeCode(code) {
    if (typeof code !== 'string') return null;
    const c = code.toUpperCase().replace(/[\s-]/g, '');
    return CODE_RE.test(c) ? c : null;
}

/** The name the record's Durable Object goes by: a hash, never the code itself. */
export async function recordName(code) {
    const hash = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(`7fichas-record:${code}`));
    return [...new Uint8Array(hash)].map(b => b.toString(16).padStart(2, '0')).join('');
}

const isPlain = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const isTime = (v) => Number.isSafeInteger(v) && v >= MIN_TIME;

/** A tree of non-negative numbers up to `limit` → a clean copy, or null. */
function cleanNumbers(src, limit, count = { leaves: 0 }, depth = 0) {
    if (!isPlain(src) || depth > 4) return null;
    const out = {};
    for (const [key, v] of Object.entries(src)) {
        if (!KEY_RE.test(key) || BAD_KEYS.has(key)) return null;
        if (typeof v === 'number') {
            if (!Number.isFinite(v) || v < 0 || v > limit || ++count.leaves > MAX_LEAVES) return null;
            out[key] = v;
        } else {
            const inner = cleanNumbers(v, limit, count, depth + 1);
            if (!inner) return null;
            out[key] = inner;
        }
    }
    return out;
}

/** One entry: a hand, its signals, a match's coaching data or a match result. */
function cleanEntry(e) {
    if (!isPlain(e) || !isTime(e.at)) return null;
    const won = e.won ?? null;
    if (won !== null && typeof won !== 'boolean') return null;
    const delta = cleanNumbers(e.delta ?? {}, ENTRY_LIMIT);
    if (!delta) return null;
    // An entry adds at most one match, and only a match result does; a folded
    // entry (a device that was offline a long time) a match's worth of hands.
    const m = delta.matches || {};
    if ((m.played || 0) !== (won === null ? 0 : 1) || (m.won || 0) !== (won === true ? 1 : 0)
        || (m.lost || 0) !== (won === false ? 1 : 0)) return null;
    if ((delta.hands?.played || 0) > 200) return null;
    return { at: e.at, won, delta };
}

/** A device's whole stats as it links: numbers, plus when it started counting. */
function cleanSnapshot(s) {
    if (!isPlain(s)) return null;
    const { since = null, version, badges, ...rest } = s;
    if (since !== null && !isTime(since)) return null;
    const numbers = cleanNumbers(rest, SNAPSHOT_LIMIT);
    return numbers && { ...numbers, since };
}

function cleanBadges(list) {
    if (!Array.isArray(list) || list.length > 50) return null;
    const out = [];
    for (const b of list) {
        if (!isPlain(b) || !BADGE_RE.test(b.id) || !isTime(b.earnedAt)) return null;
        out.push({ id: b.id, earnedAt: b.earnedAt });
    }
    return out;
}

/**
 * Check a sync request (after the code): the device id, and the batch of what
 * it recorded, if any. Returns { value } to pass on, or { error }.
 * Nothing about the record is known here; times are capped at the record's
 * clock by the store.
 */
export function cleanSync(data) {
    if (!isPlain(data)) return { error: 'bad-request' };
    if (typeof data.device !== 'string' || !ID_RE.test(data.device)) return { error: 'bad-device' };
    const value = { device: data.device, leave: data.leave === true, batch: null };
    const b = data.batch ?? null;
    if (b === null) return { value };
    if (!isPlain(b) || typeof b.id !== 'string' || !ID_RE.test(b.id)) return { error: 'bad-batch' };
    const entries = b.entries ?? [];
    if (!Array.isArray(entries) || entries.length > MAX_ENTRIES) return { error: 'bad-batch' };
    const batch = { id: b.id, entries: [], badges: cleanBadges(b.badges ?? []), reset: b.reset ?? null, snapshot: null };
    if (!batch.badges) return { error: 'bad-badges' };
    if (batch.reset !== null && !isTime(batch.reset)) return { error: 'bad-batch' };
    for (const e of entries) {
        const clean = cleanEntry(e);
        if (!clean) return { error: 'bad-entry' };
        batch.entries.push(clean);
    }
    if (b.snapshot != null) {
        batch.snapshot = cleanSnapshot(b.snapshot);
        if (!batch.snapshot) return { error: 'bad-snapshot' };
    }
    value.batch = batch;
    return { value };
}

const TABLES = [
    // The StatsMerge record, as one JSON row: a sync reads the same few rows
    // however long the history is (the free plan counts rows read).
    `CREATE TABLE IF NOT EXISTS record (
        id INTEGER PRIMARY KEY CHECK (id = 1),
        json TEXT NOT NULL,
        updated_at INTEGER NOT NULL
    )`,
    // Every batch as received: a retried batch counts once (id), and a reset
    // that arrives late adds back what came after it (entries keep their
    // times; a snapshot dates from when it arrived). with_matches: it brought
    // a device's stats with matches in them.
    `CREATE TABLE IF NOT EXISTS batches (
        id TEXT PRIMARY KEY,
        device TEXT NOT NULL,
        received_at INTEGER NOT NULL,
        with_matches INTEGER NOT NULL,
        json TEXT NOT NULL
    )`,
    `CREATE TABLE IF NOT EXISTS devices (
        id TEXT PRIMARY KEY,
        first_seen INTEGER NOT NULL,
        last_seen INTEGER NOT NULL
    )`,
];

export class StatsRecordStore {
    /**
     * @param {{exec: Function}} sql - a Durable Object's `ctx.storage.sql`, or the like
     * @param {() => number} now - clock in ms (the tests move it)
     */
    constructor(sql, now = () => Date.now()) {
        this.q = (query, ...params) => sql.exec(query, ...params).toArray();
        this.now = now;
    }

    /**
     * Is there a record here? Asked before anything else, without creating a
     * table: a code nobody made leaves nothing stored.
     */
    exists() {
        return this.q("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'record'").length > 0
            && this.q('SELECT 1 FROM record WHERE id = 1').length > 0;
    }

    /** Start an empty record. @returns false if there already is one */
    create() {
        if (this.exists()) return false;
        for (const t of TABLES) this.q(t);
        this._save(emptyRecord());
        return true;
    }

    _load() {
        const row = this.q('SELECT json FROM record WHERE id = 1')[0];
        return row ? JSON.parse(row.json) : null;
    }

    _save(record) {
        this.q('INSERT INTO record (id, json, updated_at) VALUES (1, ?, ?) ON CONFLICT(id) DO UPDATE SET json = excluded.json, updated_at = excluded.updated_at',
            JSON.stringify(record), this.now());
    }

    /**
     * One device's sync: apply its batch (once per batch id), and answer with
     * the record as it now stands.
     * @param {{device: string, batch: object|null, leave: boolean}} req - from cleanSync
     * @returns the state for the device, or null if there is no record
     */
    sync({ device, batch, leave = false }) {
        if (!this.exists()) return null;
        const now = this.now();
        const record = this._load();
        if (batch && !this.q('SELECT 1 FROM batches WHERE id = ?', batch.id).length) {
            // A device clock ahead of ours can't put anything in the future.
            const cap = (t) => Math.min(t, now);
            for (const e of batch.entries) e.at = cap(e.at);
            for (const b of batch.badges) b.earnedAt = cap(b.earnedAt);
            if (batch.reset !== null) batch.reset = cap(batch.reset);

            if (batch.reset !== null && resetRecord(record, batch.reset)) this._rebuild(record, batch.reset);
            const withMatches = (batch.snapshot?.matches?.played || 0) > 0;
            if (batch.snapshot) {
                // The current streak of the first device that brings matches keeps
                // running (and its "counting since"); a later one's is dropped.
                const first = withMatches && !this.q('SELECT 1 FROM batches WHERE with_matches = 1 LIMIT 1').length;
                addSnapshot(record, batch.snapshot, { first });
            }
            addEntries(record, batch.entries);
            mergeBadges(record.totals, batch.badges);
            this.q('INSERT INTO batches (id, device, received_at, with_matches, json) VALUES (?, ?, ?, ?, ?)',
                batch.id, device, now, withMatches ? 1 : 0,
                JSON.stringify({ entries: batch.entries, snapshot: batch.snapshot, reset: batch.reset }));
            this._save(record);
        }
        if (leave) this.q('DELETE FROM devices WHERE id = ?', device);
        else {
            this.q(`INSERT INTO devices (id, first_seen, last_seen) VALUES (?, ?, ?)
                    ON CONFLICT(id) DO UPDATE SET last_seen = excluded.last_seen`, device, now, now);
        }
        const devices = this.q('SELECT COUNT(*) AS n FROM devices')[0].n;
        return { totals: record.totals, resetAt: record.resetAt, devices, syncedAt: now };
    }

    /**
     * A reset just zeroed the record. Add back everything stored that came
     * after it — it can arrive late, from a device that reset while offline
     * after the others had synced newer matches. What came before it can never
     * count again, so it's emptied from the stored batches (their ids stay, so
     * a retried batch still counts once).
     */
    _rebuild(record, resetAt) {
        for (const row of this.q('SELECT id, received_at, json FROM batches')) {
            const b = JSON.parse(row.json);
            const entries = (b.entries || []).filter(e => e.at >= resetAt);
            const snapshot = b.snapshot && row.received_at >= resetAt ? b.snapshot : null;
            if (snapshot) addSnapshot(record, snapshot);
            addEntries(record, entries);
            if (entries.length !== (b.entries || []).length || (b.snapshot && !snapshot)) {
                this.q('UPDATE batches SET json = ? WHERE id = ?', JSON.stringify({ entries, snapshot, reset: b.reset ?? null }), row.id);
            }
        }
    }
}
