import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { whyMidAction } from '../../src/handlers/checkpoint.js';

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

  it('refuses the "post-deployment, pre-cc-draw" trap (deploy done, post-deploy effects not fired)', () => {
    const game = {
      phase: 'deployment',
      player1Squad: { dcList: [] },
      player2Squad: { dcList: [] },
      initiativePlayerDeployed: true,
      nonInitiativePlayerDeployed: true,
      postDeployEffectsFired: false,
    };
    assert.match(whyMidAction(game), /deployment is finishing|shuffle\/draw/i);
  });

  it('refuses cc_draw phase with postDeployEffectsFired still false', () => {
    const game = {
      phase: 'cc_draw',
      postDeployEffectsFired: false,
    };
    assert.match(whyMidAction(game), /transitioning|shuffle\/draw/i);
  });

  it('allows cc_draw phase once postDeployEffectsFired is true', () => {
    const game = {
      phase: 'cc_draw',
      postDeployEffectsFired: true,
    };
    assert.equal(whyMidAction(game), '');
  });

  it('refuses save when a generic pending* field has content (e.g. negation prompt)', () => {
    const game = {
      pendingNegation: { attackerMsgId: 'm1', cardName: 'Block' },
    };
    assert.match(whyMidAction(game), /negation/i);
  });

  it('refuses save when pendingCcChoice is open', () => {
    const game = {
      pendingCcChoice: { cardName: 'Take Initiative', options: ['a', 'b'] },
    };
    assert.match(whyMidAction(game), /cc choice/i);
  });

  it('treats null/false/empty pending* fields as clean', () => {
    const game = {
      pendingNegation: null,
      pendingCcChoice: false,
      pendingDcAbilityChoice: {},
      pendingDeflect: [],
    };
    assert.equal(whyMidAction(game), '');
  });

  it('refuses save during start_of_round before activation message posts', () => {
    const game = {
      phase: 'round_active',
      roundPhase: 'start_of_round',
      activationPhaseMessagePosted: false,
    };
    assert.match(whyMidAction(game), /start-of-round/i);
  });

  it('refuses save during end_of_round phase', () => {
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
});
