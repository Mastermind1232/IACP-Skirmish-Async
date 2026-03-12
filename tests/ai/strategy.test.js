import { describe, it } from 'node:test';
import assert from 'node:assert';
import { pickBestAction, pickRandomAction } from '../../src/ai/strategy.js';
import { createGameEngine } from '../../src/engine/game-engine.js';

describe('AI strategy', () => {
  const baseGame = {
    gameId: '99020',
    player1Id: 'p1',
    player2Id: 'p2',
    initiativePlayerId: 'p1',
    phase: 'round_active',
    roundPhase: 'activation',
    currentRound: 1,
    currentActivationTurnPlayerId: 'p1',
    p1ActivationsRemaining: 1,
    figurePositions: { 1: { 'A-1-0': 'e5' }, 2: { 'B-1-0': 'j5' } },
  };

  it('pickBestAction returns null for empty actions', () => {
    const engine = createGameEngine(baseGame);
    const result = pickBestAction(engine, [], 1);
    assert.strictEqual(result, null);
  });

  it('pickBestAction returns single action with score 0', () => {
    const engine = createGameEngine(baseGame);
    const actions = [{ type: 'phase_gate_ready', customId: 'test', description: 'Test' }];
    const result = pickBestAction(engine, actions, 1);
    assert.strictEqual(result.action.type, 'phase_gate_ready');
    assert.strictEqual(result.score, 0); // Single action always returns 0
  });

  it('prefers phase_gate_ready over end_turn', () => {
    const engine = createGameEngine(baseGame);
    const actions = [
      { type: 'end_turn', customId: 'et', description: 'End turn' },
      { type: 'phase_gate_ready', customId: 'pgr', description: 'Ready' },
    ];
    const result = pickBestAction(engine, actions, 1);
    assert.strictEqual(result.action.type, 'phase_gate_ready');
  });

  it('prefers attack over move', () => {
    const engine = createGameEngine(baseGame);
    const actions = [
      { type: 'move_figure', customId: 'mv', description: 'Move' },
      { type: 'attack_target', customId: 'atk', description: 'Attack' },
    ];
    const result = pickBestAction(engine, actions, 1);
    assert.strictEqual(result.action.type, 'attack_target');
  });

  it('prefers activate_dc over pass_activation_turn', () => {
    const engine = createGameEngine(baseGame);
    const actions = [
      { type: 'pass_activation_turn', customId: 'pass', description: 'Pass' },
      { type: 'activate_dc', customId: 'act', description: 'Activate' },
    ];
    const result = pickBestAction(engine, actions, 1);
    assert.strictEqual(result.action.type, 'activate_dc');
  });

  it('prefers combat_roll over combat_ready', () => {
    const engine = createGameEngine(baseGame);
    const actions = [
      { type: 'combat_ready', customId: 'cr', description: 'Ready' },
      { type: 'combat_roll', customId: 'roll', description: 'Roll' },
    ];
    const result = pickBestAction(engine, actions, 1);
    assert.strictEqual(result.action.type, 'combat_roll');
  });

  it('pickRandomAction returns one action from the list', () => {
    const actions = [
      { type: 'a', customId: '1' },
      { type: 'b', customId: '2' },
      { type: 'c', customId: '3' },
    ];
    const result = pickRandomAction(actions);
    assert.ok(actions.includes(result));
  });

  it('pickRandomAction returns null for empty list', () => {
    assert.strictEqual(pickRandomAction([]), null);
    assert.strictEqual(pickRandomAction(null), null);
  });
});
