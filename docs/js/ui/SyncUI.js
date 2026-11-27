// "Your devices" on the Stats screen: link this device to the others so they
// keep one record (docs/CROSS_DEVICE_STATS.md). The work is StatsSync's; this
// draws the section and asks before anything changes.

import { t, i18n } from '../i18n/i18n.js';
import { StatsSync } from '../stats/StatsSync.js';

const ARM_MS = 4000; // a two-tap button stays armed this long

const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

/** "2 minutes ago", "hace 2 minutos", "now". */
function ago(at) {
    const rtf = new Intl.RelativeTimeFormat(i18n.currentLanguage, { numeric: 'auto' });
    const sec = Math.round((Date.now() - at) / 1000);
    if (sec < 45) return rtf.format(0, 'second');
    const min = Math.round(sec / 60);
    if (min < 60) return rtf.format(-min, 'minute');
    const hours = Math.round(min / 60);
    if (hours < 24) return rtf.format(-hours, 'hour');
    return rtf.format(-Math.round(hours / 24), 'day');
}

export class SyncUI {
    /**
     * @param {StatsSync} sync
     * @param {import('../stats/PlayerStats.js').PlayerStats} playerStats
     * @param {HTMLElement} box - where the section goes
     */
    constructor(sync, playerStats, box) {
        this.sync = sync;
        this.playerStats = playerStats;
        this.box = box;
        this.mode = 'idle';     // 'idle' | 'enter' (typing a code) | 'confirm' (asked to link) | 'busy'
        this.joinCode = null;
        this.joinCase = null;
        this.message = null;    // { text, kind: 'info' | 'error' }
        this.codeShown = false;
        this._deleteTimer = null;
        box.addEventListener('click', (e) => {
            const act = e.target.closest('[data-act]')?.dataset.act;
            if (act) this._act(act);
        });
        box.addEventListener('submit', (e) => {
            e.preventDefault();
            this._next();
        });
        i18n.onLanguageChange(() => this.render());
    }

    /** The Stats screen opened: draw, and catch up with the record if it's been a while. */
    onShow() {
        if (this.mode !== 'busy') this.message = null;
        this.render();
        this.sync.syncIfStale(30_000);
    }

    /** Hidden: forget a half-done question. */
    onHide() {
        this._disarmDelete();
        if (this.mode === 'enter' || this.mode === 'confirm') this.mode = 'idle';
    }

    /** A shared link was opened (…/#sync=CODE): ask whether to link this device. */
    async askJoin(code) {
        this.joinCode = code;
        this.joinCase = await this.sync.joinCase(code, this.playerStats.get());
        this.mode = 'confirm';
        this.message = null;
        this.render();
    }

    render() {
        const typed = this.box.querySelector('#stats-sync-input')?.value ?? '';
        // The "?" opens Help at "Play on more than one device" (HelpUI handles any [data-help]).
        const parts = [`<h3 class="stats-sync-head"><span>${t('stats.sync.title')}</span>
            <button type="button" class="help-ctx" data-help="help-devices" title="${esc(t('help.ctx'))}" aria-label="${esc(t('help.ctx'))}">?</button></h3>`];
        // How the last action went, first: right under the title.
        const message = this.message
            || (!this.sync.linked && this.sync.status === 'deleted' && this.mode === 'idle'
                ? { text: t('stats.sync.deleted'), kind: 'info' } : null);
        if (message) parts.push(`<p class="stats-sync-msg ${message.kind}" role="status">${esc(message.text)}</p>`);
        if (this.mode === 'busy') parts.push(`<p class="stats-sync-text">${t('stats.sync.working')}</p>`);
        else if (this.mode === 'confirm') parts.push(this._confirm());
        else if (this.sync.linked) parts.push(this._linked());
        else if (this.mode === 'enter') parts.push(this._enter());
        else parts.push(this._unlinked());
        this.box.innerHTML = parts.join('');
        const input = this.box.querySelector('#stats-sync-input');
        if (input) input.value = typed;
    }

