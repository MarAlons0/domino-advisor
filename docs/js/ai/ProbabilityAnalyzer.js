/**
 * ProbabilityAnalyzer - Debug tool for validating probability prediction accuracy.
 *
 * Captures probability snapshots from ALL 4 player views at each turn and
 * compares against ground truth at hand end using Brier score.
 *
 * Each view predicts the 3 players it doesn't know. This reveals whether
 * the system is symmetric (all views equally accurate) or biased.
 *
 * Activated via ?debug=ai URL parameter.
 *
 * Brier score:
 *   Perfect = 0, Uniform random ≈ 0.22
 *   Expected: starts ~0.22, decreases toward 0 as hand progresses.
 */

const VIEW_LABELS = ['You', 'Opp 1', 'Partner', 'Opp 2'];

export class ProbabilityAnalyzer {
    /**
     * @param {PlayerView[]} playerViews - All 4 player views
     */
    constructor(playerViews) {
        this.views = playerViews;
        this.snapshots = [];
        this.handNumber = 0;
        this.matchResults = [];
    }

    /**
     * Clear everything for a new match.
     */
    resetMatch() {
        this.matchResults = [];
        this.handNumber = 0;
        this.snapshots = [];
    }

    /**
     * Clear snapshots for a new hand within the same match.
     */
    reset() {
        this.snapshots = [];
        this.handNumber++;
    }

    /**
     * Capture a probability snapshot from all 4 views BEFORE a play/pass is processed.
     * @param {object} gameState - Current game state
     * @param {string} event - Description like "You: [6|6]→L" or "Opp 1: pass"
     */
    captureSnapshot(gameState, event) {
        const viewPredictions = [];

        for (let v = 0; v < 4; v++) {
            const view = this.views[v];
            const predictions = new Map();

            for (const tile of view.allTiles) {
                const key = tile.toKey();

                // Skip played tiles — known to everyone
                if (view.handTracker.knownLocations.get(key) === 'played') continue;

                // Skip this view's own tiles — trivially known
                if (view.ownTileKeys.has(key)) continue;

                // Predict probabilities for all OTHER players
                const pred = {};
                for (let p = 0; p < 4; p++) {
                    if (p === v) continue;
                    pred[p] = view.getProbability(p, tile);
                }
                predictions.set(key, pred);
            }

            viewPredictions.push(predictions);
        }

        this.snapshots.push({
            turn: this.snapshots.length + 1,
            event,
            viewPredictions
        });
    }

    /**
     * Compare all snapshots against ground truth and output accuracy tables.
     * @param {Hand[]} actualHands - Array of 4 hands (index 0-3)
     */
    analyzeAndLog(actualHands) {
        if (this.snapshots.length === 0) return;

        // Build ground truth: tileKey → playerIndex (all 4 players)
        const truth = new Map();
        for (let p = 0; p < 4; p++) {
            for (const tile of actualHands[p].getTiles()) {
                truth.set(tile.toKey(), p);
            }
        }

        // Compute Brier scores for each snapshot, broken down by view
        const rows = [];

        for (const snap of this.snapshots) {
            const perView = [];
            let totalSum = 0;
            let totalCount = 0;

            for (let v = 0; v < 4; v++) {
                let viewSum = 0;
                let viewCount = 0;

                for (const [key, pred] of snap.viewPredictions[v]) {
                    const actualHolder = truth.get(key) ?? -1;

                    for (let p = 0; p < 4; p++) {
                        if (p === v) continue;
                        const predicted = pred[p];
                        const actual = (actualHolder === p) ? 1 : 0;
                        const error = (predicted - actual) ** 2;

                        viewSum += error;
                        viewCount++;
                        totalSum += error;
                        totalCount++;
                    }
                }

                perView.push(viewCount > 0 ? viewSum / viewCount : 0);
            }

            const overall = totalCount > 0 ? totalSum / totalCount : 0;

            rows.push({
                Turn: snap.turn,
                Event: snap.event,
                Overall: overall.toFixed(3),
                'V:You': perView[0].toFixed(3),
                'V:Opp1': perView[1].toFixed(3),
                'V:Ptnr': perView[2].toFixed(3),
                'V:Opp2': perView[3].toFixed(3)
            });
        }

        // Output
        console.log(`\n=== PROBABILITY ACCURACY — Hand ${this.handNumber} ===`);
        console.log('Turn-by-Turn Brier Score (lower = better, uniform ≈ 0.22):');
        console.log('Columns = predictor view (how well each view predicts the other 3 players)');
        console.table(rows);

        // Summary
        const overalls = rows.map(r => parseFloat(r.Overall));
        const startScore = overalls[0];
        const endScore = overalls[overalls.length - 1];
        const improvement = startScore > 0 ? ((startScore - endScore) / startScore * 100).toFixed(0) : 0;
        const avgBrier = (overalls.reduce((a, b) => a + b, 0) / overalls.length).toFixed(3);

        const viewKeys = ['V:You', 'V:Opp1', 'V:Ptnr', 'V:Opp2'];
        const viewAvgs = {};
        for (const key of viewKeys) {
            const vals = rows.map(r => parseFloat(r[key]));
            viewAvgs[key] = vals.reduce((a, b) => a + b, 0) / vals.length;
        }

        const sorted = Object.entries(viewAvgs).sort((a, b) => a[1] - b[1]);

        console.log(`\nSummary:`);
        console.log(`  Start: ${startScore.toFixed(3)} → End: ${endScore.toFixed(3)} (${improvement}% improvement)`);
        console.log(`  Average Brier: ${avgBrier}`);
        console.log(`  Per-view: ${viewKeys.map(k => `${k}: ${viewAvgs[k].toFixed(3)}`).join(' | ')}`);
        console.log(`  Best view: ${sorted[0][0]} (${sorted[0][1].toFixed(3)})`);
        console.log(`  Worst view: ${sorted[sorted.length - 1][0]} (${sorted[sorted.length - 1][1].toFixed(3)})`);

        // Store for match-level summary
        this.matchResults.push({
            hand: this.handNumber,
            turns: rows.length,
            startBrier: startScore,
            endBrier: endScore,
            avgBrier: parseFloat(avgBrier),
            viewYou: viewAvgs['V:You'],
            viewOpp1: viewAvgs['V:Opp1'],
            viewPtnr: viewAvgs['V:Ptnr'],
            viewOpp2: viewAvgs['V:Opp2']
        });
    }

