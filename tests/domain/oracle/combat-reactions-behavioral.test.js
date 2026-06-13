/**
 * BEHAVIORAL oracle tests for combat-reactions.js handlers.
 *
 * Phase 1: Reroll/die-mutation flows — the highest-risk code paths.
 * Tests exercise actual handler functions with mocked Discord infrastructure,
 * then assert game-state mutations.
 *
 * Test categories:
 *   B-CR-TL-*:   Tough Luck (die splice, index stability, totals recalc)
 *   B-CR-TINT-*: There Is No Try (face replacement, Dodge conversion)
 *   B-CR-VI-*:   Veteran Instincts (two-phase bonuses, reroll flow entry)
 *   B-CR-CHAIN-*: Multi-step reroll chains
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  handleToughLuck, handleThereIsNoTry, handleVetInstincts,
  handlePowerConverter, handleDoubtReroll, handleForceExhaustion,
  handleHunterProtocol, handleSlowOnTheDraw, handleSlowOnTheDrawResume,
  handleStrikeMeDown, handleIllicitArms,
} from '../../../src/handlers/combat-reactions.js';
import { recalcAttackTotals, recalcDefenseTotals } from '../../../src/game/combat.js';

// ── Mock helpers ──────────────────────────────────────────────────────────────

function mockThread() {
  const sent = [];
  return {
    send: async (msg) => { sent.push(msg); return { content: typeof msg === 'string' ? msg : msg?.content }; },
    _sent: sent,
  };
}

function mockInteraction(customId, userId = 'player1') {
  return {
    customId,
    user: { id: userId },
    followUp: async () => ({}),
    deferUpdate: async () => ({}),
    update: async () => ({}),
    message: { content: '', edit: async () => ({}) },
  };
}

/**
 * Build a ctx object that the handlers expect.
 * game must have gameId set; getGame returns game for any ID.
 */
function buildCtx(game, overrides = {}) {
  const thread = mockThread();
  const calls = { sendRerollUI: [], proceedAfterRerolls: [], logGameAction: [], sendReadyToResolveRolls: [] };
  return {
    ctx: {
      getGame: () => game,
      canActAsPlayer: () => true,
      saveGames: () => {},
      client: { channels: { fetch: async () => thread } },
      recalcAttackTotals,
      recalcDefenseTotals,
      sendRerollUI: async (_t, _g, _c, phase) => { calls.sendRerollUI.push({ phase }); },
      proceedAfterRerolls: async () => { calls.proceedAfterRerolls.push(true); },
      logGameAction: async () => { calls.logGameAction.push(true); },
      rollSingleAttackDie: (color) => ({ color, acc: 0, dmg: 1, surge: 0 }),
      // Phase 2: Hunter Protocol surge helpers
      sendReadyToResolveRolls: async () => { calls.sendReadyToResolveRolls.push(true); },
      getAttackerSurgeAbilities: () => [],
      SURGE_LABELS: {},
      parseSurgeEffect: () => ({}),
      getAbility: () => ({}),
      resolveSurgeAbility: null,
      getSurgeAbilityLabel: (key) => key,
      getDcEffects: () => ({}),
      ...overrides,
    },
    thread,
    calls,
  };
}

/** Make a minimal combat fixture with 3 attack dice and 2 defense dice. */
function makeCombat(overrides = {}) {
  return {
    combatThreadId: 'thread1',
    attackerPlayerNum: 1,
    defenderPlayerNum: 2,
    attackDiceResults: [
      { color: 'red', acc: 1, dmg: 3, surge: 0 },
      { color: 'blue', acc: 2, dmg: 1, surge: 1 },
      { color: 'green', acc: 0, dmg: 2, surge: 1 },
    ],
    attackRoll: { acc: 3, dmg: 6, surge: 2 },
    defenseDiceResults: [
      { color: 'black', block: 2, evade: 0, dodge: 0 },
      { color: 'white', block: 1, evade: 1, dodge: 0 },
    ],
    defenseRoll: { block: 3, evade: 1, dodge: 0 },
    attackerRerolledIndices: [],
    defenderRerolledIndices: [],
    attackerRerollsRemaining: 0,
    defenderRerollsRemaining: 0,
    ...overrides,
  };
}

// ── B-CR-TL: Tough Luck ─────────────────────────────────────────────────────

describe('B-CR-TL: Tough Luck die splice', () => {
  it('B-CR-TL-001: removes attack die at correct index and recalculates totals', async () => {
    const combat = makeCombat({ attackerRerolledIndices: [1] });
    const game = {
      gameId: 'g1',
      player1Id: 'player1',
      pendingToughLuck: { side: 'atk' },
      toughLuckPlayerNum: 1,
      pendingCombat: combat,
    };
    const { ctx } = buildCtx(game);
    await handleToughLuck(mockInteraction('tough_luck_remove_g1_1', 'player1'), ctx);

    assert.strictEqual(combat.attackDiceResults.length, 2, 'one die removed');
    assert.strictEqual(combat.attackDiceResults[0].color, 'red', 'red preserved at index 0');
    assert.strictEqual(combat.attackDiceResults[1].color, 'green', 'green shifted to index 1');
    assert.deepStrictEqual(combat.attackRoll, { acc: 1, dmg: 5, surge: 1 }, 'totals recalculated');
    assert.ok(game.pendingToughLuck == null, 'pendingToughLuck cleared');
  });

  it('B-CR-TL-002: removes defense die and recalculates defense totals', async () => {
    const combat = makeCombat({ defenderRerolledIndices: [0] });
    const game = {
      gameId: 'g1',
      player1Id: 'player1',
      pendingToughLuck: { side: 'def' },
      toughLuckPlayerNum: 1,
      pendingCombat: combat,
    };
    const { ctx } = buildCtx(game);
    await handleToughLuck(mockInteraction('tough_luck_remove_g1_0', 'player1'), ctx);

    assert.strictEqual(combat.defenseDiceResults.length, 1, 'one defense die removed');
    assert.strictEqual(combat.defenseDiceResults[0].color, 'white', 'white at index 0');
    assert.deepStrictEqual(combat.defenseRoll, { block: 1, evade: 1, dodge: 0 }, 'defense totals recalculated');
  });

  it('B-CR-TL-003: skip path clears pendingToughLuck without mutating dice', async () => {
    const combat = makeCombat({ attackerRerolledIndices: [1] });
    const originalDice = [...combat.attackDiceResults];
    const game = {
      gameId: 'g1',
      player1Id: 'player1',
      pendingToughLuck: { side: 'atk' },
      toughLuckPlayerNum: 1,
      pendingCombat: combat,
    };
    const { ctx } = buildCtx(game);
    await handleToughLuck(mockInteraction('tough_luck_skip_g1', 'player1'), ctx);

    assert.ok(game.pendingToughLuck == null, 'pendingToughLuck cleared');
    assert.strictEqual(combat.attackDiceResults.length, 3, 'dice unchanged');
    assert.deepStrictEqual(combat.attackDiceResults, originalDice, 'dice array unchanged');
  });

  it('B-CR-TL-004: adjusts attackerRerolledIndices after splice (index stability)', async () => {
    // Setup: dice [red, blue, green], indices [1] (blue rerolled), TL removes blue (index 1)
    // After splice: dice = [red, green]. Green shifts from index 2 to 1.
    // Correct behavior: attackerRerolledIndices should be [] (removed index 1)
    const combat = makeCombat({ attackerRerolledIndices: [1] });
    const game = {
      gameId: 'g1',
      player1Id: 'player1',
      pendingToughLuck: { side: 'atk' },
      toughLuckPlayerNum: 1,
      pendingCombat: combat,
    };
    const { ctx } = buildCtx(game);
    await handleToughLuck(mockInteraction('tough_luck_remove_g1_1', 'player1'), ctx);

    // After fix: removed die's index gone, higher indices decremented
    assert.deepStrictEqual(combat.attackerRerolledIndices, [],
      'rerolled index for removed die should be purged');
  });

  it('B-CR-TL-005: adjusts multiple rerolledIndices correctly after splice', async () => {
    // dice [red(0), blue(1), green(2)], rerolled=[0, 2], TL removes blue (index 1)
    // After splice: dice = [red, green]. Index 0 stays, index 2→1.
    // Correct: attackerRerolledIndices = [0, 1]
    const combat = makeCombat({ attackerRerolledIndices: [0, 2] });
    const game = {
      gameId: 'g1',
      player1Id: 'player1',
      pendingToughLuck: { side: 'atk' },
      toughLuckPlayerNum: 1,
      pendingCombat: combat,
    };
    const { ctx } = buildCtx(game);
    await handleToughLuck(mockInteraction('tough_luck_remove_g1_1', 'player1'), ctx);

    assert.deepStrictEqual(combat.attackerRerolledIndices, [0, 1],
      'index 0 preserved, index 2 decremented to 1');
    assert.strictEqual(combat.attackDiceResults.length, 2);
  });

  it('B-CR-TL-006: adjusts defenderRerolledIndices after defense splice', async () => {
    // defense dice [black(0), white(1)], rerolled=[0, 1], TL removes black (index 0)
    // After splice: dice = [white]. Index 0 removed, index 1→0.
    // Correct: defenderRerolledIndices = [0]
    const combat = makeCombat({ defenderRerolledIndices: [0, 1] });
    const game = {
      gameId: 'g1',
      player1Id: 'player1',
      pendingToughLuck: { side: 'def' },
      toughLuckPlayerNum: 1,
      pendingCombat: combat,
    };
    const { ctx } = buildCtx(game);
    await handleToughLuck(mockInteraction('tough_luck_remove_g1_0', 'player1'), ctx);

    assert.deepStrictEqual(combat.defenderRerolledIndices, [0],
      'index 0 removed, index 1 decremented to 0');
  });

  it('B-CR-TL-007: continues to attacker reroll UI when atkRerolls remain', async () => {
    const combat = makeCombat({
      attackerRerolledIndices: [1],
      attackerRerollsRemaining: 1,
      defenderRerollsRemaining: 0,
    });
    const game = {
      gameId: 'g1',
      player1Id: 'player1',
      pendingToughLuck: { side: 'atk' },
      toughLuckPlayerNum: 1,
      pendingCombat: combat,
    };
    const { ctx, calls } = buildCtx(game);
    await handleToughLuck(mockInteraction('tough_luck_remove_g1_1', 'player1'), ctx);

    assert.strictEqual(calls.sendRerollUI.length, 1, 'reroll UI sent');
    assert.strictEqual(calls.sendRerollUI[0].phase, 'attacker', 'attacker reroll phase');
  });

  it('B-CR-TL-008: proceeds after rerolls when no rerolls remain', async () => {
    const combat = makeCombat({
      attackerRerolledIndices: [1],
      attackerRerollsRemaining: 0,
      defenderRerollsRemaining: 0,
    });
    const game = {
      gameId: 'g1',
      player1Id: 'player1',
      pendingToughLuck: { side: 'atk' },
      toughLuckPlayerNum: 1,
      pendingCombat: combat,
    };
    const { ctx, calls } = buildCtx(game);
    await handleToughLuck(mockInteraction('tough_luck_remove_g1_1', 'player1'), ctx);

    assert.strictEqual(calls.proceedAfterRerolls.length, 1, 'proceedAfterRerolls called');
    assert.strictEqual(combat.rerollPhase, null, 'rerollPhase set to null');
  });

  it('B-CR-TL-009: transitions to defender reroll when atk side done but def remains', async () => {
    const combat = makeCombat({
      attackerRerolledIndices: [1],
      attackerRerollsRemaining: 0,
      defenderRerollsRemaining: 1,
    });
    const game = {
      gameId: 'g1',
      player1Id: 'player1',
      pendingToughLuck: { side: 'atk' },
      toughLuckPlayerNum: 1,
      pendingCombat: combat,
    };
    const { ctx, calls } = buildCtx(game);
    await handleToughLuck(mockInteraction('tough_luck_remove_g1_1', 'player1'), ctx);

    assert.strictEqual(calls.sendRerollUI.length, 1, 'reroll UI sent');
    assert.strictEqual(calls.sendRerollUI[0].phase, 'defender', 'transitions to defender');
    assert.strictEqual(combat.rerollPhase, 'defender');
  });
});

