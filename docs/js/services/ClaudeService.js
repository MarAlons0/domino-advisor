/**
 * ClaudeService - Handles Claude API calls for play style analysis.
 * Uses a secure Cloudflare Worker proxy - no API key needed from users.
 */
export class ClaudeService {
    constructor() {
        // Secure worker endpoint (API key is stored server-side)
        this.workerUrl = 'https://domino-api.mario-alonso-account.workers.dev';

        // Fallback for local development with personal key
        this.storageKey = 'dominoAdvisor_claudeApiKey';
        this.directApiUrl = 'https://api.anthropic.com/v1/messages';
    }

    /**
     * Check if the service is available (always true with worker)
     * @returns {boolean}
     */
    hasApiKey() {
        return true; // Worker handles the API key
    }

    /**
     * Store API key in localStorage (for local dev only)
     * @param {string} key
     */
    setApiKey(key) {
        if (key && key.trim()) {
            localStorage.setItem(this.storageKey, key.trim());
        } else {
            localStorage.removeItem(this.storageKey);
        }
    }

    /**
     * Get stored API key (for local dev only)
     * @returns {string|null}
     */
    getApiKey() {
        return localStorage.getItem(this.storageKey);
    }

    /**
     * Get masked version of API key for display
     * @returns {string}
     */
    getMaskedKey() {
        return 'Using secure server';
    }

