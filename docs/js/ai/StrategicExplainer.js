import { GameState } from '../models/GameState.js';
import { t } from '../i18n/i18n.js';

/**
 * StrategicExplainer - Generates rich, contextual explanations using traditional domino terminology.
 *
 * Aligned with SmartAI's 10 scoring factors:
 *   suitDominance, doubleManagement, partnerSupport, ownSuitProtection,
 *   firmeProtection, oppSuitAvoidance, blockingPotential, pipManagement, handFlexibility, paceControl
 *
 * Traditional Terms:
 * - La Salida: Opening play that signals strategy to partner
 * - Ahorcado: Playing a double without cover (risky)
 * - Darle Pase: Forcing an opponent to pass
 * - Cuadrar: Squaring the board (both ends have the same value)
 * - Cerrar: Locking the board by cuadrar when placing the 7th (or 6th if double outstanding) tile of a suit
 * - La Puerta / Firme: Holding all remaining tiles of a suit on an open end
 * - Cover: Having follow-up plays after playing a double
 */
export class StrategicExplainer {
    constructor() {
        this.context = null;
    }

    /**
     * Set context for explanations
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

    _determinePhase(tilesPlayed) {
        if (tilesPlayed === 0) return 'opening';
        if (tilesPlayed <= 4) return 'early';
        if (tilesPlayed <= 12) return 'middle';
        return 'late';
    }

    _determineScorePosition(gameState) {
        const ourScore = gameState.scores.match[0];
        const theirScore = gameState.scores.match[1];
        const diff = ourScore - theirScore;
        if (Math.abs(diff) < 20) return 'close';
        if (diff > 0) return 'leading';
        return 'trailing';
    }

    /**
     * Generate a rich strategic explanation for a move (used in debrief for human evaluation).
     * @param {object} move - {tile, end}
     * @param {object} score - {total, factors} from SmartAI.scoreMove()
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

        const parts = [];

        // --- Opening play (La Salida) ---
        if (chain.isEmpty()) {
            parts.push(this._explainSalida(tile));
        }

        // --- Double management (Ahorcado) ---
        if (tile.isDouble()) {
            parts.push(this._explainDouble(tile, hand, smartAI));
        }

        // --- Suit dominance ---
        if (Math.abs(factors.suitDominance) >= 15) {
            const newEnd = this._getNewEnd(tile, end, chain);
            if (newEnd !== null && newEnd !== -1) {
                if (factors.suitDominance >= 15) {
                    parts.push(t('explain.teamControlsSuit', newEnd));
                } else {
                    parts.push(t('explain.oppsControlSuit', newEnd));
                }
            }
        }

        // --- Partner support ---
        if (factors.partnerSupport >= 15) {
            const partnerSuit = smartAI.signaledSuits[partnerIndex];
            if (partnerSuit !== null) {
                parts.push(t('explain.partnerSupport', partnerSuit));
            }
        }

        // --- Own suit protection ---
        if (factors.ownSuitProtection >= 15) {
            const ownSuit = smartAI.signaledSuits[playerIndex];
            if (ownSuit !== null) {
                parts.push(t('explain.keepOwnSuit', ownSuit));
            }
        } else if (factors.ownSuitProtection <= -15) {
            const ownSuit = smartAI.signaledSuits[playerIndex];
            if (ownSuit !== null) {
                parts.push(t('explain.killsOwnSuit', ownSuit));
            }
        }

        // --- Firme protection (La Puerta) ---
        if (factors.firmeProtection >= 15) {
            parts.push(t('explain.firme'));
        } else if (factors.firmeProtection <= -15) {
            parts.push(t('explain.spendFirme'));
        }

        // --- Opponent suit avoidance ---
        if (factors.oppSuitAvoidance <= -20) {
            const opponents = smartAI.getOpponents(playerIndex);
            const oppSuits = opponents
                .filter(o => smartAI.signaledSuits[o] !== null && !smartAI.killedOwnSuit[o])
                .map(o => smartAI.signaledSuits[o]);
            if (oppSuits.length > 0) {
                const oppSuitLabels = oppSuits.map(s => `${s}s`).join(', ');
                parts.push(t('explain.oppSuitWarning', oppSuitLabels));
            }
        }

        // --- Blocking (Darle Pase / Cuadrar) ---
        if (factors.blockingPotential >= 15) {
            parts.push(this._explainBlocking(move, gameState, playerIndex, smartAI));
        }

        if (this._willSquareBoard(tile, end, chain)) {
            parts.push(this._explainCuadrar(tile, end, chain, gameState, playerIndex, smartAI));
        }

        // --- Pip management ---
        if (factors.pipManagement >= 10 && this.context.phase !== 'late') {
            parts.push(t('explain.highPips', tile.pipCount()));
        }

        // --- Hand flexibility ---
        if (factors.handFlexibility >= 18) {
            parts.push(t('explain.flexibility'));
        }

        // --- Pace control ---
        if (factors.paceControl >= 10) {
            const opponents = smartAI.getOpponents(playerIndex);
            const minOppTiles = Math.min(
                gameState.hands[opponents[0]].size(),
                gameState.hands[opponents[1]].size()
            );
            if (minOppTiles <= 2) {
                parts.push(t('explain.defensive'));
            } else {
                parts.push(t('explain.openForPartner'));
            }
        }

        // --- Fallback ---
        if (parts.length === 0) {
            parts.push(this._getGeneralExplanation(factors));
        }

        return parts.join(' ');
    }

    /**
     * Generate a concise explanation for AI moves in the game log.
     * Priority order: most distinctive strategic reason wins.
     */
    explainBrief(move, score, gameState, playerIndex, smartAI) {
        this.setContext(gameState, smartAI);

        const { tile, end } = move;
        const chain = gameState.chain;
        const hand = gameState.hands[playerIndex];
        const factors = score.factors;

        // 1. Opening play
        if (chain.isEmpty()) {
            if (tile.isDouble()) return t('brief.salidaDouble', tile.high);
            return t('brief.salidaSignals', tile.high);
        }

        // 2. Double management
        if (tile.isDouble()) {
            const hasCover = this._hasCoverForDouble(hand, tile);
            if (!hasCover && !smartAI.isSuitNearlyDead(tile.high)) {
                return t('brief.ahorcado');
            }
            return t('brief.doubleWithCover');
        }

        // 3. Cuadrar / Cerrar (squaring / locking the board)
        if (this._willSquareBoard(tile, end, chain)) {
            const currentEndValue = end === 'left' ? chain.leftEnd : chain.rightEnd;
            const squaredValue = tile.getOtherValue(currentEndValue);
            const currentCount = chain.countValue(squaredValue);
            const tileAdds = tile.isDouble() ? 2 : ((tile.high === squaredValue ? 1 : 0) + (tile.low === squaredValue ? 1 : 0));
            const afterCount = currentCount + tileAdds;
            const doubleOnChain = chain.getTiles().some(ti => ti.isDouble() && ti.high === squaredValue);
            const isCerrar = afterCount >= 7 || (afterCount >= 6 && !doubleOnChain);
            return isCerrar ? t('brief.cerrar', squaredValue) : t('brief.cuadrar', squaredValue);
        }

        // 4. Firme (guaranteed plays)
        if (factors.firmeProtection >= 15) return t('brief.preserveFirme');
        if (factors.firmeProtection <= -25) return t('brief.spendFirme');

        // 5. Blocking
        if (factors.blockingPotential >= 20) return t('brief.darlePase');

        // 5b. Opponent suit avoidance
        if (factors.oppSuitAvoidance <= -20) return t('brief.playsOppSuit');

        // 6. Pace control (defensive/aggressive)
        if (factors.paceControl >= 10) {
            const opponents = smartAI.getOpponents(playerIndex);
            const minOppTiles = Math.min(
                gameState.hands[opponents[0]].size(),
                gameState.hands[opponents[1]].size()
            );
            if (minOppTiles <= 2) return t('brief.defensive');
            return t('brief.openForPartner');
        }

        // 7. Partner support
        if (factors.partnerSupport >= 15) return t('brief.partnerSupport');

        // 8. Own suit protection
        if (factors.ownSuitProtection >= 15) return t('brief.protectOwnSuit');
        if (factors.ownSuitProtection <= -15) return t('brief.killsOwnSuit');

        // 9. Suit dominance
        if (factors.suitDominance >= 25) return t('brief.teamControlsSuit');
        if (factors.suitDominance <= -25) return t('brief.avoidOppSuit');

        // 10. Pip management
        if (factors.pipManagement >= 10 && this.context.phase !== 'late') {
            return t('brief.highPips', tile.pipCount());
        }

        // 11. Flexibility
        if (factors.handFlexibility >= 18) return t('brief.flexibility');

        return t('brief.bestOption');
    }

