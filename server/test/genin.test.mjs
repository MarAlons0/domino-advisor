// Genín in multiplayer runs in each player's browser, which knows only its own
// hand, the public plays, and how many tiles the others hold (HiddenHand).
//  1. Same answers as single player: at every decision of a player in a room, a
//     Genín fed only what that browser knows must match — with the same random
//     seed — a Genín that sees the whole table (single player): advice, grading
//     search, win rates, reasons. The "what closing would have scored" figures,
//     which need everyone's pips, must match once settled from the revealed hands.
//  2. Genín's analysis of your plays is kept through a reconnect and a reload.
import test from 'node:test';
import assert from 'node:assert/strict';

// A tiny localStorage for MatchHistoryStore (set before the app modules load).
const mem = new Map();
globalThis.localStorage = {
    getItem: (k) => (mem.has(k) ? mem.get(k) : null), setItem: (k, v) => mem.set(k, String(v)),
    removeItem: (k) => mem.delete(k), key: (i) => [...mem.keys()][i] ?? null, get length() { return mem.size; },
};

const { RoomEngine } = await import('../src/RoomEngine.js');
const { RemoteGame, HiddenHand, settleCloseOutcomes } = await import('../../docs/js/multiplayer/RemoteGame.js');
const { MatchHistoryStore } = await import('../../docs/js/multiplayer/MatchHistoryStore.js');
const { SmartAI } = await import('../../docs/js/ai/SmartAI.js');
const { HandTracker } = await import('../../docs/js/ai/HandTracker.js');
const { PlayerView } = await import('../../docs/js/ai/PlayerView.js');
const { Hand } = await import('../../docs/js/models/Hand.js');
const { Game } = await import('../../docs/js/engine/Game.js');
const { Rules } = await import('../../docs/js/engine/Rules.js');
const { TileSet } = await import('../../docs/js/engine/TileSet.js');

const MATCHES = Number(process.env.GENIN_MATCHES || 3);
const realRandom = Math.random;
const seeded = (a) => () => { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; };
const withSeed = (seed, fn) => { Math.random = seeded(seed); try { return fn(); } finally { Math.random = realRandom; } };
const TILE = new Map(TileSet.create().map(t => [t.toKey(), t]));
const GROUND_TRUTH = ['myRemaining', 'oppRemaining', 'scoreIfClosed'];

/** A Genín wired like main.js; `hidden` = the multiplayer browser (others' hands unknown). */
function makeGenin(hidden) {
    const ai = new SmartAI(); const ht = new HandTracker(); ai.setHandTracker(ht);
    const views = [0, 1, 2, 3].map(i => new PlayerView(i, ht)); ai.setPlayerViews(views);
    return {
        ai,
        newHand(hands) {
            ai.resetForNewHand(); ht.initHand(hands[0]);
            views.forEach((v, i) => { v.resetAffinities(); v.initOwnHand(hidden && i ? new HiddenHand(7) : hands[i]); });
        },
        play(p, tile, end, l, r) { ai.recordPlay(p, tile, end, l, r); ht.recordPlay(p, tile); for (const v of views) v.recordPlayObservation(p, tile, end, l, r); },
        pass(p, l, r) { ai.recordPass(p, l, r); ht.recordPass(p, l, r); },
    };
}

const recSig = (r) => r && JSON.stringify([r.tile.toKey(), r.end, r.reasoning, r.score, r.move?.ismctsStats ?? null]);
function analysisSig(a) {
    const co = a.closeOutcome && Object.fromEntries(Object.entries(a.closeOutcome).filter(([k]) => !GROUND_TRUTH.includes(k)));
    return JSON.stringify({ ...a, closeOutcome: co });
}

