import { Game } from './engine/Game.js';
import { GameState } from './models/GameState.js';
import { SmartAI } from './ai/SmartAI.js';
import { HandTracker } from './ai/HandTracker.js';
import { PlayerView } from './ai/PlayerView.js';
import { DebriefUI } from './ui/DebriefUI.js';
import { SettingsUI } from './ui/SettingsUI.js';
import { StatsUI } from './ui/StatsUI.js';
import { BadgeToast } from './ui/BadgeToast.js';
import { PlayerStats } from './stats/PlayerStats.js';
import { BadgeSystem } from './stats/BadgeSystem.js';
import { QuizStorage } from './services/QuizStorage.js';
import { Tile } from './models/Tile.js';
import { ProbabilityAnalyzer } from './ai/ProbabilityAnalyzer.js';
import { t, i18n } from './i18n/i18n.js';

// Check for debug mode via URL parameter (?debug=ai)
const DEBUG_AI = new URLSearchParams(window.location.search).get('debug') === 'ai';

/**
 * Pip positions for each value 0-6
 */
const PIP_POSITIONS = {
    0: [],
    1: ['center'],
    2: ['top-left', 'bottom-right'],
    3: ['top-left', 'center', 'bottom-right'],
    4: ['top-left', 'top-right', 'bottom-left', 'bottom-right'],
    5: ['top-left', 'top-right', 'center', 'bottom-left', 'bottom-right'],
    6: ['top-left', 'top-right', 'middle-left', 'middle-right', 'bottom-left', 'bottom-right']
};

/**
 * Create HTML for a domino half (one side showing pips)
 */
function createDominoHalf(value) {
    const positions = PIP_POSITIONS[value] || [];
    const pips = positions.map(pos => `<div class="pip ${pos}"></div>`).join('');
    return `<div class="domino-half">${pips}</div>`;
}

/**
 * Create a visual domino element
 * @param {number} firstValue - Value shown on top (vertical) or left (horizontal)
 * @param {number} secondValue - Value shown on bottom (vertical) or right (horizontal)
 * @param {string} orientation - 'horizontal' or 'vertical'
 * @param {boolean} isDouble - true if this is a double
 */
function createDominoElement(firstValue, secondValue, orientation = 'horizontal', isDouble = false) {
    const div = document.createElement('div');
    div.className = `domino ${orientation}${isDouble ? ' double' : ''}`;
    div.innerHTML = createDominoHalf(firstValue) + createDominoHalf(secondValue);
    div.dataset.tile = `${Math.max(firstValue, secondValue)}-${Math.min(firstValue, secondValue)}`;
    return div;
}

/**
 * Create a visual domino element from a Tile (for hand display)
 * @param {Tile} tile
 * @param {string} orientation - 'horizontal' or 'vertical'
 */
function createDominoFromTile(tile, orientation = 'horizontal') {
    return createDominoElement(tile.high, tile.low, orientation, tile.isDouble());
}

/**
 * Create mini face-down tiles to show tile count
 */
function createTileCountDisplay(count, orientation = 'horizontal') {
    const container = document.createElement('div');
    container.className = `tile-count ${orientation}`;

    // Show up to 7 mini tiles, or a badge if many
    if (count <= 7) {
        for (let i = 0; i < count; i++) {
            const miniTile = document.createElement('div');
            miniTile.className = 'mini-tile';
            container.appendChild(miniTile);
        }
    } else {
        const badge = document.createElement('div');
        badge.className = 'tile-count-badge';
        badge.textContent = count;
        container.appendChild(badge);
    }

    return container;
}

/**
 * Main UI Controller for Domino Advisor
 */
class DominoApp {
    constructor() {
        this.game = new Game();
        this.ai = new SmartAI();
        this.handTracker = new HandTracker();
        this.quizStorage = new QuizStorage();

        // Connect HandTracker to SmartAI for probability-based decisions
        this.ai.setHandTracker(this.handTracker);

        // Create per-player probability views with Bayesian suit affinity inference
        this.playerViews = [0, 1, 2, 3].map(i => new PlayerView(i, this.handTracker));
        this.ai.setPlayerViews(this.playerViews);

        // Probability accuracy analyzer (debug mode only)
        this.probAnalyzer = DEBUG_AI ? new ProbabilityAnalyzer(this.playerViews) : null;

        this.selectedTile = null;

        // Quiz state
        this.quizTargetPlayer = null;
        this.quizSelectedTiles = new Set();

        // Attribution toggle state
        this.showTileAttribution = false;

        // Advice bubble state
        this.adviceBubbleVisible = false;

        // UI modules
        this.debriefUI = new DebriefUI();
        this.settingsUI = new SettingsUI();
        this.playerStats = new PlayerStats();
        this.playerStats.load();
        this.badgeSystem = new BadgeSystem();
        this.badgeToast = new BadgeToast();
        this.statsUI = new StatsUI(this.playerStats);

        this.initElements();
        this.initEventHandlers();
        this.initGameCallbacks();
        this.initUIModules();
        this.initQuizElements();
    }

    initElements() {
        // Score elements
        this.teamAScore = document.getElementById('team-a-score');
        this.teamBScore = document.getElementById('team-b-score');

        // Player name elements
        this.playerNames = [
            document.getElementById('player-0-name'),
            document.getElementById('player-1-name'),
            document.getElementById('player-2-name'),
            document.getElementById('player-3-name')
        ];

        // Player tile count containers
        this.playerTiles = [
            null, // Player 0's tiles shown in hand area
            document.getElementById('player-1-tiles'),
            document.getElementById('player-2-tiles'),
            document.getElementById('player-3-tiles')
        ];

        // Chain display
        this.chainContainer = document.getElementById('chain');
        this.emptyMessage = document.getElementById('empty-message');
        this.openEndsDisplay = document.getElementById('open-ends');

        // Hand display
        this.handContainer = document.getElementById('hand');
        this.handCount = document.getElementById('hand-count');

        // Buttons
        this.newGameBtn = document.getElementById('new-game-btn');
        this.quizBtn = document.getElementById('quiz-btn');
        this.passBtn = document.getElementById('pass-btn');

        // End selection modal
        this.endSelection = document.getElementById('end-selection');
        this.modalOverlay = document.getElementById('modal-overlay');
        this.leftEndBtn = document.getElementById('left-end-btn');
        this.rightEndBtn = document.getElementById('right-end-btn');
        this.cancelEndBtn = document.getElementById('cancel-end-btn');

        // Message box
        this.messageBox = document.getElementById('message-box');
        this.messageTitle = document.getElementById('message-title');
        this.messageText = document.getElementById('message-text');
        this.messageGenin = document.getElementById('message-genin');
        this.continueBtn = document.getElementById('continue-btn');
        this.reviewBtn = document.getElementById('review-btn');

        // Log
        this.logContainer = document.getElementById('log');

        // Attribution toggle
        this.attributionToggle = document.getElementById('attribution-toggle');
        this.playerLegend = document.getElementById('player-legend');

        // Help modal
        this.helpBtn = document.getElementById('help-btn');
        this.helpModal = document.getElementById('help-modal');
        this.helpOverlay = document.getElementById('help-overlay');
        this.closeHelpBtn = document.getElementById('close-help-btn');

        // Genín advice
        this.geninAdviceContainer = document.getElementById('genin-advice-container');
        this.geninAdviceBtn = document.getElementById('genin-advice-btn');
        this.geninSpeechBubble = document.getElementById('genin-speech-bubble');
        this.speechDomino = document.getElementById('speech-domino');
        this.speechEnd = document.getElementById('speech-end');
        this.speechReason = document.getElementById('speech-reason');
        this.speechDetail = document.getElementById('speech-detail');
        this.speechAvatar = document.getElementById('speech-avatar');
    }

