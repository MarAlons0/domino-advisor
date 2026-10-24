// Multiplayer lobby window.
//  - Entry view (no room yet): your name, create a room, or join with a code.
//  - Room view: invite link, the four seats laid out like the table from your
//    point of view (your team cyan, opponents red), seat and AI-level controls,
//    Start (host), "Give seat to AI" (host, after the grace period), the turn
//    timer (host), and after a match Rematch for everyone (it deals when all have
//    tapped it; the host can also start right away).
// See docs/MULTIPLAYER.md.

import { t } from '../i18n/i18n.js';
import { MultiplayerSession } from '../multiplayer/MultiplayerSession.js';

const LEVELS = ['beginner', 'experienced', 'master']; // as in Settings
const TIMERS = [0, 30, 60];                            // seconds; as the room server allows

// Player names come from other people: always escape before inserting as HTML.
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

export class LobbyUI {
    /**
     * @param {object} app - the DominoApp (for the active session, if any)
     */
    constructor(app) {
        this.app = app;
        this.modal = document.getElementById('mp-modal');
        this.overlay = document.getElementById('mp-overlay');
        this.body = document.getElementById('mp-body');
        this.title = document.getElementById('mp-title');
        this.mode = 'entry';
        this.message = '';
        document.getElementById('mp-close')?.addEventListener('click', () => this.close());
        this.overlay?.addEventListener('click', () => this.close());
        this.body?.addEventListener('click', (e) => this._onClick(e));
        this.body?.addEventListener('change', (e) => this._onChange(e));
    }

    get session() { return this.app.multiplayer || null; }

    openEntry() { this.mode = 'entry'; this.message = ''; this.render(); this._show(); }
    openRoom() { this.mode = 'room'; this.render(); this._show(); }

    _show() {
        this.modal?.classList.add('visible');
        this.overlay?.classList.add('visible');
    }

    close() {
        this.modal?.classList.remove('visible');
        this.overlay?.classList.remove('visible');
    }

    isOpen() { return this.modal?.classList.contains('visible'); }

    render() {
        if (!this.body) return;
        if (this.mode === 'entry') return this._renderEntry();
        return this._renderRoom();
    }

    // ---------------------------------------------------------------- entry
    _renderEntry() {
        this.title.textContent = t('mp.title');
        this.body.innerHTML = `
            <label class="mp-label" for="mp-name">${t('mp.name')}</label>
            <input id="mp-name" class="mp-input" maxlength="12" autocomplete="nickname" value="${esc(MultiplayerSession.savedName)}">
            <button class="mp-primary" data-act="create">${t('mp.create')}</button>
            <div class="mp-divider">${t('mp.orJoin')}</div>
            <div class="mp-join">
                <input id="mp-code" class="mp-input mp-code" maxlength="6" autocapitalize="characters" placeholder="${t('mp.codePlaceholder')}">
                <button class="mp-secondary" data-act="join">${t('mp.join')}</button>
            </div>
            <p class="mp-message" role="status">${esc(this.message)}</p>`;
    }

    _readName() {
        const name = (document.getElementById('mp-name')?.value || '').trim().slice(0, 12);
        if (!name) { this._say(t('mp.err.name')); return null; }
        MultiplayerSession.savedName = name;
        return name;
    }

    _say(msg) {
        this.message = msg;
        const el = this.body.querySelector('.mp-message');
        if (el) el.textContent = msg;
    }

    async _create(btn) {
        if (!this._readName()) return;
        btn.disabled = true;
        btn.textContent = t('mp.creating');
        try {
            const code = await MultiplayerSession.createRoom();
            location.href = MultiplayerSession.roomUrl(code);
        } catch {
            btn.disabled = false;
            btn.textContent = t('mp.create');
            this._say(t('mp.err.server'));
        }
    }

