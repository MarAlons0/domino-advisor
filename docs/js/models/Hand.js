import { Tile } from './Tile.js';

/**
 * Hand class representing a player's collection of tiles.
 */
export class Hand {
    constructor() {
        /** @type {Tile[]} */
        this.tiles = [];
    }

    /**
     * Add a tile to the hand.
     * @param {Tile} tile
     */
    add(tile) {
        this.tiles.push(tile);
    }

    /**
     * Remove a tile from the hand.
     * @param {Tile} tile
     * @returns {boolean} True if tile was found and removed
     */
    remove(tile) {
        const index = this.tiles.findIndex(t => t.equals(tile));
        if (index !== -1) {
            this.tiles.splice(index, 1);
            return true;
        }
        return false;
    }

    /**
     * Check if the hand contains a specific tile.
     * @param {Tile} tile
     * @returns {boolean}
     */
    has(tile) {
        return this.tiles.some(t => t.equals(tile));
    }

    /**
     * Get all tiles that can be played on a given value.
     * @param {number} value - The end value to match (0-6)
     * @returns {Tile[]}
     */
    getPlayableTiles(value) {
        return this.tiles.filter(t => t.hasValue(value));
    }

    /**
     * Get all tiles that match either of two values.
     * @param {number} value1
     * @param {number} value2
     * @returns {Tile[]}
     */
    getPlayableTilesForEnds(value1, value2) {
        return this.tiles.filter(t => t.hasValue(value1) || t.hasValue(value2));
    }

    /**
     * Check if the hand is empty.
     * @returns {boolean}
     */
    isEmpty() {
        return this.tiles.length === 0;
    }

    /**
     * Get the number of tiles in the hand.
     * @returns {number}
     */
    size() {
        return this.tiles.length;
    }

    /**
     * Calculate the total pip count of all tiles in hand.
     * @returns {number}
     */
    pipCount() {
        return this.tiles.reduce((sum, tile) => sum + tile.pipCount(), 0);
    }

    /**
     * Find the double-six tile in the hand.
     * @returns {Tile|null}
     */
    findDoubleSix() {
        return this.tiles.find(t => t.isDoubleSix()) || null;
    }

    /**
     * Get all doubles in the hand.
     * @returns {Tile[]}
     */
    getDoubles() {
        return this.tiles.filter(t => t.isDouble());
    }

    /**
     * Count how many tiles contain a specific value.
     * @param {number} value
     * @returns {number}
     */
    countSuit(value) {
        return this.tiles.filter(t => t.hasValue(value)).length;
    }

    /**
     * Get a copy of all tiles in the hand.
     * @returns {Tile[]}
     */
    getTiles() {
        return [...this.tiles];
    }

    /**
     * Sort tiles by pip count (descending).
     */
    sortByPipCount() {
        this.tiles.sort((a, b) => b.pipCount() - a.pipCount());
    }

    /**
     * Get string representation of the hand.
     * @returns {string}
     */
    toString() {
        return this.tiles.map(t => t.toString()).join(' ');
    }

    /**
     * Create a deep copy of this hand.
     * @returns {Hand}
     */
    clone() {
        const hand = new Hand();
        this.tiles.forEach(t => hand.add(new Tile(t.high, t.low)));
        return hand;
    }

    /**
     * Create a Hand from an array of tiles.
     * @param {Tile[]} tiles
     * @returns {Hand}
     */
    static fromTiles(tiles) {
        const hand = new Hand();
        tiles.forEach(t => hand.add(t));
        return hand;
    }
}
