// Durable Object: the one suggestion box (SQLite storage — the free plan's
// kind). The Worker (suggestions.js) is its only caller; it sends the sender's
// key along, and for the admin calls the PIN, which is checked here so the
// wrong-PIN count sits next to the data it guards.

import { SuggestionStore } from './SuggestionStore.js';

const STATUSES = ['open', 'done'];
const PIN_ERRORS = {
    'not-configured': [503, 'admin-not-configured'],
    locked: [429, 'pin-locked'],
    wrong: [403, 'wrong-pin'],
};

export class SuggestionBox {
    constructor(ctx, env) {
        this.env = env;
        this.store = new SuggestionStore(ctx.storage.sql);
    }

    async fetch(request) {
        const url = new URL(request.url);
        let body;
        try { body = await request.json(); } catch { return Response.json({ error: 'bad-request' }, { status: 400 }); }
        const sender = String(body.sender || 'unknown');

        if (url.pathname === '/submit') {
            const r = this.store.submit(sender, body.value);
            if (!r.ok) return Response.json({ error: r.error, retryAfter: r.retryAfter }, { status: 429 });
            return Response.json({ suggestion: r.suggestion, notify: r.notify }, { status: 201 });
        }

        if (url.pathname === '/list' || url.pathname === '/status') {
            const gate = this.store.checkPin(sender, body.pin, this.env.ADMIN_PIN);
            if (gate !== 'ok') {
                const [status, error] = PIN_ERRORS[gate];
                return Response.json({ error }, { status });
            }
            if (url.pathname === '/list') return Response.json({ suggestions: this.store.list() });

            if (!Number.isInteger(body.id) || !STATUSES.includes(body.status)) {
                return Response.json({ error: 'bad-request' }, { status: 400 });
            }
            const updated = this.store.setStatus(body.id, body.status);
            if (!updated) return Response.json({ error: 'not-found' }, { status: 404 });
            return Response.json(updated);
        }

        return Response.json({ error: 'not-found' }, { status: 404 });
    }
}