    async _join() {
        if (!this._readName()) return;
        const code = (document.getElementById('mp-code')?.value || '').trim().toUpperCase();
        if (!MultiplayerSession.isValidCode(code)) return this._say(t('mp.err.code'));
        if (!(await MultiplayerSession.roomExists(code))) return this._say(t('mp.err.notFound'));
        location.href = MultiplayerSession.roomUrl(code);
    }

    // ---------------------------------------------------------------- room
    _renderRoom() {
        const s = this.session;
        if (!s) return;
        this.title.textContent = t('mp.room', s.code);

        // First visit to an invite link: ask for a name before joining.
        if (!MultiplayerSession.savedName) {
            this.body.innerHTML = `
                <label class="mp-label" for="mp-name">${t('mp.name')}</label>
                <input id="mp-name" class="mp-input" maxlength="12" autocomplete="nickname">
                <button class="mp-primary" data-act="enter">${t('mp.joinRoom')}</button>
                <p class="mp-message" role="status">${esc(this.message)}</p>`;
            return;
        }

        if (s.status === 'gone' || s.status === 'replaced') {
            this.body.innerHTML = `<p class="mp-status">${t(`mp.status.${s.status}`)}</p>
                <div class="mp-footer"><button class="mp-secondary" data-act="leave">${t('mp.leave')}</button></div>`;
            return;
        }

        const lobby = s.lobby;
        if (!lobby) {
            this.body.innerHTML = `<p class="mp-status">${t('mp.status.connecting')}</p>`;
            return;
        }

        const me = s.mySeat();
        const base = me ?? 0;                       // whose point of view the table is drawn from
        const host = s.isHost();
        const setup = lobby.phase === 'lobby' || lobby.phase === 'matchOver';
        const hostName = lobby.seats.find(x => x.playerId === lobby.host)?.name || '';
        const status = s.status === 'reconnecting' ? t('mp.status.reconnecting') : t(`mp.status.${lobby.phase}`);
        const roles = ['mp.seat.you', 'mp.seat.right', 'mp.seat.partner', 'mp.seat.left'];

        const seatCard = (local) => {
            const seat = (local + base) % 4;
            const x = lobby.seats[seat];
            const mine = me !== null && seat === me;
            let who;
            if (x.kind === 'human') {
                who = `<span class="mp-who">${esc(x.name)}</span>`
                    + (x.playerId === lobby.host ? ` <span class="mp-tag">${t('mp.host')}</span>` : '')
                    + (x.connected === false ? ` <span class="mp-tag mp-away">${t('mp.away')}</span>` : '');
            } else if (x.kind === 'ai') {
                who = `<span class="mp-who mp-ai">${t('mp.ai', t(`settings.difficulty.${x.level}`))}</span>`;
            } else {
                who = `<span class="mp-who mp-open">${t('mp.open')}</span>`;
            }
            const controls = [];
            if (setup && x.kind !== 'human' && !mine) {
                controls.push(`<button class="mp-small" data-act="sit" data-seat="${seat}">${t('mp.sitHere')}</button>`);
            }
            if (setup && host && x.kind !== 'human') {
                const opts = [`<option value="open"${x.kind === 'open' ? ' selected' : ''}>${t('mp.level.open')}</option>`]
                    .concat(LEVELS.map(l => `<option value="${l}"${x.kind === 'ai' && x.level === l ? ' selected' : ''}>${t('mp.ai', t(`settings.difficulty.${l}`))}</option>`));
                controls.push(`<select class="mp-select" data-act="level" data-seat="${seat}" aria-label="${t(roles[local])}">${opts.join('')}</select>`);
            }
            if (!setup && host && x.kind === 'human' && x.replaceable) {
                controls.push(`<button class="mp-small" data-act="replace" data-seat="${seat}">${t('mp.giveToAI')}</button>`);
            }
            const team = local % 2 === 0 ? 'mine' : 'theirs';
            return `<div class="mp-seat mp-seat-${local} mp-team-${team}${mine ? ' mp-me' : ''}">
                <div class="mp-role">${t(roles[local])}</div>
                <div>${who}</div>
                ${controls.length ? `<div class="mp-controls">${controls.join('')}</div>` : ''}
            </div>`;
        };

        let footer = '';
        if (lobby.phase === 'matchOver') {
            const waiting = s.rematchWaitingFor();
            const canVote = me !== null && waiting.some(x => x.playerId === s.playerId);
            footer = canVote
                ? `<button class="mp-primary" data-act="rematch">${t('mp.rematch')}</button>`
                : `<p class="mp-status">${t('mp.rematchWaiting', esc(waiting.map(x => x.name).join(', ')))}</p>`;
            if (host && waiting.some(x => x.playerId !== s.playerId)) {
                footer += `<button class="mp-link" data-act="start">${t('mp.startNow')}</button>`;
            }
        } else if (setup) {
            footer = host
                ? `<button class="mp-primary" data-act="start">${t('mp.start')}</button>`
                : `<p class="mp-status">${t('mp.waitHost', esc(hostName))}</p>`;
        } else {
            footer = `<button class="mp-primary" data-act="back">${t('mp.back')}</button>`;
        }

        const timer = lobby.turnTimer || 0;
        const timerLabel = (v) => (v ? t('mp.timer.secs', v) : t('mp.timer.off'));
        const timerRow = host
            ? `<label class="mp-timer">${t('mp.timer')}
                   <select class="mp-select" data-act="timer">${TIMERS.map(v => `<option value="${v}"${v === timer ? ' selected' : ''}>${timerLabel(v)}</option>`).join('')}</select>
               </label>`
            : (timer ? `<p class="mp-timer">${t('mp.timer')}: ${timerLabel(timer)}</p>` : '');

        this.body.innerHTML = `
            <div class="mp-invite">
                <span class="mp-code-big">${esc(s.code)}</span>
                <button class="mp-secondary" data-act="copy">${t('mp.copyLink')}</button>
                ${navigator.share ? `<button class="mp-secondary" data-act="share">${t('mp.share')}</button>` : ''}
            </div>
            <p class="mp-status" role="status">${status}</p>
            <div class="mp-table">${[2, 3, 1, 0].map(seatCard).join('')}</div>
            ${timerRow}
            <div class="mp-footer">${footer}
                <button class="mp-link" data-act="leave">${t('mp.leave')}</button>
            </div>
            <p class="mp-message" role="status">${esc(this.message)}</p>`;
    }

