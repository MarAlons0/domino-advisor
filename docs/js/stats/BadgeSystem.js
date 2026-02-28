export const BADGES = [
    { id: 'first_win',        icon: '🏆' },
    { id: 'first_cerrado',    icon: '🔒' },
    { id: 'cerrado_40',       icon: '⚡' },
    { id: 'cerrado_50',       icon: '💥' },
    { id: 'zapato',           icon: '👟' },
    { id: 'comeback',         icon: '🔥' },
    { id: 'win_streak_3',     icon: '⭐' },
    { id: 'win_streak_5',     icon: '🌟' },
    { id: 'domino_master',    icon: '🎯' },
    { id: 'cerrado_master',   icon: '🔐' },
    { id: 'genin_student',    icon: '📚' },
    { id: 'independent_mind', icon: '🧠' },
];

const BADGE_CONDITIONS = {
    first_win:        (s) => s.matches.won >= 1,
    first_cerrado:    (s) => s.cerrado.teamWon >= 1,
    cerrado_40:       (s) => s.cerrado.largestScore >= 40,
    cerrado_50:       (s) => s.cerrado.largestScore >= 50,
    zapato:           (s) => s.matches.zapatosGiven >= 1,
    comeback:         (s) => s.matches.largestDeficitOvercome >= 80,
    win_streak_3:     (s) => s.matches.bestWinStreak >= 3,
    win_streak_5:     (s) => s.matches.bestWinStreak >= 5,
    domino_master:    (s) => s.hands.byReason.domino.won >= 20,
    cerrado_master:   (s) => s.cerrado.teamWon >= 10,
    genin_student:    (s) => s.coaching.geninAgreements >= 20,
    independent_mind: (s) => s.coaching.handOverridesWon >= 5,
};

export class BadgeSystem {
    _isNew(stats, id) {
        return !stats.badges.some(b => b.id === id);
    }

    _check(stats, ids) {
        const earned = [];
        for (const id of ids) {
            if (this._isNew(stats, id) && BADGE_CONDITIONS[id] && BADGE_CONDITIONS[id](stats)) {
                stats.badges.push({ id, earnedAt: Date.now() });
                earned.push(id);
            }
        }
        return earned;
    }

    /**
     * Check for badges that can be earned after a hand result.
     * @param {object} stats - Current player stats (already updated)
     * @returns {string[]} newly earned badge IDs
     */
    checkHandBadges(stats) {
        const handIds = ['first_cerrado', 'cerrado_40', 'cerrado_50', 'domino_master', 'cerrado_master'];
        return this._check(stats, handIds);
    }

    /**
     * Check for badges that can be earned after a match result.
     * @param {object} stats - Current player stats (already updated)
     * @returns {string[]} newly earned badge IDs
     */
    checkMatchBadges(stats) {
        const matchIds = [
            'first_win', 'zapato', 'comeback',
            'win_streak_3', 'win_streak_5',
            'genin_student', 'independent_mind'
        ];
        return this._check(stats, matchIds);
    }
}
