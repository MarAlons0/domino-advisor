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

## How the AI made its recommendations

The AI evaluating this player runs at master difficulty. Per-move recommendations come from this pipeline:
1. **Priority 1** — if a winning move (domino) is available, take it.
2. **Priority 2** — high-confidence cuadrar block (P ≥ 0.7) *only when* estimated pip advantage > +5 (a noise-floor threshold; the pip estimator has ~9 pip RMSE).
3. **Priority 3** — early-game partner support when a partner suit has been signaled and play count < 8.
4. **Fallback** — Information Set Monte Carlo Tree Search (1000 iterations) over the player's information set, sampling thousands of plausible hidden-hand assignments and picking the most-visited root move. A 10-factor static scorer runs in parallel for the explainability text you see in each AI recommendation.

The 10 strategic factors the AI uses (and that you should reference in your analysis):
1. **La Salida** — opening play signaling intent to partner
2. **Suit Dominance** — team-aware control of an open suit
3. **Double Management** — playing doubles with cover vs. risking ahorcado
4. **Partner Support** — keeping partner's signaled suit open
5. **Own Suit Protection** — preserving your own signaled suit
6. **Firme (La Puerta)** — recognizing and preserving guaranteed plays; *as of v1.1.0 the AI also rewards exposing a latent firme, penalizes handing an opponent firme, and damps preservation when partner is leading*
7. **Opponent Suit Avoidance** — not leaving opponents' signaled suit on an open end
8. **Blocking / Darle Pase** — exploiting passes and inferred dead suits
9. **Pip Management** — unloading high-pip tiles early
10. **Hand Flexibility** — keeping a diverse set of playable values
11. **Pace Control** — defensive when an opponent is at ≤2 tiles; aggressive when partner is at ≤2

Tile-holding probabilities are Platt-calibrated (so the AI's stated 70% confidence really is 70%). Pip estimates are summed over those calibrated probabilities. When the AI suggests something that looks counter-intuitive at the single-play level, it's usually because the tree search saw a *distribution* of outcomes the static principles can't see.

## Match Statistics

- Hands played: ${matchData.hands.length}
- Total moves: ${totalMoves}
- Move quality: ${stats.optimal} optimal, ${stats.good} good, ${stats.questionable} questionable, ${stats.mistake} mistakes
- Good move rate: ${goodRate}%
- Passes: ${stats.passes}

## Strengths — Optimal / Good plays from this match

`;
        if (!highlightMoments || highlightMoments.length === 0) {
            prompt += "No optimal or good plays recorded.\n\n";
        } else {
            for (const moment of highlightMoments) prompt += formatMoment(moment) + '\n';
            prompt += "\n";
        }

        prompt += `## Weaknesses — Mistakes and questionable plays from this match

`;
        if (keyMoments.length === 0) {
            prompt += "No significant mistakes or questionable plays.\n\n";
        } else {
            for (const moment of keyMoments.slice(0, 5)) prompt += formatMoment(moment) + '\n';
            prompt += "\n";
        }

        prompt += `## Full Match Data (reference)

The complete play-by-play JSON is below for reference. **Focus your analysis on the Strengths and Weaknesses sections above** — the JSON is here only for cross-checking patterns and quoting tile choices when relevant. Do not summarize the JSON.

\`\`\`json
${JSON.stringify(matchData, null, 2)}
\`\`\`

## Your Task

Write a coaching analysis with three short sections — be specific, use traditional domino terminology (la salida, ahorcado, darle pase, cuadrar, firme, llave), and ground every claim in the moments shown above (and the JSON for reference).

1. **What this player does well** — 1–2 strengths grounded in the optimal/good plays. Be concrete about *which* strategic principle they're applying correctly.
2. **Cross-hand patterns to address** — focus on recurring patterns across multiple hands, not one-off mistakes. Example shapes: "consistently kills partner's signaled suit in hands 2 and 4", "holds doubles too long late in the hand", "misses opportunities to cuadrar on values opponents have passed on". If a mistake only happened once, it's noise, not a pattern.
3. **One concrete next-match improvement** — a single, specific habit change the player can attempt next time. Phrase it as a rule of thumb they could repeat in their head.

Keep the total to ~3 short paragraphs (one per section). No headers, no bullet lists — write conversationally as a domino coach speaking to a student.`;

        if (language === 'es') {
            prompt += '\n\nIMPORTANT: Respond entirely in Spanish, using Caribbean/Cuban domino vocabulary throughout.';
        }

        return prompt;
    }
}
