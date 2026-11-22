#!/usr/bin/env node
// Reads a 7 Fichas game-log export (Stats → Export my games) and prints how
// the human, seat 0, plays: the salidas they choose, whether the opponents
// cover the salida number, when they pass, and how often they play Genín's
// pick. Real numbers to set against the personas (tools/personas.js) and the
// matar-la-salida rule (docs/DESIGN.md 0l).
//
//   node tools/human-games.js <export.json>          report
//   node tools/human-games.js <export.json> --json   the same numbers as JSON
//
// Definitions
// - Salida: the first tile of a hand. The first hand of a match must open with
//   [6|6]; those salidas are forced and counted apart from the chosen ones.
// - Salida number S: a double's number. For another tile, the number you held
//   more other tiles of; on a tie the higher one (the AI's own convention,
//   SmartAI.playerSalida).
// - "More of S": other tiles of S in your starting hand, the salida not counted.
// - Longest number: the number on the most tiles of your starting hand (a
//   double counts once); a tie gives several longest numbers.
// - Showing: S is on at least one board end.

import { readFileSync } from 'node:fs';

const args = process.argv.slice(2);
const file = args.find(a => !a.startsWith('--'));
const asJson = args.includes('--json');
if (!file) {
    console.error('Usage: node tools/human-games.js <export.json> [--json]');
    process.exit(1);
}

const data = JSON.parse(readFileSync(file, 'utf8'));
if (data.kind !== 'game-logs' || !Array.isArray(data.matches)) {
    console.error(`${file} is not a 7 Fichas game-log export.`);
    process.exit(1);
}
if (data.format !== 1) console.warn(`Warning: export format ${data.format}; this reader knows format 1.`);

const F = Object.fromEntries((data.moveFields || ['seat', 'tile', 'end', 'leftEnd', 'rightEnd', 'coach']).map((f, i) => [f, i]));
const parse = (k) => k.split('-').map(Number);           // '6-4' → [6, 4]
const has = (k, v) => parse(k).includes(v);
const other = (k, v) => { const [a, b] = parse(k); return a === v ? b : a; };
const team = (seat) => seat % 2;

// ── Tallies ────────────────────────────────────────────────────────────────
const T = {
    matches: 0, matchesWon: 0, hands: 0, handsWon: 0, handsTied: 0, skippedHands: 0, endMismatches: 0,
    openedBy: [0, 0, 0, 0],
    openedWon: [0, 0, 0, 0],       // hands each seat opened that team 0 won
    salida: {
        chosen: 0, forced: 0, doubles: 0, wonChosen: 0,
        moreHist: [0, 0, 0, 0, 0, 0, 0],       // chosen salidas by "more of S"
        moreHistDouble: [0, 0, 0, 0, 0, 0, 0],
        moreHistOther: [0, 0, 0, 0, 0, 0, 0],
        sIsHigher: 0, nonDoubles: 0, sTie: 0,
        fromLongest: 0,            // S is a longest number (for a non-double, S is already the
                                   // number you hold more of, so this covers either number)
        longestUnique: 0, fromLongestUnique: 0,
    },
    // After each opponent's first turn in hands you opened (chosen salidas).
    opp: {
        1: { turns: 0, showing: 0, passed: 0, coveredS: 0, other: 0, showingDouble: 0, turnsDouble: 0 },
        3: { turns: 0, showing: 0, passed: 0, coveredS: 0, other: 0, showingDouble: 0, turnsDouble: 0 },
    },
    // Your later turns in hands you opened (chosen salidas), by whether S was showing.
    turns: { showing: { turns: 0, passes: 0 }, covered: { turns: 0, passes: 0 } },
    // Your plays where you had a choice and hadn't asked Genín.
    genin: { decisions: 0, agreed: 0, asked: 0, forced: 0, noPick: 0 },
};

const pct = (a, b) => (b ? `${(100 * a / b).toFixed(1)}%` : '—');

