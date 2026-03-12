import { describe, it } from 'node:test';
import assert from 'node:assert';
import { createHarness } from '../../src/headless/game-harness.js';

describe('headless activation flow', () => {
  const roundActiveGame = {
    gameId: '99002',
    player1Id: 'p1',
    player2Id: 'p2',
    initiativePlayerId: 'p1',
    phase: 'round_active',
    roundPhase: 'activation',
    currentRound: 1,
    currentActivationTurnPlayerId: 'p1',
    p1ActivationsRemaining: 1,
    p2ActivationsRemaining: 1,
    figurePositions: { 1: { 'IG-88-1-0': 'e5' }, 2: { 'Luke Skywalker-1-0': 'j5' } },
    dcActionsData: {},
    generalId: 'gen-channel',
    boardId: 'board-channel',
    statusId: 'status-channel',
    player1PlayAreaId: 'p1pa-channel',
    player2PlayAreaId: 'p2pa-channel',
    player1HandChannelId: 'p1hand-channel',
    player2HandChannelId: 'p2hand-channel',
  };

  it('pass_activation_turn handler runs without error', async () => {
    const harness = createHarness(roundActiveGame);
    const result = await harness.submitAction('pass_activation_turn_99002', 'p1');
    assert.ok(!result.error, `Expected no error, got: ${result.error}`);
  });

  it('end_activation_phase handler runs without error when 0 activations', async () => {
    const game = {
      ...roundActiveGame,
      p1ActivationsRemaining: 0,
      p2ActivationsRemaining: 0,
    };
    const harness = createHarness(game);
    const result = await harness.submitAction('status_phase_99002', 'p1');
    assert.ok(!result.error, `Expected no error, got: ${result.error}`);
  });

  it('phase gate ready handler advances gate state', async () => {
    const game = {
      ...roundActiveGame,
      phaseGate: { phase: 'activation_done', p1Ready: false, p2Ready: false },
    };
    const harness = createHarness(game);

    // P1 readies up
    const r1 = await harness.submitAction('phase_gate_ready_99002_1', 'p1');
    assert.ok(!r1.error, `P1 ready error: ${r1.error}`);

    // P2 readies up
    const r2 = await harness.submitAction('phase_gate_ready_99002_2', 'p2');
    assert.ok(!r2.error, `P2 ready error: ${r2.error}`);
  });

  it('end_turn handler runs for activated DC', async () => {
    const dcMsgId = 'dc-msg-001';
    const game = {
      ...roundActiveGame,
      dcActionsData: { [dcMsgId]: { remaining: 0, total: 2 } },
    };
    const dcMessageMeta = new Map([
      [dcMsgId, { gameId: '99002', playerNum: 1, dcName: 'IG-88', displayName: 'IG-88' }],
    ]);
    const harness = createHarness(game, { dcMessageMeta });
    const result = await harness.submitAction(`end_turn_${dcMsgId}`, 'p1');
    assert.ok(!result.error, `Expected no error, got: ${result.error}`);
  });
});
