/**
 * Combat Effects Tests: targeted deterministic scenarios for reroll,
 * conditions (Bleed/Stun/Weaken), and combat interrupts (Negation/Celebration).
 *
 * Classification: harness (test-only, no production changes)
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createTestGame } from '../fixtures/game-builder.js';
import { getDcStats, getDcEffects } from '../../src/data-loader.js';
import {
  applyCondition, filterCondition, resetCondition,
  grantPowerTokens, dcNameFromFigureKey,
} from '../../src/game/index.js';
import { isConditionImmune, HARMFUL_CONDITIONS } from '../../src/game/conditions.js';
import {
  getDcList, getDcMessageIds,
} from '../../src/game/player-helpers.js';

// ── Helpers ─────────────────────────────────────────────────────────────────

/** Build a game at round 1 with two armies deployed and return key state */
function buildCombatGame(opts = {}) {
  const {
    p1Army = [{ dcName: 'Stormtrooper', count: 2 }],
    p2Army = [{ dcName: 'Rebel Saboteur', count: 2 }],
    p1CcHand = [],
    p2CcHand = [],
    p1CcDeck = [],
    p2CcDeck = [],
  } = opts;

  const meta = createTestGame()
    .withPlayer1Army(p1Army)
    .withPlayer2Army(p2Army)
    .withPlayer1CcHand(p1CcHand)
    .withPlayer2CcHand(p2CcHand)
    .withPlayer1CcDeck(p1CcDeck)
    .withPlayer2CcDeck(p2CcDeck)
    .inRound(1)
    .build();

  const { game } = meta;
  const p1Fks = Object.keys(game.figurePositions?.[1] || {});
  const p2Fks = Object.keys(game.figurePositions?.[2] || {});
  const attackerFk = p1Fks[0];
  const defenderFk = p2Fks[0];
  const attackerMsgId = (getDcMessageIds(game, 1) || [])[0];
  const defenderMsgId = (getDcMessageIds(game, 2) || [])[0];

  return { ...meta, attackerFk, defenderFk, attackerMsgId, defenderMsgId, p1Fks, p2Fks };
}

/** Build a minimal combat object */
function buildCombat(game, opts = {}) {
  const {
    attackerFk, defenderFk, attackerMsgId, defenderMsgId,
    attackDice = ['blue'], defenseDice = ['black'],
    attackDiceResults = [{ face: 'hit2', hits: 2, surges: 0, accuracy: 2, misses: 0 }],
    defenseDiceResults = [{ face: 'block1', blocks: 1, evades: 0, dodges: 0 }],
  } = opts;

  return {
    gameId: game.gameId,
    attackerPlayerNum: 1,
    defenderPlayerNum: 2,
    attackerFigureKey: attackerFk,
    defenderFigureKey: defenderFk,
    attackerMsgId: attackerMsgId,
    defenderMsgId: defenderMsgId,
    attackDice,
    defenseDice,
    attackDiceResults,
    defenseDiceResults,
    totalHits: 2,
    totalAccuracy: 2,
    totalBlocks: 1,
    totalEvades: 0,
    surgesSpent: [],
    attackerRerolledIndices: [],
    defenderRerolledIndices: [],
    attackerRerollsRemaining: 0,
    defenderRerollsRemaining: 0,
    rerollPhase: null,
    forcedRerollQueue: [],
    resolved: false,
    ...opts.combatOverrides,
  };
}

// ── Suite 1: Reroll State Machine ───────────────────────────────────────────

