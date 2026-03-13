# Phase 4: Atomic Task Decomposition

Every task is a single file create/modify + verify. No task depends on a later task.
Dependencies flow strictly top-to-bottom within each sub-phase; cross-phase deps noted.

Legend: `[NEW]` = new file, `[MOD]` = modify existing, `[TEST]` = test file, `[VERIFY]` = check command

---

## PHASE 4.1: Event Store Foundation

### 4.1.1 — Create `src/domain/` directory
- `[VERIFY]` mkdir -p src/domain

### 4.1.2 — Create `createDomainEvent` function
- `[NEW]` `src/domain/events.js`
- Write `createDomainEvent(type, gameId, playerId, payload, meta)` — returns `{ type, gameId, seq, timestamp, playerId, correlationId, aggregateVersion, payload }`
- Write in-memory `seqCounters` Map (gameId → next seq)
- `[VERIFY]` `node --check src/domain/events.js`

### 4.1.3 — Create `resetSeqCounter` and `getSeqCounter` helpers
- `[MOD]` `src/domain/events.js`
- Add `resetSeqCounter(gameId, startSeq)` — sets counter
- Add `getSeqCounter(gameId)` — reads counter
- Export both
- `[VERIFY]` `node --check src/domain/events.js`

> Note: 4.1.2 + 4.1.3 can be done in one pass if preferred; separated for atomicity.

### 4.1.4 — Test: `createDomainEvent` returns all required fields
- `[NEW]` `tests/domain/events.test.js`
- Single test: call `createDomainEvent`, assert all 8 fields present and correct types
- `[VERIFY]` `node --test tests/domain/events.test.js`

### 4.1.5 — Test: seq auto-increments per gameId
- `[MOD]` `tests/domain/events.test.js`
- Add test: two events for same gameId → seq 1, 2
- `[VERIFY]` `node --test tests/domain/events.test.js`

### 4.1.6 — Test: independent seq counters per gameId
- `[MOD]` `tests/domain/events.test.js`
- Add test: events for gameId "A" and "B" → each starts at seq 1
- `[VERIFY]` `node --test tests/domain/events.test.js`

### 4.1.7 — Test: `resetSeqCounter` works
- `[MOD]` `tests/domain/events.test.js`
- Add test: create 3 events, reset to 10, next event has seq 11
- `[VERIFY]` `node --test tests/domain/events.test.js`

### 4.1.8 — Test: payload preserved exactly
- `[MOD]` `tests/domain/events.test.js`
- Add test: pass complex payload object, assert deep equality on `.payload`
- `[VERIFY]` `node --test tests/domain/events.test.js`

### 4.1.9 — Create `domain_events` table SQL in `initDb()`
- `[MOD]` `src/db.js`
- Add `CREATE TABLE IF NOT EXISTS domain_events (id SERIAL PRIMARY KEY, game_id TEXT NOT NULL, seq INT NOT NULL, type TEXT NOT NULL, correlation_id TEXT, player_id TEXT, aggregate_version INT NOT NULL, timestamp TIMESTAMPTZ DEFAULT NOW(), payload JSONB NOT NULL, UNIQUE(game_id, seq))`
- `[VERIFY]` `node --check src/db.js`

### 4.1.10 — Create `domain_events` indexes in `initDb()`
- `[MOD]` `src/db.js`
- Add `CREATE INDEX IF NOT EXISTS idx_domain_events_game_seq ON domain_events (game_id, seq)`
- Add `CREATE INDEX IF NOT EXISTS idx_domain_events_game_type ON domain_events (game_id, type)`
- `[VERIFY]` `node --check src/db.js`

### 4.1.11 — Add `insertDomainEvent(gameId, event)` query function
- `[MOD]` `src/db.js`
- INSERT into domain_events with all event fields
- `[VERIFY]` `node --check src/db.js`

### 4.1.12 — Add `getDomainEvents(gameId, afterSeq, limit)` query function
- `[MOD]` `src/db.js`
- SELECT from domain_events WHERE game_id = $1 AND seq > $2 ORDER BY seq LIMIT $3
- `[VERIFY]` `node --check src/db.js`

### 4.1.13 — Add `getLatestDomainSeq(gameId)` query function
- `[MOD]` `src/db.js`
- SELECT MAX(seq) FROM domain_events WHERE game_id = $1
- Return 0 if null
- `[VERIFY]` `node --check src/db.js`

### 4.1.14 — Create `appendEvents` function
- `[NEW]` `src/domain/event-store.js`
- Import `insertDomainEvent`, `getLatestDomainSeq` from `../db.js`
- `appendEvents(gameId, events, expectedVersion)` — if expectedVersion provided, check DB max seq matches, throw on mismatch; then insert each event
- `[VERIFY]` `node --check src/domain/event-store.js`

### 4.1.15 — Create `getEvents` function
- `[MOD]` `src/domain/event-store.js`
- `getEvents(gameId, { afterSeq, limit })` — wraps `getDomainEvents`
- `[VERIFY]` `node --check src/domain/event-store.js`

### 4.1.16 — Create `getLatestSeq` function
- `[MOD]` `src/domain/event-store.js`
- `getLatestSeq(gameId)` — wraps `getLatestDomainSeq`
- `[VERIFY]` `node --check src/domain/event-store.js`

### 4.1.17 — Create `getAllEventsSince` function
- `[MOD]` `src/domain/event-store.js`
- `getAllEventsSince(gameId, seq)` — wraps `getDomainEvents` with limit 10000
- `[VERIFY]` `node --check src/domain/event-store.js`

### 4.1.18 — Test: `appendEvents` stores events
- `[NEW]` `tests/domain/event-store.test.js`
- Stub `insertDomainEvent`, call `appendEvents`, verify stub called with each event
- `[VERIFY]` `node --test tests/domain/event-store.test.js`

### 4.1.19 — Test: `getEvents` retrieves in order
- `[MOD]` `tests/domain/event-store.test.js`
- Stub `getDomainEvents`, verify called with correct args
- `[VERIFY]` `node --test tests/domain/event-store.test.js`

### 4.1.20 — Test: `getLatestSeq` returns correct value
- `[MOD]` `tests/domain/event-store.test.js`
- Stub `getLatestDomainSeq`, verify return
- `[VERIFY]` `node --test tests/domain/event-store.test.js`

### 4.1.21 — Test: optimistic concurrency rejects stale writes
- `[MOD]` `tests/domain/event-store.test.js`
- Stub `getLatestDomainSeq` → returns 5, call `appendEvents` with expectedVersion=3 → assert throws
- `[VERIFY]` `node --test tests/domain/event-store.test.js`

### 4.1.22 — Create `game_snapshots` table SQL in `initDb()`
- `[MOD]` `src/db.js`
- Add `CREATE TABLE IF NOT EXISTS game_snapshots (id SERIAL PRIMARY KEY, game_id TEXT NOT NULL, version INT NOT NULL, state JSONB NOT NULL, created_at TIMESTAMPTZ DEFAULT NOW(), UNIQUE(game_id, version))`
- Add `CREATE INDEX IF NOT EXISTS idx_game_snapshots_game ON game_snapshots (game_id, version DESC)`
- `[VERIFY]` `node --check src/db.js`

### 4.1.23 — Add `insertSnapshot(gameId, version, state)` query function
- `[MOD]` `src/db.js`
- INSERT into game_snapshots
- `[VERIFY]` `node --check src/db.js`

### 4.1.24 — Add `getLatestSnapshot(gameId)` query function
- `[MOD]` `src/db.js`
- SELECT version, state FROM game_snapshots WHERE game_id = $1 ORDER BY version DESC LIMIT 1
- `[VERIFY]` `node --check src/db.js`

### 4.1.25 — Add `deleteSnapshots(gameId)` query function
- `[MOD]` `src/db.js`
- DELETE FROM game_snapshots WHERE game_id = $1
- `[VERIFY]` `node --check src/db.js`

### 4.1.26 — Create `saveSnapshot` function
- `[NEW]` `src/domain/snapshot-store.js`
- Import `insertSnapshot` from `../db.js`
- `saveSnapshot(gameId, version, state)` — deep clone, strip `undoStack` and `moveGridMessageIds`, call `insertSnapshot`
- Export `SNAPSHOT_INTERVAL = 50`
- `[VERIFY]` `node --check src/domain/snapshot-store.js`

### 4.1.27 — Create `loadLatestSnapshot` function
- `[MOD]` `src/domain/snapshot-store.js`
- `loadLatestSnapshot(gameId)` — wraps `dbGetLatestSnapshot`, returns `{ version, state }` or null
- `[VERIFY]` `node --check src/domain/snapshot-store.js`

### 4.1.28 — Create `deleteSnapshots` function
- `[MOD]` `src/domain/snapshot-store.js`
- `deleteSnapshots(gameId)` — wraps `dbDeleteSnapshots`
- `[VERIFY]` `node --check src/domain/snapshot-store.js`

### 4.1.29 — Create `shouldSnapshot` function
- `[MOD]` `src/domain/snapshot-store.js`
- `shouldSnapshot(version)` — returns `version > 0 && version % SNAPSHOT_INTERVAL === 0`
- `[VERIFY]` `node --check src/domain/snapshot-store.js`

### 4.1.30 — Test: `saveSnapshot` strips transient fields
- `[NEW]` `tests/domain/snapshot-store.test.js`
- Stub `insertSnapshot`, call `saveSnapshot` with state containing `undoStack` and `moveGridMessageIds`, verify stripped in stub call
- `[VERIFY]` `node --test tests/domain/snapshot-store.test.js`

### 4.1.31 — Test: `loadLatestSnapshot` returns null when none exists
- `[MOD]` `tests/domain/snapshot-store.test.js`
- Stub `dbGetLatestSnapshot` → null, verify return null
- `[VERIFY]` `node --test tests/domain/snapshot-store.test.js`

### 4.1.32 — Test: `shouldSnapshot` returns true at intervals
- `[MOD]` `tests/domain/snapshot-store.test.js`
- Assert: `shouldSnapshot(0)` false, `shouldSnapshot(50)` true, `shouldSnapshot(51)` false, `shouldSnapshot(100)` true
- `[VERIFY]` `node --test tests/domain/snapshot-store.test.js`

