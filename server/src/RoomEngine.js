// Multiplayer room logic — pure: no Cloudflare APIs, so it runs and is tested in Node.
// The Durable Object (GameRoom.js) wraps it with sockets, storage and alarms.
//
// The room is the authority: it deals, holds every hand, validates each play, runs
// the AI seats and decides what each player may see (their own hand + public play;
// all hands only when a hand ends, as in single player).
//
// Persistence is a small record — each hand's deal plus the ordered list of plays and
// passes — so a room unloaded from memory can be rebuilt exactly by replaying it
// (applying a play costs ~0 ms). AI decisions are never re-run on replay.
//
// See docs/MULTIPLAYER.md.

import { Game } from '../../docs/js/engine/Game.js';
import { Rules } from '../../docs/js/engine/Rules.js';
import { TileSet } from '../../docs/js/engine/TileSet.js';
import { SmartAI } from '../../docs/js/ai/SmartAI.js';
import { HandTracker } from '../../docs/js/ai/HandTracker.js';
import { PlayerView } from '../../docs/js/ai/PlayerView.js';

export const MAX_NAME = 12;
export const DISCONNECT_GRACE_MS = 60_000;
export const LEVELS = ['beginner', 'experienced', 'master']; // the app's level names
const DEFAULT_LEVEL = 'experienced';

const TILE_BY_KEY = new Map(TileSet.create().map(t => [t.toKey(), t]));
const tileOf = (key) => TILE_BY_KEY.get(key);

/** Trim a display name to printable text, max 12 characters. */
export function cleanName(name) {
    const s = String(name ?? '').replace(/[\u0000-\u001f\u007f<>]/g, '').trim().slice(0, MAX_NAME);
    return s || 'Player';
}

export class RoomEngine {
    /**
     * @param {object} opts
     * @param {string} opts.code - room code
     * @param {() => number} [opts.now] - clock (injectable for tests)
     * @param {() => string} [opts.newToken] - secret generator (injectable for tests)
     */
    constructor({ code, now = () => Date.now(), newToken = defaultToken } = {}) {
        this.now = now;
        this.newToken = newToken;
        this.meta = {
            code,
            createdAt: now(),
            hostId: null,
            nextPlayerNum: 1,
            players: {},                   // playerId → { token, name, seat, connected, disconnectedAt }
            seats: [0, 1, 2, 3].map(() => ({ kind: 'open', playerId: null, level: DEFAULT_LEVEL, replacedFrom: null })),
            phase: 'lobby',                // lobby | playing | handOver | matchOver
            matchNumber: 0,
            deals: [],                     // per hand: 28 tile keys in deal order
            log: [],                       // per action: {h, seat, tile, end} | {h, seat, pass: true}
            ready: [],                     // playerIds ready for the next hand
            lastActivity: now(),
        };
        this.out = [];
        this.game = null;
    }

    // ------------------------------------------------------------------ persistence

    snapshot() {
        return JSON.parse(JSON.stringify(this.meta));
    }

    static fromSnapshot(meta, opts = {}) {
        const r = new RoomEngine({ code: meta.code, ...opts });
        r.meta = JSON.parse(JSON.stringify(meta));
        if (r.meta.phase !== 'lobby' && r.meta.deals.length) {
            const { phase, ready } = r.meta;
            r._rebuild();
            // The record is authoritative: replay's end-of-hand callbacks must not
            // change the saved phase, and their messages were already sent.
            r.meta.phase = phase;
            r.meta.ready = ready;
            r.out = [];
        }
        return r;
    }

    /** Rebuild the live game (and AI memory) by replaying the record. */
    _rebuild() {
        this._newGame();
        const { deals, log } = this.meta;
        let i = 0;
        for (let h = 0; h < deals.length; h++) {
            const tiles = deals[h].map(tileOf);
            if (h === 0) {
                this.game.newMatch(tiles);
                this._initTrackers();
            } else {
                this._startHand(tiles);
            }
            for (; i < log.length && log[i].h === h; i++) this._apply(log[i], { record: false });
        }
    }