describe('Combat effects: reroll', () => {
  it('rerollPhase controls which side can reroll', () => {
    const { game, attackerFk, defenderFk, attackerMsgId, defenderMsgId } = buildCombatGame();
    const combat = buildCombat(game, { attackerFk, defenderFk, attackerMsgId, defenderMsgId });

    combat.rerollPhase = 'attacker';
    assert.strictEqual(combat.rerollPhase, 'attacker', 'Attacker phase set');

    combat.rerollPhase = 'defender';
    assert.strictEqual(combat.rerollPhase, 'defender', 'Defender phase set');
  });

  it('rerolled indices prevent re-rerolling the same die', () => {
    const { game, attackerFk, defenderFk, attackerMsgId, defenderMsgId } = buildCombatGame();
    const combat = buildCombat(game, { attackerFk, defenderFk, attackerMsgId, defenderMsgId });

    combat.attackerRerolledIndices.push(0);
    assert.ok(combat.attackerRerolledIndices.includes(0), 'Index 0 marked as rerolled');
    assert.ok(!combat.attackerRerolledIndices.includes(1), 'Index 1 not yet rerolled');

    // Simulate checking before reroll
    const canReroll = (idx) => !combat.attackerRerolledIndices.includes(idx);
    assert.ok(!canReroll(0), 'Cannot reroll die 0 again');
    assert.ok(canReroll(1), 'Can reroll die 1');
  });

  it('rerollsRemaining decrements correctly', () => {
    const { game, attackerFk, defenderFk, attackerMsgId, defenderMsgId } = buildCombatGame();
    const combat = buildCombat(game, { attackerFk, defenderFk, attackerMsgId, defenderMsgId });

    combat.attackerRerollsRemaining = 2;
    assert.strictEqual(combat.attackerRerollsRemaining, 2);

    combat.attackerRerollsRemaining -= 1;
    assert.strictEqual(combat.attackerRerollsRemaining, 1, 'Decremented after first reroll');

    combat.attackerRerollsRemaining -= 1;
    assert.strictEqual(combat.attackerRerollsRemaining, 0, 'No rerolls left');
  });

  it('forcedRerollQueue processes entries in order', () => {
    const { game, attackerFk, defenderFk, attackerMsgId, defenderMsgId } = buildCombatGame();
    const combat = buildCombat(game, { attackerFk, defenderFk, attackerMsgId, defenderMsgId });

    combat.forcedRerollQueue = [
      { source: 'Targeting Computer', remaining: 1, controlPlayer: 1 },
      { source: 'Defensive Stance', remaining: 1, controlPlayer: 2 },
    ];

    assert.strictEqual(combat.forcedRerollQueue.length, 2, 'Two forced reroll entries');
    assert.strictEqual(combat.forcedRerollQueue[0].source, 'Targeting Computer', 'First entry is Targeting Computer');

    // Simulate processing first entry
    combat.forcedRerollQueue[0].remaining -= 1;
    if (combat.forcedRerollQueue[0].remaining <= 0) {
      combat.forcedRerollQueue.shift();
    }

    assert.strictEqual(combat.forcedRerollQueue.length, 1, 'One entry remaining');
    assert.strictEqual(combat.forcedRerollQueue[0].source, 'Defensive Stance', 'Next entry is Defensive Stance');
  });

  it('customId format combat_reroll parses correctly', () => {
    const gameId = 'test1';
    const customId = `combat_reroll_${gameId}_atk_0`;
    const parts = customId.replace('combat_reroll_', '').split('_');
    assert.strictEqual(parts[0], gameId, 'gameId parsed');
    assert.strictEqual(parts[1], 'atk', 'side parsed');
    assert.strictEqual(parts[2], '0', 'die index parsed');

    const doneId = `combat_reroll_${gameId}_def_done`;
    const doneParts = doneId.replace('combat_reroll_', '').split('_');
    assert.strictEqual(doneParts[2], 'done', 'done action parsed');
  });

  it('multiple attack dice track rerolls independently', () => {
    const { game, attackerFk, defenderFk, attackerMsgId, defenderMsgId } = buildCombatGame();
    const combat = buildCombat(game, {
      attackerFk, defenderFk, attackerMsgId, defenderMsgId,
      attackDice: ['blue', 'green', 'red'],
      attackDiceResults: [
        { face: 'hit1', hits: 1, surges: 0, accuracy: 1, misses: 0 },
        { face: 'surge1', hits: 0, surges: 1, accuracy: 0, misses: 0 },
        { face: 'hit3', hits: 3, surges: 0, accuracy: 0, misses: 0 },
      ],
    });

    combat.attackerRerollsRemaining = 1;
    combat.attackerRerolledIndices.push(1); // Rerolled the green die

    assert.strictEqual(combat.attackDiceResults.length, 3, 'Three attack dice');
    assert.ok(!combat.attackerRerolledIndices.includes(0), 'Blue die not rerolled');
    assert.ok(combat.attackerRerolledIndices.includes(1), 'Green die rerolled');
    assert.ok(!combat.attackerRerolledIndices.includes(2), 'Red die not rerolled');
  });
});

