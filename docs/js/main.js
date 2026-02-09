import { Game } from './engine/Game.js';
import { GameState } from './models/GameState.js';
import { SmartAI } from './ai/SmartAI.js';
import { HandTracker } from './ai/HandTracker.js';
import { DebriefUI } from './ui/DebriefUI.js';
import { SettingsUI } from './ui/SettingsUI.js';
import { QuizStorage } from './services/QuizStorage.js';
import { Tile } from './models/Tile.js';
import { t, i18n } from './i18n/i18n.js';

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
        this.selectedTile = null;
        this.aiDelay = 3000; // 3 seconds per AI move

        // Quiz state
        this.quizTargetPlayer = null;
        this.quizSelectedTiles = new Set();

        // Attribution toggle state
        this.showTileAttribution = false;

        // UI modules
        this.debriefUI = new DebriefUI();
        this.settingsUI = new SettingsUI();

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
    }

    initUIModules() {
        // Initialize settings UI
        this.settingsUI.init();

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

            // Record this play for AI tracking (suit counts, play choice inference)
            const leftEnd = data.openEndsBefore?.left ?? null;
            const rightEnd = data.openEndsBefore?.right ?? null;
            this.ai.recordPlay(data.player, data.tile, data.end, leftEnd, rightEnd);

            // Record for hand tracker (probability tracking)
            this.handTracker.recordPlay(data.player, data.tile);

            // Update quiz button state
            this.updateQuizButton();
        };

        this.game.onPass = (data) => {
            const playerName = GameState.getPlayerName(data.player);
            const state = this.game.getState();
            const leftEnd = state.chain.leftEnd;
            const rightEnd = state.chain.rightEnd;
            this.log(t('log.passes', playerName, leftEnd, rightEnd), `player-${data.player}`);

            // Record this pass for AI tracking (inferred dead suits)
            this.ai.recordPass(data.player, leftEnd, rightEnd);

            // Record for hand tracker (probability tracking)
            this.handTracker.recordPass(data.player, leftEnd, rightEnd);
        };

        this.game.onHandEnd = (data) => {
            this.showHandEndMessage(data);
        };

        this.game.onMatchEnd = (data) => {
            this.showMatchEndMessage(data);
        };

        this.game.onError = (msg) => {
            console.error('Game error:', msg);
            this.log(t('log.error', msg), 'system');
        };
    }

    startNewGame() {
        this.clearLog();
        this.log(t('log.newMatch'), 'system');
        this.ai.resetForNewHand();
        this.game.newMatch();

        // Initialize hand tracker with human's hand
        const state = this.game.getState();
        this.handTracker.initHand(state.hands[0]);

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

        // Calculate tiles per row based on available width
        const tilesPerRow = this._calculateTilesPerRow();

        // Create the chain container
        const chainDiv = document.createElement('div');
        chainDiv.className = 'chain';

        // Split tiles into rows
        let currentRow = null;
        let rowIndex = 0;

        placedTiles.forEach((pt, index) => {
            // Start a new row if needed
            if (index % tilesPerRow === 0) {
                if (currentRow) {
                    chainDiv.appendChild(currentRow);
                    // Add turn connector between rows (L-shaped with arrow)
                    const turn = document.createElement('div');
                    turn.className = 'chain-turn' + (rowIndex % 2 === 0 ? ' left-side' : '');
                    turn.innerHTML = '<div class="turn-connector"></div>';
                    chainDiv.appendChild(turn);
                }
                currentRow = document.createElement('div');
                currentRow.className = 'chain-row' + (rowIndex % 2 === 1 ? ' reverse' : '');
                rowIndex++;
            }

            const isDouble = pt.tile.isDouble();
            const orientation = isDouble ? 'vertical' : 'horizontal';

            // In reversed rows, flip the tile orientation so connecting pips stay adjacent
            const isReversedRow = (Math.floor(index / tilesPerRow) % 2 === 1);

            let leftVal = pt.leftValue;
            let rightVal = pt.rightValue;

            if (isReversedRow && !isDouble) {
                // Swap left/right for reversed rows (non-doubles only)
                leftVal = pt.rightValue;
                rightVal = pt.leftValue;
            }

            const domino = createDominoElement(leftVal, rightVal, orientation, isDouble);

            // Add player attribution if enabled
            if (this.showTileAttribution && pt.playedBy !== undefined && pt.playedBy >= 0) {
                domino.classList.add('show-player', `played-by-${pt.playedBy}`);

                // Add player indicator dot
                const indicator = document.createElement('div');
                indicator.className = `player-indicator player-${pt.playedBy}`;
                // Use translated initials
                const initials = [
                    t('attribution.initials.you'),
                    t('attribution.initials.opp1'),
                    t('attribution.initials.partner'),
                    t('attribution.initials.opp2')
                ];
                indicator.textContent = initials[pt.playedBy];
                domino.appendChild(indicator);
            }

            currentRow.appendChild(domino);
        });

        // Add the last row
        if (currentRow) {
            chainDiv.appendChild(currentRow);
        }

        this.chainContainer.appendChild(chainDiv);
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
        setTimeout(() => this.playAITurn(), this.aiDelay);
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

        this.messageTitle.textContent = title;
        this.messageText.textContent = text;
        this.messageBox.classList.toggle('opponent-win', !isYourTeam);
        this.messageBox.classList.add('visible');
        this.modalOverlay.classList.add('visible');

        const reasonText = data.reason === 'domino' ? t('log.domino') :
                           data.reason === 'closed' ? t('log.cerrado') : t('log.tranque');
        this.log(reasonText, 'system');
        if (data.winningTeam >= 0) {
            this.log(t('log.teamPoints', winnerName, data.points), 'system');
        } else {
            this.log(t('log.tie'), 'system');
        }
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
            this.game.newHand();

            // Initialize hand tracker with new human hand
            const newState = this.game.getState();
            this.handTracker.initHand(newState.hands[0]);

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
