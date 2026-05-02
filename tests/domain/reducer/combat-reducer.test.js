import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { combatReducerHandlers } from '../../../src/domain/reducer/combat-reducer.js';

describe('Combat Reducer', () => {
  it('full combat lifecycle: Declared → Ready ×2 → Rolled → Surge → Resolved', () => {
    let state = {};

    state = combatReducerHandlers.CombatDeclared(state, {
      attackerMsgId: 'msg1', defenderMsgId: 'msg2',
      attackerPlayerNum: 1, defenderPlayerNum: 2,
      attackDice: ['green', 'yellow'], defenseDice: ['black'],
    });
    assert.ok(state.pendingCombat);
    assert.equal(state.pendingCombat.attackerMsgId, 'msg1');
    assert.equal(state.pendingCombat.p1Ready, false);

    state = combatReducerHandlers.CombatPlayerReady(state, { playerNum: 1 });
    assert.equal(state.pendingCombat.p1Ready, true);

    state = combatReducerHandlers.CombatPlayerReady(state, { playerNum: 2 });
    assert.equal(state.pendingCombat.p2Ready, true);

    state = combatReducerHandlers.CombatDiceRolled(state, {
      side: 'attack', dice: [{ color: 'green', face: { dmg: 1, surge: 1 } }],
    });
    assert.ok(state.pendingCombat.attackRoll);

    state = combatReducerHandlers.CombatDiceRolled(state, {
      side: 'defense', dice: [{ color: 'black', face: { block: 1 } }],
    });
    assert.ok(state.pendingCombat.defenseRoll);

    state.pendingCombat.surgeRemaining = 2;
    state = combatReducerHandlers.CombatSurgeSpent(state, { surgeKey: 'pierce1', cost: 1 });
    assert.equal(state.pendingCombat.surgeRemaining, 1);
    assert.deepEqual(state.pendingCombat.surgesSpent, ['pierce1']);

    state = combatReducerHandlers.CombatResolved(state, { damageDealt: 2, defeated: false });
    assert.equal(state.pendingCombat, undefined);
  });

  it('CombatCancelled deletes pendingCombat', () => {
    let state = { pendingCombat: { attackerMsgId: 'msg1' } };
    state = combatReducerHandlers.CombatCancelled(state);
    assert.equal(state.pendingCombat, undefined);
  });

  it('CombatRerollPerformed mutates die face', () => {
    let state = {
      pendingCombat: {
        attackRoll: [{ color: 'green', face: { dmg: 1 } }, { color: 'yellow', face: { dmg: 0 } }],
      },
    };
    state = combatReducerHandlers.CombatRerollPerformed(state, {
      side: 'attack', dieIndex: 1, newFace: { dmg: 2, surge: 1 },
    });
    assert.deepEqual(state.pendingCombat.attackRoll[1].face, { dmg: 2, surge: 1 });
    assert.deepEqual(state.pendingCombat.attackRoll[0].face, { dmg: 1 });
  });

  it('back-to-back combats: state clean between them', () => {
    let state = {};

    // First combat
    state = combatReducerHandlers.CombatDeclared(state, {
      attackerMsgId: 'msg1', defenderMsgId: 'msg2',
      attackerPlayerNum: 1, defenderPlayerNum: 2,
      attackDice: ['green'], defenseDice: ['black'],
    });
    assert.ok(state.pendingCombat);
    state = combatReducerHandlers.CombatResolved(state, { damageDealt: 2, defeated: false });
    assert.equal(state.pendingCombat, undefined);

    // Second combat
    state = combatReducerHandlers.CombatDeclared(state, {
      attackerMsgId: 'msg3', defenderMsgId: 'msg4',
      attackerPlayerNum: 2, defenderPlayerNum: 1,
      attackDice: ['blue'], defenseDice: ['white'],
    });
    assert.ok(state.pendingCombat);
    assert.equal(state.pendingCombat.attackerMsgId, 'msg3');
    assert.equal(state.pendingCombat.p1Ready, false);
  });
});
