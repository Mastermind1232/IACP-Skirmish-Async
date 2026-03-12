# Phase 4: Full DDD + Event Sourcing Migration

## Context

Phase 3 built the foundation: headless context, available-actions, AI player, event log (audit diffs), 81 functions extracted from index.js into 13 engine modules. But the architecture is NOT event-sourced — handlers directly mutate `game.field = value`, the state blob is the source of truth, and recovery uses heuristic inspection.

**Goal:** Events as source of truth. State derived by replaying events. Commands in, events out. Recovery = snapshot + replay. 70+ `pending*` workflows become explicit sagas. Discord UI driven by event subscriptions.

**Migration:** Strangler fig — wrap existing handlers to emit domain events alongside mutations (dual-write), verify replay produces identical state, then flip handlers to command-first mode one by one.

**Codebase facts:** 255 handler registrations, 19 context groups, 202 dep keys, 85 round-object flags, 73 round-null flags, 75 activation-msgId flags, 40+ pendingCombat fields.

---

## PHASE 4.1: Event Store Foundation

### Step 4.1.1: Create DomainEvent factory

**New file:** `src/domain/events.js`

```js
// DomainEvent shape:
// { type, gameId, seq, timestamp, playerId, correlationId, aggregateVersion, payload }

const seqCounters = new Map(); // gameId → next seq (in-memory, loaded from DB in 4.1.3)

export function createDomainEvent(type, gameId, playerId, payload, meta = {}) {
  const seq = (seqCounters.get(gameId) || 0) + 1;
  seqCounters.set(gameId, seq);
  return {
    type,
    gameId,
    seq,
    timestamp: new Date().toISOString(),
    playerId: playerId || null,
    correlationId: meta.correlationId || null,
    aggregateVersion: meta.aggregateVersion || seq,
    payload: payload || {},
  };
}

export function resetSeqCounter(gameId, startSeq) { seqCounters.set(gameId, startSeq); }
export function getSeqCounter(gameId) { return seqCounters.get(gameId) || 0; }
```

**Verify:** `node --check src/domain/events.js`

### Step 4.1.2: Write DomainEvent unit test

**New file:** `tests/domain/events.test.js`

Test:
- `createDomainEvent` returns all required fields
- seq auto-increments per gameId
- Different gameIds have independent seq counters
- `resetSeqCounter` works
- Payload is preserved exactly

**Verify:** `node --test tests/domain/events.test.js`

### Step 4.1.3: Create domain_events DB table

**Modify:** `src/db.js` — add to `initDb()`:

```sql
CREATE TABLE IF NOT EXISTS domain_events (
  id SERIAL PRIMARY KEY,
  game_id TEXT NOT NULL,
  seq INT NOT NULL,
  type TEXT NOT NULL,
  correlation_id TEXT,
  player_id TEXT,
  aggregate_version INT NOT NULL,
  timestamp TIMESTAMPTZ DEFAULT NOW(),
  payload JSONB NOT NULL,
  UNIQUE(game_id, seq)
);
CREATE INDEX IF NOT EXISTS idx_domain_events_game_seq ON domain_events (game_id, seq);
CREATE INDEX IF NOT EXISTS idx_domain_events_game_type ON domain_events (game_id, type);
```

**Verify:** `node --check src/db.js`

### Step 4.1.4: Create EventStore module

**New file:** `src/domain/event-store.js`

```js
import { insertDomainEvent, getDomainEvents, getLatestDomainSeq } from '../db.js';

export async function appendEvents(gameId, events, expectedVersion = null) {
  // Optimistic concurrency: if expectedVersion provided, check DB max seq matches
  if (expectedVersion !== null) {
    const currentSeq = await getLatestDomainSeq(gameId);
    if (currentSeq !== expectedVersion) {
      throw new Error(`Concurrency conflict: expected ${expectedVersion}, got ${currentSeq}`);
    }
  }
  for (const event of events) {
    await insertDomainEvent(gameId, event);
  }
}

export async function getEvents(gameId, { afterSeq = 0, limit = 1000 } = {}) {
  return getDomainEvents(gameId, afterSeq, limit);
}

export async function getLatestSeq(gameId) {
  return getLatestDomainSeq(gameId);
}

export async function getAllEventsSince(gameId, seq) {
  return getDomainEvents(gameId, seq, 10000);
}
```

**Modify:** `src/db.js` — add `insertDomainEvent(gameId, event)`, `getDomainEvents(gameId, afterSeq, limit)`, `getLatestDomainSeq(gameId)` query functions.

**Verify:** `node --check src/domain/event-store.js && node --check src/db.js`

### Step 4.1.5: Write EventStore unit test

**New file:** `tests/domain/event-store.test.js`

Test (using in-memory stubs if DB not available):
- `appendEvents` stores events
- `getEvents` retrieves in order
- `getLatestSeq` returns correct value
- Optimistic concurrency rejects stale writes

**Verify:** `node --test tests/domain/event-store.test.js`

### Step 4.1.6: Create game_snapshots DB table

**Modify:** `src/db.js` — add to `initDb()`:

```sql
CREATE TABLE IF NOT EXISTS game_snapshots (
  id SERIAL PRIMARY KEY,
  game_id TEXT NOT NULL,
  version INT NOT NULL,
  state JSONB NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(game_id, version)
);
CREATE INDEX IF NOT EXISTS idx_game_snapshots_game ON game_snapshots (game_id, version DESC);
```

Add `insertSnapshot(gameId, version, state)`, `getLatestSnapshot(gameId)`, `deleteSnapshots(gameId)` query functions.

**Verify:** `node --check src/db.js`

### Step 4.1.7: Create SnapshotStore module

**New file:** `src/domain/snapshot-store.js`

```js
import { insertSnapshot, getLatestSnapshot as dbGetLatestSnapshot, deleteSnapshots as dbDeleteSnapshots } from '../db.js';

export const SNAPSHOT_INTERVAL = 50; // snapshot every N events

export async function saveSnapshot(gameId, version, state) {
  const stripped = JSON.parse(JSON.stringify(state));
  delete stripped.undoStack;
  delete stripped.moveGridMessageIds;
  await insertSnapshot(gameId, version, stripped);
}

export async function loadLatestSnapshot(gameId) {
  return dbGetLatestSnapshot(gameId); // { version, state } or null
}

export async function deleteSnapshots(gameId) {
  return dbDeleteSnapshots(gameId);
}

export function shouldSnapshot(version) {
  return version > 0 && version % SNAPSHOT_INTERVAL === 0;
}
```

**Verify:** `node --check src/domain/snapshot-store.js`

### Step 4.1.8: Write SnapshotStore unit test

**New file:** `tests/domain/snapshot-store.test.js`

Test (with stubs):
- `saveSnapshot` strips transient fields
- `loadLatestSnapshot` returns null when none exists
- `shouldSnapshot` returns true at intervals

**Verify:** `node --test tests/domain/snapshot-store.test.js`

### Step 4.1.9: Create GameAggregate class

