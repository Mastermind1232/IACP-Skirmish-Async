import { describe, it } from 'node:test';
import assert from 'node:assert';
import { createHarness } from '../../src/headless/game-harness.js';

describe('headless movement flow', () => {
  const dcMsgId = 'dc-msg-mv1';
  const baseGame = {
    gameId: '99003',
    player1Id: 'p1',
    player2Id: 'p2',
    initiativePlayerId: 'p1',
    phase: 'round_active',
    roundPhase: 'activation',
    currentRound: 1,
    currentActivationTurnPlayerId: 'p1',
    p1ActivationsRemaining: 0,
    p2ActivationsRemaining: 0,
    figurePositions: {
      1: { 'Stormtrooper (Regular)-1-0': 'e5' },
      2: { 'Rebel Trooper-1-0': 'j5' },
    },
    dcActionsData: { [dcMsgId]: { remaining: 2, total: 2 } },
    selectedMap: { id: 'uscru_entertainment_district' },
    generalId: 'gen-channel',
    boardId: 'board-channel',
    statusId: 'status-channel',
    player1PlayAreaId: 'p1pa-channel',
    player2PlayAreaId: 'p2pa-channel',
    player1HandChannelId: 'p1hand-channel',
    player2HandChannelId: 'p2hand-channel',
  };

  const dcMeta = new Map([
    [dcMsgId, { gameId: '99003', playerNum: 1, dcName: 'Stormtrooper (Regular)', displayName: 'Stormtrooper [Group 1]' }],
  ]);

  it('dc_move handler runs without error', async () => {
    const harness = createHarness(baseGame, {
      dcMessageMeta: dcMeta,
      dcExhaustedState: new Map([[dcMsgId, true]]),
    });
    const result = await harness.submitAction(`dc_move_${dcMsgId}`, 'p1');
    assert.ok(!result.error, `Expected no error, got: ${result.error}`);
  });

  it('dc_attack handler runs without error', async () => {
    const harness = createHarness(baseGame, {
      dcMessageMeta: dcMeta,
      dcExhaustedState: new Map([[dcMsgId, true]]),
    });
    const result = await harness.submitAction(`dc_attack_${dcMsgId}`, 'p1');
    assert.ok(!result.error, `Expected no error, got: ${result.error}`);
  });

  it('dc_activate handler runs without error', async () => {
    const game = {
      ...baseGame,
      p1ActivationsRemaining: 1,
      dcActionsData: {},
    };
    const harness = createHarness(game, {
      dcMessageMeta: dcMeta,
      dcExhaustedState: new Map(), // not exhausted = ready
    });
    const result = await harness.submitAction(`dc_activate_${dcMsgId}`, 'p1');
    assert.ok(!result.error, `Expected no error, got: ${result.error}`);
  });
});
