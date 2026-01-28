import { ClaudeService } from '../services/ClaudeService.js';

/**
 * SettingsUI - Settings panel for API key configuration.
 */
export class SettingsUI {
    constructor() {
        this.claudeService = new ClaudeService();
        this.modal = null;
        this.overlay = null;
        this.isInitialized = false;
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
        this.isInitialized = true;
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
                : 'Enter your Claude API key...';
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
            this._showStatus('Please enter an API key', 'error');
            return;
        }

        this.claudeService.setApiKey(key);
        this.apiKeyInput.value = '';
        this.apiKeyInput.placeholder = this.claudeService.getMaskedKey();
        this._showStatus('API key saved!', 'success');
        this._updateKeyStatus();
    }

    /**
     * Test the API connection
     * @private
     */
    async _testKey() {
        if (!this.claudeService.hasApiKey()) {
            this._showStatus('No API key configured', 'error');
            return;
        }

        this._showStatus('Testing connection...', 'loading');
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
            this.apiKeyInput.placeholder = 'Enter your Claude API key...';
        }
        this._showStatus('API key cleared', 'info');
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
            this.keyStatus.textContent = `Key configured: ${this.claudeService.getMaskedKey()}`;
            this.keyStatus.className = 'key-status configured';
        } else {
            this.keyStatus.textContent = 'No API key configured';
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
