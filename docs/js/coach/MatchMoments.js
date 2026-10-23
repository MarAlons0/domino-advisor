// Key-moment detection for the table and match-end effects (UX-A).
// Pure: no DOM, no i18n — main.js turns these into visuals.
//
// Definitions (confirmed with the project owner):
//  - Capicú: the winning (last) tile joins two DIFFERENT puntas, so it could be
//    played on either end. Equal puntas never make a capicú.
//  - Zapato: your team wins the match while the opponents scored 0.
//  - Comeback (remontada): your team wins the match after trailing by 50+.

export const COMEBACK_MIN_DEFICIT = 50;

/**
 * Is playing `tile` on puntas (leftEnd, rightEnd) a capicú? Call it only for a
 * player's last tile (a domino).
 */
export function isCapicu(tile, leftEnd, rightEnd) {
    if (!tile || leftEnd == null || rightEnd == null || leftEnd === rightEnd) return false;
    return (tile.high === leftEnd && tile.low === rightEnd)
        || (tile.high === rightEnd && tile.low === leftEnd);
}

/**
 * The largest lead the opponents of `team` held after any hand. Match points
 * only change at hand ends, so checking after each hand is exact.
 */
export function maxDeficit(hands, team = 0) {
    const totals = [0, 0];
    let max = 0;
    for (const hand of hands || []) {
        const r = hand.result;
        if (r && r.winner >= 0) totals[r.winner] += r.points || 0;
        max = Math.max(max, totals[1 - team] - totals[team]);
    }
    return max;
}

/**
 * Match-level highlights for a win by `team`: a zapato and/or a comeback.
 * (They can't both happen: in a zapato the opponents never scored.)
 * @returns {Array<{type:'zapato', us:number} | {type:'comeback', deficit:number}>}
 */
export function matchHighlights(hands, winner, finalScores, team = 0) {
    if (winner !== team) return [];
    const out = [];
    if (finalScores[1 - team] === 0) out.push({ type: 'zapato', us: finalScores[team] });
    const deficit = maxDeficit(hands, team);
    if (deficit >= COMEBACK_MIN_DEFICIT) out.push({ type: 'comeback', deficit });
    return out;
}