    /**
     * Test the API connection
     * @returns {Promise<{success: boolean, message: string}>}
     */
    async testConnection() {
        try {
            const response = await fetch(this.workerUrl, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    max_tokens: 10,
                    messages: [{ role: 'user', content: 'Hi' }]
                })
            });

            if (response.ok) {
                return { success: true, message: 'Connection successful!' };
            }

            const error = await response.json();
            if (response.status === 429) {
                return { success: false, message: error.error || 'Rate limit exceeded' };
            }
            return { success: false, message: error.error || 'API error' };
        } catch (error) {
            return { success: false, message: 'Network error: ' + error.message };
        }
    }

    /**
     * Analyze player's play style based on match history
     * @param {MatchHistory} matchHistory
     * @param {string} [language='en'] - Response language ('en' or 'es')
     * @returns {Promise<{success: boolean, analysis: string|null, error: string|null}>}
     */
    async analyzePlayStyle(matchHistory, language = 'en') {
        const matchData = matchHistory.toJSON();
        const stats = matchHistory.getHumanStats();
        const keyMoments = matchHistory.getKeyMoments();
        const highlightMoments = matchHistory.getHighlightMoments
            ? matchHistory.getHighlightMoments(3)
            : []; // Backward compat if older history object is passed in

        const prompt = this._buildAnalysisPrompt(matchData, stats, keyMoments, highlightMoments, language);

        try {
            const response = await fetch(this.workerUrl, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    max_tokens: 1024,
                    messages: [{ role: 'user', content: prompt }]
                })
            });

            if (!response.ok) {
                const error = await response.json();
                return {
                    success: false,
                    analysis: null,
                    error: error.error || 'API error'
                };
            }

            const data = await response.json();

            // The proxy can return a 200 whose body is actually an Anthropic
            // error envelope ({ type: 'error', error: { type, message } }).
            // Surface that message instead of the generic "unexpected format".
            if (data?.type === 'error' || data?.error) {
                const apiMessage = data?.error?.message || data?.error || 'API error';
                console.error('Claude API returned an error:', data);
                return { success: false, analysis: null, error: apiMessage };
            }

            // Handle different response shapes from proxy vs direct API
            const text = data?.content?.[0]?.text      // Anthropic API format
                      || data?.text                     // Simplified proxy format
                      || data?.message                  // Error format
                      || null;

            if (!text) {
                console.error('Unexpected API response shape:', data);
                return { success: false, analysis: null, error: 'Unexpected response format from API' };
            }

            return { success: true, analysis: text, error: null };
        } catch (error) {
            return {
                success: false,
                analysis: null,
                error: 'Network error: ' + error.message
            };
        }
    }

    /**
     * Build the analysis prompt
     * @param {object} matchData
     * @param {object} stats
     * @param {Array} keyMoments
     * @param {string} language - 'en' or 'es'
     * @private
     */
    _buildAnalysisPrompt(matchData, stats, keyMoments, highlightMoments, language) {
        const totalMoves = stats.optimal + stats.good + stats.questionable + stats.mistake;
        const goodRate = totalMoves > 0
            ? Math.round(((stats.optimal + stats.good) / totalMoves) * 100)
            : 0;

        const formatMoment = (moment) => {
            const play = moment.play;
            let line = `- Hand ${moment.handNumber}, Move ${moment.playIndex + 1}: `;
            line += `played ${play.tile ? play.tile.toString() : 'unknown'} on ${play.end}.`;
            if (play.aiRecommendation) {
                line += ` AI recommended ${play.aiRecommendation.tile?.toString() || 'unknown'} on ${play.aiRecommendation.end || '?'} — "${play.aiRecommendation.reasoning}".`;
            }
            line += ` [${play.evaluation?.toUpperCase()}]`;
            return line;
        };

        let prompt = `You are coaching a player who just finished a match of 4-player partnership dominoes (Cuban / Puerto Rican rules, double-six set, 100-point match target).

## Traditional terminology you should use

Use these terms precisely in your analysis. Mixing them in (instead of generic English) is part of speaking the language of the game.

- **La salida** — the opening play of a hand. The first tile usually signals which suit the opener wants their partner to support.
- **Cuadrar** — making both open ends of the chain show the same value, forcing every player who lacks that value to pass.
- **Cerrar / Cerrado** — closing the chain so no further plays are possible (both ends show the same value AND all 7 tiles of that value have been played). Hand is scored by remaining pips.
- **Domino** — winning a hand by playing your last tile. Your team scores the total pips in opponents' hands.
- **Tranque / Tranca** — board is blocked (everyone passes round the table). Hand is scored by remaining pips.
- **Firme / La Puerta** — you hold ALL remaining tiles of a suit on an open end. You have a guaranteed play that nobody can use against you.
- **Ahorcado** — playing a double with no follow-up (no other tiles of that value in your hand). Risky: leaves you unable to keep that suit alive.
- **Darle pase** — exploiting an opponent's pass history to force more passes by leaving values they lack.
- **Llave** — holding the last tile of a suit, which lets you decide when (and whether) that end ever opens again.

## How the AI made its recommendations

Master difficulty pipeline:
1. **Priority 1** — winning move (domino) → take it.
2. **Priority 2** — high-confidence cuadrar (P ≥ 0.7) *only when* estimated pip advantage > +5 (noise-floor threshold; pip estimator has ~9 pip RMSE).
3. **Priority 3** — early-game partner support when a partner suit has been signaled and play count < 8.
4. **Fallback** — Information Set Monte Carlo Tree Search (1000 iterations) sampling thousands of plausible hidden-hand assignments. A 10-factor static scorer runs in parallel for the per-move "reasoning" text you'll see.

The 10 strategic factors:
1. **La Salida** — opening play signaling
2. **Suit Dominance** — team-aware control of an open suit
3. **Double Management** — playing doubles with cover vs. risking ahorcado
4. **Partner Support** — keeping partner's signaled suit open
5. **Own Suit Protection** — preserving your own signaled suit
6. **Firme Protection** — recognizing/preserving guaranteed plays; rewards exposing a latent firme, penalizes handing an opponent firme, damps preservation when partner is leading
7. **Opponent Suit Avoidance** — not leaving opponents' signaled suit on an open end
8. **Blocking / Darle Pase** — exploiting passes and inferred dead suits
9. **Pip Management** — unloading high-pip tiles early
10. **Hand Flexibility / Pace Control** — diverse playable values; defensive when an opponent is at ≤2 tiles, aggressive when partner is at ≤2

Probabilities are Platt-calibrated (the AI's 70% really is ~70%). When the AI suggests something that looks counter-intuitive at single-play level, the tree search saw a *distribution* of outcomes the static principles can't.

## Match overview

Hands played: **${matchData.hands.length}**.
Total moves: ${totalMoves}.
Move quality: ${stats.optimal} optimal · ${stats.good} good · ${stats.questionable} questionable · ${stats.mistake} mistakes (good rate ${goodRate}%).
Passes: ${stats.passes}.

## Per-hand recap

`;
        const recap = this._buildPerHandRecap(matchData);
        prompt += recap || '_(No hand data available.)_';
        prompt += '\n\n';

        prompt += `## Player's strengths from this match (curated)

`;
        if (!highlightMoments || highlightMoments.length === 0) {
            prompt += '_No optimal or good plays recorded._\n\n';
        } else {
            for (const moment of highlightMoments) prompt += formatMoment(moment) + '\n';
            prompt += '\n';
        }

        prompt += `## Player's weaknesses from this match (curated)

`;
        if (keyMoments.length === 0) {
            prompt += '_No significant mistakes or questionable plays._\n\n';
        } else {
            for (const moment of keyMoments.slice(0, 5)) prompt += formatMoment(moment) + '\n';
            prompt += '\n';
        }

        prompt += `## Your task — output format

Write your coaching analysis in exactly the structure below, using GitHub-flavored Markdown. The UI parses these section headers, so use the exact header text in your language (English or Spanish). Inside each section, write 1–2 short conversational paragraphs as a coach speaking directly to the student — no bullet lists, no nested headings.

\`\`\`
## What you did well

Ground this in the specific strengths above (and the per-hand recap). Name the strategic principle by its traditional term where it fits — "your salida in hand 3 was a clean signal to your partner" reads better than "you played a good first move". Don't pad if there's not much to praise — one sincere paragraph is better than two generic ones.

## Patterns to watch across hands

Focus on patterns that show up in MORE THAN ONE hand. A single mistake is noise. If you see the same shape twice ("killed partner's signaled suit in hands 2 and 4", "held the double too long in both hand 1 and hand 3", "missed a cuadrar opportunity after the opponent's pass in hands 2 and 5"), that's a pattern worth naming. If the match was short and you genuinely can't see a cross-hand pattern, say so honestly and pick the most consequential single mistake instead.

## Try this next match

ONE specific habit change, phrased as a rule of thumb the player can repeat in their head during play. Make it concrete and falsifiable ("Before playing a double, count how many tiles I still have in that suit — if it's zero, find another move first") not vague ("be more careful with doubles"). One paragraph.
\`\`\`

If the language is Spanish, use exactly these section headers instead: \`## Lo que hiciste bien\`, \`## Patrones para corregir\`, \`## Intenta esto la próxima vez\`. Caribbean / Cuban domino vocabulary throughout (la salida, cuadrar, cerrar, firme, ahorcado, darle pase, tranque, llave). The same rules about structure and brevity apply.`;

        if (language === 'es') {
            prompt += '\n\nIMPORTANT: Respond entirely in Spanish.';
        }

        return prompt;
    }

    /**
     * Build a compact per-hand recap that gives Claude enough strategic
     * context (salida, the human's noteworthy plays with AI alternatives,
     * end condition + outcome) without dumping the full play-by-play JSON.
     * Replaces the heavy JSON block in v1.2.3.
     * @private
     */
    _buildPerHandRecap(matchData) {
        if (!matchData?.hands?.length) return '';
        const sections = [];

        for (const hand of matchData.hands) {
            if (!hand.plays?.length) continue;

            const salida = hand.plays[0];
            const salidaTile = salida.tile || '?';
            const salidaPlayer = salida.playerName || `Player ${salida.player}`;
            const salidaLine = `${salidaPlayer} opened with ${salidaTile}`;

            const noteworthy = hand.plays
                .filter(p => p.isHuman && p.tile &&
                    (p.evaluation === 'mistake' || p.evaluation === 'questionable' || p.evaluation === 'optimal'))
                .map(p => {
                    let s = `${p.tile} on ${p.end || '?'} [${p.evaluation.toUpperCase()}]`;
                    if (p.aiRecommendation?.tile) {
                        s += ` (AI: ${p.aiRecommendation.tile} on ${p.aiRecommendation.end || '?'})`;
                    }
                    return s;
                });
            const noteworthyLine = noteworthy.length
                ? `Your noteworthy plays: ${noteworthy.join('; ')}.`
                : 'No noteworthy human plays graded this hand.';

            let endLine = '';
            if (hand.result) {
                const reason = hand.result.reason || 'unknown';
                const winnerName = hand.result.winnerName || 'Tie';
                const points = hand.result.points ?? 0;
                endLine = `Ended by ${reason}; ${winnerName} +${points}.`;
            }

            sections.push(`**Hand ${hand.handNumber}** — ${salidaLine}. ${noteworthyLine} ${endLine}`.trim());
        }

        return sections.join('\n\n');
    }
}
