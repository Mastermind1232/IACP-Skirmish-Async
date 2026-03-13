import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import {
  handleDeclareAttack,
  handleReadyForCombat,
  handleRollCombatDice,
  handleSpendSurge,
  handlePerformReroll,
} from '../../../src/domain/commands/combat-commands.js';
import { createCommand } from '../../../src/domain/commands/index.js';
import { resetSeqCounter } from '../../../src/domain/events.js';

describe('Combat commands', () => {
  beforeEach(() => {
    resetSeqCounter('cbt-1', 0);
  });

  it('full combat command lifecycle', () => {
    const state = { pendingCombat: null };

    // DeclareAttack
    const declareCmd = createCommand('DeclareAttack', 'cbt-1', 'user1', {
      attackerMsgId: 'atk-1',
      defenderMsgId: 'def-1',
      attackerPlayerNum: 1,
    });
    const { events: declareEvents, error: declareErr } = handleDeclareAttack(state, declareCmd);
    assert.equal(declareErr, null);
    assert.equal(declareEvents[0].type, 'CombatDeclared');
    assert.equal(declareEvents[0].payload.attackerMsgId, 'atk-1');

    // ReadyForCombat
    const readyCmd = createCommand('ReadyForCombat', 'cbt-1', 'user1', { playerNum: 1 });
    const { events: readyEvents } = handleReadyForCombat(state, readyCmd);
    assert.equal(readyEvents[0].type, 'CombatPlayerReady');

    // RollCombatDice
    const rollCmd = createCommand('RollCombatDice', 'cbt-1', 'user1', {
      side: 'attack',
      dice: [{ dmg: 2, surge: 1 }],
    });
    const { events: rollEvents } = handleRollCombatDice(state, rollCmd);
    assert.equal(rollEvents[0].type, 'CombatDiceRolled');
    assert.equal(rollEvents[0].payload.side, 'attack');

    // SpendSurge — state needs pendingCombat with surges
    state.pendingCombat = { surgeRemaining: 2 };
    const surgeCmd = createCommand('SpendSurge', 'cbt-1', 'user1', { surgeKey: 'pierce_2' });
    const { events: surgeEvents } = handleSpendSurge(state, surgeCmd);
    assert.equal(surgeEvents[0].type, 'CombatSurgeSpent');
    assert.equal(surgeEvents[0].payload.surgeKey, 'pierce_2');

    // PerformReroll
    const rerollCmd = createCommand('PerformReroll', 'cbt-1', 'user1', {
      side: 'attack',
      dieIndex: 0,
      newFace: { dmg: 3, surge: 0 },
    });
    const { events: rerollEvents } = handlePerformReroll(state, rerollCmd);
    assert.equal(rerollEvents[0].type, 'CombatRerollPerformed');
    assert.equal(rerollEvents[0].payload.dieIndex, 0);
  });

  it('DeclareAttack missing data → error', () => {
    const cmd = createCommand('DeclareAttack', 'cbt-1', 'user1', {});
    const { error } = handleDeclareAttack({}, cmd);
    assert.equal(error, 'Missing attacker or defender msgId');
  });

  it('SpendSurge missing surgeKey → error', () => {
    const cmd = createCommand('SpendSurge', 'cbt-1', 'user1', {});
    const { error } = handleSpendSurge({}, cmd);
    assert.equal(error, 'No active combat');
  });

  it('DeclareAttack rejects when combat active', () => {
    const state = { pendingCombat: { attackerMsgId: 'x' } };
    const cmd = createCommand('DeclareAttack', 'cbt-1', 'user1', {
      attackerMsgId: 'atk-1', defenderMsgId: 'def-1',
    });
    const { events, error } = handleDeclareAttack(state, cmd);
    assert.equal(error, 'Combat already in progress');
    assert.equal(events.length, 0);
  });

  it('DeclareAttack emits when no combat active', () => {
    const cmd = createCommand('DeclareAttack', 'cbt-1', 'user1', {
      attackerMsgId: 'atk-1', defenderMsgId: 'def-1', attackerPlayerNum: 1,
    });
    const { events, error } = handleDeclareAttack({}, cmd);
    assert.equal(error, null);
    assert.equal(events[0].type, 'CombatDeclared');
  });

  it('SpendSurge rejects when no combat', () => {
    const cmd = createCommand('SpendSurge', 'cbt-1', 'user1', { surgeKey: 'pierce_2' });
    const { error } = handleSpendSurge({}, cmd);
    assert.equal(error, 'No active combat');
  });

  it('SpendSurge rejects when no surges remaining', () => {
    const state = { pendingCombat: { surgeRemaining: 0 } };
    const cmd = createCommand('SpendSurge', 'cbt-1', 'user1', { surgeKey: 'pierce_2' });
    const { error } = handleSpendSurge(state, cmd);
    assert.equal(error, 'No surges remaining');
  });

  it('PerformReroll rejects when no combat', () => {
    const cmd = createCommand('PerformReroll', 'cbt-1', 'user1', { side: 'attack', dieIndex: 0 });
    const { error } = handlePerformReroll({}, cmd);
    assert.equal(error, 'No active combat');
  });
});
