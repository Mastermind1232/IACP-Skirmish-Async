import { describe, it } from 'node:test';
import assert from 'node:assert';
import { createGameEngine } from '../../src/engine/game-engine.js';
import { ACTION_TYPES } from '../../src/engine/action-types.js';

describe('combat flow via engine API', () => {
  const baseGame = {
    gameId: '99011',
    player1Id: 'p1',
    player2Id: 'p2',
    initiativePlayerId: 'p1',
    phase: 'round_active',
    roundPhase: 'activation',
    currentRound: 1,
    figurePositions: {
      1: { 'IG-88-1-0': 'e5' },
      2: { 'Luke Skywalker-1-0': 'f5' }, // Adjacent for melee
    },
  };

  it('no combat actions when no pending combat', () => {
    const engine = createGameEngine(baseGame);
    const actions = engine.getAvailableActions(1);
    assert.ok(!actions.some(a => a.type === ACTION_TYPES.COMBAT_READY));
    assert.ok(!actions.some(a => a.type === ACTION_TYPES.COMBAT_ROLL));
  });

  it('shows combat ready for unready players', () => {
    const game = {
      ...baseGame,
      pendingCombat: {
        attackerPlayerNum: 1,
        p1Ready: true,
        p2Ready: false,
      },
    };
    const engine = createGameEngine(game);

    // P1 already ready — no actions
    const p1 = engine.getAvailableActions(1);
    assert.strictEqual(p1.length, 0);

    // P2 needs to ready
    const p2 = engine.getAvailableActions(2);
    assert.ok(p2.some(a => a.type === ACTION_TYPES.COMBAT_READY));
  });

  it('shows roll dice when both ready and no rolls yet', () => {
    const game = {
      ...baseGame,
      pendingCombat: {
        attackerPlayerNum: 1,
        p1Ready: true,
        p2Ready: true,
        attackRoll: null,
        defenseRoll: null,
      },
    };
    const engine = createGameEngine(game);
    const p1 = engine.getAvailableActions(1);
    assert.ok(p1.some(a => a.type === ACTION_TYPES.COMBAT_ROLL));
  });

  it('shows reroll actions during reroll phase for correct player', () => {
    const game = {
      ...baseGame,
      pendingCombat: {
        attackerPlayerNum: 1,
        p1Ready: true,
        p2Ready: true,
        attackRoll: [2, 3, 4],
        defenseRoll: [1, 2],
        rerollPhase: 'attacker',
        attackerRerollsRemaining: 1,
        attackDiceResults: [
          { color: 'blue', accuracy: 2, damage: 3, surge: 0 },
          { color: 'green', accuracy: 0, damage: 3, surge: 1 },
          { color: 'red', accuracy: 0, damage: 4, surge: 0 },
        ],
        attackerRerolledIndices: [],
      },
    };
    const engine = createGameEngine(game);

    const p1 = engine.getAvailableActions(1); // attacker
    assert.ok(p1.some(a => a.type === ACTION_TYPES.COMBAT_REROLL),
      'Attacker should have reroll action');

    const p2 = engine.getAvailableActions(2); // defender
    assert.strictEqual(p2.length, 0, 'Defender should have no actions during attacker reroll');
  });

  it('shows skip surges during surge phase', () => {
    const game = {
      ...baseGame,
      pendingCombat: {
        attackerPlayerNum: 1,
        p1Ready: true,
        p2Ready: true,
        attackRoll: [2, 3, 4],
        defenseRoll: [1, 2],
        pendingSurges: true,
      },
    };
    const engine = createGameEngine(game);

    const p1 = engine.getAvailableActions(1); // attacker gets surge controls
    assert.ok(p1.some(a => a.type === ACTION_TYPES.COMBAT_SKIP_SURGES));

    const p2 = engine.getAvailableActions(2); // defender has nothing
    assert.strictEqual(p2.length, 0);
  });

  it('getWaitingPlayers identifies combat ready state', () => {
    const game = {
      ...baseGame,
      pendingCombat: {
        attackerPlayerNum: 1,
        p1Ready: true,
        p2Ready: false,
      },
    };
    const engine = createGameEngine(game);
    const waiting = engine.getWaitingPlayers();
    assert.strictEqual(waiting.waitType, 'combatReady');
    assert.deepStrictEqual(waiting.playerNums, [2]);
  });

  it('getWaitingPlayers identifies combat in progress', () => {
    const game = {
      ...baseGame,
      pendingCombat: {
        attackerPlayerNum: 1,
        p1Ready: true,
        p2Ready: true,
      },
    };
    const engine = createGameEngine(game);
    const waiting = engine.getWaitingPlayers();
    assert.strictEqual(waiting.waitType, 'combat');
    assert.deepStrictEqual(waiting.playerNums, [1, 2]);
  });
});
