import { ClaudeService } from '../services/ClaudeService.js';
import { GameState } from '../models/GameState.js';

/**
 * DebriefUI - Modal interface for post-match review.
 */
export class DebriefUI {
    constructor() {
        this.claudeService = new ClaudeService();
        this.matchHistory = null;
        this.isInitialized = false;
        this.onNewMatch = null;
        this.onOpenSettings = null;
    }

    /**
     * Initialize the debrief UI elements
     */
    init() {
        if (this.isInitialized) return;

        this.modal = document.getElementById('debrief-modal');
        this.overlay = document.getElementById('debrief-overlay');
        this.closeBtn = document.getElementById('close-debrief-btn');
        this.debriefCloseBtn = document.getElementById('debrief-close-btn');
        this.newMatchBtn = document.getElementById('debrief-new-match-btn');
        this.summaryEl = document.getElementById('debrief-summary');

        // Tab elements
        this.tabBtns = document.querySelectorAll('.debrief-tabs .tab-btn');
        this.tabContents = document.querySelectorAll('.debrief-content .tab-content');

        // Stats elements
        this.statOptimal = document.getElementById('stat-optimal');
        this.statGood = document.getElementById('stat-good');
        this.statQuestionable = document.getElementById('stat-questionable');
        this.statMistake = document.getElementById('stat-mistake');

        // Content elements
        this.keyMomentsList = document.getElementById('key-moments-list');
        this.yourPlaysList = document.getElementById('your-plays-list');
        this.fullMatchPlays = document.getElementById('full-match-plays');
        this.handSelect = document.getElementById('hand-select');

        // LLM elements
        this.analyzeBtn = document.getElementById('analyze-btn');
        this.llmLoading = document.getElementById('llm-loading');
        this.llmResult = document.getElementById('llm-result');
        this.llmNoKey = document.getElementById('llm-no-key');
        this.openSettingsLink = document.getElementById('open-settings-link');

        if (!this.modal) {
            console.warn('DebriefUI: Debrief modal not found in DOM');
            return;
        }

        this._bindEvents();
        this.isInitialized = true;
    }

    /**
     * Bind event handlers
     * @private
     */
    _bindEvents() {
        if (this.closeBtn) {
            this.closeBtn.addEventListener('click', () => this.hide());
        }

        if (this.debriefCloseBtn) {
            this.debriefCloseBtn.addEventListener('click', () => this.hide());
        }

        if (this.overlay) {
            this.overlay.addEventListener('click', () => this.hide());
        }

        if (this.newMatchBtn) {
            this.newMatchBtn.addEventListener('click', () => {
                this.hide();
                if (this.onNewMatch) this.onNewMatch();
            });
        }

        // Tab switching
        this.tabBtns.forEach(btn => {
            btn.addEventListener('click', () => this._switchTab(btn.dataset.tab));
        });

        // Hand selector
        if (this.handSelect) {
            this.handSelect.addEventListener('change', () => this._renderFullMatch());
        }

        // LLM analysis
        if (this.analyzeBtn) {
            this.analyzeBtn.addEventListener('click', () => this._runAnalysis());
        }

        if (this.openSettingsLink) {
            this.openSettingsLink.addEventListener('click', (e) => {
                e.preventDefault();
                this.hide();
                if (this.onOpenSettings) this.onOpenSettings();
            });
        }
    }

    /**
     * Show the debrief modal with match history
     * @param {MatchHistory} matchHistory
     */
    show(matchHistory) {
        if (!this.isInitialized) this.init();

        this.matchHistory = matchHistory;

        if (this.modal) {
            this.modal.classList.add('visible');
        }
        if (this.overlay) {
            this.overlay.classList.add('visible');
        }

        // Reset to overview tab
        this._switchTab('overview');

        // Populate all content
        this._updateSummary();
        this._updateStats();
        this._updateKeyMoments();
        this._updateYourPlays();
        this._updateHandSelector();
        this._updateLLMSection();
    }

    /**
     * Hide the debrief modal
     */
    hide() {
        if (this.modal) {
            this.modal.classList.remove('visible');
        }
        if (this.overlay) {
            this.overlay.classList.remove('visible');
        }
    }

