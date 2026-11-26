// Matches to record, for the stats tests (stats-merge, player-stats).
// Real self-play hands and results (all seats Beginner, seeded), plus made-up
// suit signals, questionable plays, Genín grades and quizzes, so every stat the
// recorder keeps moves. Import after setting globalThis.localStorage.

import { SIGNAL_TYPES } from '../../../docs/js/ai/SignalProfile.js';
import { SmartAI } from '../../../docs/js/ai/SmartAI.js';
import { HandTracker } from '../../../docs/js/ai/HandTracker.js';
import { PlayerView } from '../../../docs/js/ai/PlayerView.js';
import { Game } from '../../../docs/js/engine/Game.js';

export const seeded = (a) => () => { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; };
const realRandom = Math.random;
const withSeed = (seed, fn) => { Math.random = seeded(seed); try { return fn(); } finally { Math.random = realRandom; } };
export const T0 = Date.UTC(2026, 10, 1);
export const MINUTE = 60_000;

/** One self-play match, all seats Beginner: each hand's end data and the match result. */
function selfPlayMatch() {
    const game = new Game();
    const ai = new SmartAI();
    const tracker = new HandTracker();
    ai.setHandTracker(tracker);
    const views = [0, 1, 2, 3].map(i => new PlayerView(i, tracker));
    ai.setPlayerViews(views);
    for (let i = 0; i < 4; i++) ai.setDifficulty(i, 'beginner');
    game.onPlay = (d) => {
        const l = d.openEndsBefore?.left ?? null, r = d.openEndsBefore?.right ?? null;
        ai.recordPlay(d.player, d.tile, d.end, l, r);
        tracker.recordPlay(d.player, d.tile);
        for (const v of views) v.recordPlayObservation(d.player, d.tile, d.end, l, r);
    };
    game.onPass = (d) => {
        const s = game.getState();
        ai.recordPass(d.player, s.chain.leftEnd, s.chain.rightEnd);
        tracker.recordPass(d.player, s.chain.leftEnd, s.chain.rightEnd);
    };
    const hands = [];
    let end = null;
    game.onHandEnd = (d) => hands.push({
        reason: d.reason, winningTeam: d.winningTeam, points: d.points,
        matchScores: d.matchScores, closingPlayer: d.closingPlayer,
    });
    game.onMatchEnd = (d) => { end = { winner: d.winner, finalScores: d.finalScores }; };
    const startHand = () => {
        const s = game.getState();
        tracker.initHand(s.hands[0]);
        for (let i = 0; i < 4; i++) { views[i].resetAffinities(); views[i].initOwnHand(s.hands[i]); }
    };
    ai.resetForNewHand();
    game.newMatch();
    startHand();
    for (let tick = 0; end === null; tick++) {
        if (tick > 100_000) throw new Error('match did not end');
        const s = game.getState();
        if (s.gamePhase === 'playing') {
            const move = ai.chooseMove(s, s.currentPlayer);
            if (move === null) game.pass();
            else game.playTurn(move.tile, move.end, { reasoning: move.reasoning });
        } else if (s.gamePhase === 'handOver') {
            ai.resetForNewHand();
            game.newHand();
            startHand();
        } else break;
    }
    return { hands, end };
}

/**
 * `count` matches, 30 minutes apart from T0: real hands and results, plus
 * made-up signals (Your signals), a questionable play now and then (hands won
 * anyway), Genín grades and quizzes. About one match in seven is abandoned:
 * some hands, no result. Two made-up matches are put in early, since
 * Beginner self-play seldom comes back from far behind: a win from 75 down (not
 * quite a comeback, which takes 80 or more), then one from 95 down.
 */
export function makeTrace(count) {
    const trace = selfPlayTrace(count);
    for (const [i, match] of [[3, comebackMatch(75)], [8, comebackMatch(95)]]) {
        if (i < trace.length) trace.splice(i, 1, match);
    }
    return trace.map((m, i) => ({ ...m, at: T0 + (i + 1) * 30 * MINUTE }));
}

