// Human-like harness players ("personas") for BACKLOG 0h — see docs/DESIGN.md,
// 0h → "Testing against human-like opponents". Harness-only.
//
// Four layers of variation: a population of players → a player whose habits
// stay fixed across matches (identity = seed) → drift from match to match →
// noisy judgement on every move (close calls are often confused, clear
// blunders rarely), noisier after a painful hand (tilt).
//
// A persona plays seat 0, the seat the app treats as the human, so the app's
// own grading (SmartAI.analyzeHumanTurn + MatchHistory) scores it exactly as
// it scores a real player: its "agreement with Genín" is comparable to the
// Agreement Rate on the Stats page.
//
// Import after the harness has stubbed the browser globals (GameState pulls in
// i18n at load).

import { Rules } from '../docs/js/engine/Rules.js';

// Habits, in the order they get a chance to decide a move. Each is a signed
// strength w in [-1, 1]: when its situation comes up, with probability |w| the
// habit decides — its X when w > 0, the best non-X move when w < 0 — otherwise
// the next habit gets its chance, and finally the brain's own pick.
export const HABITS = ['close', 'holdBack', 'leadLongest', 'partnerSupport', 'suitLoyalty', 'doublesEarly', 'heavyFirst'];

// Placeholder population (docs/DESIGN.md): habit strength ~ N(mean, sd),
// clamped. holdBack is a mixture — most players don't do it, some do a lot.
const POPULATION = {
    close:          { mean: -0.1, sd: 0.25 },
    leadLongest:    { mean: 0.3,  sd: 0.25 },
    partnerSupport: { mean: 0.2,  sd: 0.2 },
    suitLoyalty:    { mean: 0.2,  sd: 0.2 },
    doublesEarly:   { mean: 0.2,  sd: 0.25 },
    heavyFirst:     { mean: 0.15, sd: 0.15 },
};
const HOLD_BACK_SHARE = 0.25;      // players who hold back a strong suit
// Judgement noise, in points of simulated win rate: each move is picked with
// probability ∝ exp(-(how far below the best it looks) / noise). Calibrated so
// the population's agreement with Genín brackets Mario's 73% (docs/DESIGN.md).
const NOISE_RANGE = [2, 12];
const NOISE_DRIFT_SD = 0.15;       // match-to-match, multiplicative (log scale)
const MASTER_SHARE = 0.8;          // the rest play at Experienced
const MATCH_DRIFT_SD = 0.25;       // habit drift from match to match (log scale, so 0 stays 0)
const TILT_LOSS = 30;              // losing a hand by this much tilts the next one

