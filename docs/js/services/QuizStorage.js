/**
 * QuizStorage - Persists quiz history to localStorage for tracking improvement over time.
 *
 * Stores:
 * - Individual quiz results
 * - Accuracy trends per player position (Opp 1, Partner, Opp 2)
 * - Overall statistics
 */
export class QuizStorage {
    constructor() {
        this.storageKey = 'domino-advisor-quiz-history';
        this.maxHistory = 100; // Keep last 100 quiz results
    }

    /**
     * Get all stored quiz history
     * @returns {object} { quizzes: Array, stats: object }
     */
    getHistory() {
        try {
            const stored = localStorage.getItem(this.storageKey);
            if (stored) {
                return JSON.parse(stored);
            }
        } catch (e) {
            console.warn('QuizStorage: Error reading history', e);
        }

        return this._getEmptyHistory();
    }

    /**
     * Save a quiz result
     * @param {object} quizResult - The quiz result to save
     */
    saveQuizResult(quizResult) {
        const history = this.getHistory();

        // Add the new result
        history.quizzes.push({
            ...quizResult,
            timestamp: Date.now()
        });

        // Trim to max history
        if (history.quizzes.length > this.maxHistory) {
            history.quizzes = history.quizzes.slice(-this.maxHistory);
        }

        // Update stats
        this._updateStats(history);

        // Save
        this._save(history);
    }

    /**
     * Get accuracy statistics by player position
     * @returns {object} { overall, byPlayer: { 1: {...}, 2: {...}, 3: {...} } }
     */
    getAccuracyStats() {
        const history = this.getHistory();
        return history.stats;
    }

    /**
     * Get recent quiz results
     * @param {number} count - Number of results to return
     * @returns {Array}
     */
    getRecentQuizzes(count = 10) {
        const history = this.getHistory();
        return history.quizzes.slice(-count);
    }

    /**
     * Get quiz results for a specific match (by matchId if stored)
     * @param {string} matchId
     * @returns {Array}
     */
    getMatchQuizzes(matchId) {
        const history = this.getHistory();
        return history.quizzes.filter(q => q.matchId === matchId);
    }

    /**
     * Calculate accuracy trend (improvement over time)
     * @param {number} windowSize - Number of quizzes to compare
     * @returns {object} { recent, previous, trend }
     */
    getAccuracyTrend(windowSize = 10) {
        const history = this.getHistory();
        const quizzes = history.quizzes;

        if (quizzes.length < windowSize * 2) {
            return { recent: null, previous: null, trend: 'insufficient_data' };
        }

        const recent = quizzes.slice(-windowSize);
        const previous = quizzes.slice(-windowSize * 2, -windowSize);

        const recentAccuracy = this._calculateAccuracy(recent);
        const previousAccuracy = this._calculateAccuracy(previous);

        let trend = 'stable';
        const diff = recentAccuracy - previousAccuracy;
        if (diff > 5) trend = 'improving';
        if (diff < -5) trend = 'declining';

        return {
            recent: recentAccuracy,
            previous: previousAccuracy,
            trend: trend
        };
    }

    /**
     * Clear all quiz history
     */
    clearHistory() {
        this._save(this._getEmptyHistory());
    }

    /**
     * Get empty history structure
     * @private
     */
    _getEmptyHistory() {
        return {
            quizzes: [],
            stats: {
                overall: {
                    totalQuizzes: 0,
                    totalScore: 0,
                    avgScore: 0,
                    correctPredictions: 0,
                    wrongPredictions: 0,
                    accuracy: 0
                },
                byPlayer: {
                    1: { quizzes: 0, totalScore: 0, avgScore: 0, accuracy: 0 }, // Opp 1
                    2: { quizzes: 0, totalScore: 0, avgScore: 0, accuracy: 0 }, // Partner
                    3: { quizzes: 0, totalScore: 0, avgScore: 0, accuracy: 0 }  // Opp 2
                }
            }
        };
    }

    /**
     * Update statistics based on all quizzes
     * @private
     */
    _updateStats(history) {
        const stats = this._getEmptyHistory().stats;

        for (const quiz of history.quizzes) {
            // Overall stats
            stats.overall.totalQuizzes++;
            stats.overall.totalScore += quiz.score || 0;
            stats.overall.correctPredictions += quiz.correct || 0;
            stats.overall.wrongPredictions += quiz.wrong || 0;

            // Per-player stats
            const player = quiz.targetPlayer;
            if (player >= 1 && player <= 3) {
                stats.byPlayer[player].quizzes++;
                stats.byPlayer[player].totalScore += quiz.score || 0;
                stats.byPlayer[player].correctPredictions =
                    (stats.byPlayer[player].correctPredictions || 0) + (quiz.correct || 0);
                stats.byPlayer[player].totalPredictions =
                    (stats.byPlayer[player].totalPredictions || 0) +
                    (quiz.correct || 0) + (quiz.wrong || 0);
            }
        }

        // Calculate averages
        if (stats.overall.totalQuizzes > 0) {
            stats.overall.avgScore = Math.round(stats.overall.totalScore / stats.overall.totalQuizzes);
            const totalPredictions = stats.overall.correctPredictions + stats.overall.wrongPredictions;
            stats.overall.accuracy = totalPredictions > 0
                ? Math.round((stats.overall.correctPredictions / totalPredictions) * 100)
                : 0;
        }

        for (const player of [1, 2, 3]) {
            const p = stats.byPlayer[player];
            if (p.quizzes > 0) {
                p.avgScore = Math.round(p.totalScore / p.quizzes);
                const totalPred = (p.correctPredictions || 0) + (p.totalPredictions || 0) - (p.correctPredictions || 0);
                p.accuracy = p.totalPredictions > 0
                    ? Math.round((p.correctPredictions / p.totalPredictions) * 100)
                    : 0;
            }
        }

        history.stats = stats;
    }

    /**
     * Calculate accuracy for a set of quizzes
     * @private
     */
    _calculateAccuracy(quizzes) {
        let correct = 0;
        let total = 0;

        for (const quiz of quizzes) {
            correct += quiz.correct || 0;
            total += (quiz.correct || 0) + (quiz.wrong || 0);
        }

        return total > 0 ? Math.round((correct / total) * 100) : 0;
    }

    /**
     * Save history to localStorage
     * @private
     */
    _save(history) {
        try {
            localStorage.setItem(this.storageKey, JSON.stringify(history));
        } catch (e) {
            console.warn('QuizStorage: Error saving history', e);
        }
    }
}
