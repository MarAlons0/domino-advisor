import { Hand } from '../models/Hand.js';
import { TileSet } from './TileSet.js';

/**
 * Dealer utility for dealing tiles to players.
 */
export const Dealer = {
    /**
     * Deal tiles to 4 players (7 tiles each).
     * @param {Tile[]} [tiles] - Optional array of 28 tiles. If not provided, creates new shuffled set.
     * @returns {Hand[]} Array of 4 hands
     */
    deal(tiles) {
        if (!tiles) {
            tiles = TileSet.createShuffled();
        }

        if (tiles.length !== 28) {
            throw new Error(`Expected 28 tiles, got ${tiles.length}`);
        }

        const hands = [new Hand(), new Hand(), new Hand(), new Hand()];

        for (let i = 0; i < 28; i++) {
            const player = Math.floor(i / 7);
            hands[player].add(tiles[i]);
        }

        return hands;
    },

    /**
     * Deal tiles and return the player who has the double-six.
     * @returns {{hands: Hand[], starterPlayer: number}}
     */
    dealForFirstHand() {
        const tiles = TileSet.createShuffled();
        const hands = this.deal(tiles);

        // Find who has the double-six
        let starterPlayer = -1;
        for (let i = 0; i < 4; i++) {
            if (hands[i].findDoubleSix()) {
                starterPlayer = i;
                break;
            }
        }

        return { hands, starterPlayer };
    }
};
