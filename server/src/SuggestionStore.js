// Suggestions & bug reports: validation, storage and the limits that keep a
// public endpoint cheap. Pure logic over a SQL handle (`exec(query, ...params)`
// returning something with `toArray()`), so it runs on a Durable Object's
// SQLite storage and, in the tests, on Node's own SQLite.

export const MAX_MESSAGE = 2000;   // characters, as the form's maxlength counts them
export const MAX_NAME = 100;
const KINDS = ['idea', 'bug'];
const LANGS = ['en', 'es'];

const MIN = 60 * 1000;
const DAY = 24 * 60 * MIN;

// Per sender (one IPv4 address or one IPv6 /64): [window, most allowed in it].
export const SUBMIT_LIMITS = [[10 * MIN, 5], [DAY, 30]];
// Wrong admin PINs from one sender before it has to wait.
export const PIN_LIMIT = [15 * MIN, 10];
// Everyone together, per day: what is stored, and how many of those are emailed
// (the rest are still saved and show on the admin screen).
export const SAVED_PER_DAY = 300;
export const EMAILS_PER_DAY = 50;
// The admin screen gets the newest of each; older ones stay stored.
const LIST_OPEN = 300;
const LIST_DONE = 100;

const text = (v, max) => String(v ?? '').replace(/\s+/g, ' ').trim().slice(0, max) || null;

/**
 * Check what a client sent. Returns { value } ready to store, or { error }.
 * The message keeps its line breaks; the short fields are flattened and cut.
 */
export function cleanSuggestion(data) {
    if (!data || typeof data !== 'object' || Array.isArray(data)) return { error: 'bad-request' };
    const kind = data.kind ?? 'idea';
    if (!KINDS.includes(kind)) return { error: 'bad-kind' };
    if (data.message !== undefined && typeof data.message !== 'string') return { error: 'bad-request' };
    const message = (data.message || '').replace(/\r\n?/g, '\n').trim();
    if (!message) return { error: 'empty' };
    if (message.length > MAX_MESSAGE) return { error: 'too-long' };
    return {
        value: {
            kind,
            message,
            name: text(data.name, MAX_NAME),
            screen: text(data.screen, 40),
            version: text(data.version, 20),
            difficulty: text(data.difficulty, 120),
            lang: LANGS.includes(data.lang) ? data.lang : null,
        },
    };
}

/** Same PIN? Compares every character either way, so timing says nothing. */
function samePin(given, expected) {
    let diff = given.length ^ expected.length;
    for (let i = 0; i < Math.max(given.length, expected.length); i++) {
        diff |= (given.charCodeAt(i) || 0) ^ (expected.charCodeAt(i) || 0);
    }
    return diff === 0;
}

export class SuggestionStore {
    /**
     * @param {{exec: Function}} sql - a Durable Object's `ctx.storage.sql`, or the like
     * @param {() => number} now - clock in ms (the tests move it)
     */
    constructor(sql, now = () => Date.now()) {
        this.q = (query, ...params) => sql.exec(query, ...params).toArray();
        this.now = now;
        this.q(`CREATE TABLE IF NOT EXISTS suggestions (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            kind TEXT NOT NULL,
            message TEXT NOT NULL,
            name TEXT,
            screen TEXT,
            version TEXT,
            difficulty TEXT,
            lang TEXT,
            status TEXT NOT NULL DEFAULT 'open',
            created_at INTEGER NOT NULL
        )`);
        // Who did what lately, for the limits. Rows older than a day are deleted (_hit).
        this.q(`CREATE TABLE IF NOT EXISTS hits (
            bucket TEXT NOT NULL,
            sender TEXT NOT NULL,
            at INTEGER NOT NULL
        )`);
        this.q('CREATE INDEX IF NOT EXISTS hits_lookup ON hits (bucket, sender, at)');
        this.q('CREATE INDEX IF NOT EXISTS suggestions_listing ON suggestions (status, created_at)');
    }

    _hits(bucket, sender, windowMs) {
        return this.q('SELECT COUNT(*) AS n FROM hits WHERE bucket = ? AND sender = ? AND at > ?',
            bucket, sender, this.now() - windowMs)[0].n;
    }

    /** Count one, and drop what is too old to matter to any limit. */
    _hit(bucket, sender) {
        const now = this.now();
        this.q('DELETE FROM hits WHERE at <= ?', now - DAY);
        this.q('INSERT INTO hits (bucket, sender, at) VALUES (?, ?, ?)', bucket, sender, now);
    }

    /**
     * Save a cleaned suggestion from `sender`, unless a limit says no.
     * @returns {{ok: true, suggestion: object, notify: boolean} | {ok: false, error: string, retryAfter: number}}
     *   notify is false once the day's emails are used up.
     */
    submit(sender, value) {
        const now = this.now();
        for (const [windowMs, max] of SUBMIT_LIMITS) {
            if (this._hits('submit', sender, windowMs) >= max) {
                return { ok: false, error: 'rate-limited', retryAfter: Math.ceil(windowMs / 1000) };
            }
        }
        const today = this.q('SELECT COUNT(*) AS n FROM suggestions WHERE created_at > ?', now - DAY)[0].n;
        if (today >= SAVED_PER_DAY) return { ok: false, error: 'busy', retryAfter: 3600 };

        this._hit('submit', sender);
        const [suggestion] = this.q(
            `INSERT INTO suggestions (kind, message, name, screen, version, difficulty, lang, created_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?) RETURNING *`,
            value.kind, value.message, value.name, value.screen, value.version, value.difficulty, value.lang, now);

        const notify = this._hits('email', '*', DAY) < EMAILS_PER_DAY;
        if (notify) this._hit('email', '*');
        return { ok: true, suggestion, notify };
    }

    /**
     * May `sender` use the admin screen with this PIN?
     * @returns {'ok' | 'not-configured' | 'locked' | 'wrong'}
     *   'not-configured' when the server has no PIN: nobody gets in.
     */
    checkPin(sender, given, expected) {
        const pin = String(expected ?? '').trim();
        if (!pin) return 'not-configured';
        const [windowMs, max] = PIN_LIMIT;
        if (this._hits('pin', sender, windowMs) >= max) return 'locked';
        if (samePin(String(given ?? '').trim(), pin)) return 'ok';
        this._hit('pin', sender);
        return 'wrong';
    }

    /** Open ones first, newest first within each. */
    list() {
        const page = (status, limit) => this.q(
            'SELECT * FROM suggestions WHERE status = ? ORDER BY created_at DESC, id DESC LIMIT ?', status, limit);
        return [...page('open', LIST_OPEN), ...page('done', LIST_DONE)];
    }

    /** @returns the updated suggestion, or null if there is none with that id */
    setStatus(id, status) {
        return this.q('UPDATE suggestions SET status = ? WHERE id = ? RETURNING *', status, id)[0] || null;
    }
}
