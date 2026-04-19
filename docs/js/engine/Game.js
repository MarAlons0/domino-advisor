import { GameState } from '../models/GameState.js';
import { Dealer } from './Dealer.js';
import { Rules } from './Rules.js';
import { Tile } from '../models/Tile.js';
import { MatchHistory } from '../models/MatchHistory.js';

/**
 * Game controller for Mexican Partnership Dominoes.
 * Orchestrates gameplay, manages state, and provides event callbacks.
 */
export class Game {
    constructor() {
        /** @type {GameState} */
        this.state = new GameState();

        /** @type {MatchHistory} */
        this.matchHistory = new MatchHistory();

        /** @type {number} */
        this.handNumber = 0;

        // Event callbacks
        this.onStateChange = null;
        this.onPlay = null;
        this.onPass = null;
        this.onHandEnd = null;
        this.onMatchEnd = null;
        this.onError = null;
    }

    /**
     * Start a new match.
     */
    newMatch() {
        this.state.resetForNewMatch();
        this.matchHistory.reset();
        this.handNumber = 0;
        this.newHand();
        this._emitStateChange();
    }

    /**
     * Start a new hand within the match.
     */
    newHand() {
        this.state.resetForNewHand();

        if (this.state.isFirstHand) {
            // First hand: deal and find double-six holder
            const { hands, starterPlayer } = Dealer.dealForFirstHand();
            this.state.hands = hands;
            this.state.currentPlayer = starterPlayer;
        } else {
            // Subsequent hands: deal normally, winner of last hand leads
            this.state.hands = Dealer.deal();

            // Starting player is from winning team
            // The player who dominoed, or first player of winning team if blocked
            if (this.state.lastHandWinner !== null) {
                this.state.currentPlayer = this.state.lastHandWinner;
            } else {
                // Fallback to player 0
                this.state.currentPlayer = 0;
            }
        }

        this.state.gamePhase = 'playing';

        // Start tracking this hand
        this.handNumber++;
        this.matchHistory.startHand(this.handNumber, this.state.currentPlayer);

        this._emitStateChange();
    }

    /**
     * Execute a play for the current player.
     * @param {Tile} tile - The tile to play
     * @param {string} end - 'left' or 'right'
     * @param {object} [options] - Optional parameters
     * @param {object} [options.aiRecommendation] - AI recommendation for this play (for human moves)
     * @param {string} [options.reasoning] - AI reasoning for this play (for AI moves)
     * @returns {boolean} True if play was successful
     */
    playTurn(tile, end, options = {}) {
        if (this.state.gamePhase !== 'playing') {
            this._emitError('Game is not in playing phase');
            return false;
        }

        const hand = this.state.hands[this.state.currentPlayer];
        const chain = this.state.chain;

        // Capture the open ends BEFORE the play (for logging)
        const leftEndBefore = chain.leftEnd;
        const rightEndBefore = chain.rightEnd;
        const wasEmpty = chain.isEmpty();

        // Validate the move
        if (!Rules.isValidMove(tile, end, hand, chain)) {
            this._emitError('Invalid move');
            return false;
        }

        // Capture state snapshot before play
        const stateSnapshot = this._captureStateSnapshot();

        // Execute the play
        hand.remove(tile);
        chain.play(tile, end, this.state.currentPlayer);
        this.state.recordPlay(tile, end);

        // Record play in match history
        const isHuman = this.state.currentPlayer === 0;
        this.matchHistory.recordPlay({
            player: this.state.currentPlayer,
            tile: tile,
            end: end,
            stateSnapshot: stateSnapshot,
            aiRecommendation: options.aiRecommendation || null,
            actualReasoning: options.reasoning || null,
            isHuman: isHuman
        });

        // Emit play event with open ends info
        if (this.onPlay) {
            this.onPlay({
                player: this.state.currentPlayer,
                tile: tile,
                end: end,
                chain: chain.toString(),
                openEndsBefore: wasEmpty ? null : { left: leftEndBefore, right: rightEndBefore },
                reasoning: options.reasoning || null
            });
        }

        // Check if hand is over (pass chain and current player for closed game detection)
        const handResult = Rules.checkHandOver(
            this.state.hands,
            this.state.consecutivePasses,
            this.state.chain,
            this.state.currentPlayer
        );
        if (handResult.isOver) {
            this._endHand(handResult.reason, handResult.dominoPlayer, handResult.closingPlayer);
            return true;
        }

        // Move to next player
        this.state.nextPlayer();
        this._emitStateChange();
        return true;
    }

    /**
     * Current player passes their turn.
     * @returns {boolean} True if pass was valid
     */
    pass() {
        if (this.state.gamePhase !== 'playing') {
            this._emitError('Game is not in playing phase');
            return false;
        }

        const hand = this.state.hands[this.state.currentPlayer];
        const chain = this.state.chain;

        // Validate that player must pass (no valid moves)
        if (!Rules.mustPass(hand, chain)) {
            this._emitError('Cannot pass when valid moves are available');
            return false;
        }

        // Record the pass
        this.state.recordPass();

        // Record pass in match history
        const stateSnapshot = this._captureStateSnapshot();
        const isHuman = this.state.currentPlayer === 0;
        this.matchHistory.recordPlay({
            player: this.state.currentPlayer,
            tile: null,
            end: null,
            stateSnapshot: stateSnapshot,
            aiRecommendation: null,
            actualReasoning: 'No valid moves',
            isHuman: isHuman
        });

        // Emit pass event
        if (this.onPass) {
            this.onPass({
                player: this.state.currentPlayer,
                consecutivePasses: this.state.consecutivePasses
            });
        }

        // Check if hand is over (4 consecutive passes = blocked)
        const handResult = Rules.checkHandOver(this.state.hands, this.state.consecutivePasses);
        if (handResult.isOver) {
            this._endHand(handResult.reason, handResult.dominoPlayer);
            return true;
        }

        // Move to next player
        this.state.nextPlayer();
        this._emitStateChange();
        return true;
    }

