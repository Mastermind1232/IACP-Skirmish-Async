# IACP Skirmish — Python Migration Plan

**Goal:** consolidate to a single Python codebase that drives the
Discord game and trains the AI. Delete JS once Python is provably
equal-or-better.

**Constraint:** no real users yet — no backwards-compat, no live-game
risk, no "parallel run for weeks." Build it right from the start.

**Scope:** ~30,000 LOC of JS handler/engine logic + ~7,000 LOC of
Discord-layer rendering. Roughly 20 source files.

**Current baseline (committed today):**
- 0 drift crashes / ~7.4k cosmetic drift diffs (state-shape from atomic combat)
- 293/293 CC parity verified (0 fail)
- 333/333 DC ability parity verified (0 fail)
- Pattern C: 52/52 portable abilities wired
- 3,973 jest tests green
- 1,506 pytest oracle tests green

---

## Architectural decision

**Python as the single source of truth.**

- Engine runs synchronously inside Python (no Discord-async pauses).
- For Discord, Python uses `discord.py` (or `pycord`) — mature, async-native.
- For AI training, the same engine runs at full speed (no UI overhead).
- Combat **becomes a state machine** — multi-step combat resolution via
  pendingCombat phase transitions, mirroring JS's shape exactly. This is
  required for Discord (asynchronous user input) and harmless for AI
  (which drives all phases atomically in one tick).

---

## Phase 1 — Engine completeness (Python becomes correct)

**Outcome:** Python's engine matches JS step-by-step. Drift report
goes from ~7.4k diffs to ≤100 (residual mission/edge-case work).

### 1.1 Combat state machine

Split atomic `_handle_attack_target` into:
- **`attack_target`**: declare-only. Validates LOS/adjacency, opens
  `pendingCombat` with attacker/target/dice/bonuses. Does NOT roll.
- **`combat_ready`**: both-player ready gate (already partial — extend
  for full parity).
- **`combat_roll`**: rolls attack + defense dice via DiceStream
  (threaded from action params or a game-attached provider). Stores
  `attackDiceResults`, `defenseDiceResults`, `attackRoll`, `defenseRoll`.
- **`combat_surge`**: each surge spend updates `surgeRemaining`,
  `triggeredSurges`. Multi-call until done.
- **`combat_reroll`**: reroll specific dice indices. Updates
  `attackerRerolledIndices` / `defenderRerolledIndices`.
- **`combat_resolve`**: applies damage, fires post-attack triggers,
  clears `pendingCombat`.

DiceStream gets threaded into replay harness so JS-recorded dice
reproduce identically in Python. AI/MCTS uses local RNG.

**Validation:** drift's `pendingCombat`, `attackDiceResults`,
`combatGate`, `attackerRerolls*` diffs go to ~0.

### 1.2 Port `src/handlers/dc-play-area.js` (3,698 LOC)

UI-driven action handlers. Each is a small phase trigger:
- `dc_move_`: open movement state, grant speed MP
- `dc_attack_`: route to `attack_target` declare phase
- `dc_special_`: route to `dc_special` (already in Python — extend)
- `dc_interact_`: open interact phase
- `dc_spend_mp_`: SpendMp action (strain → MP)

Output: `python/engine/handlers/dc_play_area.py`. Each function pure
state mutation, no Discord IO.

### 1.3 Port `src/engine/combat-bridge.js` (2,930 LOC)

Mid-attack state machine plumbing:
- Phase transitions (`reroll_window` → `surge_phase` → `token_phase` → `resolve`)
- Forced reroll queue processing
- Pre-reroll abilities (Resourceful, Trained Rancor, Twin Sabers)
- Post-attack triggers (already partial in Python's
  `attack_orchestrator` — extend)
- Post-defeat hooks (Hunt Dissent, Way Armorer — already wired)

Output: `python/engine/combat_bridge.py`.

### 1.4 Port `src/handlers/post-deploy.js` (1,871 LOC)

Hooks between deployment and round 1:
- Lie in Ambush trigger
- Loadout reveal prompts (Imperial Loadout)
- Mission-start mission rules (Random Reveal, etc.)
- Companion deployment