    // ------------------------------------------------------------------ joining

    /**
     * A socket says hello. Reconnects with a known token; otherwise joins as new.
     * @returns {{playerId: string, token: string}}
     */
    connect({ name, token } = {}) {
        this.meta.lastActivity = this.now();
        let pid = token && Object.keys(this.meta.players).find(p => this.meta.players[p].token === token);
        if (pid) {
            const p = this.meta.players[pid];
            p.connected = true;
            p.disconnectedAt = null;
            if (name) p.name = cleanName(name);
            // A seat handed to the AI while you were away comes back to you.
            const back = this.meta.seats.findIndex(s => s.replacedFrom === pid);
            if (back !== -1 && p.seat === null) {
                Object.assign(this.meta.seats[back], { kind: 'human', playerId: pid, replacedFrom: null });
                p.seat = back;
                this._setDifficulties();
            }
            // Back in the lobby after a refresh: take the first open chair again.
            if (this.meta.phase === 'lobby' && p.seat === null) {
                const open = this.meta.seats.findIndex(s => s.kind === 'open');
                if (open !== -1) this._seat(pid, open);
            }
        } else {
            pid = `p${this.meta.nextPlayerNum++}`;
            this.meta.players[pid] = { token: this.newToken(), name: cleanName(name), seat: null, connected: true, disconnectedAt: null };
            if (!this.meta.hostId) this.meta.hostId = pid;
            // In the lobby, sit new players in the first open seat (they can move).
            if (this.meta.phase === 'lobby') {
                const open = this.meta.seats.findIndex(s => s.kind === 'open');
                if (open !== -1) this._seat(pid, open);
            }
        }
        this._fixHost();
        // Identity first, so the client knows which seat is its own when the lobby arrives.
        this.out.push({ to: pid, msg: { type: 'welcome', playerId: pid, token: this.meta.players[pid].token, code: this.meta.code } });
        this._emitLobby();
        if (this.meta.phase !== 'lobby') this._pushSync([pid]);
        return { playerId: pid, token: this.meta.players[pid].token };
    }

    disconnect(pid) {
        const p = this.meta.players[pid];
        if (!p) return;
        p.connected = false;
        p.disconnectedAt = this.now();
        this.meta.lastActivity = this.now();
        // In the lobby an empty chair is freed right away.
        if (this.meta.phase === 'lobby' && p.seat !== null) {
            Object.assign(this.meta.seats[p.seat], { kind: 'open', playerId: null });
            p.seat = null;
        }
        this._fixHost();
        this._maybeNextHand();
        this._emitLobby();
    }

    // ------------------------------------------------------------------ commands