### 4.1.33 — Create `GameAggregate` constructor
- `[NEW]` `src/domain/game-aggregate.js`
- Import `createDomainEvent` from `./events.js`
- `class GameAggregate { constructor(gameId, state, version) }` — sets fields + `uncommittedEvents = []`
- `[VERIFY]` `node --check src/domain/game-aggregate.js`

### 4.1.34 — Add `GameAggregate.reconstitute` static method
- `[MOD]` `src/domain/game-aggregate.js`
- `static reconstitute(gameId, snapshot, events, reducer)` — replays events through reducer from snapshot, returns new GameAggregate
- `[VERIFY]` `node --check src/domain/game-aggregate.js`

### 4.1.35 — Add `GameAggregate.applyEvent` method
- `[MOD]` `src/domain/game-aggregate.js`
- `applyEvent(event, reducer)` — applies reducer, updates version
- `[VERIFY]` `node --check src/domain/game-aggregate.js`

### 4.1.36 — Add `GameAggregate.recordEvent` method
- `[MOD]` `src/domain/game-aggregate.js`
- `recordEvent(type, playerId, payload)` — creates domain event with auto-incrementing aggregateVersion, pushes to uncommittedEvents
- `[VERIFY]` `node --check src/domain/game-aggregate.js`

### 4.1.37 — Add `GameAggregate.flushEvents` method
- `[MOD]` `src/domain/game-aggregate.js`
- `flushEvents()` — returns and clears uncommittedEvents array
- `[VERIFY]` `node --check src/domain/game-aggregate.js`

### 4.1.38 — Add `GameAggregate` getters
- `[MOD]` `src/domain/game-aggregate.js`
- `getState()`, `getVersion()` — simple getters
- `[VERIFY]` `node --check src/domain/game-aggregate.js`

### 4.1.39 — Test: GameAggregate constructor sets fields
- `[NEW]` `tests/domain/game-aggregate.test.js`
- `[VERIFY]` `node --test tests/domain/game-aggregate.test.js`

### 4.1.40 — Test: `recordEvent` adds to uncommittedEvents with auto-increment version
- `[MOD]` `tests/domain/game-aggregate.test.js`
- `[VERIFY]` `node --test tests/domain/game-aggregate.test.js`

### 4.1.41 — Test: `flushEvents` returns and clears
- `[MOD]` `tests/domain/game-aggregate.test.js`
- `[VERIFY]` `node --test tests/domain/game-aggregate.test.js`

### 4.1.42 — Test: `reconstitute` replays events through reducer
- `[MOD]` `tests/domain/game-aggregate.test.js`
- Use trivial reducer `(state, event) => ({ ...state, [event.type]: true })`
- `[VERIFY]` `node --test tests/domain/game-aggregate.test.js`

### 4.1.43 — Test: `applyEvent` updates state and version
- `[MOD]` `tests/domain/game-aggregate.test.js`
- `[VERIFY]` `node --test tests/domain/game-aggregate.test.js`

### 4.1.44 — Create `GameRepository` constructor
- `[NEW]` `src/domain/game-repository.js`
- Import GameAggregate, event-store, snapshot-store
- `class GameRepository { constructor(reducer) }` — stores reducer
- `[VERIFY]` `node --check src/domain/game-repository.js`

### 4.1.45 — Add `GameRepository.load` method
- `[MOD]` `src/domain/game-repository.js`
- `async load(gameId)` — loads latest snapshot, gets events since snapshot version, calls `GameAggregate.reconstitute`
- `[VERIFY]` `node --check src/domain/game-repository.js`

### 4.1.46 — Add `GameRepository.save` method
- `[MOD]` `src/domain/game-repository.js`
- `async save(aggregate)` — flushes uncommitted events, appends to event store, takes snapshot if `shouldSnapshot`
- `[VERIFY]` `node --check src/domain/game-repository.js`

### 4.1.47 — Test: `GameRepository.load` returns aggregate with reconstituted state
- `[NEW]` `tests/domain/game-repository.test.js`
- Mock event-store and snapshot-store
- `[VERIFY]` `node --test tests/domain/game-repository.test.js`

### 4.1.48 — Test: `GameRepository.load` returns empty aggregate when no events
- `[MOD]` `tests/domain/game-repository.test.js`
- `[VERIFY]` `node --test tests/domain/game-repository.test.js`

### 4.1.49 — Test: `GameRepository.save` appends events to store
- `[MOD]` `tests/domain/game-repository.test.js`
- `[VERIFY]` `node --test tests/domain/game-repository.test.js`

### 4.1.50 — Test: `GameRepository.save` takes snapshot at SNAPSHOT_INTERVAL
- `[MOD]` `tests/domain/game-repository.test.js`
- `[VERIFY]` `node --test tests/domain/game-repository.test.js`

---

## PHASE 4.2: Domain Event Vocabulary

### 4.2.1 — Create `src/domain/events/` directory
- `[VERIFY]` mkdir -p src/domain/events

### 4.2.2 — Define `PHASE_EVENTS` constants (16 types)
- `[NEW]` `src/domain/events/phase-events.js`
- Export `PHASE_EVENTS` object: GameCreated, MapSelected, InitiativeDetermined, DeploymentZoneChosen, DeploymentCompleted, AttachmentsConfirmed, CommandCardsDrawn, RoundStarted, ActivationPhaseStarted, ActivationPhaseEnded, EndOfRoundStarted, RoundEnded, GameEnded, PhaseGateOpened, PhaseGatePlayerReady, PhaseGateCleared
- `[VERIFY]` `node --check src/domain/events/phase-events.js`

### 4.2.3 — Define `PHASE_EVENT_SCHEMAS` (required payload fields per type)
- `[MOD]` `src/domain/events/phase-events.js`
- Export `PHASE_EVENT_SCHEMAS` object: e.g. `GameCreated: { required: ['player1Id', 'player2Id', 'generalId'] }`, etc.
- `[VERIFY]` `node --check src/domain/events/phase-events.js`

### 4.2.4 — Define `COMBAT_EVENTS` constants (11 types)
- `[NEW]` `src/domain/events/combat-events.js`
- CombatDeclared, CombatPlayerReady, CombatDiceRolled, CombatRerollPerformed, CombatSurgeSpent, CombatPassiveApplied, CombatTokenApplied, CombatDamageCalculated, CombatResolved, CombatCancelled, CleaveTargetSelected
- `[VERIFY]` `node --check src/domain/events/combat-events.js`

### 4.2.5 — Define `COMBAT_EVENT_SCHEMAS`
- `[MOD]` `src/domain/events/combat-events.js`
- Required payload fields per combat event type (CombatDeclared matches 24+ base fields from combat.js:1069-1107)
- `[VERIFY]` `node --check src/domain/events/combat-events.js`

### 4.2.6 — Define `MOVEMENT_EVENTS` constants (6 types)
- `[NEW]` `src/domain/events/movement-events.js`
- MovementStarted, MovementPointsAdjusted, FigureMoved, MovementCompleted, MovementCancelled, FigurePushed
- `[VERIFY]` `node --check src/domain/events/movement-events.js`

### 4.2.7 — Define `MOVEMENT_EVENT_SCHEMAS`
- `[MOD]` `src/domain/events/movement-events.js`
- `[VERIFY]` `node --check src/domain/events/movement-events.js`

### 4.2.8 — Define `ACTIVATION_EVENTS` constants (5 types)
- `[NEW]` `src/domain/events/activation-events.js`
- DcActivated, DcActionPerformed, DcEndedActivation, ActivationCleanedUp, ActivationTurnPassed
- `[VERIFY]` `node --check src/domain/events/activation-events.js`

### 4.2.9 — Define `ACTIVATION_EVENT_SCHEMAS`
- `[MOD]` `src/domain/events/activation-events.js`
- ActivationCleanedUp payload includes all 75 ACTIVATION_MSGID_FLAGS, 5 FIGKEY, 6 PLAYERNUM, 5 SCALAR from activation-state.js
- `[VERIFY]` `node --check src/domain/events/activation-events.js`

### 4.2.10 — Define `HAND_EVENTS` constants (7 types)
- `[NEW]` `src/domain/events/hand-events.js`
- DeckShuffled, CardsDrawn, CardPlayed, CardDiscarded, NegationAttempted, NegationResolved, SquadSubmitted
- `[VERIFY]` `node --check src/domain/events/hand-events.js`

### 4.2.11 — Define `HAND_EVENT_SCHEMAS`
- `[MOD]` `src/domain/events/hand-events.js`
- `[VERIFY]` `node --check src/domain/events/hand-events.js`

### 4.2.12 — Define `FIGURE_EVENTS` constants (9 types)
- `[NEW]` `src/domain/events/figure-events.js`
- FigureDeployed, FigureDamaged, FigureHealed, FigureDefeated, FigureStrained, ConditionApplied, ConditionRemoved, PowerTokenGained, PowerTokenSpent
- `[VERIFY]` `node --check src/domain/events/figure-events.js`

### 4.2.13 — Define `FIGURE_EVENT_SCHEMAS`
- `[MOD]` `src/domain/events/figure-events.js`
- `[VERIFY]` `node --check src/domain/events/figure-events.js`

### 4.2.14 — Define `VP_EVENTS` constants (5 types)
- `[NEW]` `src/domain/events/vp-events.js`
- VpAwarded, VpDeducted, ObjectiveClaimed, TerminalControlled, CrateCollected
- `[VERIFY]` `node --check src/domain/events/vp-events.js`

### 4.2.15 — Define `VP_EVENT_SCHEMAS`
- `[MOD]` `src/domain/events/vp-events.js`
- `[VERIFY]` `node --check src/domain/events/vp-events.js`

### 4.2.16 — Define `SETUP_EVENTS` constants (5 types)
- `[NEW]` `src/domain/events/setup-events.js`
- MapTypeChosen, MapConfirmed, DraftRandomStarted, FigurePlaced, AttachmentPlaced
- `[VERIFY]` `node --check src/domain/events/setup-events.js`