// ── B-CR-TINT: There Is No Try ──────────────────────────────────────────────

describe('B-CR-TINT: There Is No Try face replacement', () => {
  it('B-CR-TINT-001: sets chosen face on defense die and recalculates totals', async () => {
    const combat = makeCombat();
    const game = {
      gameId: 'g1',
      player1Id: 'player1',
      player2Id: 'player2',
      pendingThereIsNoTry: { pickedDieIdx: 0 },
      pendingCombat: combat,
    };
    const { ctx } = buildCtx(game);
    // face: 1 block, 1 evade, no dodge
    await handleThereIsNoTry(mockInteraction('there_is_no_try_face_g1_0_1_1_0', 'player2'), ctx);

    assert.strictEqual(combat.defenseDiceResults[0].block, 1, 'block set to 1');
    assert.strictEqual(combat.defenseDiceResults[0].evade, 1, 'evade set to 1');
    assert.strictEqual(combat.defenseDiceResults[0].dodge, false, 'no dodge');
    // Total: die0 {1B, 1E} + die1 {1B, 1E} = 2B, 2E
    assert.strictEqual(combat.defenseRoll.block, 2, 'total block recalculated');
    assert.strictEqual(combat.defenseRoll.evade, 2, 'total evade recalculated');
    assert.ok(game.pendingThereIsNoTry == null, 'pendingThereIsNoTry cleared');
    assert.strictEqual(combat.tintResolved, true, 'tintResolved set');
  });

  it('B-CR-TINT-002: Dodge conversion adds +2B +1E to chosen face values', async () => {
    const combat = makeCombat();
    const game = {
      gameId: 'g1',
      player1Id: 'player1',
      player2Id: 'player2',
      pendingThereIsNoTry: { pickedDieIdx: 1 },
      pendingCombat: combat,
    };
    const { ctx } = buildCtx(game);
    // face: 0 block, 0 evade, dodge=1 → converted to 0+2=2 block, 0+1=1 evade, dodge=false
    await handleThereIsNoTry(mockInteraction('there_is_no_try_face_g1_1_0_0_1', 'player2'), ctx);

    const die1 = combat.defenseDiceResults[1];
    assert.strictEqual(die1.block, 2, 'Dodge conversion: 0+2 = 2 block');
    assert.strictEqual(die1.evade, 1, 'Dodge conversion: 0+1 = 1 evade');
    assert.strictEqual(die1.dodge, false, 'Dodge flag cleared after conversion');
    // Total: die0 {2B, 0E} + die1 {2B, 1E} = 4B, 1E
    assert.strictEqual(combat.defenseRoll.block, 4, 'total includes dodge conversion');
    assert.strictEqual(combat.defenseRoll.evade, 1);
  });

  it('B-CR-TINT-003: skip resolves without mutating dice', async () => {
    const combat = makeCombat();
    const origDef = JSON.parse(JSON.stringify(combat.defenseDiceResults));
    const game = {
      gameId: 'g1',
      player1Id: 'player1',
      player2Id: 'player2',
      pendingThereIsNoTry: {},
      pendingCombat: combat,
    };
    const { ctx } = buildCtx(game);
    await handleThereIsNoTry(mockInteraction('there_is_no_try_skip_g1', 'player2'), ctx);

    assert.deepStrictEqual(combat.defenseDiceResults, origDef, 'defense dice unchanged');
    assert.ok(game.pendingThereIsNoTry == null, 'cleared');
    assert.strictEqual(combat.tintResolved, true, 'tintResolved set on skip');
  });

  it('B-CR-TINT-004: enters reroll window after face resolution when rerolls remain', async () => {
    const combat = makeCombat({
      attackerRerollsRemaining: 1,
      defenderRerollsRemaining: 0,
    });
    const game = {
      gameId: 'g1',
      player1Id: 'player1',
      player2Id: 'player2',
      pendingThereIsNoTry: { pickedDieIdx: 0 },
      pendingCombat: combat,
    };
    const { ctx, calls } = buildCtx(game);
    await handleThereIsNoTry(mockInteraction('there_is_no_try_face_g1_0_1_0_0', 'player2'), ctx);

    assert.strictEqual(calls.sendRerollUI.length, 1);
    assert.strictEqual(calls.sendRerollUI[0].phase, 'attacker', 'attacker gets first reroll');
    assert.strictEqual(combat.rerollPhase, 'attacker');
  });

  it('B-CR-TINT-005: proceeds after rerolls when none remain', async () => {
    const combat = makeCombat();
    const game = {
      gameId: 'g1',
      player1Id: 'player1',
      player2Id: 'player2',
      pendingThereIsNoTry: { pickedDieIdx: 0 },
      pendingCombat: combat,
    };
    const { ctx, calls } = buildCtx(game);
    await handleThereIsNoTry(mockInteraction('there_is_no_try_face_g1_0_1_0_0', 'player2'), ctx);

    assert.strictEqual(calls.proceedAfterRerolls.length, 1, 'proceeds to post-reroll');
    assert.strictEqual(combat.rerollPhase, null);
  });
});


// ── B-CR-CHAIN: Multi-step reroll chains ────────────────────────────────────

describe('B-CR-CHAIN: Multi-step reroll chain tests', () => {
  it('B-CR-CHAIN-001: TL splice → reroll continues → green die at new index is rerollable', async () => {
    // Full chain: 3 dice, blue (index 1) rerolled, TL removes blue, attacker has 1 reroll remaining.
    // After TL: dice=[red, green], green at new index 1.
    // Green was NOT rerolled, so after index adjustment, it should be rerollable at index 1.
    const combat = makeCombat({
      attackerRerolledIndices: [1],
      attackerRerollsRemaining: 1,
      defenderRerollsRemaining: 0,
    });
    const game = {
      gameId: 'g1',
      player1Id: 'player1',
      pendingToughLuck: { side: 'atk' },
      toughLuckPlayerNum: 1,
      pendingCombat: combat,
    };
    const { ctx, calls } = buildCtx(game);
    await handleToughLuck(mockInteraction('tough_luck_remove_g1_1', 'player1'), ctx);

    // Verify state after TL
    assert.strictEqual(combat.attackDiceResults.length, 2);
    assert.strictEqual(combat.attackDiceResults[1].color, 'green');

    // Verify reroll flow entered
    assert.strictEqual(calls.sendRerollUI.length, 1, 'reroll UI sent');
    assert.strictEqual(calls.sendRerollUI[0].phase, 'attacker');

    // Verify green die at new index 1 is NOT in rerolledIndices (it's a fresh die)
    assert.ok(!combat.attackerRerolledIndices.includes(1),
      'green die (now at index 1) should NOT be marked as rerolled');
  });

  it('B-CR-CHAIN-002: TINT face set → reroll window → VI defense bonus chain', async () => {
    // Chain: TINT sets face on die 0 → enters reroll window (attacker has 1 reroll).
    // Then: VI defense phase adds +1 block.
    // Verify: both mutations visible on final game state.
    const combat = makeCombat({
      attackerRerollsRemaining: 1,
      defenderRerollsRemaining: 0,
    });
    const game = {
      gameId: 'g1',
      player1Id: 'player1',
      player2Id: 'player2',
      pendingThereIsNoTry: { pickedDieIdx: 0 },
      pendingCombat: combat,
    };

    // Step 1: TINT face pick (set black die to 2B/0E)
    const { ctx: ctx1 } = buildCtx(game);
    await handleThereIsNoTry(mockInteraction('there_is_no_try_face_g1_0_2_0_0', 'player2'), ctx1);

    assert.strictEqual(combat.defenseDiceResults[0].block, 2, 'TINT: die 0 set to 2B');
    assert.strictEqual(combat.tintResolved, true);
    // Total after TINT: die0 {2B, 0E} + die1 {1B, 1E} = 3B, 1E
    assert.strictEqual(combat.defenseRoll.block, 3);

    // Step 2: VI defense bonus (+1 block) — simulating the state after reroll window
    combat.vetInstinctsAttackApplied = true;
    combat.viPendingAtkRerolls = 0;
    combat.viPendingDefRerolls = 0;
    const { ctx: ctx2 } = buildCtx(game);
    await handleVetInstincts(mockInteraction('vet_instincts_pick_g1_block', 'player2'), ctx2);

    assert.strictEqual(combat.defenseRoll.block, 4, 'VI adds +1 block on top of TINT');
    assert.strictEqual(combat.vetInstinctsDefenseApplied, true);
  });

  it('B-CR-CHAIN-003: TL defense splice + TINT skip → correct defense totals', async () => {
    // TL removes black defense die → then TINT skips → totals reflect only white die
    const combat = makeCombat({
      defenderRerolledIndices: [0],
      attackerRerollsRemaining: 0,
      defenderRerollsRemaining: 0,
    });
    const game = {
      gameId: 'g1',
      player1Id: 'player1',
      player2Id: 'player2',
      pendingToughLuck: { side: 'def' },
      toughLuckPlayerNum: 1,
      pendingCombat: combat,
    };

    // Step 1: TL removes black die (index 0)
    const { ctx: ctx1 } = buildCtx(game);
    await handleToughLuck(mockInteraction('tough_luck_remove_g1_0', 'player1'), ctx1);

    assert.strictEqual(combat.defenseDiceResults.length, 1, 'one die remains');
    assert.strictEqual(combat.defenseDiceResults[0].color, 'white');
    assert.deepStrictEqual(combat.defenseRoll, { block: 1, evade: 1, dodge: 0 });

    // Step 2: TINT skip (no further mutations)
    game.pendingThereIsNoTry = {};
    const { ctx: ctx2 } = buildCtx(game);
    await handleThereIsNoTry(mockInteraction('there_is_no_try_skip_g1', 'player2'), ctx2);

    assert.strictEqual(combat.tintResolved, true);
    // Defense totals unchanged
    assert.deepStrictEqual(combat.defenseRoll, { block: 1, evade: 1, dodge: 0 },
      'defense totals stable after TINT skip');
  });
});

