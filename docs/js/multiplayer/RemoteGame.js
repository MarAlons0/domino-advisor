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
// - Genín's analysis of your move (computed in your browser before you send it)
//   is attached when the server confirms it, kept through a reconnect, and saved
//   so a reload keeps the whole match's coaching (MatchHistoryStore).
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
    // Genín's search copies the state before re-sampling hidden hands; a copy must
    // keep the size, or a hidden seat would look like it had dominoed.
    clone() { return new HiddenHand(this.count); }
}

/**
 * "What closing would have scored" needs every hand's pips at the moment you could
 * close, but in multiplayer the other hands are hidden until the hand ends. Once
 * they're revealed: the pips a seat held before play i = its final pips + the pips
 * of every tile it played from i on. Fills myRemaining / oppRemaining /
 * scoreIfClosed of each closeOutcome, by the same rule as SmartAI.analyzeHumanTurn.
 * @param {object[]} plays - the hand's play records (local seats; you are 0)
 * @param {number[]} finalPips - each local seat's pips at the end of the hand
 */
export function settleCloseOutcomes(plays, finalPips) {
    const later = [0, 0, 0, 0];
    for (let i = plays.length - 1; i >= 0; i--) {
        const p = plays[i];
        if (p.tile) later[p.player] += p.tile.pipCount();
        const co = p.turnAnalysis?.closeOutcome;
        if (!co || co.closeTilePips === undefined) continue;
        const held = finalPips.map((pips, seat) => pips + later[seat]);
        co.myRemaining = held[0] + held[2] - co.closeTilePips;
        co.oppRemaining = held[1] + held[3];
        co.scoreIfClosed = co.myRemaining <= co.oppRemaining ? co.oppRemaining : -co.myRemaining;
    }
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
        this.pendingMeta = null;   // Genín's analysis of that move, until the echo
        this.matchNumber = null;   // the room's match this history belongs to
        this.store = null;         // MatchHistoryStore (set by the session)
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

    /** @param {object} [options] - {aiRecommendation, turnAnalysis}, as for Game.playTurn */
    playTurn(tile, end, options = {}) {
        if (!this.isHumanTurn()) return false;
        this.pending = true;
        this.pendingMeta = {
            tile: tile.toKey(), end,
            aiRecommendation: options.aiRecommendation || null,
            turnAnalysis: options.turnAnalysis || null,
        };
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
                this.pendingMeta = null;
                this.onError?.(msg.code);
                return this._changed();
        }
    }

    _sync(msg) {
        if (msg.you.seat === null || msg.handNumber === undefined) return; // lobby / watching
        this.mySeat = msg.you.seat;
        this.seatKinds = msg.lobby.seats.map(s => s.kind);
        this.pending = false;
        // First sync of this match on this page: bring back the coaching record
        // saved before a reload (the room only knows the public plays).
        if (msg.matchNumber !== undefined && msg.matchNumber !== this.matchNumber) {
            this.matchNumber = msg.matchNumber;
            const hands = this.store?.load(msg.matchNumber, this.mySeat);
            if (hands?.length) {
                this.matchHistory.hands = hands;
                this.matchHistory.currentHand = hands[hands.length - 1];
            } else {
                this.matchHistory.reset();
            }
        }
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
        // A hand start resets history; a reconnect mid-hand rebuilds it, keeping
        // Genín's analysis of your plays already made.
        let before = [];
        if (!this.matchHistory.currentHand || this.matchHistory.currentHand.handNumber !== msg.handNumber) {
            this.matchHistory.startHand(msg.handNumber, starter);
        } else {
            before = this.matchHistory.currentHand.plays;
            this.matchHistory.currentHand.plays = [];
        }
        s.gamePhase = 'playing';
        // Replay this hand's public plays (reconnect); your own played tiles are
        // already gone from yourHand, so don't remove them twice.
        msg.plays.forEach((p, i) => (p.pass
            ? this._passed(p, { replay: true })
            : this._played(p, { replay: true, meta: this._keptMeta(before[i], p) })));
        this.pendingMeta = null;
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

    /** Genín's analysis to keep for a replayed play of yours, if it is the same move. @private */
    _keptMeta(prev, p) {
        if (this.toLocal(p.seat) !== 0) return null;
        if (prev && prev.player === 0 && prev.tile && prev.tile.toKey() === p.tile && prev.end === p.end) return prev;
        // Sent just before the connection dropped, and the room applied it.
        const m = this.pendingMeta;
        return m && m.tile === p.tile && m.end === p.end ? m : null;
    }

    _played(msg, { replay = false, meta = null } = {}) {
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
        if (local === 0 && !replay) {
            meta = this.pendingMeta?.tile === msg.tile ? this.pendingMeta : null;
            this.pendingMeta = null;
        }
        this.matchHistory.recordPlay({
            player: local, tile, end: msg.end, stateSnapshot: snapshot, isHuman: local === 0,
            aiRecommendation: meta?.aiRecommendation || null, turnAnalysis: meta?.turnAnalysis || null,
        });
        if (local === 0) this.pending = false;
        if (local === 0 && !replay) this._save();
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
        this._settleCloseOutcomes();
        this.matchHistory.endHand({
            reason: msg.reason, winner: winningTeam, points: msg.points,
            finalHands: s.hands.map(h => ({ tiles: h.getTiles().map(t => t.toString()), pipCount: h.pipCount() })),
        });
        this._save();
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

    /** Closing pips can be settled now that every hand is revealed. @private */
    _settleCloseOutcomes() {
        settleCloseOutcomes(this.matchHistory.currentHand?.plays || [], this.state.hands.map(h => h.pipCount()));
    }

    _save() {
        if (this.matchNumber !== null) this.store?.save(this.matchNumber, this.mySeat, this.matchHistory);
    }

    _changed() { this.onStateChange?.(this.state); }
}
