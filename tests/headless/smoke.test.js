import { describe, it } from 'node:test';
import assert from 'node:assert';
import { createHarness } from '../../src/headless/game-harness.js';

describe('headless smoke tests', () => {
  const baseGame = {
    gameId: '99001',
    player1Id: 'p1',
    player2Id: 'p2',
    initiativePlayerId: 'p1',
    phase: 'deployment',
    phaseGate: { phase: 'deploy_done', p1Ready: false, p2Ready: false },
  };

  it('creates harness and loads game', () => {
    const harness = createHarness(baseGame);
    const game = harness.getGame();
    assert.strictEqual(game.gameId, '99001');
    assert.strictEqual(game.phase, 'deployment');
  });

  it('game state is deep cloned from initial', () => {
    const harness = createHarness(baseGame);
    const game = harness.getGame();
    game.phase = 'ended';
    // Original should be unchanged
    assert.strictEqual(baseGame.phase, 'deployment');
    // But harness returns mutated state
    assert.strictEqual(harness.getGame().phase, 'ended');
  });

  it('submitAction resolves handler and returns result', async () => {
    const harness = createHarness(baseGame);
    const result = await harness.submitAction('phase_gate_ready_99001_1', 'p1');
    assert.ok(!result.error, `Expected no error, got: ${result.error}`);
    assert.ok(result.messages.length > 0, 'Should capture at least one message');
  });

  it('returns error for unknown customId', async () => {
    const harness = createHarness(baseGame);
    const result = await harness.submitAction('nonexistent_button_12345', 'p1');
    assert.ok(result.error, 'Should return error for unknown customId');
    assert.ok(result.error.includes('No handler'), result.error);
  });

  it('getDeps returns the full deps bag', () => {
    const harness = createHarness(baseGame);
    const deps = harness.getDeps();
    assert.ok(deps.getGame, 'Should have getGame');
    assert.ok(deps.client, 'Should have client');
    assert.ok(deps.saveGames, 'Should have saveGames');
  });

  it('getMessages accumulates across multiple actions', async () => {
    const harness = createHarness(baseGame);
    await harness.submitAction('phase_gate_ready_99001_1', 'p1');
    await harness.submitAction('phase_gate_ready_99001_2', 'p2');
    const messages = harness.getMessages();
    assert.ok(messages.length >= 2, `Expected at least 2 messages, got ${messages.length}`);
  });
});
