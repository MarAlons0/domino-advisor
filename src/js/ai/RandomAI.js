import { Rules } from '../engine/Rules.js';

/**
 * RandomAI - A basic AI that makes random legal moves.
 * Used for Phase 1 testing; will be replaced with smarter AI in Phase 3.
 */
export class RandomAI {
    /**
     * Choose a move for the AI player.
     * @param {Hand} hand - The AI's hand
     * @param {Chain} chain - The current chain
     * @returns {{tile: Tile, end: string}|null} The chosen move, or null if must pass
     */
    chooseMove(hand, chain) {
        const validMoves = Rules.getValidMoves(hand, chain);

        if (validMoves.length === 0) {
            return null; // Must pass
        }

        // Pick a random valid move
        const randomIndex = Math.floor(Math.random() * validMoves.length);
        return validMoves[randomIndex];
    }

    /**
     * Get the name of this AI for display purposes.
     * @returns {string}
     */
    getName() {
        return 'Random AI';
    }
}