**New file:** `src/domain/game-aggregate.js`

```js
import { createDomainEvent } from './events.js';

export class GameAggregate {
  constructor(gameId, state = null, version = 0) {
    this.gameId = gameId;
    this.state = state;
    this.version = version;
    this.uncommittedEvents = [];
  }

  static reconstitute(gameId, snapshot, events, reducer) {
    let state = snapshot?.state || null;
    let version = snapshot?.version || 0;
    for (const event of events) {
      state = reducer(state, event);
      version = event.seq;
    }
    return new GameAggregate(gameId, state, version);
  }

  applyEvent(event, reducer) {
    this.state = reducer(this.state, event);
    this.version = event.seq;
  }

  recordEvent(type, playerId, payload) {
    const event = createDomainEvent(type, this.gameId, playerId, payload, {
      aggregateVersion: this.version + this.uncommittedEvents.length + 1,
    });
    this.uncommittedEvents.push(event);
    return event;
  }

  flushEvents() {
    const events = [...this.uncommittedEvents];
    this.uncommittedEvents = [];
    return events;
  }

  getState() { return this.state; }
  getVersion() { return this.version; }
}
```

**Verify:** `node --check src/domain/game-aggregate.js`

### Step 4.1.10: Write GameAggregate unit test

**New file:** `tests/domain/game-aggregate.test.js`

Test:
- Constructor sets fields correctly
- `recordEvent` adds to uncommittedEvents, auto-increments version
- `flushEvents` returns and clears uncommittedEvents
- `reconstitute` replays events through reducer to build state
- `applyEvent` updates state and version

**Verify:** `node --test tests/domain/game-aggregate.test.js`

### Step 4.1.11: Create GameRepository class

**New file:** `src/domain/game-repository.js`

```js
import { GameAggregate } from './game-aggregate.js';
import * as eventStore from './event-store.js';
import * as snapshotStore from './snapshot-store.js';

export class GameRepository {
  constructor(reducer) {
    this.reducer = reducer;
  }

  async load(gameId) {
    const snapshot = await snapshotStore.loadLatestSnapshot(gameId);
    const afterSeq = snapshot?.version || 0;
    const events = await eventStore.getAllEventsSince(gameId, afterSeq);
    return GameAggregate.reconstitute(gameId, snapshot, events, this.reducer);
  }

  async save(aggregate) {
    const events = aggregate.flushEvents();
    if (events.length === 0) return;
    await eventStore.appendEvents(aggregate.gameId, events, null);
    // Check if we should take a snapshot
    const newVersion = aggregate.getVersion() + events.length;
    if (snapshotStore.shouldSnapshot(newVersion)) {
      // Apply events to get final state, then snapshot
      let state = aggregate.getState();
      for (const e of events) state = this.reducer(state, e);
      await snapshotStore.saveSnapshot(aggregate.gameId, newVersion, state);
    }
  }
}
```

**Verify:** `node --check src/domain/game-repository.js`

### Step 4.1.12: Write GameRepository unit test

**New file:** `tests/domain/game-repository.test.js`

Test (with mock event-store/snapshot-store):
- `load` returns aggregate with reconstituted state
- `load` returns empty aggregate when no events exist
- `save` appends events to store
- `save` takes snapshot at SNAPSHOT_INTERVAL

**Verify:** `node --test tests/domain/game-repository.test.js`

---

## PHASE 4.2: Domain Event Vocabulary

### Step 4.2.1: Phase transition event definitions

**New file:** `src/domain/events/phase-events.js`

Define 16 event types as exported constants + payload schemas:

```js
export const PHASE_EVENTS = {
  GameCreated: 'GameCreated',
  MapSelected: 'MapSelected',
  InitiativeDetermined: 'InitiativeDetermined',
  DeploymentZoneChosen: 'DeploymentZoneChosen',
  DeploymentCompleted: 'DeploymentCompleted',
  AttachmentsConfirmed: 'AttachmentsConfirmed',
  CommandCardsDrawn: 'CommandCardsDrawn',
  RoundStarted: 'RoundStarted',
  ActivationPhaseStarted: 'ActivationPhaseStarted',
  ActivationPhaseEnded: 'ActivationPhaseEnded',
  EndOfRoundStarted: 'EndOfRoundStarted',
  RoundEnded: 'RoundEnded',
  GameEnded: 'GameEnded',
  PhaseGateOpened: 'PhaseGateOpened',
  PhaseGatePlayerReady: 'PhaseGatePlayerReady',
  PhaseGateCleared: 'PhaseGateCleared',
};

// Payload schemas (for validation):
export const PHASE_EVENT_SCHEMAS = {
  GameCreated: { required: ['player1Id', 'player2Id', 'generalId'] },
  MapSelected: { required: ['mapId', 'missionVariant'] },
  // ...
};
```

**Verify:** `node --check src/domain/events/phase-events.js`

### Step 4.2.2: Combat event definitions

**New file:** `src/domain/events/combat-events.js`

11 event types: `CombatDeclared`, `CombatPlayerReady`, `CombatDiceRolled`, `CombatRerollPerformed`, `CombatSurgeSpent`, `CombatPassiveApplied`, `CombatTokenApplied`, `CombatDamageCalculated`, `CombatResolved`, `CombatCancelled`, `CleaveTargetSelected`.

Each with payload schema documenting required/optional fields. `CombatDeclared` payload matches the 24+ base fields from `game.pendingCombat` creation in `combat.js:1069-1107`.

**Verify:** `node --check src/domain/events/combat-events.js`

### Step 4.2.3: Movement event definitions

**New file:** `src/domain/events/movement-events.js`

6 event types: `MovementStarted`, `MovementPointsAdjusted`, `FigureMoved`, `MovementCompleted`, `MovementCancelled`, `FigurePushed`.

**Verify:** `node --check src/domain/events/movement-events.js`

### Step 4.2.4: Activation event definitions

**New file:** `src/domain/events/activation-events.js`

5 event types: `DcActivated`, `DcActionPerformed`, `DcEndedActivation`, `ActivationCleanedUp`, `ActivationTurnPassed`.

`ActivationCleanedUp` payload includes the 75 ACTIVATION_MSGID_FLAGS, 5 ACTIVATION_FIGKEY_FLAGS, 6 ACTIVATION_PLAYERNUM_FLAGS, and 5 ACTIVATION_SCALAR_FLAGS that are reset (from `src/game/activation-state.js`).

**Verify:** `node --check src/domain/events/activation-events.js`

### Step 4.2.5: CC/Hand event definitions

**New file:** `src/domain/events/hand-events.js`

7 event types: `DeckShuffled`, `CardsDrawn`, `CardPlayed`, `CardDiscarded`, `NegationAttempted`, `NegationResolved`, `SquadSubmitted`.

**Verify:** `node --check src/domain/events/hand-events.js`

### Step 4.2.6: Figure state event definitions

**New file:** `src/domain/events/figure-events.js`

