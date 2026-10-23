// Mano-level (per-hand) coaching feedback — local, rule-based, no API.
//
// Produces a compact verdict + one expandable "key moment" for the hand that
// just finished, from data already captured during play (MatchHistory play
// records + the per-turn instrumentation in SmartAI.analyzeHumanTurn).
//
// Design principles (see docs/ and the planning discussion):
//  - Separate OUTCOME (did the team win/lose, by how much) from PROCESS (how
//    good were the human's decisions given the information available). The human
//    is 1 of 4 players, so a loss is not necessarily bad play, nor a win good.
//  - The cerrar decision is the premier teaching moment, and it is framed
//    PROCESS-FIRST: what could the player infer at that moment (inferred pip
//    edge from observed passes/fallas) — then the ground-truth outcome. Good
//    process with a bad outcome is praised, not punished.
//
// Returns { outcome:{result,margin,reason}, verdict:{key,args}, moment:{key,args}|null }.
// `key`s are i18n keys; `args` are POSITIONAL substitution values ({0},{1},…)
// matching each template's placeholder order (contract owned here, next to the
// strings in translations.js). An arg may itself be an i18n reference
// { i18n, args } that the UI resolves at render time (ui/feedbackText.js), so
// phrases follow the current language instead of the one active at play time.

const EDGE_THRESHOLD = 3; // |inferred edge| below this is "ambiguous" (matches AI MIN_EDGE)

const tileStr = (tile) => (tile ? tile.toString() : '');
const signed = (n) => (n >= 0 ? '+' : '') + n;

/** Collect the human's non-pass plays with their 1-based position in the hand. */
function humanPlaysWithIndex(hand) {
    const out = [];
    let humanN = 0;
    for (const p of (hand?.plays || [])) {
        if (p.isHuman && p.tile) {
            humanN++;
            out.push({ play: p, humanN });
        }
    }
    return out;
}

/** Classify the inferred edge the player could read at the cerrar moment. */
function readOf(inferredEdge) {
    if (inferredEdge >= EDGE_THRESHOLD) return 'ahead';
    if (inferredEdge <= -EDGE_THRESHOLD) return 'behind';
    return 'ambiguous';
}

/** Build the cerrar moment (taken or declined), or null if no cerrar this hand. */
function cerrarMoment(humanPlays, actualTeamResult) {
    const taken = humanPlays.find(h => h.play.turnAnalysis?.cerrarTaken);
    if (taken) {
        const co = taken.play.turnAnalysis.closeOutcome || {};
        const read = readOf(co.inferredEdge ?? 0);
        const edge = Math.round(co.inferredEdge ?? 0);
        const score = Math.round(co.scoreIfClosed ?? 0);
        const value = co.closeValue;
        if (actualTeamResult <= 0) {
            // Closed and lost — teach: the pips/read were against you.
            return { key: 'coach.moment.cerrarTakenBad', args: [value, signed(edge), Math.abs(Math.round(actualTeamResult))] };
        }
        if (read === 'ahead') {
            return { key: 'coach.moment.cerrarTakenGood', args: [value, edge, score] };
        }
        return { key: 'coach.moment.cerrarTakenLucky', args: [value, signed(edge), score] };
    }

    // Declined: turns where a close was available but not taken.
    const declined = humanPlays.filter(h =>
        h.play.turnAnalysis?.cerrarAvailable
        && !h.play.turnAnalysis?.cerrarTaken
        && h.play.turnAnalysis?.closeOutcome);
    if (declined.length === 0) return null;

    // Most instructive = closing outcome diverges most from what actually happened.
    declined.sort((a, b) =>
        Math.abs((b.play.turnAnalysis.closeOutcome.scoreIfClosed ?? 0) - actualTeamResult)
        - Math.abs((a.play.turnAnalysis.closeOutcome.scoreIfClosed ?? 0) - actualTeamResult));
    const co = declined[0].play.turnAnalysis.closeOutcome;
    const read = readOf(co.inferredEdge ?? 0);
    const edge = Math.round(co.inferredEdge ?? 0);
    const score = Math.round(co.scoreIfClosed ?? 0);
    const value = co.closeValue;

    if (score <= 0) {
        // Closing would have lost — holding was correct regardless of the read.
        return { key: 'coach.moment.cerrarDeclinedGood', args: [value, signed(edge), Math.abs(score)] };
    }
    if (read === 'ahead' && score > actualTeamResult) {
        // The signals pointed your way and closing would have beaten the result.
        return { key: 'coach.moment.cerrarDeclinedMissed', args: [value, edge, score, signed(Math.round(actualTeamResult))] };
    }
    // Closing would have won, but the passes didn't reveal it — forgiving note.
    return { key: 'coach.moment.cerrarDeclinedForgivable', args: [value, score] };
}