// ── B-CR-REJECT: Rejected sequences ────────────────────────────────────────

describe('B-CR-REJECT: Rejected/no-op sequences', () => {
  it('B-CR-REJECT-001: TL with no pendingToughLuck is no-op', async () => {
    const combat = makeCombat();
    const game = {
      gameId: 'g1',
      player1Id: 'player1',
      pendingToughLuck: null,
      toughLuckPlayerNum: 1,
      pendingCombat: combat,
    };
    const { ctx } = buildCtx(game);
    const origDice = JSON.parse(JSON.stringify(combat.attackDiceResults));
    await handleToughLuck(mockInteraction('tough_luck_remove_g1_1', 'player1'), ctx);

    assert.deepStrictEqual(combat.attackDiceResults, origDice, 'dice unchanged');
  });

  it('B-CR-REJECT-002: TINT with no pendingThereIsNoTry is no-op for die pick', async () => {
    const combat = makeCombat();
    const game = {
      gameId: 'g1',
      player1Id: 'player1',
      player2Id: 'player2',
      pendingThereIsNoTry: null,
      pendingCombat: combat,
    };
    const { ctx } = buildCtx(game);
    const origDef = JSON.parse(JSON.stringify(combat.defenseDiceResults));
    await handleThereIsNoTry(mockInteraction('there_is_no_try_die_g1_0', 'player2'), ctx);

    assert.deepStrictEqual(combat.defenseDiceResults, origDef, 'dice unchanged');
  });

  it('B-CR-REJECT-003: VI with no pendingCombat is no-op', async () => {
    const game = {
      gameId: 'g1',
      player1Id: 'player1',
      pendingCombat: null,
    };
    const { ctx } = buildCtx(game);
    // Should not throw
    await handleVetInstincts(mockInteraction('vet_instincts_pick_g1_hit', 'player1'), ctx);
    assert.strictEqual(game.pendingCombat, null, 'still null');
  });
});

// ── B-CR-CLEANUP: State cleanup ─────────────────────────────────────────────

