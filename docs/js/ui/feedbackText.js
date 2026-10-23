// Turns a HandFeedback result ({outcome, verdict, moment}) into display text.
// Shared by the hand-end card (main.js) and the debrief's hand-by-hand recap.
//
// Moment args may be nested i18n references — { i18n: key, args: [...] } — so
// phrases like the lead ("You opened with" / "On your play 3 you played") and
// the strategic reason resolve in the CURRENT language at render time.

import { t } from '../i18n/i18n.js';

function resolveArg(arg) {
    if (arg && typeof arg === 'object' && arg.i18n) {
        return t(arg.i18n, ...(arg.args || []).map(resolveArg));
    }
    return arg;
}

/**
 * @param {{outcome:{result:string, margin:number}, verdict:{key:string, args:Array}, moment:{key:string, args:Array}|null}} fb
 * @returns {{outcome:string, verdict:string, detail:string|null}}
 */
export function feedbackTexts(fb) {
    const outKey = `coach.outcome.${fb.outcome.result}`;
    const outcome = fb.outcome.result === 'tie' ? t(outKey) : t(outKey, fb.outcome.margin);
    const verdict = t(fb.verdict.key, ...(fb.verdict.args || []).map(resolveArg));
    const detail = fb.moment ? t(fb.moment.key, ...fb.moment.args.map(resolveArg)) : null;
    return { outcome, verdict, detail };
}
