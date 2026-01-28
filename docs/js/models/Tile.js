/**
 * Tile class representing a single domino tile.
 * Tiles are stored in canonical form with high >= low.
 */
export class Tile {
    /**
     * Create a new tile.
     * @param {number} a - First pip value (0-6)
     * @param {number} b - Second pip value (0-6)
     */
    constructor(a, b) {
        // Store in canonical form: high >= low
        this.high = Math.max(a, b);
        this.low = Math.min(a, b);
    }

    /**
     * Check if this tile is a double.
     * @returns {boolean}
     */
    isDouble() {
        return this.high === this.low;
    }

    /**
     * Check if this tile has a specific value on either end.
     * @param {number} value - The value to check for (0-6)
     * @returns {boolean}
     */
    hasValue(value) {
        return this.high === value || this.low === value;
    }

    /**
     * Get the other value on the tile given one end.
     * @param {number} value - The known value
     * @returns {number} The other value, or -1 if value not on tile
     */
    getOtherValue(value) {
        if (this.high === value) return this.low;
        if (this.low === value) return this.high;
        return -1;
    }

    /**
     * Get the total pip count of this tile.
     * @returns {number}
     */
    pipCount() {
        return this.high + this.low;
    }

    /**
     * Get a string representation of this tile.
     * @returns {string} Format: "[high|low]"
     */
    toString() {
        return `[${this.high}|${this.low}]`;
    }

    /**
     * Check if this tile equals another tile.
     * @param {Tile} other - The tile to compare
     * @returns {boolean}
     */
    equals(other) {
        if (!other) return false;
        return this.high === other.high && this.low === other.low;
    }

    /**
     * Create a unique key for this tile (useful for maps/sets).
     * @returns {string}
     */
    toKey() {
        return `${this.high}-${this.low}`;
    }

    /**
     * Create a Tile from a key string.
     * @param {string} key - Format: "high-low"
     * @returns {Tile}
     */
    static fromKey(key) {
        const [high, low] = key.split('-').map(Number);
        return new Tile(high, low);
    }

    /**
     * Generate all 28 tiles in a double-six set.
     * @returns {Tile[]}
     */
    static createFullSet() {
        const tiles = [];
        for (let high = 0; high <= 6; high++) {
            for (let low = 0; low <= high; low++) {
                tiles.push(new Tile(high, low));
            }
        }
        return tiles;
    }

    /**
     * Check if this is the double-six tile.
     * @returns {boolean}
     */
    isDoubleSix() {
        return this.high === 6 && this.low === 6;
    }
}
