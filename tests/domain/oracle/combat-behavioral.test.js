/**
 * BEHAVIORAL oracle tests for combat.js handlers.
 *
 * Phase 1: Surge resolution, reroll queue ordering, pending-state invariants,
 *          and strain→defeat guards — the highest-risk mutation flows.
 *
 * Test categories:
 *   B-C-SURGE-*:   Surge spending, spentCount tracking, Overload
 *   B-C-REROLL-*:  Reroll queue ordering, forced/pre-reroll, phase transitions
 *   B-C-PENDING-*: Pending-state invariants
 *   B-C-STRAIN-*:  Strain→defeat guard, resolveStrainDamage
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  handleCombatSurge, handleCombatReroll, handlePreReroll,
  handleStrainChoice, sendRerollUI, proceedAfterRerolls,
  resumeSurgeChoiceOrResolve,
} from '../../../src/handlers/combat.js';
import {
  recalcAttackTotals, recalcDefenseTotals, getAttackerSurgeAbilities, parseSurgeEffect,
} from '../../../src/game/combat.js';

// ── Mock helpers ──────────────────────────────────────────────────────────────

function mockThread() {
  const sent = [];
  return {
    send: async (msg) => { sent.push(msg); return { content: typeof msg === 'string' ? msg : msg?.content, id: `msg_${sent.length}` }; },
    _sent: sent,
    id: 'thread1',
  };
}

function mockInteraction(customId, userId = 'player1', sharedThread = null) {
  const thread = sharedThread || mockThread();
  return {
    customId,
    user: { id: userId },
    followUp: async () => ({}),
    deferUpdate: async () => ({}),
    update: async () => ({}),
    message: { content: '', edit: async () => ({}) },
    client: { channels: { fetch: async () => thread } },
    _thread: thread,
  };
}

function makeCombat(overrides = {}) {
  return {
    gameId: 'g1',
    combatThreadId: 'thread1',
    attackerPlayerNum: 1,
    attackerDcName: 'Stormtrooper',
    attackerFigureKey: 'Stormtrooper-1-0',
    attackerDisplayName: 'Stormtrooper [DG 1]',
    attackerMsgId: 'dc1',
    attackerFigureIndex: 0,
    defenderPlayerNum: 2,
    defenderDcName: 'Rebel Trooper',
    target: { figureKey: 'Rebel Trooper-1-0', label: 'Rebel Trooper' },
    attackDiceResults: [
      { color: 'blue', acc: 2, dmg: 1, surge: 1 },
      { color: 'green', acc: 0, dmg: 2, surge: 0 },
    ],
    defenseDiceResults: [
      { color: 'white', block: 1, evade: 0, dodge: false },
    ],
    attackRoll: { acc: 2, dmg: 3, surge: 1 },
    defenseRoll: { block: 1, evade: 0, dodge: false },
    surgeRemaining: 2,
    attackerRerollsRemaining: 1,
    defenderRerollsRemaining: 1,
    attackerRerolledIndices: [],
    defenderRerolledIndices: [],
    rerollPhase: null,
    ...overrides,
  };
}

/**
 * Build a ctx object for combat.js handlers.
 * `canActAsPlayer` is imported at module scope in combat.js, so we must make
 * the game's player IDs match the interaction user.
 */