9 event types: `FigureDeployed`, `FigureDamaged`, `FigureHealed`, `FigureDefeated`, `FigureStrained`, `ConditionApplied`, `ConditionRemoved`, `PowerTokenGained`, `PowerTokenSpent`.

**Verify:** `node --check src/domain/events/figure-events.js`

### Step 4.2.7: VP/Objectives event definitions

**New file:** `src/domain/events/vp-events.js`

5 event types: `VpAwarded`, `VpDeducted`, `ObjectiveClaimed`, `TerminalControlled`, `CrateCollected`.

**Verify:** `node --check src/domain/events/vp-events.js`

### Step 4.2.8: Setup/Deployment event definitions

**New file:** `src/domain/events/setup-events.js`

5 event types: `MapTypeChosen`, `MapConfirmed`, `DraftRandomStarted`, `FigurePlaced`, `AttachmentPlaced`.

**Verify:** `node --check src/domain/events/setup-events.js`

### Step 4.2.9: Ability/Interrupt event definitions

**New file:** `src/domain/events/ability-events.js`

6 event types: `AbilityTriggered`, `AbilityResolved`, `InterruptPrompted`, `InterruptResolved`, `StartOfRoundEffectRun`, `EndOfRoundEffectRun`.

**Verify:** `node --check src/domain/events/ability-events.js`

### Step 4.2.10: Event registry and validation

**New file:** `src/domain/events/index.js`

- Re-exports all event modules
- Builds `DOMAIN_EVENT_TYPES` enum from all exports (70 types total)
- `validateEvent(event)` — checks type exists, required payload fields present, returns `{ valid, errors }`
- `getAllEventTypes()` — returns sorted list of all type names

**Verify:** `node --check src/domain/events/index.js`

### Step 4.2.11: Event vocabulary unit tests

**New file:** `tests/domain/event-types.test.js`

Test:
- All 70 event types are registered in `DOMAIN_EVENT_TYPES`
- Each event type can be created via `createDomainEvent`
- Each event type serializes/deserializes cleanly (JSON round-trip)
- `validateEvent` accepts valid events, rejects missing required fields
- `getAllEventTypes()` returns expected count

**Verify:** `node --test tests/domain/event-types.test.js`

---

## PHASE 4.3: Event Reducers

### Step 4.3.1: Core reducer framework

**New file:** `src/domain/reducer/index.js`

```js
import { phaseReducerHandlers } from './phase-reducer.js';
import { combatReducerHandlers } from './combat-reducer.js';
import { movementReducerHandlers } from './movement-reducer.js';
import { activationReducerHandlers } from './activation-reducer.js';
import { figureReducerHandlers } from './figure-reducer.js';
import { handReducerHandlers } from './hand-reducer.js';
import { vpReducerHandlers } from './vp-reducer.js';
import { setupReducerHandlers } from './setup-reducer.js';
import { abilityReducerHandlers } from './ability-reducer.js';

const ALL_HANDLERS = {
  ...phaseReducerHandlers,
  ...combatReducerHandlers,
  ...movementReducerHandlers,
  ...activationReducerHandlers,
  ...figureReducerHandlers,
  ...handReducerHandlers,
  ...vpReducerHandlers,
  ...setupReducerHandlers,
  ...abilityReducerHandlers,
};

export function gameReducer(state, event) {
  const handler = ALL_HANDLERS[event.type];
  if (!handler) {
    console.warn(`[reducer] No handler for event type: ${event.type}`);
    return state;
  }
  const cloned = structuredClone(state);
  return handler(cloned, event.payload, event);
}

export function getRegisteredReducerTypes() {
  return Object.keys(ALL_HANDLERS);
}
```

**Verify:** `node --check src/domain/reducer/index.js`

### Step 4.3.2: Phase reducer — GameCreated, MapSelected, InitiativeDetermined

**New file:** `src/domain/reducer/phase-reducer.js`

Handlers for the first 3 phase events:
- `GameCreated` → sets gameId, player1Id, player2Id, generalId, gameCategoryId, phase='map_selection', initializes VP objects, empty DcLists
- `MapSelected` → sets selectedMap, selectedMission, phase='initiative'
- `InitiativeDetermined` → sets initiativePlayerId, initiativePlayerNum, phase='zone_selection'

**Verify:** `node --check src/domain/reducer/phase-reducer.js`

### Step 4.3.3: Phase reducer — DeploymentZoneChosen through CommandCardsDrawn

**Modify:** `src/domain/reducer/phase-reducer.js`

Add handlers:
- `DeploymentZoneChosen` → sets player deployment zones, phase='deployment'
- `DeploymentCompleted` → sets initiativePlayerDeployed/nonInitiativePlayerDeployed
- `AttachmentsConfirmed` → sets setupAttachmentConfirmed
- `CommandCardsDrawn` → marks player CC drawn

**Verify:** `node --check src/domain/reducer/phase-reducer.js`

### Step 4.3.4: Phase reducer — RoundStarted (the big one)

**Modify:** `src/domain/reducer/phase-reducer.js`

`RoundStarted` handler:
- Sets `currentRound` from payload
- Sets `phase='round_active'`, `roundPhase='start_of_round'`
- Resets ALL 85 ROUND_OBJECT_FLAGS to `{}`
- Resets ALL 73 ROUND_NULL_FLAGS to `null`
- Resets 3 ROUND_ARRAY_FLAGS to `[]`
- Resets 5 ROUND_FALSE_FLAGS to `false`
- Deletes 8 ROUND_DELETE_FLAGS
- Import flag lists from `src/game/activation-state.js`

**Verify:** `node --check src/domain/reducer/phase-reducer.js` + unit test that RoundStarted resets all flags

### Step 4.3.5: Phase reducer — remaining phase events

**Modify:** `src/domain/reducer/phase-reducer.js`

Add handlers for:
- `ActivationPhaseStarted` → sets roundPhase='activation', currentActivationTurnPlayerId, activations remaining
- `ActivationPhaseEnded` → sets both players' activationPhaseEnded
- `EndOfRoundStarted` → sets roundPhase='end_of_round'
- `RoundEnded` → cleanup
- `GameEnded` → sets ended=true, winnerId, phase='ended'
- `PhaseGateOpened` → creates phaseGate object
- `PhaseGatePlayerReady` → sets p1Ready/p2Ready on phaseGate
- `PhaseGateCleared` → deletes phaseGate

Export `phaseReducerHandlers` object mapping all 16 types to handlers.

**Verify:** `node --check src/domain/reducer/phase-reducer.js`

### Step 4.3.6: Phase reducer unit tests

**New file:** `tests/domain/reducer/phase-reducer.test.js`

Test full phase lifecycle: `GameCreated` → `MapSelected` → `InitiativeDetermined` → `DeploymentZoneChosen` → `DeploymentCompleted` → `RoundStarted` → verify state at each step. Test `RoundStarted` resets all 170+ flags. Test `PhaseGate*` lifecycle.

**Verify:** `node --test tests/domain/reducer/phase-reducer.test.js`

### Step 4.3.7: Combat reducer

**New file:** `src/domain/reducer/combat-reducer.js`