    /**
     * Switch to a specific tab
     * @private
     */
    _switchTab(tabId) {
        // Update tab buttons
        this.tabBtns.forEach(btn => {
            btn.classList.toggle('active', btn.dataset.tab === tabId);
        });

        // Update tab content
        this.tabContents.forEach(content => {
            content.classList.toggle('active', content.id === `tab-${tabId}`);
        });

        // Render full match if switching to that tab
        if (tabId === 'full-match') {
            this._renderFullMatch();
        }
    }

    /**
     * Update the summary line
     * @private
     */
    _updateSummary() {
        if (!this.summaryEl || !this.matchHistory) return;

        const stats = this.matchHistory.getHumanStats();
        const handCount = this.matchHistory.getHandCount();
        const total = stats.optimal + stats.good + stats.questionable + stats.mistake;
        const goodRate = total > 0 ? Math.round(((stats.optimal + stats.good) / total) * 100) : 0;

        this.summaryEl.textContent = `${handCount} hand${handCount !== 1 ? 's' : ''} played. ${goodRate}% good moves.`;
    }

    /**
     * Update the stat cards
     * @private
     */
    _updateStats() {
        if (!this.matchHistory) return;

        const stats = this.matchHistory.getHumanStats();

        if (this.statOptimal) this.statOptimal.textContent = stats.optimal;
        if (this.statGood) this.statGood.textContent = stats.good;
        if (this.statQuestionable) this.statQuestionable.textContent = stats.questionable;
        if (this.statMistake) this.statMistake.textContent = stats.mistake;
    }

    /**
     * Update the key moments list
     * @private
     */
    _updateKeyMoments() {
        if (!this.keyMomentsList || !this.matchHistory) return;

        const moments = this.matchHistory.getKeyMoments();

        if (moments.length === 0) {
            this.keyMomentsList.innerHTML = '<div class="empty-state">No significant mistakes or questionable plays. Great job!</div>';
            return;
        }

        this.keyMomentsList.innerHTML = moments.map(moment => {
            const play = moment.play;
            const isQuestionable = play.evaluation === 'questionable';

            return `
                <div class="moment-item ${isQuestionable ? 'questionable' : ''}">
                    <div class="moment-header">
                        <span class="moment-label">Hand ${moment.handNumber}, Play ${moment.playIndex + 1}</span>
                        <span class="moment-badge ${play.evaluation}">${play.evaluation}</span>
                    </div>
                    <div class="moment-played">
                        Played ${play.tile ? play.tile.toString() : 'unknown'} on ${play.end}
                    </div>
                    ${play.aiRecommendation ? `
                        <div class="moment-recommended">
                            AI recommended: ${play.aiRecommendation.tile?.toString() || 'unknown'} - "${play.aiRecommendation.reasoning}"
                        </div>
                    ` : ''}
                </div>
            `;
        }).join('');
    }

    /**
     * Update the "Your Plays" list
     * @private
     */
    _updateYourPlays() {
        if (!this.yourPlaysList || !this.matchHistory) return;

        const plays = this.matchHistory.getHumanPlays();

        if (plays.length === 0) {
            this.yourPlaysList.innerHTML = '<div class="empty-state">No plays recorded yet.</div>';
            return;
        }

        this.yourPlaysList.innerHTML = plays.map(item => {
            const play = item.play;
            const isPass = play.tile === null;

            return `
                <div class="play-item">
                    <div class="play-header">
                        <span class="play-info">Hand ${item.handNumber}, Play ${item.playIndex + 1}</span>
                        ${isPass
                            ? '<span class="play-badge pass">Pass</span>'
                            : `<span class="play-badge ${play.evaluation || ''}">${play.evaluation || 'N/A'}</span>`
                        }
                    </div>
                    <div class="play-tile">
                        ${isPass ? 'Passed (no valid moves)' : `Played ${play.tile.toString()} on ${play.end}`}
                    </div>
                    ${!isPass && play.aiRecommendation ? `
                        <div class="play-recommendation">
                            AI: ${play.aiRecommendation.tile?.toString() || 'unknown'} on ${play.aiRecommendation.end} - "${play.aiRecommendation.reasoning}"
                        </div>
                    ` : ''}
                </div>
            `;
        }).join('');
    }

