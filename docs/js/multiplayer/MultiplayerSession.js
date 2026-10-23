// Connection to a multiplayer room: WebSocket with automatic reconnection, the
// player's display name and per-room seat token (so a reload or dropped signal
// rejoins the same seat), and the room actions the lobby offers.
// See docs/MULTIPLAYER.md.

import { StorageService } from '../stats/StorageService.js';

const LOCAL = typeof location !== 'undefined' && /^(localhost|127\.0\.0\.1)$/.test(location.hostname);
// The rooms Worker (Cloudflare, free plan). Local pages talk to `wrangler dev`.
export const ROOMS_URL = LOCAL ? 'http://localhost:8798' : 'https://domino-rooms.mario-alonso-account.workers.dev';
const WS_URL = ROOMS_URL.replace(/^http/, 'ws');

const CODE_RE = /^[A-HJ-NP-Z2-9]{6}$/;
const NAME_KEY = '7fichas_mp_name';
const RETRY_MS = [500, 1000, 2000, 4000, 8000];

export class MultiplayerSession {
    /** The room code in the page URL (…/?room=K7Q2XM), or null. */
    static roomFromUrl() {
        const c = (new URLSearchParams(location.search).get('room') || '').toUpperCase();
        return CODE_RE.test(c) ? c : null;
    }

    static isValidCode(code) { return CODE_RE.test(String(code || '').toUpperCase()); }

    /** Create a room on the server; resolves to its code. */
    static async createRoom() {
        const r = await fetch(`${ROOMS_URL}/rooms`, { method: 'POST' });
        if (!r.ok) throw new Error(`create failed (${r.status})`);
        return (await r.json()).code;
    }

    static async roomExists(code) {
        try { return (await fetch(`${ROOMS_URL}/rooms/${code}/info`)).ok; } catch { return false; }
    }

    static roomUrl(code) {
        return `${location.origin}${location.pathname}?room=${code}`;
    }

    static get savedName() { return StorageService.get(NAME_KEY) || ''; }
    static set savedName(name) { StorageService.set(NAME_KEY, String(name || '').slice(0, 12)); }

    /**
     * @param {string} code
     * @param {RemoteGame} game - receives the game messages; its send() goes through here
     */
    constructor(code, game) {
        this.code = code;
        this.game = game;
        this.playerId = null;
        this.lobby = null;
        this.status = 'idle';     // idle | connecting | open | reconnecting | gone
        this.ws = null;
        this.attempt = 0;
        this.leaving = false;
        this.onLobby = null;      // (lobby) any room change
        this.onStatus = null;     // (status)
        this.onError = null;      // (code)
        game.send = (msg) => this.send(msg);
    }

    get tokenKey() { return `7fichas_mp_token_${this.code}`; }

    connect() {
        this._setStatus(this.attempt ? 'reconnecting' : 'connecting');
        const ws = new WebSocket(`${WS_URL}/rooms/${this.code}/ws`);
        this.ws = ws;
        ws.onopen = () => {
            this.attempt = 0;
            ws.send(JSON.stringify({ type: 'hello', name: MultiplayerSession.savedName, token: StorageService.get(this.tokenKey) }));
            this._setStatus('open');
        };
        ws.onmessage = (e) => {
            let msg;
            try { msg = JSON.parse(e.data); } catch { return; }
            this._handle(msg);
        };
        ws.onclose = (e) => {
            if (this.ws !== ws || this.leaving) return;
            if (e.code === 4004) return this._setStatus('gone');     // room no longer exists
            if (e.code === 4000) return this._setStatus('replaced'); // opened in another tab
            const wait = RETRY_MS[Math.min(this.attempt++, RETRY_MS.length - 1)];
            this._setStatus('reconnecting');
            setTimeout(() => { if (!this.leaving) this.connect(); }, wait);
        };
    }

    _handle(msg) {
        switch (msg.type) {
            case 'welcome':
                this.playerId = msg.playerId;
                StorageService.set(this.tokenKey, msg.token);
                if (this.lobby) this.onLobby?.(this.lobby); // redraw now that we know who we are
                return;
            case 'lobby':
                this.lobby = msg.lobby;
                this.game.receive(msg);
                return this.onLobby?.(this.lobby);
            case 'sync':
                this.lobby = msg.lobby;
                this.game.receive(msg);
                return this.onLobby?.(this.lobby);
            case 'error':
                this.game.receive(msg);
                return this.onError?.(msg.code);
            default:
                return this.game.receive(msg);
        }
    }

    send(msg) {
        if (this.ws && this.ws.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify(msg));
    }

    _setStatus(s) {
        this.status = s;
        this.onStatus?.(s);
    }

    // ---- lobby helpers
    isHost() { return !!this.lobby && this.lobby.host === this.playerId; }
    mySeat() {
        // Until 'welcome' names us, playerId is null — which would match open seats.
        if (!this.playerId || !this.lobby) return null;
        const i = this.lobby.seats.findIndex(s => s.playerId === this.playerId);
        return i === -1 ? null : i;
    }

    // ---- actions
    takeSeat(seat) { this.send({ type: 'takeSeat', seat }); }
    setSeat(seat, kind, level) { this.send({ type: 'setSeat', seat, kind, level }); }
    start() { this.send({ type: 'start' }); }
    replaceWithAI(seat) { this.send({ type: 'replaceWithAI', seat }); }

    /** Leave the room: back to single player (the seat token is kept for rejoining). */
    leave() {
        this.leaving = true;
        try { this.ws?.close(1000, 'leave'); } catch { /* already closed */ }
        location.href = `${location.origin}${location.pathname}`;
    }
}