Handlers for all 11 combat events:
- `CombatDeclared` → creates `pendingCombat` object (24+ base fields matching `combat.js:1069-1107`)
- `CombatPlayerReady` → sets p1Ready/p2Ready
- `CombatDiceRolled` → sets attackRoll, defenseRoll
- `CombatRerollPerformed` → mutates die face at index
- `CombatSurgeSpent` → marks surge spent, applies surge effect
- `CombatPassiveApplied` → applies passive modifier
- `CombatTokenApplied` → applies token effect
- `CombatDamageCalculated` → stores computed damage values
- `CombatResolved` → applies damage to target, deletes pendingCombat
- `CombatCancelled` → deletes pendingCombat
- `CleaveTargetSelected` → applies cleave damage to secondary target

Export `combatReducerHandlers`.

**Verify:** `node --check src/domain/reducer/combat-reducer.js`

### Step 4.3.8: Combat reducer unit tests

**New file:** `tests/domain/reducer/combat-reducer.test.js`

Test full combat lifecycle: `CombatDeclared` → `CombatPlayerReady` (×2) → `CombatDiceRolled` → `CombatSurgeSpent` → `CombatResolved`. Verify pendingCombat created/destroyed, damage applied.

**Verify:** `node --test tests/domain/reducer/combat-reducer.test.js`

### Step 4.3.9: Movement reducer

**New file:** `src/domain/reducer/movement-reducer.js`

Handlers for 6 movement events:
- `MovementStarted` → creates moveInProgress entry
- `MovementPointsAdjusted` → updates MP
- `FigureMoved` → updates figurePositions, deducts MP
- `MovementCompleted` → deletes moveInProgress entry
- `MovementCancelled` → reverts position, deletes moveInProgress
- `FigurePushed` → updates figurePositions (no MP cost)

Export `movementReducerHandlers`.

**Verify:** `node --check src/domain/reducer/movement-reducer.js`

### Step 4.3.10: Movement reducer unit tests

**New file:** `tests/domain/reducer/movement-reducer.test.js`

Test: movement start → move to 3 spaces → complete. Verify positions update, MP tracks.

**Verify:** `node --test tests/domain/reducer/movement-reducer.test.js`

### Step 4.3.11: Activation reducer

**New file:** `src/domain/reducer/activation-reducer.js`

Handlers for 5 activation events:
- `DcActivated` → sets dcActionsData, adds to activatedDcIndices
- `DcActionPerformed` → decrements remaining actions
- `DcEndedActivation` → marks DC finished
- `ActivationCleanedUp` → resets 75 ACTIVATION_MSGID_FLAGS, 5 FIGKEY_FLAGS, 6 PLAYERNUM_FLAGS, 5 SCALAR_FLAGS (import from activation-state.js)
- `ActivationTurnPassed` → switches currentActivationTurnPlayerId

Export `activationReducerHandlers`.

**Verify:** `node --check src/domain/reducer/activation-reducer.js`

### Step 4.3.12: Activation reducer unit tests

**New file:** `tests/domain/reducer/activation-reducer.test.js`

Test: activate DC → perform 2 actions → end turn → cleanup. Verify action count, turn switching, flag reset.

**Verify:** `node --test tests/domain/reducer/activation-reducer.test.js`

### Step 4.3.13: Figure reducer

**New file:** `src/domain/reducer/figure-reducer.js`

Handlers for 9 figure events:
- `FigureDeployed` → adds to figurePositions, sets orientation
- `FigureDamaged` → reduces HP in dcHealthState/healthState
- `FigureHealed` → increases HP
- `FigureDefeated` → removes from figurePositions, adds to depleted lists, awards VP
- `FigureStrained` → increments figureStrain
- `ConditionApplied` → adds to figureConditions
- `ConditionRemoved` → removes from figureConditions
- `PowerTokenGained` → adds to figurePowerTokens
- `PowerTokenSpent` → removes from figurePowerTokens

Export `figureReducerHandlers`.

**Verify:** `node --check src/domain/reducer/figure-reducer.js`

### Step 4.3.14: Figure reducer unit tests

**New file:** `tests/domain/reducer/figure-reducer.test.js`

Test: deploy figure → damage → apply condition → defeat. Verify positions, HP, conditions, defeat tracking.

**Verify:** `node --test tests/domain/reducer/figure-reducer.test.js`

### Step 4.3.15: Hand reducer

**New file:** `src/domain/reducer/hand-reducer.js`

Handlers for 7 hand events:
- `DeckShuffled` → shuffles ccDeck
- `CardsDrawn` → moves cards from ccDeck to ccHand
- `CardPlayed` → removes from ccHand
- `CardDiscarded` → moves from ccHand to ccDiscard
- `NegationAttempted` → sets pendingNegation
- `NegationResolved` → resolves or discards, clears pendingNegation
- `SquadSubmitted` → sets playerSquad

Export `handReducerHandlers`.

**Verify:** `node --check src/domain/reducer/hand-reducer.js`

### Step 4.3.16: Hand reducer unit tests

**New file:** `tests/domain/reducer/hand-reducer.test.js`

Test: shuffle → draw 5 → play card → discard card. Verify hand, deck, discard piles.

**Verify:** `node --test tests/domain/reducer/hand-reducer.test.js`

### Step 4.3.17: VP reducer

**New file:** `src/domain/reducer/vp-reducer.js`

Handlers for 5 VP events. Each modifies player1VP/player2VP `.total`, `.kills`, or `.objectives`.

Export `vpReducerHandlers`.

**Verify:** `node --check src/domain/reducer/vp-reducer.js`

### Step 4.3.18: Setup reducer

**New file:** `src/domain/reducer/setup-reducer.js`

Handlers for 5 setup events. `FigurePlaced` adds to figurePositions, `AttachmentPlaced` adds to dcAttachments.

Export `setupReducerHandlers`.

**Verify:** `node --check src/domain/reducer/setup-reducer.js`

### Step 4.3.19: Ability reducer

**New file:** `src/domain/reducer/ability-reducer.js`

Handlers for 6 ability events. `InterruptPrompted` sets the relevant pending* field. `InterruptResolved` clears it and applies effects. `StartOfRoundEffectRun`/`EndOfRoundEffectRun` apply round lifecycle effects.

Export `abilityReducerHandlers`.

**Verify:** `node --check src/domain/reducer/ability-reducer.js`

### Step 4.3.20: VP, Setup, Ability reducer unit tests

**New file:** `tests/domain/reducer/misc-reducer.test.js`

Combined tests for VP (award/deduct), Setup (place figure, attach), Ability (trigger/resolve interrupt).

**Verify:** `node --test tests/domain/reducer/misc-reducer.test.js`

### Step 4.3.21: Master reducer integration test

**New file:** `tests/domain/reducer/integration.test.js`

