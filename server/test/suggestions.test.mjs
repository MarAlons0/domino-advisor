// Suggestions & bug reports, through the Worker's own fetch handler: the real
// routing, validation, SuggestionBox and SuggestionStore, with Node's SQLite in
// place of the Durable Object's and SendGrid replaced by a recorder. No request
// leaves the machine: the stand-in fetch throws on any address but SendGrid's.
import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import worker from '../src/index.js';
import { SuggestionBox } from '../src/SuggestionBox.js';
import {
    SuggestionStore, cleanSuggestion, MAX_MESSAGE, SUBMIT_LIMITS, PIN_LIMIT, SAVED_PER_DAY, EMAILS_PER_DAY,
} from '../src/SuggestionStore.js';
import { senderKey } from '../src/suggestions.js';

const PIN = 'test-pin-4821';
const URL_BASE = 'https://rooms.test';
const MIN = 60 * 1000;

/** `ctx.storage.sql` look-alike over an in-memory SQLite database. */
function sqlHandle() {
    const db = new DatabaseSync(':memory:');
    return { exec: (query, ...params) => { const rows = db.prepare(query).all(...params); return { toArray: () => rows }; } };
}

/** A Worker environment with one suggestion box, a clock the test moves, and recorded email. */
function setup(t, secrets = { ADMIN_PIN: PIN, SENDGRID_API_KEY: 'SG.test-key', OPERATOR_EMAILS: 'ana@example.com, ben@example.com' }) {
    const env = { ...secrets };
    const clock = { t: Date.UTC(2026, 10, 13, 12) };
    const box = new SuggestionBox({ storage: { sql: sqlHandle() } }, env);
    box.store.now = () => clock.t;
    env.SUGGESTIONS = { idFromName: (name) => name, get: () => ({ fetch: (url, init) => box.fetch(new Request(url, init)) }) };

    const emails = [];
    const mail = { status: 202, fail: false };
    const realFetch = globalThis.fetch;
    globalThis.fetch = async (url, init) => {
        assert.equal(String(url), 'https://api.sendgrid.com/v3/mail/send', 'the only outside call is SendGrid');
        if (mail.fail) throw new TypeError('network down');
        emails.push({ headers: init.headers, body: JSON.parse(init.body) });
        return new Response(null, { status: mail.status });
    };
    t.after(() => { globalThis.fetch = realFetch; });

    const call = async (method, path, { body, pin, ip = '203.0.113.7', origin, raw } = {}) => {
        const headers = { 'CF-Connecting-IP': ip };
        if (body !== undefined || raw !== undefined) headers['Content-Type'] = 'application/json';
        if (pin !== undefined) headers['X-Admin-Pin'] = pin;
        if (origin) headers.Origin = origin;
        const pending = [];
        const res = await worker.fetch(
            new Request(URL_BASE + path, { method, headers, body: raw ?? (body === undefined ? undefined : JSON.stringify(body)) }),
            env, { waitUntil: (p) => pending.push(p) });
        await Promise.all(pending); // the email goes out after the answer
        const text = await res.text();
        return { status: res.status, headers: res.headers, json: text ? JSON.parse(text) : null };
    };
    const send = (body, opts) => call('POST', '/suggestions', { body, ...opts });
    const list = async (opts = { pin: PIN }) => (await call('GET', '/suggestions', opts)).json.suggestions;
    return { env, clock, emails, mail, call, send, list, box };
}