    /**
     * Get valid moves for the current player.
     * @returns {Array<{tile: Tile, end: string}>}
     */
    getValidMoves() {
        const hand = this.state.hands[this.state.currentPlayer];
        // On first hand with empty chain, must play double-six
        const mustPlayDoubleSix = this.state.isFirstHand && this.state.chain.isEmpty();
        return Rules.getValidMoves(hand, this.state.chain, mustPlayDoubleSix);
    }

    /**
     * Check if current player must pass.
     * @returns {boolean}
     */
    mustPass() {
        return this.getValidMoves().length === 0;
    }

    /**
     * Get the current player's hand.
     * @returns {Hand}
     */
    getCurrentPlayerHand() {
        return this.state.hands[this.state.currentPlayer];
    }

    /**
     * Get the human player's hand (player 0).
     * @returns {Hand}
     */
    getHumanHand() {
        return this.state.hands[0];
    }

    /**
     * Check if it's the human player's turn.
     * @returns {boolean}
     */
    isHumanTurn() {
        return this.state.currentPlayer === 0 && this.state.gamePhase === 'playing';
    }

    /**
     * Get the current game state.
     * @returns {GameState}
     */
    getState() {
        return this.state;
    }

    /**
     * End the current hand and calculate results.
     * @private
     */
    _endHand(reason, dominoPlayer, closingPlayer = null) {
        this.state.gamePhase = 'handOver';
        this.state.handEndReason = reason;

        // Calculate result
        const result = Rules.calculateHandResult(this.state.hands, reason, dominoPlayer, closingPlayer);
        this.state.handWinner = result.winningTeam;

        if (result.winningTeam >= 0) {
            this.state.scores.hand[result.winningTeam] = result.points;
            this.state.scores.match[result.winningTeam] += result.points;
        }

        // Remember who leads next hand
        if (dominoPlayer !== null) {
            // Domino: the player who dominoed leads
            this.state.lastHandWinner = dominoPlayer;
        } else if (reason === 'closed' && closingPlayer !== null) {
            // Cerrar: closer leads if their team won; opponent immediately after closer leads if their team lost
            const closingTeam = GameState.getTeam(closingPlayer);
            if (result.winningTeam === closingTeam) {
                this.state.lastHandWinner = closingPlayer;
            } else {
                this.state.lastHandWinner = (closingPlayer + 1) % 4;
            }
        } else if (result.winningTeam >= 0) {
            // Blocked: first player of winning team leads
            this.state.lastHandWinner = result.winningTeam === 0 ? 0 : 1;
        }

        this.state.isFirstHand = false;

        // Record hand end in match history
        this.matchHistory.endHand({
            reason: reason,
            winner: result.winningTeam,
            points: result.points,
            finalHands: this.state.hands.map(h => ({
                tiles: h.getTiles().map(t => t.toString()),
                pipCount: h.pipCount()
            }))
        });

        // Check if match is over before emitting hand end event
        const matchResult = Rules.checkMatchOver(this.state.scores.match);
        if (matchResult.isOver) {
            // Skip hand-end modal and go straight to match-end so Play Analysis isn't displaced
            this._endMatch(matchResult.winner);
        } else {
            if (this.onHandEnd) {
                this.onHandEnd({
                    reason: reason,
                    dominoPlayer: dominoPlayer,
                    closingPlayer: closingPlayer,
                    winningTeam: result.winningTeam,
                    points: result.points,
                    matchScores: [...this.state.scores.match]
                });
            }
            this._emitStateChange();
        }
    }

    /**
     * End the match.
     * @private
     */
    _endMatch(winner) {
        this.state.gamePhase = 'matchOver';
        this.state.matchWinner = winner;

        if (this.onMatchEnd) {
            this.onMatchEnd({
                winner: winner,
                finalScores: [...this.state.scores.match]
            });
        }

        this._emitStateChange();
    }

    /**
     * Emit state change event.
     * @private
     */
    _emitStateChange() {
        if (this.onStateChange) {
            this.onStateChange(this.state);
        }
    }

    /**
     * Emit error event.
     * @private
     */
    _emitError(message) {
        if (this.onError) {
            this.onError(message);
        } else {
            console.error('Game error:', message);
        }
    }

    /**
     * Capture current state snapshot for history tracking.
     * @private
     * @returns {object}
     */
    _captureStateSnapshot() {
        const chain = this.state.chain;
        return {
            chainSize: chain.size(),
            leftEnd: chain.leftEnd,
            rightEnd: chain.rightEnd,
            handSizes: this.state.hands.map(h => h.size()),
            matchScores: [...this.state.scores.match],
            consecutivePasses: this.state.consecutivePasses
        };
    }

    /**
     * Get the match history for debrief.
     * @returns {MatchHistory}
     */
    getMatchHistory() {
        return this.matchHistory;
    }
}
