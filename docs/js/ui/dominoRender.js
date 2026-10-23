// Domino tile rendering shared by the game board (main.js) and the debrief
// mini-board snapshots (DebriefUI). Pure DOM/HTML helpers, no app state.

/**
 * Pip positions for each value 0-6
 */
export const PIP_POSITIONS = {
    0: [],
    1: ['center'],
    2: ['top-left', 'bottom-right'],
    3: ['top-left', 'center', 'bottom-right'],
    4: ['top-left', 'top-right', 'bottom-left', 'bottom-right'],
    5: ['top-left', 'top-right', 'center', 'bottom-left', 'bottom-right'],
    6: ['top-left', 'top-right', 'middle-left', 'middle-right', 'bottom-left', 'bottom-right']
};

/**
 * Create HTML for a domino half (one side showing pips)
 */
export function createDominoHalf(value) {
    const positions = PIP_POSITIONS[value] || [];
    const pips = positions.map(pos => `<div class="pip ${pos}"></div>`).join('');
    return `<div class="domino-half">${pips}</div>`;
}

/**
 * Create a visual domino element
 * @param {number} firstValue - Value shown on top (vertical) or left (horizontal)
 * @param {number} secondValue - Value shown on bottom (vertical) or right (horizontal)
 * @param {string} orientation - 'horizontal' or 'vertical'
 * @param {boolean} isDouble - true if this is a double
 */
export function createDominoElement(firstValue, secondValue, orientation = 'horizontal', isDouble = false) {
    const div = document.createElement('div');
    div.className = `domino ${orientation}${isDouble ? ' double' : ''}`;
    div.innerHTML = createDominoHalf(firstValue) + createDominoHalf(secondValue);
    div.dataset.tile = `${Math.max(firstValue, secondValue)}-${Math.min(firstValue, secondValue)}`;
    return div;
}

/**
 * Create a visual domino element from a Tile (for hand display)
 * @param {Tile} tile
 * @param {string} orientation - 'horizontal' or 'vertical'
 */
export function createDominoFromTile(tile, orientation = 'horizontal') {
    return createDominoElement(tile.high, tile.low, orientation, tile.isDouble());
}