### 4.2.17 — Define `SETUP_EVENT_SCHEMAS`
- `[MOD]` `src/domain/events/setup-events.js`
- `[VERIFY]` `node --check src/domain/events/setup-events.js`

### 4.2.18 — Define `ABILITY_EVENTS` constants (6 types)
- `[NEW]` `src/domain/events/ability-events.js`
- AbilityTriggered, AbilityResolved, InterruptPrompted, InterruptResolved, StartOfRoundEffectRun, EndOfRoundEffectRun
- `[VERIFY]` `node --check src/domain/events/ability-events.js`

### 4.2.19 — Define `ABILITY_EVENT_SCHEMAS`
- `[MOD]` `src/domain/events/ability-events.js`
- `[VERIFY]` `node --check src/domain/events/ability-events.js`

### 4.2.20 — Create event registry: re-export all event modules
- `[NEW]` `src/domain/events/index.js`
- Import and re-export all 9 event modules
- `[VERIFY]` `node --check src/domain/events/index.js`

### 4.2.21 — Build `DOMAIN_EVENT_TYPES` enum from all exports
- `[MOD]` `src/domain/events/index.js`
- Merge all `*_EVENTS` objects into single `DOMAIN_EVENT_TYPES` (70 types total)
- Export `getAllEventTypes()` — returns sorted array of type names
- `[VERIFY]` `node --check src/domain/events/index.js`

### 4.2.22 — Create `validateEvent(event)` function
- `[MOD]` `src/domain/events/index.js`
- Checks type exists in DOMAIN_EVENT_TYPES, required payload fields present per schema
- Returns `{ valid, errors }`
- `[VERIFY]` `node --check src/domain/events/index.js`

### 4.2.23 — Test: all 70 event types registered in `DOMAIN_EVENT_TYPES`
- `[NEW]` `tests/domain/event-types.test.js`
- `[VERIFY]` `node --test tests/domain/event-types.test.js`

### 4.2.24 — Test: each event type can be created via `createDomainEvent`
- `[MOD]` `tests/domain/event-types.test.js`
- `[VERIFY]` `node --test tests/domain/event-types.test.js`

### 4.2.25 — Test: events survive JSON round-trip
- `[MOD]` `tests/domain/event-types.test.js`
- `JSON.parse(JSON.stringify(event))` deep-equals original
- `[VERIFY]` `node --test tests/domain/event-types.test.js`

### 4.2.26 — Test: `validateEvent` accepts valid, rejects missing fields
- `[MOD]` `tests/domain/event-types.test.js`
- `[VERIFY]` `node --test tests/domain/event-types.test.js`

### 4.2.27 — Test: `getAllEventTypes()` returns expected count (70)
- `[MOD]` `tests/domain/event-types.test.js`
- `[VERIFY]` `node --test tests/domain/event-types.test.js`

---

## PHASE 4.3: Event Reducers

### 4.3.1 — Create reducer framework / master `gameReducer`
- `[NEW]` `src/domain/reducer/index.js`
- Import placeholder handler objects (empty initially)
- `gameReducer(state, event)` — looks up `ALL_HANDLERS[event.type]`, calls with `structuredClone(state)`, returns new state
- `getRegisteredReducerTypes()` — returns handler keys
- `[VERIFY]` `node --check src/domain/reducer/index.js`

### 4.3.2 — Phase reducer: `GameCreated` handler
- `[NEW]` `src/domain/reducer/phase-reducer.js`
- Sets gameId, player1Id, player2Id, generalId, gameCategoryId, phase='map_selection', initializes VP objects, empty DcLists
- Export `phaseReducerHandlers` object
- `[VERIFY]` `node --check src/domain/reducer/phase-reducer.js`

### 4.3.3 — Phase reducer: `MapSelected` handler
- `[MOD]` `src/domain/reducer/phase-reducer.js`
- Sets selectedMap, selectedMission, phase='initiative'
- `[VERIFY]` `node --check src/domain/reducer/phase-reducer.js`

### 4.3.4 — Phase reducer: `InitiativeDetermined` handler
- `[MOD]` `src/domain/reducer/phase-reducer.js`
- Sets initiativePlayerId, initiativePlayerNum, phase='zone_selection'
- `[VERIFY]` `node --check src/domain/reducer/phase-reducer.js`

### 4.3.5 — Phase reducer: `DeploymentZoneChosen` handler
- `[MOD]` `src/domain/reducer/phase-reducer.js`
- Sets player deployment zones, phase='deployment'
- `[VERIFY]` `node --check src/domain/reducer/phase-reducer.js`

### 4.3.6 — Phase reducer: `DeploymentCompleted` handler
- `[MOD]` `src/domain/reducer/phase-reducer.js`
- Sets initiativePlayerDeployed/nonInitiativePlayerDeployed
- `[VERIFY]` `node --check src/domain/reducer/phase-reducer.js`

### 4.3.7 — Phase reducer: `AttachmentsConfirmed` handler
- `[MOD]` `src/domain/reducer/phase-reducer.js`
- Sets setupAttachmentConfirmed
- `[VERIFY]` `node --check src/domain/reducer/phase-reducer.js`

### 4.3.8 — Phase reducer: `CommandCardsDrawn` handler
- `[MOD]` `src/domain/reducer/phase-reducer.js`
- Marks player CC drawn
- `[VERIFY]` `node --check src/domain/reducer/phase-reducer.js`

### 4.3.9 — Phase reducer: `RoundStarted` handler — reset ROUND_OBJECT_FLAGS (85)
- `[MOD]` `src/domain/reducer/phase-reducer.js`
- Import flag lists from `src/game/activation-state.js`
- Set currentRound, phase='round_active', roundPhase='start_of_round'
- Reset all 85 ROUND_OBJECT_FLAGS to `{}`
- `[VERIFY]` `node --check src/domain/reducer/phase-reducer.js`

### 4.3.10 — Phase reducer: `RoundStarted` handler — reset ROUND_NULL_FLAGS (73)
- `[MOD]` `src/domain/reducer/phase-reducer.js`
- Reset all 73 ROUND_NULL_FLAGS to `null`
- `[VERIFY]` `node --check src/domain/reducer/phase-reducer.js`

### 4.3.11 — Phase reducer: `RoundStarted` handler — reset ROUND_ARRAY/FALSE/DELETE flags
- `[MOD]` `src/domain/reducer/phase-reducer.js`
- Reset 3 ROUND_ARRAY_FLAGS to `[]`, 5 ROUND_FALSE_FLAGS to `false`, delete 8 ROUND_DELETE_FLAGS
- `[VERIFY]` `node --check src/domain/reducer/phase-reducer.js`

### 4.3.12 — Phase reducer: `ActivationPhaseStarted` handler
- `[MOD]` `src/domain/reducer/phase-reducer.js`
- Sets roundPhase='activation', currentActivationTurnPlayerId, activations remaining
- `[VERIFY]` `node --check src/domain/reducer/phase-reducer.js`

### 4.3.13 — Phase reducer: `ActivationPhaseEnded` handler
- `[MOD]` `src/domain/reducer/phase-reducer.js`
- Sets both players' activationPhaseEnded
- `[VERIFY]` `node --check src/domain/reducer/phase-reducer.js`

### 4.3.14 — Phase reducer: `EndOfRoundStarted` handler
- `[MOD]` `src/domain/reducer/phase-reducer.js`
- Sets roundPhase='end_of_round'
- `[VERIFY]` `node --check src/domain/reducer/phase-reducer.js`

### 4.3.15 — Phase reducer: `RoundEnded` handler
- `[MOD]` `src/domain/reducer/phase-reducer.js`
- Cleanup
- `[VERIFY]` `node --check src/domain/reducer/phase-reducer.js`

### 4.3.16 — Phase reducer: `GameEnded` handler
- `[MOD]` `src/domain/reducer/phase-reducer.js`
- Sets ended=true, winnerId, phase='ended'
- `[VERIFY]` `node --check src/domain/reducer/phase-reducer.js`

### 4.3.17 — Phase reducer: `PhaseGateOpened` handler
- `[MOD]` `src/domain/reducer/phase-reducer.js`
- Creates phaseGate object
- `[VERIFY]` `node --check src/domain/reducer/phase-reducer.js`

### 4.3.18 — Phase reducer: `PhaseGatePlayerReady` handler
- `[MOD]` `src/domain/reducer/phase-reducer.js`
- Sets p1Ready/p2Ready on phaseGate
- `[VERIFY]` `node --check src/domain/reducer/phase-reducer.js`

### 4.3.19 — Phase reducer: `PhaseGateCleared` handler
- `[MOD]` `src/domain/reducer/phase-reducer.js`
- Deletes phaseGate
- `[VERIFY]` `node --check src/domain/reducer/phase-reducer.js`

### 4.3.20 — Wire phase reducer into master reducer
- `[MOD]` `src/domain/reducer/index.js`
- Import `phaseReducerHandlers`, spread into ALL_HANDLERS
- `[VERIFY]` `node --check src/domain/reducer/index.js`

### 4.3.21 — Test: GameCreated → MapSelected → InitiativeDetermined state flow
- `[NEW]` `tests/domain/reducer/phase-reducer.test.js`
- `[VERIFY]` `node --test tests/domain/reducer/phase-reducer.test.js`

### 4.3.22 — Test: DeploymentZoneChosen → DeploymentCompleted state flow
- `[MOD]` `tests/domain/reducer/phase-reducer.test.js`
- `[VERIFY]` `node --test tests/domain/reducer/phase-reducer.test.js`

### 4.3.23 — Test: RoundStarted resets all 170+ flags
- `[MOD]` `tests/domain/reducer/phase-reducer.test.js`
- `[VERIFY]` `node --test tests/domain/reducer/phase-reducer.test.js`

### 4.3.24 — Test: PhaseGate lifecycle (open → ready × 2 → cleared)
- `[MOD]` `tests/domain/reducer/phase-reducer.test.js`
- `[VERIFY]` `node --test tests/domain/reducer/phase-reducer.test.js`

### 4.3.25 — Test: GameEnded sets final state
- `[MOD]` `tests/domain/reducer/phase-reducer.test.js`
- `[VERIFY]` `node --test tests/domain/reducer/phase-reducer.test.js`

