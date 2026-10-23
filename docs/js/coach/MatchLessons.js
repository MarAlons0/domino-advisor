// Match-level debrief lessons (UX-0) — local, rule-based, no API.
//
// Turns a finished match's play records into the few things worth remembering:
//  - the result and the player's decision accuracy (forced moves excluded),
//  - up to 2 PATTERNS: strategic dimensions the player repeatedly gave up,
//    grouped by the factor-contrast key captured per play (turnAnalysis.recFactor),
//  - the top 3 KEY MOMENTS by impact (simulated win-rate drop at Master, else
//    the static score gap), each carrying what the UI needs to redraw
//    the board (hand held, open ends, signals) and explain the better tile.
//
// Pure: no DOM, no i18n. Returns factor keys and numbers; DebriefUI renders them.

import { MatchHistory } from '../models/MatchHistory.js';

const MAX_PATTERNS = 2;
const MIN_PATTERN_COUNT = 2; // one miss is a moment; two of the same kind is a pattern
const MAX_MOMENTS = 3;
// A win-rate drop below this (3 percentage points) is within simulation noise:
// the search found the two tiles about equally good.
const WR_NEGLIGIBLE = 0.03;

/**
 * The human's weaker-than-recommended real decisions, in play order, each with
 * its 1-based "your play N" within the hand (tile plays only, matching the
 * hand-end card) and its static score gap.
 */
function collectWeakDecisions(hands) {
    const weak = [];
    for (const hand of hands) {
        let humanN = 0;
        for (const play of hand.plays) {
            if (!play.isHuman || !play.tile) continue;
            humanN++;
            if (MatchHistory.isForced(play)) continue;
            if (play.evaluation !== 'mistake' && play.evaluation !== 'questionable') continue;
            const recScore = play.aiRecommendation?.score;
            const playedScore = play.turnAnalysis?.playedScore;
            const gap = (recScore != null && playedScore != null) ? recScore - playedScore : null;
            const ta = play.turnAnalysis || {};
            const wrGap = (ta.recWinRate != null && ta.playedWinRate != null)
                ? ta.recWinRate - ta.playedWinRate : null;
            weak.push({
                handNumber: hand.handNumber,
                humanN,
                play,
                gap,
                wrGap,
                factor: ta.recFactor || null,
            });
        }
    }
    return weak;
}

/**
 * Build the debrief's lessons for a finished match.
 * @param {MatchHistory} matchHistory
 * @returns {{
 *   result: {us:number, them:number, outcome:'won'|'lost'|'tie', hands:number},
 *   decisions: {total:number, goodOrBetter:number, pct:number|null, forced:number},
 *   weakCount: number,
 *   patterns: Array<{factor:string, count:number, hands:number[]}>,
 *   moments: Array<{handNumber:number, humanN:number, play:object, gap:number|null, wrGap:number|null, factor:string|null}>,
 *   moreMoments: number
 * }}
 */
export function buildMatchLessons(matchHistory) {
    const hands = matchHistory?.hands || [];

    // Result: match points come only from hand results, so summing them gives
    // the final score; the higher total won.
    const totals = [0, 0];
    for (const hand of hands) {
        const r = hand.result;
        if (r && r.winner >= 0) totals[r.winner] += r.points || 0;
    }
    const [us, them] = totals;
    const outcome = us > them ? 'won' : (us < them ? 'lost' : 'tie');

    // Accuracy over real decisions (getHumanStats already excludes forced plays).
    const s = matchHistory.getHumanStats();
    const total = s.optimal + s.good + s.questionable + s.mistake;
    const goodOrBetter = s.optimal + s.good;
    const pct = total > 0 ? Math.round((goodOrBetter / total) * 100) : null;

    const weak = collectWeakDecisions(hands);

    // Key moments by impact. At Master the ISMCTS win rates are what chose
    // Genín's move, and they often disagree with the static score gap, so they
    // take precedence when present:
    //   tier 2 — simulation confirms the cost (win-rate drop ≥ 3 pts), by drop size
    //   tier 1 — no simulation data: mistakes first, then the static score gap
    //   tier 0 — simulation found the tiles about equally good (drop < 3 pts)
    const tier = (w) => (w.wrGap == null ? 1 : (w.wrGap >= WR_NEGLIGIBLE ? 2 : 0));
    const severity = (w) => (w.play.evaluation === 'mistake' ? 1 : 0);
    const ranked = [...weak].sort((a, b) =>
        tier(b) - tier(a)
        || (tier(a) === 2 ? b.wrGap - a.wrGap : 0)
        || severity(b) - severity(a)
        || (b.gap ?? -Infinity) - (a.gap ?? -Infinity));
    const moments = ranked.slice(0, MAX_MOMENTS);

    // Patterns: the same strategic dimension given up at least twice.
    const groups = new Map();
    for (const w of weak) {
        if (!w.factor) continue;
        const g = groups.get(w.factor) || { factor: w.factor, count: 0, gapSum: 0, hands: new Set() };
        g.count++;
        g.gapSum += w.gap ?? 0;
        g.hands.add(w.handNumber);
        groups.set(w.factor, g);
    }
    const patterns = [...groups.values()]
        .filter(g => g.count >= MIN_PATTERN_COUNT)
        .sort((a, b) => b.count - a.count || b.gapSum - a.gapSum)
        .slice(0, MAX_PATTERNS)
        .map(g => ({ factor: g.factor, count: g.count, hands: [...g.hands].sort((a, b) => a - b) }));

    return {
        result: { us, them, outcome, hands: hands.length },
        decisions: { total, goodOrBetter, pct, forced: s.forced || 0 },
        weakCount: weak.length,
        patterns,
        moments,
        moreMoments: Math.max(0, weak.length - moments.length),
    };
}
