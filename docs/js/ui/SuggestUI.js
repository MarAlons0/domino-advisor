// Suggestions & bugs: the 💬 button in the bottom-right corner and its form —
// 💡 Idea or 🐞 Bug, a message, an optional name. Each one goes to the server
// with the app version, the screen it was sent from, the AI levels and the
// language. The button is hidden while a hand is being played (body.in-hand):
// the tiles fill the bottom of the screen then. The stylesheet also hides it
// over the debrief and the inbox, which have their own buttons in that corner.

import { t, i18n } from '../i18n/i18n.js';
import { SuggestionService } from '../services/SuggestionService.js';

const ERRORS = { empty: 'suggest.err.empty', 'too-long': 'suggest.err.tooLong', 'too-large': 'suggest.err.tooLong', 'rate-limited': 'suggest.err.limit', busy: 'suggest.err.limit' };

export class SuggestUI {
    /**
     * @param {object} opts
     * @param {() => {screen: string, difficulty: string}} opts.getContext - where the
     *   player is and the AI levels, asked when the form opens
     */
    constructor({ getContext } = {}) {
        this.getContext = getContext || (() => ({}));
        this.fab = document.getElementById('suggest-fab');
        this.modal = document.getElementById('suggest-modal');
        this.overlay = document.getElementById('suggest-overlay');
        this.form = document.getElementById('suggest-form');
        this.thanks = document.getElementById('suggest-thanks');
        this.message = document.getElementById('suggest-message');
        this.name = document.getElementById('suggest-name');
        this.error = document.getElementById('suggest-error');
        this.sendBtn = document.getElementById('suggest-send');
        this.kind = 'idea';
        this.context = {};
        this.sending = false;
        if (!this.fab || !this.modal || !this.form) return;

        this.fab.addEventListener('click', () => this.open());
        for (const id of ['suggest-close', 'suggest-cancel', 'suggest-done']) {
            document.getElementById(id)?.addEventListener('click', () => this.close());
        }
        this.overlay?.addEventListener('click', () => this.close());
        this.form.querySelectorAll('.suggest-kind').forEach(btn =>
            btn.addEventListener('click', () => this._setKind(btn.dataset.kind)));
        this.form.addEventListener('submit', (e) => { e.preventDefault(); this._send(); });
        document.addEventListener('keydown', (e) => {
            // Help may be open on top (the form's "?"): Escape is not ours then.
            if (e.key === 'Escape' && this.isOpen() && !document.getElementById('help-modal')?.classList.contains('visible')) this.close();
        });

        this._setKind(this.kind);
        i18n.onLanguageChange(() => { this._setKind(this.kind); this._say(''); });
    }

    isOpen() { return this.modal.classList.contains('visible'); }

    open() {
        // Before the form covers it: what the player was looking at.
        this.context = this.getContext() || {};
        this._showThanks(false);
        this._say('');
        this.modal.classList.add('visible');
        this.overlay?.classList.add('visible');
        this.message.focus();
    }

    /** Close the form. An unsent message stays for the next time it opens. */
    close() {
        this.modal.classList.remove('visible');
        this.overlay?.classList.remove('visible');
    }

    _setKind(kind) {
        this.kind = kind === 'bug' ? 'bug' : 'idea';
        this.form.querySelectorAll('.suggest-kind').forEach(btn => {
            const on = btn.dataset.kind === this.kind;
            btn.classList.toggle('active', on);
            btn.setAttribute('aria-checked', String(on));
        });
        const hint = t(`suggest.placeholder.${this.kind}`);
        this.message.placeholder = hint;
        this.message.setAttribute('aria-label', hint);
    }

    _say(msg) { this.error.textContent = msg; }

    _showThanks(sent) {
        this.form.hidden = sent;
        this.thanks.hidden = !sent;
    }

    _setSending(sending) {
        this.sending = sending;
        this.sendBtn.disabled = sending;
        this.sendBtn.textContent = t(sending ? 'suggest.sending' : 'suggest.send');
    }

    async _send() {
        if (this.sending) return;
        const message = this.message.value.trim();
        if (!message) { this._say(t('suggest.err.empty')); this.message.focus(); return; }
        this._say('');
        this._setSending(true);
        try {
            await SuggestionService.send({
                kind: this.kind,
                message,
                name: this.name.value.trim(),
                screen: this.context.screen || '',
                difficulty: this.context.difficulty || '',
                version: t('app.version'),
                lang: i18n.getLanguage(),
            });
            this.message.value = '';
            this._showThanks(true);
            document.getElementById('suggest-done')?.focus();
        } catch (err) {
            this._say(t(ERRORS[err?.code] || 'suggest.err.send'));
        } finally {
            this._setSending(false);
        }
    }
}