for (const match of data.matches) {
    T.matches++;
    if (match.winner === 0) T.matchesWon++;

    for (const hand of match.hands || []) {
        const start = hand.start;
        const moves = hand.moves || [];
        if (!Array.isArray(start) || start.length !== 4 || !moves.length) { T.skippedHands++; continue; }
        T.hands++;
        const won = hand.result?.winner === 0;
        if (won) T.handsWon++;
        if (hand.result?.winner === -1) T.handsTied++;
        T.openedBy[hand.opener]++;
        if (won) T.openedWon[hand.opener]++;

        // Replay the board and the hands. ends[i] = board ends before move i.
        const held = start.map(h => new Set(h));
        let L = null, R = null;
        const endsBefore = [];
        for (let i = 0; i < moves.length; i++) {
            const m = moves[i];
            const recL = m[F.leftEnd], recR = m[F.rightEnd];
            if (i > 0 && (recL !== L || recR !== R)) T.endMismatches++;
            endsBefore.push([recL, recR]);
            L = recL; R = recR;
            const tile = m[F.tile];
            if (!tile) continue;
            held[m[F.seat]].delete(tile);
            if (L === null) { [R, L] = parse(tile); }           // the salida: left = low, right = high
            else if (m[F.end] === 'L') L = other(tile, L);
            else R = other(tile, R);
        }
        const endsAfter = (i) => (i + 1 < moves.length ? endsBefore[i + 1] : [L, R]);

        // Genín agreement on your plays (any opener).
        const mine = start[0].slice();
        const inHand = new Set(mine);
        for (let i = 0; i < moves.length; i++) {
            const m = moves[i];
            if (m[F.seat] !== 0) continue;
            const tile = m[F.tile];
            if (!tile) continue;
            const [l, r] = endsBefore[i];
            const coach = m[F.coach] || {};
            let options = 0;
            if (l === null) options = hand.n === 1 ? 1 : inHand.size;
            else for (const k of inHand) options += l === r ? (has(k, l) ? 1 : 0) : (has(k, l) ? 1 : 0) + (has(k, r) ? 1 : 0);
            inHand.delete(tile);
            if (options <= 1) { T.genin.forced++; continue; }
            if (coach.asked) { T.genin.asked++; continue; }
            if (!coach.genin) { T.genin.noPick++; continue; }
            T.genin.decisions++;
            const [gTile, gEnd] = coach.genin;
            if (gTile === tile && (l === null || l === r || gEnd === m[F.end])) T.genin.agreed++;
        }

        // Hands you opened.
        if (hand.opener !== 0 || moves[0][F.seat] !== 0 || !moves[0][F.tile]) continue;
        const salida = moves[0][F.tile];
        if (hand.n === 1) { T.salida.forced++; continue; }
        const S_ = T.salida;
        S_.chosen++;
        if (won) S_.wonChosen++;

        const count = (v) => start[0].filter(k => has(k, v)).length;
        const counts = [0, 1, 2, 3, 4, 5, 6].map(count);
        const longest = Math.max(...counts);
        const longestNums = counts.flatMap((c, v) => (c === longest ? [v] : []));
        const [hi, lo] = parse(salida);
        const isDouble = hi === lo;
        let S;
        if (isDouble) { S = hi; S_.doubles++; }
        else {
            S_.nonDoubles++;
            S = counts[hi] >= counts[lo] ? hi : lo;
            if (counts[hi] === counts[lo]) S_.sTie++;
            if (S === hi) S_.sIsHigher++;
        }
        const more = counts[S] - 1;
        S_.moreHist[more]++;
        (isDouble ? S_.moreHistDouble : S_.moreHistOther)[more]++;
        if (counts[S] === longest) S_.fromLongest++;
        if (longestNums.length === 1) { S_.longestUnique++; if (counts[S] === longest) S_.fromLongestUnique++; }

        const showing = ([l, r]) => l === S || r === S;
        for (const seat of [1, 3]) {
            const i = moves.findIndex(m => m[F.seat] === seat);
            if (i < 0) continue;
            const o = T.opp[seat];
            o.turns++;
            if (isDouble) o.turnsDouble++;
            const m = moves[i];
            if (!m[F.tile]) o.passed++;
            else {
                const [l, r] = endsBefore[i];
                const onEnd = m[F.end] === 'L' ? l : r;
                if (onEnd === S) o.coveredS++; else o.other++;
            }
            if (showing(endsAfter(i))) { o.showing++; if (isDouble) o.showingDouble++; }
        }

        for (let i = 1; i < moves.length; i++) {
            if (moves[i][F.seat] !== 0) continue;
            const bucket = showing(endsBefore[i]) ? T.turns.showing : T.turns.covered;
            bucket.turns++;
            if (!moves[i][F.tile]) bucket.passes++;
        }
    }
}

// ── Report ─────────────────────────────────────────────────────────────────
if (asJson) {
    console.log(JSON.stringify({ file, exportedAt: data.exportedAt, version: data.version, ...T }, null, 2));
    process.exit(0);
}

