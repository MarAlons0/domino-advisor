import { Tile } from '../models/Tile.js';

/**
 * TileSet utility for creating and shuffling domino tiles.
 */
export const TileSet = {
    /**
     * Create a complete double-six set (28 tiles).
     * @returns {Tile[]}
     */
    create() {
        return Tile.createFullSet();
    },

    /**
     * Shuffle an array of tiles using Fisher-Yates algorithm.
     * @param {Tile[]} tiles - Array to shuffle (modified in place)
     * @returns {Tile[]} The same array, shuffled
     */
    shuffle(tiles) {
        for (let i = tiles.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [tiles[i], tiles[j]] = [tiles[j], tiles[i]];
        }
        return tiles;
    },

    /**
     * Create a shuffled double-six set.
     * @returns {Tile[]}
     */
    createShuffled() {
        return this.shuffle(this.create());
    }
};