// mulberry32 — small seeded RNG so a persona (and its population) is reproducible.
export function makeRng(seed) {
    let a = seed >>> 0;
    return () => {
        a = (a + 0x6D2B79F5) >>> 0;
        let t = a;
        t = Math.imul(t ^ (t >>> 15), t | 1);
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

function normal(rng) {
    let u = 0;
    while (u === 0) u = rng();
    return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * rng());
}

const clamp = (x, lo, hi) => Math.max(lo, Math.min(hi, x));

/**
 * Draw one player from the population. Same seed → same player.
 * @param {number} seed
 * @param {{noise?: number}} [override] - fix the noise level (calibration runs)
 */
export function drawPersona(seed, override = {}) {
    const rng = makeRng(seed);
    const habits = {};
    for (const name of HABITS) {
        if (name === 'holdBack') {
            habits[name] = rng() < HOLD_BACK_SHARE ? 0.4 + 0.4 * rng() : 0.1 * rng();
        } else {
            const { mean, sd } = POPULATION[name];
            habits[name] = clamp(mean + sd * normal(rng), -1, 1);
        }
    }
    return {
        seed,
        brain: rng() < MASTER_SHARE ? 'master' : 'experienced',
        habits,
        noise: NOISE_RANGE[0] + (NOISE_RANGE[1] - NOISE_RANGE[0]) * rng(),
        tilt: rng(),
        ...override,
    };
}

const moveKey = (m) => `${m.tile.toKey()}|${m.end}`;
const pips = (tile) => tile.high + tile.low;

// The suit a hand is longest in (ties → more pips in that suit), with its count.
function longestSuit(tiles) {
    let best = -1, bestCount = 0, bestPips = -1;
    for (let v = 0; v <= 6; v++) {
        const inSuit = tiles.filter(t => t.hasValue(v));
        const p = inSuit.reduce((s, t) => s + pips(t), 0);
        if (inSuit.length > bestCount || (inSuit.length === bestCount && p > bestPips)) {
            best = v; bestCount = inSuit.length; bestPips = p;
        }
    }
    return { suit: best, count: bestCount };
}

// The number a move leaves showing on its end (null for the lead).
function exposedAfter(move, chain) {
    if (chain.isEmpty()) return null;
    const playedOn = move.end === 'left' ? chain.leftEnd : chain.rightEnd;
    return move.tile.isDouble() ? move.tile.high : move.tile.getOtherValue(playedOn);
}

export class PersonaPlayer {
    /**
     * @param {object} persona - from drawPersona()
     * @param {number} [seat=0] - must be the seat the app grades as human (0)
     */
    constructor(persona, seat = 0) {
        this.persona = persona;
        this.seat = seat;
        this.rng = makeRng((persona.seed ^ 0x9E3779B9) >>> 0);
        this.stats = {
            matches: 0, wins: 0, decisions: 0, lapses: 0, // lapse = noise moved it off the brain's pick
            // Hands as the app's Stats count them (a tie is played, not won), and
            // matches won while winning fewer hands than the opponents.
            hands: 0, handsWon: 0, winsOnFewerHands: 0,
            graded: 0, agreed: 0, // the app's grades: optimal + good = agreement
            // The same, split by where the move came from.
            bySource: { brain: { graded: 0, agreed: 0 }, habit: { graded: 0, agreed: 0 }, lapse: { graded: 0, agreed: 0 } },
            habit: Object.fromEntries(HABITS.map(n => [n, { seen: 0, fired: 0 }])),
        };
    }

    /** New match: bind this match's SmartAI and draw tonight's habits. */
    startMatch(ai) {
        this.ai = ai;
        // The brain plays with Genín's reward, so agreement is on the app's scale.
        ai.ismctsRewardShaping[this.seat] = 'margin';
        this.w = {};
        for (const name of HABITS) {
            this.w[name] = clamp(this.persona.habits[name] * Math.exp(MATCH_DRIFT_SD * normal(this.rng)), -1, 1);
        }
        this.noise = this.persona.noise * Math.exp(NOISE_DRIFT_SD * normal(this.rng));
        this.tilted = false;
        this.matchHands = [0, 0]; // hands won this match: [us, them]
        this.stats.matches++;
    }

    onHandEnd({ winningTeam, points }) {
        const us = this.seat % 2;
        this.stats.hands++;
        if (winningTeam === us) { this.stats.handsWon++; this.matchHands[0]++; }
        else if (winningTeam === 1 - us) this.matchHands[1]++;
        this.tilted = winningTeam === 1 - us && points >= TILT_LOSS;
    }

    /** @param {MatchHistory} history - game.getMatchHistory(), graded as in the app */
    endMatch(winnerTeam, history) {
        const s = this.stats;
        if (winnerTeam === this.seat % 2) {
            s.wins++;
            if (this.matchHands[0] < this.matchHands[1]) s.winsOnFewerHands++;
        }
        const h = history.getHumanStats();
        s.graded += h.total;
        s.agreed += h.optimal + h.good;
        // Same filter as getHumanStats: graded, non-forced plays.
        for (const hand of history.hands) {
            for (const play of hand.plays) {
                if (!play.isHuman || !play.tile || !play.evaluation || play.turnAnalysis?.forced) continue;
                const why = play.actualReasoning || '';
                const src = s.bySource[why.startsWith('Persona habit') ? 'habit' : why === 'Persona lapse' ? 'lapse' : 'brain'];
                src.graded++;
                if (play.evaluation === 'optimal' || play.evaluation === 'good') src.agreed++;
            }
        }
    }

    /** Choose this persona's move, or null to pass. */
    choose(state) {
        const { seat } = this;
        const hand = state.hands[seat];
        const chain = state.chain;
        const legal = Rules.getValidMoves(hand, chain, state.isFirstHand && chain.isEmpty());
        if (legal.length === 0) return null;
        const brainMove = this._brain(state);
        if (legal.length === 1) return brainMove;

        this.stats.decisions++;
        const ranked = this._rank(legal, brainMove, state);
        for (const name of HABITS) {
            const split = this._situation(name, ranked, state);
            if (!split) continue;
            this.stats.habit[name].seen++;
            const w = this.w[name];
            if (this.rng() >= Math.abs(w)) continue;
            this.stats.habit[name].fired++;
            const pick = (w > 0 ? split.x : split.other)[0];
            return { ...pick.move, reasoning: `Persona habit: ${name}` };
        }

        const pick = this._noisyPick(ranked, this.noise * (this.tilted ? 1 + this.persona.tilt : 1));
        if (pick === ranked[0]) return { ...pick.move, reasoning: brainMove.reasoning };
        this.stats.lapses++;
        return { ...pick.move, reasoning: 'Persona lapse' };
    }

    // Pick with probability ∝ exp((value − best) / noise). The brain's pick
    // always counts as the best (the search chose it on visits).
    _noisyPick(ranked, noise) {
        const best = Math.max(...ranked.map(e => e.value));
        const w = ranked.map((e, i) => Math.exp(((i === 0 ? best : e.value) - best) / noise));
        let r = this.rng() * w.reduce((a, b) => a + b, 0);
        for (let i = 0; i < ranked.length; i++) {
            r -= w[i];
            if (r <= 0) return ranked[i];
        }
        return ranked[ranked.length - 1];
    }

    // The brain's pick at the persona's level. Seat 0 stays Master between
    // calls — Genín grades it at Master, as in the app.
    _brain(state) {
        const saved = this.ai.difficulties[this.seat];
        this.ai.setDifficulty(this.seat, this.persona.brain);
        try {
            return this.ai.chooseMove(state, this.seat);
        } finally {
            this.ai.setDifficulty(this.seat, saved);
        }
    }

    // Legal moves best-first: the brain's pick, then by search visits when the
    // brain searched (Master), else by static score. `value` drives the noise:
    // simulated win rate in points (Master; never-visited moves sit 10 below
    // the worst visited one), or half the static score (Experienced — static
    // scores run about twice as wide).
    _rank(legal, brainMove, state) {
        const stats = (brainMove?.ismctsStats || []).filter(e => e.visits > 0);
        const visits = new Map(stats.map(e => [e.move, e.visits]));
        const winPts = new Map(stats.map(e => [e.move, 100 * e.winRate]));
        const entries = legal.map(move => ({
            move,
            key: moveKey(move),
            score: this.ai.scoreMove(move, state, this.seat).total,
        }));
        const brainKey = brainMove ? moveKey(brainMove) : null;
        entries.sort((a, b) =>
            (b.key === brainKey) - (a.key === brainKey)
            || (visits.get(b.key) || 0) - (visits.get(a.key) || 0)
            || b.score - a.score);
        const searched = winPts.size > 0;
        const floor = searched ? Math.min(...winPts.values()) - 10 : 0;
        for (const e of entries) {
            e.value = searched ? (winPts.get(e.key) ?? floor) : e.score / 2;
        }
        return entries;
    }

    // Split the ranked moves into the habit's X and the rest, or null when the
    // situation doesn't apply (or one side is empty — no choice to make).
    _situation(name, ranked, state) {
        const { seat, ai } = this;
        const chain = state.chain;
        const tiles = state.hands[seat].getTiles();
        let isX;
        switch (name) {
            case 'close':
                isX = (m) => { const c = chain.clone(); c.play(m.tile, m.end, seat); return c.isClosed(); };
                break;
            case 'holdBack': {
                // Early in the hand, sitting on 4+ of one suit: play outside it.
                const { suit, count } = longestSuit(tiles);
                if (tiles.length < 5 || count < 4) return null;
                isX = (m) => !m.tile.hasValue(suit);
                break;
            }
            case 'leadLongest': {
                if (!chain.isEmpty()) return null;
                const { suit } = longestSuit(tiles);
                isX = (m) => m.tile.hasValue(suit);
                break;
            }
            case 'partnerSupport': {
                // Partner's suit shows on exactly one end: leave it open.
                const ps = ai.signaledSuits[(seat + 2) % 4];
                if (chain.isEmpty() || ps == null || (chain.leftEnd === ps) === (chain.rightEnd === ps)) return null;
                const partnerEnd = chain.leftEnd === ps ? 'left' : 'right';
                isX = (m) => m.end !== partnerEnd;
                break;
            }
            case 'suitLoyalty': {
                const mine = ai.signaledSuits[seat];
                if (chain.isEmpty() || mine == null) return null;
                isX = (m) => exposedAfter(m, chain) === mine;
                break;
            }
            case 'doublesEarly':
                if (tiles.length < 4) return null;
                isX = (m) => m.tile.isDouble();
                break;
            case 'heavyFirst': {
                const max = Math.max(...ranked.map(e => pips(e.move.tile)));
                isX = (m) => pips(m.tile) === max;
                break;
            }
        }
        const x = ranked.filter(e => isX(e.move));
        const other = ranked.filter(e => !isX(e.move));
        return x.length && other.length ? { x, other } : null;
    }
}

/** Per-persona and population summary for --persona runs. */
export function reportPersonas(players) {
    const pct = (n, d) => (d ? `${(100 * n / d).toFixed(0)}%` : '  –');
    const f2 = (x) => (x >= 0 ? '+' : '') + x.toFixed(2);
    console.log('');
    console.log('═══════════════════════════════════════════════════════════');
    console.log(' Personas (seat 0, Master partner, vs Master opponents)');
    console.log('═══════════════════════════════════════════════════════════');
    console.log(' Habit strength → how often the habit actually decided (fired / its situations).');
    for (const pl of players) {
        const { persona: p, stats: s } = pl;
        console.log('');
        console.log(` seed ${p.seed}  ${p.brain.padEnd(11)} noise ${p.noise.toFixed(1)}  tilt ${p.tilt.toFixed(2)}` +
            `  │ agreement ${pct(s.agreed, s.graded)} (${s.graded} graded)  wins ${s.wins}/${s.matches}  hands ${pct(s.handsWon, s.hands)}` +
            `  lapses ${pct(s.lapses, s.decisions)}`);
        console.log('   ' + HABITS.map(n => `${n} ${f2(p.habits[n])}→${pct(s.habit[n].fired, s.habit[n].seen)}`).join('  '));
    }
    const sum = (k) => players.reduce((a, pl) => a + pl.stats[k], 0);
    const byBrain = (b) => players.filter(pl => pl.persona.brain === b);
    const agree = (list) => pct(list.reduce((a, pl) => a + pl.stats.agreed, 0), list.reduce((a, pl) => a + pl.stats.graded, 0));
    console.log('');
    console.log(` Population: ${players.length} personas, ${sum('matches')} matches`);
    console.log(`   Agreement with Genín: ${agree(players)} overall · master ${agree(byBrain('master'))} · experienced ${agree(byBrain('experienced'))}   (Mario: 73% over 7 matches; 4 of 7 matches, 47% of hands)`);
    const src = (k) => {
        const g = players.reduce((a, pl) => a + pl.stats.bySource[k].graded, 0);
        const a = players.reduce((x, pl) => x + pl.stats.bySource[k].agreed, 0);
        return `${k} ${pct(a, g)} of ${g}`;
    };
    console.log(`   …by where the move came from: ${src('brain')} · ${src('habit')} · ${src('lapse')}`);
    console.log(`   Persona team win rate: ${pct(sum('wins'), sum('matches'))}   Lapses: ${pct(sum('lapses'), sum('decisions'))} of decisions`);
    console.log(`   Hands won: ${pct(sum('handsWon'), sum('hands'))} of ${sum('hands')}   Matches won on fewer hands than the opponents: ${sum('winsOnFewerHands')} of ${sum('wins')} wins`);
    console.log('');
}
