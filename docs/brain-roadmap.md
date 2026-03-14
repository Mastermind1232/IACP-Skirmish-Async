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

## Phase 2 — Generalization (Complete)
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

**Result:** 74% game completion (up from ~35-40%). Generalizes to all states. Limited to additive relationships only. Superseded by Phase 3.

---

## Phase 3 — Reasoning (Complete)
**Nonlinear function approximation.** Captures feature interactions the linear model can't see. Understands combinations like "attack this wounded figure that's adjacent to me while I have HP advantage" — strategic situational awareness instead of isolated signals.

### Core Changes
- [x] Dueling neural network architecture (separate value V and advantage A heads)
- [x] Hidden layer: 32 neurons with ReLU activation
- [x] He/Xavier weight initialization
- [x] Full manual backpropagation with dueling gradients
- [x] NaN safety: `sanitizeNetwork()` resets non-finite weights

### Training Updates
- [x] TD error clipping (DELTA_CLAMP = 1.0)
- [x] TD error history sampling (every 100 updates)

### Dashboard Updates
- [x] Feature importance visualization (weighted through hidden + output layers)
- [x] Learned patterns display

**Result:** Situational awareness — decisions depend on combinations of factors, not just individual signals. Superseded by Phase 4.

---

## Phase 4 — Sample Efficiency (Complete)
**Experience replay + target network.** Learns from past experience efficiently. Stabilizes training with delayed weight copies.

### Experience Replay
- [x] Ring buffer: 10,000 transitions (REPLAY_BUFFER_SIZE)
- [x] Batch sampling: 32 transitions per mini-batch (REPLAY_BATCH_SIZE)
- [x] 4 replay updates per game (REPLAY_UPDATES_PER_GAME)
- [x] Minimum 256 transitions before replay starts (REPLAY_MIN_SIZE)
- [x] Replay learning rate: 0.001 (half of online alpha)
- [x] Separate persistence for replay buffer

### Architecture
- [x] Target network with deep copy
- [x] Target sync every 500 updates (TARGET_UPDATE_INTERVAL)
- [x] Target sync tracking in training stats

### Not Implemented
- [ ] Look-ahead search (MCTS / minimax) — deferred, may revisit in Phase 6
- [ ] Action pruning / time-bounded search
- [ ] Search tree visualization

**Result:** Much more stable and sample-efficient training. Plateaued because tactical imprecision inside action categories was losing games. Superseded by Phase 5.

---

## Phase 5 — Tactical Precision (Current)
**Within-group scorers.** The main brain picks the right action *type* (attack, move, surge, CC). Phase 5 picks the right *specific option* within that type. Lightweight learned linear scorers layered on top of the existing brain.

Phase 5 teaches Skirbo to stop being sloppy.

### Attack Scorer (6 features)
- [x] targetHpRatio — how wounded the target is
- [x] targetDistNorm — distance from attacker to target
- [x] targetIsolated — fewer adjacent allies = more isolated
- [x] targetThreat — how dangerous the target DC is
- [x] killPotential — can this attacker finish it off?
- [x] bias

### Move Scorer (6 features)
- [x] distToNearestEnemy — closer to enemy = higher
- [x] threatAtDest — expected damage from enemies at destination
- [x] objectiveProximity — distance to mission objectives/terminals
- [x] allySupport — friendly figures within 3 spaces
- [x] mpEfficiency — movement cost relative to total MP
- [x] bias

### Surge Scorer (4 features)
- [x] damageValue — total offensive output
- [x] isAccuracy — does this surge add accuracy?
- [x] isRecover — does this surge recover health?
- [x] bias

### CC Scorer (4 features)
- [x] ccCost — cost of the command card
- [x] isAttachment — persistent vs one-shot
- [x] inCombat — active combat status
- [x] bias

### Learning
- [x] Within-group weight updates (ALPHA_WG = 0.01)
- [x] Delta-based learning from TD signal

### Open Items
- [ ] More training games for move/surge/CC scorers to become strongly opinionated
- [ ] Integration of learned weights into live Discord play
- [ ] Difficulty levels / handicap

**Result:** Initially masked by engine bugs causing a fake ~55% completion ceiling. After structural bug fixes, completion jumped to high 80s/90s. Slices 3+4 pushed to ~98.5% completion. Attack scorer shows meaningful signal; move/surge/CC scorers working but need more games.

---

## Phase 6 — Strategic Understanding (Planned)
**Strategic state understanding + certification-grade confidence.** Moves from "good local choices" to "good game plans." Not just better micro — better global reasoning, consistency, and knowledge of special cases.

Phase 6 teaches Skirbo to actually think ahead.

### 1. Strategic Features
- [ ] Activation tempo awareness (when to hold vs activate)
- [ ] Initiative leverage understanding
- [ ] VP race state evaluation
- [ ] Mission pressure sensing
- [ ] Figure preservation vs trade-off calculus
- [ ] Attack exposure risk assessment (is attacking worth the positional cost?)

### 2. Matchup / Card-Pool Awareness
- [ ] DC identity recognition (specific card strengths/weaknesses)
- [ ] Key synergy detection between cards
- [ ] Army archetype adaptation (aggressive vs defensive vs control)

### 3. Timing / Pending State Reasoning
- [ ] Interrupt anticipation
- [ ] Negation window valuation
- [ ] Reaction effect sequencing
- [ ] "If I do X, it opens response Y" reasoning

### 4. Engine Maturity (Certification)
- [ ] Rules fidelity across all cards/interactions
- [ ] Data correctness for all DCs, CCs, abilities
- [ ] No deadlocks or silent illegal states
- [ ] Runtime correctness under all edge cases

**Goal:** Strategic depth — values tempo, sequencing, matchup context, and mission pressure. Handles card/timing nuance. Moves from "good local choices" toward "good game plans." Partly AI advancement, partly engine maturity — because brain quality depends on rules fidelity.