    /** Handle one message from a player. Errors go back to that player only. */
    handle(pid, msg) {
        this.meta.lastActivity = this.now();
        const p = this.meta.players[pid];
        if (!p) return this._error(pid, 'unknown-player');
        const isHost = pid === this.meta.hostId;
        switch (msg?.type) {
            case 'takeSeat': {
                if (this.meta.phase !== 'lobby' && this.meta.phase !== 'matchOver') return this._error(pid, 'not-in-lobby');
                const s = this.meta.seats[msg.seat];
                if (!s || s.kind === 'human') return this._error(pid, 'seat-taken');
                if (p.seat !== null) Object.assign(this.meta.seats[p.seat], { kind: 'open', playerId: null });
                this._seat(pid, msg.seat);
                return this._emitLobby();
            }
            case 'setSeat': {
                if (!isHost) return this._error(pid, 'host-only');
                if (this.meta.phase !== 'lobby' && this.meta.phase !== 'matchOver') return this._error(pid, 'not-in-lobby');
                const s = this.meta.seats[msg.seat];
                if (!s || s.kind === 'human') return this._error(pid, 'seat-taken');
                if (msg.kind === 'open') s.kind = 'open';
                else if (msg.kind === 'ai' && LEVELS.includes(msg.level)) Object.assign(s, { kind: 'ai', level: msg.level });
                else return this._error(pid, 'bad-request');
                return this._emitLobby();
            }
            case 'start': {
                if (!isHost) return this._error(pid, 'host-only');
                if (this.meta.phase !== 'lobby' && this.meta.phase !== 'matchOver') return this._error(pid, 'already-playing');
                if (!this.meta.seats.some(s => s.kind === 'human')) return this._error(pid, 'no-humans');
                for (const s of this.meta.seats) if (s.kind === 'open') s.kind = 'ai';
                return this._startMatch();
            }
            case 'play':
            case 'pass': {
                if (this.meta.phase !== 'playing') return this._error(pid, 'not-playing');
                const state = this.game.getState();
                if (p.seat === null || state.currentPlayer !== p.seat) return this._error(pid, 'not-your-turn');
                const moves = Rules.getValidMoves(state.hands[p.seat], state.chain, state.isFirstHand && state.chain.isEmpty());
                if (msg.type === 'pass') {
                    if (moves.length) return this._error(pid, 'must-play');
                    this._apply({ h: this._h(), seat: p.seat, pass: true });
                } else {
                    if (!moves.some(m => m.tile.toKey() === msg.tile && m.end === msg.end)) return this._error(pid, 'illegal-move');
                    this._apply({ h: this._h(), seat: p.seat, tile: msg.tile, end: msg.end });
                }
                return this._runAI();
            }
            case 'ready': {
                if (this.meta.phase !== 'handOver') return;
                if (!this.meta.ready.includes(pid)) this.meta.ready.push(pid);
                this._maybeNextHand();
                return this._emitLobby();
            }
            case 'replaceWithAI': {
                if (!isHost) return this._error(pid, 'host-only');
                const s = this.meta.seats[msg.seat];
                const away = s && s.kind === 'human' ? this.meta.players[s.playerId] : null;
                if (!away || away.connected || this.now() - away.disconnectedAt < DISCONNECT_GRACE_MS) return this._error(pid, 'cannot-replace');
                Object.assign(s, { kind: 'ai', replacedFrom: s.playerId, playerId: null });
                away.seat = null;
                this.meta.ready = this.meta.ready.filter(r => r !== s.replacedFrom);
                this._setDifficulties();
                this._emitLobby();
                this._maybeNextHand();
                return this._runAI();
            }
            default:
                return this._error(pid, 'bad-request');
        }
    }

    // ------------------------------------------------------------------ views

    /** Everything one player may see right now (sent on (re)connect and each new hand). */
    syncFor(pid) {
        const p = this.meta.players[pid];
        const base = { type: 'sync', phase: this.meta.phase, lobby: this._lobbyView(), you: { playerId: pid, seat: p?.seat ?? null } };
        if (!this.game) return base;
        const s = this.game.getState();
        const h = this._h();
        const plays = this.meta.log.filter(a => a.h === h).map(a => (a.pass ? { seat: a.seat, pass: true } : { seat: a.seat, tile: a.tile, end: a.end }));
        return {
            ...base,
            handNumber: h + 1,
            isFirstHand: h === 0,
            starter: this.game.getMatchHistory().currentHand?.startingPlayer ?? null,
            plays,                                                  // public: this hand's plays/passes in order
            yourHand: p?.seat != null ? s.hands[p.seat].getTiles().map(t => t.toKey()) : [],
            counts: s.hands.map(x => x.size()),
            currentPlayer: s.currentPlayer,
            matchScores: [...s.scores.match],
            lastHand: this.meta.phase === 'handOver' || this.meta.phase === 'matchOver' ? this._lastHandEnd : null,
        };
    }

    // ------------------------------------------------------------------ internals

    _h() { return this.meta.deals.length - 1; }

    _seat(pid, seat) {
        Object.assign(this.meta.seats[seat], { kind: 'human', playerId: pid, replacedFrom: null });
        this.meta.players[pid].seat = seat;
    }

    _fixHost() {
        const host = this.meta.players[this.meta.hostId];
        if (host && host.connected) return;
        // Hand host duties to the longest-joined connected player.
        const next = Object.keys(this.meta.players).find(id => this.meta.players[id].connected);
        if (next) this.meta.hostId = next;
    }