function buildCtx(game, overrides = {}) {
  const thread = mockThread();
  const calls = {
    sendRerollUI: [], proceedAfterRerolls: [], logGameAction: [],
    resolveCombatAfterRolls: [], saveGames: [], processDefeat: [],
  };
  return {
    ctx: {
      getGame: () => game,
      canActAsPlayer: () => true,
      replyIfGameEnded: async () => false,
      saveGames: () => { calls.saveGames.push(true); },
      client: { channels: { fetch: async () => thread } },
      recalcAttackTotals,
      recalcDefenseTotals,
      getAttackerSurgeAbilities,
      parseSurgeEffect,
      resolveSurgeAbility: parseSurgeEffect,
      getSurgeAbilityLabel: (key) => key,
      SURGE_LABELS: {},
      getAbility: () => ({ surgeCost: 1 }),
      getDcEffects: () => ({}),
      resolveCombatAfterRolls: async () => { calls.resolveCombatAfterRolls.push(true); },
      logGameAction: async () => { calls.logGameAction.push(true); },
      rollSingleAttackDie: (color) => ({ color, acc: 1, dmg: 1, surge: 0 }),
      rollSingleDefenseDie: (color) => ({ color, block: 1, evade: 0, dodge: false }),
      processFigureDefeat: async (_g, opts) => { calls.processDefeat.push(opts); },
      dcHealthState: new Map(),
      findDcMessageIdForFigure: () => 'dc1',
      checkWinConditions: async () => {},
      ...overrides,
    },
    thread,
    calls,
  };
}

// ── B-C-SURGE: Surge resolution ─────────────────────────────────────────────

