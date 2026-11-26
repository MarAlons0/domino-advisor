import { StorageService } from './StorageService.js';
import { SignalProfile } from '../ai/SignalProfile.js';
import { emptyStats, recordFrom, addEntries, resetRecord } from './StatsMerge.js';

const STORAGE_KEY = '7fichas_stats';

function deepMerge(defaults, stored) {
    const result = Object.assign({}, defaults);
    for (const key of Object.keys(defaults)) {
        if (stored && Object.prototype.hasOwnProperty.call(stored, key)) {
            if (typeof defaults[key] === 'object' && defaults[key] !== null && !Array.isArray(defaults[key])) {
                result[key] = deepMerge(defaults[key], stored[key]);
            } else {
                result[key] = stored[key];
            }
        }
    }
    return result;
}

/**
 * Your lifetime stats on this device.
 *
 * Each thing recorded — a hand, its suit signals, a match's coaching data, a
 * match result — is first written into an all-zero stats object: that is its
 * delta. The delta is then added to the totals by StatsMerge (counts add,
 * "largest" fields keep the max, signal sums add; the win streaks come from
 * the match results in order). That is how a record from several devices is
 * put together (docs/CROSS_DEVICE_STATS.md), so one device and several end up
 * with the same numbers from the same code.
 */
export class PlayerStats {
    constructor() {
        this._record = null; // StatsMerge record; get() is its totals
        this._lastAt = 0;
        this._matchSession = { maxDeficit: 0 };
    }

    load() {
        const stored = StorageService.get(STORAGE_KEY);
        // Merge into a copy: sections missing from storage would otherwise be
        // the defaults' own objects, and recording into them would change
        // what reset() starts from.
        this._record = recordFrom(deepMerge(emptyStats(), stored || {}));
        return this._record.totals;
    }

    save(stats) {
        StorageService.set(STORAGE_KEY, stats);
    }

    get() {
        if (!this._record) this.load();
        return this._record.totals;
    }

    /**
     * Start the count over. Earned badges are kept.
     */
    reset() {
        this.get();
        resetRecord(this._record, this._now());
        this.save(this._record.totals);
        return this._record.totals;
    }

    /**
     * A time for the next entry: never before the last one or the last reset,
     * so matches stay in the order they were played even if the clock moves back.
     */
    _now() {
        this._lastAt = Math.max(Date.now(), this._lastAt + 1, (this._record?.resetAt ?? 0) + 1);
        return this._lastAt;
    }

    /**
     * Record one thing: `fill` writes its numbers into an all-zero stats
     * object, which is added to the totals.
     * @param {boolean|null} won - a match result (true/false), or null for anything else
     * @param {(delta: object) => void} fill
     */
    _add(won, fill, { save = true } = {}) {
        this.get();
        const delta = emptyStats();
        fill(delta);
        addEntries(this._record, [{ at: this._now(), won, delta }]);
        if (save) this.save(this._record.totals);
    }

    /**
     * Fold one finished hand's suit signals (yours) into the style profile.
     * @param {Array<{type: string, held: number, expected: number}>} signals
     */
    recordStyleHand(signals) {
        // Saved by the caller, after the hand's badge check (as before).
        this._add(null, (delta) => {
            const profile = new SignalProfile();
            for (const { type, held, expected } of signals) profile.observe(type, held, expected);
            profile.commitHand();
            delta.style = profile.toJSON();
        }, { save: false });
    }

    resetMatchSession() {
        this._matchSession = { maxDeficit: 0 };
    }

