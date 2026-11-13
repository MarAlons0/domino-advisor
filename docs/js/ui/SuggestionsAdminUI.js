// Suggestions inbox (admin): everything sent with the 💬 button — open ones
// first, newest first, each with Mark done / Reopen; done ones behind a
// "Show N done" link. It asks for the admin PIN once and keeps it on this
// device until the server refuses it or you tap "Forget the PIN".
// Opened from Settings, or directly with …/?admin=suggestions.

import { t, i18n } from '../i18n/i18n.js';
import { StorageService } from '../stats/StorageService.js';
import { SuggestionService } from '../services/SuggestionService.js';

const PIN_KEY = '7fichas_admin_pin';
// Why the server said no → what to tell the admin (the PIN is asked again).
const PIN_ERRORS = { 'wrong-pin': 'inbox.err.wrongPin', 'pin-locked': 'inbox.err.locked', 'admin-not-configured': 'inbox.err.noPin' };

// Everything shown here was typed by someone else: always escape before inserting as HTML.
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

export class SuggestionsAdminUI {
    /** @param {{onOpen?: () => void}} opts - onOpen: close whatever window it was opened from */
    constructor({ onOpen } = {}) {
        this.onOpen = onOpen;
        this.modal = document.getElementById('inbox-modal');
        this.overlay = document.getElementById('inbox-overlay');
        this.body = document.getElementById('inbox-body');
        this.view = 'pin';       // pin | loading | error | list
        this.items = [];
        this.showDone = false;
        this.message = '';
        if (!this.modal || !this.body) return;

        document.getElementById('open-inbox-btn')?.addEventListener('click', () => this.open());
        document.getElementById('inbox-close')?.addEventListener('click', () => this.close());
        this.overlay?.addEventListener('click', () => this.close());
        this.body.addEventListener('click', (e) => this._onClick(e));
        this.body.addEventListener('submit', (e) => { e.preventDefault(); this._enterPin(); });
        i18n.onLanguageChange(() => { if (this.isOpen()) this.render(); });

        if (new URLSearchParams(location.search).get('admin') === 'suggestions') this.open();
    }

    get pin() { return StorageService.get(PIN_KEY) || ''; }
    set pin(value) { StorageService.set(PIN_KEY, value || null); }

    isOpen() { return this.modal.classList.contains('visible'); }

    open() {
        this.onOpen?.();
        this.message = '';
        this.showDone = false;
        this.modal.classList.add('visible');
        this.overlay?.classList.add('visible');
        if (this.pin) this.load();
        else this._show('pin');
    }

    close() {
        this.modal.classList.remove('visible');
        this.overlay?.classList.remove('visible');
    }

    _show(view) { this.view = view; this.render(); }

    async load() {
        this._show('loading');
        try {
            this.items = await SuggestionService.list(this.pin);
            this.message = '';
            this._show('list');
        } catch (err) {
            if (!this._refused(err)) this._show('error');
        }
    }

    /** The server refused the PIN (or has none): ask for it again. @returns {boolean} whether it was that */
    _refused(err) {
        const key = PIN_ERRORS[err?.code];
        if (!key) return false;
        if (err.code === 'wrong-pin') this.pin = '';
        this.message = t(key);
        this._show('pin');
        return true;
    }

    _enterPin() {
        const value = (document.getElementById('inbox-pin')?.value || '').trim();
        if (!value) return;
        this.pin = value;
        this.message = '';
        this.load();
    }

    async _toggle(id) {
        const item = this.items.find(s => s.id === id);
        if (!item) return;
        try {
            const updated = await SuggestionService.setStatus(this.pin, id, item.status === 'done' ? 'open' : 'done');
            this.items = this.items.map(s => (s.id === id ? updated : s));
            this.message = '';
            this.render();
        } catch (err) {
            if (this._refused(err)) return;
            this.message = t('inbox.err.update');
            this.render();
        }
    }

