// Email to the organizers through an HTTP email API (no SMTP on Workers).
//
// Providers, in the order they are tried. One is used only if its key is set,
// and the next one only if the one before it failed:
//   1. Brevo    — BREVO_API_KEY, optionally BREVO_FROM_EMAIL. The primary: it has
//                 a free tier (300 a day), the one TripPlanner and Bird Tracker use.
//   2. SendGrid — SENDGRID_API_KEY, optionally SENDGRID_FROM_EMAIL. A fallback:
//                 SendGrid retired its free tier, so it only works on a paid account.
// OPERATOR_EMAILS (comma-separated) says who gets the mail. The sender has to be
// an address verified with that provider; without a *_FROM_EMAIL the first
// operator address is used. With no key or no usable recipient nothing is sent —
// the suggestion is already saved by then.

const BREVO_URL = 'https://api.brevo.com/v3/smtp/email';
const SENDGRID_URL = 'https://api.sendgrid.com/v3/mail/send';
const APP_URL = 'https://maralons0.github.io/domino-advisor/';
const SENDER_NAME = '7 Fichas';
const LABELS = { idea: 'Suggestion', bug: 'Bug report' };
const EMAIL_RE = /^[^\s@,]+@[^\s@,]+\.[^\s@,]+$/;

const PROVIDERS = [
    {
        name: 'Brevo',
        keyVar: 'BREVO_API_KEY',
        fromVar: 'BREVO_FROM_EMAIL',
        // One message addressed to every organizer. `api-key` header, not Bearer.
        request: ({ key, from }, recipients, subject, body) => [BREVO_URL, {
            headers: { 'api-key': key, accept: 'application/json', 'content-type': 'application/json' },
            payload: {
                sender: { email: from, name: SENDER_NAME },
                to: recipients.map(email => ({ email })),
                subject,
                textContent: body,
            },
        }],
    },
    {
        name: 'SendGrid',
        keyVar: 'SENDGRID_API_KEY',
        fromVar: 'SENDGRID_FROM_EMAIL',
        // One request, a separate copy for each organizer.
        request: ({ key, from }, recipients, subject, body) => [SENDGRID_URL, {
            headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
            payload: {
                personalizations: recipients.map(email => ({ to: [{ email }] })),
                from: { email: from, name: SENDER_NAME },
                subject,
                content: [{ type: 'text/plain', value: body }],
            },
        }],
    },
];

/**
 * @returns {{recipients: string[], providers: Array<{name, key, from, request}>} | null}
 *   null when email isn't set up: no usable recipient, or no provider key
 */
export function emailConfig(env) {
    const recipients = String(env.OPERATOR_EMAILS || '').split(',').map(s => s.trim()).filter(s => EMAIL_RE.test(s));
    if (!recipients.length) return null;
    const providers = [];
    for (const provider of PROVIDERS) {
        const key = String(env[provider.keyVar] || '').trim();
        if (!key) continue;
        const from = String(env[provider.fromVar] || '').trim();
        providers.push({ ...provider, key, from: EMAIL_RE.test(from) ? from : recipients[0] });
    }
    return providers.length ? { recipients, providers } : null;
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

/** One try with one provider. Never throws. @returns {Promise<boolean>} whether it took the mail */
async function sendWith(provider, recipients, subject, body) {
    const [url, { headers, payload }] = provider.request(provider, recipients, subject, body);
    try {
        const r = await fetch(url, {
            method: 'POST',
            headers,
            body: JSON.stringify(payload),
            signal: AbortSignal.timeout(10000),
        });
        if (r.ok) return true;
        // The provider's own words (a wrong key, an unverified sender) are what make this fixable.
        const why = (await r.text().catch(() => '')).replace(/\s+/g, ' ').slice(0, 200);
        console.warn(`Suggestion email failed: ${provider.name} answered ${r.status}${why ? ` (${why})` : ''}.`);
    } catch (err) {
        console.warn(`Suggestion email failed: ${provider.name}, ${err?.name || 'error'}.`);
    }
    return false;
}

/**
 * Email one suggestion to the operators, through the first provider that takes it.
 * Never throws: a failed email must not lose the suggestion.
 * @returns {Promise<'sent' | 'not-configured' | 'failed'>}
 */
export async function notifyOperators(env, suggestion) {
    const config = emailConfig(env);
    if (!config) {
        console.warn('Suggestion saved; no email sent (needs OPERATOR_EMAILS and BREVO_API_KEY or SENDGRID_API_KEY).');
        return 'not-configured';
    }
    const { subject, body } = suggestionEmail(suggestion);
    for (const provider of config.providers) {
        if (await sendWith(provider, config.recipients, subject, body)) return 'sent';
    }
    return 'failed';
}