Test a complete mini-game lifecycle through the master `gameReducer`:
1. `GameCreated` → `MapSelected` → `InitiativeDetermined` → `DeploymentZoneChosen`
2. `FigureDeployed` (×4) → `DeploymentCompleted` (×2)
3. `RoundStarted` → `ActivationPhaseStarted`
4. `DcActivated` → `FigureMoved` → `DcEndedActivation` → `ActivationCleanedUp`
5. `ActivationPhaseEnded` → `EndOfRoundStarted` → `RoundEnded`
6. `GameEnded`

Verify state at each step matches expected shape.

**Verify:** `node --test tests/domain/reducer/integration.test.js`

---

## PHASE 4.4: Strangler Fig Adapter Layer

### Step 4.4.1: Create DiffTranslator — phase detection

**New file:** `src/domain/diff-translator.js`

Start with phase transition detection only:

```js
import { createDomainEvent } from './events.js';

export function translateDiffToEvents(handlerKey, diff, context) {
  const events = [];
  if (!diff) return events;
  const { set, deleted } = diff;
  const { gameId, playerId, before, after } = context;

  // Phase changes
  if (set?.phase && set.phase !== before?.phase) {
    events.push(...translatePhaseChange(before, after, context));
  }

  // Phase gate changes
  if (set?.phaseGate && !before?.phaseGate) {
    events.push(createDomainEvent('PhaseGateOpened', gameId, playerId, { gateType: set.phaseGate.phase }));
  }

  return events;
}

function translatePhaseChange(before, after, { gameId, playerId }) {
  // Map phase transitions to events
  // ...
}
```

**Verify:** `node --check src/domain/diff-translator.js`

### Step 4.4.2: DiffTranslator — combat detection

**Modify:** `src/domain/diff-translator.js`

Add detection:
- `pendingCombat` created → `CombatDeclared`
- `pendingCombat.p1Ready`/`p2Ready` changed → `CombatPlayerReady`
- `pendingCombat.attackRoll` set → `CombatDiceRolled`
- `pendingCombat` deleted → `CombatResolved`

**Verify:** `node --check src/domain/diff-translator.js`

### Step 4.4.3: DiffTranslator — movement detection

**Modify:** `src/domain/diff-translator.js`

Add detection:
- `figurePositions` changed (figure moved) → `FigureMoved`
- `moveInProgress` created → `MovementStarted`
- `moveInProgress` deleted → `MovementCompleted`

**Verify:** `node --check src/domain/diff-translator.js`

### Step 4.4.4: DiffTranslator — figure state detection

**Modify:** `src/domain/diff-translator.js`

Add detection:
- VP increased → `VpAwarded`
- Figure removed from figurePositions → `FigureDefeated`
- Figure condition added → `ConditionApplied`
- `currentActivationTurnPlayerId` changed → `ActivationTurnPassed`

**Verify:** `node --check src/domain/diff-translator.js`

### Step 4.4.5: DiffTranslator unit tests

**New file:** `tests/domain/diff-translator.test.js`

Test each detection rule with mock before/after diffs. Golden-file style: given this diff, expect these events.

**Verify:** `node --test tests/domain/diff-translator.test.js`

### Step 4.4.6: Create EventEmittingDispatcher

**New file:** `src/domain/dispatcher.js`

```js
import { captureSnapshot, computeDiff } from '../event-log.js';
import { translateDiffToEvents } from './diff-translator.js';
import { appendEvents } from './event-store.js';

export async function dispatchWithEvents(handlerFn, interaction, ctx, meta) {
  const { gameId, handlerKey, playerId, getGame } = meta;

  // 1. Before snapshot
  const before = gameId ? captureSnapshot(getGame(gameId)) : null;

  // 2. Run existing handler unchanged
  if (ctx) await handlerFn(interaction, ctx);
  else await handlerFn(interaction);

  // 3. After snapshot + diff
  if (!before || !gameId) return;
  const after = captureSnapshot(getGame(gameId));
  const diff = computeDiff(before, after);
  if (!diff) return;

  // 4. Translate diff → domain events
  const correlationId = `${handlerKey}_${Date.now()}`;
  const events = translateDiffToEvents(handlerKey, diff, {
    gameId, playerId, before, after, correlationId,
  });

  // 5. Persist (non-blocking)
  if (events.length > 0) {
    appendEvents(gameId, events).catch(err =>
      console.error('[domain-events]', err.message));
  }
}
```

**Verify:** `node --check src/domain/dispatcher.js`

### Step 4.4.7: Wire dispatcher into button dispatch

**Modify:** `index.js` — replace button dispatch event-capture block (lines ~3116-3136) with call to `dispatchWithEvents`. Import `dispatchWithEvents` from `src/domain/dispatcher.js`.

The handler call + event capture becomes:
```js
await dispatchWithEvents(_handler, interaction, _ctx, {
  gameId: _evtGameId, handlerKey: buttonKey,
  playerId: interaction.user.id, getGame,
});
```

Keep the existing `game_events` audit trail alongside (dual-write).

**Verify:** `node --check index.js` + all 96 tests pass + bot functions identically.

### Step 4.4.8: Wire dispatcher into select menu dispatch

**Modify:** `index.js` — replace select menu event-capture blocks (both space-select overflow branch ~lines 3020-3043 and table-driven branch ~lines 3055-3089) with `dispatchWithEvents`.

**Verify:** `node --check index.js` + all tests pass.

### Step 4.4.9: Create event verification harness

**New file:** `src/domain/event-verifier.js`

```js
import { gameReducer } from './reducer/index.js';
import { getAllEventsSince } from './event-store.js';
import { loadLatestSnapshot } from './snapshot-store.js';

export async function verifyGameEvents(gameId, actualState) {
  const snapshot = await loadLatestSnapshot(gameId);
  const events = await getAllEventsSince(gameId, snapshot?.version || 0);
  let replayedState = snapshot?.state || {};
  for (const event of events) {
    replayedState = gameReducer(replayedState, event);
  }
  return compareStates(replayedState, actualState);
}

function compareStates(replayed, actual) {
  const mismatches = [];
  // Compare top-level keys
  for (const key of new Set([...Object.keys(replayed), ...Object.keys(actual)])) {
    if (JSON.stringify(replayed[key]) !== JSON.stringify(actual[key])) {
      mismatches.push({ key, replayed: replayed[key], actual: actual[key] });
    }
  }
  return { match: mismatches.length === 0, mismatches };
}
```

**Verify:** `node --check src/domain/event-verifier.js`

### Step 4.4.10: Create verification CLI script

**New file:** `scripts/verify-events.js`

CLI tool: `node scripts/verify-events.js <gameId>` — loads game, replays events, reports mismatches.

**Verify:** `node --check scripts/verify-events.js`

### Step 4.4.11: Add dual-write config flag

**Modify:** `src/game-state.js`

Add `DUAL_WRITE_MODE` flag (default true). When true, `saveGames()` continues saving state blob AND domain events are captured. When false, only events.

**Verify:** `node --check src/game-state.js`

### Step 4.4.12: Extend headless harness with event capture

**Modify:** `src/headless/game-harness.js`

`submitAction()` return value gains `events` field:

```js
// After handler runs:
const events = translateDiffToEvents(handlerKey, diff, context);
return { game, messages, events };
```

**Verify:** `node --check src/headless/game-harness.js` + existing headless tests pass.

### Step 4.4.13: Write headless event assertion tests

**New file:** `tests/domain/headless-events.test.js`

Test via headless harness:
- Phase gate ready action → emits `PhaseGatePlayerReady` event
- Movement action → emits `FigureMoved` event
- End turn → emits `DcEndedActivation` event

**Verify:** `node --test tests/domain/headless-events.test.js`

---

## PHASE 4.5: Saga Coordinators

### Step 4.5.1: Create Saga base class

**New file:** `src/domain/sagas/saga.js`

```js
export class Saga {
  constructor(id, type, initialState = {}) {
    this.id = id;
    this.type = type;
    this.state = initialState;
    this.status = 'active'; // 'active' | 'completed' | 'cancelled'
    this.steps = [];        // [{stepName, data, timestamp}]
    this.createdAt = new Date().toISOString();
  }

  recordStep(stepName, data = {}) {
    this.steps.push({ stepName, data, timestamp: new Date().toISOString() });
  }

  complete() { this.status = 'completed'; }
  cancel() { this.status = 'cancelled'; }
  isActive() { return this.status === 'active'; }

  toJSON() { return { id: this.id, type: this.type, state: this.state, status: this.status, steps: this.steps, createdAt: this.createdAt }; }
  static fromJSON(json) {
    const saga = new Saga(json.id, json.type, json.state);
    saga.status = json.status;
    saga.steps = json.steps || [];
    saga.createdAt = json.createdAt;
    return saga;
  }
}
```

**Verify:** `node --check src/domain/sagas/saga.js`

### Step 4.5.2: Saga base class unit test

**New file:** `tests/domain/sagas/saga.test.js`

Test: create, recordStep, complete/cancel, toJSON/fromJSON round-trip.

**Verify:** `node --test tests/domain/sagas/saga.test.js`

### Step 4.5.3: Combat saga — state machine definition

**New file:** `src/domain/sagas/combat-saga.js`

```js
import { Saga } from './saga.js';

export const COMBAT_STATES = {
  DECLARED: 'DECLARED',
  READY_CHECK: 'READY_CHECK',
  ROLLING: 'ROLLING',
  REROLL_WINDOW: 'REROLL_WINDOW',
  SURGE_SPENDING: 'SURGE_SPENDING',
  RESOLUTION: 'RESOLUTION',
  COMPLETED: 'COMPLETED',
};

export class CombatSaga extends Saga {
  constructor(id, combatData) {
    super(id, 'combat', { phase: COMBAT_STATES.DECLARED, ...combatData });
  }

  // Transitions
  markReady(playerNum) { ... }
  bothReady() { return this.state.p1Ready && this.state.p2Ready; }
  startRolling() { this.state.phase = COMBAT_STATES.ROLLING; }
  setRolls(attackRoll, defenseRoll) { ... }
  enterRerollWindow() { this.state.phase = COMBAT_STATES.REROLL_WINDOW; }
  enterSurgeSpending() { this.state.phase = COMBAT_STATES.SURGE_SPENDING; }
  resolve(result) { this.state.phase = COMBAT_STATES.COMPLETED; this.complete(); }

  getExpectedActions() {
    switch (this.state.phase) {
      case COMBAT_STATES.DECLARED: return ['combat_ready'];
      case COMBAT_STATES.READY_CHECK: return ['combat_ready'];
      case COMBAT_STATES.ROLLING: return ['combat_roll'];
      case COMBAT_STATES.REROLL_WINDOW: return ['combat_reroll', 'combat_skip_reroll'];
      case COMBAT_STATES.SURGE_SPENDING: return ['combat_surge', 'combat_skip_surges'];
      case COMBAT_STATES.RESOLUTION: return ['combat_resolve'];
      default: return [];
    }
  }

  static fromPendingCombat(gameId, pendingCombat) {
    // Create from existing game.pendingCombat object
    return new CombatSaga(`${gameId}_combat`, { ...pendingCombat, phase: /* derive from state */ });
  }
}
```

**Verify:** `node --check src/domain/sagas/combat-saga.js`

### Step 4.5.4: Combat saga unit tests

**New file:** `tests/domain/sagas/combat-saga.test.js`

Test full combat lifecycle through saga state machine. Test `fromPendingCombat` creates correct saga from existing state. Test `getExpectedActions` returns correct actions per phase.

**Verify:** `node --test tests/domain/sagas/combat-saga.test.js`

### Step 4.5.5: Movement saga

**New file:** `src/domain/sagas/movement-saga.js`

States: `STARTED → CHOOSING_SPACE → MOVING → INTERRUPTED → COMPLETED`

Methods: `startMovement(figureKey, mp)`, `moveToSpace(coord)`, `interrupt(type)`, `resumeAfterInterrupt()`, `complete()`.

`getExpectedActions()` returns movement-specific actions per state.

**Verify:** `node --check src/domain/sagas/movement-saga.js`

### Step 4.5.6: Movement saga unit tests

**New file:** `tests/domain/sagas/movement-saga.test.js`

Test: start → choose spaces → complete. Test interrupt handling.

**Verify:** `node --test tests/domain/sagas/movement-saga.test.js`

### Step 4.5.7: Negation saga

**New file:** `src/domain/sagas/negation-saga.js`

States: `CC_PLAYED → NEGATION_WINDOW → RESOLVED`

Replaces `pendingNegation` field.

**Verify:** `node --check src/domain/sagas/negation-saga.js`

### Step 4.5.8: Generic interrupt saga

**New file:** `src/domain/sagas/interrupt-saga.js`

Config-driven pattern for 30+ `pending*` interrupt fields:

```js
export const INTERRUPT_CONFIG = {
  stillFaster: { pendingField: 'pendingStillFaster', handlerPrefix: 'still_faster_' },
  toughLuck: { pendingField: 'pendingToughLuck', handlerPrefix: 'tough_luck_' },
  lastResort: { pendingField: 'pendingLastResort', handlerPrefix: 'last_resort_' },
  // ... 30+ entries
};

export class InterruptSaga extends Saga {
  constructor(id, interruptType, playerNum, options) { ... }
  resolve(choice) { ... }
  getExpectedActions() { return [INTERRUPT_CONFIG[this.type].handlerPrefix + 'confirm', INTERRUPT_CONFIG[this.type].handlerPrefix + 'skip']; }
}
```

**Verify:** `node --check src/domain/sagas/interrupt-saga.js`

### Step 4.5.9: Interrupt saga unit tests

**New file:** `tests/domain/sagas/interrupt-saga.test.js`

Test 3 representative interrupts (stillFaster, toughLuck, fieldTactics) through generic saga.

**Verify:** `node --test tests/domain/sagas/interrupt-saga.test.js`

---

## PHASE 4.6: Projection System

### Step 4.6.1: State cache projection

**New file:** `src/domain/projections/state-cache.js`

