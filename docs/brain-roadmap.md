# Brain Roadmap

Each phase is a qualitative leap in capability — orders of magnitude smarter, not incremental tuning.

---

## Phase 1 — Memorization (Complete)
**Tabular Q-learning.** Memorized exact game states. Can only play states it's seen before — blind everywhere else.

- [x] Q-table mapping state→action→value
- [x] Per-state value memorization
- [x] Basic reward signal (win/loss)
- [x] Epsilon-greedy exploration

**Result:** Only covered 0.5% of ~7M possible states after 952 games. Fell back to heuristics 80% of the time. Superseded by Phase 2.

---

## Phase 2 — Generalization (Current)
**Linear function approximation.** Generalizes to unseen states via weighted feature vectors. Can evaluate any state, but only sees simple linear relationships — "close is good" or "HP advantage is good" one thing at a time.

### Core Learning
- [x] 14-feature extraction (VP, HP ratios, figure counts, closeness, attack power, round progress, activations, combat/movement flags, bias)
- [x] 15 abstract action types (attack_close, attack_ranged, move_toward, move_away, move_lateral, move_done, start_move, activate, end_activation, pass, ability, spend_surge, skip_surges, reroll, other)
- [x] Q(state, action) = dot(weights[action], features) — 210 weight parameters
- [x] TD(0) semi-gradient updates (alpha=0.01, gamma=0.95)
- [x] Weight clamping [-10, +10] to prevent divergence
- [x] Epsilon-greedy with annealing (30% → 5% over games)
- [x] Shaped reward function (VP: 10.0, damage: 0.5, HP lost: -0.5, distance: 0.1, terminal: 50.0)
- [x] Auto-migration from Phase 1 tabular format

### Training Pipeline
- [x] Single-brain training loop (`train.js`)
- [x] 6 rotating army matchups for generalization
- [x] Both players learn from shared weights
- [x] Game tracing: beforeAction → afterAction → reward computation
- [x] Deadlock detection (10+ empty actions → force damage a figure)
- [x] Failed move tracking (skip known-failed move_figure actions)
- [x] Periodic save every 10 games
- [x] CLI: `node tests/headless/train.js [numGames] [--reset]`

### Evolutionary Arena
- [x] 20-agent population with unique strategies
- [x] Per-agent reward multipliers, action preferences, epsilon
- [x] ELO-based matchmaking (K=32, 80% close matchups, 20% top-5 vs rest)
- [x] Evolution cycle every 50 games: cull bottom 4, breed 4 replacements
- [x] Mutation (strategy ±20%, army DC/CC swap by cost)
- [x] Crossover (2-parent, 50/50 per strategy key)
- [x] Champion mutation (small perturbation to top agent)
- [x] Archetype naming (aggressive/defensive/tactical/balanced + faction)
- [x] Affiliation detection (majority faction from army DCs)
- [x] Match history tracking (last 500 matches)
- [x] Evolution log with parentage/lineage

### Dashboards
- [x] Learnings viewer: weight heatmap, feature importance, action distribution pie
- [x] DC leaderboard with win rate bars (toggle top 10/25)
- [x] Affiliation win rate cards
- [x] Learned patterns display (top 12 strongest weight connections, human-readable)
- [x] Live trend charts (games vs avg|w|, updates vs avg|delta|)
- [x] Real-time polling (2s/5s/10s/paused)
- [x] Claude chat integration (Skirbo discusses training progress)
- [x] Arena viewer: ELO leaderboard, agent profiles, match history, evolution timeline
- [x] ELO trend line chart for top 5 agents

### Live Discord AI
- [x] AI turn execution (aiTakeTurn) with max steps
- [x] Self-play mode (aiSelfPlay)
- [x] Greedy state evaluator (VP + material + position scoring)
- [x] Hard-coded action priority scoring (strategy.js)
- [ ] Integration of learned weights into live Discord play
- [ ] Difficulty levels / handicap

### Replay & Recording
- [x] Frame-based game recording (record-game.js → replay-data.json)
- [x] Action log with iteration, type, player, description, errors
- [x] Replay viewer HTML (step through recorded games)
- [x] Per-DC and per-affiliation stats tracking

### Testing
- [x] Game builder fixture (tests/fixtures/game-builder.js)
- [x] Random action loop test (500 iterations, deadlock breaking)
- [x] Attack target selection test
- [x] VP kill tracking test
- [x] Phase transition tests
- [x] Combat resolution tests
- [ ] Learning convergence tests
- [ ] Arena stability tests

**Result:** 74% game completion (up from ~35-40%). Generalizes to all states. Limited to additive relationships only.

---

## Phase 3 — Reasoning (Planned)
**Nonlinear function approximation.** Captures feature interactions the linear model can't see. Understands combinations like "attack this wounded figure that's adjacent to me while I have HP advantage" — strategic situational awareness instead of isolated signals.

### Core Changes
- [ ] Feature interaction layer (capture "close + low HP = attack now")
- [ ] Small neural network (single hidden layer) OR manual feature crosses
- [ ] Nonlinear activation functions (ReLU or similar)
- [ ] Backpropagation for weight updates
- [ ] Batch normalization or feature scaling

### Training Updates
- [ ] Mini-batch updates (accumulate transitions, update in batches)
- [ ] Learning rate scheduling (decay alpha over training)
- [ ] Gradient clipping (prevent exploding gradients)

### Dashboard Updates
- [ ] Neural network weight visualization
- [ ] Hidden layer activation patterns
- [ ] Feature interaction heatmap (which combinations matter most)

**Goal:** Situational awareness — decisions depend on combinations of factors, not just individual signals.

---

## Phase 4 — Planning (Planned)
**Experience replay + look-ahead search.** Learns from past experience efficiently. Thinks multiple steps ahead instead of greedy one-step decisions.

### Experience Replay
- [ ] Replay buffer (store past state→action→reward→next_state transitions)
- [ ] Batch sampling from buffer for updates (more sample-efficient)
- [ ] Prioritized replay (revisit surprising/high-reward transitions more often)
- [ ] Buffer size management (circular buffer, evict oldest)

### Look-Ahead Search
- [ ] Game state cloning (simulate future states without mutating real game)
- [ ] Short-horizon search (2-3 ply minimax or MCTS)
- [ ] Action pruning (only search promising branches)
- [ ] Time-bounded search (cut off after N milliseconds)

### Architecture
- [ ] Deeper network (multiple hidden layers)
- [ ] Target network (stabilize learning with delayed weight copy)
- [ ] Dueling architecture (separate value and advantage streams)

### Dashboard Updates
- [ ] Search tree visualization
- [ ] Replay buffer statistics
- [ ] Planning depth vs decision quality metrics

**Goal:** Multi-step reasoning — "if I move here now, next turn I can attack from behind cover."