test('submit: an idea is saved with its context and emailed to each organizer', async (t) => {
    const { send, list, emails } = setup(t);
    const r = await send({
        kind: 'idea', message: '  Show the pass count\nnext to each player.  ', name: ' Ana ',
        screen: 'hand-end', version: 'v1.20.0', difficulty: 'opp1 master · partner master · opp2 beginner', lang: 'es',
    });
    assert.equal(r.status, 201);
    assert.deepEqual(r.json, { ok: true, id: 1 });

    const [s] = await list();
    assert.equal(s.kind, 'idea');
    assert.equal(s.message, 'Show the pass count\nnext to each player.');
    assert.equal(s.name, 'Ana');
    assert.equal(s.screen, 'hand-end');
    assert.equal(s.version, 'v1.20.0');
    assert.equal(s.difficulty, 'opp1 master · partner master · opp2 beginner');
    assert.equal(s.lang, 'es');
    assert.equal(s.status, 'open');
    assert.equal(s.created_at, Date.UTC(2026, 10, 13, 12));

    assert.equal(emails.length, 1, 'one SendGrid request');
    const { headers, body } = emails[0];
    assert.equal(headers.Authorization, 'Bearer SG.test-key');
    assert.deepEqual(body.personalizations, [{ to: [{ email: 'ana@example.com' }] }, { to: [{ email: 'ben@example.com' }] }]);
    assert.deepEqual(body.from, { email: 'ana@example.com', name: '7 Fichas' }, 'defaults to the first operator');
    assert.equal(body.subject, '7 Fichas: new suggestion');
    assert.equal(body.content[0].type, 'text/plain');
    const text = body.content[0].value;
    assert.match(text, /^Suggestion from Ana:\n\nShow the pass count\nnext to each player\./);
    assert.match(text, /App v1\.20\.0 · screen: hand-end · AI levels: opp1 master · partner master · opp2 beginner · language: es/);
    assert.match(text, /\?admin=suggestions/);
});

test('submit: a bug with nothing but a message; SENDGRID_FROM_EMAIL is used when set', async (t) => {
    const { send, list, emails } = setup(t, {
        ADMIN_PIN: PIN, SENDGRID_API_KEY: 'SG.test-key', OPERATOR_EMAILS: 'ana@example.com', SENDGRID_FROM_EMAIL: 'noreply@example.com',
    });
    assert.equal((await send({ kind: 'bug', message: 'The Pass button stayed off.' })).status, 201);
    const [s] = await list();
    assert.equal(s.kind, 'bug');
    assert.deepEqual([s.name, s.screen, s.version, s.difficulty, s.lang], [null, null, null, null, null]);
    assert.equal(emails[0].body.subject, '7 Fichas: new bug report');
    assert.equal(emails[0].body.from.email, 'noreply@example.com');
    assert.match(emails[0].body.content[0].value, /^Bug report from someone \(no name given\):/);
});

test('submit: kind defaults to idea; unknown extras and a made-up language are dropped', async (t) => {
    const { send, list } = setup(t);
    assert.equal((await send({ message: 'hello', lang: 'fr', status: 'done', id: 99, created_at: 1 })).status, 201);
    const [s] = await list();
    assert.deepEqual([s.id, s.kind, s.lang, s.status], [1, 'idea', null, 'open']);
});

test('submit: saved even when email is not set up, is refused by SendGrid, or the network fails', async (t) => {
    const noMail = setup(t, { ADMIN_PIN: PIN });
    assert.equal((await noMail.send({ message: 'no secrets' })).status, 201);
    assert.equal(noMail.emails.length, 0);
    assert.equal((await noMail.list()).length, 1);

    const keyOnly = setup(t, { ADMIN_PIN: PIN, SENDGRID_API_KEY: 'SG.test-key', OPERATOR_EMAILS: ' , not-an-address' });
    assert.equal((await keyOnly.send({ message: 'no usable recipient' })).status, 201);
    assert.equal(keyOnly.emails.length, 0);

    const refused = setup(t);
    refused.mail.status = 403;
    assert.equal((await refused.send({ message: 'sender not verified' })).status, 201);
    assert.equal((await refused.list()).length, 1);

    const down = setup(t);
    down.mail.fail = true;
    assert.equal((await down.send({ message: 'network down' })).status, 201);
    assert.equal((await down.list()).length, 1);
});