    _unlinked() {
        return `
            <p class="stats-sync-text">${t('stats.sync.intro')}</p>
            <div class="stats-sync-actions">
                <button type="button" class="stats-sync-btn primary" data-act="create">${t('stats.sync.link')}</button>
                <button type="button" class="stats-sync-btn" data-act="enter">${t('stats.sync.haveCode')}</button>
            </div>
            <p class="stats-sync-hint">${t('stats.sync.privacy')}</p>`;
    }

    _enter() {
        return `
            <form class="stats-sync-form" novalidate>
                <input id="stats-sync-input" class="stats-sync-input" type="text" inputmode="text" autocomplete="off"
                    autocapitalize="characters" spellcheck="false" maxlength="20" placeholder="XXXX-XXXX-XXXX"
                    aria-label="${esc(t('stats.sync.codeLabel'))}">
                <div class="stats-sync-actions">
                    <button type="submit" class="stats-sync-btn primary">${t('stats.sync.next')}</button>
                    <button type="button" class="stats-sync-btn" data-act="cancel">${t('stats.sync.cancel')}</button>
                </div>
            </form>`;
    }

    _confirm() {
        const stats = this.playerStats.get();
        const code = StatsSync.formatCode(this.joinCode);
        const lines = [];
        let check = '';
        switch (this.joinCase) {
            case 'already':
                return `
                    <p class="stats-sync-text">${t('stats.sync.already', code)}</p>
                    <div class="stats-sync-actions">
                        <button type="button" class="stats-sync-btn primary" data-act="cancel">${t('stats.sync.ok')}</button>
                    </div>`;
            case 'add': lines.push(t('stats.sync.joinAdd', stats.matches.played, stats.hands.played)); break;
            case 'fresh': lines.push(t('stats.sync.joinFresh')); break;
            case 'same': lines.push(t('stats.sync.joinSame')); break;
            case 'switch': lines.push(t('stats.sync.joinSwitch')); // and, like 'other', ask
            // falls through
            case 'other':
                check = `<label class="stats-sync-check"><input type="checkbox" id="stats-sync-add">
                    <span>${t('stats.sync.joinOther', stats.matches.played)}</span></label>`;
                break;
        }
        return `
            <p class="stats-sync-text">${t('stats.sync.joinAsk', `<strong class="stats-sync-inline-code">${code}</strong>`)}</p>
            ${lines.map(l => `<p class="stats-sync-text">${l}</p>`).join('')}
            ${check}
            <div class="stats-sync-actions">
                <button type="button" class="stats-sync-btn primary" data-act="join">${t('stats.sync.confirmLink')}</button>
                <button type="button" class="stats-sync-btn" data-act="cancel">${t('stats.sync.cancel')}</button>
            </div>
            <p class="stats-sync-hint">${t('stats.sync.privacy')}</p>`;
    }

    _linked() {
        const s = this.sync;
        const st = s.state;
        const status = [st.devices > 1 ? t('stats.sync.linkedMany', st.devices) : t('stats.sync.linkedOne')];
        if (s.status === 'syncing') status.push(t('stats.sync.syncing'));
        else if (s.status === 'offline') status.push(t('stats.sync.offline'));
        else if (s.status === 'error') status.push(t('stats.sync.error'));
        else if (st.syncedAt) status.push(t('stats.sync.syncedAgo', ago(st.syncedAt)));
        const armed = !!this._deleteTimer;
        const code = this.codeShown ? `
            <div class="stats-sync-code" aria-label="${esc(t('stats.sync.codeLabel'))}">${StatsSync.formatCode(s.code)}</div>
            <div class="stats-sync-actions">
                <button type="button" class="stats-sync-btn primary" data-act="share">${t('stats.sync.share')}</button>
            </div>
            <p class="stats-sync-hint">${t('stats.sync.codeHint')}</p>` : '';
        return `
            <p class="stats-sync-status">${status.map(esc).join(' · ')}</p>
            <div class="stats-sync-actions">
                <button type="button" class="stats-sync-btn" data-act="toggle-code">${t(this.codeShown ? 'stats.sync.hideCode' : 'stats.sync.showCode')}</button>
            </div>
            ${code}
            <div class="stats-sync-actions stats-sync-manage">
                <button type="button" class="stats-sync-btn subtle" data-act="unlink">${t('stats.sync.unlink')}</button>
                <button type="button" class="stats-sync-btn subtle danger${armed ? ' armed' : ''}" data-act="delete">${t(armed ? 'stats.sync.deleteConfirm' : 'stats.sync.delete')}</button>
            </div>
            <p class="stats-sync-hint">${t('stats.sync.privacy')}</p>`;
    }

