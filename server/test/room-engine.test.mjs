// RoomEngine tests: lobby, full matches driven by bot clients that only know what
// they are sent, secrecy of hands, save/replay, disconnects, host hand-off.
// Run: node --test server/test/
import test from 'node:test';
import assert from 'node:assert/strict';
import { RoomEngine, DISCONNECT_GRACE_MS, cleanName } from '../src/RoomEngine.js';
import { Chain } from '../../docs/js/models/Chain.js';
import { Hand } from '../../docs/js/models/Hand.js';
import { Rules } from '../../docs/js/engine/Rules.js';
import { TileSet } from '../../docs/js/engine/TileSet.js';

const TILE = new Map(TileSet.create().map(t => [t.toKey(), t]));

/** A client that only knows what the room sends it — like the browser will. */
class Bot {
    constructor(name) { Object.assign(this, { name, pid: null, token: null, seat: null, hand: [], plays: [], turn: null, phase: null, firstHand: false, errors: [], seen: new Set(), leaks: [], connected: true, handEnds: 0 }); }
    receive(msg) {
        switch (msg.type) {
            case 'welcome': this.pid = msg.playerId; this.token = msg.token; break;
            case 'lobby': this.phase = msg.lobby.phase; this.lobby = msg.lobby;
                this.seat = msg.lobby.seats.findIndex(s => s.playerId === this.pid); if (this.seat === -1) this.seat = null; break;
            case 'sync':
                this.phase = msg.phase; this.seat = msg.you.seat;
                if (msg.yourHand) {
                    this.hand = msg.yourHand.slice(); this.plays = msg.plays.slice(); this.turn = msg.currentPlayer; this.firstHand = msg.isFirstHand;
                    for (const k of this.hand) this.seen.add(k);
                    for (const p of this.plays) if (p.tile) this.seen.add(p.tile);
                }
                break;
            case 'played':
                this.plays.push(msg); this.seen.add(msg.tile);
                if (msg.seat === this.seat) this.hand = this.hand.filter(k => k !== msg.tile);
                this.turn = (msg.seat + 1) % 4; break;
            case 'passed': this.plays.push({ seat: msg.seat, pass: true }); this.turn = (msg.seat + 1) % 4; break;
            case 'handEnd': this.handEnds++; this.phase = msg.isMatchEnding ? 'matchOver' : 'handOver'; this.lastHandEnd = msg; break;
            case 'matchEnd': this.phase = 'matchOver'; this.matchEnd = msg; break;
            case 'error': this.errors.push(msg.code); break;
        }
        // Secrecy: outside a hand-end reveal, nothing names a tile I may not know.
        if (msg.type !== 'handEnd') {
            for (const k of tileKeysIn(msg)) if (!this.seen.has(k)) this.leaks.push(`${msg.type}:${k}`);
        }
    }
    chain() {
        const c = new Chain();
        for (const p of this.plays) if (p.tile) c.play(TILE.get(p.tile), p.end, p.seat);
        return c;
    }
    move() {
        if (this.phase !== 'playing' || this.turn !== this.seat) return null;
        const hand = new Hand(); for (const k of this.hand) hand.add(TILE.get(k));
        const chain = this.chain();
        const moves = Rules.getValidMoves(hand, chain, this.firstHand && chain.isEmpty());
        if (!moves.length) return { type: 'pass' };
        const m = moves[Math.floor(Math.random() * moves.length)];
        return { type: 'play', tile: m.tile.toKey(), end: m.end };
    }
}

function tileKeysIn(obj, acc = []) {
    if (typeof obj === 'string' && /^[0-6]-[0-6]$/.test(obj)) acc.push(obj);
    else if (Array.isArray(obj)) obj.forEach(x => tileKeysIn(x, acc));
    else if (obj && typeof obj === 'object') Object.values(obj).forEach(x => tileKeysIn(x, acc));
    return acc;
}

