import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { CombatSaga, COMBAT_STATES } from '../../../src/domain/sagas/combat-saga.js';

describe('CombatSaga', () => {
  it('full lifecycle: declared → ready → roll → surge → resolve', () => {
    const saga = new CombatSaga('c-1', { attackerMsgId: 'msg1', defenderMsgId: 'msg2' });
    assert.equal(saga.state.phase, COMBAT_STATES.DECLARED);

    saga.markReady(1);
    assert.equal(saga.state.p1Ready, true);
    assert.equal(saga.state.phase, COMBAT_STATES.DECLARED); // still waiting for p2

    saga.markReady(2);
    assert.equal(saga.state.p2Ready, true);
    assert.equal(saga.state.phase, COMBAT_STATES.READY_CHECK);

    saga.startRolling();
    assert.equal(saga.state.phase, COMBAT_STATES.ROLLING);

    saga.setRolls([{ dmg: 2 }], [{ block: 1 }]);
    assert.equal(saga.state.phase, COMBAT_STATES.REROLL_WINDOW);

    saga.enterSurgeSpending();
    assert.equal(saga.state.phase, COMBAT_STATES.SURGE_SPENDING);

    saga.resolve({ damageDealt: 1 });
    assert.equal(saga.state.phase, COMBAT_STATES.COMPLETED);
    assert.equal(saga.status, 'completed');
  });

  it('fromPendingCombat creates saga with correct phase', () => {
    const pending = { p1Ready: true, p2Ready: true, attackRoll: null, defenseRoll: null };
    const saga = CombatSaga.fromPendingCombat('game-1', pending);
    assert.equal(saga.state.phase, COMBAT_STATES.ROLLING);

    const pending2 = { p1Ready: false, p2Ready: false };
    const saga2 = CombatSaga.fromPendingCombat('game-1', pending2);
    assert.equal(saga2.state.phase, COMBAT_STATES.DECLARED);

    const pending3 = { p1Ready: true, p2Ready: true, attackRoll: [1], defenseRoll: [1], surgeRemaining: 2 };
    const saga3 = CombatSaga.fromPendingCombat('game-1', pending3);
    assert.equal(saga3.state.phase, COMBAT_STATES.SURGE_SPENDING);
  });

  it('getExpectedActions returns correct actions per phase', () => {
    const saga = new CombatSaga('c-1');
    assert.deepEqual(saga.getExpectedActions(), ['combat_gate']);

    saga.state.phase = COMBAT_STATES.ROLLING;
    assert.deepEqual(saga.getExpectedActions(), ['combat_roll']);

    saga.state.phase = COMBAT_STATES.REROLL_WINDOW;
    assert.deepEqual(saga.getExpectedActions(), ['combat_reroll', 'combat_skip_reroll']);

    saga.state.phase = COMBAT_STATES.SURGE_SPENDING;
    assert.deepEqual(saga.getExpectedActions(), ['combat_surge', 'combat_skip_surges']);

    saga.state.phase = COMBAT_STATES.COMPLETED;
    assert.deepEqual(saga.getExpectedActions(), []);
  });
});
