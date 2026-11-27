// One record across your devices (docs/CROSS_DEVICE_STATS.md): the sync code,
// what this device hasn't sent yet, and the calls to the 7 Fichas server
// (server/src/records.js). PlayerStats still records everything; while this
// device is linked it also hands each entry here, and it shows view(): the
// record's totals as last received (base) plus what isn't confirmed yet.
//
// Kept in localStorage['7fichas_sync']:
//   deviceId    random, made the first time this device links
//   code        the record this device is linked to, or null
//   base        the record's totals as last received; after unlinking, the
//               copy this device kept. null: this device has only its own stats
//   resetAt     the record's last reset, as last received
//   pending     entries recorded since base ({ at, won, delta }, zeros dropped)
//   reset       a Reset stats made here and not sent yet
//   sending     the batch on its way ({ id, entries, badges, reset, snapshot }),
//               sent again with the same id until confirmed, so it counts once
//   badges      this device's badges (the record keeps each one's earliest date)
//   copiedFrom  after unlinking: a hash of the record the copy came from, so
//               linking to it again sends only what was played since
//   devices, syncedAt   for the Stats screen

import { StorageService } from './StorageService.js';
import { stripStats, foldEntries } from './StatsMerge.js';
import { ROOMS_URL } from '../multiplayer/MultiplayerSession.js';

const KEY = '7fichas_sync';
const CODE_RE = /^[A-HJ-NP-Z2-9]{12}$/;
const FOLD_AT = 500;          // pending entries before they're folded to one a match
const BATCH_ENTRIES = 250;    // per request…
const BATCH_CHARS = 40_000;   // …and about this much JSON (the server takes 64 KB)
const ROUNDS = 20;            // requests per sync at most; the rest goes next time

const clone = (x) => JSON.parse(JSON.stringify(x));

function randomId() {
    const b = new Uint8Array(16);
    crypto.getRandomValues(b);
    return [...b].map(x => x.toString(16).padStart(2, '0')).join('');
}

/** A hash of the code, to recognize a record again without keeping its code. */
async function hashCode(code) {
    const h = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(`7fichas-record:${code}`));
    return [...new Uint8Array(h)].map(b => b.toString(16).padStart(2, '0')).join('');
}

/** Badges the server takes (a damaged one would get the whole batch refused). */
function cleanBadges(list) {
    return clone((list || []).filter(b => b && typeof b.id === 'string' && Number.isSafeInteger(b.earnedAt)));
}

/** A device's stats as it links: its numbers and since; badges go separately. */
function snapshotOf(stats) {
    return { ...stripStats(stats), since: stats.since ?? null };
}

/** Anything to add: hands, matches or badges. */
export function hasStats(stats) {
    return (stats.hands?.played || 0) > 0 || (stats.matches?.played || 0) > 0 || (stats.badges?.length || 0) > 0;
}

/** A refused or failed call. `code` is the server's error name, or 'network'. */
export class SyncError extends Error {
    constructor(code, status = 0) {
        super(code);
        this.code = code;
        this.status = status;
    }
}

const blank = () => ({
    v: 1, deviceId: null, code: null, base: null, resetAt: null, pending: [], reset: null,
    sending: null, badges: [], copiedFrom: null, devices: 0, syncedAt: null,
});

export class StatsSync {
    /**
     * @param {object} [opts] - for the tests: storage ({get, set}), fetch, server URL, clock
     */
    constructor({ storage = StorageService, fetch = (...a) => globalThis.fetch(...a), baseUrl = ROOMS_URL, now = () => Date.now() } = {}) {
        this.storage = storage;
        this._fetch = fetch;
        this.baseUrl = baseUrl;
        this.now = now;
        this.state = { ...blank(), ...(storage.get(KEY) || {}) };
        // 'idle' | 'syncing' | 'ok' | 'offline' | 'error' | 'deleted'
        this.status = 'idle';
        this.onView = null;    // the totals to show changed (PlayerStats rebuilds)
        this.onChange = null;  // anything the Stats screen shows changed
        this._running = null;
    }

    // ---- The code -----------------------------------------------------------

    /** As typed or linked (any case, dashes, spaces) → 12 characters, or null. */
    static normalizeCode(code) {
        const c = String(code ?? '').toUpperCase().replace(/[\s-]/g, '');
        return CODE_RE.test(c) ? c : null;
    }

    /** K7QM4RTX9HPB → K7QM-4RTX-9HPB */
    static formatCode(code) {
        return code.match(/.{4}/g).join('-');
    }