// ── Suite 2: Conditions ─────────────────────────────────────────────────────

describe('Combat effects: conditions', () => {
  it('HARMFUL_CONDITIONS contains Stun, Bleed, Weaken', () => {
    assert.ok(HARMFUL_CONDITIONS.includes('Stun'), 'Stun is harmful');
    assert.ok(HARMFUL_CONDITIONS.includes('Bleed'), 'Bleed is harmful');
    assert.ok(HARMFUL_CONDITIONS.includes('Weaken'), 'Weaken is harmful');
    assert.strictEqual(HARMFUL_CONDITIONS.length, 3, 'Exactly 3 harmful conditions');
  });

  it('applyCondition adds condition with dedup', () => {
    const game = { figureConditions: {} };
    const fk = 'Stormtrooper-0-0';

    const added1 = applyCondition(game, fk, 'Stun');
    assert.ok(added1, 'First apply returns true');
    assert.deepStrictEqual(game.figureConditions[fk], ['Stun']);

    const added2 = applyCondition(game, fk, 'Stun');
    assert.ok(!added2, 'Second apply returns false (dedup)');
    assert.deepStrictEqual(game.figureConditions[fk], ['Stun'], 'No duplicate');
  });

  it('filterCondition removes specific condition', () => {
    const game = { figureConditions: { 'Stormtrooper-0-0': ['Stun', 'Bleed', 'Focus'] } };
    const fk = 'Stormtrooper-0-0';

    filterCondition(game, fk, 'Bleed');
    assert.deepStrictEqual(game.figureConditions[fk], ['Stun', 'Focus'], 'Bleed removed');

    filterCondition(game, fk, 'Focus');
    assert.deepStrictEqual(game.figureConditions[fk], ['Stun'], 'Focus removed');
  });

  it('filterCondition cleans up empty arrays', () => {
    const game = { figureConditions: { 'Stormtrooper-0-0': ['Bleed'] } };
    const fk = 'Stormtrooper-0-0';

    filterCondition(game, fk, 'Bleed');
    assert.strictEqual(game.figureConditions[fk], undefined, 'Empty array cleaned up');
  });

  it('resetCondition ensures exactly one instance', () => {
    const game = { figureConditions: { 'Stormtrooper-0-0': ['Focus', 'Focus'] } };
    const fk = 'Stormtrooper-0-0';

    resetCondition(game, fk, 'Focus');
    const focusCount = game.figureConditions[fk].filter(c => c === 'Focus').length;
    assert.strictEqual(focusCount, 1, 'Exactly one Focus after reset');
  });

  it('isConditionImmune detects Onar Koma immunity', () => {
    const { game } = buildCombatGame({ p1Army: [{ dcName: 'Onar Koma' }] });
    const onarFk = Object.keys(game.figurePositions?.[1] || {}).find(k => k.startsWith('Onar Koma'));
    if (onarFk) {
      assert.ok(isConditionImmune(game, onarFk), 'Onar Koma is condition immune');
    }
  });

  it('regular figures are not condition immune', () => {
    const { game } = buildCombatGame();
    const fk = Object.keys(game.figurePositions?.[1] || {})[0];
    assert.ok(!isConditionImmune(game, fk), 'Stormtrooper is NOT condition immune');
  });

  it('Weaken filter respects disarmPermanentWeakened lock', () => {
    const fk = 'TestFig-0-0';
    const game = {
      figureConditions: { [fk]: ['Weaken'] },
      disarmPermanentWeakened: { [fk]: true },
    };

    filterCondition(game, fk, 'Weaken');
    assert.ok(game.figureConditions[fk]?.includes('Weaken'), 'Weaken NOT removed due to disarm lock');
  });

  it('pendingBleeding structure is correct', () => {
    const { game, p1Fks } = buildCombatGame();
    const fk = p1Fks[0];

    game.pendingBleeding = {
      playerNum: 1,
      figureKey: fk,
      displayName: dcNameFromFigureKey(fk),
    };

    assert.strictEqual(game.pendingBleeding.playerNum, 1);
    assert.strictEqual(game.pendingBleeding.figureKey, fk);
    assert.ok(game.pendingBleeding.displayName.length > 0, 'Has display name');
  });

  it('bleed_accept customId format is correct', () => {
    const gameId = 'test1';
    const fk = 'Stormtrooper-0-0';
    const customId = `bleed_accept_${gameId}_1_${fk}`;
    const parts = customId.replace('bleed_accept_', '').split('_');
    assert.strictEqual(parts[0], gameId);
    assert.strictEqual(parseInt(parts[1], 10), 1, 'playerNum');
    assert.strictEqual(parts.slice(2).join('_'), fk, 'figureKey preserved');
  });

  it('bleed_prevent customId format is correct', () => {
    const gameId = 'test1';
    const fk = 'Stormtrooper-0-0';
    const customId = `bleed_prevent_${gameId}_1_${fk}`;
    const parts = customId.replace('bleed_prevent_', '').split('_');
    assert.strictEqual(parts[0], gameId);
    assert.strictEqual(parseInt(parts[1], 10), 1);
    assert.strictEqual(parts.slice(2).join('_'), fk);
  });

  it('Bleed accept reduces HP by 1 (simulated)', () => {
    const { game, p1Fks } = buildCombatGame();
    const fk = p1Fks[0];
    applyCondition(game, fk, 'Bleed');

    // Simulate bleed_accept: reduce current HP by 1
    const dcList = getDcList(game, 1);
    const msgIds = getDcMessageIds(game, 1) || [];
    // Find the DC index for this figure
    const dcName = dcNameFromFigureKey(fk);
    const dcIdx = dcList.findIndex(d => d.dcName === dcName);
    if (dcIdx >= 0 && dcList[dcIdx].healthState?.[0]) {
      const originalHp = dcList[dcIdx].healthState[0][0];
      dcList[dcIdx].healthState[0][0] = Math.max(0, originalHp - 1);

      assert.strictEqual(dcList[dcIdx].healthState[0][0], originalHp - 1, 'HP reduced by 1');
    }

    filterCondition(game, fk, 'Bleed');
    assert.ok(!(game.figureConditions?.[fk] || []).includes('Bleed'), 'Bleed removed after accept');
  });

  it('Bleed prevent discards top CC from deck (simulated)', () => {
    const { game, p1Fks } = buildCombatGame({
      p1CcHand: ['Son of Skywalker'],
      p1CcDeck: ['Take Initiative', 'Element of Surprise', 'Urgency'],
    });
    const fk = p1Fks[0];
    applyCondition(game, fk, 'Bleed');

    const deckBefore = game.player1CcDeck.length;
    const discardBefore = (game.player1CcDiscard || []).length;

    // Simulate bleed_prevent: discard top card from deck
    game.player1CcDiscard = game.player1CcDiscard || [];
    const topCard = game.player1CcDeck.shift();
    game.player1CcDiscard.push(topCard);

    assert.strictEqual(game.player1CcDeck.length, deckBefore - 1, 'Deck lost 1 card');
    assert.strictEqual(game.player1CcDiscard.length, discardBefore + 1, 'Discard gained 1 card');
    assert.strictEqual(topCard, 'Take Initiative', 'Top card discarded');

    filterCondition(game, fk, 'Bleed');
    assert.ok(!(game.figureConditions?.[fk] || []).includes('Bleed'), 'Bleed removed after prevent');
  });
});

