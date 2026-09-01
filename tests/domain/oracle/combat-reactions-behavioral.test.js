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
  handleThereIsNoTry, handleForceExhaustion, handleForceExhaustionDiePick,
  handleHunterProtocol, handleSlowOnTheDraw, handleSlowOnTheDrawResume,
  handleStrikeMeDown,
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
// The legacy round-long handleToughLuck (tough_luck_*) was removed 2026-06-18.
// Tough Luck is now the discrete _offerToughLuck → handleToughLuckGate (tlgate_*)
// reaction; its behavioral oracle lives in tough-luck-discrete.test.js +
// gate-tough-luck.test.js.

// ── B-CR-TINT: There Is No Try ──────────────────────────────────────────────

describe('B-CR-TINT: There Is No Try face replacement', () => {
  it('B-CR-TINT-001: sets chosen face on defense die and recalculates totals', async () => {
    const combat = makeCombat();
    const game = {
      gameId: 'g1',
      player1Id: 'player1',
      player2Id: 'player2',
      pendingThereIsNoTry: { pickedDieIdx: 0, pickedPool: 'defense', playerNum: 2 },
      pendingCombat: combat,
    };
    const { ctx } = buildCtx(game);
    // face: 1 block, 1 evade, no dodge
    await handleThereIsNoTry(mockInteraction('there_is_no_try_face_g1_defense_0_1_1_0', 'player2'), ctx);

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
      pendingThereIsNoTry: { pickedDieIdx: 1, pickedPool: 'defense', playerNum: 2 },
      pendingCombat: combat,
    };
    const { ctx } = buildCtx(game);
    // face: 0 block, 0 evade, dodge=1 → converted to 0+2=2 block, 0+1=1 evade, dodge=false
    await handleThereIsNoTry(mockInteraction('there_is_no_try_face_g1_defense_1_0_0_1', 'player2'), ctx);

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

});


// ── B-CR-CHAIN: Multi-step reroll chains ────────────────────────────────────

describe('B-CR-CHAIN: Multi-step reroll chain tests', () => {
  // B-CR-CHAIN-001 (TL splice chain) removed 2026-06-18 — legacy handleToughLuck
  // is gone; the discrete Tough Luck reaction is covered in tough-luck-discrete.test.js.

  // B-CR-CHAIN-003 (TL defense splice + TINT skip) removed 2026-06-18 — legacy
  // handleToughLuck is gone. TINT skip is still covered by B-CR-TINT tests.
});

// ── B-CR-REJECT: Rejected sequences ────────────────────────────────────────

describe('B-CR-REJECT: Rejected/no-op sequences', () => {
  // B-CR-REJECT-001 (TL no-op) removed 2026-06-18 — legacy handleToughLuck gone;
  // the discrete gate handler's "no pending" guard is covered by gate-tough-luck.test.js.

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
});

// ── B-CR-CLEANUP: State cleanup ─────────────────────────────────────────────

describe('B-CR-CLEANUP: State cleanup after handlers', () => {
  // B-CR-CLEANUP-001 (TL clears pendingToughLuck) removed 2026-06-18 — legacy
  // handleToughLuck gone; discrete-path cleanup is covered in tough-luck-discrete.test.js.

  it('B-CR-CLEANUP-002: TINT sets tintResolved on both face pick and skip', async () => {
    // Face path
    const combat1 = makeCombat();
    const game1 = {
      gameId: 'g1', player1Id: 'player1', player2Id: 'player2',
      pendingThereIsNoTry: { pickedDieIdx: 0, pickedPool: 'defense', playerNum: 2 },
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
});

// ═══════════════════════════════════════════════════════════════════════════
// Phase 2: Power Converter, Doubt, Force Exhaustion, Hunter Protocol, SOTD
// ═══════════════════════════════════════════════════════════════════════════

// ── B-CR-FE: Force Exhaustion ───────────────────────────────────────────────

describe('B-CR-FE: Force Exhaustion (incap → attacker picks die + Weaken, two cases)', () => {
  // Per alexanbv's refined ruling (2026-06-19): incapacitating The Child ALWAYS
  // removes 1 attack die AND Weakens the attacker — but the die removed is now
  // the ATTACKER's CHOICE, not an auto weakest-first pick. The flow is two-step:
  //   1) defender clicks force_exhaustion_yes_ → Child incapacitated + conditions
  //      cleared, pendingForceExhaustionDiePick set, picker posted to attacker.
  //      No die removed / no Weaken / no forceMiss yet (the gate stays blocked).
  //   2) attacker clicks fe_die_pick_<g>_<idx> → THAT die removed, attacker
  //      Weakened, then: target-is-child → forceMiss (Focus+Hidden stripped);
  //      clan-of-two → attack PROCEEDS with reduced pool.
  function feCombat(overrides = {}) {
    const c = makeCombat();
    c.gameId = 'g1';
    c.attackerFigureKey = 'Stormtrooper-1-0';
    c.attackerDcName = 'Stormtrooper';
    c.attackerConds = [];
    c.attackInfo = { dice: ['blue', 'yellow', 'red'] };
    c.target = { figureKey: 'The Child-1-0', label: 'The Child' };
    return Object.assign(c, overrides);
  }
  function feGame(combat, { targetIsChild = true, ...extra } = {}) {
    return {
      gameId: 'g1',
      player1Id: 'player1',
      player2Id: 'player2',
      figureConditions: {},
      pendingForceExhaustion: {
        defenderPlayerNum: 2,
        attackerPlayerNum: 1,
        attackerFigureKey: 'Stormtrooper-1-0',
        childFigureKey: 'The Child-1-0',
        targetIsChild,
        combatThreadId: 'thread1',
      },
      pendingCombat: combat,
      ...extra,
    };
  }

  // ── Step 1 (defender Yes): incap + picker handoff, no die/Weaken/miss yet ──
  it('B-CR-FE-000: yes → incap + die-pick pending posted to attacker (no die removed yet)', async () => {
    const combat = feCombat();
    const game = feGame(combat, { targetIsChild: true });
    const { ctx } = buildCtx(game);
    await handleForceExhaustion(mockInteraction('force_exhaustion_yes_g1', 'player2'), ctx);

    assert.strictEqual(game.childIncapacitated, true, 'Child is incapacitated immediately');
    assert.ok(game.pendingForceExhaustionDiePick, 'die-pick pending posted to attacker');
    assert.strictEqual(game.pendingForceExhaustionDiePick.attackerPlayerNum, 1, 'pending targets the attacker');
    assert.strictEqual(game.pendingForceExhaustionDiePick.targetIsChild, true, 'targetIsChild carried forward');
    assert.ok(!('pendingForceExhaustion' in game), 'Yes/No decision replaced by die-pick');
    // Nothing else resolved until the attacker picks.
    assert.deepStrictEqual(combat.attackInfo.dice, ['blue', 'yellow', 'red'], 'no die removed yet');
    assert.ok(!(game.figureConditions['Stormtrooper-1-0'] || []).includes('Weaken'), 'no Weaken yet');
    assert.notStrictEqual(combat.forceMiss, true, 'no forced miss yet');
  });

  // ── Case A: The Child ITSELF is the target (targetIsChild) ──
  it('B-CR-FE-001: target=Child → attacker picks die → that die removed, forces miss', async () => {
    const combat = feCombat();
    const game = feGame(combat, { targetIsChild: true });
    const { ctx } = buildCtx(game);
    await handleForceExhaustion(mockInteraction('force_exhaustion_yes_g1', 'player2'), ctx);
    // Attacker chooses the RED die (index 2) — a non-default pick proves choice.
    await handleForceExhaustionDiePick(mockInteraction('fe_die_pick_g1_2', 'player1'), ctx);

    assert.strictEqual(game.childIncapacitated, true, 'Child is incapacitated');
    assert.deepStrictEqual(combat.attackInfo.dice, ['blue', 'yellow'], 'attacker-chosen red die removed');
    assert.strictEqual(combat.forceMiss, true, 'attack flagged as a forced miss');
    assert.strictEqual(combat._step7Hit, false, 'synthesized miss (no hit)');
    assert.strictEqual(combat._step7Damage, 0, 'no damage on a forced miss');
    assert.ok(!('pendingForceExhaustionDiePick' in game), 'die-pick pending cleared');
  });

  it('B-CR-FE-002: target=Child → attacker becomes Weakened after pick', async () => {
    const combat = feCombat();
    const game = feGame(combat, { targetIsChild: true });
    const { ctx } = buildCtx(game);
    await handleForceExhaustion(mockInteraction('force_exhaustion_yes_g1', 'player2'), ctx);
    await handleForceExhaustionDiePick(mockInteraction('fe_die_pick_g1_1', 'player1'), ctx);

    assert.ok((game.figureConditions['Stormtrooper-1-0'] || []).includes('Weaken'),
      'attacker Weakened via figureConditions');
    assert.ok((combat.attackerConds || []).includes('Weaken'),
      'Weaken added to combat.attackerConds');
  });

  it('B-CR-FE-003: target=Child → attacker still loses Focus and Hidden after pick', async () => {
    const combat = feCombat();
    combat.attackerConds = ['Focus', 'Hide'];
    const game = feGame(combat, {
      targetIsChild: true,
      figureConditions: { 'Stormtrooper-1-0': ['Focus', 'Hide'] },
    });
    const { ctx } = buildCtx(game);
    await handleForceExhaustion(mockInteraction('force_exhaustion_yes_g1', 'player2'), ctx);
    await handleForceExhaustionDiePick(mockInteraction('fe_die_pick_g1_1', 'player1'), ctx);

    assert.ok(!(game.figureConditions['Stormtrooper-1-0'] || []).includes('Focus'),
      'Focus consumed on the attacker');
    assert.ok(!(game.figureConditions['Stormtrooper-1-0'] || []).includes('Hide'),
      'Hidden removed from the attacker');
    assert.ok(!combat.attackerConds.includes('Focus'), 'Focus off combat.attackerConds');
    assert.ok(!combat.attackerConds.includes('Hide'), 'Hide off combat.attackerConds');
  });

  it('B-CR-FE-004: yes clears The Child\'s conditions on incapacitation (CRR-INCP-002)', async () => {
    const combat = feCombat();
    const game = feGame(combat, {
      targetIsChild: true,
      figureConditions: { 'The Child-1-0': ['Focus'] },
    });
    const { ctx } = buildCtx(game);
    // Conditions clear at incap (step 1) — before any die pick.
    await handleForceExhaustion(mockInteraction('force_exhaustion_yes_g1', 'player2'), ctx);

    assert.ok(!('The Child-1-0' in game.figureConditions),
      'The Child\'s conditions discarded on incapacitation');
  });

  // ── Case B: a Clan-of-Two-attached figure is the target ──
  it('B-CR-FE-005: target=clan-of-two figure → attacker picks die + Weaken, but attack PROCEEDS', async () => {
    const combat = feCombat();
    const game = feGame(combat, { targetIsChild: false });
    const { ctx } = buildCtx(game);
    await handleForceExhaustion(mockInteraction('force_exhaustion_yes_g1', 'player2'), ctx);
    // Attacker chooses the BLUE die (index 0).
    await handleForceExhaustionDiePick(mockInteraction('fe_die_pick_g1_0', 'player1'), ctx);

    assert.strictEqual(game.childIncapacitated, true, 'Child is incapacitated');
    assert.deepStrictEqual(combat.attackInfo.dice, ['yellow', 'red'], 'attacker-chosen blue die removed');
    assert.ok((game.figureConditions['Stormtrooper-1-0'] || []).includes('Weaken'),
      'attacker Weakened');
    assert.ok((combat.attackerConds || []).includes('Weaken'), 'Weaken on combat.attackerConds');
    assert.notStrictEqual(combat.forceMiss, true, 'NO forced miss — attack proceeds');
    assert.notStrictEqual(combat._step7Hit, false, 'not synthesized as a miss');
    assert.ok(!('pendingForceExhaustionDiePick' in game),
      'die-pick pending cleared so the gate can resume to roll');
  });

  // ── Decline ──
  it('B-CR-FE-006: no → attack proceeds, dice untouched, no incap, no die-pick', async () => {
    const combat = feCombat();
    const origDice = [...combat.attackInfo.dice];
    const game = feGame(combat, { targetIsChild: true });
    const { ctx } = buildCtx(game);
    await handleForceExhaustion(mockInteraction('force_exhaustion_no_g1', 'player2'), ctx);

    assert.deepStrictEqual(combat.attackInfo.dice, origDice, 'dice unchanged on decline');
    assert.strictEqual(combat.forceMiss, undefined, 'no forced miss on decline');
    assert.strictEqual(game.childIncapacitated, undefined, 'not incapacitated');
    assert.ok(!('pendingForceExhaustion' in game), 'pendingForceExhaustion cleared');
    assert.ok(!('pendingForceExhaustionDiePick' in game), 'no die-pick on decline');
  });

  // ── Fallback: single-die pool resolves immediately (no interactive pick) ──
  it('B-CR-FE-007: yes with ≤1 die in pool → auto-resolves without a picker', async () => {
    const combat = feCombat({ attackInfo: { dice: ['red'] } });
    const game = feGame(combat, { targetIsChild: false });
    const { ctx } = buildCtx(game);
    await handleForceExhaustion(mockInteraction('force_exhaustion_yes_g1', 'player2'), ctx);

    assert.strictEqual(game.childIncapacitated, true, 'Child incapacitated');
    assert.deepStrictEqual(combat.attackInfo.dice, [], 'sole die removed via fallback');
    assert.ok((game.figureConditions['Stormtrooper-1-0'] || []).includes('Weaken'), 'attacker Weakened');
    assert.ok(!('pendingForceExhaustionDiePick' in game), 'no picker posted (≤1 die)');
    assert.ok(!('pendingForceExhaustion' in game), 'Yes/No decision cleared');
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

// ── B-CR-INVARIANT: Pending-state / reroll invariants ───────────────────────

describe('B-CR-INVARIANT: Pending-state and reroll invariants', () => {
  it('B-CR-INV-001: all combat-reaction handlers clear their pending flag on both paths', async () => {
    // Verify that every handler clears its pending state on both accept and skip/no.
    // This is a meta-test — each handler's pending flag name and clear behavior.
    // ToughLuck removed from this meta-check 2026-06-18 — legacy handleToughLuck
    // gone; the discrete gate handler's clear-on-resolve is covered directly in
    // tough-luck-discrete.test.js.
    const pendingChecks = [
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
    // TL entry removed 2026-06-18 — legacy handleToughLuck gone; the discrete gate
    // handler resumes the rerolls window via _driveGatePath, covered by gate tests.
    const handlers = [
      {
        name: 'TINT',
        setup: (game) => {
          game.pendingThereIsNoTry = { pickedDieIdx: 0 };
          game.pendingCombat = makeCombat();
        },
        run: async (game, ctx) => handleThereIsNoTry(mockInteraction('there_is_no_try_face_g1_0_1_0_0', 'player2'), ctx),
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

// ── B-CR-TINT-ATK: There Is No Try on the ATTACK pool ────────────────────────
//
// The card reads "when a friendly REBEL FORCE USER within 4 spaces rolls ANY
// NUMBER OF DICE". It was implemented over the defense pool only, so playing it
// on an attack roll silently did nothing — the handler read
// combat.defenseDiceResults unconditionally and built its face list with
// getDistinctDieFaces('defense', ...). alexanbv 2026-08-31: "Yoda CC works for
// attack or defense".
describe('B-CR-TINT-ATK: There Is No Try turns attack dice too', () => {
  it('B-CR-TINT-ATK-001: sets the chosen face on an attack die and re-totals', async () => {
    const combat = makeCombat();
    const game = {
      gameId: 'g1',
      player1Id: 'player1',
      player2Id: 'player2',
      pendingThereIsNoTry: { pickedDieIdx: 1, pickedPool: 'attack', playerNum: 1 },
      pendingCombat: combat,
    };
    const { ctx } = buildCtx(game);
    // Attack faces encode as acc_dmg_surge. Turn die #1 (blue 2a/1d/1s) to 0a/3d/0s.
    await handleThereIsNoTry(mockInteraction('there_is_no_try_face_g1_attack_1_0_3_0', 'player1'), ctx);

    const die = combat.attackDiceResults[1];
    assert.strictEqual(die.dmg, 3, 'damage set from the chosen face');
    assert.strictEqual(die.surge, 0, 'surge set from the chosen face');
    assert.strictEqual(die.acc, 0, 'accuracy set from the chosen face');
    assert.strictEqual(die.color, 'blue', 'the die keeps its colour');

    // red 1a/3d/0s + turned 0a/3d/0s + green 0a/2d/1s = 1 acc, 8 dmg, 1 surge
    assert.strictEqual(combat.attackRoll.dmg, 8, 'attack totals recalculated');
    assert.strictEqual(combat.attackRoll.surge, 1);
    assert.strictEqual(combat.attackRoll.acc, 1);
    assert.ok(game.pendingThereIsNoTry == null, 'pending state cleared');
    assert.strictEqual(combat.tintResolved, true);
  });

  it('B-CR-TINT-ATK-002: the defense pool is untouched when turning an attack die', async () => {
    const combat = makeCombat();
    const before = JSON.parse(JSON.stringify(combat.defenseDiceResults));
    const game = {
      gameId: 'g1',
      player1Id: 'player1',
      player2Id: 'player2',
      pendingThereIsNoTry: { pickedDieIdx: 0, pickedPool: 'attack', playerNum: 1 },
      pendingCombat: combat,
    };
    const { ctx } = buildCtx(game);
    await handleThereIsNoTry(mockInteraction('there_is_no_try_face_g1_attack_0_0_2_1', 'player1'), ctx);

    assert.deepStrictEqual(combat.defenseDiceResults, before, 'defense dice unchanged');
    assert.strictEqual(combat.defenseRoll.block, 3, 'defense totals unchanged');
  });

  it('B-CR-TINT-ATK-003: an attack die never gains a dodge flag', async () => {
    const combat = makeCombat();
    const game = {
      gameId: 'g1',
      player1Id: 'player1',
      player2Id: 'player2',
      pendingThereIsNoTry: { pickedDieIdx: 0, pickedPool: 'attack', playerNum: 1 },
      pendingCombat: combat,
    };
    const { ctx } = buildCtx(game);
    await handleThereIsNoTry(mockInteraction('there_is_no_try_face_g1_attack_0_0_1_0', 'player1'), ctx);
    assert.ok(!('dodge' in combat.attackDiceResults[0]) || combat.attackDiceResults[0].dodge === undefined,
      'dodge is a defense concept and must not leak onto an attack die');
  });
});
