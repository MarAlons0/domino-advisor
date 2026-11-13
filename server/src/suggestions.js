// Suggestions & bug reports — the Worker side.
//   POST  /suggestions       → 201 { ok, id }        anyone (limited per sender)
//   GET   /suggestions       → { suggestions }       admin (X-Admin-Pin)
//   PATCH /suggestions/ID    → the suggestion        admin; body { status: 'open' | 'done' }
// Storage and limits live in the SuggestionBox Durable Object; email in email.js.

import { cleanSuggestion } from './SuggestionStore.js';
import { notifyOperators } from './email.js';

const MAX_BODY = 16 * 1024; // bytes; a full 2,000-character message fits several times over

/**
 * Who is sending, for the per-sender limits: the address hashed (the raw one is
 * never stored), with an IPv6 address cut to its /64 since one device or home
 * gets a whole /64 to pick from.
 */
export async function senderKey(request) {
    let ip = (request.headers.get('CF-Connecting-IP') || '').trim().toLowerCase();
    if (!ip) return 'unknown';
    if (ip.includes(':') && ip.includes('.')) ip = ip.slice(ip.lastIndexOf(':') + 1); // ::ffff:1.2.3.4
    if (ip.includes(':')) {
        const [head, tail] = ip.split('::');
        const h = head ? head.split(':') : [];
        const t = tail ? tail.split(':') : [];
        const groups = ip.includes('::') ? [...h, ...Array(Math.max(0, 8 - h.length - t.length)).fill('0'), ...t] : h;
        ip = groups.slice(0, 4).map(g => g.replace(/^0+(?=.)/, '')).join(':') + '::/64';
    }
    const hash = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(`7fichas:${ip}`));
    return [...new Uint8Array(hash)].slice(0, 12).map(b => b.toString(16).padStart(2, '0')).join('');
}

/** The request's JSON, read only up to MAX_BODY bytes. */
async function readJson(request) {
    if (Number(request.headers.get('Content-Length') || 0) > MAX_BODY) return { error: 'too-large' };
    const reader = request.body?.getReader();
    if (!reader) return { error: 'bad-request' };
    const chunks = [];
    let size = 0;
    for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        size += value.byteLength;
        if (size > MAX_BODY) {
            await reader.cancel().catch(() => {});
            return { error: 'too-large' };
        }
        chunks.push(value);
    }
    const bytes = new Uint8Array(size);
    let at = 0;
    for (const c of chunks) { bytes.set(c, at); at += c.byteLength; }
    try { return { data: JSON.parse(new TextDecoder().decode(bytes)) }; } catch { return { error: 'bad-request' }; }
}

export async function handleSuggestions(request, env, ctx, url, cors) {
    const reply = (body, status = 200, extra = {}) => new Response(JSON.stringify(body), {
        status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', ...cors, ...extra },
    });
    if (!env.SUGGESTIONS) return reply({ error: 'not-available' }, 503);
    const box = env.SUGGESTIONS.get(env.SUGGESTIONS.idFromName('inbox'));
    const ask = (path, body) => box.fetch(`https://box${path}`, { method: 'POST', body: JSON.stringify(body) });
    const sender = await senderKey(request);

    if (url.pathname === '/suggestions' && request.method === 'POST') {
        const { data, error } = await readJson(request);
        if (error) return reply({ error }, error === 'too-large' ? 413 : 400);
        const clean = cleanSuggestion(data);
        if (clean.error) return reply({ error: clean.error }, 400);

        const r = await ask('/submit', { sender, value: clean.value });
        const saved = await r.json();
        if (!r.ok) return reply({ error: saved.error }, r.status, saved.retryAfter ? { 'Retry-After': String(saved.retryAfter) } : {});
        // The suggestion is saved; the email goes out after the answer.
        if (saved.notify) {
            const sending = notifyOperators(env, saved.suggestion);
            if (ctx?.waitUntil) ctx.waitUntil(sending); else await sending;
        }
        return reply({ ok: true, id: saved.suggestion.id }, 201);
    }

    const pin = request.headers.get('X-Admin-Pin') || '';

    if (url.pathname === '/suggestions' && request.method === 'GET') {
        const r = await ask('/list', { sender, pin });
        return reply(await r.json(), r.status);
    }

    const m = url.pathname.match(/^\/suggestions\/(\d{1,12})$/);
    if (m && request.method === 'PATCH') {
        const { data, error } = await readJson(request);
        if (error) return reply({ error }, error === 'too-large' ? 413 : 400);
        const r = await ask('/status', { sender, pin, id: Number(m[1]), status: data?.status });
        return reply(await r.json(), r.status);
    }

    return reply({ error: 'not-found' }, 404);
}