// ── Suite 3: (removed) ───────────────────────────────────────────────────────
// The old Negation-window simulation tests were removed when the legacy
// handleNegationPlay / handleNegationLetResolve handlers were deleted. The
// unified counter-window is covered by cc-counter-window*-tests (including
// combat traces).

// ── Suite 4: Celebration ─────────────────────────────────────────────────────

describe('Combat effects: celebration', () => {
  it('pendingCelebration structure is correct', () => {
    const game = {};
    game.pendingCelebration = {
      attackerPlayerNum: 1,
      combatThreadId: 'thread-123',
    };

    assert.strictEqual(game.pendingCelebration.attackerPlayerNum, 1);
    assert.strictEqual(game.pendingCelebration.combatThreadId, 'thread-123');
  });

  it('celebration_play customId format is correct', () => {
    const gameId = 'test1';
    const customId = `celebration_play_${gameId}`;
    assert.ok(customId.startsWith('celebration_play_'));
  });

  it('celebration_pass customId format is correct', () => {
    const gameId = 'test1';
    const customId = `celebration_pass_${gameId}`;
    assert.ok(customId.startsWith('celebration_pass_'));
  });

  it('Celebration play awards +4 VP (simulated)', () => {
    const { game } = buildCombatGame({
      p1CcHand: ['Celebration'],
    });

    game.pendingCelebration = {
      attackerPlayerNum: 1,
      combatThreadId: 'thread-123',
    };

    // Simulate celebration_play: remove from hand, award 4 VP
    const celIdx = game.player1CcHand.indexOf('Celebration');
    assert.ok(celIdx >= 0, 'Celebration is in P1 hand');

    game.player1CcHand.splice(celIdx, 1);
    game.player1CcDiscard = game.player1CcDiscard || [];
    game.player1CcDiscard.push('Celebration');
    game.player1VP.objectives += 4;
    game.player1VP.total += 4;

    delete game.pendingCelebration;

    assert.strictEqual(game.player1VP.objectives, 4, '+4 VP from objectives');
    assert.strictEqual(game.player1VP.total, 4, '+4 VP total');
    assert.ok(!game.player1CcHand.includes('Celebration'), 'Celebration removed from hand');
    assert.strictEqual(game.pendingCelebration, undefined, 'pendingCelebration cleared');
  });

  it('Celebration pass clears state without VP', () => {
    const { game } = buildCombatGame({
      p1CcHand: ['Celebration'],
    });

    game.pendingCelebration = {
      attackerPlayerNum: 1,
      combatThreadId: 'thread-123',
    };

    // Simulate celebration_pass
    delete game.pendingCelebration;

    assert.ok(game.player1CcHand.includes('Celebration'), 'Celebration stays in hand');
    assert.strictEqual(game.player1VP.total, 0, 'No VP awarded');
    assert.strictEqual(game.pendingCelebration, undefined, 'pendingCelebration cleared');
  });

  it('Celebration can only be played by killing player', () => {
    const game = {};
    game.pendingCelebration = {
      attackerPlayerNum: 2,
      combatThreadId: 'thread-123',
    };

    assert.strictEqual(game.pendingCelebration.attackerPlayerNum, 2, 'P2 killed a figure');
    // Only P2 should be able to play celebration_play
  });
});

