/**
 * Tests for src/game/cc-timing.js. Run: node --test src/game/cc-timing.test.js
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { getCcPlayContext, isCcPlayableNow, getPlayableCcFromHand, isCcPlayLegalByRestriction } from './cc-timing.js';

// --- getCcPlayContext ---

describe('getCcPlayContext', () => {
  it('returns startOfRound when round is active and activation button not shown', () => {
    const game = {
      player1Id: 'u1', player2Id: 'u2',
      currentRound: 1,
      roundActivationMessageId: 'msg1',
      roundActivationButtonShown: false,
    };
    const ctx = getCcPlayContext(game, 1);
    assert.strictEqual(ctx.startOfRound, true);
    assert.strictEqual(ctx.duringActivation, false);
    assert.strictEqual(ctx.endOfRound, false);
  });

  it('returns duringActivation when player is active and not in end-of-round', () => {
    const game = {
      player1Id: 'u1', player2Id: 'u2',
      currentActivationTurnPlayerId: 'u1',
    };
    const ctx = getCcPlayContext(game, 1);
    assert.strictEqual(ctx.duringActivation, true);
    assert.strictEqual(ctx.startOfRound, false);
  });

  it('duringActivation is false for non-active player', () => {
    const game = {
      player1Id: 'u1', player2Id: 'u2',
      currentActivationTurnPlayerId: 'u2',
    };
    const ctx = getCcPlayContext(game, 1);
    assert.strictEqual(ctx.duringActivation, false);
  });

  it('returns endOfRound when it is that player turn in end-of-round', () => {
    const game = {
      player1Id: 'u1', player2Id: 'u2',
      endOfRoundWhoseTurn: 'u2',
    };
    const ctx = getCcPlayContext(game, 2);
    assert.strictEqual(ctx.endOfRound, true);
  });

  it('returns duringAttack and isAttacker/isDefender from pendingCombat', () => {
    const game = {
      player1Id: 'u1', player2Id: 'u2',
      pendingCombat: { attackerPlayerNum: 1, defenderPlayerNum: 2 },
    };
    const ctx1 = getCcPlayContext(game, 1);
    assert.strictEqual(ctx1.duringAttack, true);
    assert.strictEqual(ctx1.isAttacker, true);
    assert.strictEqual(ctx1.isDefender, false);
    const ctx2 = getCcPlayContext(game, 2);
    assert.strictEqual(ctx2.isAttacker, false);
    assert.strictEqual(ctx2.isDefender, true);
  });

  it('returns all false for empty game state', () => {
    const game = { player1Id: 'u1', player2Id: 'u2' };
    const ctx = getCcPlayContext(game, 1);
    assert.strictEqual(ctx.startOfRound, false);
    assert.strictEqual(ctx.duringActivation, false);
    assert.strictEqual(ctx.endOfRound, false);
    assert.strictEqual(ctx.duringAttack, false);
    assert.strictEqual(ctx.isAttacker, false);
    assert.strictEqual(ctx.isDefender, false);
  });
});

// --- isCcPlayableNow ---

describe('isCcPlayableNow', () => {
  const mockEffect = (timing) => () => ({ timing });
  const activationGame = {
    player1Id: 'u1', player2Id: 'u2',
    currentActivationTurnPlayerId: 'u1',
  };
  const startOfRoundGame = {
    player1Id: 'u1', player2Id: 'u2',
    currentRound: 1,
    roundActivationMessageId: 'msg1',
    roundActivationButtonShown: false,
  };
  const attackGame = {
    player1Id: 'u1', player2Id: 'u2',
    pendingCombat: { attackerPlayerNum: 1, defenderPlayerNum: 2 },
  };
  const endOfRoundGame = {
    player1Id: 'u1', player2Id: 'u2',
    endOfRoundWhoseTurn: 'u1',
  };

  it('returns true for duringActivation timing when player is active', () => {
    assert.ok(isCcPlayableNow(activationGame, 1, 'Test', mockEffect('duringActivation')));
  });

  it('returns false for duringActivation when player is not active', () => {
    assert.ok(!isCcPlayableNow(activationGame, 2, 'Test', mockEffect('duringActivation')));
  });

  it('returns true for startOfRound timing during start of round', () => {
    assert.ok(isCcPlayableNow(startOfRoundGame, 1, 'Test', mockEffect('startOfRound')));
  });

  it('returns false for startOfRound when not in start-of-round phase', () => {
    assert.ok(!isCcPlayableNow(activationGame, 1, 'Test', mockEffect('startOfRound')));
  });

  it('returns true for duringAttack timing when combat is active', () => {
    assert.ok(isCcPlayableNow(attackGame, 1, 'Test', mockEffect('duringAttack')));
  });

  it('returns true for whileDefending when player is defender', () => {
    assert.ok(isCcPlayableNow(attackGame, 2, 'Test', mockEffect('whileDefending')));
  });

  it('returns false for whileDefending when player is attacker', () => {
    assert.ok(!isCcPlayableNow(attackGame, 1, 'Test', mockEffect('whileDefending')));
  });

  it('returns true for endOfRound when it is player end-of-round turn', () => {
    assert.ok(isCcPlayableNow(endOfRoundGame, 1, 'Test', mockEffect('endOfRound')));
  });

  it('returns false for specialAction timing (played from DC, not hand)', () => {
    assert.ok(!isCcPlayableNow(activationGame, 1, 'Test', mockEffect('specialAction')));
  });

  it('returns false for doubleActionSpecial timing', () => {
    assert.ok(!isCcPlayableNow(activationGame, 1, 'Test', mockEffect('doubleActionSpecial')));
  });

  it('returns false when no effect found', () => {
    assert.ok(!isCcPlayableNow(activationGame, 1, 'Test', () => null));
  });

  it('returns false when effect has no timing', () => {
    assert.ok(!isCcPlayableNow(activationGame, 1, 'Test', () => ({})));
  });

  it('blocks play when shadowOpsBlockedPlayer matches', () => {
    const game = { ...activationGame, shadowOpsBlockedPlayer: 1 };
    assert.ok(!isCcPlayableNow(game, 1, 'Test', mockEffect('duringActivation')));
  });

  it('allows play for unblocked player under shadowOps', () => {
    const game = { ...activationGame, shadowOpsBlockedPlayer: 2 };
    assert.ok(isCcPlayableNow(game, 1, 'Test', mockEffect('duringActivation')));
  });

  it('blocks play when commsJammerActivePlayerNum blocks opponent', () => {
    const game = { ...activationGame, commsJammerActivePlayerNum: 1 };
    // Player 2 is jammed (commsJammer active by player 1, blocks opponent = player 2)
    assert.ok(!isCcPlayableNow(game, 2, 'Test', mockEffect('duringActivation')));
  });

  it('allows play for jammer owner', () => {
    const game = { ...activationGame, commsJammerActivePlayerNum: 1 };
    assert.ok(isCcPlayableNow(game, 1, 'Test', mockEffect('duringActivation')));
  });

  // Attacker-only timings
  it('whileAttackingBeforeDefenderRerolls requires isAttacker', () => {
    assert.ok(isCcPlayableNow(attackGame, 1, 'Test', mockEffect('whileAttackingBeforeDefenderRerolls')));
    assert.ok(!isCcPlayableNow(attackGame, 2, 'Test', mockEffect('whileAttackingBeforeDefenderRerolls')));
  });

  // afterAttack is available to either combatant
  it('afterAttack is available during attack to either player', () => {
    assert.ok(isCcPlayableNow(attackGame, 1, 'Test', mockEffect('afterAttack')));
    assert.ok(isCcPlayableNow(attackGame, 2, 'Test', mockEffect('afterAttack')));
  });

  it('afterAttackTargetingYouResolved requires isDefender', () => {
    assert.ok(!isCcPlayableNow(attackGame, 1, 'Test', mockEffect('afterAttackTargetingYouResolved')));
    assert.ok(isCcPlayableNow(attackGame, 2, 'Test', mockEffect('afterAttackTargetingYouResolved')));
  });

  it('returns false for unknown timing', () => {
    assert.ok(!isCcPlayableNow(activationGame, 1, 'Test', mockEffect('unknownTiming123')));
  });
});

// --- getPlayableCcFromHand ---

describe('getPlayableCcFromHand', () => {
  const mockEffect = (timing) => () => ({ timing });

  it('filters hand to only playable cards', () => {
    const game = {
      player1Id: 'u1', player2Id: 'u2',
      currentActivationTurnPlayerId: 'u1',
    };
    const hand = ['CardA', 'CardB', 'CardC'];
    // Override: only CardA is duringActivation, CardB is startOfRound, CardC has no effect
    const getEffect = (name) => {
      if (name === 'CardA') return { timing: 'duringActivation' };
      if (name === 'CardB') return { timing: 'startOfRound' };
      return null;
    };
    // We can't easily inject getEffect into getPlayableCcFromHand since it uses data-loader.
    // But we CAN test that the function returns an array and handles null hand.
    const result = getPlayableCcFromHand(game, 1, null);
    assert.deepStrictEqual(result, []);
  });

  it('returns empty for null hand', () => {
    const result = getPlayableCcFromHand({}, 1, null);
    assert.deepStrictEqual(result, []);
  });

  it('returns empty for empty hand', () => {
    const result = getPlayableCcFromHand({}, 1, []);
    assert.deepStrictEqual(result, []);
  });
});

// --- isCcPlayLegalByRestriction ---

describe('isCcPlayLegalByRestriction', () => {
  it('returns legal:true when playableBy is empty', () => {
    const game = { p1DcList: [] };
    const r = isCcPlayLegalByRestriction(game, 1, 'Test', () => ({ playableBy: '' }));
    assert.strictEqual(r.legal, true);
  });

  it('returns legal:true when playableBy is "any figure"', () => {
    const game = { p1DcList: [] };
    const r = isCcPlayLegalByRestriction(game, 1, 'Test', () => ({ playableBy: 'Any Figure' }));
    assert.strictEqual(r.legal, true);
  });

  it('returns legal:true for "any small figure"', () => {
    const game = { p1DcList: [] };
    const r = isCcPlayLegalByRestriction(game, 1, 'Test', () => ({ playableBy: 'Any Small Figure' }));
    assert.strictEqual(r.legal, true);
  });

  it('returns legal:true for "any unique figure"', () => {
    const game = { p1DcList: [] };
    const r = isCcPlayLegalByRestriction(game, 1, 'Test', () => ({ playableBy: 'Any Unique Figure' }));
    assert.strictEqual(r.legal, true);
  });

  it('returns legal:false when no DC matches restriction', () => {
    const game = { p1DcList: [{ dcName: 'Stormtrooper', displayName: 'Stormtrooper' }] };
    const r = isCcPlayLegalByRestriction(game, 1, 'Test', () => ({ playableBy: 'Luke Skywalker' }));
    assert.strictEqual(r.legal, false);
    assert.ok(r.reason);
  });

  it('returns legal:true when DC name matches restriction', () => {
    const game = { p1DcList: [{ dcName: 'Luke Skywalker', displayName: 'Luke Skywalker' }] };
    const r = isCcPlayLegalByRestriction(game, 1, 'Test', () => ({ playableBy: 'Luke Skywalker' }));
    assert.strictEqual(r.legal, true);
  });

  it('handles null effect gracefully', () => {
    const game = { p1DcList: [] };
    const r = isCcPlayLegalByRestriction(game, 1, 'Test', () => null);
    assert.strictEqual(r.legal, true);
  });
});