/** Fallback: the worst graded play (biggest score gap), or null. */
function scoreGapMoment(humanPlays) {
    let worst = null;
    let worstGap = -Infinity;
    for (const h of humanPlays) {
        const ev = h.play.evaluation;
        if (ev !== 'mistake' && ev !== 'questionable') continue;
        const rec = h.play.aiRecommendation;
        const played = h.play.turnAnalysis?.playedScore;
        const gap = (rec && played != null) ? (rec.score - played) : (ev === 'mistake' ? 999 : 0);
        if (gap > worstGap) { worstGap = gap; worst = h; }
    }
    if (!worst) return null;
    const rec = worst.play.aiRecommendation;
    const ta = worst.play.turnAnalysis || {};
    const playedTile = tileStr(worst.play.tile);
    const altTile = rec ? tileStr(rec.tile) : '?';
    // The salida (first tile on an empty board) is "you opened with" / "saliste
    // con"; any later tile is "on your play N you played" / "en tu jugada N tiraste".
    const lead = worst.play.stateSnapshot?.chainSize === 0
        ? { i18n: 'coach.lead.opened' }
        : { i18n: 'coach.lead.play', args: [worst.humanN] };
    // Prefer the factor key (resolved in the current language) over the
    // play-time phrase.
    const reason = ta.recFactor ? { i18n: `explain.contrast.${ta.recFactor}` } : ta.recReason;

    // Richest form: strategic reason (the "why") + ISMCTS win-rate comparison (the
    // "how", only at Master). Degrade to principle-only, then to a bare statement.
    if (reason && ta.recWinRate != null && ta.playedWinRate != null) {
        return {
            key: 'coach.moment.scoreGapWhy',
            args: [lead, playedTile, altTile, reason,
                   Math.round(ta.recWinRate * 100), Math.round(ta.playedWinRate * 100)],
        };
    }
    if (reason) {
        return {
            key: 'coach.moment.scoreGapPrinciple',
            args: [lead, playedTile, altTile, reason],
        };
    }
    return { key: 'coach.moment.scoreGap', args: [lead, playedTile, altTile] };
}

/** Positive highlight (an optimal play), or null. */
function highlightMoment(humanPlays) {
    const best = humanPlays.find(h => h.play.evaluation === 'optimal');
    if (!best) return null;
    return { key: 'coach.moment.highlight', args: [best.humanN, tileStr(best.play.tile)] };
}

/** Compact verdict phrase (no args) from the moment + outcome. */
function verdictFor(moment, result) {
    if (moment) {
        // All three score-gap variants (bare / principle / why) describe the same
        // kind of moment — a weaker-than-recommended play — so they share a verdict.
        const costlyPlay = result === 'won' ? 'coach.verdict.wonWithLeak' : 'coach.verdict.oneCostlyPlay';
        const map = {
            'coach.moment.cerrarTakenGood': 'coach.verdict.sharpClose',
            'coach.moment.cerrarTakenLucky': 'coach.verdict.luckyClose',
            'coach.moment.cerrarTakenBad': 'coach.verdict.closedBehind',
            'coach.moment.cerrarDeclinedGood': 'coach.verdict.goodDiscipline',
            'coach.moment.cerrarDeclinedMissed': 'coach.verdict.missedClose',
            'coach.moment.cerrarDeclinedForgivable': 'coach.verdict.reasonableHold',
            'coach.moment.scoreGap': costlyPlay,
            'coach.moment.scoreGapPrinciple': costlyPlay,
            'coach.moment.scoreGapWhy': costlyPlay,
            'coach.moment.highlight': 'coach.verdict.wellPlayed',
        };
        return { key: map[moment.key] || 'coach.verdict.wellPlayed', args: [] };
    }
    if (result === 'won') return { key: 'coach.verdict.solidHand', args: [] };
    if (result === 'lost') return { key: 'coach.verdict.toughDeal', args: [] };
    return { key: 'coach.verdict.evenHand', args: [] };
}

/**
 * Build the mano-level feedback for a finished hand.
 * @param {object} hand - MatchHistory hand ({ handNumber, plays, result })
 * @param {object} data - onHandEnd payload ({ reason, winningTeam, points, ... })
 * @param {number} [humanSeat=0]
 * @returns {{outcome, verdict, moment}}
 */
export function buildHandFeedback(hand, data, humanSeat = 0) {
    const humanTeam = humanSeat % 2;
    const result = data.winningTeam === -1 ? 'tie'
        : (data.winningTeam === humanTeam ? 'won' : 'lost');
    const margin = data.points || 0;
    const outcome = { result, margin, reason: data.reason };
    const actualTeamResult = result === 'won' ? margin : (result === 'lost' ? -margin : 0);

    const humanPlays = humanPlaysWithIndex(hand);
    const moment =
        cerrarMoment(humanPlays, actualTeamResult)
        || scoreGapMoment(humanPlays)
        || highlightMoment(humanPlays)
        || null;

    return { outcome, verdict: verdictFor(moment, result), moment };
}