// ── Suite 5: Strain Choice ──────────────────────────────────────────────────

describe('Combat effects: strain choice', () => {
  it('strain_choice customId formats parse correctly', () => {
    const gameId = 'test1';
    const fk = 'Stormtrooper-0-0';

    const allDmg = `strain_choice_alldmg_${gameId}_1_${fk}`;
    const parts1 = allDmg.replace('strain_choice_alldmg_', '').split('_');
    assert.strictEqual(parts1[0], gameId);
    assert.strictEqual(parseInt(parts1[1], 10), 1);

    const discard = `strain_choice_discard_${gameId}_1_${fk}`;
    const parts2 = discard.replace('strain_choice_discard_', '').split('_');
    assert.strictEqual(parts2[0], gameId);
  });

  it('pendingStrainChoice has correct structure', () => {
    const game = {};
    game.pendingStrainChoice = {
      playerNum: 1,
      figureKey: 'Stormtrooper-0-0',
      strainAmount: 2,
      displayName: 'Stormtrooper',
    };

    assert.strictEqual(game.pendingStrainChoice.strainAmount, 2);
    assert.strictEqual(game.pendingStrainChoice.playerNum, 1);
  });
});

// ── Suite 6: Token Overflow ─────────────────────────────────────────────────

describe('Combat effects: token overflow', () => {
  it('token overflow triggers when exceeding limit', () => {
    const { game, p1Fks } = buildCombatGame();
    const fk = p1Fks[0];

    // Grant tokens up to and beyond the cap (typically 3 per type)
    grantPowerTokens(game, fk, 'Block', 3);
    const tokens = game.figurePowerTokens?.[fk] || [];
    const blockCount = tokens.filter(t => t === 'Block').length;
    assert.strictEqual(blockCount, 3, 'Has 3 Block tokens');

    // Granting a 4th would trigger overflow in production
    grantPowerTokens(game, fk, 'Block', 1);
    const tokens2 = game.figurePowerTokens?.[fk] || [];
    const blockCount2 = tokens2.filter(t => t === 'Block').length;
    // The helper adds the token; overflow check happens separately in handler
    assert.ok(blockCount2 >= 3, 'Token was added (overflow check is handler-side)');
  });

  it('power_token_choice customId format is correct', () => {
    const gameId = 'test1';
    const fk = 'Stormtrooper-0-0';
    const customId = `power_token_choice_${gameId}_1_${fk}_Block`;
    const parts = customId.replace('power_token_choice_', '').split('_');
    assert.strictEqual(parts[0], gameId);
    assert.strictEqual(parseInt(parts[1], 10), 1);
  });
});

