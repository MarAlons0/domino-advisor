// Multiplayer client stand-in for Game: the same slice of the interface main.js
// uses (getState, playTurn, pass, newHand, newMatch, getMatchHistory, the on…
// callbacks), driven by the room server instead of a local engine.
//
// - Seat rotation: you are always local seat 0 (bottom). Rotating keeps partners
//   opposite, so local team 0 is always your team.
// - Other players' hands are counts only (HiddenHand) until a hand ends, when the
//   server reveals every hand — exactly what single player shows at that moment.
// - Moves by AI seats are paced (AI_DELAY_MS) so people can follow the play.
// - Your own move is applied when the server confirms it (it is the authority).
//
// See docs/MULTIPLAYER.md.

import { GameState } from '../models/GameState.js';
import { MatchHistory } from '../models/MatchHistory.js';
import { Hand } from '../models/Hand.js';
import { Rules } from '../engine/Rules.js';
import { TileSet } from '../engine/TileSet.js';

const AI_DELAY_MS = (typeof window === 'undefined') ? 0 : 900; // no pacing outside a browser (tests)
const TILE_BY_KEY = new Map(TileSet.create().map(t => [t.toKey(), t]));
const tileOf = (key) => TILE_BY_KEY.get(key);

/** A hand whose tiles you can't see: only its size is known. */
export class HiddenHand extends Hand {
    constructor(count = 0) {
        super();
        this.count = count;
    }
    size() { return this.count; }
    isEmpty() { return this.count === 0; }
    getTiles() { return []; }
    pipCount() { return 0; }
}

function handOf(keys) {
    const h = new Hand();
    for (const k of keys) h.add(tileOf(k));
    return h;
}

export class RemoteGame {
    constructor() {
        this.state = new GameState();
        this.matchHistory = new MatchHistory();
        this.mySeat = 0;           // server seat of this player
        this.seatKinds = ['human', 'human', 'human', 'human']; // server seats, for pacing
        this.send = () => {};      // set by the session
        this.pending = false;      // our move sent, awaiting the server's echo
        this.queue = [];
        this.running = false;
        // Game-compatible callbacks (set by main.js)
        this.onStateChange = null;
        this.onPlay = null;
        this.onPass = null;
        this.onHandEnd = null;
        this.onMatchEnd = null;
        this.onError = null;
        // Multiplayer hooks
        this.onBeforePlay = null;  // (tile) before any play is applied — table effects
        this.onNewHand = null;     // ({handNumber, isFirstHand, starter, newMatch, resumed})
        this.onThinking = null;    // (localSeat | null) an AI seat is "thinking" (paced)
    }

    // ---- rotation: server seat ↔ local seat, server team ↔ local team
    toLocal(seat) { return (seat - this.mySeat + 4) % 4; }
    toServer(local) { return (local + this.mySeat) % 4; }
    localTeam(team) { return team < 0 ? team : (team - (this.mySeat % 2) + 2) % 2; }
    localScores(arr) { const m = this.mySeat % 2; return [arr[m], arr[1 - m]]; }

    // ---- Game interface used by main.js
    getState() { return this.state; }
    getMatchHistory() { return this.matchHistory; }

    getValidMoves() {
        const s = this.state;
        if (!this.isHumanTurn()) return []; // also while a move is in flight

        return Rules.getValidMoves(s.hands[0], s.chain, s.isFirstHand && s.chain.isEmpty());
    }

    /** The server passes for you automatically, so the Pass button never applies. */
    mustPass() { return false; }

    isHumanTurn() {
        return this.state.currentPlayer === 0 && this.state.gamePhase === 'playing'
            && !this.pending && !this.running && this.queue.length === 0;
    }

    playTurn(tile, end) {
        if (!this.isHumanTurn()) return false;
        this.pending = true;
        this.send({ type: 'play', tile: tile.toKey(), end });
        return true;
    }

    pass() { this.send({ type: 'pass' }); return true; }

    /** "Continue" after a hand: tell the room you're ready for the next one. */
    newHand() { this.send({ type: 'ready' }); }

    /** "New match" (host): rematch with the same seats. */
    newMatch() { this.send({ type: 'start' }); }

    // ---- server messages (applied in order; AI moves paced)
    receive(msg) {
        this.queue.push(msg);
        if (!this.running) this._drain();
    }

    async _drain() {
        this.running = true;
        while (this.queue.length) {
            const msg = this.queue.shift();
            const remoteAI = (msg.type === 'played' || msg.type === 'passed')
                && msg.seat !== this.mySeat && this.seatKinds[msg.seat] === 'ai';
            if (remoteAI && AI_DELAY_MS) {
                this.onThinking?.(this.toLocal(msg.seat));
                await new Promise(r => setTimeout(r, AI_DELAY_MS));
                this.onThinking?.(null);
            }
            try { this._apply(msg); } catch (e) { console.error('Multiplayer: could not apply', msg, e); }
        }
        this.running = false;
        this._changed();
    }

    _apply(msg) {
        switch (msg.type) {
            case 'lobby':
                this.seatKinds = msg.lobby.seats.map(s => s.kind);
                break;
            case 'sync': return this._sync(msg);
            case 'played': return this._played(msg);
            case 'passed': return this._passed(msg);
            case 'handEnd': return this._handEnd(msg);
            case 'matchEnd':
                this.state.gamePhase = 'matchOver';
                this.onMatchEnd?.({ winner: this.localTeam(msg.winner), finalScores: this.localScores(msg.finalScores), reason: msg.reason });
                return this._changed();
            case 'error':
                this.pending = false;
                this.onError?.(msg.code);
                return this._changed();
        }
    }