    /** The code in a shared link (…/#sync=K7QM-4RTX-9HPB), or null. */
    static codeFromHash(hash = typeof location !== 'undefined' ? location.hash : '') {
        const m = /(?:^#|&)sync=([^&]*)/.exec(hash || '');
        return m ? StatsSync.normalizeCode(decodeURIComponent(m[1])) : null;
    }

    get linked() { return !!this.state.code; }
    get code() { return this.state.code; }

    /** The link to share: the code after #, so it never reaches the web server. */
    shareUrl() {
        return `${location.origin}${location.pathname}#sync=${StatsSync.formatCode(this.state.code)}`;
    }

    // ---- What PlayerStats shows and records ---------------------------------

    /**
     * The totals to show, as parts: the record's (base), the entries not
     * confirmed yet, this device's badges. null while this device keeps only
     * its own stats — then PlayerStats works exactly as it always has.
     */
    view() {
        const s = this.state;
        if (!s.base) return null;
        const resets = [s.resetAt, s.reset, s.sending?.reset].filter(x => x !== null && x !== undefined);
        return {
            base: s.base,
            resetAt: resets.length ? Math.max(...resets) : null,
            entries: [...(s.sending?.entries || []), ...s.pending],
            badges: s.badges,
        };
    }

    /** PlayerStats recorded something (a hand, its signals, coaching, a result). */
    record(entry) {
        const s = this.state;
        if (!s.base) return;
        s.pending.push({ at: entry.at, won: entry.won, delta: stripStats(entry.delta) });
        if (s.pending.length > FOLD_AT) {
            s.pending = foldEntries(s.pending);
            // A copy kept after unlinking stops keeping track after a few hundred
            // matches: from then on it's simply this device's stats.
            if (!s.code && s.pending.length > FOLD_AT) {
                Object.assign(s, { base: null, resetAt: null, pending: [], reset: null, sending: null, copiedFrom: null, badges: [] });
            }
        }
        this._save();
    }

    /** Reset stats here, at `at`: the record's too, if linked. `totals` are the reset ones. */
    resetLocal(at, totals) {
        const s = this.state;
        if (!s.base) return;
        if (s.code) {
            s.reset = at;
            s.base = clone(totals);
            s.pending = [];
        } else {
            // A copy kept after unlinking: from now on it's simply this device's stats.
            Object.assign(s, { base: null, resetAt: null, pending: [], sending: null, copiedFrom: null, badges: [] });
        }
        this._save();
    }

    /** The badges as saved (one may be new: it goes with the next sync). */
    noteBadges(badges) {
        const s = this.state;
        if (!s.base || JSON.stringify(badges || []) === JSON.stringify(s.badges)) return;
        s.badges = cleanBadges(badges);
        this._save();
    }

    // ---- Linking --------------------------------------------------------------

    /** "Link my devices": a new record, starting with this device's stats. */
    async create(stats) {
        if (this.state.code) return;
        const { code } = await this._post('/records', {});
        const s = this.state;
        s.deviceId ||= randomId();
        const badges = cleanBadges(stats.badges);
        Object.assign(s, {
            code, base: clone(stats), resetAt: null, pending: [], reset: null, copiedFrom: null,
            badges, devices: 1, syncedAt: null,
            sending: { id: randomId(), entries: [], badges, reset: null, snapshot: snapshotOf(stats) },
        });
        this._save();
        this.onView?.();
        await this.sync();
    }

    /**
     * What linking this device to `code` would do, for the question the Stats
     * screen asks:
     *   'already'  linked to it now
     *   'switch'   linked to another record (it leaves, keeping a copy, then as 'other')
     *   'same'     linked to it before: only what was played since goes in
     *   'other'    its stats are a copy of another record: adding them is a choice
     *   'add'      its stats go in
     *   'fresh'    nothing to add
     */
    async joinCase(code, stats) {
        const s = this.state;
        if (s.code === code) return 'already';
        if (s.code) return 'switch';
        if (s.copiedFrom) return s.copiedFrom === await hashCode(code) ? 'same' : 'other';
        return hasStats(stats) ? 'add' : 'fresh';
    }

    /**
     * Link this device to the record `code`. Its stats are added unless
     * addStats is false (asked only for a copy of another record). Throws a
     * SyncError if the server says no (no such record, …), leaving this device
     * as it was. With no answer at all it stays linked and sends when it can.
     */
    async join(code, stats, { addStats = true } = {}) {
        if (this.state.code === code) return;
        if (this.state.code) await this.unlink();
        const before = clone(this.state);
        const s = this.state;
        s.deviceId ||= randomId();
        if (!(s.copiedFrom && s.copiedFrom === await hashCode(code))) {
            const add = addStats && hasStats(stats);
            const badges = add ? cleanBadges(stats.badges) : [];
            // Until the record answers, the screen keeps what it showed.
            Object.assign(s, {
                base: clone(stats), resetAt: null, pending: [], reset: null, badges,
                sending: { id: randomId(), entries: [], badges, reset: null, snapshot: add ? snapshotOf(stats) : null },
            });
        }
        // Linked to it before: the batch it was sending, then what's pending, go as they are.
        Object.assign(s, { code, copiedFrom: null, devices: 0, syncedAt: null });
        this._save();
        try {
            this._running = this._run({ strict: true });
            await this._running;
        } catch (e) {
            if (e.status >= 400 && e.status < 500) {
                this.state = before;
                this._save();
                this.status = 'idle';
                this.onView?.();
                this.onChange?.();
            }
            throw e;
        } finally {
            this._running = null;
        }
    }

    /**
     * Unlink this device. It keeps a copy of the record's stats as its own, and
     * sends what it has first if it can.
     */
    async unlink() {
        if (!this.state.code) return;
        await this.sync({ leave: true });
        const s = this.state;
        if (s.syncedAt) {
            // What it couldn't send stays, for linking to this record again.
            s.copiedFrom = await hashCode(s.code);
        } else {
            // Never reached the record: what it shows is just its own stats.
            Object.assign(s, { base: null, resetAt: null, pending: [], sending: null, reset: null, badges: [], copiedFrom: null });
        }
        Object.assign(s, { code: null, devices: 0, syncedAt: null });
        this.status = 'idle';
        this._save();
        this.onView?.();
        this.onChange?.();
    }

    /** Delete the record from the server. This device keeps the stats it shows. */
    async deleteRecord() {
        if (!this.state.code) return;
        try {
            await this._post('/records/delete', { code: this.state.code });
        } catch (e) {
            if (e.status !== 404) throw e;
        }
        this._forget();
        this.status = 'idle';
        this.onChange?.();
    }

    // ---- Syncing ----------------------------------------------------------------

    /** Sync if the last one was more than `ms` ago. */
    syncIfStale(ms) {
        const s = this.state;
        if (s.code && (!s.syncedAt || this.now() - s.syncedAt > ms || s.sending || s.pending.length)) return this.sync();
        return Promise.resolve();
    }

    /**
     * Send what's pending and take the record's totals. One at a time; never
     * throws — the outcome is in `status`.
     */
    sync({ leave = false } = {}) {
        if (!this.state.code) return Promise.resolve();
        if (this._running) return this._running.catch(() => {});
        this._running = this._run({ leave }).finally(() => { this._running = null; });
        return this._running;
    }

    async _run({ leave = false, strict = false } = {}) {
        this.status = 'syncing';
        this.onChange?.();
        try {
            for (let round = 0; round < ROUNDS; round++) {
                const s = this.state;
                if (!s.sending && this._hasWork()) this._freeze();
                const sent = s.sending;
                const last = !this._hasWork(sent);
                const r = await this._post('/records/sync', {
                    code: s.code, device: s.deviceId, batch: sent, leave: leave && last,
                });
                this._apply(r, sent);
                if (!this._hasWork()) break;
            }
            this.status = 'ok';
        } catch (e) {
            this.status = e.code === 'network' ? 'offline' : 'error';
            if (strict) throw e;
            if (e.status === 404) {
                // Deleted from another device: this one keeps what it shows.
                this._forget();
                this.status = 'deleted';
            } else if (e.status >= 400 && e.status < 500 && this.state.sending) {
                // Refused as malformed (a bug): sending it again would block every
                // later sync, so it's dropped — its numbers stay out of the record.
                console.warn('StatsSync: batch refused', e.code);
                this.state.sending = null;
                this._save();
            }
        } finally {
            this.onChange?.();
        }
    }

    /** Something to send (besides `except`, the batch about to go)? */
    _hasWork(except = null) {
        const s = this.state;
        if ((s.sending && s.sending !== except) || s.pending.length || s.reset !== null) return true;
        // A badge the record doesn't have, or has with a later date.
        return !except && s.badges.some(b => {
            const have = s.base?.badges?.find(x => x.id === b.id);
            return !have || b.earnedAt < have.earnedAt;
        });
    }

    /** Pending → the batch to send (a slice, if there's a lot). */
    _freeze() {
        const s = this.state;
        let n = 0;
        let size = 0;
        while (n < s.pending.length && n < BATCH_ENTRIES) {
            size += JSON.stringify(s.pending[n]).length;
            if (size > BATCH_CHARS && n > 0) break;
            n++;
        }
        s.sending = { id: randomId(), entries: s.pending.slice(0, n), badges: clone(s.badges), reset: s.reset, snapshot: null };
        s.pending = s.pending.slice(n);
        s.reset = null;
        this._save();
    }

    /** The record answered: its totals become the base. */
    _apply(r, sent) {
        const s = this.state;
        if (s.sending === sent) s.sending = null;
        s.resetAt = r.resetAt ?? null;
        // A reset made here while this was on its way hasn't reached the record:
        // keep showing the reset stats until it has.
        if (s.reset === null || (r.resetAt ?? -Infinity) >= s.reset) s.base = r.totals;
        s.devices = r.devices;
        s.syncedAt = this.now();
        this._save();
        this.onView?.();
    }

    /** No record any more: this device keeps the stats it shows, as its own. */
    _forget() {
        Object.assign(this.state, {
            code: null, base: null, resetAt: null, pending: [], reset: null, sending: null,
            badges: [], copiedFrom: null, devices: 0, syncedAt: null,
        });
        this._save();
        this.onView?.();
    }

    async _post(path, body) {
        let r;
        try {
            r = await this._fetch(`${this.baseUrl}${path}`, {
                method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
            });
        } catch {
            throw new SyncError('network');
        }
        let data = null;
        try { data = await r.json(); } catch { /* not JSON: a server error below */ }
        if (!r.ok || !data) throw new SyncError(data?.error || 'server', r.status);
        return data;
    }

    _save() {
        this.storage.set(KEY, this.state);
    }
}