### 4.3.26 — Combat reducer: `CombatDeclared` handler
- `[NEW]` `src/domain/reducer/combat-reducer.js`
- Creates `pendingCombat` object (24+ base fields)
- Export `combatReducerHandlers`
- `[VERIFY]` `node --check src/domain/reducer/combat-reducer.js`

### 4.3.27 — Combat reducer: `CombatPlayerReady` handler
- `[MOD]` `src/domain/reducer/combat-reducer.js`
- Sets p1Ready/p2Ready on pendingCombat
- `[VERIFY]` `node --check src/domain/reducer/combat-reducer.js`

### 4.3.28 — Combat reducer: `CombatDiceRolled` handler
- `[MOD]` `src/domain/reducer/combat-reducer.js`
- Sets attackRoll, defenseRoll
- `[VERIFY]` `node --check src/domain/reducer/combat-reducer.js`

### 4.3.29 — Combat reducer: `CombatRerollPerformed` handler
- `[MOD]` `src/domain/reducer/combat-reducer.js`
- Mutates die face at given index
- `[VERIFY]` `node --check src/domain/reducer/combat-reducer.js`

### 4.3.30 — Combat reducer: `CombatSurgeSpent` handler
- `[MOD]` `src/domain/reducer/combat-reducer.js`
- Marks surge spent, applies surge effect
- `[VERIFY]` `node --check src/domain/reducer/combat-reducer.js`

### 4.3.31 — Combat reducer: `CombatPassiveApplied` handler
- `[MOD]` `src/domain/reducer/combat-reducer.js`
- Applies passive modifier
- `[VERIFY]` `node --check src/domain/reducer/combat-reducer.js`

### 4.3.32 — Combat reducer: `CombatTokenApplied` handler
- `[MOD]` `src/domain/reducer/combat-reducer.js`
- Applies token effect
- `[VERIFY]` `node --check src/domain/reducer/combat-reducer.js`

### 4.3.33 — Combat reducer: `CombatDamageCalculated` handler
- `[MOD]` `src/domain/reducer/combat-reducer.js`
- Stores computed damage values
- `[VERIFY]` `node --check src/domain/reducer/combat-reducer.js`

### 4.3.34 — Combat reducer: `CombatResolved` handler
- `[MOD]` `src/domain/reducer/combat-reducer.js`
- Applies damage to target, deletes pendingCombat
- `[VERIFY]` `node --check src/domain/reducer/combat-reducer.js`

### 4.3.35 — Combat reducer: `CombatCancelled` handler
- `[MOD]` `src/domain/reducer/combat-reducer.js`
- Deletes pendingCombat
- `[VERIFY]` `node --check src/domain/reducer/combat-reducer.js`

### 4.3.36 — Combat reducer: `CleaveTargetSelected` handler
- `[MOD]` `src/domain/reducer/combat-reducer.js`
- Applies cleave damage to secondary target
- `[VERIFY]` `node --check src/domain/reducer/combat-reducer.js`

### 4.3.37 — Wire combat reducer into master reducer
- `[MOD]` `src/domain/reducer/index.js`
- Import `combatReducerHandlers`, spread into ALL_HANDLERS
- `[VERIFY]` `node --check src/domain/reducer/index.js`

### 4.3.38 — Test: full combat lifecycle (Declared → Ready ×2 → Rolled → Surge → Resolved)
- `[NEW]` `tests/domain/reducer/combat-reducer.test.js`
- Verify pendingCombat created/destroyed, damage applied
- `[VERIFY]` `node --test tests/domain/reducer/combat-reducer.test.js`

### 4.3.39 — Test: CombatCancelled deletes pendingCombat
- `[MOD]` `tests/domain/reducer/combat-reducer.test.js`
- `[VERIFY]` `node --test tests/domain/reducer/combat-reducer.test.js`

### 4.3.40 — Movement reducer: `MovementStarted` handler
- `[NEW]` `src/domain/reducer/movement-reducer.js`
- Creates moveInProgress entry
- Export `movementReducerHandlers`
- `[VERIFY]` `node --check src/domain/reducer/movement-reducer.js`

### 4.3.41 — Movement reducer: `MovementPointsAdjusted` handler
- `[MOD]` `src/domain/reducer/movement-reducer.js`
- Updates MP
- `[VERIFY]` `node --check src/domain/reducer/movement-reducer.js`

### 4.3.42 — Movement reducer: `FigureMoved` handler
- `[MOD]` `src/domain/reducer/movement-reducer.js`
- Updates figurePositions, deducts MP
- `[VERIFY]` `node --check src/domain/reducer/movement-reducer.js`

### 4.3.43 — Movement reducer: `MovementCompleted` handler
- `[MOD]` `src/domain/reducer/movement-reducer.js`
- Deletes moveInProgress entry
- `[VERIFY]` `node --check src/domain/reducer/movement-reducer.js`

### 4.3.44 — Movement reducer: `MovementCancelled` handler
- `[MOD]` `src/domain/reducer/movement-reducer.js`
- Reverts position, deletes moveInProgress
- `[VERIFY]` `node --check src/domain/reducer/movement-reducer.js`

### 4.3.45 — Movement reducer: `FigurePushed` handler
- `[MOD]` `src/domain/reducer/movement-reducer.js`
- Updates figurePositions (no MP cost)
- `[VERIFY]` `node --check src/domain/reducer/movement-reducer.js`

### 4.3.46 — Wire movement reducer into master reducer
- `[MOD]` `src/domain/reducer/index.js`
- Import `movementReducerHandlers`, spread into ALL_HANDLERS
- `[VERIFY]` `node --check src/domain/reducer/index.js`

### 4.3.47 — Test: movement start → move 3 spaces → complete
- `[NEW]` `tests/domain/reducer/movement-reducer.test.js`
- Verify positions update, MP tracks
- `[VERIFY]` `node --test tests/domain/reducer/movement-reducer.test.js`

### 4.3.48 — Test: movement cancel reverts position
- `[MOD]` `tests/domain/reducer/movement-reducer.test.js`
- `[VERIFY]` `node --test tests/domain/reducer/movement-reducer.test.js`

### 4.3.49 — Test: FigurePushed updates position without MP cost
- `[MOD]` `tests/domain/reducer/movement-reducer.test.js`
- `[VERIFY]` `node --test tests/domain/reducer/movement-reducer.test.js`

### 4.3.50 — Activation reducer: `DcActivated` handler
- `[NEW]` `src/domain/reducer/activation-reducer.js`
- Sets dcActionsData, adds to activatedDcIndices
- Export `activationReducerHandlers`
- `[VERIFY]` `node --check src/domain/reducer/activation-reducer.js`

### 4.3.51 — Activation reducer: `DcActionPerformed` handler
- `[MOD]` `src/domain/reducer/activation-reducer.js`
- Decrements remaining actions
- `[VERIFY]` `node --check src/domain/reducer/activation-reducer.js`

### 4.3.52 — Activation reducer: `DcEndedActivation` handler
- `[MOD]` `src/domain/reducer/activation-reducer.js`
- Marks DC finished
- `[VERIFY]` `node --check src/domain/reducer/activation-reducer.js`

### 4.3.53 — Activation reducer: `ActivationCleanedUp` handler
- `[MOD]` `src/domain/reducer/activation-reducer.js`
- Reset 75 ACTIVATION_MSGID_FLAGS, 5 FIGKEY_FLAGS, 6 PLAYERNUM_FLAGS, 5 SCALAR_FLAGS (import from activation-state.js)
- `[VERIFY]` `node --check src/domain/reducer/activation-reducer.js`

### 4.3.54 — Activation reducer: `ActivationTurnPassed` handler
- `[MOD]` `src/domain/reducer/activation-reducer.js`
- Switches currentActivationTurnPlayerId
- `[VERIFY]` `node --check src/domain/reducer/activation-reducer.js`

### 4.3.55 — Wire activation reducer into master reducer
- `[MOD]` `src/domain/reducer/index.js`
- Import `activationReducerHandlers`, spread into ALL_HANDLERS
- `[VERIFY]` `node --check src/domain/reducer/index.js`

### 4.3.56 — Test: activate DC → perform 2 actions → end turn → cleanup
- `[NEW]` `tests/domain/reducer/activation-reducer.test.js`
- Verify action count, turn switching, flag reset
- `[VERIFY]` `node --test tests/domain/reducer/activation-reducer.test.js`

### 4.3.57 — Figure reducer: `FigureDeployed` handler
- `[NEW]` `src/domain/reducer/figure-reducer.js`
- Adds to figurePositions, sets orientation
- Export `figureReducerHandlers`
- `[VERIFY]` `node --check src/domain/reducer/figure-reducer.js`

### 4.3.58 — Figure reducer: `FigureDamaged` handler
- `[MOD]` `src/domain/reducer/figure-reducer.js`
- Reduces HP in dcHealthState/healthState
- `[VERIFY]` `node --check src/domain/reducer/figure-reducer.js`

### 4.3.59 — Figure reducer: `FigureHealed` handler
- `[MOD]` `src/domain/reducer/figure-reducer.js`
- Increases HP
- `[VERIFY]` `node --check src/domain/reducer/figure-reducer.js`

### 4.3.60 — Figure reducer: `FigureDefeated` handler
- `[MOD]` `src/domain/reducer/figure-reducer.js`
- Removes from figurePositions, adds to depleted lists, awards VP
- `[VERIFY]` `node --check src/domain/reducer/figure-reducer.js`

### 4.3.61 — Figure reducer: `FigureStrained` handler
- `[MOD]` `src/domain/reducer/figure-reducer.js`
- Increments figureStrain
- `[VERIFY]` `node --check src/domain/reducer/figure-reducer.js`

### 4.3.62 — Figure reducer: `ConditionApplied` handler
- `[MOD]` `src/domain/reducer/figure-reducer.js`
- Adds to figureConditions
- `[VERIFY]` `node --check src/domain/reducer/figure-reducer.js`

### 4.3.63 — Figure reducer: `ConditionRemoved` handler
- `[MOD]` `src/domain/reducer/figure-reducer.js`
- Removes from figureConditions
- `[VERIFY]` `node --check src/domain/reducer/figure-reducer.js`

