import { ClaudeService } from '../services/ClaudeService.js';
import { t, i18n } from '../i18n/i18n.js';
import { StorageService } from '../stats/StorageService.js';

/**
 * SettingsUI - Settings panel for API key configuration.
 */
export class SettingsUI {
    constructor() {
        this.claudeService = new ClaudeService();
        this.modal = null;
        this.overlay = null;
        this.isInitialized = false;
        this.onDifficultyChange = null;
    }

    /**
     * Initialize the settings UI elements
     */
    init() {
        if (this.isInitialized) return;

        this.modal = document.getElementById('settings-modal');
        this.overlay = document.getElementById('settings-overlay');
        this.apiKeyInput = document.getElementById('api-key-input');
        this.saveKeyBtn = document.getElementById('save-key-btn');
        this.testKeyBtn = document.getElementById('test-key-btn');
        this.clearKeyBtn = document.getElementById('clear-key-btn');
        this.closeSettingsBtn = document.getElementById('close-settings-btn');
        this.keyStatus = document.getElementById('key-status');
        this.settingsBtn = document.getElementById('settings-btn');

        if (!this.modal) {
            console.warn('SettingsUI: Settings modal not found in DOM');
            return;
        }

        this._bindEvents();
        this._updateKeyStatus();
        this._initDifficulty();
        this.isInitialized = true;
    }

    /**
     * Initialize difficulty buttons from localStorage and bind click handlers.
     * @private
     */
    _initDifficulty() {
        const saved = StorageService.get('7fichas_difficulty') || { opp1: 'master', partner: 'master', opp2: 'master' };
        const playerMap = { 1: saved.opp1, 2: saved.partner, 3: saved.opp2 };

        document.querySelectorAll('.diff-btn').forEach(btn => {
            const playerIndex = parseInt(btn.dataset.player, 10);
            const level = btn.dataset.level;

            // Apply saved active state
            btn.classList.toggle('active', level === playerMap[playerIndex]);

            btn.addEventListener('click', () => {
                // Update active class within same player group
                document.querySelectorAll(`.diff-btn[data-player="${playerIndex}"]`)
                    .forEach(b => b.classList.remove('active'));
                btn.classList.add('active');

                // Persist to localStorage
                const current = StorageService.get('7fichas_difficulty') || { opp1: 'master', partner: 'master', opp2: 'master' };
                if (playerIndex === 1) current.opp1 = level;
                else if (playerIndex === 2) current.partner = level;
                else if (playerIndex === 3) current.opp2 = level;
                StorageService.set('7fichas_difficulty', current);

                // Update on-board badge
                this._updateDiffBadge(playerIndex, level);

                // Notify main controller
                if (this.onDifficultyChange) this.onDifficultyChange(playerIndex, level);
            });
        });

        // Render initial badges
        this.refreshBadges();
    }

    /**
     * Update the on-board difficulty badge for one player.
     * @private
     */
    _updateDiffBadge(playerIndex, level) {
        const badge = document.getElementById(`diff-badge-${playerIndex}`);
        if (!badge) return;
        badge.textContent = t(`settings.difficulty.${level}`);
        badge.className = `diff-badge diff-badge-${level}`;
    }

    /**
     * Re-render all difficulty badges from localStorage (call after language change).
     */
    refreshBadges() {
        const saved = StorageService.get('7fichas_difficulty') || { opp1: 'master', partner: 'master', opp2: 'master' };
        this._updateDiffBadge(1, saved.opp1);
        this._updateDiffBadge(2, saved.partner || 'master');
        this._updateDiffBadge(3, saved.opp2);
    }

    /**
     * Bind event handlers
     * @private
     */
    _bindEvents() {
        if (this.settingsBtn) {
            this.settingsBtn.addEventListener('click', () => this.show());
        }

        if (this.closeSettingsBtn) {
            this.closeSettingsBtn.addEventListener('click', () => this.hide());
        }

        if (this.overlay) {
            this.overlay.addEventListener('click', () => this.hide());
        }

        if (this.saveKeyBtn) {
            this.saveKeyBtn.addEventListener('click', () => this._saveKey());
        }

        if (this.testKeyBtn) {
            this.testKeyBtn.addEventListener('click', () => this._testKey());
        }

        if (this.clearKeyBtn) {
            this.clearKeyBtn.addEventListener('click', () => this._clearKey());
        }
    }

    /**
     * Show the settings modal
     */
    show() {
        if (!this.isInitialized) this.init();

        if (this.modal) {
            this.modal.classList.add('visible');
        }
        if (this.overlay) {
            this.overlay.classList.add('visible');
        }

        // Clear input and update status
        if (this.apiKeyInput) {
            this.apiKeyInput.value = '';
            this.apiKeyInput.placeholder = this.claudeService.hasApiKey()
                ? this.claudeService.getMaskedKey()
                : t('settings.apiKey.placeholder');
        }
        this._updateKeyStatus();
    }

    /**
     * Hide the settings modal
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
     * Save the API key
     * @private
     */
    _saveKey() {
        const key = this.apiKeyInput?.value?.trim();
        if (!key) {
            this._showStatus(t('settings.apiKey.enterKey'), 'error');
            return;
        }

        this.claudeService.setApiKey(key);
        this.apiKeyInput.value = '';
        this.apiKeyInput.placeholder = this.claudeService.getMaskedKey();
        this._showStatus(t('settings.apiKey.saved'), 'success');
        this._updateKeyStatus();
    }

    /**
     * Test the API connection
     * @private
     */
    async _testKey() {
        if (!this.claudeService.hasApiKey()) {
            this._showStatus(t('settings.apiKey.noKey'), 'error');
            return;
        }

        this._showStatus(t('settings.apiKey.testing'), 'loading');
        this.testKeyBtn.disabled = true;

        const result = await this.claudeService.testConnection();

        this.testKeyBtn.disabled = false;
        this._showStatus(result.message, result.success ? 'success' : 'error');
    }

    /**
     * Clear the API key
     * @private
     */
    _clearKey() {
        this.claudeService.setApiKey(null);
        if (this.apiKeyInput) {
            this.apiKeyInput.value = '';
            this.apiKeyInput.placeholder = t('settings.apiKey.placeholder');
        }
        this._showStatus(t('settings.apiKey.cleared'), 'info');
        this._updateKeyStatus();
    }

    /**
     * Show status message
     * @private
     */
    _showStatus(message, type) {
        if (!this.keyStatus) return;

        this.keyStatus.textContent = message;
        this.keyStatus.className = 'key-status ' + type;
    }

    /**
     * Update the key status display
     * @private
     */
    _updateKeyStatus() {
        if (!this.keyStatus) return;

        if (this.claudeService.hasApiKey()) {
            this.keyStatus.textContent = t('settings.apiKey.configured', this.claudeService.getMaskedKey());
            this.keyStatus.className = 'key-status configured';
        } else {
            this.keyStatus.textContent = t('settings.apiKey.notConfigured');
            this.keyStatus.className = 'key-status not-configured';
        }
    }

    /**
     * Check if API key is configured
     * @returns {boolean}
     */
    hasApiKey() {
        return this.claudeService.hasApiKey();
    }

    /**
     * Get the Claude service instance
     * @returns {ClaudeService}
     */
    getClaudeService() {
        return this.claudeService;
    }
}
