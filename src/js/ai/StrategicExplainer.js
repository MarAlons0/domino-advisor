import { GameState } from '../models/GameState.js';

/**
 * StrategicExplainer - Generates rich, contextual explanations using traditional domino terminology.
 *
 * Traditional Terms:
 * - La Salida: Opening play that signals strategy to partner
 * - Ahorcado: Playing a double without cover (risky)
 * - Darle Pase: Forcing an opponent to pass
 * - Cuadrar: Squaring the board (both ends have the same value)
 * - La Puerta: Holding the last tile of a suit (complete control)
 * - Cover: Having follow-up plays after playing a double
 * - Repeat: Playing to keep your strong suit open
 */
export class StrategicExplainer {
    constructor() {
        this.context = null;
    }

    /**
     * Set context for explanations
     * @param {GameState} gameState
     * @param {SmartAI} smartAI
     */
    setContext(gameState, smartAI) {
        const chain = gameState.chain;
        const tilesPlayed = chain.size();

        this.context = {
            phase: this._determinePhase(tilesPlayed),
            scorePosition: this._determineScorePosition(gameState),
            chainSize: tilesPlayed,
            leftEnd: chain.leftEnd,
            rightEnd: chain.rightEnd,
            isSquared: chain.leftEnd === chain.rightEnd && chain.leftEnd !== null,
            smartAI: smartAI
        };
    }

    /**
     * Determine the game phase
     * @param {number} tilesPlayed
     * @returns {string}
     */
    _determinePhase(tilesPlayed) {
        if (tilesPlayed === 0) return 'opening';
        if (tilesPlayed <= 4) return 'early';
        if (tilesPlayed <= 12) return 'middle';
        return 'late';
    }

    /**
     * Determine score position
     * @param {GameState} gameState
     * @returns {string}
     */
    _determineScorePosition(gameState) {
        const ourScore = gameState.scores.match[0];
        const theirScore = gameState.scores.match[1];
        const diff = ourScore - theirScore;

        if (Math.abs(diff) < 20) return 'close';
        if (diff > 0) return 'leading';
        return 'trailing';
    }

    /**
     * Generate a strategic explanation for a move
     * @param {object} move - The move {tile, end}
     * @param {object} score - The score from SmartAI.scoreMove()
     * @param {GameState} gameState
     * @param {number} playerIndex
     * @param {SmartAI} smartAI
     * @returns {string}
     */
    explain(move, score, gameState, playerIndex, smartAI) {
        this.setContext(gameState, smartAI);

        const { tile, end } = move;
        const chain = gameState.chain;
        const hand = gameState.hands[playerIndex];
        const factors = score.factors;
        const partnerIndex = GameState.getPartner(playerIndex);

        // Build explanation parts
        const parts = [];

        // Check for opening play (La Salida)
        if (chain.isEmpty()) {
            parts.push(this._explainSalida(tile, playerIndex, smartAI));
        }

        // Check for double with/without cover (Ahorcado)
        if (tile.isDouble()) {
            parts.push(this._explainDoublePlaying(tile, hand, smartAI, chain));
        }

        // Check for blocking play (Darle Pase)
        if (factors.blockingPotential >= 15) {
            parts.push(this._explainBlocking(move, gameState, playerIndex, smartAI));
        }

        // Check for squaring the board (Cuadrar)
        if (this._willSquareBoard(tile, end, chain)) {
            parts.push(this._explainCuadrar(tile, end, chain, gameState, smartAI));
        }

        // Check for La Puerta (holding last tile of suit)
        const newEnd = this._getNewEnd(tile, end, chain);
        if (newEnd !== null && smartAI.isSuitNearlyDead(newEnd)) {
            const remaining = smartAI.getRemainingInSuit(newEnd);
            if (remaining === 1 && this._playerHoldsLastOfSuit(hand, newEnd, tile)) {
                parts.push(`**La Puerta** - You hold the last ${newEnd}, giving you complete control of this suit.`);
            }
        }

        // Check for partner support
        if (factors.partnerSupport >= 15) {
            const partnerSuit = smartAI.signaledSuits[partnerIndex];
            if (partnerSuit !== null) {
                parts.push(`Supporting partner's signaled suit (${partnerSuit}).`);
            }
        }

        // Check for repeat play (keeping strong suit open)
        if (factors.suitStrength >= 20) {
            const suitCount = Math.max(
                smartAI.countSuitInHand(hand, tile.high),
                smartAI.countSuitInHand(hand, tile.low)
            );
            if (suitCount >= 3) {
                parts.push(`**Repeat** - Playing from your strong suit (${suitCount} tiles with this value).`);
            }
        }

        // Check for pip management
        if (factors.pipManagement >= 10 && this.context.phase !== 'late') {
            parts.push(`Unloading high-pip tile early (${tile.pipCount()} pips).`);
        }

        // Check for end control
        if (factors.endControl >= 10) {
            parts.push(`Maintaining favorable board position.`);
        }

        // Check for avoiding dead suits
        if (factors.avoidDeadSuits < 0) {
            parts.push(`Avoiding leaving a dead suit open.`);
        }

        // If no specific strategic reason, give a general one
        if (parts.length === 0) {
            parts.push(this._getGeneralExplanation(score, this.context.phase));
        }

        return parts.join(' ');
    }

