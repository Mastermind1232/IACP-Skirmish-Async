import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { whyMidAction, advanceTransitionalStateBeforeSnapshot } from '../../src/handlers/checkpoint.js';

describe('whyMidAction — save-time boundary gate', () => {
  it('returns empty string for a clean game (no in-flight action)', () => {
    const game = {
      pendingCombat: null,
      moveInProgress: {},
      pendingSpacePick: {},
      dcActionsData: {},
    };
    assert.equal(whyMidAction(game), '');
  });

  it('returns empty string for a freshly-loaded game with all fields undefined', () => {
    assert.equal(whyMidAction({}), '');
  });

  it('refuses save when combat is pending', () => {
    const game = { pendingCombat: { attackerMsgId: 'x', defenderMsgId: 'y' } };
    assert.match(whyMidAction(game), /combat/i);
  });

  it('refuses save when a move is in progress', () => {
    const game = { moveInProgress: { 'msg_1_0': { remaining: 3 } } };
    assert.match(whyMidAction(game), /move/i);
  });

  it('refuses save when a space pick is open', () => {
    const game = { pendingSpacePick: { 'g1_msg_1': { spaces: ['a1'] } } };
    assert.match(whyMidAction(game), /space pick/i);
  });

  it('refuses save when an activation has started actions', () => {
    const game = { dcActionsData: { 'msg_1': { actionsLeft: 1 } } };
    assert.match(whyMidAction(game), /activation/i);
  });

  it('returns empty for null game (defensive)', () => {
    assert.equal(whyMidAction(null), '');
    assert.equal(whyMidAction(undefined), '');
  });

  it('treats empty objects on each in-flight bucket as clean', () => {
    const game = {
      pendingCombat: null,
      moveInProgress: {},
      pendingSpacePick: {},
      dcActionsData: {},
    };
    assert.equal(whyMidAction(game), '');
  });

  // ── Hardened gate (post-2026-05-01): catches the transitional states
  //    that produced unloadable checkpoints

  it('refuses save when post-deploy queue has abilities pending', () => {
    const game = {
      postDeployQueue: { abilities: [{ msgId: 'm1', ability: 'smooth_landing' }] },
    };
    assert.match(whyMidAction(game), /post-deploy/i);
  });

  it('refuses save when post-deploy queue has activeAbility set', () => {
    const game = {
      postDeployQueue: { abilities: [], activeAbility: { msgId: 'x' } },
    };
    assert.match(whyMidAction(game), /post-deploy/i);
  });

  it('treats empty post-deploy queue as clean', () => {
    const game = {
      postDeployQueue: { abilities: [], nextPlayerAbilities: [], activeAbility: null, awaitingOrder: false },
    };
    assert.equal(whyMidAction(game), '');
  });

  it('refuses save when pendingNegation is open', () => {
    const game = {
      pendingNegation: { attackerMsgId: 'm1', cardName: 'Block' },
    };
    assert.match(whyMidAction(game), /negation/i);
  });

  it('refuses save when pendingCcChoice is open', () => {
    const game = {
      pendingCcChoice: { cardName: 'Take Initiative', options: ['a', 'b'] },
    };
    assert.match(whyMidAction(game), /CC-effect choice/i);
  });

  it('refuses save when pendingDcAbilityChoice is open', () => {
    const game = {
      pendingDcAbilityChoice: { msgId: 'x', options: [] },
    };
    assert.match(whyMidAction(game), /DC ability choice/i);
  });

  it('treats null/empty pending* fields as clean', () => {
    const game = {
      pendingNegation: null,
      pendingCcChoice: {},
      pendingDcAbilityChoice: undefined,
      pendingCelebration: {},
    };
    assert.equal(whyMidAction(game), '');
  });

  it('refuses save during end_of_round phase (gameplay effects resolving)', () => {
    const game = {
      roundPhase: 'end_of_round',
    };
    assert.match(whyMidAction(game), /end-of-round/i);
  });

  it('allows save during round_active + activation roundPhase with clean state', () => {
    const game = {
      phase: 'round_active',
      roundPhase: 'activation',
      activationPhaseMessagePosted: true,
      postDeployEffectsFired: true,
    };
    assert.equal(whyMidAction(game), '');
  });

  // ── advanceTransitionalStateBeforeSnapshot — runs the bookkeeping transitions
  //    so the saver doesn't refuse them. NEVER a gameplay decision.

  describe('advanceTransitionalStateBeforeSnapshot', () => {
    it('advances deployment → cc_draw when both deployed and queue empty', () => {
      const game = {
        phase: 'deployment',
        player1Squad: { dcList: [] },
        player2Squad: { dcList: [] },
        initiativePlayerDeployed: true,
        nonInitiativePlayerDeployed: true,
        postDeployEffectsFired: false,
      };
      const advanced = advanceTransitionalStateBeforeSnapshot(game);
      assert.equal(advanced, true);
      assert.equal(game.phase, 'cc_draw');
      assert.equal(game.postDeployEffectsFired, true);
      // After advancement, gate should pass.
      assert.equal(whyMidAction(game), '');
    });

    it('flips postDeployEffectsFired alone when phase already cc_draw', () => {
      const game = { phase: 'cc_draw', postDeployEffectsFired: false };
      const advanced = advanceTransitionalStateBeforeSnapshot(game);
      assert.equal(advanced, true);
      assert.equal(game.postDeployEffectsFired, true);
    });

    it('advances start_of_round → activation when activation msg not yet posted', () => {
      const game = {
        phase: 'round_active',
        roundPhase: 'start_of_round',
        activationPhaseMessagePosted: false,
      };
      const advanced = advanceTransitionalStateBeforeSnapshot(game);
      assert.equal(advanced, true);
      assert.equal(game.roundPhase, 'activation');
    });

    it('does NOT advance when post-deploy queue has pending abilities (user input needed)', () => {
      const game = {
        phase: 'deployment',
        player1Squad: { dcList: [] },
        player2Squad: { dcList: [] },
        initiativePlayerDeployed: true,
        nonInitiativePlayerDeployed: true,
        postDeployEffectsFired: false,
        postDeployQueue: { abilities: [{ msgId: 'm1' }] },
      };
      const advanced = advanceTransitionalStateBeforeSnapshot(game);
      assert.equal(advanced, false);
      assert.equal(game.phase, 'deployment');
      // Gate should still refuse this state (real user input pending).
      assert.match(whyMidAction(game), /post-deploy/i);
    });

    it('returns false when nothing to advance (already clean state)', () => {
      const game = {
        phase: 'round_active',
        roundPhase: 'activation',
        activationPhaseMessagePosted: true,
        postDeployEffectsFired: true,
      };
      const advanced = advanceTransitionalStateBeforeSnapshot(game);
      assert.equal(advanced, false);
    });

    it('null/undefined game returns false safely', () => {
      assert.equal(advanceTransitionalStateBeforeSnapshot(null), false);
      assert.equal(advanceTransitionalStateBeforeSnapshot(undefined), false);
    });

    it('advances do not touch hands, dcList, or any rules state', () => {
      const game = {
        phase: 'deployment',
        player1Squad: { dcList: ['Trooper'] },
        player2Squad: { dcList: ['Rebel'] },
        initiativePlayerDeployed: true,
        nonInitiativePlayerDeployed: true,
        postDeployEffectsFired: false,
        player1CcHand: ['Card A'],
        player1CcDeck: ['Card B'],
        p1DcList: [{ dcName: 'Trooper', healthState: [[5, 5]] }],
      };
      advanceTransitionalStateBeforeSnapshot(game);
      // Game state untouched except the plumbing flags
      assert.deepEqual(game.player1CcHand, ['Card A']);
      assert.deepEqual(game.player1CcDeck, ['Card B']);
      assert.deepEqual(game.p1DcList, [{ dcName: 'Trooper', healthState: [[5, 5]] }]);
    });
  });
});
