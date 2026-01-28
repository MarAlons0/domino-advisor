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
     * @returns {Promise<{success: boolean, analysis: string|null, error: string|null}>}
     */
    async analyzePlayStyle(matchHistory) {
        const matchData = matchHistory.toJSON();
        const stats = matchHistory.getHumanStats();
        const keyMoments = matchHistory.getKeyMoments();

        const prompt = this._buildAnalysisPrompt(matchData, stats, keyMoments);

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
            const analysis = data.content[0]?.text || 'No analysis generated';

            return { success: true, analysis: analysis, error: null };
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
     * @private
     */
    _buildAnalysisPrompt(matchData, stats, keyMoments) {
        const totalMoves = stats.optimal + stats.good + stats.questionable + stats.mistake;
        const goodRate = totalMoves > 0
            ? Math.round(((stats.optimal + stats.good) / totalMoves) * 100)
            : 0;

        let prompt = `You are analyzing a player's domino match to identify their playing tendencies.

## Strategic Principles to Evaluate

1. **La Salida (Opening Play)** - Do they signal clearly to their partner?
2. **Double Management** - Do they play doubles with cover or risk ahorcado (playing without follow-up)?
3. **Partner Support** - Do they support their partner's signaled suit or play selfishly?
4. **Blocking (Darle Pase)** - Do they exploit opponent weaknesses and force passes?
5. **Pip Management** - Do they unload high-pip tiles early in the hand?
6. **End Control (Cuadrar)** - Do they maintain favorable board positions?

## Match Statistics

- Hands played: ${matchData.hands.length}
- Total moves: ${totalMoves}
- Move quality: ${stats.optimal} optimal, ${stats.good} good, ${stats.questionable} questionable, ${stats.mistake} mistakes
- Good move rate: ${goodRate}%
- Passes: ${stats.passes}

## Key Moments (Mistakes and Questionable Plays)

`;

        if (keyMoments.length === 0) {
            prompt += "No significant mistakes or questionable plays.\n\n";
        } else {
            for (const moment of keyMoments.slice(0, 5)) {
                const play = moment.play;
                prompt += `- Hand ${moment.handNumber}, Move ${moment.playIndex + 1}: `;
                prompt += `Played ${play.tile ? play.tile.toString() : 'unknown'} on ${play.end}. `;
                if (play.aiRecommendation) {
                    prompt += `AI recommended: ${play.aiRecommendation.tile?.toString() || 'unknown'} - "${play.aiRecommendation.reasoning}". `;
                }
                prompt += `[${play.evaluation?.toUpperCase()}]\n`;
            }
            prompt += "\n";
        }

        prompt += `## Full Match Data

\`\`\`json
${JSON.stringify(matchData, null, 2)}
\`\`\`

## Your Task

Provide a 2-3 paragraph analysis of this player's tendencies, strengths, and areas for improvement. Use traditional domino terminology where appropriate (la salida, ahorcado, darle pase, cuadrar, la puerta). Be specific about patterns you observe and give actionable advice.

Focus on:
1. What they do well
2. Specific patterns in their mistakes
3. One or two concrete improvements they could make`;

        return prompt;
    }
}