/** Wires an engine to bots, delivering outputs like the Durable Object does. */
class Table {
    constructor() { this.clock = 1_000_000; this.engine = new RoomEngine({ code: 'TEST42', now: () => this.clock }); this.bots = []; }
    deliver() {
        for (const o of this.engine.drain()) {
            const targets = o.to === 'all' ? this.bots.filter(b => b.connected && b.pid) : this.bots.filter(b => b.connected && b.pid === o.to);
            for (const b of targets) b.receive(o.msg);
        }
    }
    join(name) { const b = new Bot(name); this.bots.push(b); const r = this.engine.connect({ name }); b.pid = r.playerId; this.deliver(); return b; }
    send(b, msg) { this.engine.handle(b.pid, msg); this.deliver(); }
    reload() { this.engine = RoomEngine.fromSnapshot(this.engine.snapshot(), { now: () => this.clock }); }
    /** Humans act until the match ends (or a step limit). */
    playMatch({ reloadEvery = 0, maxSteps = 2000 } = {}) {
        let steps = 0;
        while (steps++ < maxSteps) {
            const live = this.bots.filter(b => b.connected);
            if (live.every(b => b.phase === 'matchOver')) return;
            let acted = false;
            for (const b of live) {
                const m = b.move();
                if (m) { this.send(b, m); acted = true; if (reloadEvery && steps % reloadEvery === 0) this.reload(); break; }
                if (b.phase === 'handOver' && !this.engine.meta.ready.includes(b.pid)) { this.send(b, { type: 'ready' }); acted = true; break; }
            }
            if (!acted) throw new Error(`stuck: phases ${live.map(b => b.phase)} turns ${live.map(b => b.turn)} seats ${live.map(b => b.seat)}`);
        }
        throw new Error(`match did not finish: ${this.bots.map(b => `${b.name} phase=${b.phase} seat=${b.seat} turn=${b.turn} hand=${b.hand.length} errors=${[...new Set(b.errors)]}`).join(' | ')} | engine phase=${this.engine.meta.phase} current=${this.engine.game?.getState().currentPlayer}`);
    }
}

test('cleanName trims and strips markup', () => {
    assert.equal(cleanName('  Ana  '), 'Ana');
    assert.equal(cleanName('<b>Bob</b>'), 'bBob/b');
    assert.equal(cleanName('x'.repeat(30)).length, 12);
    assert.equal(cleanName(''), 'Player');
});

test('lobby: seating, host-only controls, start fills open seats with AI', () => {
    const t = new Table();
    const ana = t.join('Ana'), ben = t.join('Ben');
    assert.equal(t.engine.meta.hostId, ana.pid);
    assert.deepEqual([ana.seat, ben.seat], [0, 1]);
    t.send(ben, { type: 'start' });
    assert.ok(ben.errors.includes('host-only'));
    t.send(ben, { type: 'takeSeat', seat: 2 });           // Ben moves to Ana's partner chair
    assert.equal(ben.seat, 2);
    t.send(ana, { type: 'setSeat', seat: 1, kind: 'ai', level: 'master' });
    t.send(ana, { type: 'start' });
    assert.equal(t.engine.meta.phase, 'playing');
    assert.deepEqual(t.engine.meta.seats.map(s => s.kind), ['human', 'ai', 'human', 'ai']);
    assert.equal(t.engine.meta.seats[1].level, 'master');
    assert.equal(t.engine.meta.seats[3].level, 'experienced');
});

test('full matches: 2 humans + 2 AI and 4 humans; hands stay secret', () => {
    for (const humans of [2, 4]) {
        const t = new Table();
        const bots = Array.from({ length: humans }, (_, i) => t.join(`H${i}`));
        for (let s = humans; s < 4; s++) t.send(bots[0], { type: 'setSeat', seat: s, kind: 'ai', level: 'beginner' });
        t.send(bots[0], { type: 'start' });
        t.playMatch();
        const fin = t.engine.game.getState().scores.match;
        assert.ok(Math.max(...fin) >= 100, `match ended at ${fin}`);
        for (const b of bots) {
            assert.deepEqual(b.leaks, [], `${b.name} saw hidden tiles`);
            assert.deepEqual(b.errors, [], `${b.name} errors`);
            assert.ok(b.matchEnd, `${b.name} got matchEnd`);
            assert.equal(b.handEnds, t.engine.meta.deals.length, 'every hand ended for every player');
        }
    }
});

