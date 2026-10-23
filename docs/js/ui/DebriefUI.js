import { ClaudeService } from '../services/ClaudeService.js';
import { GameState } from '../models/GameState.js';
import { MatchHistory } from '../models/MatchHistory.js';
import { buildMatchLessons } from '../coach/MatchLessons.js';
import { createDominoElement, createDominoHalf } from './dominoRender.js';
import { t, i18n } from '../i18n/i18n.js';

/**
 * Minimal Markdown-to-HTML renderer for the v1.2.4 analysis output.
 * Handles `## headers`, `**bold**`, `*italic*`, paragraph breaks, and single
 * line breaks inside paragraphs. HTML in the source is escaped first so the
 * model output cannot inject script tags.
 */
function renderAnalysisMarkdown(text) {
    if (!text) return '';
    let html = String(text)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;');
    // Section headers (`## Heading`) become styled headers. Apply BEFORE bold
    // so the leading `##` isn't picked up by the `**` rule.
    html = html.replace(/^## (.+)$/gm, '<h4 class="analysis-section">$1</h4>');
    // Bold (apply before italic so `**` is consumed first).
    html = html.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
    // Italic
    html = html.replace(/\*([^*]+)\*/g, '<em>$1</em>');
    // Split into paragraph blocks on blank lines.
    const blocks = html.split(/\n\s*\n+/);
    return blocks
        .map(block => {
            const trimmed = block.trim();
            if (!trimmed) return '';
            // Headers are already block-level; don't wrap them in <p>.
            if (trimmed.startsWith('<h4')) return trimmed;
            return `<p class="analysis-paragraph">${trimmed.replace(/\n/g, '<br>')}</p>`;
        })
        .filter(Boolean)
        .join('');
}

/**
 * DebriefUI - Modal interface for post-match review.
 */
export class DebriefUI {
    constructor() {
        this.claudeService = new ClaudeService();
        this.matchHistory = null;
        this.quizStorage = null;  // Set by main.js
        this.handTracker = null;  // Set by main.js
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
        this.decisionsEl = document.getElementById('debrief-decisions');
        this.lessonsList = document.getElementById('lessons-list');

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

        // Predictions tab elements
        this.predictionStats = document.getElementById('prediction-stats');
        this.accuracyOverall = document.getElementById('accuracy-overall');
        this.accuracyOpp1 = document.getElementById('accuracy-opp1');
        this.accuracyPartner = document.getElementById('accuracy-partner');
        this.accuracyOpp2 = document.getElementById('accuracy-opp2');
        this.accuracyTrend = document.getElementById('accuracy-trend');
        this.deductionTimelineList = document.getElementById('deduction-timeline-list');

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
        this.lessons = buildMatchLessons(matchHistory);

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
        this._updateLessons();
        this._updateKeyMoments();
        this._updateYourPlays();
        this._updateHandSelector();
        this._updateLLMSection();
        this._updatePredictionsTab();
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

        // Render predictions if switching to that tab
        if (tabId === 'predictions') {
            this._updatePredictionsTab();
        }
    }

    /**
     * Update the summary line
     * @private
     */
    _updateSummary() {
        if (!this.summaryEl || !this.lessons) return;

        const r = this.lessons.result;
        this.summaryEl.textContent = t(`debrief.result.${r.outcome}`, r.us, r.them, r.hands, r.hands !== 1 ? 's' : '');

        if (this.decisionsEl) {
            const d = this.lessons.decisions;
            let text = d.total > 0 ? t('debrief.decisions', d.pct, d.total) : t('debrief.decisions.none');
            if (d.forced > 0) text += t('debrief.decisions.forced', d.forced);
            this.decisionsEl.textContent = text;
        }
    }

    /**
     * Render the lessons (recurring patterns), lesson first.
     * @private
     */
    _updateLessons() {
        if (!this.lessonsList || !this.lessons) return;
        const L = this.lessons;

        if (L.weakCount === 0) {
            this.lessonsList.innerHTML = `<div class="empty-state">${t('debrief.lessons.clean')}</div>`;
            return;
        }
        if (L.patterns.length === 0) {
            this.lessonsList.innerHTML = `<div class="empty-state">${t('debrief.lessons.none')}</div>`;
            return;
        }

        this.lessonsList.innerHTML = L.patterns.map(p => {
            const evidence = p.hands.length === 1
                ? t('debrief.pattern.evidenceOne', p.count, L.weakCount, p.hands[0])
                : t('debrief.pattern.evidenceMany', p.count, L.weakCount, p.hands.join(', '));
            return `
                <div class="lesson-card">
                    <div class="lesson-title">${t(`debrief.lesson.${p.factor}.title`)}</div>
                    <div class="lesson-why">${t(`debrief.lesson.${p.factor}.why`)}</div>
                    <div class="lesson-evidence">${evidence}</div>
                </div>
            `;
        }).join('');
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
        if (!this.keyMomentsList || !this.lessons) return;
        const L = this.lessons;

        if (L.moments.length === 0) {
            this.keyMomentsList.innerHTML = `<div class="empty-state">${t('debrief.noMistakes')}</div>`;
            return;
        }

        const more = L.moreMoments > 0
            ? `<div class="moments-more">${t('debrief.moments.more', L.moreMoments)}</div>`
            : '';
        this.keyMomentsList.innerHTML = L.moments.map(m => this._renderMoment(m)).join('') + more;
    }

    /**
     * One key moment: the lesson, where it happened, the board, then why the
     * other tile was stronger (with the ISMCTS win rates when available).
     * @private
     */
    _renderMoment(m) {
        const play = m.play;
        const ta = play.turnAnalysis || {};
        const rec = play.aiRecommendation;
        const title = m.factor ? t(`debrief.lesson.${m.factor}.title`) : t('debrief.lesson.generic.title');
        // Resolve the reason now (not the play-time string) so it follows the UI language.
        const reason = m.factor ? t(`explain.contrast.${m.factor}`) : (ta.recReason || null);
        const opening = play.stateSnapshot && play.stateSnapshot.chainSize === 0;
        const verb = t(opening ? 'debrief.verb.opened' : 'debrief.verb.played');
        const played = play.tile.toString();
        const pick = rec?.tile ? rec.tile.toString() : '?';

        let sentence;
        if (reason && ta.recWinRate != null && ta.playedWinRate != null) {
            sentence = t('debrief.moment.why', verb, played, pick, reason,
                Math.round(ta.recWinRate * 100), Math.round(ta.playedWinRate * 100));
        } else if (reason) {
            sentence = t('debrief.moment.principle', verb, played, pick, reason);
        } else {
            sentence = t('debrief.moment.bare', verb, played, pick);
        }

        return `
            <div class="moment-item ${play.evaluation}">
                <div class="moment-header">
                    <span class="moment-lesson">${title}</span>
                    <span class="moment-badge ${play.evaluation}">${t(`debrief.stat.${play.evaluation}`)}</span>
                </div>
                <div class="moment-meta">${t('debrief.handYourPlay', m.handNumber, m.humanN)}</div>
                ${this._renderMiniBoard(play)}
                <div class="moment-sentence">${sentence}</div>
            </div>
        `;
    }

    /**
     * Mini board for a moment: the open ends (or empty board), the suits in
     * play, and the hand held — with the played tile and Genín's pick marked.
     * @private
     */
    _renderMiniBoard(play) {
        const ta = play.turnAnalysis;
        if (!ta || !Array.isArray(ta.handBefore)) return '';
        const snap = play.stateSnapshot || {};
        const rec = play.aiRecommendation;

        const ends = snap.chainSize > 0
            ? `<span class="mini-label">${t('debrief.board.ends')}</span>
               <span class="end-face">${createDominoHalf(snap.leftEnd)}</span>
               <span class="end-sep">…</span>
               <span class="end-face">${createDominoHalf(snap.rightEnd)}</span>`
            : `<span class="mini-label">${t('debrief.board.opening')}</span>`;

        const chips = [];
        if (ta.signals?.partner != null) chips.push(t('debrief.board.partnerSuit', ta.signals.partner));
        if (ta.signals?.own != null) chips.push(t('debrief.board.ownSuit', ta.signals.own));
        const opps = ta.signals?.opps || [];
        if (opps.length === 1) chips.push(t('debrief.board.oppSuit', opps[0]));
        else if (opps.length > 1) chips.push(t('debrief.board.oppSuits', opps.join(', ')));
        const chipsHtml = chips.map(c => `<span class="signal-chip">${c}</span>`).join('');

        const isTile = (tile, h, l) => tile && tile.high === h && tile.low === l;
        const handHtml = ta.handBefore.map(([h, l]) => {
            const el = createDominoElement(h, l, 'vertical', h === l);
            if (isTile(play.tile, h, l)) el.classList.add('mini-played');
            if (isTile(rec?.tile, h, l)) el.classList.add('mini-pick');
            return el.outerHTML;
        }).join('');

        return `
            <div class="mini-board">
                <div class="mini-row">${ends}${chipsHtml}</div>
                <div class="mini-row">
                    <span class="mini-label">${t('debrief.board.yourHand')}</span>
                    <div class="mini-hand">${handHtml}</div>
                </div>
                <div class="mini-legend">
                    <span class="legend-played">${t('debrief.board.played')}</span>
                    <span class="legend-pick">${t('debrief.board.pick')}</span>
                </div>
            </div>
        `;
    }

    /**
     * Update the "Your Plays" list
     * @private
     */
    _updateYourPlays() {
        if (!this.yourPlaysList || !this.matchHistory) return;

        const plays = this.matchHistory.getHumanPlays();

        if (plays.length === 0) {
            this.yourPlaysList.innerHTML = `<div class="empty-state">${t('debrief.noPlays')}</div>`;
            return;
        }

        // "Your play N" within each hand counts tile plays only (passes aren't
        // numbered), matching the hand-end card and the key moments.
        const humanN = {};
        this.yourPlaysList.innerHTML = plays.map(item => {
            const play = item.play;
            const isPass = play.tile === null;
            const isForced = MatchHistory.isForced(play);
            const evalLabel = play.evaluation ? t(`debrief.stat.${play.evaluation}`) : t('na');
            if (!isPass) humanN[item.handNumber] = (humanN[item.handNumber] || 0) + 1;
            const label = isPass
                ? t('debrief.handPass', item.handNumber)
                : t('debrief.handYourPlay', item.handNumber, humanN[item.handNumber]);

            return `
                <div class="play-item${isForced ? ' forced' : ''}">
                    <div class="play-header">
                        <span class="play-info">${label}</span>
                        ${isPass
                            ? `<span class="play-badge pass">${t('pass')}</span>`
                            : isForced
                                ? `<span class="play-badge forced">${t('debrief.forced')}</span>`
                                : `<span class="play-badge ${play.evaluation || ''}">${evalLabel}</span>`
                        }
                    </div>
                    <div class="play-tile">
                        ${isPass ? t('debrief.passed') : t('debrief.played', play.tile.toString(), play.end)}
                    </div>
                    ${!isPass && play.aiRecommendation ? `
                        <div class="play-recommendation">
                            ${t('ai')}: ${play.aiRecommendation.tile?.toString() || 'unknown'} on ${play.aiRecommendation.end} - "${play.aiRecommendation.reasoning}"
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
            option.textContent = t('debrief.hand', i);
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
            this.fullMatchPlays.innerHTML = `<div class="empty-state">${t('debrief.noPlaysHand')}</div>`;
            return;
        }

        this.fullMatchPlays.innerHTML = hand.plays.map((play, index) => {
            const playerName = GameState.getPlayerName(play.player);
            const isHuman = play.isHuman;
            const isPass = play.tile === null;

            let badgeClass = isHuman ? (play.evaluation || '') : 'ai';
            let badgeText = isHuman ? (play.evaluation ? t(`debrief.stat.${play.evaluation}`) : t('na')) : t('ai');
            if (isHuman && MatchHistory.isForced(play)) {
                badgeClass = 'forced';
                badgeText = t('debrief.forced');
            }
            if (isPass) {
                badgeClass = 'pass';
                badgeText = t('pass');
            }

            return `
                <div class="play-item">
                    <div class="play-header">
                        <span class="play-info">${playerName} - Play ${index + 1}</span>
                        <span class="play-badge ${badgeClass}">${badgeText}</span>
                    </div>
                    <div class="play-tile">
                        ${isPass ? t('pass') : t('debrief.played', play.tile.toString(), play.end)}
                    </div>
                    ${!isPass && play.actualReasoning && !isHuman ? `
                        <div class="play-recommendation">${play.actualReasoning}</div>
                    ` : ''}
                    ${!isPass && isHuman && play.aiRecommendation ? `
                        <div class="play-recommendation">
                            ${t('debrief.aiRecommended', play.aiRecommendation.tile?.toString() || 'unknown', play.aiRecommendation.reasoning)}
                        </div>
                    ` : ''}
                </div>
            `;
        }).join('');

        // Add result if available
        if (hand.result) {
            const reasonText = hand.result.reason === 'domino' ? t('debrief.dominoResult') :
                               hand.result.reason === 'closed' ? t('debrief.closedResult') : t('debrief.blockedResult');
            const resultInfo = hand.result.winner >= 0
                ? t('debrief.wins', GameState.getTeamName(hand.result.winner), hand.result.points)
                : t('debrief.tieResult');

            const resultHtml = `
                <div class="play-item" style="border-left: 3px solid #00d4ff;">
                    <div class="play-header">
                        <span class="play-info">${t('debrief.handResult')}</span>
                    </div>
                    <div class="play-tile">
                        ${reasonText} - ${resultInfo}
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
            const result = await this.claudeService.analyzePlayStyle(this.matchHistory, i18n.getLanguage());

            this.llmLoading.style.display = 'none';

            if (result.success) {
                // Render Markdown sections (## headings, **bold**, *italic*,
                // paragraphs) to HTML so the v1.2.4 structured output shows
                // up as actual sections instead of literal `##` characters.
                this.llmResult.innerHTML = renderAnalysisMarkdown(result.analysis);
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

    /**
     * Update the Predictions tab content
     * @private
     */
    _updatePredictionsTab() {
        this._updateMatchQuizStats();
        this._updateHistoricalAccuracy();
        this._updateDeductionTimeline();
    }

    /**
     * Update match quiz statistics
     * @private
     */
    _updateMatchQuizStats() {
        if (!this.predictionStats || !this.matchHistory) return;

        const quizResults = this.matchHistory.getQuizResults();
        const quizStats = this.matchHistory.getQuizStats();

        if (quizStats.totalQuizzes === 0) {
            this.predictionStats.innerHTML = `<div class="empty-state">${t('debrief.predictions.noQuizzes')}</div>`;
            return;
        }

        // Build detailed results for each quiz
        let detailedHtml = '';
        for (const quiz of quizResults) {
            const playerName = this._getPlayerName(quiz.targetPlayer);
            detailedHtml += `
                <div class="quiz-result-card">
                    <div class="quiz-result-header">
                        <span class="quiz-target">${t('debrief.predictions.predictedFor', playerName)}</span>
                        <span class="quiz-score-badge">${quiz.score} ${t('debrief.predictions.points')}</span>
                    </div>
                    <div class="quiz-result-breakdown">
                        <div class="quiz-stat correct">
                            <span class="label">${t('quiz.correct')}</span>
                            <span class="value">${quiz.correct}</span>
                        </div>
                        <div class="quiz-stat wrong">
                            <span class="label">${t('quiz.wrong')}</span>
                            <span class="value">${quiz.wrong}</span>
                        </div>
                        <div class="quiz-stat missed">
                            <span class="label">${t('quiz.missed')}</span>
                            <span class="value">${quiz.missed}</span>
                        </div>
                    </div>
                    ${this._renderQuizTileDetails(quiz)}
                </div>
            `;
        }

        // Summary stats
        this.predictionStats.innerHTML = `
            <div class="quiz-results-detail">
                <h4>${t('debrief.predictions.yourPredictions')}</h4>
                ${detailedHtml}
            </div>
            <div class="quiz-summary">
                <h4>${t('debrief.predictions.matchSummary')}</h4>
                <div class="prediction-stat-row">
                    <span class="stat-label">${t('debrief.predictions.quizzesTaken')}</span>
                    <span class="stat-value">${quizStats.totalQuizzes}</span>
                </div>
                <div class="prediction-stat-row">
                    <span class="stat-label">${t('debrief.predictions.avgScore')}</span>
                    <span class="stat-value">${quizStats.avgScore}</span>
                </div>
                <div class="prediction-stat-row">
                    <span class="stat-label">${t('debrief.predictions.accuracy')}</span>
                    <span class="stat-value">${quizStats.accuracy}%</span>
                </div>
            </div>
        `;
    }

    /**
     * Render tile details for a quiz result
     * @private
     */
    _renderQuizTileDetails(quiz) {
        // Calculate which tiles were correct, wrong, missed
        const predicted = new Set(quiz.userPrediction);
        const actual = new Set(quiz.actualHand);

        const correct = quiz.userPrediction.filter(t => actual.has(t));
        const wrong = quiz.userPrediction.filter(t => !actual.has(t));
        const missed = quiz.actualHand.filter(t => !predicted.has(t));

        let html = '<div class="quiz-tiles-detail">';

        if (correct.length > 0) {
            html += `<div class="tile-group correct">
                <span class="group-label">${t('quiz.correctlyPredicted')}</span>
                <div class="tiles">${correct.map(k => `<span class="tile-mini">${k}</span>`).join('')}</div>
            </div>`;
        }

        if (wrong.length > 0) {
            html += `<div class="tile-group wrong">
                <span class="group-label">${t('quiz.incorrectlyPredicted')}</span>
                <div class="tiles">${wrong.map(k => `<span class="tile-mini">${k}</span>`).join('')}</div>
            </div>`;
        }

        if (missed.length > 0) {
            html += `<div class="tile-group missed">
                <span class="group-label">${t('quiz.missedTiles')}</span>
                <div class="tiles">${missed.map(k => `<span class="tile-mini">${k}</span>`).join('')}</div>
            </div>`;
        }

        html += '</div>';
        return html;
    }

    /**
     * Get player name by index
     * @private
     */
    _getPlayerName(playerIndex) {
        const names = [t('player.you'), t('player.opp1'), t('player.partner'), t('player.opp2')];
        return names[playerIndex] || `Player ${playerIndex}`;
    }

    /**
     * Update historical accuracy display
     * @private
     */
    _updateHistoricalAccuracy() {
        if (!this.quizStorage) return;

        const stats = this.quizStorage.getAccuracyStats();

        // Update overall accuracy
        if (this.accuracyOverall) {
            this.accuracyOverall.textContent = stats.overall.totalQuizzes > 0
                ? `${stats.overall.accuracy}%`
                : '--%';
        }

        // Update per-player accuracy
        if (this.accuracyOpp1) {
            this.accuracyOpp1.textContent = stats.byPlayer[1].quizzes > 0
                ? `${stats.byPlayer[1].accuracy}%`
                : '--%';
        }

        if (this.accuracyPartner) {
            this.accuracyPartner.textContent = stats.byPlayer[2].quizzes > 0
                ? `${stats.byPlayer[2].accuracy}%`
                : '--%';
        }

        if (this.accuracyOpp2) {
            this.accuracyOpp2.textContent = stats.byPlayer[3].quizzes > 0
                ? `${stats.byPlayer[3].accuracy}%`
                : '--%';
        }

        // Update trend
        if (this.accuracyTrend) {
            const trend = this.quizStorage.getAccuracyTrend();

            if (trend.trend === 'insufficient_data') {
                this.accuracyTrend.textContent = t('debrief.history.trend.insufficient');
                this.accuracyTrend.className = 'accuracy-trend stable';
            } else {
                const trendText = trend.trend === 'improving'
                    ? t('debrief.history.trend.improving', trend.recent, trend.previous)
                    : trend.trend === 'declining'
                    ? t('debrief.history.trend.declining', trend.recent, trend.previous)
                    : t('debrief.history.trend.stable', trend.recent, trend.previous);

                this.accuracyTrend.textContent = trendText;
                this.accuracyTrend.className = `accuracy-trend ${trend.trend}`;
            }
        }
    }

    /**
     * Update deduction timeline
     * @private
     */
    _updateDeductionTimeline() {
        if (!this.deductionTimelineList || !this.handTracker) return;

        const history = this.handTracker.getDeductionHistory();

        if (history.length === 0) {
            this.deductionTimelineList.innerHTML = `<div class="empty-state">${t('debrief.timeline.noDeductions')}</div>`;
            return;
        }

        // Show only pass-related deductions (most interesting for learning)
        const passDeductions = history.filter(d => d.type === 'pass');

        if (passDeductions.length === 0) {
            this.deductionTimelineList.innerHTML = `<div class="empty-state">${t('debrief.timeline.noPasses')}</div>`;
            return;
        }

        this.deductionTimelineList.innerHTML = passDeductions.map(d => `
            <div class="timeline-item ${d.type}">
                <div class="timeline-header">
                    <span class="timeline-play">${t('debrief.timeline.afterPlay', d.playIndex)}</span>
                    <span class="timeline-type">${d.type}</span>
                </div>
                <p class="timeline-description">${d.description}</p>
            </div>
        `).join('');
    }
}