    _onClick(e) {
        const btn = e.target.closest('[data-act]');
        if (!btn) return;
        switch (btn.dataset.act) {
            case 'toggle': return this._toggle(Number(btn.dataset.id));
            case 'done-list': this.showDone = !this.showDone; return this.render();
            case 'retry': return this.load();
            case 'lock': this.pin = ''; this.items = []; this.message = ''; return this._show('pin');
        }
    }

    render() {
        if (this.view === 'pin') return this._renderPin();
        if (this.view === 'loading') { this.body.innerHTML = `<p class="mp-status">${t('inbox.loading')}</p>`; return; }
        if (this.view === 'error') {
            this.body.innerHTML = `<p class="mp-status">${t('inbox.err.load')}</p>
                <button type="button" class="mp-secondary" data-act="retry">${t('inbox.retry')}</button>`;
            return;
        }
        this._renderList();
    }

    _renderPin() {
        this.body.innerHTML = `
            <p class="mp-status">${t('inbox.pin.intro')}</p>
            <form class="inbox-pin-form">
                <label class="mp-label" for="inbox-pin">${t('inbox.pin.label')}</label>
                <input id="inbox-pin" class="mp-input" type="password" autocomplete="off" maxlength="64">
                <button type="submit" class="mp-primary">${t('inbox.pin.open')}</button>
            </form>
            <p class="mp-message" role="alert">${esc(this.message)}</p>`;
        document.getElementById('inbox-pin')?.focus();
    }

    _renderList() {
        // Newest first, also right after Mark done / Reopen moved one between the lists.
        const items = [...this.items].sort((a, b) => b.created_at - a.created_at || b.id - a.id);
        const open = items.filter(s => s.status !== 'done');
        const done = items.filter(s => s.status === 'done');
        const doneBlock = done.length ? `
            <button type="button" class="mp-link inbox-done-toggle" data-act="done-list" aria-expanded="${this.showDone}">${t(this.showDone ? 'inbox.hideDone' : 'inbox.showDone', done.length)}</button>
            ${this.showDone ? done.map(s => this._card(s)).join('') : ''}` : '';
        this.body.innerHTML = `
            ${this.message ? `<p class="mp-message" role="alert">${esc(this.message)}</p>` : ''}
            ${open.length ? open.map(s => this._card(s)).join('') : `<p class="inbox-empty">${t('inbox.empty')}</p>`}
            ${doneBlock}
            <button type="button" class="mp-link inbox-lock" data-act="lock">${t('inbox.lock')}</button>`;
    }

    _card(s) {
        const bug = s.kind === 'bug';
        const isDone = s.status === 'done';
        const when = s.created_at ? new Date(s.created_at).toLocaleString(i18n.getLanguage()) : '';
        const details = [s.version, s.lang && s.lang.toUpperCase(), s.difficulty].filter(Boolean).map(esc).join(' · ');
        // Typed text never goes through t(): its placeholder replacement would read "$&" in it.
        const where = s.screen ? ` · ${t('inbox.on', '%s').replace('%s', () => `<code>${esc(s.screen)}</code>`)}` : '';
        return `<article class="inbox-card${isDone ? ' done' : ''}">
            <div class="inbox-card-head">
                <span class="inbox-kind ${bug ? 'bug' : 'idea'}">${t(bug ? 'suggest.kind.bug' : 'suggest.kind.idea')}</span>
                <span class="inbox-when">${esc(when)}</span>
            </div>
            <p class="inbox-text">${esc(s.message)}</p>
            <div class="inbox-card-foot">
                <span class="inbox-who">${esc(s.name || t('inbox.anonymous'))}${where}${details ? `<span class="inbox-details">${details}</span>` : ''}</span>
                <button type="button" class="inbox-toggle${isDone ? ' reopen' : ''}" data-act="toggle" data-id="${Number(s.id)}">${t(isDone ? 'inbox.reopen' : 'inbox.markDone')}</button>
            </div>
        </article>`;
    }
}
