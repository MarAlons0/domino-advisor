// Durable Object: one person's record across their devices (SQLite storage —
// the free plan's kind), named by a hash of its sync code. The Worker
// (records.js) is its only caller and has already checked what the device sent.

import { StatsRecordStore } from './StatsRecordStore.js';

export class StatsRecord {
    constructor(ctx) {
        this.ctx = ctx;
        this.store = new StatsRecordStore(ctx.storage.sql);
    }

    async fetch(request) {
        const url = new URL(request.url);
        let body = {};
        try { body = await request.json(); } catch { return Response.json({ error: 'bad-request' }, { status: 400 }); }

        if (url.pathname === '/create') {
            if (!this.store.create()) return Response.json({ error: 'exists' }, { status: 409 });
            return Response.json({ ok: true }, { status: 201 });
        }

        if (url.pathname === '/sync') {
            const state = this.store.sync(body);
            if (!state) return Response.json({ error: 'not-found' }, { status: 404 });
            return Response.json(state);
        }

        if (url.pathname === '/delete') {
            if (!this.store.exists()) return Response.json({ error: 'not-found' }, { status: 404 });
            await this.ctx.storage.deleteAll();
            return Response.json({ ok: true });
        }

        return Response.json({ error: 'not-found' }, { status: 404 });
    }
}
