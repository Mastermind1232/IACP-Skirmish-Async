import { describe, it } from 'node:test';
import assert from 'node:assert';
import { getAvailableActions } from '../../src/engine/available-actions.js';
import { ACTION_TYPES } from '../../src/engine/action-types.js';

describe('getAvailableActions — setup phases', () => {
  const baseGame = {
    gameId: '00001',
    player1Id: 'p1',
    player2Id: 'p2',
    initiativePlayerId: 'p1',
    player1Squad: { dcList: [{ dcName: 'Stormtrooper (Regular)', displayName: 'Stormtrooper [DG 1]' }] },
    player2Squad: { dcList: [{ dcName: 'Rebel Trooper', displayName: 'Rebel Trooper [DG 1]' }] },
  };

  it('returns empty for ended games', () => {
    const game = { ...baseGame, ended: true, phase: 'ended' };
    const actions = getAvailableActions(game, 1);
    assert.strictEqual(actions.length, 0);
  });

  it('returns phase gate actions when gate is set', () => {
    const game = {
      ...baseGame,
      phase: 'deployment',
      phaseGate: { phase: 'deploy_done', p1Ready: false, p2Ready: false },
    };
    const p1Actions = getAvailableActions(game, 1);
    assert.ok(p1Actions.some(a => a.type === ACTION_TYPES.PHASE_GATE_READY));

    const p2Actions = getAvailableActions(game, 2);
    assert.ok(p2Actions.some(a => a.type === ACTION_TYPES.PHASE_GATE_READY));
  });

  it('returns unready action for already-ready player', () => {
    const game = {
      ...baseGame,
      phase: 'deployment',
      phaseGate: { phase: 'deploy_done', p1Ready: true, p2Ready: false },
    };
    const p1Actions = getAvailableActions(game, 1);
    assert.ok(p1Actions.some(a => a.type === ACTION_TYPES.PHASE_GATE_UNREADY));
    assert.ok(!p1Actions.some(a => a.type === ACTION_TYPES.PHASE_GATE_READY));

    const p2Actions = getAvailableActions(game, 2);
    assert.ok(p2Actions.some(a => a.type === ACTION_TYPES.PHASE_GATE_READY));
  });

  it('returns zone selection actions only for the chooser', () => {
    const game = {
      ...baseGame,
      phase: 'zone_selection',
    };
    const p1Actions = getAvailableActions(game, 1);
    assert.ok(p1Actions.some(a => a.type === ACTION_TYPES.PICK_ZONE));
    assert.strictEqual(p1Actions.filter(a => a.type === ACTION_TYPES.PICK_ZONE).length, 2); // red + blue

    const p2Actions = getAvailableActions(game, 2);
    assert.strictEqual(p2Actions.length, 0);
  });

  it('returns deployment actions for initiative player first', () => {
    const game = {
      ...baseGame,
      phase: 'deployment',
      initiativePlayerDeployed: false,
      nonInitiativePlayerDeployed: false,
    };
    // P1 is initiative player
    const p1Actions = getAvailableActions(game, 1);
    assert.ok(p1Actions.some(a => a.type === ACTION_TYPES.AUTO_DEPLOY));
    assert.ok(p1Actions.some(a => a.type === ACTION_TYPES.DEPLOY_DONE));

    // P2 should have no actions yet
    const p2Actions = getAvailableActions(game, 2);
    assert.strictEqual(p2Actions.length, 0);
  });

  it('returns deployment actions for P2 after P1 deployed', () => {
    const game = {
      ...baseGame,
      phase: 'deployment',
      initiativePlayerDeployed: true,
      nonInitiativePlayerDeployed: false,
    };
    const p1Actions = getAvailableActions(game, 1);
    assert.strictEqual(p1Actions.length, 0);

    const p2Actions = getAvailableActions(game, 2);
    assert.ok(p2Actions.some(a => a.type === ACTION_TYPES.AUTO_DEPLOY));
  });

  it('returns CC draw actions for players who haven\'t drawn', () => {
    const game = {
      ...baseGame,
      phase: 'cc_draw',
      player1CcDrawn: false,
      player2CcDrawn: false,
    };
    const p1Actions = getAvailableActions(game, 1);
    assert.ok(p1Actions.some(a => a.type === ACTION_TYPES.DRAW_CC));

    const p2Actions = getAvailableActions(game, 2);
    assert.ok(p2Actions.some(a => a.type === ACTION_TYPES.DRAW_CC));
  });

  it('returns no CC draw action for player who already drew', () => {
    const game = {
      ...baseGame,
      phase: 'cc_draw',
      player1CcDrawn: true,
      player2CcDrawn: false,
    };
    const p1Actions = getAvailableActions(game, 1);
    assert.strictEqual(p1Actions.length, 0);

    const p2Actions = getAvailableActions(game, 2);
    assert.ok(p2Actions.some(a => a.type === ACTION_TYPES.DRAW_CC));
  });
});