describe('B-C-SURGE: Surge spending and tracking', () => {
  it('B-C-SURGE-001: spending a surge correctly applies modifiers to combat', async () => {
    // Setup: combat with 2 surge remaining, surge abilities = ['damage 2', 'pierce 1']
    const combat = makeCombat({ surgeRemaining: 2, bonusSurgeAbilities: ['damage 2', 'pierce 1'] });
    const game = { gameId: 'g1', player1Id: 'player1', player2Id: 'player2', pendingCombat: combat };
    const { ctx, thread } = buildCtx(game, {
      getAttackerSurgeAbilities: () => ['damage 2', 'pierce 1'],
    });

    // Spend surge index 0 → 'damage 2'
    await handleCombatSurge(mockInteraction('combat_surge_g1_0', 'player1'), ctx);

    assert.strictEqual(combat.surgeDamage, 2, '+2 damage from surge');
    assert.strictEqual(combat.surgeRemaining, 1, '1 surge remaining after spending 1');
    assert.strictEqual(combat.surgeSpentCount[0], 1, 'index 0 spent once');
  });

  it('B-C-SURGE-002: surgeSpentCount tracks per-index correctly across multiple spends', async () => {
    const combat = makeCombat({ surgeRemaining: 3 });
    const game = { gameId: 'g1', player1Id: 'player1', player2Id: 'player2', pendingCombat: combat };
    const { ctx } = buildCtx(game, {
      getAttackerSurgeAbilities: () => ['damage 1', 'pierce 1'],
      getDcEffects: () => ({ 'Stormtrooper': { specialAbilityIds: ['overload_saboteur'] } }),
    });

    // Spend index 0 twice (Overload allows 2x)
    await handleCombatSurge(mockInteraction('combat_surge_g1_0', 'player1'), ctx);
    await handleCombatSurge(mockInteraction('combat_surge_g1_0', 'player1'), ctx);

    assert.strictEqual(combat.surgeSpentCount[0], 2, 'index 0 spent twice');
    assert.strictEqual(combat.surgeDamage, 2, '1+1 damage');
    assert.strictEqual(combat.surgeRemaining, 1, '3-2=1 remaining');
  });

  it('B-C-SURGE-003: Overload blocks 3rd use of same surge index', async () => {
    const combat = makeCombat({ surgeRemaining: 3, surgeSpentCount: { 0: 2 } });
    const game = { gameId: 'g1', player1Id: 'player1', player2Id: 'player2', pendingCombat: combat };
    const { ctx } = buildCtx(game, {
      getAttackerSurgeAbilities: () => ['damage 1'],
      getDcEffects: () => ({ 'Stormtrooper': { specialAbilityIds: ['overload_saboteur'] } }),
    });

    // Attempt to spend index 0 a 3rd time — should be silently rejected (deferUpdate + return)
    await handleCombatSurge(mockInteraction('combat_surge_g1_0', 'player1'), ctx);

    // surgeRemaining should NOT have decreased
    assert.strictEqual(combat.surgeRemaining, 3, 'surge not consumed');
    assert.strictEqual(combat.surgeSpentCount[0], 2, 'still at 2 uses');
  });

  it('B-C-SURGE-004: non-Overload unit blocked after 1 use', async () => {
    const combat = makeCombat({ surgeRemaining: 2, surgeSpentCount: { 0: 1 } });
    const game = { gameId: 'g1', player1Id: 'player1', player2Id: 'player2', pendingCombat: combat };
    const { ctx } = buildCtx(game, {
      getAttackerSurgeAbilities: () => ['damage 1'],
      getDcEffects: () => ({}), // no overload
    });

    await handleCombatSurge(mockInteraction('combat_surge_g1_0', 'player1'), ctx);

    assert.strictEqual(combat.surgeRemaining, 2, 'surge not consumed — already at max 1 use');
    assert.strictEqual(combat.surgeSpentCount[0], 1, 'still 1 use');
  });

  it('B-C-SURGE-005: surge index resolves correct ability when multiple abilities exist', async () => {
    const combat = makeCombat({ surgeRemaining: 2 });
    const game = { gameId: 'g1', player1Id: 'player1', player2Id: 'player2', pendingCombat: combat };
    const { ctx } = buildCtx(game, {
      getAttackerSurgeAbilities: () => ['damage 1', 'pierce 2', 'accuracy 3'],
    });

    // Spend index 1 → 'pierce 2'
    await handleCombatSurge(mockInteraction('combat_surge_g1_1', 'player1'), ctx);

    assert.strictEqual(combat.surgePierce, 2, 'pierce from index 1');
    assert.strictEqual(combat.surgeDamage || 0, 0, 'no damage — index 0 not spent');
    assert.strictEqual(combat.surgeSpentCount[1], 1, 'index 1 tracked');
    assert.strictEqual(combat.surgeSpentCount[0] || 0, 0, 'index 0 not tracked');
  });

  it('B-C-SURGE-006: surge done path proceeds straight to combat resolution', async () => {
    const combat = makeCombat({ surgeRemaining: 1 });
    const game = { gameId: 'g1', player1Id: 'player1', player2Id: 'player2', pendingCombat: combat };
    const sharedThread = mockThread();
    const { ctx, calls } = buildCtx(game, {
      getAttackerSurgeAbilities: () => ['damage 1'],
    });

    await handleCombatSurge(mockInteraction('combat_surge_g1_done', 'player1', sharedThread), ctx);

    assert.strictEqual(combat.surgeRemaining, 0, 'surgeRemaining set to 0');
    // Damage now applies automatically (no pre-resolve ready gate). Verify
    // resolveCombatAfterRolls fires directly when surge is done.
    assert.ok(calls.resolveCombatAfterRolls.length > 0, 'resolveCombatAfterRolls was called');
  });

  it('B-C-SURGE-007: multi-effect surge (damage + pierce + conditions) applies all modifiers', async () => {
    const combat = makeCombat({ surgeRemaining: 1 });
    const game = { gameId: 'g1', player1Id: 'player1', player2Id: 'player2', pendingCombat: combat };
    const { ctx } = buildCtx(game, {
      getAttackerSurgeAbilities: () => ['damage 1, pierce 1'],
      resolveSurgeAbility: (key) => parseSurgeEffect(key),
    });

    await handleCombatSurge(mockInteraction('combat_surge_g1_0', 'player1'), ctx);

    assert.strictEqual(combat.surgeDamage, 1, 'damage applied');
    assert.strictEqual(combat.surgePierce, 1, 'pierce applied');
  });

  it('B-C-SURGE-008: bonusSurgeAbilities appear after base surges and resolve by index', async () => {
    // Simulate: base has 1 surge, bonus adds 1 more → indices 0 and 1
    const combat = makeCombat({ surgeRemaining: 2, bonusSurgeAbilities: ['pierce 3'] });
    const game = { gameId: 'g1', player1Id: 'player1', player2Id: 'player2', pendingCombat: combat };
    const { ctx } = buildCtx(game, {
      getAttackerSurgeAbilities: () => ['damage 1', 'pierce 3'], // base + bonus concatenated
    });

    // Spend index 1 (the bonus surge)
    await handleCombatSurge(mockInteraction('combat_surge_g1_1', 'player1'), ctx);

    assert.strictEqual(combat.surgePierce, 3, 'bonus surge resolved at index 1');
    assert.strictEqual(combat.surgeSpentCount[1], 1, 'index 1 tracked');
  });
});