    // ==================== Helpers ====================

    _explainSalida(tile) {
        if (tile.isDouble()) {
            return t('explain.salidaDouble', tile.high);
        }
        return t('explain.salidaTile', tile.toString(), tile.high);
    }

    _explainDouble(tile, hand, smartAI) {
        const hasCover = this._hasCoverForDouble(hand, tile);
        const suitNearlyDead = smartAI.isSuitNearlyDead(tile.high);

        if (hasCover) {
            return t('explain.doubleWithCover', tile.high);
        } else if (suitNearlyDead) {
            return t('explain.doubleNearlyDead', tile.high);
        } else {
            return t('explain.ahorcado', tile.high);
        }
    }

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
            return t('explain.darlePaseForcing', blockedPlayers.join(` ${t('and')} `), newEnd);
        }
        return t('explain.darlePase');
    }

    _willSquareBoard(tile, end, chain) {
        if (chain.isEmpty()) return false;
        const currentEndValue = end === 'left' ? chain.leftEnd : chain.rightEnd;
        const otherEnd = end === 'left' ? chain.rightEnd : chain.leftEnd;
        const newEndValue = tile.getOtherValue(currentEndValue);
        return newEndValue === otherEnd;
    }

    _explainCuadrar(tile, end, chain, gameState, playerIndex, smartAI) {
        const currentEndValue = end === 'left' ? chain.leftEnd : chain.rightEnd;
        const squaredValue = tile.getOtherValue(currentEndValue);
        const opponents = smartAI.getOpponents(playerIndex);

        // Cerrar: placing the 7th tile of the suit, or the 6th if the double is still outstanding
        const currentCount = chain.countValue(squaredValue);
        const tileAdds = tile.isDouble() ? 2 : ((tile.high === squaredValue ? 1 : 0) + (tile.low === squaredValue ? 1 : 0));
        const afterCount = currentCount + tileAdds;
        const doubleOnChain = chain.getTiles().some(ti => ti.isDouble() && ti.high === squaredValue);
        const isCerrar = afterCount >= 7 || (afterCount >= 6 && !doubleOnChain);

        let isStrategic = false;
        for (const opp of opponents) {
            if (gameState.passHistory[opp].has(squaredValue) ||
                smartAI.inferredDeadSuits[opp].has(squaredValue)) {
                isStrategic = true;
                break;
            }
        }

        if (isStrategic) {
            return t(isCerrar ? 'explain.cerrarStrategic' : 'explain.cuadrarStrategic', squaredValue);
        }
        return t(isCerrar ? 'explain.cerrar' : 'explain.cuadrar', squaredValue);
    }

    _getNewEnd(tile, end, chain) {
        if (chain.isEmpty()) return tile.high;
        const currentEndValue = end === 'left' ? chain.leftEnd : chain.rightEnd;
        return tile.getOtherValue(currentEndValue);
    }

    _hasCoverForDouble(hand, doubleTile) {
        const value = doubleTile.high;
        return hand.getTiles().some(ti => ti.hasValue(value) && !ti.equals(doubleTile));
    }

    /**
     * General explanation based on the top scoring factors.
     */
    _getGeneralExplanation(factors) {
        const dominated = [];

        if (factors.suitDominance >= 15) dominated.push(t('explain.factor.suitDominance'));
        if (factors.suitDominance <= -15) dominated.push(t('explain.factor.avoidOppSuit'));
        if (factors.doubleManagement >= 20) dominated.push(t('explain.factor.unloadDouble'));
        if (factors.partnerSupport >= 10) dominated.push(t('explain.factor.partnerSupport'));
        if (factors.ownSuitProtection >= 10) dominated.push(t('explain.factor.ownSuit'));
        if (factors.firmeProtection >= 10) dominated.push(t('explain.factor.firme'));
        if (factors.blockingPotential >= 10) dominated.push(t('explain.factor.blocking'));
        if (factors.handFlexibility >= 15) dominated.push(t('explain.factor.flexibility'));
        if (factors.paceControl >= 10) dominated.push(t('explain.factor.paceControl'));

        if (dominated.length === 0) {
            return t('explain.bestMove');
        }

        return t('explain.strategicAdvantages', dominated.join(', '));
    }
}