    /**
     * Record the result of a completed hand.
     * @param {object} data - Hand end data from game engine
     * @param {object} matchHistory - Current match history object
     */
    recordHandResult(data, matchHistory) {
        const { reason, winningTeam, points, matchScores, closingPlayer } = data;

        // Deficit tracking (for the comeback, recorded with the match result)
        if (matchScores) {
            const opponentLead = matchScores[1] - matchScores[0];
            if (opponentLead > 0) {
                this._matchSession.maxDeficit = Math.max(this._matchSession.maxDeficit, opponentLead);
            }
        }

        this._add(null, (d) => {
            // Basic hand counts
            d.hands.played++;
            if (winningTeam === 0) d.hands.won++;
            else if (winningTeam === 1) d.hands.lost++;
            else d.hands.tied++;

            // By-reason breakdown
            const reasonKey = reason === 'domino' ? 'domino' : reason === 'closed' ? 'closed' : 'blocked';
            if (winningTeam === 0) d.hands.byReason[reasonKey].won++;
            else if (winningTeam === 1) d.hands.byReason[reasonKey].lost++;

            // Score records (kept as the max when added up)
            if (winningTeam === 0 && points > 0) d.hands.largestScore = points;
            if (winningTeam === 1 && points > 0) d.hands.largestSurrender = points;

            // Cerrado stats
            if (reason === 'closed') {
                d.cerrado.teamTotal++;
                // Closes our team initiated, and how many of them we won
                if (closingPlayer === 0 || closingPlayer === 2) {
                    d.cerrado.teamClosed++;
                    if (winningTeam === 0) d.cerrado.teamClosedWon++;
                }
                if (winningTeam === 0) {
                    d.cerrado.teamWon++;
                    if (closingPlayer === 0) {
                        d.cerrado.youClosed++;
                        if (points > 0) d.cerrado.youClosedLargestScore = points;
                    } else if (closingPlayer === 2) d.cerrado.partnerClosed++;
                    if (points > 0) d.cerrado.largestScore = points;
                } else if (winningTeam === 1) {
                    if (points > 0) d.cerrado.largestSurrender = points;
                }
                // Opponent-initiated cerrados (players 1 or 3 closed)
                if (closingPlayer === 1 || closingPlayer === 3) d.cerrado.opponentTotal++;
            }

            // Hand overrides won: human team won despite questionable/mistake plays
            if (winningTeam === 0 && matchHistory) {
                const currentHand = matchHistory.currentHand;
                if (currentHand) {
                    const hasQuestionable = currentHand.plays.some(p =>
                        p.isHuman && (p.evaluation === 'questionable' || p.evaluation === 'mistake')
                    );
                    if (hasQuestionable) d.coaching.handOverridesWon++;
                }
            }
        });
    }

    /**
     * Record the result of a completed match. The win streaks follow from it
     * (StatsMerge works them out from the match results in order).
     * @param {object} data - Match end data { winner, finalScores }
     */
    recordMatchResult(data) {
        const { winner, finalScores } = data;
        const maxDeficit = this._matchSession.maxDeficit;

        this._add(winner === 0, (d) => {
            d.matches.played++;
            if (winner === 0) {
                d.matches.won++;

                // Win margin
                const margin = finalScores[0] - finalScores[1];
                if (margin > 0) d.matches.largestWinMargin = margin;

                // Comeback
                if (maxDeficit >= 80) d.matches.largestDeficitOvercome = maxDeficit;

                // Zapato given (opponent scored 0)
                if (finalScores[1] === 0) d.matches.zapatosGiven++;
            } else {
                d.matches.lost++;

                // Zapato received (we scored 0)
                if (finalScores[0] === 0) d.matches.zapatosReceived++;
            }
        });
    }

    /**
     * Record coaching/quiz data for the completed match.
     * @param {object} humanStats - From matchHistory.getHumanStats()
     * @param {object} quizStats - From matchHistory.getQuizStats()
     */
    recordCoachingData(humanStats, quizStats) {
        this._add(null, (d) => {
            // Genín agreement rate
            d.coaching.geninAgreements = (humanStats.optimal || 0) + (humanStats.good || 0);
            d.coaching.geninTotal = (humanStats.optimal || 0) + (humanStats.good || 0) +
                                    (humanStats.questionable || 0) + (humanStats.mistake || 0);

            // Quiz stats
            if (quizStats && quizStats.totalQuizzes > 0) {
                d.coaching.quizTotalScore = quizStats.totalScore;
                d.coaching.quizAttempts = quizStats.totalQuizzes;
                d.coaching.bestQuizScore = quizStats.avgScore;
            }
        });
    }
}