### 4.3.64 — Figure reducer: `PowerTokenGained` handler
- `[MOD]` `src/domain/reducer/figure-reducer.js`
- Adds to figurePowerTokens
- `[VERIFY]` `node --check src/domain/reducer/figure-reducer.js`

### 4.3.65 — Figure reducer: `PowerTokenSpent` handler
- `[MOD]` `src/domain/reducer/figure-reducer.js`
- Removes from figurePowerTokens
- `[VERIFY]` `node --check src/domain/reducer/figure-reducer.js`

### 4.3.66 — Wire figure reducer into master reducer
- `[MOD]` `src/domain/reducer/index.js`
- Import `figureReducerHandlers`, spread into ALL_HANDLERS
- `[VERIFY]` `node --check src/domain/reducer/index.js`

### 4.3.67 — Test: deploy figure → damage → apply condition → defeat
- `[NEW]` `tests/domain/reducer/figure-reducer.test.js`
- Verify positions, HP, conditions, defeat tracking
- `[VERIFY]` `node --test tests/domain/reducer/figure-reducer.test.js`

### 4.3.68 — Test: heal figure, verify HP cap
- `[MOD]` `tests/domain/reducer/figure-reducer.test.js`
- `[VERIFY]` `node --test tests/domain/reducer/figure-reducer.test.js`

### 4.3.69 — Test: power token gain/spend lifecycle
- `[MOD]` `tests/domain/reducer/figure-reducer.test.js`
- `[VERIFY]` `node --test tests/domain/reducer/figure-reducer.test.js`

### 4.3.70 — Hand reducer: `DeckShuffled` handler
- `[NEW]` `src/domain/reducer/hand-reducer.js`
- Shuffles ccDeck
- Export `handReducerHandlers`
- `[VERIFY]` `node --check src/domain/reducer/hand-reducer.js`

### 4.3.71 — Hand reducer: `CardsDrawn` handler
- `[MOD]` `src/domain/reducer/hand-reducer.js`
- Moves cards from ccDeck to ccHand
- `[VERIFY]` `node --check src/domain/reducer/hand-reducer.js`

### 4.3.72 — Hand reducer: `CardPlayed` handler
- `[MOD]` `src/domain/reducer/hand-reducer.js`
- Removes from ccHand
- `[VERIFY]` `node --check src/domain/reducer/hand-reducer.js`

### 4.3.73 — Hand reducer: `CardDiscarded` handler
- `[MOD]` `src/domain/reducer/hand-reducer.js`
- Moves from ccHand to ccDiscard
- `[VERIFY]` `node --check src/domain/reducer/hand-reducer.js`

### 4.3.74 — Hand reducer: `NegationAttempted` handler
- `[MOD]` `src/domain/reducer/hand-reducer.js`
- Sets pendingNegation
- `[VERIFY]` `node --check src/domain/reducer/hand-reducer.js`

### 4.3.75 — Hand reducer: `NegationResolved` handler
- `[MOD]` `src/domain/reducer/hand-reducer.js`
- Resolves or discards, clears pendingNegation
- `[VERIFY]` `node --check src/domain/reducer/hand-reducer.js`

### 4.3.76 — Hand reducer: `SquadSubmitted` handler
- `[MOD]` `src/domain/reducer/hand-reducer.js`
- Sets playerSquad
- `[VERIFY]` `node --check src/domain/reducer/hand-reducer.js`

### 4.3.77 — Wire hand reducer into master reducer
- `[MOD]` `src/domain/reducer/index.js`
- Import `handReducerHandlers`, spread into ALL_HANDLERS
- `[VERIFY]` `node --check src/domain/reducer/index.js`

### 4.3.78 — Test: shuffle → draw 5 → play card → discard card
- `[NEW]` `tests/domain/reducer/hand-reducer.test.js`
- Verify hand, deck, discard piles
- `[VERIFY]` `node --test tests/domain/reducer/hand-reducer.test.js`

### 4.3.79 — Test: negation lifecycle (attempt → resolve)
- `[MOD]` `tests/domain/reducer/hand-reducer.test.js`
- `[VERIFY]` `node --test tests/domain/reducer/hand-reducer.test.js`

### 4.3.80 — VP reducer: all 5 handlers (VpAwarded, VpDeducted, ObjectiveClaimed, TerminalControlled, CrateCollected)
- `[NEW]` `src/domain/reducer/vp-reducer.js`
- Each modifies player1VP/player2VP .total, .kills, or .objectives
- Export `vpReducerHandlers`
- `[VERIFY]` `node --check src/domain/reducer/vp-reducer.js`

### 4.3.81 — Wire VP reducer into master reducer
- `[MOD]` `src/domain/reducer/index.js`
- `[VERIFY]` `node --check src/domain/reducer/index.js`

### 4.3.82 — Setup reducer: all 5 handlers (MapTypeChosen, MapConfirmed, DraftRandomStarted, FigurePlaced, AttachmentPlaced)
- `[NEW]` `src/domain/reducer/setup-reducer.js`
- FigurePlaced adds to figurePositions; AttachmentPlaced adds to dcAttachments
- Export `setupReducerHandlers`
- `[VERIFY]` `node --check src/domain/reducer/setup-reducer.js`

### 4.3.83 — Wire setup reducer into master reducer
- `[MOD]` `src/domain/reducer/index.js`
- `[VERIFY]` `node --check src/domain/reducer/index.js`

### 4.3.84 — Ability reducer: all 6 handlers (AbilityTriggered, AbilityResolved, InterruptPrompted, InterruptResolved, StartOfRoundEffectRun, EndOfRoundEffectRun)
- `[NEW]` `src/domain/reducer/ability-reducer.js`
- InterruptPrompted sets pending* field; InterruptResolved clears and applies
- Export `abilityReducerHandlers`
- `[VERIFY]` `node --check src/domain/reducer/ability-reducer.js`

### 4.3.85 — Wire ability reducer into master reducer
- `[MOD]` `src/domain/reducer/index.js`
- `[VERIFY]` `node --check src/domain/reducer/index.js`

### 4.3.86 — Test: VP award/deduct
- `[NEW]` `tests/domain/reducer/misc-reducer.test.js`
- `[VERIFY]` `node --test tests/domain/reducer/misc-reducer.test.js`

### 4.3.87 — Test: setup place figure + attach
- `[MOD]` `tests/domain/reducer/misc-reducer.test.js`
- `[VERIFY]` `node --test tests/domain/reducer/misc-reducer.test.js`

### 4.3.88 — Test: ability trigger/resolve interrupt
- `[MOD]` `tests/domain/reducer/misc-reducer.test.js`
- `[VERIFY]` `node --test tests/domain/reducer/misc-reducer.test.js`

### 4.3.89 — Integration test: complete mini-game lifecycle through master `gameReducer`
- `[NEW]` `tests/domain/reducer/integration.test.js`
- GameCreated → MapSelected → InitiativeDetermined → DeploymentZoneChosen → FigureDeployed ×4 → DeploymentCompleted ×2 → RoundStarted → ActivationPhaseStarted → DcActivated → FigureMoved → DcEndedActivation → ActivationCleanedUp → ActivationPhaseEnded → EndOfRoundStarted → RoundEnded → GameEnded
- Verify state at each step
- `[VERIFY]` `node --test tests/domain/reducer/integration.test.js`

---

## PHASE 4.4: Strangler Fig Adapter Layer

### 4.4.1 — Create `translateDiffToEvents` scaffold
- `[NEW]` `src/domain/diff-translator.js`
- Import `createDomainEvent`
- `translateDiffToEvents(handlerKey, diff, context)` — returns empty array initially
- `[VERIFY]` `node --check src/domain/diff-translator.js`

### 4.4.2 — DiffTranslator: detect phase change → emit phase event
- `[MOD]` `src/domain/diff-translator.js`
- If `set.phase` changed → call `translatePhaseChange(before, after, context)` → returns phase event
- `[VERIFY]` `node --check src/domain/diff-translator.js`

### 4.4.3 — DiffTranslator: detect PhaseGateOpened
- `[MOD]` `src/domain/diff-translator.js`
- If `set.phaseGate` created (not in before) → emit PhaseGateOpened
- `[VERIFY]` `node --check src/domain/diff-translator.js`

### 4.4.4 — DiffTranslator: detect PhaseGatePlayerReady
- `[MOD]` `src/domain/diff-translator.js`
- If `set.phaseGate.p1Ready` or `p2Ready` changed → emit PhaseGatePlayerReady
- `[VERIFY]` `node --check src/domain/diff-translator.js`

### 4.4.5 — DiffTranslator: detect PhaseGateCleared
- `[MOD]` `src/domain/diff-translator.js`
- If phaseGate deleted → emit PhaseGateCleared
- `[VERIFY]` `node --check src/domain/diff-translator.js`

### 4.4.6 — DiffTranslator: detect `pendingCombat` created → CombatDeclared
- `[MOD]` `src/domain/diff-translator.js`
- `[VERIFY]` `node --check src/domain/diff-translator.js`

### 4.4.7 — DiffTranslator: detect `pendingCombat.p1Ready`/`p2Ready` → CombatPlayerReady
- `[MOD]` `src/domain/diff-translator.js`
- `[VERIFY]` `node --check src/domain/diff-translator.js`

### 4.4.8 — DiffTranslator: detect `pendingCombat.attackRoll` set → CombatDiceRolled
- `[MOD]` `src/domain/diff-translator.js`
- `[VERIFY]` `node --check src/domain/diff-translator.js`

### 4.4.9 — DiffTranslator: detect `pendingCombat` deleted → CombatResolved
- `[MOD]` `src/domain/diff-translator.js`
- `[VERIFY]` `node --check src/domain/diff-translator.js`

### 4.4.10 — DiffTranslator: detect `figurePositions` changed → FigureMoved
- `[MOD]` `src/domain/diff-translator.js`
- `[VERIFY]` `node --check src/domain/diff-translator.js`

### 4.4.11 — DiffTranslator: detect `moveInProgress` created → MovementStarted
- `[MOD]` `src/domain/diff-translator.js`
- `[VERIFY]` `node --check src/domain/diff-translator.js`