Output: `python/engine/handlers/post_deploy.py`.

### 1.5 Port `src/handlers/cc-hand.js` (1,721 LOC)

CC play flow beyond schema-driven effects:
- CC interrupt windows (between dice rolls, on figure-defeated)
- CC choice prompts (chooseAdjacentHostileThen, etc.)
- CC multi-target picks
- CC discard handling

Output: `python/engine/handlers/cc_hand.py`.

### 1.6 Validation

- Drift report: `npm run drift` (or python equivalent) shows ≤100 diffs
- All 293 CC parity 0 fail
- All 333 DC ability parity 0 fail
- Existing 3,973 jest tests still green during dual-run

---

## Phase 2 — Engine flow + remaining handlers

**Outcome:** Python can drive a full game from squad submit → game over,
end-to-end, without any JS engine code.

### 2.1 Port `src/handlers/setup.js` UI flow (2,604 LOC)

Pure helpers already in `python/engine/setup.py`. Add the UI handlers:
- `handleMapSelection`, `handleMapTypeChoice`, `handleMapConfirm`
- `handleDetermineInitiative`
- `handleDeploymentZone`, `handleDeploymentFig`, `handleDeployRow`,
  `handleDeployPick`
- `handleAutoDeploy`
- `handleSetupAttachTo`, `handleAttachConfirm`, `handleAttachReselect`
- `handleLoadoutSelect`, `handleLoadoutConfirm`
- `handleFormPick`
- `handleDeploymentDone`

Output: `python/engine/handlers/setup.py`.

### 2.2 Port `src/handlers/round.js` (2,154 LOC)

