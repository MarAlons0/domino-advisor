import { Hand } from './Hand.js';
import { Chain } from './Chain.js';
import { Tile } from './Tile.js';
import { t } from '../i18n/i18n.js';

/**
 * GameState class containing the complete state of a domino game.
 *
 * Player seating:
 *   - Players 0 & 2 are Team A (partners, sit across)
 *   - Players 1 & 3 are Team B (partners, sit across)
 *   - Play direction: counter-clockwise (0 → 3 → 2 → 1 → 0)
 */
export class GameState {
    constructor() {
        /** @type {Hand[]} Four player hands */
        this.hands = [new Hand(), new Hand(), new Hand(), new Hand()];

        /** @type {Chain} The domino chain on the board */
        this.chain = new Chain();

        /** @type {number} Current player (0-3) */
        this.currentPlayer = 0;

        /** @type {number} Count of consecutive passes */
        this.consecutivePasses = 0;

        /** @type {Set<number>[]} Suits each player has passed on */
        this.passHistory = [new Set(), new Set(), new Set(), new Set()];

        /** @type {{hand: number[], match: number[]}} Scores for [TeamA, TeamB] */
        this.scores = {
            hand: [0, 0],   // Points won this hand
            match: [0, 0]   // Total match points
        };

        /** @type {'waiting'|'playing'|'handOver'|'matchOver'} */
        this.gamePhase = 'waiting';

        /** @type {number|null} Winning team (0 for A, 1 for B) or null */
        this.handWinner = null;

        /** @type {number|null} Match winner */
        this.matchWinner = null;

        /** @type {boolean} Is this the first hand of the match? */
        this.isFirstHand = true;

        /** @type {number|null} Player who won the last hand (leads next) */
        this.lastHandWinner = null;

        /** @type {string|null} How the hand ended: 'domino' | 'blocked' | null */
        this.handEndReason = null;

        /** @type {Array<{player: number, tile: Tile|null, end: string|null}>} Play history for current hand */
        this.playHistory = [];
    }

    /**
     * Get the team index for a player.
     * @param {number} player - Player index (0-3)
     * @returns {number} Team index (0 for Team A, 1 for Team B)
     */
    static getTeam(player) {
        return player % 2 === 0 ? 0 : 1;
    }

    /**
     * Get the partner of a player.
     * @param {number} player - Player index (0-3)
     * @returns {number} Partner's player index
     */
    static getPartner(player) {
        return (player + 2) % 4;
    }

    /**
     * Get the next player in counter-clockwise order.
     * Seating: You (0) at bottom, Opp 1 (1) at right, Partner (2) at top, Opp 2 (3) at left
     * Counter-clockwise from above: 0 → 1 → 2 → 3 → 0
     * @param {number} player - Current player index
     * @returns {number} Next player index
     */
    static getNextPlayer(player) {
        // Counter-clockwise: 0 → 1 → 2 → 3 → 0
        return (player + 1) % 4;
    }

    /**
     * Get team name.
     * @param {number} team - Team index (0 or 1)
     * @returns {string}
     */
    static getTeamName(team) {
        return team === 0 ? t('team.teamA') : t('team.teamB');
    }

    /**
     * Get player name.
     * @param {number} player - Player index (0-3)
     * @returns {string}
     */
    static getPlayerName(player) {
        const keys = ['player.you', 'player.opponent1', 'player.partner', 'player.opponent2'];
        return t(keys[player]);
    }

    /**
     * Advance to the next player.
     */
    nextPlayer() {
        this.currentPlayer = GameState.getNextPlayer(this.currentPlayer);
    }

    /**
     * Record a pass for the current player on the current open ends.
     */
    recordPass() {
        if (this.chain.leftEnd !== null) {
            this.passHistory[this.currentPlayer].add(this.chain.leftEnd);
        }
        if (this.chain.rightEnd !== null && this.chain.rightEnd !== this.chain.leftEnd) {
            this.passHistory[this.currentPlayer].add(this.chain.rightEnd);
        }
        this.consecutivePasses++;

        this.playHistory.push({
            player: this.currentPlayer,
            tile: null,
            end: null
        });
    }

    /**
     * Record a play.
     * @param {Tile} tile
     * @param {string} end
     */
    recordPlay(tile, end) {
        this.consecutivePasses = 0;
        this.playHistory.push({
            player: this.currentPlayer,
            tile: tile,
            end: end
        });
    }

    /**
     * Check if a player has passed on a specific value.
     * @param {number} player
     * @param {number} value
     * @returns {boolean}
     */
    hasPassedOn(player, value) {
        return this.passHistory[player].has(value);
    }