```js
import { gameReducer } from '../reducer/index.js';

export class StateCacheProjection {
  constructor() { this.cache = new Map(); }

  apply(event) {
    const state = this.cache.get(event.gameId) || {};
    this.cache.set(event.gameId, gameReducer(state, event));
  }

  applyBatch(events) { for (const e of events) this.apply(e); }
  get(gameId) { return this.cache.get(gameId) || null; }
  set(gameId, state) { this.cache.set(gameId, state); }
  delete(gameId) { this.cache.delete(gameId); }
}
```

**Verify:** `node --check src/domain/projections/state-cache.js`

### Step 4.6.2: State cache projection unit test

**New file:** `tests/domain/projections/state-cache.test.js`

Test: apply events → get state matches reducer output. Test batch apply.

**Verify:** `node --test tests/domain/projections/state-cache.test.js`

### Step 4.6.3: Discord UI projection — scaffold

**New file:** `src/domain/projections/discord-projection.js`

Event → Discord message mapping scaffold. Initially handles 5-10 high-frequency events:

```js
const EVENT_HANDLERS = {
  RoundStarted: async (event, client, getGameState) => { /* round announcement */ },
  FigureDefeated: async (event, client, getGameState) => { /* defeat log */ },
  VpAwarded: async (event, client, getGameState) => { /* VP update */ },
  GameEnded: async (event, client, getGameState) => { /* game over message */ },
  CombatDeclared: async (event, client, getGameState) => { /* combat thread */ },
};

export async function handleEvent(event, client, getGameState) {
  const handler = EVENT_HANDLERS[event.type];
  if (handler) await handler(event, client, getGameState);
}
```

**Verify:** `node --check src/domain/projections/discord-projection.js`

### Step 4.6.4: Recovery projection (event replay)

**New file:** `src/domain/projections/recovery-projection.js`

```js
import { gameReducer } from '../reducer/index.js';
import { getAllEventsSince } from '../event-store.js';
import { loadLatestSnapshot } from '../snapshot-store.js';

export async function recoverGameFromEvents(gameId) {
  const snapshot = await loadLatestSnapshot(gameId);
  const events = await getAllEventsSince(gameId, snapshot?.version || 0);
  let state = snapshot?.state || {};
  for (const event of events) {
    state = gameReducer(state, event);
  }
  return { state, version: events.length > 0 ? events[events.length - 1].seq : (snapshot?.version || 0) };
}
```

**Verify:** `node --check src/domain/projections/recovery-projection.js`

### Step 4.6.5: Recovery projection unit test

**New file:** `tests/domain/projections/recovery.test.js`

Test: create game via events → recover → state matches. Test with snapshot mid-stream.

**Verify:** `node --test tests/domain/projections/recovery.test.js`

---

## PHASE 4.7: Command Layer

### Step 4.7.1: Command types definition

**New file:** `src/domain/commands/index.js`

```js
export const COMMAND_TYPES = {
  // Setup
  SelectMap: 'SelectMap', ConfirmMap: 'ConfirmMap',
  DetermineInitiative: 'DetermineInitiative', ChooseDeploymentZone: 'ChooseDeploymentZone',
  DeployFigure: 'DeployFigure', FinishDeployment: 'FinishDeployment',
  // Activation
  ActivateDc: 'ActivateDc', PerformAction: 'PerformAction',
  EndTurn: 'EndTurn', PassActivationTurn: 'PassActivationTurn',
  // Combat
  DeclareAttack: 'DeclareAttack', ReadyForCombat: 'ReadyForCombat',
  RollCombatDice: 'RollCombatDice', SpendSurge: 'SpendSurge',
  PerformReroll: 'PerformReroll', ResolveCombat: 'ResolveCombat',
  // Movement
  StartMovement: 'StartMovement', MoveToSpace: 'MoveToSpace', CompleteMovement: 'CompleteMovement',
  // CC
  PlayCommandCard: 'PlayCommandCard', DiscardCommandCard: 'DiscardCommandCard',
  DrawCommandCards: 'DrawCommandCards',
  // Phase gate
  PhaseGateReady: 'PhaseGateReady', PhaseGateUnready: 'PhaseGateUnready',
};

export function createCommand(type, gameId, playerId, payload) {
  return { type, gameId, playerId, payload, timestamp: new Date().toISOString() };
}
```

**Verify:** `node --check src/domain/commands/index.js`

### Step 4.7.2: Command router — customId to command mapping

**New file:** `src/domain/commands/command-router.js`

```js
import { COMMAND_TYPES, createCommand } from './index.js';

const PREFIX_TO_COMMAND = {
  'phase_gate_ready_': COMMAND_TYPES.PhaseGateReady,
  'phase_gate_unready_': COMMAND_TYPES.PhaseGateUnready,
  'end_turn_': COMMAND_TYPES.EndTurn,
  'pass_activation_turn_': COMMAND_TYPES.PassActivationTurn,
  'dc_activate_': COMMAND_TYPES.ActivateDc,
  'combat_ready_': COMMAND_TYPES.ReadyForCombat,
  'combat_roll_': COMMAND_TYPES.RollCombatDice,
  'attack_target_': COMMAND_TYPES.DeclareAttack,
  // ... more mappings
};

export function customIdToCommand(customId, handlerKey, playerId, gameId) {
  const commandType = PREFIX_TO_COMMAND[handlerKey];
  if (!commandType) return null; // Not yet mapped
  return createCommand(commandType, gameId, playerId, parsePayloadFromCustomId(customId, handlerKey));
}

function parsePayloadFromCustomId(customId, handlerKey) {
  // Extract gameId, msgId, coords, etc. from customId string
  // Pattern varies by handler prefix
  const parts = customId.replace(handlerKey, '').split('_');
  return { rawParts: parts, customId };
}
```

**Verify:** `node --check src/domain/commands/command-router.js`

### Step 4.7.3: Phase gate command handler

**New file:** `src/domain/commands/phase-gate-commands.js`

First command handler — lowest risk:

```js
export function handlePhaseGateReady(state, command) {
  if (!state.phaseGate) return { error: 'No phase gate active' };
  const playerNum = command.playerId === state.player1Id ? 1 : 2;
  const readyKey = playerNum === 1 ? 'p1Ready' : 'p2Ready';
  if (state.phaseGate[readyKey]) return { error: 'Already ready' };

  const events = [
    { type: 'PhaseGatePlayerReady', payload: { playerNum } },
  ];

  // If both will be ready, also emit PhaseGateCleared + phase advance
  const otherKey = playerNum === 1 ? 'p2Ready' : 'p1Ready';
  if (state.phaseGate[otherKey]) {
    events.push({ type: 'PhaseGateCleared', payload: { gateType: state.phaseGate.phase } });
    // Phase-specific advance events...
  }

  return { events };
}
```

**Verify:** `node --check src/domain/commands/phase-gate-commands.js`

### Step 4.7.4: Phase gate command handler unit tests

**New file:** `tests/domain/commands/phase-gate.test.js`