    _lobbyView() {
        return {
            code: this.meta.code,
            host: this.meta.hostId,
            phase: this.meta.phase,
            seats: this.meta.seats.map(s => {
                const pl = s.playerId ? this.meta.players[s.playerId] : null;
                const away = pl && !pl.connected;
                return {
                    kind: s.kind, level: s.level,
                    playerId: s.playerId, name: pl?.name ?? null,
                    connected: pl ? pl.connected : null,
                    // The host may hand this seat to the AI (server clock decides).
                    replaceable: Boolean(away && this.meta.phase !== 'lobby'
                        && this.now() - pl.disconnectedAt >= DISCONNECT_GRACE_MS),
                };
            }),
            ready: [...this.meta.ready],
        };
    }

    _emitLobby() { this.out.push({ to: 'all', msg: { type: 'lobby', lobby: this._lobbyView() } }); }

    /**
     * Queue each player's view as of NOW. Built eagerly: if it were built at delivery
     * time it could already include AI plays that are also queued as 'played' events,
     * and the client would apply them twice.
     */
    _pushSync(pids = Object.keys(this.meta.players)) {
        for (const pid of pids) this.out.push({ to: pid, msg: this.syncFor(pid) });
    }
    _error(pid, code) { this.out.push({ to: pid, msg: { type: 'error', code } }); }

    _newGame() {
        const game = new Game();
        const ai = new SmartAI();
        const ht = new HandTracker();
        ai.setHandTracker(ht);
        const views = [0, 1, 2, 3].map(i => new PlayerView(i, ht));
        ai.setPlayerViews(views);
        game.onPlay = (d) => {
            const l = d.openEndsBefore?.left ?? null, r = d.openEndsBefore?.right ?? null;
            ai.recordPlay(d.player, d.tile, d.end, l, r);
            ht.recordPlay(d.player, d.tile);
            for (const v of views) v.recordPlayObservation(d.player, d.tile, d.end, l, r);
        };
        game.onPass = (d) => {
            const s = game.getState();
            ai.recordPass(d.player, s.chain.leftEnd, s.chain.rightEnd);
            ht.recordPass(d.player, s.chain.leftEnd, s.chain.rightEnd);
        };
        game.onHandEnd = (d) => {
            const s = game.getState();
            this._lastHandEnd = {
                reason: d.reason, dominoPlayer: d.dominoPlayer, closingPlayer: d.closingPlayer,
                winningTeam: d.winningTeam, points: d.points, matchScores: d.matchScores,
                isMatchEnding: d.isMatchEnding,
                hands: s.hands.map(x => x.getTiles().map(t => t.toKey())), // revealed, as in single player
            };
            this.meta.phase = d.isMatchEnding ? 'matchOver' : 'handOver';
            this.meta.ready = [];
            this.out.push({ to: 'all', msg: { type: 'handEnd', ...this._lastHandEnd } });
        };
        game.onMatchEnd = (d) => {
            this.meta.phase = 'matchOver';
            this.out.push({ to: 'all', msg: { type: 'matchEnd', winner: d.winner, finalScores: d.finalScores, reason: d.reason } });
        };
        this.game = game;
        this.ai = ai;
        this.ht = ht;
        this.views = views;
        this._setDifficulties();
    }

    _setDifficulties() {
        if (!this.ai) return;
        this.meta.seats.forEach((s, i) => {
            const level = s.kind === 'ai' ? s.level : 'master';
            this.ai.setDifficulty(i, level);
            this.ai.randomizeTolerance[i] = level === 'master' ? 5 : 0; // as in single player
        });
    }

    /** Fresh trackers for a new hand (mirrors main.js / the harness). */
    _initTrackers() {
        const s = this.game.getState();
        this.ht.initHand(s.hands[0]);
        for (let i = 0; i < 4; i++) {
            this.views[i].resetAffinities();
            this.views[i].initOwnHand(s.hands[i]);
        }
    }