test('save/replay: reloading mid-match changes nothing', () => {
    const t = new Table();
    const a = t.join('A'), b = t.join('B');
    t.send(a, { type: 'setSeat', seat: 2, kind: 'ai', level: 'experienced' });
    t.send(a, { type: 'start' });
    // Reload after every few human actions; views must match before/after each reload.
    let checks = 0;
    const orig = t.reload.bind(t);
    t.reload = () => {
        const before = t.bots.map(x => JSON.stringify(t.engine.syncFor(x.pid)));
        orig();
        const after = t.bots.map(x => JSON.stringify(t.engine.syncFor(x.pid)));
        assert.deepEqual(after, before, 'view changed across reload');
        checks++;
    };
    t.playMatch({ reloadEvery: 3 });
    assert.ok(checks > 5, `reloaded ${checks} times`);
    assert.deepEqual(a.leaks.concat(b.leaks), []);
});

test('disconnect: grace period, host gives seat to AI, player reclaims it', () => {
    const t = new Table();
    const host = t.join('Host'), away = t.join('Away');
    t.send(host, { type: 'start' });                          // seats 2,3 → AI
    away.connected = false; t.engine.disconnect(away.pid); t.deliver();
    t.send(host, { type: 'replaceWithAI', seat: away.seat });
    assert.ok(host.errors.includes('cannot-replace'), 'too early');
    t.clock += DISCONNECT_GRACE_MS;
    t.send(host, { type: 'replaceWithAI', seat: 1 });
    assert.equal(t.engine.meta.seats[1].kind, 'ai');
    // The match can continue with only the host acting.
    for (let i = 0; i < 60 && host.phase === 'playing'; i++) { const m = host.move(); if (!m) break; t.send(host, m); }
    // Reconnect with the saved token → seat comes back.
    away.connected = true;
    const r = t.engine.connect({ token: away.token }); t.deliver();
    assert.equal(r.playerId, away.pid);
    assert.equal(t.engine.meta.seats[1].kind, 'human');
    assert.equal(t.engine.players?.[away.pid]?.seat ?? t.engine.meta.players[away.pid].seat, 1);
});

test('host duties pass on when the host disconnects; errors for bad moves', () => {
    const t = new Table();
    const a = t.join('A'), b = t.join('B');
    t.send(a, { type: 'start' });
    // Whoever is not on turn tries to play → not-your-turn
    const idle = [a, b].find(x => x.turn !== x.seat);
    t.send(idle, { type: 'play', tile: idle.hand[0], end: 'left' });
    assert.ok(idle.errors.includes('not-your-turn'));
    a.connected = false; t.engine.disconnect(a.pid); t.deliver();
    assert.equal(t.engine.meta.hostId, b.pid);
});

test('soak: 25 matches, random seatings and AI levels, reload every 2 actions', () => {
    const levels = ['beginner', 'experienced', 'master'];
    let hands = 0, passes = 0, closed = 0;
    for (let m = 0; m < 25; m++) {
        const t = new Table();
        const humans = 1 + (m % 4);
        const bots = Array.from({ length: humans }, (_, i) => t.join(`H${i}`));
        // Shuffle chairs: humans move to random seats before AI fills the rest
        for (const b of bots) {
            const free = t.engine.meta.seats.map((s, i) => (s.kind !== 'human' ? i : -1)).filter(i => i >= 0);
            if (free.length && Math.random() < 0.5) t.send(b, { type: 'takeSeat', seat: free[Math.floor(Math.random() * free.length)] });
        }
        t.engine.meta.seats.forEach((s, i) => { if (s.kind !== 'human') t.send(bots[0], { type: 'setSeat', seat: i, kind: 'ai', level: levels[(m + i) % 3] }); });
        t.send(bots[0], { type: 'start' });
        t.playMatch({ reloadEvery: 2, maxSteps: 5000 });
        for (const b of bots) {
            assert.deepEqual(b.leaks, [], `match ${m}: ${b.name} saw hidden tiles`);
            assert.deepEqual(b.errors, [], `match ${m}: ${b.name} errors`);
        }
        hands += t.engine.meta.deals.length;
        passes += t.engine.meta.log.filter(a => a.pass).length;
        closed += t.bots[0].lastHandEnd?.reason === 'closed' ? 1 : 0;
    }
    assert.ok(hands > 100 && passes > 50, `coverage: ${hands} hands, ${passes} passes`);
});