    _sync(msg) {
        if (msg.you.seat === null || msg.handNumber === undefined) return; // lobby / watching
        this.mySeat = msg.you.seat;
        this.seatKinds = msg.lobby.seats.map(s => s.kind);
        this.pending = false;
        const s = this.state;
        if (msg.handNumber === 1 && msg.plays.length === 0) {
            s.resetForNewMatch();
            this.matchHistory.reset();
        } else {
            s.resetForNewHand();
        }
        s.isFirstHand = msg.isFirstHand;
        s.scores.match = this.localScores(msg.matchScores);
        // Hands: yours in full, the others as counts (as dealt).
        s.hands = [0, 1, 2, 3].map(l => (l === 0 ? handOf(msg.yourHand) : new HiddenHand(7)));
        const starter = this.toLocal(msg.starter);
        s.currentPlayer = starter;
        // A hand start resets history; a reconnect mid-hand rebuilds it.
        if (!this.matchHistory.currentHand || this.matchHistory.currentHand.handNumber !== msg.handNumber) {
            this.matchHistory.startHand(msg.handNumber, starter);
        } else {
            this.matchHistory.currentHand.plays = [];
        }
        s.gamePhase = 'playing';
        // Replay this hand's public plays (reconnect); your own played tiles are
        // already gone from yourHand, so don't remove them twice.
        for (const p of msg.plays) (p.pass ? this._passed(p, { replay: true }) : this._played(p, { replay: true }));
        s.hands.forEach((h, l) => { if (l !== 0) h.count = msg.counts[this.toServer(l)]; });
        s.currentPlayer = this.toLocal(msg.currentPlayer);
        s.gamePhase = msg.phase === 'playing' ? 'playing' : msg.phase;
        this.onNewHand?.({ handNumber: msg.handNumber, isFirstHand: msg.isFirstHand, starter, newMatch: msg.handNumber === 1 && msg.plays.length === 0, resumed: msg.plays.length > 0 });
        this._changed();
    }

    _snapshot() {
        const s = this.state;
        return {
            chainSize: s.chain.size(), leftEnd: s.chain.leftEnd, rightEnd: s.chain.rightEnd,
            handSizes: s.hands.map(h => h.size()), matchScores: [...s.scores.match],
            consecutivePasses: s.consecutivePasses,
        };
    }

    _played(msg, { replay = false } = {}) {
        const s = this.state;
        const local = this.toLocal(msg.seat);
        const tile = tileOf(msg.tile);
        s.currentPlayer = local;
        if (!replay) this.onBeforePlay?.(tile);
        const wasEmpty = s.chain.isEmpty();
        const openEndsBefore = wasEmpty ? null : { left: s.chain.leftEnd, right: s.chain.rightEnd };
        const snapshot = this._snapshot();
        if (local === 0) { if (!replay) s.hands[0].remove(tile); }
        else s.hands[local].count = Math.max(0, s.hands[local].count - 1);
        s.chain.play(tile, msg.end, local);
        s.recordPlay(tile, msg.end);
        this.matchHistory.recordPlay({ player: local, tile, end: msg.end, stateSnapshot: snapshot, isHuman: local === 0 });
        if (local === 0) this.pending = false;
        s.currentPlayer = (local + 1) % 4;
        if (!replay) {
            this.onPlay?.({ player: local, tile, end: msg.end, chain: s.chain.toString(), openEndsBefore, reasoning: null });
            this._changed();
        }
    }

    _passed(msg, { replay = false } = {}) {
        const s = this.state;
        const local = this.toLocal(msg.seat);
        s.currentPlayer = local;
        s.recordPass();
        this.matchHistory.recordPlay({ player: local, tile: null, end: null, stateSnapshot: this._snapshot(), isHuman: local === 0 });
        s.currentPlayer = (local + 1) % 4;
        if (!replay) {
            this.onPass?.({ player: local, consecutivePasses: s.consecutivePasses });
            this._changed();
        }
    }

    _handEnd(msg) {
        const s = this.state;
        // Reveal every hand before announcing the end (the hand-end modal lists them).
        s.hands = [0, 1, 2, 3].map(l => handOf(msg.hands[this.toServer(l)]));
        s.scores.match = this.localScores(msg.matchScores);
        s.gamePhase = msg.isMatchEnding ? 'matchOver' : 'handOver';
        s.isFirstHand = false;
        const winningTeam = this.localTeam(msg.winningTeam);
        if (winningTeam >= 0) s.scores.hand[winningTeam] = msg.points;
        this.matchHistory.endHand({
            reason: msg.reason, winner: winningTeam, points: msg.points,
            finalHands: s.hands.map(h => ({ tiles: h.getTiles().map(t => t.toString()), pipCount: h.pipCount() })),
        });
        this.onHandEnd?.({
            reason: msg.reason,
            dominoPlayer: msg.dominoPlayer == null ? null : this.toLocal(msg.dominoPlayer),
            closingPlayer: msg.closingPlayer == null ? null : this.toLocal(msg.closingPlayer),
            winningTeam, points: msg.points,
            matchScores: this.localScores(msg.matchScores),
            isMatchEnding: msg.isMatchEnding,
        });
        this._changed();
    }

    _changed() { this.onStateChange?.(this.state); }
}