    /**
     * Explain the opening play (La Salida)
     */
    _explainSalida(tile, playerIndex, smartAI) {
        if (tile.isDouble()) {
            return `**La Salida** - Opening with double ${tile.high} signals this as your strong suit to your partner.`;
        }
        return `**La Salida** - Opening with ${tile.toString()} signals ${tile.high} as your strong suit to your partner.`;
    }

    /**
     * Explain playing a double (with or without cover - Ahorcado)
     */
    _explainDoublePlaying(tile, hand, smartAI, chain) {
        const hasCover = this._hasCoverForDouble(hand, tile);
        const suitNearlyDead = smartAI.isSuitNearlyDead(tile.high);

        if (hasCover) {
            return `Playing double ${tile.high} with **cover** - you have follow-up plays in this suit.`;
        } else if (suitNearlyDead) {
            return `Playing double ${tile.high} - suit is nearly exhausted, low risk of getting stuck.`;
        } else {
            return `**Ahorcado** - Playing double ${tile.high} without cover is risky, but necessary here.`;
        }
    }

    /**
     * Explain a blocking play (Darle Pase)
     */
    _explainBlocking(move, gameState, playerIndex, smartAI) {
        const { tile, end } = move;
        const chain = gameState.chain;
        const newEnd = this._getNewEnd(tile, end, chain);
        const opponents = smartAI.getOpponents(playerIndex);

        const blockedPlayers = [];
        for (const opp of opponents) {
            if (gameState.passHistory[opp].has(newEnd) || smartAI.inferredDeadSuits[opp].has(newEnd)) {
                blockedPlayers.push(GameState.getPlayerName(opp));
            }
        }

        if (blockedPlayers.length > 0) {
            return `**Darle pase** - Forcing ${blockedPlayers.join(' and ')} to pass (they lack ${newEnd}s).`;
        }
        return `**Darle pase** - Leaving an unfavorable end for opponents.`;
    }

    /**
     * Check if a move will square the board
     */
    _willSquareBoard(tile, end, chain) {
        if (chain.isEmpty()) return false;

        const currentEndValue = end === 'left' ? chain.leftEnd : chain.rightEnd;
        const otherEnd = end === 'left' ? chain.rightEnd : chain.leftEnd;
        const newEndValue = tile.getOtherValue(currentEndValue);

        return newEndValue === otherEnd;
    }