test('length cap: 2,000 characters pass, 2,001 do not; empty, bad kind, bad JSON and huge bodies are refused', async (t) => {
    const { send, call, list, emails } = setup(t);
    assert.equal(MAX_MESSAGE, 2000);
    assert.equal((await send({ message: 'x'.repeat(2000) })).status, 201);

    const long = await send({ message: 'x'.repeat(2001) });
    assert.deepEqual([long.status, long.json.error], [400, 'too-long']);
    for (const [body, error] of [
        [{ message: '   \n ' }, 'empty'], [{}, 'empty'], [{ kind: 'spam', message: 'hi' }, 'bad-kind'],
        [{ message: 42 }, 'bad-request'], [[], 'bad-request'], ['hi', 'bad-request'],
    ]) {
        const r = await send(body);
        assert.deepEqual([r.status, r.json.error], [400, error], JSON.stringify(body));
    }
    const notJson = await call('POST', '/suggestions', { raw: '{"message": ' });
    assert.deepEqual([notJson.status, notJson.json.error], [400, 'bad-request']);
    const huge = await send({ message: 'x'.repeat(20000) });
    assert.deepEqual([huge.status, huge.json.error], [413, 'too-large']);

    assert.equal((await list()).length, 1, 'only the valid one was saved');
    assert.equal(emails.length, 1);
    // Long names and context are cut, not refused.
    assert.equal((await send({ message: 'ok', name: 'n'.repeat(500), screen: 's'.repeat(500) })).status, 201);
    const [s] = await list();
    assert.deepEqual([s.name.length, s.screen.length], [100, 40]);
});

test('rate limit: the sixth message in ten minutes from one address is refused; others are not', async (t) => {
    const { send, clock, list, emails } = setup(t);
    const [windowMs, max] = SUBMIT_LIMITS[0];
    assert.deepEqual([windowMs, max], [10 * MIN, 5]);
    for (let i = 0; i < max; i++) assert.equal((await send({ message: `idea ${i}` })).status, 201);

    const sixth = await send({ message: 'one too many' });
    assert.deepEqual([sixth.status, sixth.json.error], [429, 'rate-limited']);
    assert.equal(sixth.headers.get('Retry-After'), '600');
    assert.equal((await send({ message: 'someone else' }, { ip: '198.51.100.20' })).status, 201);

    // IPv6: one home or phone has a whole /64, so the /64 is the sender.
    const home = '2001:db8:aa:bb';
    for (let i = 0; i < max; i++) assert.equal((await send({ message: `v6 ${i}` }, { ip: `${home}::${i + 1}` })).status, 201);
    assert.equal((await send({ message: 'same /64' }, { ip: `${home}:ffff:1:2:3` })).status, 429);
    assert.equal((await send({ message: 'next /64' }, { ip: '2001:db8:aa:bc::1' })).status, 201);

    clock.t += windowMs + 1000;
    assert.equal((await send({ message: 'after the wait' })).status, 201);
    assert.equal((await list()).length, 2 * max + 3, 'refused ones were not saved');
    assert.equal(emails.length, 2 * max + 3, 'nor emailed');
});

test('rate limit: per-day cap for one sender, and the caps for everyone together', () => {
    const clock = { t: Date.UTC(2026, 10, 13) };
    const store = new SuggestionStore(sqlHandle(), () => clock.t);
    const value = cleanSuggestion({ message: 'hi' }).value;
    const [dayMs, perDay] = SUBMIT_LIMITS[1];

    // One sender, spaced out so the ten-minute limit never bites.
    for (let i = 0; i < perDay; i++) { assert.equal(store.submit('a', value).ok, true); clock.t += 11 * MIN; }
    const over = store.submit('a', value);
    assert.deepEqual([over.ok, over.error, over.retryAfter], [false, 'rate-limited', dayMs / 1000]);
    clock.t += dayMs;
    assert.equal(store.submit('a', value).ok, true, 'a day later');

    // Many senders: emails stop first, then saving.
    clock.t += 2 * dayMs;
    let notified = 0;
    for (let i = 0; i < SAVED_PER_DAY; i++) {
        const r = store.submit(`sender-${i}`, value);
        assert.equal(r.ok, true);
        if (r.notify) notified++;
    }
    assert.equal(notified, EMAILS_PER_DAY);
    const full = store.submit('one-more', value);
    assert.deepEqual([full.ok, full.error], [false, 'busy']);
    clock.t += dayMs + 1;
    const next = store.submit('one-more', value);
    assert.deepEqual([next.ok, next.notify], [true, true]);
});

