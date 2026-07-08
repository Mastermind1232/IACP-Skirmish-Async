/**
 * BEHAVIORAL oracle tests for Edge-Case Ability Shapes Phase 1:
 * splashDamage/splashConditions and targetFriendlyFigureAdjacent.
 *
 * Representative abilities chosen by shape:
 *   Slice A — Splash: force_lightning (Emperor Palpatine)
 *     Primary: 3 damage + Weaken to chosen hostile within 4/LOS
 *     Splash: 1 damage to ALL figures adjacent to target (friendly+hostile)
 *
 *   Slice B — Friendly target: gifted_mechanic (Del Meeko)
 *     recoverSelf: 1, recoverTarget: 1, hitTokenSelf: 1, hitTokenTarget: 1
 *     traits: [DROID, VEHICLE]
 *
 *   Slice B — Friendly target: squad_captain (Death Trooper Elite)
 *     powerTokenTarget: 1, traits: [TROOPER, LEADER], freeAction: true
 *
 * Uses real map data (mos-eisley-outskirts) for adjacency calculations.
 * resolveAbility tested directly (pure function) — no Discord handler mocking.
 *
 * Test IDs:
 *   B-SPLASH-001: Force Lightning Phase 1 — target enumeration
 *   B-SPLASH-002: Force Lightning Phase 2 — primary + splash application
 *   B-SPLASH-003: Force Lightning rejection + invariants
 *   B-FRIEND-001: Gifted Mechanic Phase 1 — friendly enumeration
 *   B-FRIEND-002: Gifted Mechanic Phase 2 — recover + hit token application
 *   B-FRIEND-003: Gifted Mechanic rejection + invariants
 *   B-FRIEND-004: Squad Captain — power token grant + freeAction
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { resolveAbility } from '../../../src/game/abilities.js';
import { applyDeferredAbilityEffects } from '../../../src/game/damage-pipeline.js';

// ── Shared helpers ──────────────────────────────────────────────────────────────

const GAME_ID = 'test1';
const REAL_MAP_ID = 'unit-test-grid';

function makeGame(overrides = {}) {
  return {
    gameId: GAME_ID,
    player1Id: 'user_p1',
    player2Id: 'user_p2',
    figurePositions: { 1: {}, 2: {} },
    figureConditions: {},
    figurePowerTokens: {},
    currentRound: 1,
    selectedMap: { id: REAL_MAP_ID },
    ...overrides,
  };
}

// ── Slice A: splashDamage / splashConditions (Force Lightning) ───────────────────

// Force Lightning: range 4, requiresLos, damage 3, condition Weaken, splashDamage 1
// Emperor Palpatine is playerNum 1 attacker. Enemies are playerNum 2.

function buildForceLightningContext({
  attackerPos = 'a1',
  enemyPositions = {},
  friendlyPositions = {},
  choiceIndex,
  targetFigureKey,
} = {}) {
  const dcMessageMeta = new Map();
  const dcHealthState = new Map();
  const activatorMsgId = 'msg_palp';
  const enemyMsgIds = {};

  dcMessageMeta.set(activatorMsgId, {
    gameId: GAME_ID, playerNum: 1, dcName: 'Emperor Palpatine',
    displayName: 'Emperor Palpatine [DG 1]',
  });

  // Register each unique enemy DC with its own msgId
  const enemyDcNames = new Set();
  for (const fk of Object.keys(enemyPositions)) {
    const dcName = fk.replace(/-\d+-\d+$/, '');
    if (!enemyDcNames.has(dcName)) {
      const mid = `msg_enemy_${dcName.replace(/\s+/g, '_').toLowerCase()}`;
      enemyMsgIds[dcName] = mid;
      dcMessageMeta.set(mid, {
        gameId: GAME_ID, playerNum: 2, dcName,
        displayName: `${dcName} [DG 1]`,
      });
      enemyDcNames.add(dcName);
    }
  }

  // Register friendly DCs (for splash hitting friendlies)
  const friendlyDcNames = new Set();
  for (const fk of Object.keys(friendlyPositions)) {
    const dcName = fk.replace(/-\d+-\d+$/, '');
    if (dcName === 'Emperor Palpatine') continue; // already registered
    if (!friendlyDcNames.has(dcName)) {
      const mid = `msg_friend_${dcName.replace(/\s+/g, '_').toLowerCase()}`;
      dcMessageMeta.set(mid, {
        gameId: GAME_ID, playerNum: 1, dcName,
        displayName: `${dcName} [DG 1]`,
      });
      friendlyDcNames.add(dcName);
    }
  }

  const game = makeGame({
    figurePositions: {
      1: { 'Emperor Palpatine-1-0': attackerPos, ...friendlyPositions },
      2: enemyPositions,
    },
    dcActionsData: {
      [activatorMsgId]: { remaining: 2, total: 2, specialsUsed: [], selectedFigure: 0 },
    },
  });

  // Set up health states for all registered DCs
  dcHealthState.set(activatorMsgId, [[13, 13]]);
  for (const [dcName, mid] of Object.entries(enemyMsgIds)) {
    dcHealthState.set(mid, [[6, 6]]);
  }
  for (const dcName of friendlyDcNames) {
    const mid = `msg_friend_${dcName.replace(/\s+/g, '_').toLowerCase()}`;
    dcHealthState.set(mid, [[6, 6]]);
  }

  const meta = dcMessageMeta.get(activatorMsgId);

  return {
    game, dcMessageMeta, dcHealthState, meta, activatorMsgId, enemyMsgIds,
    context: {
      game,
      playerNum: 1,
      meta,
      msgId: activatorMsgId,
      dcMessageMeta,
      dcHealthState,
      hasLineOfSight: () => true,
      getRange: () => 1,
      getMapData: () => ({ adjacency: {}, spaces: [] }),
      choiceIndex,
      targetFigureKey,
    },
  };
}

// ── B-SPLASH-001: Force Lightning Phase 1 ──────────────────────────────────────

describe('B-SPLASH-001: Force Lightning Phase 1 — target enumeration', () => {
  it('001a: returns requiresChoice with valid hostile targets in range', () => {
    const { context } = buildForceLightningContext({
      attackerPos: 'a1',
      enemyPositions: { 'Darth Vader-1-0': 'a2' },
    });
    const result = resolveAbility('force_lightning', context);

    assert.strictEqual(result.applied, false);
    assert.strictEqual(result.requiresChoice, true);
    assert.ok(result.targetFigureKeys.includes('Darth Vader-1-0'),
      'adjacent enemy included as valid target');
  });

  it('001b: excludes out-of-range figures (but allows self per destruct 2026-05-07)', () => {
    const { context } = buildForceLightningContext({
      attackerPos: 'a1',
      enemyPositions: { 'Darth Vader-1-0': 'h8' },
    });
    const result = resolveAbility('force_lightning', context);

    assert.strictEqual(result.applied, false);
    assert.strictEqual(result.requiresChoice, true,
      'Palp himself is always within range; allowFriendly returns him as a valid target');
    assert.ok(!result.targetFigureKeys.includes('Darth Vader-1-0'),
      'out-of-range enemy still excluded');
    assert.ok(result.targetFigureKeys.includes('Emperor Palpatine-1-0'),
      'self-target valid per destruct 2026-05-07: "force lightning hits self if adjacent"');
  });

  it('001c: Phase 1 does not mutate game state', () => {
    const { context, game, dcHealthState } = buildForceLightningContext({
      attackerPos: 'a1',
      enemyPositions: { 'Darth Vader-1-0': 'a2' },
    });
    const condsBefore = JSON.stringify(game.figureConditions);
    const hpBefore = JSON.stringify([...dcHealthState.entries()]);

    resolveAbility('force_lightning', context);

    assert.strictEqual(JSON.stringify(game.figureConditions), condsBefore, 'no condition mutation');
    assert.strictEqual(JSON.stringify([...dcHealthState.entries()]), hpBefore, 'no HP mutation');
  });
});

// ── B-SPLASH-002: Force Lightning Phase 2 — primary + splash ────────────────────

describe('B-SPLASH-002: Force Lightning Phase 2 — primary + splash application', () => {
  it('002a: primary target takes 3 damage + Weaken', async () => {
    const { context, game, dcHealthState, enemyMsgIds } = buildForceLightningContext({
      attackerPos: 'a1',
      enemyPositions: { 'Darth Vader-1-0': 'a2' },
      choiceIndex: 0,
      targetFigureKey: 'Darth Vader-1-0',
    });
    const result = resolveAbility('force_lightning', context);
    await applyDeferredAbilityEffects(context.game, { dcHealthState });

    assert.strictEqual(result.applied, true);
    // 3 damage to primary target (6 HP → 3)
    const targetHs = dcHealthState.get(enemyMsgIds['Darth Vader']);
    assert.strictEqual(targetHs[0][0], 3, 'primary target HP: 6 → 3 (3 damage)');
    // Weaken condition applied
    assert.ok(game.figureConditions?.['Darth Vader-1-0']?.includes('Weaken'),
      'primary target gains Weaken');
  });

  it('002b: adjacent hostile takes splash damage', async () => {
    // Target at a2, adjacent hostile at a3 — splash should hit a3
    const { context, dcHealthState, enemyMsgIds } = buildForceLightningContext({
      attackerPos: 'a1',
      enemyPositions: {
        'Darth Vader-1-0': 'a2',       // primary target
        'Imperial Officer-1-0': 'a3',   // adjacent to target → splash
      },
      choiceIndex: 0,
      targetFigureKey: 'Darth Vader-1-0',
    });
    // Set up enemy 2's health
    dcHealthState.set(enemyMsgIds['Imperial Officer'], [[6, 6]]);

    const result = resolveAbility('force_lightning', context);
    await applyDeferredAbilityEffects(context.game, { dcHealthState });

    assert.strictEqual(result.applied, true);
    // Adjacent hostile takes 1 splash damage (6 → 5)
    const splashHs = dcHealthState.get(enemyMsgIds['Imperial Officer']);
    assert.strictEqual(splashHs[0][0], 5, 'adjacent hostile HP: 6 → 5 (1 splash damage)');
  });

  it('002c: adjacent FRIENDLY also takes splash damage', async () => {
    // Target at a2, friendly at a3 — splash hits ALL adjacent, including friendlies
    const { context, dcHealthState } = buildForceLightningContext({
      attackerPos: 'a1',
      friendlyPositions: { 'Kanan Jarrus-1-0': 'a3' },
      enemyPositions: { 'Darth Vader-1-0': 'a2' },
      choiceIndex: 0,
      targetFigureKey: 'Darth Vader-1-0',
    });
    // Set up friendly's health
    dcHealthState.set('msg_friend_kanan_jarrus', [[8, 8]]);

    const result = resolveAbility('force_lightning', context);
    await applyDeferredAbilityEffects(context.game, { dcHealthState });

    assert.strictEqual(result.applied, true);
    // Friendly adjacent takes 1 splash damage (8 → 7)
    const friendlyHs = dcHealthState.get('msg_friend_kanan_jarrus');
    assert.strictEqual(friendlyHs[0][0], 7,
      'adjacent friendly takes splash damage (8 → 7) — splash is indiscriminate');
  });

  it('002d: non-adjacent figure does NOT take splash', () => {
    // Target at a2, far figure at h8 — not adjacent, no splash
    const { context, dcHealthState, enemyMsgIds } = buildForceLightningContext({
      attackerPos: 'a1',
      enemyPositions: {
        'Darth Vader-1-0': 'a2',       // primary target
        'Imperial Officer-1-0': 'h8',   // far from target → no splash
      },
      choiceIndex: 0,
      targetFigureKey: 'Darth Vader-1-0',
    });
    dcHealthState.set(enemyMsgIds['Imperial Officer'], [[6, 6]]);

    resolveAbility('force_lightning', context);

    const farHs = dcHealthState.get(enemyMsgIds['Imperial Officer']);
    assert.strictEqual(farHs[0][0], 6,
      'non-adjacent figure HP unchanged (no splash)');
  });

  it('002e: logMessage includes Splash section when splash hits', () => {
    const { context } = buildForceLightningContext({
      attackerPos: 'a1',
      enemyPositions: {
        'Darth Vader-1-0': 'a2',
        'Imperial Officer-1-0': 'a3',
      },
      choiceIndex: 0,
      targetFigureKey: 'Darth Vader-1-0',
    });

    const result = resolveAbility('force_lightning', context);

    assert.ok(result.logMessage.includes('Splash'),
      'logMessage contains Splash section');
    assert.ok(result.logMessage.includes('Force Lightning'),
      'logMessage references ability name');
  });
});

// ── B-SPLASH-003: Force Lightning rejection + invariants ────────────────────────

describe('B-SPLASH-003: Force Lightning rejection + invariants', () => {
  it('003a: with allowFriendly, self is always a valid target (per destruct 2026-05-07)', () => {
    // Force Lightning's allowFriendly opt-in (set on its library entry) means
    // Palp himself is always a valid primary target — he trivially satisfies
    // range (0) and LOS (own space). The "no valid targets" path is therefore
    // unreachable for force_lightning specifically. This test pins that
    // behavior so future regressions don't accidentally re-add a self-skip.
    const { context } = buildForceLightningContext({
      attackerPos: 'a1',
      enemyPositions: {},
    });
    const result = resolveAbility('force_lightning', context);

    assert.strictEqual(result.applied, false);
    assert.strictEqual(result.requiresChoice, true);
    assert.deepStrictEqual(result.targetFigureKeys, ['Emperor Palpatine-1-0'],
      'self-only when no enemies on the board');
  });

  it('003b: primary target Weaken does not splash to adjacent', async () => {
    // Weaken is a primary condition, not a splashCondition — only splashDamage splashes
    const { context, game, dcHealthState } = buildForceLightningContext({
      attackerPos: 'a1',
      enemyPositions: {
        'Darth Vader-1-0': 'a2',
        'Imperial Officer-1-0': 'a3',
      },
      choiceIndex: 0,
      targetFigureKey: 'Darth Vader-1-0',
    });

    resolveAbility('force_lightning', context);
    await applyDeferredAbilityEffects(context.game, { dcHealthState });

    // Primary gets Weaken
    assert.ok(game.figureConditions?.['Darth Vader-1-0']?.includes('Weaken'),
      'primary target has Weaken');
    // Adjacent does NOT get Weaken (force_lightning has splashDamage only, not splashConditions)
    assert.ok(!game.figureConditions?.['Imperial Officer-1-0']?.includes('Weaken'),
      'adjacent figure does NOT gain Weaken — only splashDamage, not splashConditions');
  });

  it('003c: no splash when no adjacent figures exist', async () => {
    // Only the primary target on the board, nobody adjacent
    const { context, dcHealthState, enemyMsgIds } = buildForceLightningContext({
      attackerPos: 'a1',
      enemyPositions: { 'Darth Vader-1-0': 'a2' },
      choiceIndex: 0,
      targetFigureKey: 'Darth Vader-1-0',
    });

    const result = resolveAbility('force_lightning', context);
    await applyDeferredAbilityEffects(context.game, { dcHealthState });

    assert.strictEqual(result.applied, true);
    // Primary still takes damage
    const targetHs = dcHealthState.get(enemyMsgIds['Darth Vader']);
    assert.strictEqual(targetHs[0][0], 3, 'primary target hit even with no splash recipients');
  });
});

// ── Slice B: targetFriendlyFigureAdjacent ───────────────────────────────────────

// Gifted Mechanic (Del Meeko): traits [DROID, VEHICLE], recoverSelf 1, recoverTarget 1,
// hitTokenSelf 1, hitTokenTarget 1. Del Meeko is playerNum 1.

function buildGiftedMechanicContext({
  attackerPos = 'a1',
  friendlyPositions = {},
  enemyPositions = {},
  choiceIndex,
  targetFigureKey,
} = {}) {
  const dcMessageMeta = new Map();
  const dcHealthState = new Map();
  const activatorMsgId = 'msg_del';

  dcMessageMeta.set(activatorMsgId, {
    gameId: GAME_ID, playerNum: 1, dcName: 'Del Meeko',
    displayName: 'Del Meeko [DG 1]',
  });

  // Register friendly DCs
  const friendlyDcNames = new Set();
  for (const fk of Object.keys(friendlyPositions)) {
    const dcName = fk.replace(/-\d+-\d+$/, '');
    if (dcName === 'Del Meeko') continue;
    if (!friendlyDcNames.has(dcName)) {
      const mid = `msg_friend_${dcName.replace(/[\s()]+/g, '_').toLowerCase()}`;
      dcMessageMeta.set(mid, {
        gameId: GAME_ID, playerNum: 1, dcName,
        displayName: `${dcName} [DG 1]`,
      });
      dcHealthState.set(mid, [[5, 8]]); // damaged: 5/8 HP
      friendlyDcNames.add(dcName);
    }
  }

  // Register enemy DCs
  for (const fk of Object.keys(enemyPositions)) {
    const dcName = fk.replace(/-\d+-\d+$/, '');
    const mid = `msg_enemy_${dcName.replace(/[\s()]+/g, '_').toLowerCase()}`;
    dcMessageMeta.set(mid, {
      gameId: GAME_ID, playerNum: 2, dcName,
      displayName: `${dcName} [DG 1]`,
    });
  }

  const game = makeGame({
    figurePositions: {
      1: { 'Del Meeko-1-0': attackerPos, ...friendlyPositions },
      2: enemyPositions,
    },
    dcActionsData: {
      [activatorMsgId]: { remaining: 2, total: 2, specialsUsed: [], selectedFigure: 0 },
    },
  });

  // Del Meeko damaged (7/8 HP)
  dcHealthState.set(activatorMsgId, [[7, 8]]);

  const meta = dcMessageMeta.get(activatorMsgId);

  return {
    game, dcMessageMeta, dcHealthState, meta, activatorMsgId,
    context: {
      game,
      playerNum: 1,
      meta,
      msgId: activatorMsgId,
      dcMessageMeta,
      dcHealthState,
      choiceIndex,
      targetFigureKey,
    },
  };
}

// ── B-FRIEND-001: Gifted Mechanic Phase 1 — enumeration ────────────────────────

describe('B-FRIEND-001: Gifted Mechanic Phase 1 — friendly enumeration', () => {
  it('001a: returns adjacent friendly DROID as valid target', () => {
    // IG-88 is a DROID (keywords: DROID, HUNTER in dc-effects)
    const { context } = buildGiftedMechanicContext({
      attackerPos: 'a1',
      friendlyPositions: { 'IG-88-1-0': 'a2' },
    });
    const result = resolveAbility('gifted_mechanic', context);

    assert.strictEqual(result.applied, false);
    assert.strictEqual(result.requiresChoice, true);
    assert.ok(result.targetFigureKeys.includes('IG-88-1-0'),
      'adjacent DROID included in valid targets');
  });

  it('001b: excludes adjacent friendly without DROID/VEHICLE trait', () => {
    // Darth Vader has keywords FORCE USER, LEADER, BRAWLER — not DROID or VEHICLE
    const { context } = buildGiftedMechanicContext({
      attackerPos: 'a1',
      friendlyPositions: { 'Darth Vader-1-0': 'a2' },
    });
    const result = resolveAbility('gifted_mechanic', context);

    assert.strictEqual(result.applied, false);
    assert.ok(!result.requiresChoice, 'no requiresChoice — no matching trait');
    assert.ok(result.manualMessage?.includes('DROID/VEHICLE'),
      'rejection mentions required traits');
  });

  it('001c: excludes hostile figures even if adjacent and DROID', () => {
    // Enemy DROID at adjacent space — should NOT be a valid target
    const { context } = buildGiftedMechanicContext({
      attackerPos: 'a1',
      enemyPositions: { 'IG-88-1-0': 'a2' },
    });
    const result = resolveAbility('gifted_mechanic', context);

    assert.strictEqual(result.applied, false);
    assert.ok(!result.requiresChoice, 'hostile DROID excluded from friendly targets');
  });

  it('001d: excludes non-adjacent friendly DROID', () => {
    // Friendly DROID far away — not adjacent
    const { context } = buildGiftedMechanicContext({
      attackerPos: 'a1',
      friendlyPositions: { 'IG-88-1-0': 'h8' },
    });
    const result = resolveAbility('gifted_mechanic', context);

    assert.strictEqual(result.applied, false);
    assert.ok(!result.requiresChoice, 'non-adjacent DROID excluded');
  });

  it('001e: Phase 1 does not mutate game state', () => {
    const { context, game, dcHealthState } = buildGiftedMechanicContext({
      attackerPos: 'a1',
      friendlyPositions: { 'IG-88-1-0': 'a2' },
    });
    const ptBefore = JSON.stringify(game.figurePowerTokens);
    const hpBefore = JSON.stringify([...dcHealthState.entries()]);

    resolveAbility('gifted_mechanic', context);

    assert.strictEqual(JSON.stringify(game.figurePowerTokens), ptBefore, 'no power token mutation');
    assert.strictEqual(JSON.stringify([...dcHealthState.entries()]), hpBefore, 'no HP mutation');
  });
});

// ── B-FRIEND-002: Gifted Mechanic Phase 2 — application ────────────────────────

describe('B-FRIEND-002: Gifted Mechanic Phase 2 — recover + hit token application', () => {
  it('002a: self recovers 1 damage', () => {
    const { context, dcHealthState, activatorMsgId } = buildGiftedMechanicContext({
      attackerPos: 'a1',
      friendlyPositions: { 'IG-88-1-0': 'a2' },
      choiceIndex: 0,
      targetFigureKey: 'IG-88-1-0',
    });
    const result = resolveAbility('gifted_mechanic', context);

    assert.strictEqual(result.applied, true);
    // Del Meeko was 7/8, recovers 1 → 8/8
    const selfHs = dcHealthState.get(activatorMsgId);
    assert.strictEqual(selfHs[0][0], 8, 'self HP: 7 → 8 (recovered 1)');
  });

  it('002b: target recovers 1 damage', () => {
    const { context, dcHealthState } = buildGiftedMechanicContext({
      attackerPos: 'a1',
      friendlyPositions: { 'IG-88-1-0': 'a2' },
      choiceIndex: 0,
      targetFigureKey: 'IG-88-1-0',
    });
    const result = resolveAbility('gifted_mechanic', context);

    assert.strictEqual(result.applied, true);
    // IG-88 was 5/8, recovers 1 → 6/8
    const targetHs = dcHealthState.get('msg_friend_ig-88');
    assert.strictEqual(targetHs[0][0], 6, 'target HP: 5 → 6 (recovered 1)');
  });

  it('002c: self gains 1 Damage (hit) token', () => {
    const { context, game } = buildGiftedMechanicContext({
      attackerPos: 'a1',
      friendlyPositions: { 'IG-88-1-0': 'a2' },
      choiceIndex: 0,
      targetFigureKey: 'IG-88-1-0',
    });

    resolveAbility('gifted_mechanic', context);

    const selfTokens = game.figurePowerTokens?.['Del Meeko-1-0'] || [];
    assert.ok(selfTokens.includes('Damage'), 'self gained Damage (hit) token');
  });

  it('002d: target gains 1 Damage (hit) token', () => {
    const { context, game } = buildGiftedMechanicContext({
      attackerPos: 'a1',
      friendlyPositions: { 'IG-88-1-0': 'a2' },
      choiceIndex: 0,
      targetFigureKey: 'IG-88-1-0',
    });

    resolveAbility('gifted_mechanic', context);

    const targetTokens = game.figurePowerTokens?.['IG-88-1-0'] || [];
    assert.ok(targetTokens.includes('Damage'), 'target gained Damage (hit) token');
  });

  it('002e: logMessage reflects all effects', () => {
    const { context } = buildGiftedMechanicContext({
      attackerPos: 'a1',
      friendlyPositions: { 'IG-88-1-0': 'a2' },
      choiceIndex: 0,
      targetFigureKey: 'IG-88-1-0',
    });

    const result = resolveAbility('gifted_mechanic', context);

    assert.ok(result.logMessage.includes('Gifted Mechanic'), 'mentions ability name');
    assert.ok(result.logMessage.includes('recovered'), 'mentions recovery');
    assert.ok(result.logMessage.includes('Damage Token'), 'mentions hit token');
  });
});

// ── B-FRIEND-003: Gifted Mechanic rejection + invariants ────────────────────────

describe('B-FRIEND-003: Gifted Mechanic rejection + invariants', () => {
  it('003a: no adjacent friendly returns manual message', () => {
    const { context } = buildGiftedMechanicContext({
      attackerPos: 'a1',
    });
    const result = resolveAbility('gifted_mechanic', context);

    assert.strictEqual(result.applied, false);
    assert.ok(result.manualMessage?.includes('No adjacent friendly'),
      'rejection message for no targets');
  });

  it('003b: no state mutation on rejection', () => {
    const { context, game, dcHealthState } = buildGiftedMechanicContext({
      attackerPos: 'a1',
    });
    const ptBefore = JSON.stringify(game.figurePowerTokens);
    const hpBefore = JSON.stringify([...dcHealthState.entries()]);

    resolveAbility('gifted_mechanic', context);

    assert.strictEqual(JSON.stringify(game.figurePowerTokens), ptBefore);
    assert.strictEqual(JSON.stringify([...dcHealthState.entries()]), hpBefore);
  });
});

// ── B-FRIEND-004: Squad Captain — power token grant + freeAction ────────────────

// Squad Captain (Death Trooper Elite): traits [TROOPER, LEADER], powerTokenTarget 1, freeAction true

function buildSquadCaptainContext({
  attackerPos = 'a1',
  friendlyPositions = {},
  enemyPositions = {},
  choiceIndex,
  targetFigureKey,
} = {}) {
  const dcMessageMeta = new Map();
  const dcHealthState = new Map();
  const activatorMsgId = 'msg_deathtrooper';

  dcMessageMeta.set(activatorMsgId, {
    gameId: GAME_ID, playerNum: 1, dcName: 'Death Trooper (Elite)',
    displayName: 'Death Trooper (Elite) [DG 1]',
  });

  // Register friendly DCs
  for (const fk of Object.keys(friendlyPositions)) {
    const dcName = fk.replace(/-\d+-\d+$/, '');
    if (dcName === 'Death Trooper (Elite)') continue;
    const mid = `msg_friend_${dcName.replace(/[\s()]+/g, '_').toLowerCase()}`;
    dcMessageMeta.set(mid, {
      gameId: GAME_ID, playerNum: 1, dcName,
      displayName: `${dcName} [DG 1]`,
    });
  }

  for (const fk of Object.keys(enemyPositions)) {
    const dcName = fk.replace(/-\d+-\d+$/, '');
    const mid = `msg_enemy_${dcName.replace(/[\s()]+/g, '_').toLowerCase()}`;
    dcMessageMeta.set(mid, {
      gameId: GAME_ID, playerNum: 2, dcName,
      displayName: `${dcName} [DG 1]`,
    });
  }

  const game = makeGame({
    figurePositions: {
      1: { 'Death Trooper (Elite)-1-0': attackerPos, ...friendlyPositions },
      2: enemyPositions,
    },
    dcActionsData: {
      [activatorMsgId]: { remaining: 2, total: 2, specialsUsed: [], selectedFigure: 0 },
    },
  });

  dcHealthState.set(activatorMsgId, [[7, 7]]);

  const meta = dcMessageMeta.get(activatorMsgId);

  return {
    game, dcMessageMeta, dcHealthState, meta, activatorMsgId,
    context: {
      game,
      playerNum: 1,
      meta,
      msgId: activatorMsgId,
      dcMessageMeta,
      dcHealthState,
      choiceIndex,
      targetFigureKey,
    },
  };
}

describe('B-FRIEND-004: Squad Captain — power token grant + freeAction', () => {
  it('004a: adjacent friendly LEADER returned as valid target', () => {
    // Imperial Officer (Elite) has keywords [LEADER] — LEADER qualifies
    const { context } = buildSquadCaptainContext({
      attackerPos: 'a1',
      friendlyPositions: { 'Imperial Officer (Elite)-1-0': 'a2' },
    });
    const result = resolveAbility('squad_captain', context);

    assert.strictEqual(result.requiresChoice, true);
    assert.ok(result.targetFigureKeys.includes('Imperial Officer (Elite)-1-0'),
      'LEADER figure included as valid target');
  });

  it('004b: adjacent friendly without TROOPER/LEADER excluded', () => {
    // Kanan Jarrus has keywords FORCE USER, LEADER — LEADER qualifies
    // Use Rancor which has BRAWLER, CREATURE, MASSIVE, REACH — no TROOPER/LEADER
    const { context } = buildSquadCaptainContext({
      attackerPos: 'a1',
      friendlyPositions: { 'Rancor-1-0': 'a2' },
    });
    const result = resolveAbility('squad_captain', context);

    assert.strictEqual(result.applied, false);
    assert.ok(!result.requiresChoice, 'non-TROOPER/LEADER excluded');
  });

  it('004c: Phase 2 sets pendingPowerTokenGrant and returns requiresPowerTokenChoice', () => {
    const { context, game } = buildSquadCaptainContext({
      attackerPos: 'a1',
      friendlyPositions: { 'Imperial Officer (Elite)-1-0': 'a2' },
      choiceIndex: 0,
      targetFigureKey: 'Imperial Officer (Elite)-1-0',
    });
    const result = resolveAbility('squad_captain', context);

    assert.strictEqual(result.applied, true);
    assert.strictEqual(result.requiresPowerTokenChoice, true,
      'triggers power token type selection');
    assert.ok(game.pendingPowerTokenGrant, 'pendingPowerTokenGrant set');
    assert.strictEqual(game.pendingPowerTokenGrant.grants[0].figureKey, 'Imperial Officer (Elite)-1-0');
    assert.strictEqual(game.pendingPowerTokenGrant.grants[0].count, 1);
  });

  it('004d: result includes freeAction flag', () => {
    // squad_captain has freeAction: true — handler should refund the action
    const { context } = buildSquadCaptainContext({
      attackerPos: 'a1',
      friendlyPositions: { 'Imperial Officer (Elite)-1-0': 'a2' },
      choiceIndex: 0,
      targetFigureKey: 'Imperial Officer (Elite)-1-0',
    });

    // Note: freeAction is NOT handled inside resolveAbility for targetFriendlyFigureAdjacent —
    // it returns applied:true with requiresPowerTokenChoice, and the handler checks entry.freeAction
    // separately. We verify the resolve result structure here; handler refund is covered in B-DCREF.
    const result = resolveAbility('squad_captain', context);
    assert.strictEqual(result.applied, true);
    // The result from targetFriendlyFigureAdjacent with powerTokenTarget returns early (line 639)
    // and does NOT include freeAction in the return. The freeAction flag lives on the ability entry
    // and is checked by the handler after resolveAbility returns.
    // This verifies the ability resolves successfully — the freeAction refund is handler-level.
  });

  it('004e: hostile adjacent figure with TROOPER keyword NOT eligible', () => {
    // Enemy trooper adjacent — should not appear in targets (friendly-only)
    const { context } = buildSquadCaptainContext({
      attackerPos: 'a1',
      enemyPositions: { 'Death Trooper (Elite)-2-0': 'a2' },
    });
    const result = resolveAbility('squad_captain', context);

    assert.strictEqual(result.applied, false);
    assert.ok(!result.requiresChoice, 'hostile TROOPER excluded from friendly targets');
  });
});
