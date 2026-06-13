// Information Set Monte Carlo Tree Search.
// Port of Cowling, Powley, Whitehouse 2012 — the canonical reference at
// ~/Documents/Claude-code-projects/ISMCTS-Dominoes/president/framework.py.
// Backlog item 0f. Minimum-viable implementation: no optimizations, clarity > speed.
//
// Required interface on the state object passed to ismcts():
//   playerToMove      : number — whose turn it is
//   getMoves()        : string[] — legal move keys; empty array iff terminal
//   doMove(moveKey)   : mutate state; advance playerToMove
//   cloneAndRandomize(observer) : return fresh state with hidden info resampled
//   getResult(player) : number in [0, 1] — 1 = win for player, 0 = loss, 0.5 = tie
//
// Move keys are strings (e.g. "6-4|left", "pass") so node lookup is a fast
// string compare instead of structural equality on {tile, end} objects.

class Node {
    constructor(move = null, parent = null, playerJustMoved = null) {
        this.move = move;                  // string key, or null at root
        this.parent = parent;
        this.children = [];
        this.wins = 0;
        this.visits = 0;
        this.avails = 1;                   // # times this node was *available* for selection
        this.playerJustMoved = playerJustMoved;
    }

    untriedMoves(legalMoves) {
        const tried = new Set(this.children.map(c => c.move));
        return legalMoves.filter(m => !tried.has(m));
    }

    // UCB1 over the children whose move is in the current legal set.
    // exploration default sqrt(2)/2 ≈ 0.707 per Cowling.
    ucbSelectChild(legalMoves, exploration = 0.7071) {
        const legalSet = new Set(legalMoves);
        const legalChildren = this.children.filter(c => legalSet.has(c.move));
        let best = null, bestScore = -Infinity;
        for (const c of legalChildren) {
            const score = (c.wins / c.visits) + exploration * Math.sqrt(Math.log(c.avails) / c.visits);
            if (score > bestScore) { bestScore = score; best = c; }
        }
        // Increment availability for every legally-selectable child (whether or not picked).
        for (const c of legalChildren) c.avails += 1;
        return best;
    }

    addChild(moveKey, player) {
        const child = new Node(moveKey, this, player);
        this.children.push(child);
        return child;
    }

    update(terminalState) {
        this.visits += 1;
        if (this.playerJustMoved !== null) {
            this.wins += terminalState.getResult(this.playerJustMoved);
        }
    }
}

/**
 * Run ISMCTS for `itermax` iterations and return the most-visited move at the root.
 * @param {object} rootstate   - state implementing the required interface
 * @param {number} itermax     - number of search iterations (200-1000 typical)
 * @returns {string|null}      - chosen move key, or null if no legal moves
 */
export function ismcts(rootstate, itermax) {
    const root = new Node();
    const rootMoves = rootstate.getMoves();
    if (rootMoves.length === 0) return null;
    if (rootMoves.length === 1) return rootMoves[0]; // forced move; skip the search

    for (let i = 0; i < itermax; i++) {
        let node = root;
        const state = rootstate.cloneAndRandomize(rootstate.playerToMove);

        // Select: descend the tree using UCB1 while we are at a fully-expanded
        // non-terminal node.
        let legalMoves = state.getMoves();
        while (legalMoves.length > 0 && node.untriedMoves(legalMoves).length === 0) {
            node = node.ucbSelectChild(legalMoves);
            state.doMove(node.move);
            legalMoves = state.getMoves();
        }

        // Expand: add one child for a randomly-chosen untried move.
        const untried = node.untriedMoves(legalMoves);
        if (untried.length > 0) {
            const moveKey = untried[Math.floor(Math.random() * untried.length)];
            const player = state.playerToMove;
            state.doMove(moveKey);
            node = node.addChild(moveKey, player);
        }

        // Simulate: random rollout to terminal.
        legalMoves = state.getMoves();
        while (legalMoves.length > 0) {
            const moveKey = legalMoves[Math.floor(Math.random() * legalMoves.length)];
            state.doMove(moveKey);
            legalMoves = state.getMoves();
        }

        // Backpropagate.
        let n = node;
        while (n !== null) {
            n.update(state);
            n = n.parent;
        }
    }

    // Return the most-visited child of the root.
    let best = root.children[0];
    for (const c of root.children) {
        if (c.visits > best.visits) best = c;
    }
    return best ? best.move : null;
}