describe('B-CR-CLEANUP: State cleanup after handlers', () => {
  it('B-CR-CLEANUP-001: TL clears pendingToughLuck on both remove and skip', async () => {
    // Remove path
    const combat1 = makeCombat({ attackerRerolledIndices: [1] });
    const game1 = {
      gameId: 'g1', player1Id: 'player1',
      pendingToughLuck: { side: 'atk' }, toughLuckPlayerNum: 1,
      pendingCombat: combat1,
    };
    const { ctx: ctx1 } = buildCtx(game1);
    await handleToughLuck(mockInteraction('tough_luck_remove_g1_1', 'player1'), ctx1);
    assert.ok(game1.pendingToughLuck == null);

    // Skip path
    const combat2 = makeCombat();
    const game2 = {
      gameId: 'g1', player1Id: 'player1',
      pendingToughLuck: { side: 'atk' }, toughLuckPlayerNum: 1,
      pendingCombat: combat2,
    };
    const { ctx: ctx2 } = buildCtx(game2);
    await handleToughLuck(mockInteraction('tough_luck_skip_g1', 'player1'), ctx2);
    assert.ok(game2.pendingToughLuck == null);
  });

  it('B-CR-CLEANUP-002: TINT sets tintResolved on both face pick and skip', async () => {
    // Face path
    const combat1 = makeCombat();
    const game1 = {
      gameId: 'g1', player1Id: 'player1', player2Id: 'player2',
      pendingThereIsNoTry: { pickedDieIdx: 0 },
      pendingCombat: combat1,
    };
    const { ctx: ctx1 } = buildCtx(game1);
    await handleThereIsNoTry(mockInteraction('there_is_no_try_face_g1_0_1_0_0', 'player2'), ctx1);
    assert.strictEqual(combat1.tintResolved, true);

    // Skip path
    const combat2 = makeCombat();
    const game2 = {
      gameId: 'g1', player1Id: 'player1', player2Id: 'player2',
      pendingThereIsNoTry: {},
      pendingCombat: combat2,
    };
    const { ctx: ctx2 } = buildCtx(game2);
    await handleThereIsNoTry(mockInteraction('there_is_no_try_skip_g1', 'player2'), ctx2);
    assert.strictEqual(combat2.tintResolved, true);
  });

  it('B-CR-CLEANUP-003: VI initializes reroll tracking arrays when entering reroll window', async () => {
    const combat = makeCombat();
    combat.vetInstinctsAttackApplied = true;
    combat.viPendingAtkRerolls = 1;
    combat.viPendingDefRerolls = 0;
    // Intentionally omit reroll tracking arrays
    delete combat.attackerRerolledIndices;
    delete combat.defenderRerolledIndices;
    const game = {
      gameId: 'g1', player1Id: 'player1', player2Id: 'player2',
      pendingCombat: combat,
    };
    const { ctx } = buildCtx(game);
    await handleVetInstincts(mockInteraction('vet_instincts_pick_g1_block', 'player2'), ctx);

    assert.ok(Array.isArray(combat.attackerRerolledIndices), 'G12: attackerRerolledIndices initialized');
    assert.ok(Array.isArray(combat.defenderRerolledIndices), 'G12: defenderRerolledIndices initialized');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// Phase 2: Power Converter, Doubt, Force Exhaustion, Hunter Protocol, SOTD
// ═══════════════════════════════════════════════════════════════════════════

// ── B-CR-PC: Power Converter ────────────────────────────────────────────────

describe('B-CR-PC: Power Converter multi-step reroll', () => {
  it('B-CR-PC-001: die pick stores powerConverterDieIndex', async () => {
    const combat = makeCombat();
    const game = {
      gameId: 'g1',
      player1Id: 'player1',
      pendingCombat: combat,
    };
    const { ctx } = buildCtx(game);
    await handlePowerConverter(mockInteraction('power_converter_die_g1_2', 'player1'), ctx);

    assert.strictEqual(combat.powerConverterDieIndex, 2, 'dieIndex stored');
  });

  it('B-CR-PC-002: color swap rerolls die with deterministic result and recalcs', async () => {
    const combat = makeCombat();
    combat.powerConverterDieIndex = 1; // targeting blue die
    combat.pcPendingAtkRerolls = 0;
    combat.pcPendingDefRerolls = 0;
    const origBlue = { ...combat.attackDiceResults[1] }; // blue: acc=2, dmg=1, surge=1
    const game = {
      gameId: 'g1',
      player1Id: 'player1',
      pendingCombat: combat,
    };
    // rollSingleAttackDie returns { color: 'red', acc: 0, dmg: 1, surge: 0 }
    const { ctx } = buildCtx(game);
    await handlePowerConverter(mockInteraction('power_converter_color_g1_red', 'player1'), ctx);

    // Die 1 replaced: was blue {2,1,1} → now red {0,1,0}
    assert.strictEqual(combat.attackDiceResults[1].color, 'red', 'die color swapped');
    assert.strictEqual(combat.attackDiceResults[1].dmg, 1, 'new die result from mock');
    assert.strictEqual(combat.attackDiceResults.length, 3, 'array length unchanged');
    // Totals: red(1,3,0) + red(0,1,0) + green(0,2,1) = acc=1, dmg=6, surge=1
    assert.deepStrictEqual(combat.attackRoll, { acc: 1, dmg: 6, surge: 1 }, 'totals recalculated');
  });

  it('B-CR-PC-003: color swap marks die as rerolled in attackerRerolledIndices', async () => {
    const combat = makeCombat();
    combat.powerConverterDieIndex = 1;
    combat.pcPendingAtkRerolls = 0;
    combat.pcPendingDefRerolls = 0;
    const game = {
      gameId: 'g1',
      player1Id: 'player1',
      pendingCombat: combat,
    };
    const { ctx } = buildCtx(game);
    await handlePowerConverter(mockInteraction('power_converter_color_g1_blue', 'player1'), ctx);

    assert.ok(combat.attackerRerolledIndices.includes(1), 'die index 1 marked as rerolled');
  });

  it('B-CR-PC-004: color swap sets powerConverterUsedThisRound and deletes powerConverterDieIndex', async () => {
    const combat = makeCombat();
    combat.powerConverterDieIndex = 0;
    combat.pcPendingAtkRerolls = 0;
    combat.pcPendingDefRerolls = 0;
    const game = {
      gameId: 'g1',
      player1Id: 'player1',
      pendingCombat: combat,
    };
    const { ctx } = buildCtx(game);
    await handlePowerConverter(mockInteraction('power_converter_color_g1_green', 'player1'), ctx);

    // Per alexanbv 2026-06-13: once per round per player (any figure on that side).
    assert.strictEqual(game.powerConverterUsedThisRound?.[1], true, 'once-per-round-per-player flag set');
    assert.strictEqual(combat.powerConverterDieIndex, undefined, 'temporary index cleaned up');
  });

  it('B-CR-PC-005: "keep current" color rerolls same color die', async () => {
    const combat = makeCombat();
    combat.powerConverterDieIndex = 0; // red die
    combat.pcPendingAtkRerolls = 0;
    combat.pcPendingDefRerolls = 0;
    const game = {
      gameId: 'g1',
      player1Id: 'player1',
      pendingCombat: combat,
    };
    // rollSingleAttackDie('red') returns { color: 'red', acc: 0, dmg: 1, surge: 0 }
    const { ctx } = buildCtx(game);
    await handlePowerConverter(mockInteraction('power_converter_color_g1_skip', 'player1'), ctx);

    assert.strictEqual(combat.attackDiceResults[0].color, 'red', 'kept same color');
    assert.strictEqual(game.powerConverterUsedThisRound?.[1], true, 'still counts as used (per player)');
  });

  it('B-CR-PC-006: skip path resumes reroll flow without any mutation', async () => {
    const combat = makeCombat();
    combat.pcPendingAtkRerolls = 1;
    combat.pcPendingDefRerolls = 0;
    const origDice = JSON.parse(JSON.stringify(combat.attackDiceResults));
    const game = {
      gameId: 'g1',
      player1Id: 'player1',
      pendingCombat: combat,
      pendingPowerConverter: { some: 'data' },
    };
    const { ctx, calls } = buildCtx(game);
    await handlePowerConverter(mockInteraction('power_converter_skip_g1', 'player1'), ctx);

    assert.deepStrictEqual(combat.attackDiceResults, origDice, 'dice unchanged');
    assert.ok(game.pendingPowerConverter == null, 'pendingPowerConverter cleared');
    assert.strictEqual(calls.sendRerollUI.length, 1, 'reroll flow resumed');
    assert.strictEqual(calls.sendRerollUI[0].phase, 'attacker');
  });

  it('B-CR-PC-007: color swap resumes reroll flow with stored pending counts', async () => {
    const combat = makeCombat();
    combat.powerConverterDieIndex = 2;
    combat.pcPendingAtkRerolls = 0;
    combat.pcPendingDefRerolls = 1;
    const game = {
      gameId: 'g1',
      player1Id: 'player1',
      pendingCombat: combat,
    };
    const { ctx, calls } = buildCtx(game);
    await handlePowerConverter(mockInteraction('power_converter_color_g1_red', 'player1'), ctx);

    assert.strictEqual(combat.attackerRerollsRemaining, 0);
    assert.strictEqual(combat.defenderRerollsRemaining, 1, 'defender rerolls restored');
    assert.strictEqual(calls.sendRerollUI.length, 1);
    assert.strictEqual(calls.sendRerollUI[0].phase, 'defender', 'transitions to defender reroll');
  });

  it('B-CR-PC-008: color swap proceeds to post-reroll when no rerolls pending', async () => {
    const combat = makeCombat();
    combat.powerConverterDieIndex = 0;
    combat.pcPendingAtkRerolls = 0;
    combat.pcPendingDefRerolls = 0;
    const game = {
      gameId: 'g1',
      player1Id: 'player1',
      pendingCombat: combat,
    };
    const { ctx, calls } = buildCtx(game);
    await handlePowerConverter(mockInteraction('power_converter_color_g1_red', 'player1'), ctx);

    assert.strictEqual(calls.proceedAfterRerolls.length, 1, 'proceeds to post-reroll');
    assert.strictEqual(combat.rerollPhase, null);
  });
});

// ── B-CR-DOUBT: Doubt Reroll ────────────────────────────────────────────────

describe('B-CR-DOUBT: Doubt forced-reroll queue', () => {
  it('B-CR-DOUBT-001: use adds forced reroll to queue with deferred deplete payload', async () => {
    // alexanbv 2026-05-13: Doubt now defers depletion to actual reroll
    // consumption. The Use button only adds the queue entry with a
    // `depleteDc` payload; the card stays undepleted until the defender
    // rerolls a die via the bucket. Skipping via Continue preserves the
    // card.
    const combat = makeCombat({
      attackerRerollsRemaining: 0,
      defenderRerollsRemaining: 0,
    });
    combat.doubtMsgId = 'doubt-msg-1';
    combat.doubtPendingAtkRerolls = 0;
    combat.doubtPendingDefRerolls = 0;
    const game = {
      gameId: 'g1',
      player1Id: 'player1',
      player2Id: 'player2',
      pendingCombat: combat,
    };
    const { ctx } = buildCtx(game);
    await handleDoubtReroll(mockInteraction('doubt_reroll_use_g1', 'player2'), ctx);

    // Card NOT yet depleted (deferred to actual reroll consumption)
    assert.ok(!game.p2DepletedDcMessageIds?.includes('doubt-msg-1'),
      'doubt card NOT yet depleted — deplete fires on reroll consumption');
    // Forced reroll queued with deferred-deplete payload
    assert.strictEqual(combat.forcedRerollQueue.length, 1, 'one forced reroll queued');
    assert.strictEqual(combat.forcedRerollQueue[0].source, 'Doubt');
    assert.strictEqual(combat.forcedRerollQueue[0].pool, 'attack');
    assert.strictEqual(combat.forcedRerollQueue[0].remaining, 1);
    assert.strictEqual(combat.forcedRerollQueue[0].controlPlayer, 2, 'defender controls the forced reroll');
    assert.deepStrictEqual(combat.forcedRerollQueue[0].depleteDc, { msgId: 'doubt-msg-1', playerNum: 2 },
      'deplete deferred — payload encodes the target card');
  });

  it('B-CR-DOUBT-002: skip does not modify forcedRerollQueue', async () => {
    const combat = makeCombat();
    combat.doubtMsgId = 'doubt-msg-1';
    combat.doubtPendingAtkRerolls = 0;
    combat.doubtPendingDefRerolls = 0;
    combat.forcedRerollQueue = [];
    const game = {
      gameId: 'g1',
      player1Id: 'player1',
      player2Id: 'player2',
      pendingCombat: combat,
    };
    const { ctx } = buildCtx(game);
    await handleDoubtReroll(mockInteraction('doubt_reroll_skip_g1', 'player2'), ctx);

    assert.strictEqual(combat.forcedRerollQueue.length, 0, 'queue unchanged');
    assert.strictEqual(game.p2DepletedDcMessageIds, undefined, 'card not depleted');
  });

  it('B-CR-DOUBT-003: enters defender reroll phase when only Doubt queue entry exists', async () => {
    // alexanbv 2026-05-13: 'forced' phase retired during step-3
    // unification. Doubt's forcedRerollQueue entry has
    // controlPlayer=defender, so the bucket renders in defender
    // phase (defender clicks "Use [Doubt]" → opens atk-die picker).
    const combat = makeCombat();
    combat.doubtMsgId = 'doubt-msg-1';
    combat.doubtPendingAtkRerolls = 0;
    combat.doubtPendingDefRerolls = 0;
    const game = {
      gameId: 'g1',
      player1Id: 'player1',
      player2Id: 'player2',
      pendingCombat: combat,
    };
    const { ctx, calls } = buildCtx(game);
    await handleDoubtReroll(mockInteraction('doubt_reroll_use_g1', 'player2'), ctx);

    assert.strictEqual(calls.sendRerollUI.length, 1, 'reroll UI sent');
    assert.strictEqual(calls.sendRerollUI[0].phase, 'defender', 'enters defender reroll phase');
    assert.strictEqual(combat.rerollPhase, 'defender');
  });

  it('B-CR-DOUBT-004: resumes attacker reroll when attacker has rerolls remaining', async () => {
    const combat = makeCombat();
    combat.doubtMsgId = 'doubt-msg-1';
    combat.doubtPendingAtkRerolls = 2;
    combat.doubtPendingDefRerolls = 0;
    const game = {
      gameId: 'g1',
      player1Id: 'player1',
      player2Id: 'player2',
      pendingCombat: combat,
    };
    const { ctx, calls } = buildCtx(game);
    // Skip doubt — still has atk rerolls from before
    await handleDoubtReroll(mockInteraction('doubt_reroll_skip_g1', 'player2'), ctx);

    assert.strictEqual(combat.attackerRerollsRemaining, 2, 'atk rerolls restored');
    assert.strictEqual(calls.sendRerollUI.length, 1);
    assert.strictEqual(calls.sendRerollUI[0].phase, 'attacker', 'attacker gets remaining rerolls');
  });

  it('B-CR-DOUBT-005: doubt + normal rerolls: forced phase when both queue and atk rerolls present', async () => {
    const combat = makeCombat();
    combat.doubtMsgId = 'doubt-msg-1';
    combat.doubtPendingAtkRerolls = 1;
    combat.doubtPendingDefRerolls = 0;
    const game = {
      gameId: 'g1',
      player1Id: 'player1',
      player2Id: 'player2',
      pendingCombat: combat,
    };
    const { ctx, calls } = buildCtx(game);
    await handleDoubtReroll(mockInteraction('doubt_reroll_use_g1', 'player2'), ctx);

    // When both atk rerolls and forced queue exist, atk goes first (preRerolls/atkRem > 0 check)
    assert.strictEqual(combat.attackerRerollsRemaining, 1, 'atk rerolls restored');
    assert.strictEqual(calls.sendRerollUI.length, 1);
    assert.strictEqual(calls.sendRerollUI[0].phase, 'attacker',
      'attacker phase first even with forced queue — forced runs after');
  });

  it('B-CR-DOUBT-006: initializes G12 reroll tracking arrays', async () => {
    const combat = makeCombat();
    delete combat.attackerRerolledIndices;
    delete combat.defenderRerolledIndices;
    combat.doubtMsgId = 'doubt-msg-1';
    combat.doubtPendingAtkRerolls = 1;
    combat.doubtPendingDefRerolls = 0;
    const game = {
      gameId: 'g1',
      player1Id: 'player1',
      player2Id: 'player2',
      pendingCombat: combat,
    };
    const { ctx } = buildCtx(game);
    await handleDoubtReroll(mockInteraction('doubt_reroll_skip_g1', 'player2'), ctx);

    assert.ok(Array.isArray(combat.attackerRerolledIndices), 'G12: initialized');
    assert.ok(Array.isArray(combat.defenderRerolledIndices), 'G12: initialized');
  });
});

// ── B-CR-FE: Force Exhaustion ───────────────────────────────────────────────

describe('B-CR-FE: Force Exhaustion pre-roll die removal', () => {
  it('B-CR-FE-001: yes removes weakest die from attackInfo.dice (yellow first)', async () => {
    const combat = makeCombat();
    combat.attackInfo = { dice: ['blue', 'yellow', 'red'] };
    combat.attackerConds = [];
    const game = {
      gameId: 'g1',
      player1Id: 'player1',
      player2Id: 'player2',
      pendingForceExhaustion: {
        defenderPlayerNum: 2,
        attackerFigureKey: 'Stormtrooper-1-0',
        combatThreadId: 'thread1',
      },
      pendingCombat: combat,
    };
    const { ctx } = buildCtx(game);
    await handleForceExhaustion(mockInteraction('force_exhaustion_yes_g1', 'player2'), ctx);

    assert.deepStrictEqual(combat.attackInfo.dice, ['blue', 'red'],
      'yellow die removed (weakest by priority)');
    assert.strictEqual(game.childIncapacitated, true, 'Child is incapacitated');
    assert.ok(!('pendingForceExhaustion' in game), 'pendingForceExhaustion deleted');
  });

  it('B-CR-FE-002: die removal order is yellow > green > blue > red', async () => {
    // Only green and red available — green should be removed
    const combat = makeCombat();
    combat.attackInfo = { dice: ['red', 'green'] };
    combat.attackerConds = [];
    const game = {
      gameId: 'g1',
      player1Id: 'player1',
      player2Id: 'player2',
      pendingForceExhaustion: {
        defenderPlayerNum: 2,
        attackerFigureKey: 'Stormtrooper-1-0',
        combatThreadId: 'thread1',
      },
      pendingCombat: combat,
    };
    const { ctx } = buildCtx(game);
    await handleForceExhaustion(mockInteraction('force_exhaustion_yes_g1', 'player2'), ctx);

    assert.deepStrictEqual(combat.attackInfo.dice, ['red'], 'green removed before red');
  });

  it('B-CR-FE-003: applies Weaken to attacker via figureConditions', async () => {
    const combat = makeCombat();
    combat.attackInfo = { dice: ['blue', 'red'] };
    combat.attackerConds = [];
    const game = {
      gameId: 'g1',
      player1Id: 'player1',
      player2Id: 'player2',
      figureConditions: {},
      pendingForceExhaustion: {
        defenderPlayerNum: 2,
        attackerFigureKey: 'Stormtrooper-1-0',
        combatThreadId: 'thread1',
      },
      pendingCombat: combat,
    };
    const { ctx } = buildCtx(game);
    await handleForceExhaustion(mockInteraction('force_exhaustion_yes_g1', 'player2'), ctx);

    assert.ok(game.figureConditions['Stormtrooper-1-0']?.includes('Weaken'),
      'Weaken applied via figureConditions');
    assert.ok(combat.attackerConds.includes('Weaken'),
      'Weaken added to combat.attackerConds');
  });

  it('B-CR-FE-004: no path does not modify dice or set incapacitated', async () => {
    const combat = makeCombat();
    combat.attackInfo = { dice: ['blue', 'red'] };
    const origDice = [...combat.attackInfo.dice];
    const game = {
      gameId: 'g1',
      player1Id: 'player1',
      player2Id: 'player2',
      pendingForceExhaustion: {
        defenderPlayerNum: 2,
        attackerFigureKey: 'Stormtrooper-1-0',
        combatThreadId: 'thread1',
      },
      pendingCombat: combat,
    };
    const { ctx } = buildCtx(game);
    await handleForceExhaustion(mockInteraction('force_exhaustion_no_g1', 'player2'), ctx);

    assert.deepStrictEqual(combat.attackInfo.dice, origDice, 'dice unchanged');
    assert.strictEqual(game.childIncapacitated, undefined, 'not incapacitated');
    assert.ok(!('pendingForceExhaustion' in game), 'pendingForceExhaustion still deleted');
  });

  it('B-CR-FE-005: attackInfo.dice is a different array than attackDiceResults', async () => {
    // This test verifies the pre-roll vs post-roll distinction
    const combat = makeCombat();
    combat.attackInfo = { dice: ['blue', 'yellow', 'red'] };
    combat.attackerConds = [];
    const origResults = JSON.parse(JSON.stringify(combat.attackDiceResults));
    const game = {
      gameId: 'g1',
      player1Id: 'player1',
      player2Id: 'player2',
      pendingForceExhaustion: {
        defenderPlayerNum: 2,
        attackerFigureKey: 'Stormtrooper-1-0',
        combatThreadId: 'thread1',
      },
      pendingCombat: combat,
    };
    const { ctx } = buildCtx(game);
    await handleForceExhaustion(mockInteraction('force_exhaustion_yes_g1', 'player2'), ctx);

    // attackInfo.dice modified
    assert.strictEqual(combat.attackInfo.dice.length, 2, 'attackInfo.dice shrunk');
    // attackDiceResults NOT touched (those are post-roll)
    assert.deepStrictEqual(combat.attackDiceResults, origResults,
      'attackDiceResults unchanged — Force Exhaustion is pre-roll');
  });
});

// ── B-CR-HP: Hunter Protocol surge re-trigger ───────────────────────────────

describe('B-CR-HP: Hunter Protocol surge re-trigger', () => {
  it('B-CR-HP-001: trigger applies surge effect and decrements surgeRemaining', async () => {
    const combat = makeCombat();
    combat.surgeDamage = 2;
    combat.surgePierce = 0;
    combat.surgeAccuracy = 0;
    combat.surgeRemaining = 2;
    const game = {
      gameId: 'g1',
      player1Id: 'player1',
      pendingHunterProtocol: { key: 'surge_dmg_2', cost: 1 },
      pendingCombat: combat,
    };
    const { ctx, calls } = buildCtx(game, {
      parseSurgeEffect: (key) => {
        if (key === 'surge_dmg_2') return { damage: 2, pierce: 1 };
        return {};
      },
      getAttackerSurgeAbilities: () => ['surge_dmg_2'],
    });
    await handleHunterProtocol(mockInteraction('hunter_protocol_trigger_g1', 'player1'), ctx);

    assert.strictEqual(combat.surgeDamage, 4, 'damage doubled: 2+2=4');
    assert.strictEqual(combat.surgePierce, 1, 'pierce added');
    assert.strictEqual(combat.surgeRemaining, 1, '2-1=1 surge remaining');
    assert.ok(game.pendingHunterProtocol == null, 'pending cleared');
  });

  it('B-CR-HP-002: trigger tracks surgeSpentCount for Overload compatibility', async () => {
    const combat = makeCombat();
    combat.surgeDamage = 0;
    combat.surgeRemaining = 2;
    combat.surgeSpentCount = {};
    const game = {
      gameId: 'g1',
      player1Id: 'player1',
      pendingHunterProtocol: { key: 'surge_dmg_1', cost: 1 },
      pendingCombat: combat,
    };
    const { ctx } = buildCtx(game, {
      parseSurgeEffect: () => ({ damage: 1 }),
      getAttackerSurgeAbilities: () => ['surge_dmg_1', 'surge_pierce_1'],
    });
    await handleHunterProtocol(mockInteraction('hunter_protocol_trigger_g1', 'player1'), ctx);

    assert.strictEqual(combat.surgeSpentCount[0], 1,
      'surgeSpentCount[0] incremented (surge_dmg_1 is index 0)');
  });

  it('B-CR-HP-003: skip does not modify surge totals', async () => {
    const combat = makeCombat();
    combat.surgeDamage = 2;
    combat.surgeRemaining = 2;
    const game = {
      gameId: 'g1',
      player1Id: 'player1',
      pendingHunterProtocol: { key: 'surge_dmg_1', cost: 1 },
      pendingCombat: combat,
    };
    const { ctx } = buildCtx(game);
    await handleHunterProtocol(mockInteraction('hunter_protocol_skip_g1', 'player1'), ctx);

    assert.strictEqual(combat.surgeDamage, 2, 'damage unchanged');
    assert.strictEqual(combat.surgeRemaining, 2, 'surge remaining unchanged');
    assert.ok(game.pendingHunterProtocol == null, 'pending cleared on skip too');
  });

  it('B-CR-HP-004: proceeds to ready-to-resolve when surgeRemaining reaches 0', async () => {
    const combat = makeCombat();
    combat.surgeDamage = 0;
    combat.surgeRemaining = 1;
    const game = {
      gameId: 'g1',
      player1Id: 'player1',
      pendingHunterProtocol: { key: 'surge_dmg_1', cost: 1 },
      pendingCombat: combat,
    };
    const { ctx, calls } = buildCtx(game, {
      parseSurgeEffect: () => ({ damage: 1 }),
      getAttackerSurgeAbilities: () => ['surge_dmg_1'],
    });
    await handleHunterProtocol(mockInteraction('hunter_protocol_trigger_g1', 'player1'), ctx);

    assert.strictEqual(combat.surgeRemaining, 0);
    assert.strictEqual(calls.sendReadyToResolveRolls.length, 1,
      'transitions to ready-to-resolve when no surge left');
  });
});

// ── B-CR-SOTD: Slow on the Draw combat suspension ──────────────────────────

describe('B-CR-SOTD: Slow on the Draw combat suspend/restore', () => {
  it('B-CR-SOTD-001: yes pushes pendingCombat onto combatStack (architectural fix 2026-05-09)', async () => {
    const combat = makeCombat();
    const game = {
      gameId: 'g1',
      player1Id: 'player1',
      player2Id: 'player2',
      pendingSlowOnTheDraw: {
        attackerFigureKey: 'Greedo-1-0',
        attackerPlayerNum: 1,
        defenderPlayerNum: 2,
        combatThreadId: 'thread1',
      },
      pendingCombat: combat,
    };
    const { ctx } = buildCtx(game);
    await handleSlowOnTheDraw(mockInteraction('slow_on_draw_yes_g1', 'player2'), ctx);

    // SoTD now uses canonical combatStack push (pushNestedCombat) instead
    // of the legacy slowOnTheDrawInterrupt.suspendedCombat side-channel.
    assert.strictEqual(game.pendingCombat, undefined, 'pendingCombat cleared by pushNestedCombat');
    assert.ok(Array.isArray(game.combatStack) && game.combatStack.length === 1,
      'outer combat pushed onto combatStack');
    assert.strictEqual(game.combatStack[0], combat, 'outer is on top of stack by identity');
    assert.strictEqual(game.slowOnTheDrawInterrupt, undefined,
      'no legacy side-channel field set');
    assert.ok(game.pendingSlowOnTheDraw == null, 'pendingSlowOnTheDraw cleared');
  });

  it('B-CR-SOTD-002: no path preserves pendingCombat', async () => {
    const combat = makeCombat();
    const game = {
      gameId: 'g1',
      player1Id: 'player1',
      player2Id: 'player2',
      pendingSlowOnTheDraw: {
        attackerFigureKey: 'Greedo-1-0',
        attackerPlayerNum: 1,
        defenderPlayerNum: 2,
        combatThreadId: 'thread1',
      },
      pendingCombat: combat,
    };
    const { ctx } = buildCtx(game);
    await handleSlowOnTheDraw(mockInteraction('slow_on_draw_no_g1', 'player2'), ctx);

    assert.strictEqual(game.pendingCombat, combat, 'pendingCombat preserved');
    assert.strictEqual(game.slowOnTheDrawInterrupt, undefined, 'no interrupt state');
    assert.ok(game.pendingSlowOnTheDraw == null, 'pendingSlowOnTheDraw cleared');
  });

  it('B-CR-SOTD-003: resume restores suspended combat state', async () => {
    const originalCombat = makeCombat();
    originalCombat._marker = 'original'; // track identity
    const game = {
      gameId: 'g1',
      player1Id: 'player1',
      player2Id: 'player2',
      slowOnTheDrawInterrupt: {
        suspendedCombat: originalCombat,
        attackerFigureKey: 'Greedo-1-0',
        attackerPlayerNum: 1,
        defenderPlayerNum: 2,
      },
      pendingCombat: null, // cleared during interrupt
    };
    const { ctx } = buildCtx(game);
    await handleSlowOnTheDrawResume(mockInteraction('slow_on_draw_resume_g1', 'player1'), ctx);

    assert.strictEqual(game.pendingCombat, originalCombat, 'original combat restored');
    assert.strictEqual(game.pendingCombat._marker, 'original', 'same object by reference');
    assert.strictEqual(game.slowOnTheDrawInterrupt, null, 'interrupt state cleared');
  });

  it('B-CR-SOTD-004: combatStack push/pop preserves dice state through full nested-attack cycle', async () => {
    // Architectural fix 2026-05-09: outer survives a push onto combatStack,
    // inner-1 declares + finishes, popNestedCombat restores outer with its
    // dice state byte-for-byte intact (object identity preserved).
    const combat = makeCombat();
    const origAtk = JSON.parse(JSON.stringify(combat.attackDiceResults));
    const origDef = JSON.parse(JSON.stringify(combat.defenseDiceResults));

    // Step 1: Push outer via SoTD
    const game = {
      gameId: 'g1',
      player1Id: 'player1',
      player2Id: 'player2',
      pendingSlowOnTheDraw: {
        attackerFigureKey: 'Greedo-1-0',
        attackerPlayerNum: 1,
        defenderPlayerNum: 2,
        combatThreadId: 'thread1',
      },
      pendingCombat: combat,
    };
    const { ctx: ctx1 } = buildCtx(game);
    await handleSlowOnTheDraw(mockInteraction('slow_on_draw_yes_g1', 'player2'), ctx1);
    assert.strictEqual(game.pendingCombat, undefined, 'outer pushed off');
    assert.strictEqual(game.combatStack.length, 1, 'outer on stack');

    // Step 2: Inner-1 (defender's interrupt attack) runs and finishes,
    // simulated by popping the stack — that's what resolvePendingCombat
    // does at the end of finishCombatResolution.
    const { popNestedCombat } = await import('../../../src/game/combat-stack.js');
    popNestedCombat(game);

    assert.strictEqual(game.pendingCombat, combat, 'outer restored by identity');
    assert.deepStrictEqual(game.pendingCombat.attackDiceResults, origAtk,
      'attack dice survived stack cycle');
    assert.deepStrictEqual(game.pendingCombat.defenseDiceResults, origDef,
      'defense dice survived stack cycle');
    assert.deepStrictEqual(game.pendingCombat.attackRoll, { acc: 3, dmg: 6, surge: 2 },
      'attack totals intact');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// Phase 3: Strike Me Down, Illicit Arms, Cross-handler chains, Invariants
// ═══════════════════════════════════════════════════════════════════════════

// ── B-CR-SMD: Strike Me Down ────────────────────────────────────────────────

describe('B-CR-SMD: Strike Me Down VP reduction and combat cancellation', () => {
  it('B-CR-SMD-001: yes defeats Obi-Wan with cost reduced by 3 and cancels combat', async () => {
    const combat = makeCombat();
    const dcHealthState = new Map([['obi-msg', [[10, 10]]]]);
    let defeatOpts = null;
    const game = {
      gameId: 'g1',
      player1Id: 'player1',
      player2Id: 'player2',
      pendingStrikeMeDown: {
        defenderPlayerNum: 2,
        attackerPlayerNum: 1,
        defenderFigureKey: 'Obi-Wan Kenobi-1-0',
        combatThreadId: 'thread1',
      },
      pendingCombat: combat,
    };
    const { ctx } = buildCtx(game, {
      dcHealthState,
      findDcMessageIdForFigure: () => 'obi-msg',
      getDcStats: () => ({ cost: 7 }),
      processFigureDefeat: async (_g, opts) => { defeatOpts = opts; },
    });
    await handleStrikeMeDown(mockInteraction('strike_me_down_yes_g1', 'player2'), ctx);

    // VP reduction: 7 - 3 = 4
    assert.strictEqual(game.player1VP.kills, 4, 'VP reduced by 3: 7-3=4');
    assert.strictEqual(game.player1VP.total, 4, 'total VP matches');
    // Combat cancelled
    assert.strictEqual(game.pendingCombat, null, 'combat cancelled');
    // processFigureDefeat called with awardVp: false
    assert.ok(defeatOpts, 'processFigureDefeat called');
    assert.strictEqual(defeatOpts.awardVp, false, 'VP already awarded with reduction');
    assert.strictEqual(defeatOpts.defeatedPlayerNum, 2);
    assert.strictEqual(defeatOpts.figureKey, 'Obi-Wan Kenobi-1-0');
    assert.strictEqual(defeatOpts.source, 'Strike Me Down');
    // Pending cleared
    assert.ok(game.pendingStrikeMeDown == null);
  });

  it('B-CR-SMD-002: VP reduction floors at 0 for cheap units', async () => {
    const combat = makeCombat();
    const dcHealthState = new Map([['obi-msg', [[5, 5]]]]);
    const game = {
      gameId: 'g1',
      player1Id: 'player1',
      player2Id: 'player2',
      pendingStrikeMeDown: {
        defenderPlayerNum: 2,
        attackerPlayerNum: 1,
        defenderFigureKey: 'Obi-Wan Kenobi-1-0',
        combatThreadId: 'thread1',
      },
      pendingCombat: combat,
    };
    const { ctx } = buildCtx(game, {
      dcHealthState,
      findDcMessageIdForFigure: () => 'obi-msg',
      getDcStats: () => ({ cost: 2 }),  // 2 - 3 = -1 → clamped to 0
      processFigureDefeat: async () => {},
    });
    await handleStrikeMeDown(mockInteraction('strike_me_down_yes_g1', 'player2'), ctx);

    // reducedCost = max(0, 2-3) = 0; handler skips awardKillVp when 0
    assert.strictEqual(game.player1VP, undefined, 'no VP object created when reduced cost is 0');
    assert.strictEqual(game.pendingCombat, null, 'combat still cancelled');
  });

  it('B-CR-SMD-003: no path preserves combat and does not award VP', async () => {
    const combat = makeCombat();
    const game = {
      gameId: 'g1',
      player1Id: 'player1',
      player2Id: 'player2',
      pendingStrikeMeDown: {
        defenderPlayerNum: 2,
        attackerPlayerNum: 1,
        defenderFigureKey: 'Obi-Wan Kenobi-1-0',
        combatThreadId: 'thread1',
      },
      pendingCombat: combat,
    };
    const { ctx } = buildCtx(game, {
      dcHealthState: new Map(),
      findDcMessageIdForFigure: () => null,
      getDcStats: () => ({ cost: 7 }),
      processFigureDefeat: async () => {},
    });
    await handleStrikeMeDown(mockInteraction('strike_me_down_no_g1', 'player2'), ctx);

    assert.strictEqual(game.pendingCombat, combat, 'combat preserved');
    assert.strictEqual(game.player1VP, undefined, 'no VP awarded');
    assert.ok(game.pendingStrikeMeDown == null, 'pending cleared');
  });

  it('B-CR-SMD-004: HP reduced to 0 via dcHealthState', async () => {
    const dcHealthState = new Map([['obi-msg', [[8, 10]]]]);
    const combat = makeCombat();
    const game = {
      gameId: 'g1',
      player1Id: 'player1',
      player2Id: 'player2',
      pendingStrikeMeDown: {
        defenderPlayerNum: 2,
        attackerPlayerNum: 1,
        defenderFigureKey: 'Obi-Wan Kenobi-1-0',
        combatThreadId: 'thread1',
      },
      pendingCombat: combat,
    };
    const { ctx } = buildCtx(game, {
      dcHealthState,
      findDcMessageIdForFigure: () => 'obi-msg',
      getDcStats: () => ({ cost: 7 }),
      processFigureDefeat: async () => {},
    });
    await handleStrikeMeDown(mockInteraction('strike_me_down_yes_g1', 'player2'), ctx);

    const hp = dcHealthState.get('obi-msg')[0][0];
    assert.strictEqual(hp, 0, 'Obi-Wan HP reduced to 0');
  });
});

// ── B-CR-IA: Illicit Arms ───────────────────────────────────────────────────

describe('B-CR-IA: Illicit Arms CC discard for +1 Hit', () => {
  it('B-CR-IA-001: pick discards CC from hand and adds +1 bonusHits', async () => {
    const combat = makeCombat();
    combat.bonusHits = 0;
    const game = {
      gameId: 'g1',
      player1Id: 'player1',
      player2Id: 'player2',
      player1CcHand: ['Take Initiative', 'Negation', 'Element of Surprise'],
      pendingIllicitArms: {
        playerNum: 1,
        bibDcName: 'Bib Fortuna',
        combatThreadId: 'thread1',
      },
      pendingCombat: combat,
    };
    const { ctx } = buildCtx(game);
    await handleIllicitArms(mockInteraction('illicit_arms_pick_g1_Negation', 'player1'), ctx);

    assert.strictEqual(combat.bonusHits, 1, '+1 Hit applied');
    assert.deepStrictEqual(game.player1CcHand, ['Take Initiative', 'Element of Surprise'],
      'Negation removed from hand');
    assert.ok(game.player1CcDiscard.includes('Negation'), 'Negation in discard pile');
    assert.ok(game.pendingIllicitArms == null, 'pending cleared');
  });

  it('B-CR-IA-002: card not in hand sends error and clears pending', async () => {
    const combat = makeCombat();
    combat.bonusHits = 0;
    const game = {
      gameId: 'g1',
      player1Id: 'player1',
      player2Id: 'player2',
      player1CcHand: ['Take Initiative'],
      pendingIllicitArms: {
        playerNum: 1,
        bibDcName: 'Bib Fortuna',
        combatThreadId: 'thread1',
      },
      pendingCombat: combat,
    };
    const { ctx, thread } = buildCtx(game);
    await handleIllicitArms(mockInteraction('illicit_arms_pick_g1_Negation', 'player1'), ctx);

    assert.strictEqual(combat.bonusHits, 0, 'no bonus applied');
    assert.deepStrictEqual(game.player1CcHand, ['Take Initiative'], 'hand unchanged');
    assert.ok(game.pendingIllicitArms == null, 'pending still cleared');
    // Thread should have received the error message
    assert.ok(thread._sent.some(m => (typeof m === 'string' ? m : m?.content || '').includes('Card no longer in hand')),
      'error message sent to thread');
  });

  it('B-CR-IA-003: skip path does not modify hand or bonusHits', async () => {
    const combat = makeCombat();
    combat.bonusHits = 0;
    const game = {
      gameId: 'g1',
      player1Id: 'player1',
      player2Id: 'player2',
      player1CcHand: ['Take Initiative', 'Negation'],
      pendingIllicitArms: {
        playerNum: 1,
        bibDcName: 'Bib Fortuna',
        combatThreadId: 'thread1',
      },
      pendingCombat: combat,
    };
    const { ctx } = buildCtx(game);
    await handleIllicitArms(mockInteraction('illicit_arms_skip_g1', 'player1'), ctx);

    assert.strictEqual(combat.bonusHits, 0, 'no bonus');
    assert.strictEqual(game.player1CcHand.length, 2, 'hand unchanged');
    assert.ok(game.pendingIllicitArms == null, 'pending cleared');
  });

  it('B-CR-IA-004: stacks with existing bonusHits', async () => {
    const combat = makeCombat();
    combat.bonusHits = 2; // already had +2 from other sources
    const game = {
      gameId: 'g1',
      player1Id: 'player1',
      player2Id: 'player2',
      player1CcHand: ['Take Initiative'],
      pendingIllicitArms: {
        playerNum: 1,
        bibDcName: 'Bib Fortuna',
        combatThreadId: 'thread1',
      },
      pendingCombat: combat,
    };
    const { ctx } = buildCtx(game);
    await handleIllicitArms(mockInteraction('illicit_arms_pick_g1_Take Initiative', 'player1'), ctx);

    assert.strictEqual(combat.bonusHits, 3, 'stacks: 2+1=3');
  });
});

// ── B-CR-XCHAIN: Cross-handler chains ───────────────────────────────────────

describe('B-CR-XCHAIN: Cross-handler chain tests', () => {
  it('B-CR-XCHAIN-001: TL splice → PC reroll: PC-rerolled die index survives TL splice', async () => {
    // Scenario: 3 dice. PC rerolled index 2 earlier. Attacker also rerolled index 0.
    // TL removes index 0. After splice: dice=[die1, die2(PC)].
    // Verify: die at new index 1 (was PC's die at index 2) IS still marked as rerolled.
    const combat = makeCombat({
      attackerRerolledIndices: [0, 2], // die 0 and die 2 (PC) were rerolled
      attackerRerollsRemaining: 1,
      defenderRerollsRemaining: 0,
    });
    const game = {
      gameId: 'g1',
      player1Id: 'player1',
      pendingToughLuck: { side: 'atk' },
      toughLuckPlayerNum: 1,
      pendingCombat: combat,
    };
    const { ctx } = buildCtx(game);

    // TL removes die at index 0
    await handleToughLuck(mockInteraction('tough_luck_remove_g1_0', 'player1'), ctx);

    // After splice: dice = [blue(was 1), green(was 2)]
    assert.strictEqual(combat.attackDiceResults.length, 2);
    assert.strictEqual(combat.attackDiceResults[0].color, 'blue', 'blue shifted to index 0');
    assert.strictEqual(combat.attackDiceResults[1].color, 'green', 'green shifted to index 1');

    // Rerolled indices: was [0, 2] → remove 0, decrement 2→1 → [1]
    assert.deepStrictEqual(combat.attackerRerolledIndices, [1],
      'PC die (was index 2) correctly tracked at new index 1');

    // Blue at index 0 is NOT in rerolled — it's freshly eligible
    assert.ok(!combat.attackerRerolledIndices.includes(0),
      'blue die (shifted to 0) is NOT rerolled — eligible for attacker reroll');
  });

  it('B-CR-XCHAIN-002: TL splice → subsequent reroll still tracks correctly', async () => {
    // After TL splice adjusts indices, simulate what happens if the attacker then
    // rerolls a die — the new index must not collide with adjusted indices.
    const combat = makeCombat({
      attackerRerolledIndices: [1], // blue was rerolled
      attackerRerollsRemaining: 1,
      defenderRerollsRemaining: 0,
    });
    const game = {
      gameId: 'g1',
      player1Id: 'player1',
      pendingToughLuck: { side: 'atk' },
      toughLuckPlayerNum: 1,
      pendingCombat: combat,
    };
    const { ctx } = buildCtx(game);

    // TL removes blue (index 1) → dice = [red, green]
    await handleToughLuck(mockInteraction('tough_luck_remove_g1_1', 'player1'), ctx);

    // rerolledIndices = [] (index 1 removed, nothing above it)
    assert.deepStrictEqual(combat.attackerRerolledIndices, []);

    // Now simulate attacker rerolling green (index 1 in the new array)
    // This would normally happen via combat.js reroll handler, but we can
    // verify the index is eligible by checking it's not in rerolledIndices
    assert.ok(!combat.attackerRerolledIndices.includes(1),
      'green at new index 1 is eligible for reroll');
    assert.ok(!combat.attackerRerolledIndices.includes(0),
      'red at index 0 is also eligible');
  });

  it('B-CR-XCHAIN-003: PC → VI defense chain: PC _resumeRerollFlow hands off to VI', async () => {
    // PC resolves color swap. Defender has Vet Instincts active.
    // PC's _resumeRerollFlow should detect VI defense pending and store reroll counts.
    const combat = makeCombat();
    combat.powerConverterDieIndex = 0;
    combat.pcPendingAtkRerolls = 1;
    combat.pcPendingDefRerolls = 1;
    combat.vetInstinctsAttackApplied = true; // attack phase done
    // Per-figure 2026-05-09: VI keyed by defender figureKey, not playerNum.
    combat.target = { figureKey: 'Stormtrooper-1-0' };
    // Defense NOT yet applied — _resumeRerollFlow should detect this
    const game = {
      gameId: 'g1',
      player1Id: 'player1',
      player2Id: 'player2',
      // Per-figure 2026-05-09 (multifigure-independent-activation rule). Keyed by defender figureKey.
      vetInstinctsActiveThisActivation: { 'Stormtrooper-1-0': true },
      pendingCombat: combat,
    };
    const { ctx, thread } = buildCtx(game);
    await handlePowerConverter(mockInteraction('power_converter_color_g1_red', 'player1'), ctx);

    // PC should have stored the pending reroll counts for VI to use later
    assert.strictEqual(combat.viPendingAtkRerolls, 1, 'atk rerolls stored for VI');
    assert.strictEqual(combat.viPendingDefRerolls, 1, 'def rerolls stored for VI');

    // Thread should have VI defense UI message
    const viMsg = thread._sent.find(m => {
      const content = typeof m === 'string' ? m : m?.content || '';
      return content.includes('Veteran Instincts');
    });
    assert.ok(viMsg, 'VI defense UI sent by PC _resumeRerollFlow');
  });

  it('B-CR-XCHAIN-004: PC → VI → reroll: full chain from PC color through VI to reroll window', async () => {
    // Full chain:
    // Step 1: PC color swap (rerolls die, stores pending counts)
    // Step 2: _resumeRerollFlow → VI defense
    // Step 3: VI defense adds +1 block → enters reroll window with stored counts
    const combat = makeCombat();
    combat.powerConverterDieIndex = 0;
    combat.pcPendingAtkRerolls = 1;
    combat.pcPendingDefRerolls = 0;
    combat.vetInstinctsAttackApplied = true;
    // Per-figure 2026-05-09: VI keyed by defender figureKey, not playerNum.
    combat.target = { figureKey: 'Stormtrooper-1-0' };
    const game = {
      gameId: 'g1',
      player1Id: 'player1',
      player2Id: 'player2',
      vetInstinctsActiveThisActivation: { 'Stormtrooper-1-0': true },
      pendingCombat: combat,
    };

    // Step 1: PC color swap
    const { ctx: ctx1 } = buildCtx(game);
    await handlePowerConverter(mockInteraction('power_converter_color_g1_red', 'player1'), ctx1);

    // Verify PC stored VI pending counts
    assert.strictEqual(combat.viPendingAtkRerolls, 1);

    // Step 2: VI defense (+1 block)
    const { ctx: ctx2, calls: calls2 } = buildCtx(game);
    await handleVetInstincts(mockInteraction('vet_instincts_pick_g1_block', 'player2'), ctx2);

    assert.strictEqual(combat.defenseRoll.block, 4, 'VI +1 block applied (3→4)');
    assert.strictEqual(combat.vetInstinctsDefenseApplied, true);

    // Step 3: VI should have entered reroll window with the stored atk count
    assert.strictEqual(calls2.sendRerollUI.length, 1, 'reroll UI sent');
    assert.strictEqual(calls2.sendRerollUI[0].phase, 'attacker',
      'attacker gets 1 reroll (from pcPendingAtkRerolls)');
    assert.strictEqual(combat.attackerRerollsRemaining, 1);
  });

  it('B-CR-XCHAIN-005: TL defense splice → TINT face set → totals reflect both mutations', async () => {
    // Defense chain: TL removes a defense die, then TINT sets a face on the remaining die.
    // Start: defense = [black(2B/0E), white(1B/1E)]
    const combat = makeCombat({
      defenderRerolledIndices: [1], // white was rerolled
      attackerRerollsRemaining: 0,
      defenderRerollsRemaining: 0,
    });
    const game = {
      gameId: 'g1',
      player1Id: 'player1',
      player2Id: 'player2',
      pendingToughLuck: { side: 'def' },
      toughLuckPlayerNum: 1,
      pendingCombat: combat,
    };

    // Step 1: TL removes white (index 1) → defense = [black(2B/0E)]
    const { ctx: ctx1 } = buildCtx(game);
    await handleToughLuck(mockInteraction('tough_luck_remove_g1_1', 'player1'), ctx1);

    assert.strictEqual(combat.defenseDiceResults.length, 1);
    assert.deepStrictEqual(combat.defenseRoll, { block: 2, evade: 0, dodge: 0 });

    // Step 2: TINT sets black die face to 1B/1E
    game.pendingThereIsNoTry = { pickedDieIdx: 0 };
    const { ctx: ctx2 } = buildCtx(game);
    await handleThereIsNoTry(mockInteraction('there_is_no_try_face_g1_0_1_1_0', 'player2'), ctx2);

    assert.strictEqual(combat.defenseDiceResults[0].block, 1);
    assert.strictEqual(combat.defenseDiceResults[0].evade, 1);
    assert.deepStrictEqual(combat.defenseRoll, { block: 1, evade: 1, dodge: 0 },
      'totals reflect both TL removal and TINT face set');
  });
});

// ── B-CR-INVARIANT: Pending-state / reroll invariants ───────────────────────

describe('B-CR-INVARIANT: Pending-state and reroll invariants', () => {
  it('B-CR-INV-001: all combat-reaction handlers clear their pending flag on both paths', async () => {
    // Verify that every handler clears its pending state on both accept and skip/no.
    // This is a meta-test — each handler's pending flag name and clear behavior.
    const pendingChecks = [
      {
        name: 'ToughLuck',
        field: 'pendingToughLuck',
        accept: async (game, ctx) => {
          game.pendingToughLuck = { side: 'atk' };
          game.toughLuckPlayerNum = 1;
          game.pendingCombat = makeCombat({ attackerRerolledIndices: [0] });
          await handleToughLuck(mockInteraction('tough_luck_remove_g1_0', 'player1'), ctx);
        },
        skip: async (game, ctx) => {
          game.pendingToughLuck = { side: 'atk' };
          game.toughLuckPlayerNum = 1;
          game.pendingCombat = makeCombat();
          await handleToughLuck(mockInteraction('tough_luck_skip_g1', 'player1'), ctx);
        },
      },
      {
        name: 'ThereIsNoTry',
        field: 'pendingThereIsNoTry',
        accept: async (game, ctx) => {
          game.pendingThereIsNoTry = { pickedDieIdx: 0 };
          game.pendingCombat = makeCombat();
          await handleThereIsNoTry(mockInteraction('there_is_no_try_face_g1_0_1_0_0', 'player2'), ctx);
        },
        skip: async (game, ctx) => {
          game.pendingThereIsNoTry = {};
          game.pendingCombat = makeCombat();
          await handleThereIsNoTry(mockInteraction('there_is_no_try_skip_g1', 'player2'), ctx);
        },
      },
      {
        name: 'StrikeMeDown',
        field: 'pendingStrikeMeDown',
        accept: async (game, ctx) => {
          game.pendingStrikeMeDown = { defenderPlayerNum: 2, attackerPlayerNum: 1, defenderFigureKey: 'Obi-Wan Kenobi-1-0', combatThreadId: 'thread1' };
          game.pendingCombat = makeCombat();
          await handleStrikeMeDown(mockInteraction('strike_me_down_yes_g1', 'player2'), ctx);
        },
        skip: async (game, ctx) => {
          game.pendingStrikeMeDown = { defenderPlayerNum: 2, attackerPlayerNum: 1, defenderFigureKey: 'Obi-Wan Kenobi-1-0', combatThreadId: 'thread1' };
          game.pendingCombat = makeCombat();
          await handleStrikeMeDown(mockInteraction('strike_me_down_no_g1', 'player2'), ctx);
        },
      },
      {
        name: 'SlowOnTheDraw',
        field: 'pendingSlowOnTheDraw',
        accept: async (game, ctx) => {
          game.pendingSlowOnTheDraw = { attackerFigureKey: 'Greedo-1-0', attackerPlayerNum: 1, defenderPlayerNum: 2, combatThreadId: 'thread1' };
          game.pendingCombat = makeCombat();
          await handleSlowOnTheDraw(mockInteraction('slow_on_draw_yes_g1', 'player2'), ctx);
        },
        skip: async (game, ctx) => {
          game.pendingSlowOnTheDraw = { attackerFigureKey: 'Greedo-1-0', attackerPlayerNum: 1, defenderPlayerNum: 2, combatThreadId: 'thread1' };
          game.pendingCombat = makeCombat();
          await handleSlowOnTheDraw(mockInteraction('slow_on_draw_no_g1', 'player2'), ctx);
        },
      },
      {
        name: 'HunterProtocol',
        field: 'pendingHunterProtocol',
        accept: async (game, ctx) => {
          game.pendingHunterProtocol = { key: 's1', cost: 1 };
          game.pendingCombat = makeCombat();
          game.pendingCombat.surgeDamage = 0;
          game.pendingCombat.surgeRemaining = 1;
          await handleHunterProtocol(mockInteraction('hunter_protocol_trigger_g1', 'player1'), ctx);
        },
        skip: async (game, ctx) => {
          game.pendingHunterProtocol = { key: 's1', cost: 1 };
          game.pendingCombat = makeCombat();
          game.pendingCombat.surgeDamage = 0;
          game.pendingCombat.surgeRemaining = 1;
          await handleHunterProtocol(mockInteraction('hunter_protocol_skip_g1', 'player1'), ctx);
        },
      },
      {
        name: 'IllicitArms',
        field: 'pendingIllicitArms',
        accept: async (game, ctx) => {
          game.pendingIllicitArms = { playerNum: 1, bibDcName: 'Bib Fortuna', combatThreadId: 'thread1' };
          game.player1CcHand = ['Card A'];
          game.pendingCombat = makeCombat();
          game.pendingCombat.bonusHits = 0;
          await handleIllicitArms(mockInteraction('illicit_arms_pick_g1_Card A', 'player1'), ctx);
        },
        skip: async (game, ctx) => {
          game.pendingIllicitArms = { playerNum: 1, bibDcName: 'Bib Fortuna', combatThreadId: 'thread1' };
          game.pendingCombat = makeCombat();
          await handleIllicitArms(mockInteraction('illicit_arms_skip_g1', 'player1'), ctx);
        },
      },
    ];

    for (const check of pendingChecks) {
      // Accept path
      const gameA = { gameId: 'g1', player1Id: 'player1', player2Id: 'player2' };
      const { ctx: ctxA } = buildCtx(gameA, {
        dcHealthState: new Map([['obi-msg', [[10, 10]]]]),
        findDcMessageIdForFigure: () => 'obi-msg',
        getDcStats: () => ({ cost: 7 }),
        processFigureDefeat: async () => {},
        parseSurgeEffect: () => ({ damage: 1 }),
        getAttackerSurgeAbilities: () => ['s1'],
      });
      await check.accept(gameA, ctxA);
      assert.ok(gameA[check.field] == null,
        `${check.name} accept: ${check.field} should be cleared (got ${JSON.stringify(gameA[check.field])})`);

      // Skip path
      const gameS = { gameId: 'g1', player1Id: 'player1', player2Id: 'player2' };
      const { ctx: ctxS } = buildCtx(gameS, {
        dcHealthState: new Map(),
        findDcMessageIdForFigure: () => null,
        getDcStats: () => ({ cost: 7 }),
        processFigureDefeat: async () => {},
        parseSurgeEffect: () => ({}),
        getAttackerSurgeAbilities: () => [],
      });
      await check.skip(gameS, ctxS);
      assert.ok(gameS[check.field] == null,
        `${check.name} skip: ${check.field} should be cleared (got ${JSON.stringify(gameS[check.field])})`);
    }
  });

  it('B-CR-INV-002: rerollPhase set to null when no rerolls remain after any handler', async () => {
    // After TL, TINT, VI, PC, Doubt each resolve with 0 rerolls remaining,
    // rerollPhase should be null (not stuck in a stale phase).
    const handlers = [
      {
        name: 'TL',
        setup: (game) => {
          game.pendingToughLuck = { side: 'atk' };
          game.toughLuckPlayerNum = 1;
          game.pendingCombat = makeCombat({ attackerRerolledIndices: [0] });
        },
        run: async (game, ctx) => handleToughLuck(mockInteraction('tough_luck_remove_g1_0', 'player1'), ctx),
      },
      {
        name: 'TINT',
        setup: (game) => {
          game.pendingThereIsNoTry = { pickedDieIdx: 0 };
          game.pendingCombat = makeCombat();
        },
        run: async (game, ctx) => handleThereIsNoTry(mockInteraction('there_is_no_try_face_g1_0_1_0_0', 'player2'), ctx),
      },
      {
        name: 'VI',
        setup: (game) => {
          game.pendingCombat = makeCombat();
          game.pendingCombat.vetInstinctsAttackApplied = true;
          game.pendingCombat.viPendingAtkRerolls = 0;
          game.pendingCombat.viPendingDefRerolls = 0;
        },
        run: async (game, ctx) => handleVetInstincts(mockInteraction('vet_instincts_pick_g1_block', 'player2'), ctx),
      },
      {
        name: 'Doubt',
        setup: (game) => {
          game.pendingCombat = makeCombat();
          game.pendingCombat.doubtMsgId = 'd1';
          game.pendingCombat.doubtPendingAtkRerolls = 0;
          game.pendingCombat.doubtPendingDefRerolls = 0;
          game.pendingCombat.forcedRerollQueue = [];
        },
        run: async (game, ctx) => handleDoubtReroll(mockInteraction('doubt_reroll_skip_g1', 'player2'), ctx),
      },
    ];

    for (const h of handlers) {
      const game = { gameId: 'g1', player1Id: 'player1', player2Id: 'player2' };
      h.setup(game);
      const { ctx } = buildCtx(game);
      await h.run(game, ctx);
      assert.strictEqual(game.pendingCombat?.rerollPhase ?? null, null,
        `${h.name}: rerollPhase should be null when no rerolls remain`);
    }
  });
});