    _startHand(tiles) {
        this.ai.resetForNewHand();
        this.game.newHand(tiles);
        this._initTrackers();
    }

    _startMatch() {
        this.meta.matchNumber++;
        this.meta.deals = [];
        this.meta.log = [];
        this.meta.ready = [];
        this._newGame();
        const tiles = TileSet.createShuffled();
        this.meta.deals.push(tiles.map(t => t.toKey()));
        this.meta.phase = 'playing';
        this.game.newMatch(tiles);
        this._initTrackers();
        this._emitLobby();
        this._pushSync();
        this._runAI();
    }

    _maybeNextHand() {
        if (this.meta.phase !== 'handOver') return;
        const present = this.meta.seats.filter(s => s.kind === 'human' && this.meta.players[s.playerId]?.connected);
        // Deal only when every connected human is ready — and at least one is here.
        if (present.length === 0 || present.some(s => !this.meta.ready.includes(s.playerId))) return;
        const tiles = TileSet.createShuffled();
        this.meta.deals.push(tiles.map(t => t.toKey()));
        this.meta.ready = [];
        this.meta.phase = 'playing';
        this._startHand(tiles);
        this._pushSync();
        this._runAI();
    }

    /** Apply one recorded action to the live game; optionally append it to the record. */
    _apply(action, { record = true } = {}) {
        if (record) this.meta.log.push(action);
        const s = this.game.getState();
        if (action.pass) {
            this.game.pass();
            if (record) this.out.push({ to: 'all', msg: { type: 'passed', seat: action.seat } });
        } else {
            const tile = s.hands[action.seat].getTiles().find(t => t.toKey() === action.tile);
            this.game.playTurn(tile, action.end, {});
            if (record) this.out.push({ to: 'all', msg: { type: 'played', seat: action.seat, tile: action.tile, end: action.end } });
        }
    }

    /** Let AI seats move until it's a human's turn or the hand ends. */
    _runAI() {
        for (let guard = 0; guard < 200 && this.meta.phase === 'playing'; guard++) {
            const s = this.game.getState();
            const seat = this.meta.seats[s.currentPlayer];
            if (seat.kind !== 'ai') break;
            const mv = this.ai.chooseMove(s, s.currentPlayer);
            if (mv === null) this._apply({ h: this._h(), seat: s.currentPlayer, pass: true });
            else this._apply({ h: this._h(), seat: s.currentPlayer, tile: mv.tile.toKey(), end: mv.end });
        }
        // A human with no legal move passes automatically, so nobody waits on a
        // forced pass (single player asks you to tap Pass instead).
        if (this.meta.phase === 'playing') {
            const s = this.game.getState();
            const seat = this.meta.seats[s.currentPlayer];
            const moves = Rules.getValidMoves(s.hands[s.currentPlayer], s.chain, s.isFirstHand && s.chain.isEmpty());
            if (seat.kind === 'human' && moves.length === 0) {
                this._apply({ h: this._h(), seat: s.currentPlayer, pass: true });
                return this._runAI();
            }
        }
    }

    /**
     * When the room next needs waking (a disconnected player's grace period
     * ending, so the host can be offered "give seat to AI"), or null.
     */
    nextWakeup() {
        if (this.meta.phase === 'lobby') return null;
        const due = this.meta.seats
            .map(s => (s.kind === 'human' ? this.meta.players[s.playerId] : null))
            .filter(p => p && !p.connected)
            .map(p => p.disconnectedAt + DISCONNECT_GRACE_MS)
            .filter(t => t > this.now());
        return due.length ? Math.min(...due) : null;
    }

    /** Clock tick from an alarm: refresh the lobby so "replaceable" flags appear. */
    tick() {
        this._emitLobby();
    }

    /** Take and clear the pending outputs. */
    drain() {
        const o = this.out;
        this.out = [];
        return o;
    }
}

function defaultToken() {
    const b = new Uint8Array(16);
    crypto.getRandomValues(b);
    return [...b].map(x => x.toString(16).padStart(2, '0')).join('');
}

