import { GameState } from '../models/GameState.js';

/**
 * StrategicExplainer - Generates rich, contextual explanations using traditional domino terminology.
 *
 * Aligned with SmartAI's 9 scoring factors:
 *   suitDominance, doubleManagement, partnerSupport, ownSuitProtection,
 *   firmeProtection, blockingPotential, pipManagement, handFlexibility, paceControl
 *
 * Traditional Terms:
 * - La Salida: Opening play that signals strategy to partner
 * - Ahorcado: Playing a double without cover (risky)
 * - Darle Pase: Forcing an opponent to pass
 * - Cuadrar: Squaring the board (both ends have the same value)
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
                    parts.push(`Your team controls ${newEnd}s — leaving this suit open is favorable.`);
                } else {
                    parts.push(`Opponents control ${newEnd}s — leaving this end open favors them.`);
                }
            }
        }

        // --- Partner support ---
        if (factors.partnerSupport >= 15) {
            const partnerSuit = smartAI.signaledSuits[partnerIndex];
            if (partnerSuit !== null) {
                parts.push(`Supporting partner's signaled suit (${partnerSuit}s).`);
            }
        }

        // --- Own suit protection ---
        if (factors.ownSuitProtection >= 15) {
            const ownSuit = smartAI.signaledSuits[playerIndex];
            if (ownSuit !== null) {
                parts.push(`Keeping your signaled suit (${ownSuit}s) open on the board.`);
            }
        } else if (factors.ownSuitProtection <= -15) {
            const ownSuit = smartAI.signaledSuits[playerIndex];
            if (ownSuit !== null) {
                parts.push(`Warning: this kills your own signaled suit (${ownSuit}s).`);
            }
        }

        // --- Firme protection (La Puerta) ---
        if (factors.firmeProtection >= 15) {
            parts.push(`**Firme** — you hold all remaining tiles on that end, guaranteeing future plays.`);
        } else if (factors.firmeProtection <= -15) {
            parts.push(`Spending a **firme** tile — you lose guaranteed plays on that end.`);
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
            parts.push(`Unloading high-pip tile early (${tile.pipCount()} pips).`);
        }

        // --- Hand flexibility ---
        if (factors.handFlexibility >= 18) {
            parts.push(`Keeps your hand flexible — many distinct values remain.`);
        }

        // --- Pace control ---
        if (factors.paceControl >= 10) {
            const opponents = smartAI.getOpponents(playerIndex);
            const minOppTiles = Math.min(
                gameState.hands[opponents[0]].size(),
                gameState.hands[opponents[1]].size()
            );
            if (minOppTiles <= 2) {
                parts.push(`Defensive play — leaving values opponents lack to slow them down.`);
            } else {
                parts.push(`Opening the game for partner who's close to winning.`);
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
            if (tile.isDouble()) return `La Salida (double ${tile.high})`;
            return `La Salida (signals ${tile.high})`;
        }

        // 2. Double management
        if (tile.isDouble()) {
            const hasCover = this._hasCoverForDouble(hand, tile);
            if (!hasCover && !smartAI.isSuitNearlyDead(tile.high)) {
                return 'Ahorcado (risky double)';
            }
            return 'Double with cover';
        }

        // 3. Cuadrar (squaring the board)
        if (this._willSquareBoard(tile, end, chain)) {
            const currentEndValue = end === 'left' ? chain.leftEnd : chain.rightEnd;
            const squaredValue = tile.getOtherValue(currentEndValue);
            return `Cuadrar (${squaredValue})`;
        }

        // 4. Firme (guaranteed plays)
        if (factors.firmeProtection >= 15) return 'Preserving firme';
        if (factors.firmeProtection <= -25) return 'Spending firme (forced)';

        // 5. Blocking
        if (factors.blockingPotential >= 20) return 'Darle pase (blocking)';

        // 6. Pace control (defensive/aggressive)
        if (factors.paceControl >= 10) {
            const opponents = smartAI.getOpponents(playerIndex);
            const minOppTiles = Math.min(
                gameState.hands[opponents[0]].size(),
                gameState.hands[opponents[1]].size()
            );
            if (minOppTiles <= 2) return 'Defensive (opp close)';
            return 'Opening for partner';
        }

        // 7. Partner support
        if (factors.partnerSupport >= 15) return 'Partner support';

        // 8. Own suit protection
        if (factors.ownSuitProtection >= 15) return 'Protecting own suit';
        if (factors.ownSuitProtection <= -15) return 'Kills own suit (tradeoff)';

        // 9. Suit dominance
        if (factors.suitDominance >= 25) return 'Team controls suit';
        if (factors.suitDominance <= -25) return 'Avoiding opponent suit';

        // 10. Pip management
        if (factors.pipManagement >= 10 && this.context.phase !== 'late') {
            return `High pips (${tile.pipCount()})`;
        }

        // 11. Flexibility
        if (factors.handFlexibility >= 18) return 'Keeps flexibility';

        return 'Best option';
    }

    // ==================== Helpers ====================

    _explainSalida(tile) {
        if (tile.isDouble()) {
            return `**La Salida** — Opening with double ${tile.high} signals this as your strong suit to your partner.`;
        }
        return `**La Salida** — Opening with ${tile.toString()} signals ${tile.high} as your strong suit to your partner.`;
    }

    _explainDouble(tile, hand, smartAI) {
        const hasCover = this._hasCoverForDouble(hand, tile);
        const suitNearlyDead = smartAI.isSuitNearlyDead(tile.high);

        if (hasCover) {
            return `Playing double ${tile.high} with **cover** — you have follow-up plays in this suit.`;
        } else if (suitNearlyDead) {
            return `Playing double ${tile.high} — suit is nearly exhausted, low risk.`;
        } else {
            return `**Ahorcado** — Playing double ${tile.high} without cover is risky, but necessary here.`;
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
            return `**Darle pase** — Forcing ${blockedPlayers.join(' and ')} to pass (they lack ${newEnd}s).`;
        }
        return `**Darle pase** — Leaving an unfavorable end for opponents.`;
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

        let isStrategic = false;
        for (const opp of opponents) {
            if (gameState.passHistory[opp].has(squaredValue) ||
                smartAI.inferredDeadSuits[opp].has(squaredValue)) {
                isStrategic = true;
                break;
            }
        }

        if (isStrategic) {
            return `**Cuadrar** — Squaring the board on ${squaredValue} traps opponents who lack this suit.`;
        }
        return `**Cuadrar** — Squaring the board on ${squaredValue}.`;
    }

    _getNewEnd(tile, end, chain) {
        if (chain.isEmpty()) return tile.high;
        const currentEndValue = end === 'left' ? chain.leftEnd : chain.rightEnd;
        return tile.getOtherValue(currentEndValue);
    }

    _hasCoverForDouble(hand, doubleTile) {
        const value = doubleTile.high;
        return hand.getTiles().some(t => t.hasValue(value) && !t.equals(doubleTile));
    }

    /**
     * General explanation based on the top scoring factors.
     */
    _getGeneralExplanation(factors) {
        const dominated = [];

        if (factors.suitDominance >= 15) dominated.push('suit dominance');
        if (factors.suitDominance <= -15) dominated.push('avoiding opponent suit');
        if (factors.doubleManagement >= 20) dominated.push('unload double safely');
        if (factors.partnerSupport >= 10) dominated.push('partner support');
        if (factors.ownSuitProtection >= 10) dominated.push('own suit protection');
        if (factors.firmeProtection >= 10) dominated.push('preserving firme');
        if (factors.blockingPotential >= 10) dominated.push('blocking potential');
        if (factors.handFlexibility >= 15) dominated.push('hand flexibility');
        if (factors.paceControl >= 10) dominated.push('pace control');

        if (dominated.length === 0) {
            return 'Best available move based on current position.';
        }

        return `Strategic advantages: ${dominated.join(', ')}.`;
    }
}