    initUIModules() {
        // Initialize settings UI
        this.settingsUI.init();

        // Initialize stats UI
        this.statsUI.init();

        // Initialize debrief UI
        this.debriefUI.init();
        this.debriefUI.onNewMatch = () => this.startNewGame();
        this.debriefUI.onOpenSettings = () => this.settingsUI.show();

        // Pass quiz storage and hand tracker to debrief UI
        this.debriefUI.quizStorage = this.quizStorage;
        this.debriefUI.handTracker = this.handTracker;

        // Initialize help modal handlers
        this._initHelpModal();

        // Initialize language toggle
        this._initLanguageToggle();

        // Update DOM with current language
        i18n.updateDOM();

        // Listen for language changes to update dynamic content
        i18n.onLanguageChange(() => {
            this._updateLanguageToggle();
            this.hideAdviceBubble();
            // Re-render chain if game is active (for open ends text)
            const state = this.game.getState();
            if (state && state.chain) {
                this.updateOpenEnds(state.chain);
            }
        });
    }

    _initLanguageToggle() {
        const langToggle = document.getElementById('lang-toggle');
        if (langToggle) {
            langToggle.addEventListener('click', () => {
                i18n.toggleLanguage();
            });
        }
        this._updateLanguageToggle();
    }

    _updateLanguageToggle() {
        const currentLang = i18n.getLanguage();
        document.querySelectorAll('.lang-option').forEach(el => {
            const lang = el.getAttribute('data-lang');
            el.classList.toggle('active', lang === currentLang);
        });
    }

    _initHelpModal() {
        if (this.helpBtn) {
            this.helpBtn.addEventListener('click', () => this.showHelp());
        }
        if (this.closeHelpBtn) {
            this.closeHelpBtn.addEventListener('click', () => this.hideHelp());
        }
        if (this.helpOverlay) {
            this.helpOverlay.addEventListener('click', () => this.hideHelp());
        }
    }

    showHelp() {
        if (this.helpModal) {
            this.helpModal.classList.add('visible');
        }
        if (this.helpOverlay) {
            this.helpOverlay.classList.add('visible');
        }
    }

    hideHelp() {
        if (this.helpModal) {
            this.helpModal.classList.remove('visible');
        }
        if (this.helpOverlay) {
            this.helpOverlay.classList.remove('visible');
        }
    }

    initQuizElements() {
        // Quiz modal elements
        this.quizModal = document.getElementById('quiz-modal');
        this.quizOverlay = document.getElementById('quiz-overlay');
        this.closeQuizBtn = document.getElementById('close-quiz-btn');
        this.quizContext = document.getElementById('quiz-context');
        this.quizTileGrid = document.getElementById('quiz-tile-grid');
        this.quizSelectionCount = document.getElementById('quiz-selection-count');
        this.quizTargetCount = document.getElementById('quiz-target-count');
        this.submitQuizBtn = document.getElementById('submit-quiz-btn');
        this.skipQuizBtn = document.getElementById('skip-quiz-btn');
        this.quizResult = document.getElementById('quiz-result');
        this.quizScoreValue = document.getElementById('quiz-score-value');
        this.quizBreakdown = document.getElementById('quiz-breakdown');
        this.quizDoneBtn = document.getElementById('quiz-done-btn');
        this.targetBtns = document.querySelectorAll('.target-btn');

        // Quiz event handlers
        if (this.quizBtn) {
            this.quizBtn.addEventListener('click', () => this.showQuizModal());
        }

        if (this.closeQuizBtn) {
            this.closeQuizBtn.addEventListener('click', () => this.hideQuizModal());
        }

        if (this.quizOverlay) {
            this.quizOverlay.addEventListener('click', () => this.hideQuizModal());
        }

        if (this.skipQuizBtn) {
            this.skipQuizBtn.addEventListener('click', () => this.hideQuizModal());
        }

        if (this.submitQuizBtn) {
            this.submitQuizBtn.addEventListener('click', () => this.submitQuiz());
        }

        if (this.quizDoneBtn) {
            this.quizDoneBtn.addEventListener('click', () => this.hideQuizModal());
        }

        // Target player selection
        this.targetBtns.forEach(btn => {
            btn.addEventListener('click', () => {
                const player = parseInt(btn.dataset.player, 10);
                this.selectQuizTarget(player);
            });
        });
    }

