// Match equity for the race to Rules.MATCH_TARGET (BACKLOG 0g.3b).
//
// matchEquity(mine, theirs) is the probability that a team on `mine` points
// beats a team on `theirs`, with the next hand about to be dealt. Model: each
// hand is a coin flip between the teams, and a decided hand is worth a number
// of points drawn from HAND_POINTS; a tie scores nothing, so it doesn't move
// the equity and drops out. Hands are independent and the opening-seat edge is
// ignored — the table only has to rank the outcomes of one hand correctly.
//
// ISMCTSGameState's 'match' reward scores each simulated hand with this, which
// is what makes the search play safe at match point and gamble when far behind.

import { Rules } from '../engine/Rules.js';

// Decided hands by points scored (index = points), from 600 Master self-play
// matches (4,535 hands, mean 21; no ties seen):
// `node tools/tournament.js --games 600 --hand-points`.
const HAND_POINTS = [
    0, 6, 19, 27, 43, 55, 82, 97, 111, 122, 165, 157,
    177, 163, 199, 173, 185, 200, 176, 169, 170, 178, 142, 147,
    142, 121, 119, 113, 81, 86, 83, 71, 79, 54, 66, 62,
    47, 51, 45, 39, 36, 39, 24, 28, 20, 16, 15, 20,
    16, 13, 5, 6, 6, 10, 7, 11, 8, 4, 4, 2,
    3, 1, 2, 5, 2, 1, 3, 1, 1, 0, 3, 1,
];

const TARGET = Rules.MATCH_TARGET;

// equity[mine * TARGET + theirs] for 0 ≤ mine, theirs < TARGET.
const equity = buildTable();

function buildTable() {
    // Point values > 0 with their probabilities. A 0-point decided hand leaves
    // the score unchanged, same as a tie, so it drops out too.
    const pts = [];
    const prob = [];
    let total = 0;
    for (let x = 1; x < HAND_POINTS.length; x++) total += HAND_POINTS[x];
    for (let x = 1; x < HAND_POINTS.length; x++) {
        if (HAND_POINTS[x] > 0) { pts.push(x); prob.push(HAND_POINTS[x] / total); }
    }

    const table = new Float64Array(TARGET * TARGET);
    const at = (a, b) => (a >= TARGET ? 1 : b >= TARGET ? 0 : table[a * TARGET + b]);
    // Every term looks at a higher score for one side, so fill from the top.
    for (let a = TARGET - 1; a >= 0; a--) {
        for (let b = TARGET - 1; b >= 0; b--) {
            let e = 0;
            for (let i = 0; i < pts.length; i++) {
                e += prob[i] * (at(a + pts[i], b) + at(a, b + pts[i]));
            }
            table[a * TARGET + b] = e / 2;
        }
    }
    return table;
}

/**
 * Probability that a team on `mine` points wins the match against a team on
 * `theirs`, before the next hand. Either score may already be past the target.
 * @param {number} mine
 * @param {number} theirs
 * @returns {number} in [0, 1]
 */
export function matchEquity(mine, theirs) {
    if (mine >= TARGET) return 1;
    if (theirs >= TARGET) return 0;
    return equity[mine * TARGET + theirs];
}