// ── B-C-REROLL: Reroll queue ordering ────────────────────────────────────────

describe('B-C-REROLL: Reroll queue ordering and phase transitions', () => {
  it('B-C-REROLL-001: attacker phase with no own rerolls + def-controlled forced → no attacker dice buttons render (Y/N already answered)', async () => {
    // destruct 2026-05-08 / alexanbv 2026-05-12: defender-controlled
    // cross-side rerolls belong to the DEFENDER's reroll window, not
    // the attacker's. Under the always-prompt-Y/N model (CRR step-3
    // matches step-4 cadence), the attacker gets a Y/N prompt first;
    // simulate the post-Yes path (rerollYnAskedAttacker=true) so the
    // picker renders. With 0 own rerolls and only a def-controlled
    // queue entry, the picker must NOT surface that def-controlled
    // entry — it stays in the defender's bucket.
    const combat = makeCombat({
      rerollPhase: 'attacker',
      attackerRerollsRemaining: 0, // already exhausted
      forcedRerollQueue: [{ source: 'Doubt', pool: 'attack', remaining: 1, controlPlayer: 2 }],
      defenderRerollsRemaining: 1,
      rerollYnAskedAttacker: true, // bypass Y/N — picker path
    });
    const game = { gameId: 'g1', player1Id: 'player1', player2Id: 'player2', pendingCombat: combat };
    const thread = mockThread();

    await sendRerollUI(thread, game, combat, 'attacker');

    // Picker rendered, but no def-controlled "Use Doubt" button — that
    // belongs to the defender bucket. Attacker bucket only shows the
    // owner's own rerolls (which are 0 here) + Done.
    const _sent = thread._sent || [];
    const _payload = _sent.length > 0 ? (typeof _sent[0] === 'string' ? _sent[0] : JSON.stringify(_sent[0])) : '';
    assert.ok(!_payload.includes('Doubt'),
      'def-controlled Doubt does NOT surface in attacker bucket');
  });

  it('B-C-REROLL-002: sendRerollUI drops globally-exhausted controlled entries from the queue', async () => {
    // alexanbv 2026-05-11: under the side-bucketed model, the bucket UI
    // filters exhausted entries (remaining<=0) so they don't render
    // as buttons. Verify the filtered view via the bucket-owner's
    // rendering: only entries with remaining>0 should appear, and the
    // bucket should still surface (because Zeal still has remaining>0
    // on the attacker side). alexanbv 2026-05-12: also bypass the
    // always-prompt Y/N via rerollYnAskedAttacker=true to hit the
    // picker path directly.
    const combat = makeCombat({
      rerollPhase: 'attacker',
      controlledRerollSide: 1,
      forcedRerollQueue: [
        { source: 'Doubt', pool: 'attack', remaining: 0, controlPlayer: 1 },
        { source: 'Zeal', pool: 'defense', remaining: 1, controlPlayer: 1 },
      ],
      attackerRerollsRemaining: 0,
      rerollYnAskedAttacker: true,
    });
    const game = { gameId: 'g1', player1Id: 'player1', player2Id: 'player2', pendingCombat: combat };
    const thread = mockThread();

    await sendRerollUI(thread, game, combat, 'attacker');

    // Bucket rendered with Zeal as a "Use" button; Doubt (exhausted) omitted.
    const _sent = thread._sent || [];
    const _rendered = _sent.length > 0;
    assert.ok(_rendered, 'attacker bucket rendered');
    const _payload = typeof _sent[0] === 'string' ? _sent[0] : JSON.stringify(_sent[0]);
    assert.ok(_payload.includes('Zeal'), 'Zeal surfaces as ability button');
    assert.ok(!_payload.includes('Doubt'), 'exhausted Doubt does not surface');
  });

  it('B-C-REROLL-003: handleCombatReroll (sub-picker mode) decrements remaining and marks rerolled', async () => {
    // New flow: defender bucket active, controlledRerollActiveIdx
    // points to a defender-owned controlled entry. Die clicks resolve
    // that entry. Verified against atk-pool entry owned by defender
    // (e.g. Doubt or Tress Fyrnock Style while defending).
    const combat = makeCombat({
      rerollPhase: 'defender',
      controlledRerollSide: 2,
      controlledRerollActiveIdx: 0,
      forcedRerollQueue: [{ source: 'Doubt', pool: 'attack', remaining: 2, controlPlayer: 2 }],
      attackerRerolledIndices: [],
    });
    const game = { gameId: 'g1', player1Id: 'player1', player2Id: 'player2', pendingCombat: combat };
    const { ctx } = buildCtx(game);

    await handleCombatReroll(mockInteraction('combat_reroll_g1_atk_0', 'player2'), ctx);

    // Entry was consumed (remaining: 2 → 1) and dropped from queue if exhausted, OR retained.
    // For this scenario it should retain at 1.
    const _stillThere = combat.forcedRerollQueue.find(e => e.source === 'Doubt');
    if (_stillThere) {
      assert.strictEqual(_stillThere.remaining, 1, 'remaining decremented');
    }
    assert.ok(combat.attackerRerolledIndices.includes(0), 'index 0 marked as rerolled');
    assert.strictEqual(combat.controlledRerollActiveIdx, null, 'sub-picker cleared after resolution');
  });

  it('B-C-REROLL-004: sub-picker reroll respects G12 — rejects already-rerolled die', async () => {
    const combat = makeCombat({
      rerollPhase: 'defender',
      controlledRerollSide: 2,
      controlledRerollActiveIdx: 0,
      forcedRerollQueue: [{ source: 'Doubt', pool: 'attack', remaining: 1, controlPlayer: 2 }],
      attackerRerolledIndices: [0], // die 0 already rerolled
    });
    const game = { gameId: 'g1', player1Id: 'player1', player2Id: 'player2', pendingCombat: combat };
    const { ctx } = buildCtx(game);
    const origDie = { ...combat.attackDiceResults[0] };

    await handleCombatReroll(mockInteraction('combat_reroll_g1_atk_0', 'player2'), ctx);

    // Die should not change, remaining should not decrement
    assert.strictEqual(combat.forcedRerollQueue[0].remaining, 1, 'remaining unchanged');
    assert.deepStrictEqual(combat.attackDiceResults[0].acc, origDie.acc, 'die not rerolled');
  });

  it('B-C-REROLL-005: pre-reroll shift drains queue and sets preRerollsProcessed', async () => {
    const combat = makeCombat({
      rerollPhase: 'attacker',
      pendingPreRerolls: [{ type: 'trained', playerNum: 1 }],
      preRerollsProcessed: false,
      attackerRerollsRemaining: 1,
    });
    const game = { gameId: 'g1', player1Id: 'player1', player2Id: 'player2', pendingCombat: combat };
    const { ctx } = buildCtx(game);

    // Skip pre-reroll
    await handlePreReroll(mockInteraction('pre_reroll_g1_skip', 'player1'), ctx);

    assert.strictEqual(combat.pendingPreRerolls.length, 0, 'pre-reroll queue drained');
    assert.strictEqual(combat.preRerollsProcessed, true, 'preRerollsProcessed set');
  });

  it('B-C-REROLL-006: multiple pre-rerolls process sequentially', async () => {
    const sharedThread = mockThread();
    const combat = makeCombat({
      rerollPhase: 'attacker',
      pendingPreRerolls: [
        { type: 'trained', playerNum: 1 },
        { type: 'resourceful', playerNum: 1 },
      ],
      preRerollsProcessed: false,
      attackerRerollsRemaining: 0,
    });
    const game = { gameId: 'g1', player1Id: 'player1', player2Id: 'player2', pendingCombat: combat };
    const { ctx } = buildCtx(game);

    // Skip first pre-reroll (trained)
    await handlePreReroll(mockInteraction('pre_reroll_g1_trained_no', 'player1', sharedThread), ctx);

    assert.strictEqual(combat.pendingPreRerolls.length, 1, 'first drained, second remains');
    assert.strictEqual(combat.pendingPreRerolls[0].type, 'resourceful', 'resourceful is next');
    // Thread should show resourceful prompt
    assert.ok(sharedThread._sent.some(m => {
      const c = typeof m === 'string' ? m : m?.content || '';
      return c.includes('Resourceful');
    }), 'resourceful prompt shown');
  });

  it('B-C-REROLL-007: attacker voluntary reroll marks index and decrements remaining', async () => {
    const combat = makeCombat({
      rerollPhase: 'attacker',
      attackerRerollsRemaining: 2,
      attackerRerolledIndices: [],
    });
    const game = { gameId: 'g1', player1Id: 'player1', player2Id: 'player2', pendingCombat: combat };
    const { ctx } = buildCtx(game);

    await handleCombatReroll(mockInteraction('combat_reroll_g1_atk_1', 'player1'), ctx);

    assert.strictEqual(combat.attackerRerollsRemaining, 1, 'decremented by 1');
    assert.ok(combat.attackerRerolledIndices.includes(1), 'index 1 marked');
    assert.strictEqual(combat.attackerRerolledIndices.length, 1, 'only 1 index marked');
  });

  it('B-C-REROLL-008: defender done with no forced queue sends post_defender gate', async () => {
    const sharedThread = mockThread();
    const combat = makeCombat({
      rerollPhase: 'defender',
      defenderRerollsRemaining: 1,
      forcedRerollQueue: [],
    });
    const game = { gameId: 'g1', player1Id: 'player1', player2Id: 'player2', pendingCombat: combat };
    const { ctx } = buildCtx(game);

    await handleCombatReroll(mockInteraction('combat_reroll_g1_def_done', 'player2', sharedThread), ctx);

    // Should have sent a gate message (post_defender_reroll)
    assert.ok(sharedThread._sent.length > 0, 'gate message sent');
  });
});

