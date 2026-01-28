import { Tile } from './Tile.js';

/**
 * Represents a tile placed on the chain with its display orientation.
 * @typedef {Object} PlacedTile
 * @property {Tile} tile - The tile
 * @property {number} leftValue - Value shown on left side (toward left end of chain)
 * @property {number} rightValue - Value shown on right side (toward right end of chain)
 */

/**
 * Chain class representing the domino chain on the board.
 * Tracks played tiles with their correct display orientation.
 */
export class Chain {
    constructor() {
        /** @type {PlacedTile[]} */
        this.placedTiles = [];
        /** @type {number|null} */
        this.leftEnd = null;
        /** @type {number|null} */
        this.rightEnd = null;
    }

    /**
     * Check if the chain is empty.
     * @returns {boolean}
     */
    isEmpty() {
        return this.placedTiles.length === 0;
    }

    /**
     * Check if a tile can be played on the chain.
     * @param {Tile} tile
     * @returns {boolean}
     */
    canPlay(tile) {
        if (this.isEmpty()) return true;
        return tile.hasValue(this.leftEnd) || tile.hasValue(this.rightEnd);
    }

    /**
     * Get which ends a tile can be played on.
     * @param {Tile} tile
     * @returns {string[]} Array of 'left', 'right', or both
     */
    getPlayableEnds(tile) {
        if (this.isEmpty()) return ['left']; // First tile only needs one placement

        const ends = [];
        if (tile.hasValue(this.leftEnd)) ends.push('left');
        if (tile.hasValue(this.rightEnd)) ends.push('right');

        // If both ends have same value, only return one option
        if (this.leftEnd === this.rightEnd && ends.length === 2) {
            return ['left'];
        }

        return ends;
    }

    /**
     * Play a tile on the chain.
     * @param {Tile} tile - The tile to play
     * @param {string} end - 'left' or 'right'
     * @returns {boolean} True if play was successful
     */
    play(tile, end) {
        if (this.isEmpty()) {
            // First tile - by convention, low on left, high on right
            this.placedTiles.push({
                tile: tile,
                leftValue: tile.low,
                rightValue: tile.high
            });
            this.leftEnd = tile.low;
            this.rightEnd = tile.high;
            return true;
        }

        if (end === 'left') {
            if (!tile.hasValue(this.leftEnd)) return false;

            // The matching value connects to the chain (on the right side of this tile)
            // The other value becomes the new left end
            const connectingValue = this.leftEnd;
            const newLeftEnd = tile.getOtherValue(connectingValue);

            this.placedTiles.unshift({
                tile: tile,
                leftValue: newLeftEnd,
                rightValue: connectingValue
            });
            this.leftEnd = newLeftEnd;

        } else if (end === 'right') {
            if (!tile.hasValue(this.rightEnd)) return false;

            // The matching value connects to the chain (on the left side of this tile)
            // The other value becomes the new right end
            const connectingValue = this.rightEnd;
            const newRightEnd = tile.getOtherValue(connectingValue);

            this.placedTiles.push({
                tile: tile,
                leftValue: connectingValue,
                rightValue: newRightEnd
            });
            this.rightEnd = newRightEnd;

        } else {
            return false;
        }

        return true;
    }

    /**
     * Get the number of tiles in the chain.
     * @returns {number}
     */
    size() {
        return this.placedTiles.length;
    }

    /**
     * Get all tiles in the chain (just the Tile objects).
     * @returns {Tile[]}
     */
    getTiles() {
        return this.placedTiles.map(pt => pt.tile);
    }

    /**
     * Get all placed tiles with their orientation info.
     * @returns {PlacedTile[]}
     */
    getPlacedTiles() {
        return [...this.placedTiles];
    }

    /**
     * Get string representation of the chain.
     * @returns {string}
     */
    toString() {
        if (this.isEmpty()) return '(empty)';
        const tileStr = this.placedTiles.map(pt => `[${pt.leftValue}|${pt.rightValue}]`).join('-');
        return `<${this.leftEnd}> ${tileStr} <${this.rightEnd}>`;
    }

    /**
     * Get a simple visual representation showing just the ends.
     * @returns {string}
     */
    toEndString() {
        if (this.isEmpty()) return '[ ]';
        return `[${this.leftEnd}] ... (${this.placedTiles.length} tiles) ... [${this.rightEnd}]`;
    }

    /**
     * Create a deep copy of this chain.
     * @returns {Chain}
     */
    clone() {
        const chain = new Chain();
        this.placedTiles.forEach(pt => {
            chain.placedTiles.push({
                tile: new Tile(pt.tile.high, pt.tile.low),
                leftValue: pt.leftValue,
                rightValue: pt.rightValue
            });
        });
        chain.leftEnd = this.leftEnd;
        chain.rightEnd = this.rightEnd;
        return chain;
    }

    /**
     * Count how many times a value appears in played tiles.
     * @param {number} value
     * @returns {number}
     */
    countValue(value) {
        let count = 0;
        this.placedTiles.forEach(pt => {
            const t = pt.tile;
            if (t.high === value) count++;
            if (t.low === value && !t.isDouble()) count++;
        });
        return count;
    }

    /**
     * Check if a value is "dead" (all 7 instances have been played).
     * @param {number} value
     * @returns {boolean}
     */
    isValueDead(value) {
        return this.countValue(value) >= 7;
    }

    /**
     * Check if the game is "closed" (cerrado).
     * A game is closed when both ends have the same value and that value is dead.
     * @returns {boolean}
     */
    isClosed() {
        if (this.isEmpty()) return false;
        if (this.leftEnd !== this.rightEnd) return false;
        return this.isValueDead(this.leftEnd);
    }
}