    async _act(act) {
        if (this.mode === 'busy') return;
        switch (act) {
            case 'create': return this._busy(async () => {
                await this.sync.create(this.playerStats.get());
                this.codeShown = true;
                return t('stats.sync.created');
            });
            case 'enter':
                this.mode = 'enter';
                this.message = null;
                this.render();
                this.box.querySelector('#stats-sync-input')?.focus();
                return;
            case 'cancel':
                this.mode = 'idle';
                this.joinCode = null;
                this.message = null;
                this.render();
                return;
            case 'join': {
                const add = this.box.querySelector('#stats-sync-add');
                const addStats = add ? add.checked : true;
                const code = this.joinCode;
                return this._busy(async () => {
                    try {
                        await this.sync.join(code, this.playerStats.get(), { addStats });
                    } catch (e) {
                        // No answer: linked anyway, and it sends when it can.
                        if (e.code === 'network' && this.sync.linked) return t('stats.sync.joinedOffline');
                        throw e;
                    }
                    return t('stats.sync.joined');
                });
            }
            case 'toggle-code':
                this.codeShown = !this.codeShown;
                this.message = null;
                this.render();
                return;
            case 'share': return this._share();
            case 'unlink': return this._busy(async () => {
                await this.sync.unlink();
                this.codeShown = false;
                return t('stats.sync.unlinked');
            });
            case 'delete':
                if (!this._deleteTimer) {
                    this._deleteTimer = setTimeout(() => { this._deleteTimer = null; this.render(); }, ARM_MS);
                    this.render();
                    return;
                }
                this._disarmDelete();
                return this._busy(async () => {
                    await this.sync.deleteRecord();
                    this.codeShown = false;
                    return t('stats.sync.deletedHere');
                });
        }
    }

    _next() {
        const code = StatsSync.normalizeCode(this.box.querySelector('#stats-sync-input')?.value);
        if (!code) {
            this.message = { text: t('stats.sync.badCode'), kind: 'error' };
            this.render();
            return;
        }
        this.askJoin(code);
    }

    /** Run a call to the server with the buttons off; show how it went. */
    async _busy(fn) {
        this.mode = 'busy';
        this.message = null;
        this.render();
        try {
            this.message = { text: await fn(), kind: 'info' };
            this.mode = 'idle';
            this.joinCode = null;
        } catch (e) {
            this.message = { text: this._errorText(e), kind: 'error' };
            this.mode = 'idle';
            this.joinCode = null;
        }
        this.render();
    }

    _errorText(e) {
        if (e?.code === 'network') return t('stats.sync.network');
        if (e?.code === 'not-found') return t('stats.sync.notFound');
        return t('stats.sync.failed');
    }

    async _share() {
        const url = this.sync.shareUrl();
        if (navigator.share) {
            try {
                await navigator.share({ title: '7 Fichas', text: t('stats.sync.shareText'), url });
                return;
            } catch (e) {
                if (e?.name === 'AbortError') return; // closed the share sheet
            }
        }
        try {
            await navigator.clipboard.writeText(url);
            this.message = { text: t('stats.sync.copied'), kind: 'info' };
        } catch {
            this.message = { text: t('stats.sync.copyThis', url), kind: 'info' };
        }
        this.render();
    }

    _disarmDelete() {
        clearTimeout(this._deleteTimer);
        this._deleteTimer = null;
    }
}
