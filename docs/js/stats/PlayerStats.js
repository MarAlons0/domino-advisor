import { StorageService } from './StorageService.js';

const STORAGE_KEY = '7fichas_stats';

const DEFAULT_STATS = {
    version: 1,
    matches: {
        played: 0, won: 0, lost: 0,
        currentStreak: 0, bestWinStreak: 0,
        largestWinMargin: 0, largestDeficitOvercome: 0,
        zapatosGiven: 0, zapatosReceived: 0
    },
    hands: {
        played: 0, won: 0, lost: 0, tied: 0,
        byReason: {
            domino: { won: 0, lost: 0 },
            closed: { won: 0, lost: 0 },
            blocked: { won: 0, lost: 0 }
        },
        largestScore: 0, largestSurrender: 0
    },
    cerrado: {
        teamTotal: 0, teamWon: 0, youClosed: 0, partnerClosed: 0,
        opponentTotal: 0, largestScore: 0, largestSurrender: 0,
        youClosedLargestScore: 0
    },
    coaching: {
        geninAgreements: 0, geninTotal: 0,
        handOverridesWon: 0,
        quizTotalScore: 0, quizAttempts: 0, bestQuizScore: 0
    },
    badges: []
};

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

export class PlayerStats {
    constructor() {
        this._stats = null;
        this._matchSession = { maxDeficit: 0 };
    }

    load() {
        const stored = StorageService.get(STORAGE_KEY);
        this._stats = deepMerge(DEFAULT_STATS, stored || {});
        return this._stats;
    }

    save(stats) {
        StorageService.set(STORAGE_KEY, stats);
    }

    get() {
        if (!this._stats) this.load();
        return this._stats;
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
        const stats = this.get();
        const { reason, winningTeam, points, matchScores, closingPlayer } = data;

        // Basic hand counts
        stats.hands.played++;
        if (winningTeam === 0) stats.hands.won++;
        else if (winningTeam === 1) stats.hands.lost++;
        else stats.hands.tied++;

        // By-reason breakdown
        const reasonKey = reason === 'domino' ? 'domino' : reason === 'closed' ? 'closed' : 'blocked';
        if (winningTeam === 0) stats.hands.byReason[reasonKey].won++;
        else if (winningTeam === 1) stats.hands.byReason[reasonKey].lost++;

        // Score records
        if (winningTeam === 0 && points > 0) {
            stats.hands.largestScore = Math.max(stats.hands.largestScore, points);
        }
        if (winningTeam === 1 && points > 0) {
            stats.hands.largestSurrender = Math.max(stats.hands.largestSurrender, points);
        }

        // Deficit tracking
        if (matchScores) {
            const opponentLead = matchScores[1] - matchScores[0];
            if (opponentLead > 0) {
                this._matchSession.maxDeficit = Math.max(this._matchSession.maxDeficit, opponentLead);
            }
        }

        // Cerrado stats
        if (reason === 'closed') {
            stats.cerrado.teamTotal++;
            if (winningTeam === 0) {
                stats.cerrado.teamWon++;
                if (closingPlayer === 0) {
                    stats.cerrado.youClosed++;
                    if (points > 0) {
                        stats.cerrado.youClosedLargestScore = Math.max(stats.cerrado.youClosedLargestScore, points);
                    }
                } else if (closingPlayer === 2) stats.cerrado.partnerClosed++;
                if (points > 0) {
                    stats.cerrado.largestScore = Math.max(stats.cerrado.largestScore, points);
                }
            } else if (winningTeam === 1) {
                if (points > 0) {
                    stats.cerrado.largestSurrender = Math.max(stats.cerrado.largestSurrender, points);
                }
            }
            // Opponent-initiated cerrados (players 1 or 3 closed)
            if (closingPlayer === 1 || closingPlayer === 3) {
                stats.cerrado.opponentTotal++;
            }
        }

        // Hand overrides won: human team won despite questionable/mistake plays
        if (winningTeam === 0 && matchHistory) {
            const currentHand = matchHistory.currentHand;
            if (currentHand) {
                const hasQuestionable = currentHand.plays.some(p =>
                    p.isHuman && (p.evaluation === 'questionable' || p.evaluation === 'mistake')
                );
                if (hasQuestionable) stats.coaching.handOverridesWon++;
            }
        }

        this.save(stats);
    }

    /**
     * Record the result of a completed match.
     * @param {object} data - Match end data { winner, finalScores }
     */
    recordMatchResult(data) {
        const stats = this.get();
        const { winner, finalScores } = data;

        stats.matches.played++;
        if (winner === 0) {
            stats.matches.won++;
            stats.matches.currentStreak++;
            stats.matches.bestWinStreak = Math.max(stats.matches.bestWinStreak, stats.matches.currentStreak);

            // Win margin
            const margin = finalScores[0] - finalScores[1];
            if (margin > 0) {
                stats.matches.largestWinMargin = Math.max(stats.matches.largestWinMargin, margin);
            }

            // Comeback
            if (this._matchSession.maxDeficit >= 80) {
                stats.matches.largestDeficitOvercome = Math.max(
                    stats.matches.largestDeficitOvercome,
                    this._matchSession.maxDeficit
                );
            }

            // Zapato given (opponent scored 0)
            if (finalScores[1] === 0) stats.matches.zapatosGiven++;
        } else {
            stats.matches.lost++;
            stats.matches.currentStreak = 0;

            // Zapato received (we scored 0)
            if (finalScores[0] === 0) stats.matches.zapatosReceived++;
        }

        this.save(stats);
    }

    /**
     * Record coaching/quiz data for the completed match.
     * @param {object} humanStats - From matchHistory.getHumanStats()
     * @param {object} quizStats - From matchHistory.getQuizStats()
     */
    recordCoachingData(humanStats, quizStats) {
        const stats = this.get();

        // Genín agreement rate
        stats.coaching.geninAgreements += (humanStats.optimal || 0) + (humanStats.good || 0);
        stats.coaching.geninTotal += (humanStats.optimal || 0) + (humanStats.good || 0) +
                                      (humanStats.questionable || 0) + (humanStats.mistake || 0);

        // Quiz stats
        if (quizStats && quizStats.totalQuizzes > 0) {
            stats.coaching.quizTotalScore += quizStats.totalScore;
            stats.coaching.quizAttempts += quizStats.totalQuizzes;
            stats.coaching.bestQuizScore = Math.max(stats.coaching.bestQuizScore, quizStats.avgScore);
        }

        this.save(stats);
    }
}