test('admin list: needs the PIN; open first, newest first, with every field', async (t) => {
    const { send, call, list, clock } = setup(t);
    for (const message of ['first', 'second', 'third']) { await send({ message }); clock.t += MIN; }
    const r = await call('GET', '/suggestions', { pin: PIN });
    assert.equal(r.status, 200);
    assert.equal(r.headers.get('Cache-Control'), 'no-store');
    assert.deepEqual(r.json.suggestions.map(s => s.message), ['third', 'second', 'first']);
    assert.deepEqual(Object.keys(r.json.suggestions[0]).sort(),
        ['created_at', 'difficulty', 'id', 'kind', 'lang', 'message', 'name', 'screen', 'status', 'version']);

    await call('PATCH', '/suggestions/3', { pin: PIN, body: { status: 'done' } });
    assert.deepEqual((await list()).map(s => [s.message, s.status]),
        [['second', 'open'], ['first', 'open'], ['third', 'done']]);
});

test('Mark done / Reopen', async (t) => {
    const { send, call, list } = setup(t);
    await send({ message: 'fix the timer', kind: 'bug' });

    const done = await call('PATCH', '/suggestions/1', { pin: PIN, body: { status: 'done' } });
    assert.equal(done.status, 200);
    assert.deepEqual([done.json.id, done.json.status, done.json.message], [1, 'done', 'fix the timer']);
    assert.equal((await list())[0].status, 'done');

    const reopened = await call('PATCH', '/suggestions/1', { pin: PIN, body: { status: 'open' } });
    assert.deepEqual([reopened.status, reopened.json.status], [200, 'open']);
    assert.equal((await list())[0].status, 'open');

    const missing = await call('PATCH', '/suggestions/77', { pin: PIN, body: { status: 'done' } });
    assert.deepEqual([missing.status, missing.json.error], [404, 'not-found']);
    for (const body of [{ status: 'deleted' }, {}, { status: null }]) {
        const bad = await call('PATCH', '/suggestions/1', { pin: PIN, body });
        assert.deepEqual([bad.status, bad.json.error], [400, 'bad-request']);
    }
    assert.equal((await call('PATCH', '/suggestions/abc', { pin: PIN, body: { status: 'done' } })).status, 404);
    assert.equal((await call('DELETE', '/suggestions/1', { pin: PIN })).status, 404);
    assert.equal((await list())[0].status, 'open', 'none of those changed it');
});

test('wrong PIN: no list, no changes; ten wrong tries lock that sender out for a while', async (t) => {
    const { send, call, clock } = setup(t);
    await send({ message: 'private' });

    for (const pin of ['nope', '', undefined, PIN + '1', PIN.slice(0, -1), PIN.toUpperCase()]) {
        const r = await call('GET', '/suggestions', { pin });
        assert.deepEqual([r.status, r.json], [403, { error: 'wrong-pin' }], `pin ${pin}`);
    }
    const patch = await call('PATCH', '/suggestions/1', { pin: 'nope', body: { status: 'done' } });
    assert.deepEqual([patch.status, patch.json], [403, { error: 'wrong-pin' }]);
    const ok = await call('GET', '/suggestions', { pin: ` ${PIN} ` });
    assert.equal(ok.status, 200, 'the right PIN still works after 7 wrong ones (spaces around it ignored)');
    assert.equal(ok.json.suggestions[0].status, 'open', 'the wrong-PIN PATCH changed nothing');

    const [windowMs, max] = PIN_LIMIT;
    for (let i = 7; i < max; i++) assert.equal((await call('GET', '/suggestions', { pin: 'guess' })).status, 403);
    const locked = await call('GET', '/suggestions', { pin: PIN });
    assert.deepEqual([locked.status, locked.json], [429, { error: 'pin-locked' }], 'even the right PIN waits');
    assert.equal((await call('GET', '/suggestions', { pin: PIN, ip: '198.51.100.20' })).status, 200, 'another address is not locked');
    clock.t += windowMs + 1000;
    assert.equal((await call('GET', '/suggestions', { pin: PIN })).status, 200);
});