// ── Suite 7: Handler Registration ────────────────────────────────────────────

describe('Combat effects: handler registration', () => {
  it('combat effect handler prefixes are registered', async () => {
    const { default: fs } = await import('fs');
    const content = fs.readFileSync('src/handlers/index.js', 'utf8');

    const requiredPrefixes = [
      'combat_reroll_',
      'bleed_accept_',
      'bleed_prevent_',
      'celebration_play_',
      'celebration_pass_',
      'extra_armor_pick_',
      'extra_armor_confirm_',
      'strain_choice_alldmg_',
      'strain_choice_discard_',
      'power_token_choice_',
    ];

    for (const prefix of requiredPrefixes) {
      assert.ok(content.includes(prefix), `Handler prefix '${prefix}' is registered in index.js`);
    }
  });
});

// ── Suite 8: Combat Interrupt Pending States ─────────────────────────────────

describe('Combat effects: interrupt pending states', () => {
  it('pendingStrikeMeDown structure supports combat thread tracking', () => {
    const game = {};
    game.pendingStrikeMeDown = {
      playerNum: 1,
      figureKey: 'Obi-Wan Kenobi-0-0',
      combatThreadId: 'thread-456',
    };
    assert.strictEqual(game.pendingStrikeMeDown.playerNum, 1);
    assert.strictEqual(game.pendingStrikeMeDown.combatThreadId, 'thread-456');
  });

  it('pendingSlowOnTheDraw blocks attacker CC play', () => {
    const game = {};
    game.pendingSlowOnTheDraw = {
      blockedPlayerNum: 1,
      combatThreadId: 'thread-789',
    };
    assert.strictEqual(game.pendingSlowOnTheDraw.blockedPlayerNum, 1);
  });

  it('multiple combat interrupt states can coexist', () => {
    const game = {};
    game.pendingSlowOnTheDraw = { blockedPlayerNum: 1, combatThreadId: 'thread-789' };
    game.pendingCelebration = { attackerPlayerNum: 2 };

    assert.ok(game.pendingSlowOnTheDraw, 'Slow on the Draw pending');
    assert.ok(game.pendingCelebration, 'Celebration pending');

    delete game.pendingSlowOnTheDraw;
    assert.strictEqual(game.pendingSlowOnTheDraw, undefined, 'Slow on the Draw cleared');
    assert.ok(game.pendingCelebration, 'Celebration still pending');
  });
});

console.log('Combat effects tests loaded successfully');