/** A match won after trailing by `deficit`: three domino hands against, then ours. */
function comebackMatch(deficit) {
    const hand = (winningTeam, points, matchScores) => ({
        data: { reason: 'domino', winningTeam, points, matchScores, closingPlayer: null },
        override: false, signals: [],
    });
    const a = Math.round(deficit / 3), b = Math.round(deficit / 3), c = deficit - a - b;
    return {
        hands: [
            hand(1, a, [0, a]), hand(1, b, [0, a + b]), hand(1, c, [0, deficit]),
            hand(0, 120, [120, deficit]), hand(0, 90, [210, deficit]),
        ],
        end: {
            data: { winner: 0, finalScores: [210, deficit] },
            humanStats: { optimal: 0, good: 0, questionable: 0, mistake: 0 },
            quizStats: { totalQuizzes: 0, totalScore: 0, avgScore: 0 },
        },
    };
}

function selfPlayTrace(count) {
    const rng = seeded(20261125);
    const int = (lo, hi) => lo + Math.floor(rng() * (hi - lo + 1));
    const pick = (arr) => arr[Math.floor(rng() * arr.length)];
    return withSeed(777, () => Array.from({ length: count }, () => {
        const { hands, end } = selfPlayMatch();
        const abandoned = hands.length > 1 && rng() < 0.15;
        const kept = abandoned ? hands.slice(0, int(1, hands.length - 1)) : hands;
        return {
            hands: kept.map(data => ({
                data,
                override: rng() < 0.25,
                signals: Array.from({ length: int(0, 4) }, () => ({
                    type: pick(SIGNAL_TYPES), held: int(0, 4), expected: 0.2 + rng() * 2.8,
                })),
            })),
            end: abandoned ? null : {
                data: end,
                humanStats: { optimal: int(0, 15), good: int(0, 8), questionable: int(0, 4), mistake: int(0, 3) },
                quizStats: rng() < 0.4
                    ? (() => { const n = int(1, 3), total = int(0, 100 * n); return { totalQuizzes: n, totalScore: total, avgScore: total / n }; })()
                    : { totalQuizzes: 0, totalScore: 0, avgScore: 0 },
            },
        };
    }));
}

const WITH_OVERRIDE = { currentHand: { plays: [{ isHuman: true, evaluation: 'mistake' }] } };
const NO_OVERRIDE = { currentHand: { plays: [] } };

/**
 * Record one match into a PlayerStats the way main.js does (hand, its
 * signals, badge check, save; then coaching, result, badge check, save).
 * @param {object} [opts]
 * @param {object|null} [opts.badgeSystem] - checks badges when given
 * @param {() => void} [opts.tick] - called before each hand and before the match end
 */
export function recordMatch(ps, match, { badgeSystem = null, tick = null } = {}) {
    ps.resetMatchSession();
    for (const h of match.hands) {
        tick?.();
        ps.recordHandResult(h.data, h.override ? WITH_OVERRIDE : NO_OVERRIDE);
        if (h.signals.length) ps.recordStyleHand(h.signals);
        badgeSystem?.checkHandBadges(ps.get());
        ps.save(ps.get());
    }
    if (match.end) {
        tick?.();
        ps.recordCoachingData(match.end.humanStats, match.end.quizStats);
        ps.recordMatchResult(match.end.data);
        badgeSystem?.checkMatchBadges(ps.get());
        ps.save(ps.get());
    }
}

/**
 * Every number equal — Your signals sums (floats) within rounding, since adding
 * a hand's sum at once rounds differently from adding its signals one by one.
 * Badges compared separately by the caller.
 */
export function assertSameStats(assert, actual, expected, { skip = [] } = {}) {
    const walk = (a, e, path) => {
        for (const key of new Set([...Object.keys(a ?? {}), ...Object.keys(e ?? {})])) {
            const p = path ? `${path}.${key}` : key;
            if (p === 'badges' || skip.includes(p)) continue;
            const x = a?.[key], y = e?.[key];
            if (y !== null && typeof y === 'object') walk(x, y, p);
            else if (typeof y === 'number' && !Number.isInteger(y)) {
                assert.ok(Math.abs(x - y) <= 1e-9 * Math.max(1, Math.abs(y)), `${p}: ${x} vs ${y}`);
            } else assert.equal(x, y, p);
        }
    };
    walk(actual, expected, '');
}
