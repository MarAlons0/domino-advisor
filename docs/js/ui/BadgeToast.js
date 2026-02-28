import { BADGES } from '../stats/BadgeSystem.js';
import { t } from '../i18n/i18n.js';

export class BadgeToast {
    constructor() {
        this._container = null;
    }

    _getContainer() {
        if (!this._container) {
            this._container = document.getElementById('badge-toast-container');
        }
        return this._container;
    }

    showBadges(badgeIds) {
        badgeIds.forEach((id, i) => {
            setTimeout(() => this._showOne(id), i * 500);
        });
    }

    _showOne(badgeId) {
        const badge = BADGES.find(b => b.id === badgeId);
        if (!badge) return;

        const container = this._getContainer();
        if (!container) return;

        const toast = document.createElement('div');
        toast.className = 'badge-toast';
        toast.innerHTML = `
            <span class="badge-toast-icon">${badge.icon}</span>
            <div class="badge-toast-body">
                <div class="badge-toast-title">${t(`badge.${badgeId}.title`)}</div>
                <div class="badge-toast-earned">${t('badge.toast.earned')}</div>
            </div>
        `;

        container.appendChild(toast);

        // Trigger slide-in animation
        requestAnimationFrame(() => {
            requestAnimationFrame(() => toast.classList.add('visible'));
        });

        // Remove after 4 seconds
        setTimeout(() => {
            toast.classList.remove('visible');
            setTimeout(() => toast.remove(), 400);
        }, 4000);
    }
}
