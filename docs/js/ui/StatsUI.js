import { BADGES } from '../stats/BadgeSystem.js';
import { t } from '../i18n/i18n.js';

export class StatsUI {
    constructor(playerStats) {
        this.playerStats = playerStats;
        this.modal = null;
        this.overlay = null;
        this.isInitialized = false;
    }

    init() {
        if (this.isInitialized) return;

        this.modal = document.getElementById('stats-modal');
        this.overlay = document.getElementById('stats-overlay');
        const statsBtn = document.getElementById('stats-btn');
        const closeBtn = document.getElementById('close-stats-btn');

        if (!this.modal) return;

        if (statsBtn) statsBtn.addEventListener('click', () => this.show());
        if (closeBtn) closeBtn.addEventListener('click', () => this.hide());
        if (this.overlay) this.overlay.addEventListener('click', () => this.hide());

        this.isInitialized = true;
    }

    show() {
        if (!this.isInitialized) this.init();
        this._render(this.playerStats.get());
        if (this.modal) this.modal.classList.add('visible');
        if (this.overlay) this.overlay.classList.add('visible');
    }

    hide() {
        if (this.modal) this.modal.classList.remove('visible');
        if (this.overlay) this.overlay.classList.remove('visible');
    }

    _render(stats) {
        const empty = document.getElementById('stats-empty');
        const body = document.getElementById('stats-body-content');

        if (stats.matches.played === 0) {
            if (empty) empty.style.display = 'block';
            if (body) body.style.display = 'none';
            return;
        }
        if (empty) empty.style.display = 'none';
        if (body) body.style.display = 'block';

        this._renderMatches(stats.matches);
        this._renderHands(stats.hands);
        this._renderCerrado(stats.cerrado);
        this._renderCoaching(stats.coaching);
        this._renderBadges(stats.badges);
    }

    _set(id, value) {
        const el = document.getElementById(id);
        if (el) el.textContent = value;
    }

    _pct(a, b) {
        return b === 0 ? '--' : `${Math.round(a / b * 100)}%`;
    }

    _fmt(n) {
        return n > 0 ? n : '--';
    }

    _renderMatches(m) {
        this._set('stat-matches-played', m.played);
        this._set('stat-matches-won', m.won);
        this._set('stat-matches-lost', m.lost);
        this._set('stat-matches-win-pct', this._pct(m.won, m.played));
        this._set('stat-matches-streak', m.currentStreak);
        this._set('stat-matches-best-streak', m.bestWinStreak);
        this._set('stat-matches-zapatos-given', this._fmt(m.zapatosGiven));
        this._set('stat-matches-zapatos-received', this._fmt(m.zapatosReceived));
        this._set('stat-matches-win-margin', this._fmt(m.largestWinMargin));
        this._set('stat-matches-deficit', this._fmt(m.largestDeficitOvercome));
    }

    _renderHands(h) {
        this._set('stat-hands-played', h.played);
        this._set('stat-hands-won', h.won);
        this._set('stat-hands-lost', h.lost);
        this._set('stat-hands-tied', h.tied);
        this._set('stat-hands-win-pct', this._pct(h.won, h.played));
        this._set('stat-hands-domino-won', h.byReason.domino.won);
        this._set('stat-hands-domino-lost', h.byReason.domino.lost);
        this._set('stat-hands-closed-won', h.byReason.closed.won);
        this._set('stat-hands-closed-lost', h.byReason.closed.lost);
        this._set('stat-hands-blocked-won', h.byReason.blocked.won);
        this._set('stat-hands-blocked-lost', h.byReason.blocked.lost);
        this._set('stat-hands-largest-score', this._fmt(h.largestScore));
        this._set('stat-hands-largest-surrender', this._fmt(h.largestSurrender));
    }

    _renderCerrado(c) {
        this._set('stat-cerrado-team-total', c.teamTotal);
        this._set('stat-cerrado-team-won', c.teamWon);
        this._set('stat-cerrado-you-closed', c.youClosed);
        this._set('stat-cerrado-partner-closed', c.partnerClosed);
        this._set('stat-cerrado-opponent-total', c.opponentTotal);
        this._set('stat-cerrado-largest-score', this._fmt(c.largestScore));
        this._set('stat-cerrado-largest-surrender', this._fmt(c.largestSurrender));
    }

    _renderCoaching(c) {
        this._set('stat-coaching-agreements', c.geninAgreements);
        this._set('stat-coaching-agreement-pct', this._pct(c.geninAgreements, c.geninTotal));
        this._set('stat-coaching-overrides', this._fmt(c.handOverridesWon));
        this._set('stat-coaching-quiz-attempts', c.quizAttempts > 0 ? c.quizAttempts : '--');
        this._set('stat-coaching-best-quiz', c.quizAttempts > 0 ? c.bestQuizScore : '--');
    }

    _renderBadges(earnedBadges) {
        const grid = document.getElementById('stats-badge-grid');
        if (!grid) return;

        const earnedIds = new Set(earnedBadges.map(b => b.id));
        grid.innerHTML = '';

        for (const badge of BADGES) {
            const isEarned = earnedIds.has(badge.id);
            const card = document.createElement('div');
            card.className = `badge-card${isEarned ? '' : ' locked'}`;
            card.innerHTML = `
                <div class="badge-card-icon">${badge.icon}</div>
                <div class="badge-card-title">${t(`badge.${badge.id}.title`)}</div>
                <div class="badge-card-desc">${isEarned ? t(`badge.${badge.id}.desc`) : t('badge.locked')}</div>
            `;
            grid.appendChild(card);
        }
    }
}
