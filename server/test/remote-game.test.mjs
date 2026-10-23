// RemoteGame (browser client adapter) against the real RoomEngine: two clients at
// different seats must each reproduce the server's game exactly, rotated so they
// sit at local seat 0, without ever holding another player's tiles mid-hand.
import test from 'node:test';
import assert from 'node:assert/strict';
import { RoomEngine } from '../src/RoomEngine.js';
import { RemoteGame } from '../../docs/js/multiplayer/RemoteGame.js';

async function settle(clients) { // let paced AI moves drain (AI delay shortened below)
    for (let i = 0; i < 400 && clients.some(c => c.queue.length || c.running); i++) await new Promise(r => setTimeout(r, 2));
}

test('two RemoteGames mirror the server, rotated, through a full match', async () => {
    const room = new RoomEngine({ code: 'RG' });
    const clients = {};
    const route = () => { for (const o of room.drain()) for (const [pid, c] of Object.entries(clients)) if (o.to === 'all' || o.to === pid) c.receive(o.msg); };
    const join = (name) => { const r = room.connect({ name }); const g = new RemoteGame(); g.send = (m) => { room.handle(r.playerId, m); route(); }; clients[r.playerId] = g; route(); return { pid: r.playerId, g }; };
    const A = join('Ana'), B = join('Ben');
    room.handle(A.pid, { type: 'takeSeat', seat: 3 }); route();          // Ana at server seat 3, Ben at 1
    room.handle(A.pid, { type: 'setSeat', seat: 0, kind: 'ai', level: 'beginner' }); route();
    room.handle(A.pid, { type: 'setSeat', seat: 2, kind: 'ai', level: 'beginner' }); route();
    room.handle(A.pid, { type: 'start' }); route();
    let checks = 0, hands = 0;
    for (let step = 0; step < 4000; step++) {
        await settle(Object.values(clients));
        const s = room.game?.getState();
        if (room.meta.phase === 'matchOver') break;
        for (const { pid, g } of [A, B]) {
            const seat = room.meta.players[pid].seat;
            const gs = g.getState();
            if (room.meta.phase === 'playing') {
                // Mirror check: chain, my hand, counts, turn — rotated.
                assert.equal(gs.chain.toString().replace(/\s/g, ''), s.chain.toString().replace(/\s/g, ''));
                assert.deepEqual(gs.hands[0].getTiles().map(t => t.toKey()).sort(), s.hands[seat].getTiles().map(t => t.toKey()).sort());
                for (let l = 1; l < 4; l++) {
                    assert.equal(gs.hands[l].size(), s.hands[(l + seat) % 4].size());
                    assert.equal(gs.hands[l].getTiles().length, 0, "never holds other players' tiles mid-hand");
                }
                assert.equal(gs.currentPlayer, (s.currentPlayer - seat + 4) % 4);
                assert.deepEqual(gs.scores.match, [s.scores.match[seat % 2], s.scores.match[1 - seat % 2]]);
                checks++;
            }
        }
        if (room.meta.phase === 'handOver') { hands++; for (const { g } of [A, B]) g.newHand(); continue; }
        const mover = [A, B].find(x => x.g.isHumanTurn());
        if (mover) { const mv = mover.g.getValidMoves()[0]; mover.g.playTurn(mv.tile, mv.end); }
    }
    await settle(Object.values(clients));
    assert.equal(room.meta.phase, 'matchOver');
    for (const { g } of [A, B]) assert.equal(g.getState().gamePhase, 'matchOver');
    assert.ok(checks > 50, `${checks} mirror checks`);
});