Round flow:
- `handle_end_end_of_round` (extend Python's existing partial)
- `handle_end_start_of_round`
- Mission start-of-round rules (per-map: Devaron doors, Atollon Krykna,
  Anchorhead random reveal, etc.)
- `runStatusPhaseAfterEndOfRound` (full port — currently atomic in Python)

Output: `python/engine/handlers/round.py`.

### 2.3 Port `src/handlers/activation.js` (2,460 LOC)

Activation flow:
- `handle_status_phase` (full UI flow, not just engine state)
- `handle_pass_activation_turn`
- `handle_end_turn`
- `handle_dc_end_activation` (full UI version with thread teardown,
  post-activation effects)
- `handle_confirm_activate`, `handle_cancel_activate`
- Activation-time prompts (Force Vision, Heroic Effort, Scav Weapon,
  etc.)

Output: `python/engine/handlers/activation.py`.

### 2.4 Port `src/handlers/interrupts.js` (1,065 LOC)

Movement interrupts (Parting Blow, Dirty Trick, Disengage, Overwatch).
Detection already in Python. Port the resolution/UI flow.

Output: `python/engine/handlers/interrupts.py`.

### 2.5 Port `src/engine/available-actions.js` (2,394 LOC)

JS's enumerator for "what can each player do right now". Already
partial in `python/mcts/actions.py` (legal_actions). Port remaining
button-emitting paths so Python can drive Discord rendering.

Output: extend `python/engine/available_actions.py`.

### 2.6 Port `src/game/abilities.js` (9,798 LOC)

Largest single JS file. Some logic already in Python's pattern_e/d
handlers. Consolidate and complete:
- Push/pull/displacement
- Area-effect resolution
- Ability dispatch helpers
- Target enumeration

Output: extend `python/engine/abilities/*` modules.

### 2.7 Port remaining handlers (~5,800 LOC)

- `combat-reactions.js` (910)
- `recover.js` (839)
- `blitz-deploy.js` (712)
- `favorites.js` (664) — UI sugar, low priority
- `game-tools.js` (504) — UI sugar, low priority
- `fast-forward.js` (468) — UI sugar, low priority
- `map-events.js` (410)
- `post-combat.js` (332)
- `combat-special-effects.js` (1,192)
- `defeat-handler.js` (321) — already partial in attack_orchestrator

### 2.8 Validation

Run drift on all 43 recorded games. Target: 0 diffs across all 81
action types. Mission rules verified per-map.

---

## Phase 3 — Discord layer + cutover

**Outcome:** Python drives Discord. JS deleted.

### 3.1 Discord library setup

Choose: `discord.py` (battle-tested, large community) vs `pycord`
(maintained fork). Likely `discord.py`.

- Bot setup, slash commands
- Button rendering (`discord.ui.Button`)
- Embed builders (`discord.Embed`)
- Channel/thread management
- Image attachments
- Welcome/help flows

Output: `python/discord/` directory.

### 3.2 Port the Discord-side rendering

JS files that render to Discord:
- `src/discord/messages.js` — embed templates
- `src/discord/action-buttons.js` — button generators
- `src/rendering.js` — top-level render orchestration
- `src/embed-builders.js`
- `src/event-log.js` — game-log channel writer

Most of these are pure templating. Translate Discord.js → discord.py
APIs (mostly direct equivalents).

### 3.3 Game lifecycle in Python

Wire engine + Discord layer:
- `/newgame` slash command spawns a game
- Setup flow runs through Discord buttons (calls Python engine)
- Round flow runs through Discord buttons (calls Python engine)
- AI brain plugs into self-play games (already does — unchanged)

### 3.4 Test infrastructure

- Headless harness (already exists — adapt to Python-only)
- Recorder: drift recordings now produced by Python, not JS
- Full-game oracle: Python plays itself end-to-end, validated against
  recorded reference games

### 3.5 Cutover

Cutover criteria (all must pass):
- All 43 drift recordings: 0 diffs
- All 8 missions: full Python game completes without error
- AI brain plays full self-play games via Python
- Performance: Python game tick ≤ JS equivalent
- Test coverage: oracle suite ≥ JS test coverage

### 3.6 JS deletion

Once cutover passes:
- Delete `src/` (JS engine + handlers)
- Delete `tests/headless/` (JS test suite)
- Keep `data/` (shared JSON — DC effects, CC effects, mission cards,
  map spaces, ability library)
- Update `package.json` to remove JS deps
- Repository becomes Python-primary

---

## Effort estimate

**Phase 1: Engine completeness — ~6 weeks of focused engineering**
- 1.1 State machine combat: 1 week
- 1.2 dc-play-area port: 1 week
- 1.3 combat-bridge port: 1 week
- 1.4 post-deploy port: 4 days
- 1.5 cc-hand port: 4 days
- 1.6 Validation + bug-fixing: 1 week

**Phase 2: Flow + handlers — ~8 weeks**
- 2.1 setup.js UI: 1 week
- 2.2 round.js: 1 week
- 2.3 activation.js: 1 week
- 2.4 interrupts.js: 3 days
- 2.5 available-actions.js: 1 week
- 2.6 abilities.js (largest): 2 weeks
- 2.7 remaining handlers: 1 week

**Phase 3: Discord layer + cutover — ~4 weeks**
- 3.1 discord.py setup: 3 days
- 3.2 Rendering port: 1 week
- 3.3 Game lifecycle: 1 week
- 3.4 Test infrastructure: 4 days
- 3.5 Cutover validation: 1 week
- 3.6 JS deletion: 1 day

**Total: ~18 weeks (4-5 months) of focused work.**

---

## Order of execution

1. **Combat state machine first** (Phase 1.1) — unlocks everything else
2. **dc-play-area + combat-bridge** (Phase 1.2 + 1.3) together — paired ports
3. **Validation gate**: drift goes to ≤100 diffs before continuing
4. **post-deploy + cc-hand** (Phase 1.4 + 1.5) — independent
5. **setup.js, round.js, activation.js** (Phase 2.1-2.3) — round flow
6. **available-actions** (Phase 2.5) — required for Discord rendering
7. **abilities.js consolidation** (Phase 2.6)
8. **Remaining handlers** (Phase 2.7) — many independent, parallelizable
9. **Discord layer** (Phase 3.1-3.3)
10. **Cutover + delete** (Phase 3.5-3.6)

Each phase commits incrementally. Tests stay green throughout.