    /**
     * Output cross-hand match summary comparing accuracy across all hands.
     */
    logMatchSummary() {
        if (this.matchResults.length < 2) return;

        const results = this.matchResults;

        const rows = results.map(r => ({
            Hand: r.hand,
            Turns: r.turns,
            Start: r.startBrier.toFixed(3),
            End: r.endBrier.toFixed(3),
            Avg: r.avgBrier.toFixed(3),
            'V:You': r.viewYou.toFixed(3),
            'V:Opp1': r.viewOpp1.toFixed(3),
            'V:Ptnr': r.viewPtnr.toFixed(3),
            'V:Opp2': r.viewOpp2.toFixed(3)
        }));

        console.log(`\n=== MATCH PROBABILITY SUMMARY (${results.length} hands) ===`);
        console.log('Per-Hand Brier Scores (lower = better, uniform ≈ 0.22):');
        console.log('Columns = predictor view (each view predicting the other 3 players)');
        console.table(rows);

        // Cross-hand averages
        const avg = (arr) => arr.reduce((a, b) => a + b, 0) / arr.length;
        const matchAvg = avg(results.map(r => r.avgBrier));

        const viewKeys = ['V:You', 'V:Opp1', 'V:Ptnr', 'V:Opp2'];
        const propKeys = ['viewYou', 'viewOpp1', 'viewPtnr', 'viewOpp2'];
        const viewAvgs = {};
        for (let i = 0; i < 4; i++) {
            viewAvgs[viewKeys[i]] = avg(results.map(r => r[propKeys[i]]));
        }

        // Trend: first half vs second half
        const mid = Math.ceil(results.length / 2);
        const firstHalf = avg(results.slice(0, mid).map(r => r.avgBrier));
        const secondHalf = avg(results.slice(mid).map(r => r.avgBrier));
        const trendPct = firstHalf > 0 ? ((firstHalf - secondHalf) / firstHalf * 100).toFixed(0) : 0;
        const trendDir = secondHalf < firstHalf ? 'improving' : secondHalf > firstHalf ? 'worsening' : 'stable';

        // Within-hand improvement rate
        const improved = results.filter(r => r.endBrier < r.startBrier).length;

        // Symmetry check: how much do views differ?
        const viewVals = Object.values(viewAvgs);
        const viewMin = Math.min(...viewVals);
        const viewMax = Math.max(...viewVals);
        const spread = viewMax - viewMin;

        const sorted = Object.entries(viewAvgs).sort((a, b) => a[1] - b[1]);

        console.log(`\nMatch Averages:`);
        console.log(`  Overall Brier: ${matchAvg.toFixed(3)}`);
        console.log(`  Per-view: ${viewKeys.map(k => `${k}: ${viewAvgs[k].toFixed(3)}`).join(' | ')}`);
        console.log(`  Best view: ${sorted[0][0]} (${sorted[0][1].toFixed(3)})`);
        console.log(`  Worst view: ${sorted[sorted.length - 1][0]} (${sorted[sorted.length - 1][1].toFixed(3)})`);
        console.log(`  View spread: ${spread.toFixed(3)} (0 = perfectly symmetric)`);
        console.log(`\nTrends:`);
        console.log(`  First half avg: ${firstHalf.toFixed(3)} → Second half avg: ${secondHalf.toFixed(3)} (${trendDir}, ${trendPct}%)`);
        console.log(`  Within-hand improvement: ${improved}/${results.length} hands (${(improved / results.length * 100).toFixed(0)}%)`);
    }
}