    /**
     * Explain squaring the board (Cuadrar)
     */
    _explainCuadrar(tile, end, chain, gameState, smartAI) {
        const currentEndValue = end === 'left' ? chain.leftEnd : chain.rightEnd;
        const squaredValue = tile.getOtherValue(currentEndValue);

        // Check if this is strategic (opponents lack this suit)
        const opponents = smartAI.getOpponents(0); // Human is always player 0
        let isStrategic = false;
        for (const opp of opponents) {
            if (gameState.passHistory[opp].has(squaredValue) ||
                smartAI.inferredDeadSuits[opp].has(squaredValue)) {
                isStrategic = true;
                break;
            }
        }

        if (isStrategic) {
            return `**Cuadrar** - Squaring the board on ${squaredValue} traps opponents who lack this suit.`;
        }
        return `**Cuadrar** - Squaring the board on ${squaredValue}.`;
    }

    /**
     * Get the new end value after a play
     */
    _getNewEnd(tile, end, chain) {
        if (chain.isEmpty()) {
            return tile.high; // First play, high value is right end
        }
        const currentEndValue = end === 'left' ? chain.leftEnd : chain.rightEnd;
        return tile.getOtherValue(currentEndValue);
    }

    /**
     * Check if hand has cover for a double
     */
    _hasCoverForDouble(hand, doubleTile) {
        const value = doubleTile.high;
        const tilesWithValue = hand.getTiles().filter(t =>
            t.hasValue(value) && !t.equals(doubleTile)
        );
        return tilesWithValue.length > 0;
    }

    /**
     * Check if player holds the last tile of a suit (after playing the given tile)
     */
    _playerHoldsLastOfSuit(hand, suitValue, excludeTile) {
        const tilesWithSuit = hand.getTiles().filter(t =>
            t.hasValue(suitValue) && !t.equals(excludeTile)
        );
        return tilesWithSuit.length === 1;
    }

    /**
     * Get a general explanation based on score factors
     */
    _getGeneralExplanation(score, phase) {
        const dominated = [];
        const factors = score.factors;

        if (factors.suitStrength >= 20) dominated.push('strong suit');
        if (factors.doubleManagement >= 20) dominated.push('unload double safely');
        if (factors.partnerSupport >= 10) dominated.push('partner support');
        if (factors.endControl >= 10) dominated.push('end control');
        if (factors.tileCountingBonus >= 10) dominated.push('good suit availability');

        if (dominated.length === 0) {
            return 'Best available move based on current position.';
        }

        return `Strategic advantages: ${dominated.join(', ')}.`;
    }

    /**
     * Generate a concise explanation for AI moves in the game log
     * @param {object} move - The move {tile, end, reasoning}
     * @param {object} score - The score from SmartAI.scoreMove()
     * @param {GameState} gameState
     * @param {number} playerIndex
     * @param {SmartAI} smartAI
     * @returns {string}
     */
    explainBrief(move, score, gameState, playerIndex, smartAI) {
        this.setContext(gameState, smartAI);

        const { tile, end } = move;
        const chain = gameState.chain;
        const hand = gameState.hands[playerIndex];
        const factors = score.factors;

        // Priority order for brief explanations
        if (chain.isEmpty()) {
            if (tile.isDouble()) {
                return `La Salida (double ${tile.high})`;
            }
            return `La Salida (signals ${tile.high})`;
        }

        if (tile.isDouble()) {
            const hasCover = this._hasCoverForDouble(hand, tile);
            if (!hasCover && !smartAI.isSuitNearlyDead(tile.high)) {
                return 'Ahorcado (risky double)';
            }
            return 'Double with cover';
        }

        if (factors.blockingPotential >= 20) {
            return 'Darle pase (blocking)';
        }

        if (this._willSquareBoard(tile, end, chain)) {
            const currentEndValue = end === 'left' ? chain.leftEnd : chain.rightEnd;
            const squaredValue = tile.getOtherValue(currentEndValue);
            return `Cuadrar (${squaredValue})`;
        }

        if (factors.partnerSupport >= 15) {
            return 'Partner support';
        }

        if (factors.suitStrength >= 20) {
            return 'Strong suit repeat';
        }

        if (factors.pipManagement >= 10 && this.context.phase !== 'late') {
            return `High pips (${tile.pipCount()})`;
        }

        if (factors.endControl >= 10) {
            return 'End control';
        }

        return 'Best option';
    }
}
