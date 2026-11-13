// Email to the organizers through SendGrid's HTTP API (no SMTP on Workers).
// Secrets: SENDGRID_API_KEY, OPERATOR_EMAILS (comma-separated) and, optionally,
// SENDGRID_FROM_EMAIL (a sender verified in SendGrid; without it the first
// operator address is used). With a secret missing nothing is sent — the
// suggestion is already saved by then.

const SENDGRID_URL = 'https://api.sendgrid.com/v3/mail/send';
const APP_URL = 'https://maralons0.github.io/domino-advisor/';
const LABELS = { idea: 'Suggestion', bug: 'Bug report' };
const EMAIL_RE = /^[^\s@,]+@[^\s@,]+\.[^\s@,]+$/;

/** @returns {{key, from, recipients} | null} null when email isn't set up */
export function emailConfig(env) {
    const key = String(env.SENDGRID_API_KEY || '').trim();
    const recipients = String(env.OPERATOR_EMAILS || '').split(',').map(s => s.trim()).filter(s => EMAIL_RE.test(s));
    if (!key || !recipients.length) return null;
    const from = String(env.SENDGRID_FROM_EMAIL || '').trim();
    return { key, recipients, from: EMAIL_RE.test(from) ? from : recipients[0] };
}

export function suggestionEmail(s) {
    const label = LABELS[s.kind] || LABELS.idea;
    const context = [
        s.version && `App ${s.version}`,
        s.screen && `screen: ${s.screen}`,
        s.difficulty && `AI levels: ${s.difficulty}`,
        s.lang && `language: ${s.lang}`,
    ].filter(Boolean).join(' · ');
    return {
        subject: `7 Fichas: new ${label.toLowerCase()}`,
        body: `${label} from ${s.name || 'someone (no name given)'}:\n\n${s.message}\n\n`
            + (context ? `${context}\n\n` : '')
            + `Review it in 7 Fichas (admin PIN): ${APP_URL}?admin=suggestions\n`,
    };
}

/**
 * Email one suggestion to every operator (each gets their own copy).
 * Never throws: a failed email must not lose the suggestion.
 * @returns {Promise<'sent' | 'not-configured' | 'failed'>}
 */
export async function notifyOperators(env, suggestion) {
    const config = emailConfig(env);
    if (!config) {
        console.warn('Suggestion saved; no email sent (SENDGRID_API_KEY / OPERATOR_EMAILS not set).');
        return 'not-configured';
    }
    const { subject, body } = suggestionEmail(suggestion);
    try {
        const r = await fetch(SENDGRID_URL, {
            method: 'POST',
            headers: { Authorization: `Bearer ${config.key}`, 'Content-Type': 'application/json' },
            body: JSON.stringify({
                personalizations: config.recipients.map(email => ({ to: [{ email }] })),
                from: { email: config.from, name: '7 Fichas' },
                subject,
                content: [{ type: 'text/plain', value: body }],
            }),
            signal: AbortSignal.timeout(10000),
        });
        if (r.ok) return 'sent';
        console.warn(`Suggestion email failed: SendGrid answered ${r.status}.`);
    } catch (err) {
        console.warn(`Suggestion email failed: ${err?.name || 'error'}.`);
    }
    return 'failed';
}