    initEventHandlers() {
        this.newGameBtn.addEventListener('click', () => this.startNewGame());
        this.passBtn.addEventListener('click', () => this.handlePass());

        this.leftEndBtn.addEventListener('click', () => this.playSelectedTile('left'));
        this.rightEndBtn.addEventListener('click', () => this.playSelectedTile('right'));
        this.cancelEndBtn.addEventListener('click', () => this.cancelSelection());

        this.continueBtn.addEventListener('click', () => this.handleContinue());
        this.reviewBtn.addEventListener('click', () => this.showDebrief());

        // Genín advice button
        if (this.geninAdviceBtn) {
            this.geninAdviceBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                this.toggleAdviceBubble();
            });
        }

        // Dismiss advice bubble on outside click
        document.addEventListener('click', (e) => {
            if (this.adviceBubbleVisible &&
                !this.geninSpeechBubble.contains(e.target) &&
                !this.geninAdviceBtn.contains(e.target)) {
                this.hideAdviceBubble();
            }
        });

        // Attribution toggle
        if (this.attributionToggle) {
            this.attributionToggle.addEventListener('change', () => {
                this.showTileAttribution = this.attributionToggle.checked;
                if (this.playerLegend) {
                    this.playerLegend.style.display = this.showTileAttribution ? 'flex' : 'none';
                }
                // Re-render the chain with the new setting
                const state = this.game.getState();
                if (state && state.chain) {
                    this.renderChain(state.chain);
                }
            });
        }
    }

    updateQuizButton() {
        const state = this.game.getState();
        // Enable quiz button during gameplay (after at least one play)
        const canQuiz = state.gamePhase === 'playing' && !state.chain.isEmpty();
        if (this.quizBtn) {
            this.quizBtn.disabled = !canQuiz;
        }
    }

    initGameCallbacks() {
        this.game.onStateChange = (state) => this.updateUI(state);

        this.game.onPlay = (data) => {
            const playerName = GameState.getPlayerName(data.player);
            let msg;
            if (data.openEndsBefore) {
                const { left, right } = data.openEndsBefore;
                if (left === right) {
                    msg = t('log.playsOpen', playerName, data.tile.toString(), left);
                } else {
                    msg = t('log.playsEnds', playerName, data.tile.toString(), left, right);
                }
            } else {
                msg = t('log.plays', playerName, data.tile.toString());
            }
            this.log(msg, `player-${data.player}`);

            // Capture probability snapshot BEFORE updates (debug mode)
            if (this.probAnalyzer) {
                const end = data.openEndsBefore ? data.end[0].toUpperCase() : '';
                const event = `${GameState.getPlayerName(data.player)}: ${data.tile.toString()}${end ? '→' + end : ''}`;
                this.probAnalyzer.captureSnapshot(this.game.getState(), event, data.player, data.tile);
            }

            // Record this play for AI tracking (suit counts, play choice inference)
            const leftEnd = data.openEndsBefore?.left ?? null;
            const rightEnd = data.openEndsBefore?.right ?? null;
            this.ai.recordPlay(data.player, data.tile, data.end, leftEnd, rightEnd);

            // Record for hand tracker (probability tracking)
            this.handTracker.recordPlay(data.player, data.tile);

            // Feed play observation to all player views (Bayesian affinity updates)
            for (const view of this.playerViews) {
                view.recordPlayObservation(data.player, data.tile, data.end, leftEnd, rightEnd);
            }

            // Update quiz button state
            this.updateQuizButton();
        };

        this.game.onPass = (data) => {
            const playerName = GameState.getPlayerName(data.player);
            const state = this.game.getState();
            const leftEnd = state.chain.leftEnd;
            const rightEnd = state.chain.rightEnd;
            this.log(t('log.passes', playerName, leftEnd, rightEnd), `player-${data.player} pass-entry`);

            // Show pass badge on the player's position
            this.showPassBadge(data.player);

            // Capture probability snapshot BEFORE updates (debug mode)
            if (this.probAnalyzer) {
                const event = `${GameState.getPlayerName(data.player)}: pass`;
                this.probAnalyzer.captureSnapshot(this.game.getState(), event, data.player, null);
            }

            // Record this pass for AI tracking (inferred dead suits)
            this.ai.recordPass(data.player, leftEnd, rightEnd);

            // Record for hand tracker (probability tracking)
            this.handTracker.recordPass(data.player, leftEnd, rightEnd);
        };

        this.game.onHandEnd = (data) => {
            // Analyze probability accuracy before showing results (debug mode)
            if (this.probAnalyzer) {
                this.probAnalyzer.analyzeAndLog(this.game.getState().hands);
            }
            this.showHandEndMessage(data);
        };

        this.game.onMatchEnd = (data) => {
            if (this.probAnalyzer) {
                this.probAnalyzer.logMatchSummary();
            }
            this.showMatchEndMessage(data);
        };

        this.game.onError = (msg) => {
            console.error('Game error:', msg);
            this.log(t('log.error', msg), 'system');
        };
    }

    startNewGame() {
        this.clearLog();
        this.hideThinkingIndicator();
        this.log(t('log.newMatch'), 'system');
        this.ai.resetForNewHand();
        if (this.probAnalyzer) this.probAnalyzer.resetMatch();
        this.playerStats.resetMatchSession();
        this.game.newMatch();

        // Initialize hand tracker with human's hand
        const state = this.game.getState();
        this.handTracker.initHand(state.hands[0]);

        // Initialize per-player views with each player's hand
        for (let i = 0; i < 4; i++) {
            this.playerViews[i].resetAffinities();
            this.playerViews[i].initOwnHand(state.hands[i]);
        }

        const starterName = GameState.getPlayerName(state.currentPlayer);
        this.log(t('log.starterHasDouble', starterName), 'system');

        this.updateQuizButton();

        if (!this.game.isHumanTurn()) {
            this.scheduleAITurn();
        }
    }

    updateUI(state) {
        // Update scores
        this.teamAScore.textContent = state.scores.match[0];
        this.teamBScore.textContent = state.scores.match[1];

        // Update player names (highlight current player)
        for (let i = 0; i < 4; i++) {
            const nameEl = this.playerNames[i];
            nameEl.classList.toggle('current-turn', state.currentPlayer === i && state.gamePhase === 'playing');
        }

        // Update other players' tile counts
        this.updatePlayerTileCounts(state);

        // Update chain display
        this.renderChain(state.chain);

        // Update open ends indicator
        this.updateOpenEnds(state.chain);

        // Update hand display
        this.renderHand(state);

        // Update pass button
        const canPass = state.currentPlayer === 0 && state.gamePhase === 'playing' && this.game.mustPass();
        this.passBtn.disabled = !canPass;

        // Update Genín advice visibility
        this.updateGeninAdviceVisibility(state);
    }

    updatePlayerTileCounts(state) {
        // Update tile counts for players 1, 2, 3 (opponents and partner)
        for (let i = 1; i <= 3; i++) {
            const container = this.playerTiles[i];
            if (!container) continue;

            const count = state.hands[i].size();
            container.innerHTML = '';

            const orientation = (i === 1 || i === 3) ? 'vertical' : 'horizontal';
            const display = createTileCountDisplay(count, orientation);
            container.appendChild(display);
        }

        // Update hand count for player 0
        this.handCount.textContent = `(${state.hands[0].size()} ${t('hand.tiles')})`;
    }

    _buildDominoEl(pt, flip = false) {
        const isDouble = pt.tile.isDouble();
        const orientation = isDouble ? 'vertical' : 'horizontal';
        let leftVal = pt.leftValue;
        let rightVal = pt.rightValue;
        if (flip && !isDouble) { leftVal = pt.rightValue; rightVal = pt.leftValue; }
        const domino = createDominoElement(leftVal, rightVal, orientation, isDouble);
        if (this.showTileAttribution && pt.playedBy !== undefined && pt.playedBy >= 0) {
            domino.classList.add('show-player', `played-by-${pt.playedBy}`);
            const indicator = document.createElement('div');
            indicator.className = `player-indicator player-${pt.playedBy}`;
            const initials = [
                t('attribution.initials.you'), t('attribution.initials.opp1'),
                t('attribution.initials.partner'), t('attribution.initials.opp2')
            ];
            indicator.textContent = initials[pt.playedBy];
            domino.appendChild(indicator);
        }
        return domino;
    }

    renderChain(chain) {
        this.chainContainer.innerHTML = '';

        if (chain.isEmpty()) {
            const msg = document.createElement('div');
            msg.className = 'empty-table-message';
            msg.textContent = t('table.waiting');
            msg.style.color = 'rgba(255,255,255,0.5)';
            this.chainContainer.appendChild(msg);
            return;
        }

        const placedTiles = chain.getPlacedTiles();
        const F = chain.firstTileIndex;
        const tilesPerRow = this._calculateTilesPerRow();
        const halfCap = Math.floor((tilesPerRow - 1) / 2); // arm slots in 3-col anchor row
        const contCap = tilesPerRow;                        // slots in full-width cont rows

        // leftArm[0] = tile immediately left of start; [1] = next outward, etc.
        const leftArm  = placedTiles.slice(0, F).reverse();
        const startPt  = placedTiles[F];
        const rightArm = placedTiles.slice(F + 1);

        const chainDiv = document.createElement('div');
        chainDiv.className = 'chain';

        // --- Anchor row: [left-arm tail | start tile | right-arm tail] ---
        const anchorRow = document.createElement('div');
        anchorRow.className = 'chain-paired-row';

        const leftCell = document.createElement('div');
        leftCell.className = 'chain-left-cell'; // CSS default: flex-end (toward center)
        [...leftArm.slice(0, halfCap)].reverse()
            .forEach(pt => leftCell.appendChild(this._buildDominoEl(pt, false)));

        const centerCell = document.createElement('div');
        centerCell.className = 'chain-start-cell';
        centerCell.appendChild(this._buildDominoEl(startPt, false));

        const rightCell = document.createElement('div');
        rightCell.className = 'chain-right-cell'; // CSS default: flex-start (toward center)
        rightArm.slice(0, halfCap)
            .forEach(pt => rightCell.appendChild(this._buildDominoEl(pt, false)));

        anchorRow.appendChild(leftCell);
        anchorRow.appendChild(centerCell);
        anchorRow.appendChild(rightCell);
        chainDiv.appendChild(anchorRow);

        // --- Left arm continuation rows (fold UPWARD above anchor) ---
        // la=1,3,… start at LEFT wall (flex-start, forward display, flip=true)
        // la=2,4,… start at RIGHT wall (flex-end, reversed display, flip=false)
        // Connector between anchor and la=1 is at LEFT wall; between la=1 and la=2 at RIGHT wall.
        // Each pair is prepended so la=1 ends up just above anchor, la=N at the very top.
        for (let la = 1; ; la++) {
            const start = halfCap + (la - 1) * contCap;
            const slice = leftArm.slice(start, start + contCap);
            if (slice.length === 0) break;

            const flip    = (la % 2 === 1);
            const justify = (la % 2 === 1) ? 'flex-start' : 'flex-end';
            const display = (la % 2 === 1) ? [...slice] : [...slice].reverse();
            const connSide = (la % 2 === 1) ? 'left' : 'right';

            const connEl = this._buildConnectorRow(connSide);
            const rowEl = document.createElement('div');
            rowEl.className = 'chain-cont-row';
            rowEl.style.justifyContent = justify;
            display.forEach(pt => rowEl.appendChild(this._buildDominoEl(pt, flip)));

            // prepend connEl then rowEl → rowEl lands above connEl in DOM
            chainDiv.prepend(connEl);
            chainDiv.prepend(rowEl);
        }

        // --- Right arm continuation rows (fold DOWNWARD below anchor) ---
        // ra=1,3,… start at RIGHT wall (flex-end, reversed display, flip=true)
        // ra=2,4,… start at LEFT wall (flex-start, forward display, flip=false)
        // Connector between anchor and ra=1 is at RIGHT wall; between ra=1 and ra=2 at LEFT wall.
        for (let ra = 1; ; ra++) {
            const start = halfCap + (ra - 1) * contCap;
            const slice = rightArm.slice(start, start + contCap);
            if (slice.length === 0) break;

            const flip    = (ra % 2 === 1);
            const justify = (ra % 2 === 1) ? 'flex-end' : 'flex-start';
            const display = (ra % 2 === 1) ? [...slice].reverse() : [...slice];
            const connSide = (ra % 2 === 1) ? 'right' : 'left';

            const connEl = this._buildConnectorRow(connSide);
            const rowEl = document.createElement('div');
            rowEl.className = 'chain-cont-row';
            rowEl.style.justifyContent = justify;
            display.forEach(pt => rowEl.appendChild(this._buildDominoEl(pt, flip)));

            chainDiv.appendChild(connEl);
            chainDiv.appendChild(rowEl);
        }

        this.chainContainer.appendChild(chainDiv);
    }

    _buildConnectorRow(side) {
        const el = document.createElement('div');
        el.className = 'chain-cont-connector';
        el.style.justifyContent = (side === 'left') ? 'flex-start' : 'flex-end';
        const cls = (side === 'left') ? 'chain-turn left-side' : 'chain-turn';
        el.innerHTML = `<div class="${cls}"><div class="turn-connector"></div></div>`;
        return el;
    }

    /**
     * Calculate optimal tiles per row based on available screen width.
     * @returns {number} Number of tiles that fit per row
     */
    _calculateTilesPerRow() {
        const screenWidth = window.innerWidth;

        // Tile widths at different breakpoints (matching CSS)
        // Desktop: 56px tile + 2px gap = 58px per tile
        // Mobile (<=480px): 44px tile + 2px gap = 46px per tile
        // Very small (<=360px): 38px tile + 2px gap = 40px per tile

        // Chain container has padding and is inside the table grid
        // Table has border (12px desktop, 8px mobile) and side columns (60px desktop, 45px mobile)
        // Rough available width = screenWidth - 2*border - 2*sideColumn - 2*padding

        if (screenWidth <= 360) {
            // Very small screens: ~40px per tile, available ~200px
            return 4;
        } else if (screenWidth <= 480) {
            // Mobile: ~46px per tile, available ~280px
            return 5;
        } else if (screenWidth <= 600) {
            // Small tablet: ~50px per tile
            return 6;
        } else if (screenWidth <= 800) {
            // Tablet
            return 7;
        } else {
            // Desktop
            return 8;
        }
    }

    updateOpenEnds(chain) {
        if (chain.isEmpty()) {
            this.openEndsDisplay.innerHTML = '';
            return;
        }

        this.openEndsDisplay.innerHTML = `
            ${t('table.openEnds')} <span>${t('table.left')}: ${chain.leftEnd}</span> <span>${t('table.right')}: ${chain.rightEnd}</span>
        `;
    }

    renderHand(state) {
        this.handContainer.innerHTML = '';

        const hand = state.hands[0];
        const validMoves = state.currentPlayer === 0 ? this.game.getValidMoves() : [];
        const playableTiles = new Set(validMoves.map(m => m.tile.toKey()));
        const isYourTurn = state.currentPlayer === 0 && state.gamePhase === 'playing';

        // Sort hand for easier viewing
        const tiles = hand.getTiles().sort((a, b) => {
            if (a.high !== b.high) return b.high - a.high;
            return b.low - a.low;
        });

        tiles.forEach(tile => {
            const domino = createDominoFromTile(tile, 'vertical');

            const isPlayable = playableTiles.has(tile.toKey());

            if (isPlayable && isYourTurn) {
                domino.classList.add('playable');
                domino.addEventListener('click', () => this.handleTileClick(tile));
            } else {
                domino.classList.add('disabled');
            }

            this.handContainer.appendChild(domino);
        });
    }

    handleTileClick(tile) {
        const validMoves = this.game.getValidMoves();
        const movesForTile = validMoves.filter(m => m.tile.equals(tile));

        if (movesForTile.length === 0) return;

        // Get AI recommendation for this move (for evaluation)
        const aiRec = this.ai.getRecommendation(this.game.getState(), 0);

        if (movesForTile.length === 1) {
            this.game.playTurn(tile, movesForTile[0].end, { aiRecommendation: aiRec });
            this.afterHumanPlay();
        } else {
            this.selectedTile = tile;
            this.pendingAiRecommendation = aiRec;
            this.showEndSelection(tile);
        }
    }

    showEndSelection(tile) {
        const state = this.game.getState();
        this.leftEndBtn.textContent = `${t('table.left')} [${state.chain.leftEnd}]`;
        this.rightEndBtn.textContent = `${t('table.right')} [${state.chain.rightEnd}]`;
        this.endSelection.classList.add('visible');
        this.modalOverlay.classList.add('visible');
    }

    playSelectedTile(end) {
        if (!this.selectedTile) return;

        this.game.playTurn(this.selectedTile, end, { aiRecommendation: this.pendingAiRecommendation });
        this.hideEndSelection();
        this.pendingAiRecommendation = null;
        this.afterHumanPlay();
    }

    cancelSelection() {
        this.selectedTile = null;
        this.pendingAiRecommendation = null;
        this.hideEndSelection();
    }

    hideEndSelection() {
        this.selectedTile = null;
        this.endSelection.classList.remove('visible');
        this.modalOverlay.classList.remove('visible');
    }

    handlePass() {
        if (this.game.mustPass()) {
            this.game.pass();
            this.afterHumanPlay();
        }
    }

    afterHumanPlay() {
        const state = this.game.getState();
        if (state.gamePhase === 'playing' && !this.game.isHumanTurn()) {
            this.scheduleAITurn();
        }
    }

    scheduleAITurn() {
        const state = this.game.getState();
        if (this.game.mustPass()) {
            // No valid moves — pass quickly, no indicator
            setTimeout(() => this.playAITurn(), 800);
        } else {
            this.showThinkingIndicator(state.currentPlayer);
            setTimeout(() => {
                this.hideThinkingIndicator();
                setTimeout(() => this.playAITurn(), 500);
            }, 8500);
        }
    }

    showThinkingIndicator(player) {
        this.hideThinkingIndicator();
        const nameEl = this.playerNames[player];
        if (!nameEl) return;
        const indicator = document.createElement('span');
        indicator.className = 'thinking-indicator';
        indicator.textContent = t('thinking');
        nameEl.parentElement.appendChild(indicator);
    }

    hideThinkingIndicator() {
        document.querySelectorAll('.thinking-indicator').forEach(el => el.remove());
    }

    playAITurn() {
        const state = this.game.getState();

        if (state.gamePhase !== 'playing' || state.currentPlayer === 0) {
            return;
        }

        // Use SmartAI to choose the best move
        const move = this.ai.chooseMove(state, state.currentPlayer);

        if (move) {
            this.game.playTurn(move.tile, move.end, { reasoning: move.reasoning });
        } else {
            this.game.pass();
        }

        const newState = this.game.getState();
        if (newState.gamePhase === 'playing' && !this.game.isHumanTurn()) {
            this.scheduleAITurn();
        }
    }

    showHandEndMessage(data) {
        const winnerName = GameState.getTeamName(data.winningTeam);
        const isYourTeam = data.winningTeam === 0;
        const state = this.game.getState();

        let title, text;
        if (data.reason === 'domino') {
            const playerName = GameState.getPlayerName(data.dominoPlayer);
            title = isYourTeam ? t('result.handWon') : t('result.handLost');
            text = `${t('result.domino', playerName)}\n${t('result.dominoScore', winnerName, data.points)}`;
        } else if (data.reason === 'closed') {
            const playerName = GameState.getPlayerName(data.closingPlayer);
            title = isYourTeam ? t('result.handWon') : t('result.handLost');
            if (data.winningTeam === -1) {
                text = `${t('result.closed', playerName)}\n${t('result.closedTie')}`;
            } else {
                text = `${t('result.closed', playerName)}\n${t('result.closedWin', winnerName)}\n${t('result.points', data.points)}`;
            }
        } else {
            title = isYourTeam ? t('result.handWon') : t('result.handLost');
            if (data.winningTeam === -1) {
                text = `${t('result.blocked')}\n${t('result.blockedTie')}`;
            } else {
                text = `${t('result.blocked')}\n${t('result.blockedWin', winnerName)}\n${t('result.points', data.points)}`;
            }
        }

        text += `\n\n${t('result.matchScore', data.matchScores[0], data.matchScores[1])}`;

        // Show remaining tiles for all players
        text += `\n\n${t('result.remaining')}`;
        for (let i = 0; i < 4; i++) {
            const hand = state.hands[i];
            const playerName = GameState.getPlayerName(i);
            const pips = hand.pipCount();
            if (hand.isEmpty()) {
                text += `\n${playerName}: ${t('result.empty')}`;
            } else {
                const tiles = hand.getTiles().map(tile => tile.toString()).join(' ');
                text += `\n${playerName} (${t('result.pips', pips)}): ${tiles}`;
            }
        }

        // Show quiz results if any were taken this hand
        const quizResultsText = this.getHandQuizResultsText();
        if (quizResultsText) {
            text += quizResultsText;
        }

        this.messageTitle.textContent = title;
        this.messageText.textContent = text;
        this.messageBox.classList.toggle('opponent-win', !isYourTeam);
        this.messageBox.classList.add('visible');
        this.modalOverlay.classList.add('visible');

        // Always reset to hand-end button state (may be stale from a prior match-end)
        this.continueBtn.textContent = t('btn.continue');
        this.reviewBtn.style.display = 'none';
        if (this.messageGenin) this.messageGenin.style.display = 'none';

        const reasonText = data.reason === 'domino' ? t('log.domino') :
                           data.reason === 'closed' ? t('log.cerrado') : t('log.tranque');
        this.log(reasonText, 'system');
        if (data.winningTeam >= 0) {
            this.log(t('log.teamPoints', winnerName, data.points), 'system');
        } else {
            this.log(t('log.tie'), 'system');
        }

        // Record stats and check for hand badges
        this.playerStats.recordHandResult(data, this.game.getMatchHistory());
        const hBadges = this.badgeSystem.checkHandBadges(this.playerStats.get());
        if (hBadges.length) this.badgeToast.showBadges(hBadges);
        this.playerStats.save(this.playerStats.get());
    }

    getHandQuizResultsText() {
        const matchHistory = this.game.getMatchHistory();
        if (!matchHistory || !matchHistory.currentHand) return '';

        const quizResults = matchHistory.currentHand.quizResults || [];
        if (quizResults.length === 0) return '';

        let text = `\n\n--- ${t('quiz.resultsTitle')} ---`;

        for (const quiz of quizResults) {
            const playerName = GameState.getPlayerName(quiz.targetPlayer);

            // Calculate which tiles were correct, wrong, missed
            const predicted = new Set(quiz.userPrediction);
            const actual = new Set(quiz.actualHand);
            const correct = quiz.userPrediction.filter(t => actual.has(t));
            const wrong = quiz.userPrediction.filter(t => !actual.has(t));
            const missed = quiz.actualHand.filter(t => !predicted.has(t));

            text += `\n\n${t('quiz.predictionFor', playerName)}`;
            text += `\n${t('quiz.score')}: ${quiz.score} ${t('debrief.predictions.points')}`;

            if (correct.length > 0) {
                text += `\n✓ ${t('quiz.correct')}: ${correct.join(' ')}`;
            }
            if (wrong.length > 0) {
                text += `\n✗ ${t('quiz.wrong')}: ${wrong.join(' ')}`;
            }
            if (missed.length > 0) {
                text += `\n? ${t('quiz.missed')}: ${missed.join(' ')}`;
            }
        }

        return text;
    }

    showMatchEndMessage(data) {
        const winnerName = GameState.getTeamName(data.winner);
        const isYourTeam = data.winner === 0;

        this.messageTitle.textContent = isYourTeam ? t('result.matchWon') : t('result.matchLost');
        this.messageText.textContent = `${t('log.teamWins', winnerName)}\n\n${t('result.finalScore', data.finalScores[0], data.finalScores[1])}`;
        this.messageBox.classList.toggle('opponent-win', !isYourTeam);
        this.messageBox.classList.add('visible');
        this.modalOverlay.classList.add('visible');

        // Show celebrating Genín on match win
        if (this.messageGenin) {
            this.messageGenin.style.display = isYourTeam ? 'block' : 'none';
        }

        this.continueBtn.textContent = t('btn.newMatch');
        this.reviewBtn.style.display = 'inline-block';

        this.log(t('log.matchOver'), 'system');
        this.log(t('log.teamWins', winnerName), 'system');

        // Record coaching data, match result, and check for match badges
        const mh = this.game.getMatchHistory();
        this.playerStats.recordCoachingData(mh.getHumanStats(), mh.getQuizStats());
        this.playerStats.recordMatchResult(data);
        const mBadges = this.badgeSystem.checkMatchBadges(this.playerStats.get());
        if (mBadges.length) this.badgeToast.showBadges(mBadges);
        this.playerStats.save(this.playerStats.get());
    }

    showDebrief() {
        // Hide message box first
        this.messageBox.classList.remove('visible');
        this.modalOverlay.classList.remove('visible');

        // Show debrief UI
        const matchHistory = this.game.getMatchHistory();
        this.debriefUI.show(matchHistory);
    }

    handleContinue() {
        this.messageBox.classList.remove('visible');
        this.modalOverlay.classList.remove('visible');

        const state = this.game.getState();
        if (state.gamePhase === 'matchOver') {
            this.continueBtn.textContent = t('btn.continue');
            this.reviewBtn.style.display = 'none';
            this.startNewGame();
        } else if (state.gamePhase === 'handOver') {
            this.logHandSeparator();
            this.ai.resetForNewHand();
            if (this.probAnalyzer) this.probAnalyzer.reset();
            this.game.newHand();

            // Initialize hand tracker with new human hand
            const newState = this.game.getState();
            this.handTracker.initHand(newState.hands[0]);

            // Initialize per-player views with each player's hand
            for (let i = 0; i < 4; i++) {
                this.playerViews[i].resetAffinities();
                this.playerViews[i].initOwnHand(newState.hands[i]);
            }

            this.updateQuizButton();

            if (!this.game.isHumanTurn()) {
                this.scheduleAITurn();
            }
        }
    }

    log(message, className = '') {
        const entry = document.createElement('div');
        entry.className = `log-entry ${className}`;
        entry.textContent = message;
        this.logContainer.appendChild(entry);
        this.scrollLogToBottom();
    }

    showPassBadge(playerIndex) {
        const playerInfo = document.getElementById(`player-${playerIndex}-name`);
        if (!playerInfo) return;
        const container = playerInfo.parentElement;

        // Remove any existing badge
        const existing = container.querySelector('.pass-badge');
        if (existing) existing.remove();

        const badge = document.createElement('div');
        badge.className = 'pass-badge';
        badge.textContent = t('pass');
        container.appendChild(badge);

        // Remove after animation completes
        setTimeout(() => badge.remove(), 4000);
    }

    logHandSeparator() {
        const separator = document.createElement('div');
        separator.className = 'log-separator';
        separator.innerHTML = `<span>${t('log.newHand')}</span>`;
        this.logContainer.appendChild(separator);
        this.scrollLogToBottom();
    }

    scrollLogToBottom() {
        // Use setTimeout to ensure DOM has fully updated
        setTimeout(() => {
            this.logContainer.scrollTop = this.logContainer.scrollHeight;
        }, 0);
    }

    clearLog() {
        this.logContainer.innerHTML = '';
    }

    // ==================== Genín Advice Methods ====================

    updateGeninAdviceVisibility(state) {
        if (!this.geninAdviceContainer) return;

        const shouldShow = state.currentPlayer === 0 &&
                           state.gamePhase === 'playing' &&
                           !this.game.mustPass();

        this.geninAdviceContainer.style.display = shouldShow ? 'flex' : 'none';

        if (!shouldShow) {
            this.hideAdviceBubble();
        }
    }

    toggleAdviceBubble() {
        if (this.adviceBubbleVisible) {
            this.hideAdviceBubble();
            return;
        }

        const state = this.game.getState();
        const rec = this.ai.getRecommendation(state, 0);

        // Clear previous content
        this.speechDomino.innerHTML = '';
        this.speechEnd.textContent = '';
        this.speechReason.classList.remove('sassy');
        this.speechDetail.textContent = '';
        this.speechAvatar.src = 'img/genin-advising.png';

        if (!rec) {
            // Must pass (shouldn't happen since we hide the button, but safety)
            this.speechReason.textContent = t('advice.mustPass');
            this.showAdviceBubble();
            return;
        }

        // Render the recommended domino
        const domino = createDominoFromTile(rec.tile, 'vertical');
        this.speechDomino.appendChild(domino);

        // Set end indicator
        const endText = rec.end === 'left' ? t('advice.playLeft') : t('advice.playRight');
        this.speechEnd.textContent = '\u2192 ' + endText;

        // Determine mode: first tile, sassy, or normal
        const isFirstTile = state.chain.isEmpty();
        const validMoves = this.game.getValidMoves();
        const isOnlyMove = validMoves.length === 1 && !isFirstTile;

        if (isOnlyMove) {
            // Sassy mode
            this.speechReason.textContent = t('advice.onlyMove');
            this.speechReason.classList.add('sassy');
            this.speechAvatar.src = 'img/genin-thinking.png';
        } else if (isFirstTile) {
            // First tile mode
            this.speechReason.textContent = t('advice.firstTile');
        } else {
            // Normal mode — get brief strategic explanation
            const score = this.ai.scoreMove(rec, state, 0);
            const briefReason = this.ai.explainer.explainBrief(rec, score, state, 0, this.ai);
            this.speechReason.textContent = briefReason;
            this.speechDetail.textContent = this.buildAdviceDetail(rec, state);
        }

        this.showAdviceBubble();
    }

    showAdviceBubble() {
        if (this.geninSpeechBubble) {
            this.geninSpeechBubble.style.display = 'block';
        }
        this.adviceBubbleVisible = true;
    }

    hideAdviceBubble() {
        if (this.geninSpeechBubble) {
            this.geninSpeechBubble.style.display = 'none';
        }
        this.adviceBubbleVisible = false;
        if (this.speechReason) {
            this.speechReason.classList.remove('sassy');
        }
        if (this.speechDetail) {
            this.speechDetail.textContent = '';
        }
    }

    buildAdviceDetail(rec, state) {
        const chain = state.chain;
        if (chain.isEmpty()) return '';

        const lines = [];
        const opponents = this.ai.getOpponents(0);
        const partnerIndex = 2;
        const hand = state.hands[0];

        // 0. Firme detection — you hold ALL remaining tiles of a suit on an open end
        const { newLeftEnd, newRightEnd } = this.ai._getEndsAfterPlay(rec, chain);
        const checkFirme = (endValue) => {
            const myCount = this.ai.countSuitInHand(hand, endValue);
            const remaining = this.ai.getRemainingInSuit(endValue);
            return myCount > 0 && myCount === remaining ? myCount : 0;
        };

        const leftFirme = checkFirme(chain.leftEnd);
        const rightFirme = checkFirme(chain.rightEnd);

        if (leftFirme > 0 || rightFirme > 0) {
            // Report each firme (could be both ends)
            if (leftFirme > 0) {
                lines.push(t('advice.detail.firme', chain.leftEnd, leftFirme));
            }
            if (rightFirme > 0 && chain.leftEnd !== chain.rightEnd) {
                lines.push(t('advice.detail.firme', chain.rightEnd, rightFirme));
            }

            // Is this move spending or preserving a firme?
            const playingOnFirmeEnd =
                (rec.end === 'left' && leftFirme > 0) || (rec.end === 'right' && rightFirme > 0);
            const firmeEnd = rec.end === 'left' ? chain.leftEnd : chain.rightEnd;

            if (playingOnFirmeEnd) {
                lines.push(t('advice.detail.firmeSpend', firmeEnd));
            } else {
                lines.push(t('advice.detail.firmePreserve', leftFirme > 0 ? chain.leftEnd : chain.rightEnd));
            }
        }

        // 1. Check for cuadrar/cerrar
        if (newLeftEnd === newRightEnd) {
            const squaredVal = newLeftEnd;
            const currentCount = chain.countValue(squaredVal);
            const tileAdds = rec.tile.isDouble() ? 2 : ((rec.tile.high === squaredVal ? 1 : 0) + (rec.tile.low === squaredVal ? 1 : 0));
            const afterCount = currentCount + tileAdds;

            // Cerrar: placing the 7th tile of the suit, or the 6th if the double is still outstanding
            const doubleOnChain = chain.getTiles().some(t => t.isDouble() && t.high === squaredVal);
            const isCerrar = afterCount >= 7 || (afterCount >= 6 && !doubleOnChain);

            if (isCerrar) {
                lines.push(t('advice.detail.cerrar', squaredVal));
            } else {
                lines.push(t('advice.detail.cuadrar', squaredVal));
            }

            for (const opp of opponents) {
                const facts = this.handTracker.getKnownFacts(opp);
                if (facts.deadSuits.includes(squaredVal)) {
                    lines.push(t('advice.detail.oppsLack', GameState.getPlayerName(opp), squaredVal));
                } else {
                    const blockProb = Math.round(this.handTracker.getBlockingProbability(opp, squaredVal, squaredVal) * 100);
                    if (blockProb >= 40) {
                        lines.push(t('advice.detail.oppBlocked', GameState.getPlayerName(opp), blockProb));
                    }
                }
            }
            return lines.join('\n');
        }

        // 2. Check for blocking (opponent lacks a new end value)
        for (const opp of opponents) {
            const deadSuits = this.ai.inferredDeadSuits[opp];
            if (deadSuits.has(newLeftEnd) || deadSuits.has(newRightEnd)) {
                const lackVal = deadSuits.has(newLeftEnd) ? newLeftEnd : newRightEnd;
                lines.push(t('advice.detail.oppsLack', GameState.getPlayerName(opp), lackVal));
            }
        }
        if (lines.length > 0) return lines.join('\n');

        // 3. Partner support — show partner's likely tiles if their suit is relevant
        const partnerSuit = this.ai.signaledSuits[partnerIndex];
        if (partnerSuit !== null) {
            const partnerFacts = this.handTracker.getKnownFacts(partnerIndex);
            if (partnerFacts.tileCount > 0) {
                const likely = this.handTracker.getMostLikely(partnerIndex, partnerFacts.tileCount);
                const inSuit = likely.filter(entry => entry.tile.hasValue(partnerSuit) && entry.probability >= 0.3);
                if (inSuit.length > 0) {
                    const tileStr = inSuit.slice(0, 3).map(entry => entry.tile.toString()).join(' ');
                    lines.push(t('advice.detail.partnerSuit', partnerSuit));
                    lines.push(t('advice.detail.partnerLikely', tileStr));
                }
            }
        }
        if (lines.length > 0) return lines.join('\n');

        // 4. Late game — show estimated opponent likely tiles
        if (chain.size() >= 16) {
            for (const opp of opponents) {
                const facts = this.handTracker.getKnownFacts(opp);
                if (facts.tileCount > 0 && facts.tileCount <= 3) {
                    const likely = this.handTracker.getMostLikely(opp, facts.tileCount);
                    const topTiles = likely.filter(entry => entry.probability >= 0.3);
                    if (topTiles.length > 0) {
                        const tileStr = topTiles.map(entry => entry.tile.toString()).join(' ');
                        lines.push(t('advice.detail.oppLikely', GameState.getPlayerName(opp), tileStr));
                    }
                }
            }
        }

        return lines.join('\n');
    }

    // ==================== Quiz Modal Methods ====================

    showQuizModal() {
        // Reset quiz state
        this.quizTargetPlayer = null;
        this.quizSelectedTiles = new Set();

        // Reset UI
        this.targetBtns.forEach(btn => btn.classList.remove('active'));
        if (this.quizContext) {
            this.quizContext.innerHTML = `<p>${t('quiz.selectPrompt')}</p>`;
        }
        if (this.quizTileGrid) {
            this.quizTileGrid.innerHTML = '';
        }
        if (this.submitQuizBtn) {
            this.submitQuizBtn.disabled = true;
        }
        if (this.quizResult) {
            this.quizResult.style.display = 'none';
        }
        if (document.querySelector('.quiz-content')) {
            document.querySelector('.quiz-content').style.display = 'block';
        }

        // Show modal
        if (this.quizModal) {
            this.quizModal.classList.add('visible');
        }
        if (this.quizOverlay) {
            this.quizOverlay.classList.add('visible');
        }
    }

    hideQuizModal() {
        if (this.quizModal) {
            this.quizModal.classList.remove('visible');
        }
        if (this.quizOverlay) {
            this.quizOverlay.classList.remove('visible');
        }
    }

    selectQuizTarget(player) {
        this.quizTargetPlayer = player;
        this.quizSelectedTiles = new Set();

        // Update target buttons
        this.targetBtns.forEach(btn => {
            btn.classList.toggle('active', parseInt(btn.dataset.player, 10) === player);
        });

        // Update context with known facts
        this.updateQuizContext(player);

        // Render tile picker
        this.renderQuizTilePicker(player);

        // Update selection count
        this.updateQuizSelectionCount();
    }

    updateQuizContext(player) {
        if (!this.quizContext) return;

        const facts = this.handTracker.getKnownFacts(player);
        const playerName = this.handTracker.getPlayerName(player);

        let html = `<p>${t('quiz.hasTiles', `<strong>${playerName}</strong>`, `<strong>${facts.tileCount}</strong>`)}</p>`;

        if (facts.deadSuits.length > 0) {
            html += '<div class="known-facts">';
            html += `<div class="fact">${t('quiz.lacksTiles', facts.deadSuits.join(', '))}</div>`;
            html += '</div>';
        }

        this.quizContext.innerHTML = html;
    }

    renderQuizTilePicker(player) {
        if (!this.quizTileGrid) return;

        const unplayedTiles = this.handTracker.getUnplayedTiles();
        const facts = this.handTracker.getKnownFacts(player);

        // Sort tiles for display (by high value, then low value)
        unplayedTiles.sort((a, b) => {
            if (a.high !== b.high) return b.high - a.high;
            return b.low - a.low;
        });

        this.quizTileGrid.innerHTML = '';

        for (const tile of unplayedTiles) {
            const key = tile.toKey();
            const isImpossible = facts.deadSuits.some(suit => tile.hasValue(suit));

            const domino = this.createQuizTileElement(tile);
            domino.dataset.tileKey = key;

            if (isImpossible) {
                domino.classList.add('impossible');
                domino.title = 'Player cannot have this tile (passed on this suit)';
            }

            domino.addEventListener('click', () => this.toggleQuizTileSelection(key, domino, isImpossible));

            this.quizTileGrid.appendChild(domino);
        }

        // Update target count
        if (this.quizTargetCount) {
            this.quizTargetCount.textContent = facts.tileCount;
        }
    }

    createQuizTileElement(tile) {
        const div = document.createElement('div');
        div.className = 'domino vertical';

        const createHalf = (value) => {
            const positions = PIP_POSITIONS[value] || [];
            const pips = positions.map(pos => `<div class="pip ${pos}"></div>`).join('');
            return `<div class="domino-half">${pips}</div>`;
        };

        div.innerHTML = createHalf(tile.high) + createHalf(tile.low);
        return div;
    }

    toggleQuizTileSelection(key, domino, isImpossible) {
        if (isImpossible) {
            // Still allow selection but show warning
        }

        if (this.quizSelectedTiles.has(key)) {
            this.quizSelectedTiles.delete(key);
            domino.classList.remove('selected');
        } else {
            this.quizSelectedTiles.add(key);
            domino.classList.add('selected');
        }

        this.updateQuizSelectionCount();
    }

    updateQuizSelectionCount() {
        if (this.quizSelectionCount) {
            this.quizSelectionCount.textContent = this.quizSelectedTiles.size;
        }

        // Enable submit if at least one tile is selected
        if (this.submitQuizBtn) {
            this.submitQuizBtn.disabled = this.quizSelectedTiles.size === 0;
        }
    }

    submitQuiz() {
        if (this.quizTargetPlayer === null) return;

        const state = this.game.getState();
        const actualHand = state.hands[this.quizTargetPlayer];
        const predictedKeys = Array.from(this.quizSelectedTiles);
        const playerName = this.handTracker.getPlayerName(this.quizTargetPlayer);

        // Score the prediction
        const result = this.handTracker.scoreQuizPrediction(
            this.quizTargetPlayer,
            predictedKeys,
            actualHand
        );

        // Record in match history
        const matchHistory = this.game.getMatchHistory();
        matchHistory.recordQuizResult({
            targetPlayer: this.quizTargetPlayer,
            userPrediction: predictedKeys,
            actualHand: actualHand.getTiles().map(t => t.toKey()),
            score: result.score,
            correct: result.correct,
            wrong: result.wrong,
            missed: result.missed
        });

        // Save to persistent storage
        this.quizStorage.saveQuizResult({
            targetPlayer: this.quizTargetPlayer,
            score: result.score,
            correct: result.correct,
            wrong: result.wrong,
            missed: result.missed
        });

        // Show confirmation instead of results (results shown at end of hand)
        this.showQuizConfirmation(playerName, predictedKeys.length);
    }

    showQuizResult(result) {
        // Hide content, show result
        if (document.querySelector('.quiz-content')) {
            document.querySelector('.quiz-content').style.display = 'none';
        }
        if (this.quizResult) {
            this.quizResult.style.display = 'block';
        }

        // Update score
        if (this.quizScoreValue) {
            this.quizScoreValue.textContent = result.score;
        }

        // Build breakdown
        if (this.quizBreakdown) {
            let html = `
                <div class="breakdown-row correct">
                    <span class="label">${t('quiz.correct')}</span>
                    <span class="value">+${result.correct * 10} (${result.correct} ${t('hand.tiles')})</span>
                </div>
                <div class="breakdown-row wrong">
                    <span class="label">${t('quiz.wrong')}</span>
                    <span class="value">-${result.wrong * 5} (${result.wrong} ${t('hand.tiles')})</span>
                </div>
                <div class="breakdown-row missed">
                    <span class="label">${t('quiz.missed')}</span>
                    <span class="value">-${result.missed * 2} (${result.missed} ${t('hand.tiles')})</span>
                </div>
            `;

            // Show tile details
            const details = result.details;
            if (details.correct.length > 0 || details.wrong.length > 0 || details.missed.length > 0) {
                html += '<div class="quiz-tiles-display">';

                if (details.correct.length > 0) {
                    html += `<h4>${t('quiz.correctlyPredicted')}</h4>`;
                    html += '<div class="quiz-tiles-row">';
                    for (const key of details.correct) {
                        const tile = Tile.fromKey(key);
                        html += `<span class="tile-mini correct">${tile.toString()}</span>`;
                    }
                    html += '</div>';
                }

                if (details.wrong.length > 0) {
                    html += `<h4>${t('quiz.incorrectlyPredicted')}</h4>`;
                    html += '<div class="quiz-tiles-row">';
                    for (const key of details.wrong) {
                        const tile = Tile.fromKey(key);
                        html += `<span class="tile-mini wrong">${tile.toString()}</span>`;
                    }
                    html += '</div>';
                }

                if (details.missed.length > 0) {
                    html += `<h4>${t('quiz.missedTiles')}</h4>`;
                    html += '<div class="quiz-tiles-row">';
                    for (const key of details.missed) {
                        const tile = Tile.fromKey(key);
                        html += `<span class="tile-mini missed">${tile.toString()}</span>`;
                    }
                    html += '</div>';
                }

                html += '</div>';
            }

            this.quizBreakdown.innerHTML = html;
        }
    }

    showQuizConfirmation(playerName, tileCount) {
        // Hide content, show confirmation
        if (document.querySelector('.quiz-content')) {
            document.querySelector('.quiz-content').style.display = 'none';
        }
        if (this.quizResult) {
            this.quizResult.style.display = 'block';
        }

        // Update to show confirmation message
        if (this.quizScoreValue) {
            this.quizScoreValue.textContent = '?';
            this.quizScoreValue.style.color = '#8b5cf6';
        }

        // Show confirmation message instead of breakdown
        if (this.quizBreakdown) {
            this.quizBreakdown.innerHTML = `
                <div class="quiz-confirmation">
                    <p>${t('quiz.predictionRecorded', playerName, tileCount)}</p>
                    <p class="quiz-hint">${t('quiz.resultsAtEnd')}</p>
                </div>
            `;
        }

        // Update result title
        const resultTitle = document.getElementById('quiz-result-title');
        if (resultTitle) {
            resultTitle.textContent = t('quiz.recorded');
        }
    }
}

// Initialize app when DOM is ready
document.addEventListener('DOMContentLoaded', () => {
    window.app = new DominoApp();
    console.log('7 Fichas initialized. Click "New Game" to start!');
});
