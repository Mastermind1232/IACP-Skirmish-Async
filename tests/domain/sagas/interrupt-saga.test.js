import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { InterruptSaga, INTERRUPT_CONFIG } from '../../../src/domain/sagas/interrupt-saga.js';

describe('InterruptSaga', () => {
  it('stillFaster: creates with correct config and resolves', () => {
    const saga = new InterruptSaga('i-1', 'stillFaster', 1);
    assert.equal(saga.type, 'interrupt');
    assert.equal(saga.state.interruptType, 'stillFaster');
    assert.equal(saga.state.playerNum, 1);
    assert.equal(saga.state.pendingField, 'pendingStillFaster');
    assert.equal(saga.state.handlerPrefix, 'still_faster_');
    assert.deepEqual(saga.getExpectedActions(), ['still_faster_confirm', 'still_faster_skip']);

    saga.resolve('confirm');
    assert.equal(saga.state.choice, 'confirm');
    assert.equal(saga.status, 'completed');
    assert.deepEqual(saga.getExpectedActions(), []);
  });

  it('toughLuck: creates with correct config', () => {
    const saga = new InterruptSaga('i-2', 'toughLuck', 2);
    assert.equal(saga.state.pendingField, 'pendingToughLuck');
    assert.equal(saga.state.handlerPrefix, 'tough_luck_');
    assert.deepEqual(saga.getExpectedActions(), ['tough_luck_confirm', 'tough_luck_skip']);

    saga.resolve('skip');
    assert.equal(saga.state.choice, 'skip');
    assert.equal(saga.status, 'completed');
  });

  it('fieldTactics: creates with correct config and accepts options', () => {
    const saga = new InterruptSaga('i-3', 'fieldTactics', 1, { targetFigure: 'Stormtrooper-0-0' });
    assert.equal(saga.state.pendingField, 'pendingFieldTactics');
    assert.equal(saga.state.handlerPrefix, 'field_tactics_');
    assert.equal(saga.state.targetFigure, 'Stormtrooper-0-0');
    assert.ok(saga.isActive());
  });

  it('unknown interrupt type falls back to generated config', () => {
    const saga = new InterruptSaga('i-4', 'customInterrupt', 2);
    assert.equal(saga.state.pendingField, 'pendingcustomInterrupt');
    assert.equal(saga.state.handlerPrefix, 'customInterrupt_');
    assert.deepEqual(saga.getExpectedActions(), ['customInterrupt_confirm', 'customInterrupt_skip']);
  });

  it('INTERRUPT_CONFIG has entries for all known interrupts', () => {
    const expectedKeys = [
      'stillFaster', 'toughLuck', 'lastResort', 'fieldTactics',
      'emperorInterrupt', 'executiveOrder', 'bombardmentSorin',
      'firingSquad', 'coordinatedRaid', 'awr', 'thereIsNoTry',
      'hunterProtocol', 'selfDestruct', 'rushPush', 'coverFire',
      'voracious', 'assassinsBlade', 'punishingStrike', 'conspire',
      'ccConfirmation', 'negation', 'commDisruption', 'orbitalBombardment',
      'yhsiw', 'illicitArms', 'extraProtection', 'executorInterrupt',
      'blackMarket', 'belReorder',
    ];
    for (const key of expectedKeys) {
      assert.ok(INTERRUPT_CONFIG[key], `Missing config for ${key}`);
      assert.ok(INTERRUPT_CONFIG[key].pendingField, `Missing pendingField for ${key}`);
      assert.ok(INTERRUPT_CONFIG[key].handlerPrefix, `Missing handlerPrefix for ${key}`);
    }
  });
});