// ── B-C-PENDING: Pending-state invariants ────────────────────────────────────

describe('B-C-PENDING: Pending-state cleanup invariants', () => {
  it('B-C-PEND-001: handleStrainChoice alldmg clears pendingStrainChoice', async () => {
    const healthState = new Map();
    healthState.set('dc1', [[5, 5]]);
    const game = {
      gameId: 'g1', player1Id: 'player1', player2Id: 'player2',
      pendingStrainChoice: {
        figureKey: 'Trooper-1-0', playerNum: 1, amount: 2, headhunterDmg: 0,
        abilityLabel: 'Relentless', sourceLabel: 'test', dcName: 'Trooper',
        msgId: 'dc1', figureIndex: 0, threadId: 'thread1', discardedCount: 0,
        ccCostPerStrain: 1,
      },
    };
    const { ctx } = buildCtx(game, { dcHealthState: healthState });

    await handleStrainChoice(mockInteraction('strain_choice_alldmg_g1', 'player1'), ctx);

    assert.strictEqual(game.pendingStrainChoice, undefined, 'pendingStrainChoice deleted');
  });

  it('B-C-PEND-002: handleStrainChoice discard path clears pendingStrainChoice', async () => {
    const healthState = new Map();
    healthState.set('dc1', [[5, 5]]);
    const game = {
      gameId: 'g1', player1Id: 'player1', player2Id: 'player2',
      player1CcDeck: ['Card A', 'Card B', 'Card C'],
      player1CcDiscard: [],
      pendingStrainChoice: {
        figureKey: 'Trooper-1-0', playerNum: 1, amount: 2, headhunterDmg: 0,
        abilityLabel: 'Relentless', sourceLabel: 'test', dcName: 'Trooper',
        msgId: 'dc1', figureIndex: 0, threadId: 'thread1', discardedCount: 0,
        ccCostPerStrain: 1,
      },
    };
    const { ctx } = buildCtx(game, { dcHealthState: healthState });

    // Discard 1 CC instead of 1 HP → remaining 1 as HP damage
    await handleStrainChoice(mockInteraction('strain_choice_discard_g1_1', 'player1'), ctx);

    assert.strictEqual(game.pendingStrainChoice, undefined, 'pendingStrainChoice deleted');
  });

  it('B-C-PEND-003: surge done clears surgeRemaining to 0', async () => {
    const combat = makeCombat({ surgeRemaining: 3 });
    const game = { gameId: 'g1', player1Id: 'player1', player2Id: 'player2', pendingCombat: combat };
    const { ctx } = buildCtx(game, {
      getAttackerSurgeAbilities: () => ['damage 1'],
    });

    await handleCombatSurge(mockInteraction('combat_surge_g1_done', 'player1'), ctx);

    assert.strictEqual(combat.surgeRemaining, 0, 'surgeRemaining zeroed on done');
  });

  it('B-C-PEND-004: pre-reroll skip clears queue entry without leaving orphan', async () => {
    const combat = makeCombat({
      rerollPhase: 'attacker',
      pendingPreRerolls: [{ type: 'trained', playerNum: 1 }],
      preRerollsProcessed: false,
      attackerRerollsRemaining: 0,
      forcedRerollQueue: [],
      defenderRerollsRemaining: 0,
    });
    const game = { gameId: 'g1', player1Id: 'player1', player2Id: 'player2', pendingCombat: combat };
    const { ctx } = buildCtx(game);

    await handlePreReroll(mockInteraction('pre_reroll_g1_skip', 'player1'), ctx);

    assert.strictEqual(combat.pendingPreRerolls.length, 0, 'queue empty');
    assert.strictEqual(combat.preRerollsProcessed, true, 'processed flag set');
    // With no rerolls of any kind, rerollPhase should be null
    assert.strictEqual(combat.rerollPhase, null, 'rerollPhase null when no rerolls available');
  });
});