    // ---------------------------------------------------------------- events
    _onClick(e) {
        const btn = e.target.closest('[data-act]');
        if (!btn || btn.tagName === 'SELECT') return;
        const seat = Number(btn.dataset.seat);
        const s = this.session;
        switch (btn.dataset.act) {
            case 'create': return this._create(btn);
            case 'join': return this._join();
            case 'enter':
                if (this._readName()) { this.message = ''; this.render(); s?.connect(); }
                return;
            case 'sit': return s?.takeSeat(seat);
            case 'replace': return s?.replaceWithAI(seat);
            case 'start': return s?.start();
            case 'rematch': return s?.rematch();
            case 'back': return this.close();
            case 'leave': return s ? s.leave() : this.close();
            case 'copy':
                navigator.clipboard?.writeText(MultiplayerSession.roomUrl(s.code))
                    .then(() => this._say(t('mp.copied')))
                    .catch(() => this._say(MultiplayerSession.roomUrl(s.code)));
                return;
            case 'share':
                navigator.share?.({ title: '7 Fichas', text: t('mp.shareText'), url: MultiplayerSession.roomUrl(s.code) }).catch(() => {});
                return;
        }
    }

    _onChange(e) {
        const timer = e.target.closest('select[data-act="timer"]');
        if (timer) return this.session?.setTimer(Number(timer.value));
        const sel = e.target.closest('select[data-act="level"]');
        if (!sel) return;
        const seat = Number(sel.dataset.seat);
        if (sel.value === 'open') this.session?.setSeat(seat, 'open');
        else this.session?.setSeat(seat, 'ai', sel.value);
    }
}