Test: ready P1 → emits PhaseGatePlayerReady. Ready P2 → emits PhaseGateCleared + advance. Already ready → error. No gate → error.

**Verify:** `node --test tests/domain/commands/phase-gate.test.js`

### Step 4.7.5: Activation command handlers

**New file:** `src/domain/commands/activation-commands.js`

`handleEndTurn`, `handlePassActivationTurn`, `handleActivateDc` — each validates against state and returns events.

**Verify:** `node --check src/domain/commands/activation-commands.js`

### Step 4.7.6: Activation command handler unit tests

**New file:** `tests/domain/commands/activation.test.js`

**Verify:** `node --test tests/domain/commands/activation.test.js`

### Step 4.7.7: Combat command handlers

**New file:** `src/domain/commands/combat-commands.js`

`handleDeclareAttack`, `handleReadyForCombat`, `handleRollCombatDice`, `handleSpendSurge`, `handlePerformReroll`.

**Verify:** `node --check src/domain/commands/combat-commands.js`

### Step 4.7.8: Combat command handler unit tests

**New file:** `tests/domain/commands/combat.test.js`

**Verify:** `node --test tests/domain/commands/combat.test.js`

### Step 4.7.9: Movement command handlers

**New file:** `src/domain/commands/movement-commands.js`

`handleStartMovement`, `handleMoveToSpace`, `handleCompleteMovement`.

**Verify:** `node --check src/domain/commands/movement-commands.js`

### Step 4.7.10: Movement command handler unit tests

**New file:** `tests/domain/commands/movement.test.js`

**Verify:** `node --test tests/domain/commands/movement.test.js`

### Step 4.7.11: Add COMMAND_MODE dispatch to index.js

**Modify:** `index.js`

Add `COMMAND_MODE_HANDLERS` set (initially containing just `phase_gate_ready_` and `phase_gate_unready_`). In button dispatch, before calling existing handler:

```js
if (COMMAND_MODE_HANDLERS.has(buttonKey)) {
  const command = customIdToCommand(interaction.customId, buttonKey, interaction.user.id, _evtGameId);
  if (command) {
    const repo = new GameRepository(gameReducer);
    const aggregate = await repo.load(_evtGameId);
    const result = commandHandlers[command.type](aggregate.getState(), command);
    if (result.error) { await interaction.followUp({ content: result.error, ephemeral: true }); return; }
    for (const e of result.events) aggregate.applyEvent(createDomainEvent(e.type, _evtGameId, interaction.user.id, e.payload), gameReducer);
    await repo.save(aggregate);
    // Still run old handler for Discord output (Phase 4.8 removes this)
    // ... fall through to existing dispatch
  }
}
```

**Verify:** `node --check index.js` + all tests pass + phase gate works in bot.

---

## PHASE 4.8: Full Migration

### Step 4.8.1: Create active game migration script

**New file:** `scripts/migrate-active-games.js`

For each active game: snapshot current state as version 0 into `game_snapshots`. All future events become domain events. Game continues seamlessly.

**Verify:** Run on test game. Game playable after migration.

### Step 4.8.2: Migrate phase gate handlers to command-only

Remove phase gate from old handler dispatch. `COMMAND_MODE_HANDLERS` now handles them fully — command → events → reducer → state → Discord projection.

**Verify:** Phase gate works end-to-end through command pipeline.

### Step 4.8.3: Migrate round transition handlers

Add `end_end_of_round_`, `end_start_of_round_`, `status_phase_` to `COMMAND_MODE_HANDLERS`. Implement corresponding command handlers.

**Verify:** Round transitions work through command pipeline.

### Step 4.8.4: Migrate activation handlers

Add `dc_activate_`, `end_turn_`, `dc_end_activation_`, `pass_activation_turn_`, `confirm_activate_`, `cancel_activate_` to `COMMAND_MODE_HANDLERS`.

**Verify:** Activation lifecycle works through command pipeline.

### Step 4.8.5: Migrate movement handlers

Add `move_mp_`, `move_pick_`, `move_letter_`, `move_back_`, `move_adjust_` to `COMMAND_MODE_HANDLERS`.

**Verify:** Full movement works through command pipeline.

### Step 4.8.6: Migrate combat core handlers

Add `attack_target_`, `combat_ready_`, `combat_roll_`, `combat_surge_`, `combat_reroll_`, `combat_resolve_ready_` to `COMMAND_MODE_HANDLERS`.

**Verify:** Full combat works through command pipeline.

### Step 4.8.7: Migrate CC/Hand handlers

Add 24 CC/hand handler prefixes to `COMMAND_MODE_HANDLERS`.

**Verify:** Card play, draw, discard, negation all work.

### Step 4.8.8: Migrate setup handlers

Add 22 setup handler prefixes to `COMMAND_MODE_HANDLERS`.

**Verify:** Full game setup (map selection, deployment, attachments) works.

### Step 4.8.9: Migrate DC play area handlers

Add 26 DC play area handler prefixes to `COMMAND_MODE_HANDLERS`.

**Verify:** DC actions (move, attack, interact, special) all work.

### Step 4.8.10: Migrate combat reactions + interrupts + special effects

Add remaining 75+ handler prefixes (combat reactions, interrupts, combat special effects) to `COMMAND_MODE_HANDLERS`.

**Verify:** All 255 handlers running in command mode. Full game playable end-to-end.

### Step 4.8.11: Remove dual-write

Remove state blob persistence. State fully derived from event replay + snapshots. `games` table becomes read cache only.

**Modify:** `src/game-state.js`, `src/db.js`

**Verify:** Bot runs with events-only persistence. All games complete. Recovery via snapshot + replay.

### Step 4.8.12: Cleanup

- Remove old `computeDiff`/`captureSnapshot` audit trail
- Remove `game_events` table writes
- Remove `DUAL_WRITE_MODE` flag
- Remove old recovery heuristic functions from `src/handlers/recover.js`
- Update `src/engine/recovery.js` to use `recoverGameFromEvents`

**Verify:** `node --check index.js` + all tests pass + clean codebase.

---

## Execution Summary

| Phase | Steps | New Files | Tests | Risk |
|-------|-------|-----------|-------|------|
| 4.1 Event Store | 4.1.1–4.1.12 | 7 | 5 | Low |
| 4.2 Events | 4.2.1–4.2.11 | 11 | 1 | Low |
| 4.3 Reducers | 4.3.1–4.3.21 | 10 | 9 | Medium |
| 4.4 Strangler Fig | 4.4.1–4.4.13 | 5 + 3 modified | 3 | Medium |
| 4.5 Sagas | 4.5.1–4.5.9 | 5 | 4 | Medium |
| 4.6 Projections | 4.6.1–4.6.5 | 3 | 2 | Low |
| 4.7 Commands | 4.7.1–4.7.11 | 8 + 1 modified | 4 | Medium |
| 4.8 Migration | 4.8.1–4.8.12 | 1 script + mods | — | High |

**Total: 82 atomic steps. ~50 new files. ~28 test files. Incremental deployment at every step.**
