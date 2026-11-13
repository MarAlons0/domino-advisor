// Suggestions & bug reports: calls to the 7 Fichas server (the rooms Worker,
// server/src/suggestions.js). Sending is open to everyone; reading and marking
// done need the admin PIN.

import { ROOMS_URL } from '../multiplayer/MultiplayerSession.js';

/** A refused or failed call. `code` is the server's error name, or 'network'. */
export class SuggestionError extends Error {
    constructor(code, status = 0) {
        super(code);
        this.code = code;
        this.status = status;
    }
}

async function request(path, { method = 'GET', body, pin } = {}) {
    const headers = {};
    if (body !== undefined) headers['Content-Type'] = 'application/json';
    if (pin) headers['X-Admin-Pin'] = pin;
    let r;
    try {
        r = await fetch(`${ROOMS_URL}${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
    } catch {
        throw new SuggestionError('network');
    }
    let data = null;
    try { data = await r.json(); } catch { /* not JSON: treated as a server error below */ }
    if (!r.ok || !data) throw new SuggestionError(data?.error || 'server', r.status);
    return data;
}

export const SuggestionService = {
    /** @param {{kind, message, name, screen, version, difficulty, lang}} suggestion */
    send: (suggestion) => request('/suggestions', { method: 'POST', body: suggestion }),
    /** Open ones first, newest first. */
    list: (pin) => request('/suggestions', { pin }).then(d => d.suggestions || []),
    /** @param {'open'|'done'} status — resolves to the updated suggestion */
    setStatus: (pin, id, status) => request(`/suggestions/${id}`, { method: 'PATCH', pin, body: { status } }),
};
