import { GameState } from '../models/GameState.js';

/**
 * Rules engine for Mexican Partnership Dominoes.
 * Handles move validation, game end detection, and scoring.
 */
export const Rules = {
    /** Target score to win the match */
    MATCH_TARGET: 100,

    /**
     * Get all valid moves for a hand given the current chain state.
     * @param {Hand} hand
     * @param {Chain} chain
     * @param {boolean} [mustPlayDoubleSix=false] - If true, only double-six is valid (first hand rule)
     * @returns {Array<{tile: Tile, end: string}>} Array of valid moves
     */
    getValidMoves(hand, chain, mustPlayDoubleSix = false) {
        const moves = [];

        if (chain.isEmpty()) {
            // First play of a hand
            if (mustPlayDoubleSix) {
                // First hand: must play double-six
                const doubleSix = hand.findDoubleSix();
                if (doubleSix) {
                    moves.push({ tile: doubleSix, end: 'left' });
                }
                return moves;
            }
            // Subsequent hands: any tile can be played
            hand.getTiles().forEach(tile => {
                moves.push({ tile, end: 'left' });
            });
            return moves;
        }

        // Find tiles that match either end
        hand.getTiles().forEach(tile => {
            const ends = chain.getPlayableEnds(tile);
            ends.forEach(end => {
                moves.push({ tile, end });
            });
        });

        return moves;
    },

    /**
     * Check if a player must pass (no valid moves).
     * @param {Hand} hand
     * @param {Chain} chain
     * @returns {boolean}
     */
    mustPass(hand, chain) {
        return this.getValidMoves(hand, chain).length === 0;
    },

    /**
     * Check if a specific move is valid.
     * @param {Tile} tile
     * @param {string} end
     * @param {Hand} hand
     * @param {Chain} chain
     * @returns {boolean}
     */
    isValidMove(tile, end, hand, chain) {
        // Player must have the tile
        if (!hand.has(tile)) return false;

        // Check if tile can be played on the specified end
        if (chain.isEmpty()) return true;

        const playableEnds = chain.getPlayableEnds(tile);
        return playableEnds.includes(end);
    },

    /**
     * Find the player who has the double-six.
     * @param {Hand[]} hands - Array of 4 hands
     * @returns {number} Player index (0-3), or -1 if not found
     */
    findDoubleSix(hands) {
        for (let i = 0; i < hands.length; i++) {
            if (hands[i].findDoubleSix()) {
                return i;
            }
        }
        return -1;
    },

    /**
     * Check if the hand is over.
     * @param {Hand[]} hands
     * @param {number} consecutivePasses
     * @param {Chain} [chain] - The chain (needed to detect closed games)
     * @param {number} [currentPlayer] - Player who just played (for closed game attribution)
     * @returns {{isOver: boolean, reason: string|null, dominoPlayer: number|null, closingPlayer: number|null}}
     */
    checkHandOver(hands, consecutivePasses, chain = null, currentPlayer = null) {
        // Check for domino (player emptied their hand)
        for (let i = 0; i < hands.length; i++) {
            if (hands[i].isEmpty()) {
                return { isOver: true, reason: 'domino', dominoPlayer: i, closingPlayer: null };
            }
        }

        // Check for closed game (cerrado) - both ends same value and all of that value played
        if (chain && chain.isClosed()) {
            return { isOver: true, reason: 'closed', dominoPlayer: null, closingPlayer: currentPlayer };
        }

        // Check for blocked game (4 consecutive passes)
        if (consecutivePasses >= 4) {
            return { isOver: true, reason: 'blocked', dominoPlayer: null, closingPlayer: null };
        }

        return { isOver: false, reason: null, dominoPlayer: null, closingPlayer: null };
    },

    /**
     * Calculate the winning team and score for a completed hand.
     * @param {Hand[]} hands
     * @param {string} reason - 'domino', 'blocked', or 'closed'
     * @param {number|null} dominoPlayer - Player who dominoed (if applicable)
     * @param {number|null} closingPlayer - Player who closed the game (if applicable)
     * @returns {{winningTeam: number, points: number}}
     */
    calculateHandResult(hands, reason, dominoPlayer, closingPlayer = null) {
        if (reason === 'domino') {
            // Winning team is the domino player's team
            const winningTeam = GameState.getTeam(dominoPlayer);
            const losingTeam = 1 - winningTeam;

            // Score is the pip count of the losing team's remaining tiles
            const losingPlayers = losingTeam === 0 ? [0, 2] : [1, 3];
            const points = losingPlayers.reduce((sum, p) => sum + hands[p].pipCount(), 0);

            return { winningTeam, points };
        }

        if (reason === 'closed' || reason === 'blocked') {
            // Count pip totals for each team
            const teamAPips = hands[0].pipCount() + hands[2].pipCount();
            const teamBPips = hands[1].pipCount() + hands[3].pipCount();

            if (teamAPips < teamBPips) {
                // Team A wins, scores Team B's pips
                return { winningTeam: 0, points: teamBPips };
            } else if (teamBPips < teamAPips) {
                // Team B wins, scores Team A's pips
                return { winningTeam: 1, points: teamAPips };
            } else {
                // Tie - in a closed game, the closing team wins
                // In a blocked game, no winner
                if (reason === 'closed' && closingPlayer !== null) {
                    const closingTeam = GameState.getTeam(closingPlayer);
                    const losingTeam = 1 - closingTeam;
                    const losingPlayers = losingTeam === 0 ? [0, 2] : [1, 3];
                    const points = losingPlayers.reduce((sum, p) => sum + hands[p].pipCount(), 0);
                    return { winningTeam: closingTeam, points };
                }
                return { winningTeam: -1, points: 0 };
            }
        }

        throw new Error(`Unknown hand end reason: ${reason}`);
    },

    /**
     * Check if the match is over (team reached target score).
     * @param {number[]} matchScores - [TeamA score, TeamB score]
     * @returns {{isOver: boolean, winner: number|null}}
     */
    checkMatchOver(matchScores) {
        if (matchScores[0] >= this.MATCH_TARGET) {
            return { isOver: true, winner: 0 };
        }
        if (matchScores[1] >= this.MATCH_TARGET) {
            return { isOver: true, winner: 1 };
        }
        return { isOver: false, winner: null };
    },

    /**
     * Get the player who should start the next hand.
     * @param {number} lastWinningTeam - Team that won (0 or 1)
     * @param {number|null} dominoPlayer - Player who dominoed, if any
     * @param {boolean} isFirstHand - Is this the first hand of match?
     * @returns {number} Starting player index
     */
    getStartingPlayer(lastWinningTeam, dominoPlayer, isFirstHand) {
        if (isFirstHand) {
            // First hand: player with double-six (determined during dealing)
            return -1; // Signal that we need to find double-six
        }

        // Subsequent hands: the player who dominoed leads
        // Or if blocked, either player from winning team can lead (we'll use lower index)
        if (dominoPlayer !== null) {
            return dominoPlayer;
        }

        // Blocked game: first player of winning team leads
        return lastWinningTeam === 0 ? 0 : 1;
    }
};
