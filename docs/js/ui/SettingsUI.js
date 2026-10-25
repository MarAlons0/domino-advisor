import { t } from '../i18n/i18n.js';
import { StorageService } from '../stats/StorageService.js';

/**
 * SettingsUI - Settings panel: each AI player's difficulty.
 */
export class SettingsUI {
    constructor() {
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
        this.closeSettingsBtn = document.getElementById('close-settings-btn');
        this.settingsBtn = document.getElementById('settings-btn');

        if (!this.modal) {
            console.warn('SettingsUI: Settings modal not found in DOM');
            return;
        }

        this._bindEvents();
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
}