### 4.4.12 — DiffTranslator: detect `moveInProgress` deleted → MovementCompleted
- `[MOD]` `src/domain/diff-translator.js`
- `[VERIFY]` `node --check src/domain/diff-translator.js`

### 4.4.13 — DiffTranslator: detect VP increased → VpAwarded
- `[MOD]` `src/domain/diff-translator.js`
- `[VERIFY]` `node --check src/domain/diff-translator.js`

### 4.4.14 — DiffTranslator: detect figure removed from figurePositions → FigureDefeated
- `[MOD]` `src/domain/diff-translator.js`
- `[VERIFY]` `node --check src/domain/diff-translator.js`

### 4.4.15 — DiffTranslator: detect figureConditions added → ConditionApplied
- `[MOD]` `src/domain/diff-translator.js`
- `[VERIFY]` `node --check src/domain/diff-translator.js`

### 4.4.16 — DiffTranslator: detect `currentActivationTurnPlayerId` changed → ActivationTurnPassed
- `[MOD]` `src/domain/diff-translator.js`
- `[VERIFY]` `node --check src/domain/diff-translator.js`

### 4.4.17 — Test: phase change diff → phase event
- `[NEW]` `tests/domain/diff-translator.test.js`
- Golden-file style: given diff, expect event
- `[VERIFY]` `node --test tests/domain/diff-translator.test.js`

### 4.4.18 — Test: pendingCombat created/deleted → combat events
- `[MOD]` `tests/domain/diff-translator.test.js`
- `[VERIFY]` `node --test tests/domain/diff-translator.test.js`

### 4.4.19 — Test: figurePositions changed → FigureMoved
- `[MOD]` `tests/domain/diff-translator.test.js`
- `[VERIFY]` `node --test tests/domain/diff-translator.test.js`

### 4.4.20 — Test: VP change → VpAwarded
- `[MOD]` `tests/domain/diff-translator.test.js`
- `[VERIFY]` `node --test tests/domain/diff-translator.test.js`

### 4.4.21 — Test: figure defeat → FigureDefeated
- `[MOD]` `tests/domain/diff-translator.test.js`
- `[VERIFY]` `node --test tests/domain/diff-translator.test.js`

### 4.4.22 — Test: condition added → ConditionApplied
- `[MOD]` `tests/domain/diff-translator.test.js`
- `[VERIFY]` `node --test tests/domain/diff-translator.test.js`

### 4.4.23 — Create `dispatchWithEvents` function
- `[NEW]` `src/domain/dispatcher.js`
- Import captureSnapshot/computeDiff from event-log.js, translateDiffToEvents, appendEvents
- `dispatchWithEvents(handlerFn, interaction, ctx, meta)` — before snapshot → run handler → after snapshot → diff → translate → persist non-blocking
- `[VERIFY]` `node --check src/domain/dispatcher.js`

### 4.4.24 — Wire `dispatchWithEvents` into button dispatch in index.js
- `[MOD]` `index.js`
- Import `dispatchWithEvents`
- Replace button dispatch event-capture block (~lines 3116-3136) with `dispatchWithEvents` call
- Keep existing `game_events` audit trail alongside (dual-write)
- `[VERIFY]` `node --check index.js`

### 4.4.25 — Verify: all existing tests still pass after button dispatch wiring
- `[VERIFY]` `node --test` (full suite)

### 4.4.26 — Wire `dispatchWithEvents` into select menu dispatch (space-select overflow branch)
- `[MOD]` `index.js`
- Replace select menu event-capture block (~lines 3020-3043)
- `[VERIFY]` `node --check index.js`

### 4.4.27 — Wire `dispatchWithEvents` into select menu dispatch (table-driven branch)
- `[MOD]` `index.js`
- Replace select menu event-capture block (~lines 3055-3089)
- `[VERIFY]` `node --check index.js`

### 4.4.28 — Verify: all tests pass after select menu wiring
- `[VERIFY]` `node --test` (full suite)

### 4.4.29 — Create `verifyGameEvents` function
- `[NEW]` `src/domain/event-verifier.js`
- Import gameReducer, event-store, snapshot-store
- `verifyGameEvents(gameId, actualState)` — replays events from snapshot, compares keys vs actual state, returns `{ match, mismatches }`
- `[VERIFY]` `node --check src/domain/event-verifier.js`

### 4.4.30 — Create `compareStates` helper
- `[MOD]` `src/domain/event-verifier.js` (already part of the file, but atomic separation)
- Compare top-level keys via JSON.stringify
- `[VERIFY]` `node --check src/domain/event-verifier.js`

### 4.4.31 — Create verification CLI script
- `[NEW]` `scripts/verify-events.js`
- CLI: `node scripts/verify-events.js <gameId>` — loads game, replays events, reports mismatches
- `[VERIFY]` `node --check scripts/verify-events.js`

### 4.4.32 — Add `DUAL_WRITE_MODE` flag to game-state.js
- `[MOD]` `src/game-state.js`
- Add `DUAL_WRITE_MODE = true` constant
- When true: `saveGames()` saves state blob AND domain events are captured. When false: only events.
- `[VERIFY]` `node --check src/game-state.js`

### 4.4.33 — Extend headless harness: `submitAction` returns `events` field
- `[MOD]` `src/headless/game-harness.js`
- After handler runs, translate diff to events, include in return `{ game, messages, events }`
- `[VERIFY]` `node --check src/headless/game-harness.js`

### 4.4.34 — Verify: existing headless tests still pass
- `[VERIFY]` `node --test tests/engine/` (headless suite)

### 4.4.35 — Test: phase gate ready action → emits PhaseGatePlayerReady event
- `[NEW]` `tests/domain/headless-events.test.js`
- Use headless harness, verify events array
- `[VERIFY]` `node --test tests/domain/headless-events.test.js`

### 4.4.36 — Test: movement action → emits FigureMoved event
- `[MOD]` `tests/domain/headless-events.test.js`
- `[VERIFY]` `node --test tests/domain/headless-events.test.js`

### 4.4.37 — Test: end turn → emits DcEndedActivation event
- `[MOD]` `tests/domain/headless-events.test.js`
- `[VERIFY]` `node --test tests/domain/headless-events.test.js`

---

## PHASE 4.5: Saga Coordinators

### 4.5.1 — Create `Saga` base class: constructor + `recordStep`
- `[NEW]` `src/domain/sagas/saga.js`
- `class Saga { constructor(id, type, initialState) }` — sets id, type, state, status='active', steps=[], createdAt
- `recordStep(stepName, data)` — pushes to steps array
- `[VERIFY]` `node --check src/domain/sagas/saga.js`

### 4.5.2 — Add `Saga.complete()` and `Saga.cancel()` methods
- `[MOD]` `src/domain/sagas/saga.js`
- `complete()` — sets status='completed'
- `cancel()` — sets status='cancelled'
- `isActive()` — returns status === 'active'
- `[VERIFY]` `node --check src/domain/sagas/saga.js`

### 4.5.3 — Add `Saga.toJSON()` and `Saga.fromJSON()` methods
- `[MOD]` `src/domain/sagas/saga.js`
- `toJSON()` — returns plain object with all fields
- `static fromJSON(json)` — reconstructs Saga instance from plain object
- `[VERIFY]` `node --check src/domain/sagas/saga.js`

### 4.5.4 — Test: Saga create, recordStep
- `[NEW]` `tests/domain/sagas/saga.test.js`
- `[VERIFY]` `node --test tests/domain/sagas/saga.test.js`

### 4.5.5 — Test: Saga complete/cancel
- `[MOD]` `tests/domain/sagas/saga.test.js`
- `[VERIFY]` `node --test tests/domain/sagas/saga.test.js`

### 4.5.6 — Test: Saga toJSON/fromJSON round-trip
- `[MOD]` `tests/domain/sagas/saga.test.js`
- `[VERIFY]` `node --test tests/domain/sagas/saga.test.js`

### 4.5.7 — Define `COMBAT_STATES` enum
- `[NEW]` `src/domain/sagas/combat-saga.js`
- Export `COMBAT_STATES`: DECLARED, READY_CHECK, ROLLING, REROLL_WINDOW, SURGE_SPENDING, RESOLUTION, COMPLETED
- `[VERIFY]` `node --check src/domain/sagas/combat-saga.js`

### 4.5.8 — Create `CombatSaga` class: constructor
- `[MOD]` `src/domain/sagas/combat-saga.js`
- Extends Saga, sets initial phase=DECLARED
- `[VERIFY]` `node --check src/domain/sagas/combat-saga.js`

### 4.5.9 — Add `CombatSaga.markReady` and `bothReady` methods
- `[MOD]` `src/domain/sagas/combat-saga.js`
- `[VERIFY]` `node --check src/domain/sagas/combat-saga.js`

### 4.5.10 — Add `CombatSaga` phase transition methods (startRolling, setRolls, enterRerollWindow, enterSurgeSpending, resolve)
- `[MOD]` `src/domain/sagas/combat-saga.js`
- `[VERIFY]` `node --check src/domain/sagas/combat-saga.js`

### 4.5.11 — Add `CombatSaga.getExpectedActions` method
- `[MOD]` `src/domain/sagas/combat-saga.js`
- Switch on state.phase → return allowed button prefixes
- `[VERIFY]` `node --check src/domain/sagas/combat-saga.js`

### 4.5.12 — Add `CombatSaga.fromPendingCombat` static factory
- `[MOD]` `src/domain/sagas/combat-saga.js`
- Creates saga from existing `game.pendingCombat` object
- `[VERIFY]` `node --check src/domain/sagas/combat-saga.js`

### 4.5.13 — Test: full combat lifecycle through CombatSaga state machine
- `[NEW]` `tests/domain/sagas/combat-saga.test.js`
- `[VERIFY]` `node --test tests/domain/sagas/combat-saga.test.js`

### 4.5.14 — Test: `fromPendingCombat` creates correct saga
- `[MOD]` `tests/domain/sagas/combat-saga.test.js`
- `[VERIFY]` `node --test tests/domain/sagas/combat-saga.test.js`