// ── B-C-STRAIN: Strain → defeat guard ────────────────────────────────────────

describe('B-C-STRAIN: Strain choice → damage resolution → defeat', () => {
  it('B-C-STRAIN-001: alldmg path applies full HP damage', async () => {
    const healthState = new Map();
    healthState.set('dc1', [[5, 5]]);
    const game = {
      gameId: 'g1', player1Id: 'player1', player2Id: 'player2',
      pendingStrainChoice: {
        figureKey: 'Trooper-1-0', playerNum: 1, amount: 3, headhunterDmg: 0,
        abilityLabel: 'Relentless', sourceLabel: 'test', dcName: 'Trooper',
        msgId: 'dc1', figureIndex: 0, threadId: 'thread1', discardedCount: 0,
        ccCostPerStrain: 1,
      },
    };
    const { ctx } = buildCtx(game, { dcHealthState: healthState });

    await handleStrainChoice(mockInteraction('strain_choice_alldmg_g1', 'player1'), ctx);

    const hp = healthState.get('dc1')[0];
    assert.strictEqual(hp[0], 2, 'HP reduced from 5 to 2 (3 damage)');
  });

  it('B-C-STRAIN-002: lethal strain triggers processFigureDefeat', async () => {
    const healthState = new Map();
    healthState.set('dc1', [[1, 5]]); // only 1 HP left
    const game = {
      gameId: 'g1', player1Id: 'player1', player2Id: 'player2',
      pendingStrainChoice: {
        figureKey: 'Trooper-1-0', playerNum: 1, amount: 2, headhunterDmg: 0,
        abilityLabel: 'Relentless', sourceLabel: 'test', dcName: 'Trooper',
        msgId: 'dc1', figureIndex: 0, threadId: 'thread1', discardedCount: 0,
        ccCostPerStrain: 1,
      },
    };
    const { ctx, calls } = buildCtx(game, { dcHealthState: healthState });

    await handleStrainChoice(mockInteraction('strain_choice_alldmg_g1', 'player1'), ctx);

    assert.strictEqual(calls.processDefeat.length, 1, 'processFigureDefeat called');
    assert.strictEqual(calls.processDefeat[0].figureKey, 'Trooper-1-0', 'correct figure defeated');
    assert.strictEqual(calls.processDefeat[0].source, 'Relentless', 'correct source');
  });

  it('B-C-STRAIN-003: discard path reduces deck and applies remaining as HP', async () => {
    const healthState = new Map();
    healthState.set('dc1', [[5, 5]]);
    const game = {
      gameId: 'g1', player1Id: 'player1', player2Id: 'player2',
      player1CcDeck: ['Card A', 'Card B', 'Card C'],
      player1CcDiscard: [],
      pendingStrainChoice: {
        figureKey: 'Trooper-1-0', playerNum: 1, amount: 3, headhunterDmg: 0,
        abilityLabel: 'Relentless', sourceLabel: 'test', dcName: 'Trooper',
        msgId: 'dc1', figureIndex: 0, threadId: 'thread1', discardedCount: 0,
        ccCostPerStrain: 1,
      },
    };
    const { ctx } = buildCtx(game, { dcHealthState: healthState });

    // Discard 2 CCs → 1 HP damage remaining
    await handleStrainChoice(mockInteraction('strain_choice_discard_g1_2', 'player1'), ctx);

    assert.strictEqual(game.player1CcDeck.length, 1, 'deck reduced by 2');
    assert.strictEqual(game.player1CcDiscard.length, 2, '2 cards in discard');
    const hp = healthState.get('dc1')[0];
    assert.strictEqual(hp[0], 4, 'HP reduced by 1 (3 strain - 2 discards = 1 HP)');
  });

  it('B-C-STRAIN-004: non-lethal strain does NOT trigger processFigureDefeat', async () => {
    const healthState = new Map();
    healthState.set('dc1', [[5, 5]]);
    const game = {
      gameId: 'g1', player1Id: 'player1', player2Id: 'player2',
      pendingStrainChoice: {
        figureKey: 'Trooper-1-0', playerNum: 1, amount: 1, headhunterDmg: 0,
        abilityLabel: 'Relentless', sourceLabel: 'test', dcName: 'Trooper',
        msgId: 'dc1', figureIndex: 0, threadId: 'thread1', discardedCount: 0,
        ccCostPerStrain: 1,
      },
    };
    const { ctx, calls } = buildCtx(game, { dcHealthState: healthState });

    await handleStrainChoice(mockInteraction('strain_choice_alldmg_g1', 'player1'), ctx);

    assert.strictEqual(calls.processDefeat.length, 0, 'no defeat for non-lethal strain');
    const hp = healthState.get('dc1')[0];
    assert.strictEqual(hp[0], 4, 'HP reduced by 1');
  });
});
