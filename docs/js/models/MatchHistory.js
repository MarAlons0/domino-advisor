import { GameState } from './GameState.js';

/**
 * MatchHistory - Tracks all plays across the entire match for debrief analysis.
 *
 * Data Structure:
 * {
 *   hands: [{
 *     handNumber: number,
 *     startingPlayer: number,
 *     plays: [{
 *       player: number,
 *       tile: Tile | null,
 *       end: string | null,
 *       timestamp: number,
 *       stateSnapshot: { chain, leftEnd, rightEnd, handSizes, matchScores },
 *       aiRecommendation: { tile, end, reasoning, score } | null,
 *       actualReasoning: string | null,
 *       isHuman: boolean,
 *       evaluation: 'optimal' | 'good' | 'questionable' | 'mistake' | null
 *     }],
 *     quizResults: [{
 *       playIndex: number,
 *       targetPlayer: number,
 *       userPrediction: string[],
 *       actualHand: string[],
 *       score: number,
 *       correct: number,
 *       wrong: number,
 *       missed: number,
 *       timestamp: number
 *     }],
 *     result: { reason, winner, points, finalHands }
 *   }]
 * }
 */
export class MatchHistory {
    constructor() {
        this.hands = [];
        this.currentHand = null;
    }

    /**
     * Start tracking a new hand
     * @param {number} handNumber
     * @param {number} startingPlayer
     */
    startHand(handNumber, startingPlayer) {
        this.currentHand = {
            handNumber: handNumber,
            startingPlayer: startingPlayer,
            plays: [],
            quizResults: [],
            result: null
        };
        this.hands.push(this.currentHand);
    }

    /**
     * Record a play in the current hand
     * @param {object} playRecord
     */
    recordPlay(playRecord) {
        if (!this.currentHand) {
            console.warn('MatchHistory: No current hand to record play');
            return;
        }

        const record = {
            player: playRecord.player,
            tile: playRecord.tile,
            end: playRecord.end,
            timestamp: Date.now(),
            stateSnapshot: playRecord.stateSnapshot || null,
            aiRecommendation: playRecord.aiRecommendation || null,
            actualReasoning: playRecord.actualReasoning || null,
            isHuman: playRecord.isHuman || false,
            evaluation: null // Will be set by evaluateHumanPlays()
        };

        // Evaluate human plays immediately
        if (record.isHuman && record.aiRecommendation && record.tile) {
            record.evaluation = this._evaluatePlay(record);
        }

        this.currentHand.plays.push(record);
    }

    /**
     * End the current hand with results
     * @param {object} result - { reason, winner, points, finalHands }
     */
    endHand(result) {
        if (!this.currentHand) {
            console.warn('MatchHistory: No current hand to end');
            return;
        }

        this.currentHand.result = {
            reason: result.reason,
            winner: result.winner,
            points: result.points,
            finalHands: result.finalHands
        };
    }

    /**
     * Evaluate a single human play against AI recommendation
     * @param {object} record - The play record
     * @returns {string} 'optimal' | 'good' | 'questionable' | 'mistake'
     */
    _evaluatePlay(record) {
        const { tile, end, aiRecommendation } = record;

        if (!aiRecommendation || !aiRecommendation.tile) {
            return null;
        }

        const recTile = aiRecommendation.tile;
        const recEnd = aiRecommendation.end;
        const recScore = aiRecommendation.score || 0;

        // Same tile and end = optimal
        if (tile.equals(recTile) && end === recEnd) {
            return 'optimal';
        }

        // Same tile, different end = good
        if (tile.equals(recTile)) {
            return 'good';
        }

        // Different tile - need to calculate score difference
        // We don't have the played tile's score, so estimate based on recommendation
        // For now, we'll use a heuristic based on tile similarity

        // Check if played tile shares a value with recommended tile
        const sharedValue = tile.hasValue(recTile.high) || tile.hasValue(recTile.low);

        // If score is provided in state snapshot, use it for comparison
        if (record.stateSnapshot && record.stateSnapshot.playedScore !== undefined) {
            const scoreDiff = recScore - record.stateSnapshot.playedScore;

            if (scoreDiff <= 10) {
                return 'good';
            } else if (scoreDiff <= 25) {
                return 'questionable';
            } else {
                return 'mistake';
            }
        }

        // Heuristic: if tiles share a value, probably not too bad
        if (sharedValue) {
            return 'questionable';
        }

        return 'mistake';
    }

    /**
     * Evaluate all human plays in the match history
     * Called at the end of a match or for debrief
     */
    evaluateHumanPlays() {
        for (const hand of this.hands) {
            for (const play of hand.plays) {
                if (play.isHuman && play.tile && play.aiRecommendation && !play.evaluation) {
                    play.evaluation = this._evaluatePlay(play);
                }
            }
        }
    }

    /**
     * Get statistics for human plays
     * @returns {object} { optimal, good, questionable, mistake, total }
     */
    getHumanStats() {
        const stats = {
            optimal: 0,
            good: 0,
            questionable: 0,
            mistake: 0,
            total: 0,
            passes: 0
        };

        for (const hand of this.hands) {
            for (const play of hand.plays) {
                if (play.isHuman) {
                    if (play.tile === null) {
                        stats.passes++;
                    } else if (play.evaluation) {
                        stats[play.evaluation]++;
                        stats.total++;
                    }
                }
            }
        }

        return stats;
    }