### 4.5.15 — Test: `getExpectedActions` returns correct actions per phase
- `[MOD]` `tests/domain/sagas/combat-saga.test.js`
- `[VERIFY]` `node --test tests/domain/sagas/combat-saga.test.js`

### 4.5.16 — Create `MovementSaga` class with states
- `[NEW]` `src/domain/sagas/movement-saga.js`
- States: STARTED → CHOOSING_SPACE → MOVING → INTERRUPTED → COMPLETED
- Methods: startMovement, moveToSpace, interrupt, resumeAfterInterrupt, complete
- `getExpectedActions()` per state
- `[VERIFY]` `node --check src/domain/sagas/movement-saga.js`

### 4.5.17 — Test: movement saga start → choose spaces → complete
- `[NEW]` `tests/domain/sagas/movement-saga.test.js`
- `[VERIFY]` `node --test tests/domain/sagas/movement-saga.test.js`

### 4.5.18 — Test: movement saga interrupt handling
- `[MOD]` `tests/domain/sagas/movement-saga.test.js`
- `[VERIFY]` `node --test tests/domain/sagas/movement-saga.test.js`

### 4.5.19 — Create `NegationSaga` class
- `[NEW]` `src/domain/sagas/negation-saga.js`
- States: CC_PLAYED → NEGATION_WINDOW → RESOLVED
- Replaces `pendingNegation` field
- `[VERIFY]` `node --check src/domain/sagas/negation-saga.js`

### 4.5.20 — Define `INTERRUPT_CONFIG` map (30+ entries)
- `[NEW]` `src/domain/sagas/interrupt-saga.js`
- Map from interrupt name → `{ pendingField, handlerPrefix }`
- E.g. `stillFaster: { pendingField: 'pendingStillFaster', handlerPrefix: 'still_faster_' }`
- `[VERIFY]` `node --check src/domain/sagas/interrupt-saga.js`

### 4.5.21 — Create `InterruptSaga` class
- `[MOD]` `src/domain/sagas/interrupt-saga.js`
- Extends Saga; `constructor(id, interruptType, playerNum, options)`
- `resolve(choice)` — completes saga
- `getExpectedActions()` — returns confirm/skip prefixes from config
- `[VERIFY]` `node --check src/domain/sagas/interrupt-saga.js`

### 4.5.22 — Test: 3 representative interrupts through InterruptSaga
- `[NEW]` `tests/domain/sagas/interrupt-saga.test.js`
- Test stillFaster, toughLuck, fieldTactics
- `[VERIFY]` `node --test tests/domain/sagas/interrupt-saga.test.js`

---

## PHASE 4.6: Projection System

### 4.6.1 — Create `StateCacheProjection` class: constructor + `apply`
- `[NEW]` `src/domain/projections/state-cache.js`
- Import gameReducer
- `apply(event)` — gets or inits state for event.gameId, runs reducer, stores result
- `[VERIFY]` `node --check src/domain/projections/state-cache.js`

### 4.6.2 — Add `StateCacheProjection.applyBatch`, `get`, `set`, `delete`
- `[MOD]` `src/domain/projections/state-cache.js`
- `[VERIFY]` `node --check src/domain/projections/state-cache.js`

### 4.6.3 — Test: apply events → get state matches reducer output
- `[NEW]` `tests/domain/projections/state-cache.test.js`
- `[VERIFY]` `node --test tests/domain/projections/state-cache.test.js`

### 4.6.4 — Test: batch apply
- `[MOD]` `tests/domain/projections/state-cache.test.js`
- `[VERIFY]` `node --test tests/domain/projections/state-cache.test.js`

### 4.6.5 — Create Discord UI projection scaffold
- `[NEW]` `src/domain/projections/discord-projection.js`
- EVENT_HANDLERS map for 5 high-frequency events: RoundStarted, FigureDefeated, VpAwarded, GameEnded, CombatDeclared
- `handleEvent(event, client, getGameState)` — dispatches to handler
- `[VERIFY]` `node --check src/domain/projections/discord-projection.js`

### 4.6.6 — Discord projection: RoundStarted handler
- `[MOD]` `src/domain/projections/discord-projection.js`
- Posts round announcement message
- `[VERIFY]` `node --check src/domain/projections/discord-projection.js`

### 4.6.7 — Discord projection: FigureDefeated handler
- `[MOD]` `src/domain/projections/discord-projection.js`
- Posts defeat log
- `[VERIFY]` `node --check src/domain/projections/discord-projection.js`

### 4.6.8 — Discord projection: VpAwarded handler
- `[MOD]` `src/domain/projections/discord-projection.js`
- Updates VP display
- `[VERIFY]` `node --check src/domain/projections/discord-projection.js`

### 4.6.9 — Discord projection: GameEnded handler
- `[MOD]` `src/domain/projections/discord-projection.js`
- Posts game over message
- `[VERIFY]` `node --check src/domain/projections/discord-projection.js`

### 4.6.10 — Discord projection: CombatDeclared handler
- `[MOD]` `src/domain/projections/discord-projection.js`
- Posts combat thread
- `[VERIFY]` `node --check src/domain/projections/discord-projection.js`

### 4.6.11 — Create `recoverGameFromEvents` function
- `[NEW]` `src/domain/projections/recovery-projection.js`
- Import gameReducer, getAllEventsSince, loadLatestSnapshot
- Replays from snapshot, returns `{ state, version }`
- `[VERIFY]` `node --check src/domain/projections/recovery-projection.js`

### 4.6.12 — Test: create game via events → recover → state matches
- `[NEW]` `tests/domain/projections/recovery.test.js`
- `[VERIFY]` `node --test tests/domain/projections/recovery.test.js`

### 4.6.13 — Test: recovery with snapshot mid-stream
- `[MOD]` `tests/domain/projections/recovery.test.js`
- `[VERIFY]` `node --test tests/domain/projections/recovery.test.js`

---

## PHASE 4.7: Command Layer

### 4.7.1 — Define `COMMAND_TYPES` constants (25 types)
- `[NEW]` `src/domain/commands/index.js`
- SelectMap, ConfirmMap, DetermineInitiative, ChooseDeploymentZone, DeployFigure, FinishDeployment, ActivateDc, PerformAction, EndTurn, PassActivationTurn, DeclareAttack, ReadyForCombat, RollCombatDice, SpendSurge, PerformReroll, ResolveCombat, StartMovement, MoveToSpace, CompleteMovement, PlayCommandCard, DiscardCommandCard, DrawCommandCards, PhaseGateReady, PhaseGateUnready
- `[VERIFY]` `node --check src/domain/commands/index.js`

### 4.7.2 — Create `createCommand` function
- `[MOD]` `src/domain/commands/index.js`
- `createCommand(type, gameId, playerId, payload)` — returns `{ type, gameId, playerId, payload, timestamp }`
- `[VERIFY]` `node --check src/domain/commands/index.js`

### 4.7.3 — Create `PREFIX_TO_COMMAND` mapping
- `[NEW]` `src/domain/commands/command-router.js`
- Map button prefixes → COMMAND_TYPES (start with ~10 most common)
- `[VERIFY]` `node --check src/domain/commands/command-router.js`

### 4.7.4 — Create `customIdToCommand` function
- `[MOD]` `src/domain/commands/command-router.js`
- `customIdToCommand(customId, handlerKey, playerId, gameId)` — looks up command type, parses payload from customId
- `[VERIFY]` `node --check src/domain/commands/command-router.js`

### 4.7.5 — Create `parsePayloadFromCustomId` helper
- `[MOD]` `src/domain/commands/command-router.js`
- Extracts gameId, msgId, coords etc. from customId string based on handler prefix
- `[VERIFY]` `node --check src/domain/commands/command-router.js`

### 4.7.6 — Create `handlePhaseGateReady` command handler
- `[NEW]` `src/domain/commands/phase-gate-commands.js`
- Validates state (gate exists, not already ready), returns events array or error
- If both ready after this: also emit PhaseGateCleared + phase advance events
- `[VERIFY]` `node --check src/domain/commands/phase-gate-commands.js`

### 4.7.7 — Test: PhaseGateReady → emits PhaseGatePlayerReady
- `[NEW]` `tests/domain/commands/phase-gate.test.js`
- `[VERIFY]` `node --test tests/domain/commands/phase-gate.test.js`

### 4.7.8 — Test: PhaseGateReady P2 (both ready) → emits PhaseGateCleared + advance
- `[MOD]` `tests/domain/commands/phase-gate.test.js`
- `[VERIFY]` `node --test tests/domain/commands/phase-gate.test.js`

### 4.7.9 — Test: already ready → error
- `[MOD]` `tests/domain/commands/phase-gate.test.js`
- `[VERIFY]` `node --test tests/domain/commands/phase-gate.test.js`

### 4.7.10 — Test: no gate → error
- `[MOD]` `tests/domain/commands/phase-gate.test.js`
- `[VERIFY]` `node --test tests/domain/commands/phase-gate.test.js`

### 4.7.11 — Create `handleEndTurn` command handler
- `[NEW]` `src/domain/commands/activation-commands.js`
- Validates state, returns DcEndedActivation + ActivationCleanedUp events
- `[VERIFY]` `node --check src/domain/commands/activation-commands.js`

### 4.7.12 — Create `handlePassActivationTurn` command handler
- `[MOD]` `src/domain/commands/activation-commands.js`
- Returns ActivationTurnPassed event
- `[VERIFY]` `node --check src/domain/commands/activation-commands.js`

### 4.7.13 — Create `handleActivateDc` command handler
- `[MOD]` `src/domain/commands/activation-commands.js`
- Returns DcActivated event
- `[VERIFY]` `node --check src/domain/commands/activation-commands.js`

### 4.7.14 — Test: EndTurn → emits events
- `[NEW]` `tests/domain/commands/activation.test.js`
- `[VERIFY]` `node --test tests/domain/commands/activation.test.js`

### 4.7.15 — Test: PassActivationTurn
- `[MOD]` `tests/domain/commands/activation.test.js`
- `[VERIFY]` `node --test tests/domain/commands/activation.test.js`

