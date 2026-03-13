# Brain Roadmap

Each phase is a qualitative leap in capability — orders of magnitude smarter, not incremental tuning.

## Phase 1 — Memorization (Complete)
**Tabular Q-learning.** Memorized exact game states. Only covered 0.5% of ~7M possible states after 952 games, falling back to heuristics 80% of the time. Can only play states it's seen before — blind everywhere else.

- Key files: (replaced by Phase 2)
- Status: Superseded

## Phase 2 — Generalization (Current)
**Linear function approximation.** 14 features x 15 action types = 210 weight parameters. Generalizes to unseen states via weighted feature vectors. Can evaluate any state, but only sees simple linear relationships — "close is good" or "HP advantage is good" one thing at a time.

- TD(0) with alpha=0.01, gamma=0.95, weight clamp [-10, +10]
- Epsilon-greedy: decays from 30% to 5% exploration
- 74% game completion rate (up from ~35-40%)
- Key files: `tests/headless/learnings.js`, `tests/headless/train.js`
- Evolutionary arena: 20-agent population with ELO, mutation, crossover (`tests/headless/arena-train.js`)
- Dashboards: `tests/headless/learnings-viewer.html`, `tests/headless/arena-viewer.html`
- Status: Production

## Phase 3 — Reasoning (Planned)
**Nonlinear function approximation (feature interactions).** Small neural network or feature crosses to capture combinations the linear model can't see. Understands situations like "attack this wounded figure that's adjacent to me while I have HP advantage" — strategic situational awareness instead of isolated signals.

- Linear model limitation: only additive weights, can't learn interactions (e.g., "close + low HP = attack")
- Approach: single hidden layer neural net or manual feature crosses
- Still lightweight, but dramatically more expressive
- Status: Not started

## Phase 4 — Planning (Planned)
**Experience replay + look-ahead.** Stores past game transitions in a replay buffer and learns from batches of past experience rather than just the current game. Thinks ahead: "if I move here now, next turn I can attack from behind cover" — multi-step reasoning instead of greedy one-step decisions.

- Replay buffer for sample efficiency (learn more from fewer games)
- Prioritized replay (revisit surprising/high-reward transitions more often)
- Short-horizon look-ahead search (minimax or MCTS) at decision time
- Deeper network architecture
- Status: Not started