test('Genín with only your information = Genín seeing the whole table', { timeout: 600000 }, async () => {
    let decisions = 0, winRates = 0, closes = 0;
    const mismatches = [];
    for (let m = 0; m < MATCHES; m++) {
        const room = new RoomEngine({ code: `G${m}` });
        const client = new RemoteGame();
        let pid;
        const route = () => { for (const o of room.drain()) if (o.to === 'all' || o.to === pid) client.receive(o.msg); };
        client.send = (msg) => { room.handle(pid, msg); route(); };
        pid = room.connect({ name: 'Ana' }).playerId;            // the creator sits at server seat 0 = local seat 0
        route();
        for (const seat of [1, 2, 3]) room.handle(pid, { type: 'setSeat', seat, kind: 'ai', level: 'beginner' });
        route();

        const full = makeGenin(false), mine = makeGenin(true);
        let fullByPlay = new Map();                               // play index → full Genín's analysis
        client.onNewHand = () => {
            // True dealt hands = what each seat holds now + what it already played this hand.
            const h = room.meta.deals.length - 1;
            const dealt = room.game.getState().hands.map(x => Hand.fromTiles(x.getTiles()));
            for (const a of room.meta.log) if (a.h === h && a.tile) dealt[a.seat].add(TILE.get(a.tile));
            full.newHand(dealt);
            mine.newHand([Hand.fromTiles(client.getState().hands[0].getTiles()), null, null, null]);
            fullByPlay = new Map();
        };
        client.onPlay = (d) => {
            const l = d.openEndsBefore?.left ?? null, r = d.openEndsBefore?.right ?? null;
            for (const g of [full, mine]) g.play(d.player, d.tile, d.end, l, r);
        };
        client.onPass = (d) => {
            const c = client.getState().chain;
            for (const g of [full, mine]) g.pass(d.player, c.leftEnd, c.rightEnd);
        };
        client.onHandEnd = () => {
            // RemoteGame has settled the closing figures from the revealed hands.
            // (Collected, not asserted here: RemoteGame catches errors thrown by callbacks.)
            // Every move arrives before the hand ends: played + revealed = all 28 tiles.
            const played = client.getMatchHistory().currentHand.plays.filter(p => p.tile).length;
            const held = client.getState().hands.reduce((n, h) => n + h.getTiles().length, 0);
            if (played + held !== 28) mismatches.push({ k: 'tiles at hand end', got: played + held, want: 28 });
            client.getMatchHistory().currentHand.plays.forEach((p, i) => {
                const truth = fullByPlay.get(i)?.closeOutcome;
                if (!truth) return;
                closes++;
                for (const k of GROUND_TRUTH) {
                    if (p.turnAnalysis.closeOutcome[k] !== truth[k]) mismatches.push({ k, got: p.turnAnalysis.closeOutcome[k], want: truth[k], i,
                        plays: client.getMatchHistory().currentHand.plays.map(q => `${q.player}:${q.tile ? q.tile.toKey() : 'pass'}`).join(' '),
                        final: client.getState().hands.map(h => h.getTiles().map(t => t.toKey()).join(',')).join(' | '), truth });
                }
            });
        };

        room.handle(pid, { type: 'start' }); route();
        for (let step = 0; step < 5000 && room.meta.phase !== 'matchOver'; step++) {
            if (room.meta.phase === 'handOver') { client.newHand(); continue; }
            if (!client.isHumanTurn()) { await new Promise(r => setTimeout(r, 0)); continue; }
            const truthState = room.game.getState();             // the server is waiting for us: same position
            const myState = client.getState();
            assert.ok(myState.hands.slice(1).every(h => h.getTiles().length === 0), 'the browser never holds others\' tiles');
            const moves = client.getValidMoves();
            const mv = moves[Math.floor(realRandom() * moves.length)];
            const seed = Math.floor(realRandom() * 1e9);
            // Advice (the bubble), then the grading analysis of the move actually played.
            const recFull = withSeed(seed, () => full.ai.getRecommendation(truthState, 0));
            const recMine = withSeed(seed, () => mine.ai.getRecommendation(myState, 0));
            assert.equal(recSig(recMine), recSig(recFull), 'advice');
            const aFull = withSeed(seed + 1, () => full.ai.analyzeHumanTurn(truthState, 0, mv, recFull?.move));
            const aMine = withSeed(seed + 1, () => mine.ai.analyzeHumanTurn(myState, 0, mv, recMine?.move));
            assert.equal(analysisSig(aMine), analysisSig(aFull), 'analysis');
            decisions++;
            if (aMine.recWinRate !== null) winRates++;
            const hand = client.getMatchHistory().currentHand, idx = hand.plays.length;
            fullByPlay.set(idx, aFull);
            client.playTurn(mv.tile, mv.end, { aiRecommendation: aMine.recommendation, turnAnalysis: aMine });
            // The room confirms at once here (and the AI seats reply), so our play is at idx.
            assert.equal(hand.plays[idx].turnAnalysis, aMine, 'your analysis is attached when the room confirms the play');
            assert.ok(hand.plays[idx].evaluation, 'graded');
        }
        assert.equal(room.meta.phase, 'matchOver');
    }
    console.log(`  ${decisions} decisions identical (${winRates} with simulated win rates); ${closes} closing figures settled`);
    assert.deepEqual(mismatches, [], 'closing figures');
    assert.ok(decisions > 30 && winRates > 5);
});