const S_ = T.salida;
const dates = data.matches.map(m => m.date).filter(Boolean).sort();
const levels = [...new Set(data.matches.map(m => (m.levels || []).slice(1).join('/')))];
const lines = [];
const out = (s = '') => lines.push(s);
const hist = (h, n) => h.map((c, k) => (c ? `${k}: ${c} (${pct(c, n)})` : null)).filter(Boolean).join(' · ') || '—';

out(`7 Fichas game logs — ${file}`);
out(`Exported ${data.exportedAt?.slice(0, 10) ?? '?'} from v${data.version ?? '?'}; matches ${dates[0]?.slice(0, 10) ?? '?'} to ${dates.at(-1)?.slice(0, 10) ?? '?'}`);
out(`AI levels (opp 1 / partner / opp 2): ${levels.join(', ') || '?'}`);
out();
out(`Matches: ${T.matches}, you won ${T.matchesWon} (${pct(T.matchesWon, T.matches)})`);
out(`Hands: ${T.hands}, your team won ${T.handsWon} (${pct(T.handsWon, T.hands)})${T.handsTied ? `, ${T.handsTied} tied` : ''}`);
out(`  by opener — you: ${T.openedWon[0]}/${T.openedBy[0]} (${pct(T.openedWon[0], T.openedBy[0])}) · opp 1: ${T.openedWon[1]}/${T.openedBy[1]} · partner: ${T.openedWon[2]}/${T.openedBy[2]} · opp 2: ${T.openedWon[3]}/${T.openedBy[3]}`);
if (T.skippedHands) out(`  (${T.skippedHands} hands skipped: no starting hands or moves)`);
if (T.endMismatches) out(`  WARNING: ${T.endMismatches} moves whose recorded board ends disagree with the replay`);
out();
out(`YOUR SALIDAS: ${S_.chosen} chosen (${S_.doubles} doubles, ${S_.nonDoubles} others), ${S_.forced} forced [6|6] not counted`);
out(`  your team won ${S_.wonChosen} of the ${S_.chosen} (${pct(S_.wonChosen, S_.chosen)})`);
out(`  more of S in your hand — all: ${hist(S_.moreHist, S_.chosen)}`);
out(`                           doubles: ${hist(S_.moreHistDouble, S_.doubles)}`);
out(`                           others: ${hist(S_.moreHistOther, S_.nonDoubles)}`);
const two = S_.moreHist.slice(2).reduce((a, b) => a + b, 0);
out(`  2 or more of S: ${two} of ${S_.chosen} (${pct(two, S_.chosen)})`);
if (S_.nonDoubles) out(`  non-double salidas: S was the higher number ${S_.sIsHigher} of ${S_.nonDoubles} (${S_.sTie} ties, which count as the higher)`);
out();
out('FROM YOUR LONGEST NUMBER');
out(`  S is a longest number: ${S_.fromLongest} of ${S_.chosen} (${pct(S_.fromLongest, S_.chosen)})`);
out(`  hands with one longest number (no tie): S was it ${S_.fromLongestUnique} of ${S_.longestUnique} (${pct(S_.fromLongestUnique, S_.longestUnique)})`);
out();
out('AFTER EACH OPPONENT\'S FIRST TURN (hands you opened) — is S still showing?');
for (const [seat, name] of [[1, 'opp 1 (plays right after you)'], [3, 'opp 2 (plays after your partner)']]) {
    const o = T.opp[seat];
    out(`  ${name}: still showing ${o.showing} of ${o.turns} (${pct(o.showing, o.turns)})`
        + ` — after a double salida ${o.showingDouble}/${o.turnsDouble}, after another ${o.showing - o.showingDouble}/${o.turns - o.turnsDouble}`);
    out(`      their move: played on an S end ${o.coveredS} · on the other end ${o.other} · passed ${o.passed}`);
}
out();
out('YOUR LATER TURNS IN HANDS YOU OPENED — passes');
const { showing: sh, covered: cv } = T.turns;
out(`  with S showing: ${sh.passes} passes in ${sh.turns} turns (${pct(sh.passes, sh.turns)})`);
out(`  with S covered: ${cv.passes} passes in ${cv.turns} turns (${pct(cv.passes, cv.turns)})`);
out();
const g = T.genin;
out(`GENÍN AGREEMENT: you played his pick on ${g.agreed} of ${g.decisions} plays with a choice (${pct(g.agreed, g.decisions)})`);
out(`  not counted: ${g.forced} one-move plays, ${g.asked} where you asked him first${g.noPick ? `, ${g.noPick} with no pick recorded` : ''}`);
console.log(lines.join('\n'));