    /**
     * Get the total pip count for a team's remaining tiles.
     * @param {number} team - Team index (0 or 1)
     * @returns {number}
     */
    getTeamPipCount(team) {
        const players = team === 0 ? [0, 2] : [1, 3];
        return players.reduce((sum, p) => sum + this.hands[p].pipCount(), 0);
    }

    /**
     * Check if the game is blocked (4 consecutive passes).
     * @returns {boolean}
     */
    isBlocked() {
        return this.consecutivePasses >= 4;
    }

    /**
     * Check if any player has dominoed (empty hand).
     * @returns {number|null} Player who dominoed, or null
     */
    getDominoPlayer() {
        for (let i = 0; i < 4; i++) {
            if (this.hands[i].isEmpty()) return i;
        }
        return null;
    }

    /**
     * Reset state for a new hand.
     */
    resetForNewHand() {
        this.hands = [new Hand(), new Hand(), new Hand(), new Hand()];
        this.chain = new Chain();
        this.consecutivePasses = 0;
        this.passHistory = [new Set(), new Set(), new Set(), new Set()];
        this.scores.hand = [0, 0];
        this.gamePhase = 'playing';
        this.handWinner = null;
        this.handEndReason = null;
        this.playHistory = [];
    }

    /**
     * Reset state for a new match.
     */
    resetForNewMatch() {
        this.resetForNewHand();
        this.scores.match = [0, 0];
        this.isFirstHand = true;
        this.lastHandWinner = null;
        this.matchWinner = null;
    }

    /**
     * Create a deep copy of the game state.
     * @returns {GameState}
     */
    clone() {
        const state = new GameState();
        state.hands = this.hands.map(h => h.clone());
        state.chain = this.chain.clone();
        state.currentPlayer = this.currentPlayer;
        state.consecutivePasses = this.consecutivePasses;
        state.passHistory = this.passHistory.map(s => new Set(s));
        state.scores = {
            hand: [...this.scores.hand],
            match: [...this.scores.match]
        };
        state.gamePhase = this.gamePhase;
        state.handWinner = this.handWinner;
        state.matchWinner = this.matchWinner;
        state.isFirstHand = this.isFirstHand;
        state.lastHandWinner = this.lastHandWinner;
        state.handEndReason = this.handEndReason;
        state.playHistory = this.playHistory.map(p => ({...p}));
        return state;
    }

    /**
     * Convert state to a JSON-serializable object.
     * @returns {object}
     */
    toJSON() {
        return {
            hands: this.hands.map(h => h.getTiles().map(t => t.toKey())),
            chain: {
                placedTiles: this.chain.getPlacedTiles().map(pt => ({
                    tile: pt.tile.toKey(),
                    leftValue: pt.leftValue,
                    rightValue: pt.rightValue
                })),
                leftEnd: this.chain.leftEnd,
                rightEnd: this.chain.rightEnd,
                firstTileIndex: this.chain.firstTileIndex
            },
            currentPlayer: this.currentPlayer,
            consecutivePasses: this.consecutivePasses,
            passHistory: this.passHistory.map(s => Array.from(s)),
            scores: this.scores,
            gamePhase: this.gamePhase,
            handWinner: this.handWinner,
            matchWinner: this.matchWinner,
            isFirstHand: this.isFirstHand,
            lastHandWinner: this.lastHandWinner,
            handEndReason: this.handEndReason
        };
    }

    /**
     * Restore state from a JSON object.
     * @param {object} json
     * @returns {GameState}
     */
    static fromJSON(json) {
        const state = new GameState();

        state.hands = json.hands.map(keys => {
            const hand = new Hand();
            keys.forEach(key => hand.add(Tile.fromKey(key)));
            return hand;
        });

        state.chain = new Chain();
        json.chain.placedTiles.forEach(pt => {
            state.chain.placedTiles.push({
                tile: Tile.fromKey(pt.tile),
                leftValue: pt.leftValue,
                rightValue: pt.rightValue
            });
        });
        state.chain.leftEnd = json.chain.leftEnd;
        state.chain.rightEnd = json.chain.rightEnd;
        state.chain.firstTileIndex = json.chain.firstTileIndex ?? 0;

        state.currentPlayer = json.currentPlayer;
        state.consecutivePasses = json.consecutivePasses;
        state.passHistory = json.passHistory.map(arr => new Set(arr));
        state.scores = json.scores;
        state.gamePhase = json.gamePhase;
        state.handWinner = json.handWinner;
        state.matchWinner = json.matchWinner;
        state.isFirstHand = json.isFirstHand;
        state.lastHandWinner = json.lastHandWinner;
        state.handEndReason = json.handEndReason;

        return state;
    }
}