test('closing figures settled from revealed hands = live ground truth (single-player engine)', () => {
    let checked = 0;
    for (let m = 0; m < 40; m++) {
        const game = new Game(); const g = makeGenin(false);
        for (let i = 0; i < 4; i++) g.ai.setDifficulty(i, 'beginner');
        game.onPlay = (d) => g.play(d.player, d.tile, d.end, d.openEndsBefore?.left ?? null, d.openEndsBefore?.right ?? null);
        game.onPass = (d) => { const c = game.getState().chain; g.pass(d.player, c.leftEnd, c.rightEnd); };
        game.onHandEnd = () => {
            const plays = game.getMatchHistory().currentHand.plays;
            const truth = plays.map(p => p.turnAnalysis?.closeOutcome && { ...p.turnAnalysis.closeOutcome });
            for (const p of plays) if (p.turnAnalysis?.closeOutcome) for (const k of GROUND_TRUTH) p.turnAnalysis.closeOutcome[k] = null;
            settleCloseOutcomes(plays, game.getState().hands.map(h => h.pipCount()));
            plays.forEach((p, i) => { if (truth[i]) { checked++; for (const k of GROUND_TRUTH) assert.equal(p.turnAnalysis.closeOutcome[k], truth[i][k]); } });
        };
        let over = false; game.onMatchEnd = () => { over = true; };
        game.newMatch(); g.newHand(game.getState().hands);
        for (let t = 0; t < 20000 && !over; t++) {
            const s = game.getState();
            if (s.gamePhase === 'handOver') { game.newHand(); g.newHand(game.getState().hands); continue; }
            const moves = Rules.getValidMoves(s.hands[s.currentPlayer], s.chain, s.isFirstHand && s.chain.isEmpty());
            if (!moves.length) { game.pass(); continue; }
            const mv = moves[Math.floor(Math.random() * moves.length)];
            const opts = s.currentPlayer === 0 ? { turnAnalysis: g.ai.analyzeHumanTurn(s, 0, mv) } : {};
            game.playTurn(mv.tile, mv.end, opts);
        }
    }
    assert.ok(checked > 20, `${checked} closing figures checked`);
});

test("your analysis survives a lost connection and a reload; a rematch starts clean", async () => {
    mem.clear();
    const room = new RoomEngine({ code: 'KEEP' });
    const store = new MatchHistoryStore('KEEP');
    let client = new RemoteGame(); client.store = store;
    let pid, token;
    const route = () => { for (const o of room.drain()) if (o.to === 'all' || o.to === pid) client.receive(o.msg); };
    const attach = (g) => { g.send = (msg) => { room.handle(pid, msg); route(); }; };
    attach(client);
    ({ playerId: pid, token } = room.connect({ name: 'Ana' })); route();
    for (const seat of [1, 2, 3]) room.handle(pid, { type: 'setSeat', seat, kind: 'ai', level: 'beginner' });
    room.handle(pid, { type: 'start' }); route();

    let n = 0;
    const playOne = () => {
        const mv = client.getValidMoves()[0];
        client.playTurn(mv.tile, mv.end, { aiRecommendation: { tile: mv.tile, end: mv.end, reasoning: 'r', score: 1 }, turnAnalysis: { marker: ++n, closeOutcome: null } });
    };
    const markers = (g) => g.getMatchHistory().hands.flatMap(h => h.plays.filter(p => p.player === 0 && p.tile).map(p => p.turnAnalysis?.marker ?? null));
    const settleQueue = async () => { for (let i = 0; i < 50 && (client.queue.length || client.running); i++) await new Promise(r => setTimeout(r, 0)); };

    // Hand 1 to the end, then two plays into hand 2.
    for (let step = 0; step < 500; step++) {
        await settleQueue();
        if (room.meta.phase === 'handOver') { client.newHand(); continue; }
        const cur = client.getMatchHistory().currentHand;
        if (room.meta.phase === 'playing' && cur?.handNumber >= 2 && cur.plays.filter(p => p.player === 0 && p.tile).length >= 2) break;
        if (client.isHumanTurn()) playOne();
    }
    await settleQueue();
    const before = markers(client);
    assert.ok(before.length >= 3 && before.every(Boolean), `markers ${before}`);
    const handsBefore = client.getMatchHistory().hands.length;
    assert.ok(handsBefore >= 2);

    // Lost connection: the room re-sends the hand; your analysis stays on your plays.
    room.disconnect(pid);
    room.connect({ name: 'Ana', token }); route(); await settleQueue();
    assert.deepEqual(markers(client), before, 'kept through a reconnect');

    // Reload: a fresh page with the saved record.
    client = new RemoteGame(); client.store = new MatchHistoryStore('KEEP'); attach(client);
    room.disconnect(pid);
    room.connect({ name: 'Ana', token }); route(); await settleQueue();
    assert.deepEqual(markers(client), before, 'kept through a reload');
    const hand1 = client.getMatchHistory().hands[0];
    assert.ok(hand1.result && hand1.plays.some(p => p.evaluation), 'hand 1 restored with its result and grades');
    assert.equal(typeof hand1.plays.find(p => p.tile).tile.toKey, 'function', 'tiles come back as Tile objects');

    // A rematch (next match number) does not pick up this match's record.
    assert.equal(new MatchHistoryStore('KEEP').load(room.meta.matchNumber + 1, 0), null);
    // Saving another room's record drops this one (one room at a time).
    new MatchHistoryStore('OTHER').save(1, 0, client.getMatchHistory());
    assert.equal([...mem.keys()].filter(k => k.startsWith('7fichas_mp_history_')).length, 1);
});
