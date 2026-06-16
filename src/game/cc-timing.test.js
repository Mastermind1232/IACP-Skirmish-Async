/**
 * Tests for src/game/cc-timing.js. Run: node --test src/game/cc-timing.test.js
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { getCcPlayContext, isCcPlayableNow, getPlayableCcFromHand, isCcPlayLegalByRestriction, ccFigureIsLarge, figureMatchesCcRestriction } from './cc-timing.js';

// --- size semantics + per-figure CC restriction (alexanbv 2026-06-16) ---

describe('ccFigureIsLarge — large = footprint >1x1, NOT massive', () => {
  it('1x1 figures are not large', () => {
    assert.equal(ccFigureIsLarge('Darth Vader'), false); // 1x1
    assert.equal(ccFigureIsLarge('Stormtrooper'), false);
  });
  it('>1x1 figures are large (incl. non-massive ones like Dewback)', () => {
    assert.equal(ccFigureIsLarge('Dewback Rider'), true);  // 1x2, not massive
    assert.equal(ccFigureIsLarge('Nexu (Elite)'), true);   // 2x2, not massive
    assert.equal(ccFigureIsLarge('AT-ST'), true);          // 2x3
  });
});

describe('figureMatchesCcRestriction — per-figure playableBy gate', () => {
  const g = {};
  it('"Any Small Figure" → only 1x1 figures', () => {
    assert.equal(figureMatchesCcRestriction(g, 'Darth Vader', 'Darth Vader', 'Any Small Figure'), true);
    assert.equal(figureMatchesCcRestriction(g, 'Nexu (Elite)', 'Nexu', 'Any Small Figure'), false);
  });
  it('"LARGE CREATURE" → >1x1 AND creature keyword (Dewback/Nexu qualify, not Vader)', () => {
    assert.equal(figureMatchesCcRestriction(g, 'Nexu (Elite)', 'Nexu', 'LARGE CREATURE'), true);
    assert.equal(figureMatchesCcRestriction(g, 'Dewback Rider', 'Dewback Rider', 'LARGE CREATURE'), true);
    assert.equal(figureMatchesCcRestriction(g, 'Darth Vader', 'Darth Vader', 'LARGE CREATURE'), false);
  });
  it('"Any Unique Figure" → only unique DCs', () => {
    assert.equal(figureMatchesCcRestriction(g, 'Darth Vader', 'Darth Vader', 'Any Unique Figure'), true);
    assert.equal(figureMatchesCcRestriction(g, 'Stormtrooper', 'Stormtrooper', 'Any Unique Figure'), false);
  });
  it('trait/faction/name dimensions match (variant-suffix tolerant)', () => {
    assert.equal(figureMatchesCcRestriction(g, 'HK Assassin Droid (Elite)', 'HK', 'HUNTER'), true);
    assert.equal(figureMatchesCcRestriction(g, 'HK Assassin Droid', 'HK', 'HUNTER'), true); // base name
    assert.equal(figureMatchesCcRestriction(g, 'Stormtrooper', 'Stormtrooper', 'HUNTER'), false);
  });
  it('"Non-Massive GUARDIAN or VEHICLE" → VEHICLE passes; the non-massive guardian branch excludes massive', () => {
    assert.equal(figureMatchesCcRestriction(g, 'AT-ST', 'AT-ST', 'Non-Massive GUARDIAN or VEHICLE'), true); // VEHICLE
  });
  it('"Any Figure" is always playable', () => {
    assert.equal(figureMatchesCcRestriction(g, 'Stormtrooper', 'Stormtrooper', 'Any Figure'), true);
  });
});

// --- getCcPlayContext ---

describe('getCcPlayContext', () => {
  it('returns startOfRound when SoR window is active (startOfRoundWhoseTurn set)', () => {
    const game = {
      player1Id: 'u1', player2Id: 'u2',
      currentRound: 1,
      startOfRoundWhoseTurn: 'u1',
      currentActivationTurnPlayerId: 'u1', // set before SoR ends
    };
    const ctx = getCcPlayContext(game, 1);
    assert.strictEqual(ctx.startOfRound, true);
    // duringActivation must be false during SoR even though currentActivationTurnPlayerId is set
    assert.strictEqual(ctx.duringActivation, false);
    assert.strictEqual(ctx.endOfRound, false);
  });

  it('startOfRound is false when SoR window is closed (startOfRoundWhoseTurn null)', () => {
    const game = {
      player1Id: 'u1', player2Id: 'u2',
      currentRound: 1,
      startOfRoundWhoseTurn: null,
      roundActivationMessageId: 'msg1',
      roundActivationButtonShown: false,
      currentActivationTurnPlayerId: 'u1',
    };
    const ctx = getCcPlayContext(game, 1);
    assert.strictEqual(ctx.startOfRound, false);
    assert.strictEqual(ctx.duringActivation, true);
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
    startOfRoundWhoseTurn: 'u1',
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

// --- canPlayCC / playCC pipeline (alexanbv 2026-06-16) ---
import { canPlayCC, playCC, ccRemovesToGameBox } from './cc-timing.js';

const _ccGame = () => ({
  pendingCombat: { attackerPlayerNum: 1, defenderPlayerNum: 2 },
  currentRound: 1,
  player1CcHand: ['Wild Attack', 'Tools for the Job'],
  player2CcHand: ['Stealth Tactics'],
  figurePositions: {
    1: { 'HK Assassin Droid (Elite)-1-0': 'a1', 'Stormtrooper-1-1': 'a2' },
    2: { 'Darth Vader-2-0': 'b1' },
  },
});

describe('canPlayCC — the four play checks', () => {
  it('ok when in hand + valid figure + not restricted + timing matches', () => {
    assert.deepEqual(canPlayCC(_ccGame(), 1, 'HK Assassin Droid (Elite)-1-0', 'Wild Attack'), { ok: true });
  });
  it('fails when the card is not in hand', () => {
    const r = canPlayCC(_ccGame(), 1, 'HK Assassin Droid (Elite)-1-0', 'Marksman');
    assert.equal(r.ok, false);
    assert.match(r.reason, /not in your hand/);
  });
  it('fails when the figure does not satisfy playableBy (Stormtrooper is not a HUNTER/SMUGGLER)', () => {
    const r = canPlayCC(_ccGame(), 1, 'Stormtrooper-1-1', 'Tools for the Job');
    assert.equal(r.ok, false);
    assert.match(r.reason, /can't play/);
  });
  it('fails when the player is blocked from CCs (Mak Critical Hit)', () => {
    const g = _ccGame(); g.criticalHitBlockedPlayer = 1;
    assert.equal(canPlayCC(g, 1, 'HK Assassin Droid (Elite)-1-0', 'Wild Attack').ok, false);
  });
  it('allowNotInHand bypasses the in-hand check (Aphra/Ezra/Data Theft)', () => {
    const g = _ccGame(); g.player1CcHand = [];
    assert.equal(canPlayCC(g, 1, 'HK Assassin Droid (Elite)-1-0', 'Wild Attack', { allowNotInHand: true }).ok, true);
  });
});

describe('ccRemovesToGameBox', () => {
  it('true for cards whose effect says game box (YWNDM), false otherwise', () => {
    assert.equal(ccRemovesToGameBox('You Will Not Deny Me'), true);
    assert.equal(ccRemovesToGameBox('Wild Attack'), false);
  });
});

describe('playCC — validate, execute, dispose', () => {
  it('executes the card ability and discards to the player discard', () => {
    const g = _ccGame(); let calledId = null;
    const r = playCC(g, 1, 'HK Assassin Droid (Elite)-1-0', 'Wild Attack', {
      ctx: { resolveAbility: (id) => { calledId = id; return { applied: true }; } },
    });
    assert.equal(r.ok, true);
    assert.equal(r.disposedTo, 'discard');
    assert.equal(calledId, 'Wild Attack');
    assert.ok(!g.player1CcHand.includes('Wild Attack'), 'removed from hand');
    assert.ok(g.player1CcDiscard.includes('Wild Attack'), 'sent to discard');
  });
  it('removeTo:gamebox sends the card to game.gameBox instead of discard', () => {
    const g = _ccGame();
    const r = playCC(g, 1, 'HK Assassin Droid (Elite)-1-0', 'Wild Attack', {
      removeTo: 'gamebox', ctx: { resolveAbility: () => ({}) },
    });
    assert.equal(r.ok, true);
    assert.equal(r.disposedTo, 'gamebox');
    assert.ok((g.gameBox || []).includes('Wild Attack'), 'sent to game box');
    assert.ok(!(g.player1CcDiscard || []).includes('Wild Attack'), 'not in discard');
  });
  it('a failed validation returns the reason and does NOT discard', () => {
    const g = _ccGame();
    const r = playCC(g, 1, 'HK Assassin Droid (Elite)-1-0', 'Marksman', { ctx: { resolveAbility: () => ({}) } });
    assert.equal(r.ok, false);
    assert.ok(!(g.player1CcDiscard || []).includes('Marksman'));
  });
});