    /**
     * Get key moments (mistakes and questionable plays)
     * @returns {Array} Array of { handNumber, playIndex, play }
     */
    getKeyMoments() {
        const moments = [];

        for (const hand of this.hands) {
            for (let i = 0; i < hand.plays.length; i++) {
                const play = hand.plays[i];
                if (play.isHuman && (play.evaluation === 'mistake' || play.evaluation === 'questionable')) {
                    moments.push({
                        handNumber: hand.handNumber,
                        playIndex: i,
                        play: play
                    });
                }
            }
        }

        return moments;
    }

    /**
     * Get highlight plays (human plays graded optimal/good). Used by the
     * post-match Claude analysis to balance the mistakes view with the
     * player's actual strengths. Returns at most `limit` entries to keep
     * the prompt focused.
     * @param {number} [limit=3]
     * @returns {Array} Array of { handNumber, playIndex, play }
     */
    getHighlightMoments(limit = 3) {
        const moments = [];
        for (const hand of this.hands) {
            for (let i = 0; i < hand.plays.length; i++) {
                const play = hand.plays[i];
                if (play.isHuman && (play.evaluation === 'optimal' || play.evaluation === 'good')) {
                    moments.push({
                        handNumber: hand.handNumber,
                        playIndex: i,
                        play: play,
                    });
                }
            }
        }
        // Optimal first, then good; preserve play order within each tier.
        moments.sort((a, b) => {
            if (a.play.evaluation === b.play.evaluation) return 0;
            return a.play.evaluation === 'optimal' ? -1 : 1;
        });
        return moments.slice(0, limit);
    }

    /**
     * Get all human plays with their evaluations
     * @returns {Array}
     */
    getHumanPlays() {
        const plays = [];

        for (const hand of this.hands) {
            for (let i = 0; i < hand.plays.length; i++) {
                const play = hand.plays[i];
                if (play.isHuman) {
                    plays.push({
                        handNumber: hand.handNumber,
                        playIndex: i,
                        play: play
                    });
                }
            }
        }

        return plays;
    }

    /**
     * Get the number of hands played
     * @returns {number}
     */
    getHandCount() {
        return this.hands.length;
    }

    /**
     * Get a specific hand's data
     * @param {number} handNumber
     * @returns {object|null}
     */
    getHand(handNumber) {
        return this.hands.find(h => h.handNumber === handNumber) || null;
    }

    /**
     * Record a quiz result for the current hand
     * @param {object} quizResult - { targetPlayer, userPrediction, actualHand, score, correct, wrong, missed }
     */
    recordQuizResult(quizResult) {
        if (!this.currentHand) {
            console.warn('MatchHistory: No current hand to record quiz');
            return;
        }

        const record = {
            playIndex: this.currentHand.plays.length,
            targetPlayer: quizResult.targetPlayer,
            userPrediction: quizResult.userPrediction,
            actualHand: quizResult.actualHand,
            score: quizResult.score,
            correct: quizResult.correct,
            wrong: quizResult.wrong,
            missed: quizResult.missed,
            timestamp: Date.now()
        };

        this.currentHand.quizResults.push(record);
    }

    /**
     * Get all quiz results for the match
     * @returns {Array}
     */
    getQuizResults() {
        const results = [];
        for (const hand of this.hands) {
            for (const quiz of (hand.quizResults || [])) {
                results.push({
                    handNumber: hand.handNumber,
                    ...quiz
                });
            }
        }
        return results;
    }

    /**
     * Get quiz statistics for the match
     * @returns {object}
     */
    getQuizStats() {
        const results = this.getQuizResults();

        if (results.length === 0) {
            return {
                totalQuizzes: 0,
                totalScore: 0,
                avgScore: 0,
                totalCorrect: 0,
                totalWrong: 0,
                totalMissed: 0,
                accuracy: 0
            };
        }

        let totalScore = 0;
        let totalCorrect = 0;
        let totalWrong = 0;
        let totalMissed = 0;

        for (const quiz of results) {
            totalScore += quiz.score || 0;
            totalCorrect += quiz.correct || 0;
            totalWrong += quiz.wrong || 0;
            totalMissed += quiz.missed || 0;
        }

        const totalPredictions = totalCorrect + totalWrong;
        const accuracy = totalPredictions > 0
            ? Math.round((totalCorrect / totalPredictions) * 100)
            : 0;

        return {
            totalQuizzes: results.length,
            totalScore: totalScore,
            avgScore: Math.round(totalScore / results.length),
            totalCorrect: totalCorrect,
            totalWrong: totalWrong,
            totalMissed: totalMissed,
            accuracy: accuracy
        };
    }

    /**
     * Reset for a new match
     */
    reset() {
        this.hands = [];
        this.currentHand = null;
    }

    /**
     * Serialize match history for API calls
     * @returns {object}
     */
    toJSON() {
        return {
            hands: this.hands.map(hand => ({
                handNumber: hand.handNumber,
                startingPlayer: hand.startingPlayer,
                plays: hand.plays.map(play => ({
                    player: play.player,
                    playerName: GameState.getPlayerName(play.player),
                    tile: play.tile ? play.tile.toString() : null,
                    end: play.end,
                    isHuman: play.isHuman,
                    evaluation: play.evaluation,
                    aiRecommendation: play.aiRecommendation ? {
                        tile: play.aiRecommendation.tile ? play.aiRecommendation.tile.toString() : null,
                        end: play.aiRecommendation.end,
                        reasoning: play.aiRecommendation.reasoning
                    } : null
                })),
                result: hand.result ? {
                    reason: hand.result.reason,
                    winner: hand.result.winner,
                    winnerName: hand.result.winner >= 0 ? GameState.getTeamName(hand.result.winner) : 'Tie',
                    points: hand.result.points
                } : null
            }))
        };
    }
}