    /**
     * Update the hand selector dropdown
     * @private
     */
    _updateHandSelector() {
        if (!this.handSelect || !this.matchHistory) return;

        const handCount = this.matchHistory.getHandCount();

        this.handSelect.innerHTML = '';
        for (let i = 1; i <= handCount; i++) {
            const option = document.createElement('option');
            option.value = i;
            option.textContent = `Hand ${i}`;
            this.handSelect.appendChild(option);
        }
    }

    /**
     * Render the full match play-by-play
     * @private
     */
    _renderFullMatch() {
        if (!this.fullMatchPlays || !this.handSelect || !this.matchHistory) return;

        const handNumber = parseInt(this.handSelect.value, 10);
        const hand = this.matchHistory.getHand(handNumber);

        if (!hand) {
            this.fullMatchPlays.innerHTML = '<div class="empty-state">No plays for this hand.</div>';
            return;
        }

        this.fullMatchPlays.innerHTML = hand.plays.map((play, index) => {
            const playerName = GameState.getPlayerName(play.player);
            const isHuman = play.isHuman;
            const isPass = play.tile === null;

            let badgeClass = isHuman ? (play.evaluation || '') : 'ai';
            let badgeText = isHuman ? (play.evaluation || 'N/A') : 'AI';
            if (isPass) {
                badgeClass = 'pass';
                badgeText = 'Pass';
            }

            return `
                <div class="play-item">
                    <div class="play-header">
                        <span class="play-info">${playerName} - Play ${index + 1}</span>
                        <span class="play-badge ${badgeClass}">${badgeText}</span>
                    </div>
                    <div class="play-tile">
                        ${isPass ? 'Passed' : `Played ${play.tile.toString()} on ${play.end}`}
                    </div>
                    ${!isPass && play.actualReasoning && !isHuman ? `
                        <div class="play-recommendation">${play.actualReasoning}</div>
                    ` : ''}
                    ${!isPass && isHuman && play.aiRecommendation ? `
                        <div class="play-recommendation">
                            AI recommended: ${play.aiRecommendation.tile?.toString() || 'unknown'} - "${play.aiRecommendation.reasoning}"
                        </div>
                    ` : ''}
                </div>
            `;
        }).join('');

        // Add result if available
        if (hand.result) {
            const resultHtml = `
                <div class="play-item" style="border-left: 3px solid #00d4ff;">
                    <div class="play-header">
                        <span class="play-info">Hand Result</span>
                    </div>
                    <div class="play-tile">
                        ${hand.result.reason === 'domino' ? 'Domino!' : hand.result.reason === 'closed' ? 'Closed game' : 'Blocked'} -
                        ${hand.result.winner >= 0 ? GameState.getTeamName(hand.result.winner) + ' wins ' + hand.result.points + ' points' : 'Tie'}
                    </div>
                </div>
            `;
            this.fullMatchPlays.innerHTML += resultHtml;
        }
    }

    /**
     * Update the LLM analysis section
     * @private
     */
    _updateLLMSection() {
        if (!this.analyzeBtn || !this.llmLoading || !this.llmResult || !this.llmNoKey) return;

        const hasKey = this.claudeService.hasApiKey();

        this.analyzeBtn.style.display = hasKey ? 'block' : 'none';
        this.llmNoKey.style.display = hasKey ? 'none' : 'block';
        this.llmLoading.style.display = 'none';
        this.llmResult.style.display = 'none';
    }

    /**
     * Run LLM analysis
     * @private
     */
    async _runAnalysis() {
        if (!this.matchHistory) return;

        // Show loading
        this.analyzeBtn.style.display = 'none';
        this.llmLoading.style.display = 'flex';
        this.llmResult.style.display = 'none';

        try {
            const result = await this.claudeService.analyzePlayStyle(this.matchHistory);

            this.llmLoading.style.display = 'none';

            if (result.success) {
                this.llmResult.textContent = result.analysis;
                this.llmResult.style.display = 'block';
            } else {
                this.llmResult.textContent = 'Error: ' + result.error;
                this.llmResult.style.display = 'block';
                this.analyzeBtn.style.display = 'block';
            }
        } catch (error) {
            this.llmLoading.style.display = 'none';
            this.llmResult.textContent = 'Error: ' + error.message;
            this.llmResult.style.display = 'block';
            this.analyzeBtn.style.display = 'block';
        }
    }
}
