// Durable Object: one per room. Wraps the pure RoomEngine with WebSockets
// (Hibernation API — an idle room costs nothing), storage (the room record is
// saved after every change, so a room unloaded from memory is rebuilt by
// replaying it) and an alarm (grace-period wake-ups and idle cleanup).

import { RoomEngine } from './RoomEngine.js';

const IDLE_CLEANUP_MS = 6 * 60 * 60 * 1000; // forget rooms idle for 6 hours
const MAX_MESSAGE = 2048;                    // bytes; real messages are < 200

export class GameRoom {
    constructor(ctx, env) {
        this.ctx = ctx;
        this.env = env;
        this.engine = null;
    }

    async _load() {
        if (!this.engine) {
            const meta = await this.ctx.storage.get('room');
            if (meta) this.engine = RoomEngine.fromSnapshot(meta);
        }
        return this.engine;
    }

    async fetch(request) {
        const url = new URL(request.url);

        if (url.pathname === '/init') {
            if (await this._load()) return new Response('exists', { status: 409 });
            this.engine = new RoomEngine({ code: url.searchParams.get('code') });
            await this._persist();
            return new Response('ok');
        }

        if (url.pathname === '/info') {
            const e = await this._load();
            if (!e) return Response.json({ exists: false }, { status: 404 });
            return Response.json({ exists: true, phase: e.meta.phase, seats: e.meta.seats.map(s => s.kind) });
        }

        if (url.pathname === '/ws') {
            if (request.headers.get('Upgrade') !== 'websocket') return new Response('expected websocket', { status: 426 });
            if (!(await this._load())) return new Response('no such room', { status: 404 });
            const pair = new WebSocketPair();
            this.ctx.acceptWebSocket(pair[1]);
            return new Response(null, { status: 101, webSocket: pair[0] });
        }

        return new Response('not found', { status: 404 });
    }

    async webSocketMessage(ws, raw) {
        const e = await this._load();
        if (!e) return ws.close(4004, 'no such room');
        if (typeof raw !== 'string' || raw.length > MAX_MESSAGE) return;
        let msg;
        try { msg = JSON.parse(raw); } catch { return; }

        if (msg.type === 'hello') {
            const { playerId } = e.connect({ name: msg.name, token: msg.token });
            // One live socket per player (a reload or second tab replaces the old one).
            for (const other of this.ctx.getWebSockets()) {
                if (other !== ws && other.deserializeAttachment()?.playerId === playerId) other.close(4000, 'replaced');
            }
            ws.serializeAttachment({ playerId });
        } else {
            const playerId = ws.deserializeAttachment()?.playerId;
            if (!playerId) return; // must say hello first
            e.handle(playerId, msg);
        }
        await this._flush();
    }

    async webSocketClose(ws, code) {
        const playerId = ws.deserializeAttachment()?.playerId;
        const e = await this._load();
        const stillHere = this.ctx.getWebSockets().some(s => s !== ws && s.deserializeAttachment()?.playerId === playerId);
        if (e && playerId && !stillHere) {
            e.disconnect(playerId);
            await this._flush();
        }
    }

    async webSocketError(ws) {
        return this.webSocketClose(ws, 1011);
    }

    async alarm() {
        const e = await this._load();
        if (!e) return;
        if (this.ctx.getWebSockets().length === 0 && Date.now() - e.meta.lastActivity >= IDLE_CLEANUP_MS) {
            await this.ctx.storage.deleteAll();
            this.engine = null;
            return;
        }
        e.tick(); // grace periods may have ended → host sees "give seat to AI"
        await this._flush();
    }

    /** Send the engine's queued messages to the right sockets, then save. */
    async _flush() {
        const out = this.engine.drain();
        if (out.length) {
            const sockets = this.ctx.getWebSockets().map(s => ({ s, pid: s.deserializeAttachment()?.playerId }));
            for (const o of out) {
                const data = JSON.stringify(o.msg);
                for (const { s, pid } of sockets) {
                    if (pid && (o.to === 'all' || o.to === pid)) {
                        try { s.send(data); } catch { /* socket closing */ }
                    }
                }
            }
        }
        await this._persist();
    }

    async _persist() {
        await this.ctx.storage.put('room', this.engine.snapshot());
        // Next wake-up: a grace period ending, else the idle-cleanup check.
        const next = this.engine.nextWakeup() ?? Date.now() + IDLE_CLEANUP_MS;
        await this.ctx.storage.setAlarm(next);
    }
}