test('no ADMIN_PIN on the server: the admin screen is closed to everyone, sending still works', async (t) => {
    for (const secrets of [{}, { ADMIN_PIN: '' }, { ADMIN_PIN: '   ' }]) {
        const { send, call } = setup(t, secrets);
        assert.equal((await send({ message: 'still saved' })).status, 201);
        for (const pin of [undefined, '', '   ', 'undefined', 'null']) {
            const r = await call('GET', '/suggestions', { pin });
            assert.deepEqual([r.status, r.json], [503, { error: 'admin-not-configured' }]);
            const p = await call('PATCH', '/suggestions/1', { pin, body: { status: 'done' } });
            assert.deepEqual([p.status, p.json], [503, { error: 'admin-not-configured' }]);
        }
    }
});

test('origin check and CORS still apply, now with PATCH and the PIN header', async (t) => {
    const { send, call } = setup(t);
    const app = 'https://maralons0.github.io';

    const other = await send({ message: 'from another site' }, { origin: 'https://example.com' });
    assert.deepEqual([other.status, other.json.error], [403, 'origin-not-allowed']);
    assert.equal(other.headers.get('Access-Control-Allow-Origin'), null);
    assert.equal((await call('GET', '/suggestions', { pin: PIN, origin: 'https://example.com' })).status, 403);

    const pre = await call('OPTIONS', '/suggestions/1', { origin: app });
    assert.equal(pre.status, 204);
    assert.equal(pre.headers.get('Access-Control-Allow-Origin'), app);
    assert.match(pre.headers.get('Access-Control-Allow-Methods'), /PATCH/);
    assert.match(pre.headers.get('Access-Control-Allow-Headers'), /X-Admin-Pin/);

    const mine = await send({ message: 'from the app' }, { origin: app });
    assert.equal(mine.status, 201);
    assert.equal(mine.headers.get('Access-Control-Allow-Origin'), app);
    const listed = await call('GET', '/suggestions', { pin: PIN, origin: 'http://localhost:8791' });
    assert.equal(listed.headers.get('Access-Control-Allow-Origin'), 'http://localhost:8791');
    const refused = await call('GET', '/suggestions', { pin: 'nope', origin: app });
    assert.equal(refused.headers.get('Access-Control-Allow-Origin'), app, 'errors carry CORS too, so the app can read them');
});

test('the sender key hides the address and groups an IPv6 /64', async () => {
    const key = (ip) => senderKey(new Request(URL_BASE, { headers: ip ? { 'CF-Connecting-IP': ip } : {} }));
    const a = await key('203.0.113.7');
    assert.match(a, /^[0-9a-f]{24}$/);
    assert.notEqual(a, await key('203.0.113.8'));
    assert.equal(await key('::ffff:203.0.113.7'), a);
    assert.equal(await key('2001:db8:aa:bb::1'), await key('2001:0DB8:00aa:00bb:1:2:3:4'));
    assert.notEqual(await key('2001:db8:aa:bb::1'), await key('2001:db8:aa:bc::1'));
    assert.equal(await key('2001:db8::1'), await key('2001:db8:0:0:9::'));
    assert.equal(await key(null), 'unknown');
});

test('rooms and unknown paths are untouched', async (t) => {
    const { call } = setup(t);
    assert.equal((await call('GET', '/rooms/BAD/info')).status, 400);
    assert.equal((await call('GET', '/suggestion')).status, 404);
    assert.equal((await call('GET', '/suggestions/1', { pin: PIN })).status, 404);
});
