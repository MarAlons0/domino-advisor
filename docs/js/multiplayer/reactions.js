// Quick reactions at a multiplayer table: fixed choices (no free text), the same
// ids as the room server's REACTIONS. Phrases are shown in each viewer's language.
// See docs/MULTIPLAYER.md.

import { t } from '../i18n/i18n.js';

export const REACTIONS = [
    { id: 'thumbs', emoji: '👍' }, { id: 'clap', emoji: '👏' }, { id: 'laugh', emoji: '😂' },
    { id: 'wow', emoji: '😮' }, { id: 'grimace', emoji: '😬' }, { id: 'fire', emoji: '🔥' },
    { id: 'nice' }, { id: 'lucky' }, { id: 'yourMove' }, { id: 'wellPlayed' }, { id: 'ouch' }, { id: 'toldYou' },
];

/** What a reaction shows: its emoji, or its phrase in the current language. */
export function reactionText(id) {
    const r = REACTIONS.find(x => x.id === id);
    if (!r) return null;
    return r.emoji || t(`reaction.${r.id}`);
}
