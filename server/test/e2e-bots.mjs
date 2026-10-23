// End-to-end over real WebSockets: node server/test/e2e-bots.mjs http://localhost:8798
// Creates a room, joins 2 bot players (2 AI seats), plays a full match, and checks
// that a player who drops mid-hand reconnects with their token into the same seat.
import { Chain } from '../../docs/js/models/Chain.js';
import { Hand } from '../../docs/js/models/Hand.js';
import { Rules } from '../../docs/js/engine/Rules.js';
import { TileSet } from '../../docs/js/engine/TileSet.js';

const BASE = (process.argv[2] || 'http://localhost:8798').replace(/\/$/, '');
const TILE = new Map(TileSet.create().map(t => [t.toKey(), t]));
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

class NetBot {
    constructor(name, code) { Object.assign(this, { name, code, hand: [], plays: [], turn: null, seat: null, phase: null, firstHand: false, errors: [], handEnds: 0, token: null, pid: null }); }
    open() {
        return new Promise((resolve, reject) => {
            this.ws = new WebSocket(`${BASE.replace(/^http/, 'ws')}/rooms/${this.code}/ws`);
            this.ws.onopen = () => { this.ws.send(JSON.stringify({ type: 'hello', name: this.name, token: this.token })); };
            this.ws.onmessage = (e) => { this.receive(JSON.parse(e.data)); if (this.pid) resolve(); };
            this.ws.onerror = (e) => reject(new Error(`${this.name} socket error`));
        });
    }
    send(m) { this.ws.send(JSON.stringify(m)); }
    receive(msg) {
        switch (msg.type) {
            case 'welcome': this.pid = msg.playerId; this.token = msg.token; break;
            case 'lobby': this.lobby = msg.lobby; if (msg.lobby.phase === 'lobby') this.phase = 'lobby';
                { const i = msg.lobby.seats.findIndex(s => s.playerId === this.pid); this.seat = i === -1 ? this.seat : i; } break;
            case 'sync': this.phase = msg.phase; this.seat = msg.you.seat;
                if (msg.yourHand) { this.hand = msg.yourHand.slice(); this.plays = msg.plays.slice(); this.turn = msg.currentPlayer; this.firstHand = msg.isFirstHand; }
                this.synced = (this.synced || 0) + 1; break;
            case 'played': this.plays.push(msg); if (msg.seat === this.seat) this.hand = this.hand.filter(k => k !== msg.tile); this.turn = (msg.seat + 1) % 4; break;
            case 'passed': this.plays.push({ seat: msg.seat, pass: true }); this.turn = (msg.seat + 1) % 4; break;
            case 'handEnd': this.handEnds++; this.phase = msg.isMatchEnding ? 'matchOver' : 'handOver'; this.sentReady = false; break;
            case 'matchEnd': this.phase = 'matchOver'; this.matchEnd = msg; break;
            case 'error': this.errors.push(msg.code); break;
        }
    }
    act() {
        if (this.phase === 'handOver' && !this.sentReady) { this.sentReady = true; this.send({ type: 'ready' }); return true; }
        if (this.phase !== 'playing' || this.turn !== this.seat) return false;
        const hand = new Hand(); for (const k of this.hand) hand.add(TILE.get(k));
        const chain = new Chain(); for (const p of this.plays) if (p.tile) chain.play(TILE.get(p.tile), p.end, p.seat);
        const moves = Rules.getValidMoves(hand, chain, this.firstHand && chain.isEmpty());
        if (!moves.length) return false; // the server auto-passes
        const m = moves[Math.floor(Math.random() * moves.length)];
        this.turn = null; // wait for the server's echo
        this.send({ type: 'play', tile: m.tile.toKey(), end: m.end });
        return true;
    }
}

const t0 = Date.now();
const created = await (await fetch(`${BASE}/rooms`, { method: 'POST' })).json();
console.log('room', created.code);
const info = await (await fetch(`${BASE}/rooms/${created.code}/info`)).json();
console.log('info', JSON.stringify(info));
const a = new NetBot('Ana', created.code), b = new NetBot('Ben', created.code);
await a.open(); await b.open(); await sleep(200);
a.send({ type: 'setSeat', seat: 2, kind: 'ai', level: 'experienced' });
a.send({ type: 'setSeat', seat: 3, kind: 'ai', level: 'master' });
a.send({ type: 'start' });
await sleep(300);
console.log(`seats: Ana ${a.seat}, Ben ${b.seat}; phase ${a.phase}`);

let reconnected = false, steps = 0;
while (!(a.phase === 'matchOver' && b.phase === 'matchOver') && steps++ < 3000) {
    // Halfway through, Ben's connection drops mid-hand and comes back with his token.
    if (!reconnected && a.handEnds >= 1 && b.phase === 'playing' && b.plays.length > 3) {
        const seatBefore = b.seat, handBefore = b.hand.join();
        b.ws.close(); await sleep(300);
        b.pid = null; await b.open(); await sleep(300);
        console.log(`reconnect: seat ${seatBefore} → ${b.seat}, same hand: ${b.hand.join() === handBefore}, syncs ${b.synced}`);
        reconnected = true;
    }
    a.act(); b.act();
    await sleep(15);
}
console.log(`match over: ${a.phase === 'matchOver' && b.phase === 'matchOver'} | hands ${a.handEnds} | final ${a.matchEnd?.finalScores} | errors Ana ${a.errors} Ben ${b.errors} | ${((Date.now() - t0) / 1000).toFixed(1)} s`);
a.ws.close(); b.ws.close();
process.exit(a.matchEnd && b.matchEnd && !a.errors.length && !b.errors.length && reconnected ? 0 : 1);