### 4.7.16 — Test: ActivateDc
- `[MOD]` `tests/domain/commands/activation.test.js`
- `[VERIFY]` `node --test tests/domain/commands/activation.test.js`

### 4.7.17 — Create `handleDeclareAttack` command handler
- `[NEW]` `src/domain/commands/combat-commands.js`
- Returns CombatDeclared event
- `[VERIFY]` `node --check src/domain/commands/combat-commands.js`

### 4.7.18 — Create `handleReadyForCombat` command handler
- `[MOD]` `src/domain/commands/combat-commands.js`
- Returns CombatPlayerReady event
- `[VERIFY]` `node --check src/domain/commands/combat-commands.js`

### 4.7.19 — Create `handleRollCombatDice` command handler
- `[MOD]` `src/domain/commands/combat-commands.js`
- Returns CombatDiceRolled event
- `[VERIFY]` `node --check src/domain/commands/combat-commands.js`

### 4.7.20 — Create `handleSpendSurge` command handler
- `[MOD]` `src/domain/commands/combat-commands.js`
- Returns CombatSurgeSpent event
- `[VERIFY]` `node --check src/domain/commands/combat-commands.js`

### 4.7.21 — Create `handlePerformReroll` command handler
- `[MOD]` `src/domain/commands/combat-commands.js`
- Returns CombatRerollPerformed event
- `[VERIFY]` `node --check src/domain/commands/combat-commands.js`

### 4.7.22 — Test: full combat command lifecycle
- `[NEW]` `tests/domain/commands/combat.test.js`
- DeclareAttack → ReadyForCombat → RollDice → SpendSurge → Reroll
- `[VERIFY]` `node --test tests/domain/commands/combat.test.js`

### 4.7.23 — Create `handleStartMovement` command handler
- `[NEW]` `src/domain/commands/movement-commands.js`
- Returns MovementStarted event
- `[VERIFY]` `node --check src/domain/commands/movement-commands.js`

### 4.7.24 — Create `handleMoveToSpace` command handler
- `[MOD]` `src/domain/commands/movement-commands.js`
- Returns FigureMoved event
- `[VERIFY]` `node --check src/domain/commands/movement-commands.js`

### 4.7.25 — Create `handleCompleteMovement` command handler
- `[MOD]` `src/domain/commands/movement-commands.js`
- Returns MovementCompleted event
- `[VERIFY]` `node --check src/domain/commands/movement-commands.js`

### 4.7.26 — Test: movement command lifecycle
- `[NEW]` `tests/domain/commands/movement.test.js`
- StartMovement → MoveToSpace ×3 → CompleteMovement
- `[VERIFY]` `node --test tests/domain/commands/movement.test.js`

### 4.7.27 — Add `COMMAND_MODE_HANDLERS` set to index.js (initially: phase_gate_ready_, phase_gate_unready_)
- `[MOD]` `index.js`
- Import customIdToCommand, GameRepository, gameReducer, command handlers
- Add dispatch block: if handlerKey in COMMAND_MODE_HANDLERS → create command → load aggregate → run handler → save → fall through to old handler for Discord output
- `[VERIFY]` `node --check index.js`

### 4.7.28 — Verify: phase gate works end-to-end through command pipeline
- `[VERIFY]` Manual test or automated: phase gate ready via command pipeline, old Discord output still fires

### 4.7.29 — Verify: all tests pass after command dispatch wiring
- `[VERIFY]` `node --test` (full suite)

---

## PHASE 4.8: Full Migration

### 4.8.1 — Create active game migration script
- `[NEW]` `scripts/migrate-active-games.js`
- For each active game: snapshot current state as version 0 into game_snapshots
- `[VERIFY]` `node --check scripts/migrate-active-games.js`

### 4.8.2 — Run migration script on test game
- `[VERIFY]` Run script, verify game still playable after

### 4.8.3 — Migrate phase gate handlers to command-only (remove from old dispatch)
- `[MOD]` `index.js`
- Phase gate no longer falls through to old handler; command → events → reducer → projection handles everything
- `[VERIFY]` Phase gate works end-to-end through command pipeline only

### 4.8.4 — Add round transition prefixes to COMMAND_MODE_HANDLERS
- `[MOD]` `index.js`
- Add: end_end_of_round_, end_start_of_round_, status_phase_
- `[VERIFY]` `node --check index.js`

### 4.8.5 — Implement round transition command handlers
- `[NEW]` `src/domain/commands/round-commands.js`
- `[VERIFY]` `node --check src/domain/commands/round-commands.js`

### 4.8.6 — Verify: round transitions work through command pipeline
- `[VERIFY]` Manual or automated test

### 4.8.7 — Add activation prefixes to COMMAND_MODE_HANDLERS
- `[MOD]` `index.js`
- Add: dc_activate_, end_turn_, dc_end_activation_, pass_activation_turn_, confirm_activate_, cancel_activate_
- `[VERIFY]` `node --check index.js`

### 4.8.8 — Verify: activation lifecycle works through command pipeline
- `[VERIFY]` Manual or automated test

### 4.8.9 — Add movement prefixes to COMMAND_MODE_HANDLERS
- `[MOD]` `index.js`
- Add: move_mp_, move_pick_, move_letter_, move_back_, move_adjust_
- `[VERIFY]` `node --check index.js`

### 4.8.10 — Verify: full movement works through command pipeline
- `[VERIFY]` Manual or automated test

### 4.8.11 — Add combat core prefixes to COMMAND_MODE_HANDLERS
- `[MOD]` `index.js`
- Add: attack_target_, combat_ready_, combat_roll_, combat_surge_, combat_reroll_, combat_resolve_ready_
- `[VERIFY]` `node --check index.js`

### 4.8.12 — Verify: full combat works through command pipeline
- `[VERIFY]` Manual or automated test

### 4.8.13 — Implement CC/hand command handlers
- `[NEW]` `src/domain/commands/hand-commands.js`
- PlayCommandCard, DiscardCommandCard, DrawCommandCards, etc.
- `[VERIFY]` `node --check src/domain/commands/hand-commands.js`

### 4.8.14 — Add 24 CC/hand handler prefixes to COMMAND_MODE_HANDLERS
- `[MOD]` `index.js`
- `[VERIFY]` `node --check index.js`

### 4.8.15 — Verify: card play, draw, discard, negation all work
- `[VERIFY]` Manual or automated test

### 4.8.16 — Implement setup command handlers
- `[NEW]` `src/domain/commands/setup-commands.js`
- `[VERIFY]` `node --check src/domain/commands/setup-commands.js`

### 4.8.17 — Add 22 setup handler prefixes to COMMAND_MODE_HANDLERS
- `[MOD]` `index.js`
- `[VERIFY]` `node --check index.js`

### 4.8.18 — Verify: full game setup works
- `[VERIFY]` Manual or automated test

### 4.8.19 — Implement DC play area command handlers
- `[NEW]` `src/domain/commands/dc-play-area-commands.js`
- `[VERIFY]` `node --check src/domain/commands/dc-play-area-commands.js`

### 4.8.20 — Add 26 DC play area handler prefixes to COMMAND_MODE_HANDLERS
- `[MOD]` `index.js`
- `[VERIFY]` `node --check index.js`

### 4.8.21 — Verify: DC actions work
- `[VERIFY]` Manual or automated test

### 4.8.22 — Implement combat reaction + interrupt command handlers
- `[NEW]` `src/domain/commands/combat-reaction-commands.js`
- All remaining 75+ handler prefixes
- `[VERIFY]` `node --check src/domain/commands/combat-reaction-commands.js`

### 4.8.23 — Add remaining 75+ combat reaction/interrupt prefixes to COMMAND_MODE_HANDLERS
- `[MOD]` `index.js`
- `[VERIFY]` `node --check index.js`

### 4.8.24 — Verify: all 255 handlers running in command mode
- `[VERIFY]` Full game playable end-to-end

### 4.8.25 — Remove state blob persistence from `saveGames()`
- `[MOD]` `src/game-state.js`
- State fully derived from event replay + snapshots; `games` table = read cache only
- `[VERIFY]` `node --check src/game-state.js`

### 4.8.26 — Remove state blob persistence from db.js
- `[MOD]` `src/db.js`
- `[VERIFY]` `node --check src/db.js`

### 4.8.27 — Verify: bot runs with events-only persistence
- `[VERIFY]` All games complete, recovery via snapshot + replay

### 4.8.28 — Remove old `computeDiff`/`captureSnapshot` audit trail
- `[MOD]` `src/event-log.js` (or wherever these live)
- `[VERIFY]` `node --check`

### 4.8.29 — Remove `game_events` table writes
- `[MOD]` `src/db.js`
- `[VERIFY]` `node --check src/db.js`

### 4.8.30 — Remove `DUAL_WRITE_MODE` flag
- `[MOD]` `src/game-state.js`
- `[VERIFY]` `node --check src/game-state.js`

### 4.8.31 — Remove old recovery heuristic functions
- `[MOD]` `src/handlers/recover.js` (or equivalent)
- `[VERIFY]` `node --check`

### 4.8.32 — Update `src/engine/recovery.js` to use `recoverGameFromEvents`
- `[MOD]` `src/engine/recovery.js`
- `[VERIFY]` `node --check src/engine/recovery.js`

### 4.8.33 — Final verification: all tests pass, clean codebase
- `[VERIFY]` `node --check index.js && node --test`

---

## Summary

| Phase | Tasks | New Files | Modify Files | Tests |
|-------|-------|-----------|--------------|-------|
| 4.1 Event Store Foundation | 50 | 7 | 6 (db.js ×7 + events.js ×1) | 20 |
| 4.2 Event Vocabulary | 27 | 11 | 8 | 5 |
| 4.3 Reducers | 89 | 12 | 28 | 25 |
| 4.4 Strangler Fig | 37 | 5 | 8 | 10 |
| 4.5 Sagas | 22 | 5 | 7 | 8 |
| 4.6 Projections | 13 | 3 | 4 | 4 |
| 4.7 Commands | 29 | 8 | 7 | 10 |
| 4.8 Migration | 33 | 5 | 11 | 0 (manual verify) |
| **TOTAL** | **300** | **56** | **79** | **82** |
