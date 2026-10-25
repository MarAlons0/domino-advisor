// Help window: a "How do I…?" index at the top whose questions jump to the
// answer (briefly highlighted), "↑ Index" links back, and context "?" buttons
// elsewhere in the app — any element with data-help="<section id>" — that open
// Help at the right section.

import { t, i18n } from '../i18n/i18n.js';

// [group, [[question, section id], …]] — texts under help.index.*
const INDEX = [
    ['start', [['startGame', 'help-start'], ['whoLeads', 'help-start'], ['aiStrength', 'help-settings'], ['language', 'help-settings']]],
    ['play', [['playTile', 'help-play'], ['cantPlay', 'help-play'], ['puntas', 'help-play'], ['whoPlayed', 'help-play']]],
    ['scoring', [['domino', 'help-scoring'], ['cerrado', 'help-scoring'], ['matchPoints', 'help-scoring'], ['moments', 'help-moments']]],
    ['genin', [['askGenin', 'help-genin'], ['handCard', 'help-genin'], ['grades', 'help-grades'], ['quiz', 'help-quiz']]],
    ['after', [['debrief', 'help-debrief'], ['styleAnalysis', 'help-debrief'], ['stats', 'help-settings']]],
    ['friends', [['createRoom', 'help-friends'], ['seats', 'help-friends'], ['reconnect', 'help-friends'], ['reactions', 'help-friends'], ['rematch', 'help-friends']]],
    ['strategy', [['tips', 'help-strategy']]],
];

const HIGHLIGHT_MS = 2000;

export class HelpUI {
    constructor() {
        this.modal = document.getElementById('help-modal');
        this.overlay = document.getElementById('help-overlay');
        this.content = this.modal?.querySelector('.help-content');
        this.indexList = document.getElementById('help-index-list');
        if (!this.modal || !this.content) return;

        document.getElementById('help-btn')?.addEventListener('click', () => this.open());
        document.getElementById('close-help-btn')?.addEventListener('click', () => this.close());
        this.overlay?.addEventListener('click', () => this.close());
        // Index questions and "↑ Index" links scroll inside the window.
        this.content.addEventListener('click', (e) => {
            const link = e.target.closest('a[href^="#help-"]');
            if (!link) return;
            e.preventDefault();
            this.show(link.getAttribute('href').slice(1));
        });
        // Context "?" buttons anywhere in the app.
        document.addEventListener('click', (e) => {
            const btn = e.target.closest('[data-help]');
            if (!btn) return;
            e.preventDefault();
            e.stopPropagation();
            this.open(btn.dataset.help);
        });

        this.renderIndex();
        i18n.onLanguageChange(() => this.renderIndex());
    }

    renderIndex() {
        if (!this.indexList) return;
        this.indexList.innerHTML = INDEX.map(([group, questions]) => `
            <div class="help-index-group">
                <div class="help-index-heading">${t(`help.index.group.${group}`)}</div>
                <ul>${questions.map(([q, id]) => `<li><a href="#${id}">${t(`help.index.q.${q}`)}</a></li>`).join('')}</ul>
            </div>`).join('');
    }

    /** Open Help at the top (the index), or at a section. */
    open(sectionId = null) {
        this.modal.classList.add('visible');
        this.overlay?.classList.add('visible');
        // Opened from a "?" elsewhere: land on the section at once (no glide from the top).
        if (sectionId) this.show(sectionId, { instant: true });
        else this.content.scrollTop = 0;
    }

    close() {
        this.modal.classList.remove('visible');
        this.overlay?.classList.remove('visible');
    }

    /** Scroll a section to the top of the window and highlight it briefly. */
    show(id, { instant = false } = {}) {
        const section = document.getElementById(id);
        if (!section || !this.content.contains(section)) return;
        const top = section.getBoundingClientRect().top - this.content.getBoundingClientRect().top + this.content.scrollTop - 8;
        const smooth = !instant && !window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
        this.content.scrollTo({ top: Math.max(0, top), behavior: smooth ? 'smooth' : 'auto' });
        if (id === 'help-index') return;
        this.content.querySelectorAll('.help-highlight').forEach(el => el.classList.remove('help-highlight'));
        section.classList.add('help-highlight');
        clearTimeout(this._highlightTimer);
        this._highlightTimer = setTimeout(() => section.classList.remove('help-highlight'), HIGHLIGHT_MS);
    }
}
