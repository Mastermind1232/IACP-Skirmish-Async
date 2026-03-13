import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { translateDiffToEvents } from '../../src/domain/diff-translator.js';
import { resetSeqCounter } from '../../src/domain/events.js';

function makeContext(before, after) {
  return { gameId: 'game-1', playerId: 'p1', before, after, correlationId: 'test' };
}

describe('DiffTranslator', () => {
  beforeEach(() => {
    resetSeqCounter('game-1', 0);
  });

  it('returns empty array for null diff', () => {
    const events = translateDiffToEvents('some_handler_', null, makeContext({}, {}));
    assert.deepEqual(events, []);
  });

  it('phase change → phase event (MapSelected)', () => {
    const before = { phase: 'map_selection' };
    const after = { phase: 'initiative', selectedMap: 'mos-eisley' };
    const diff = { set: { phase: 'initiative', selectedMap: 'mos-eisley' }, deleted: [] };
    const events = translateDiffToEvents('map_confirm_', diff, makeContext(before, after));
    assert.ok(events.some(e => e.type === 'MapSelected'));
  });

  it('phase change → GameEnded', () => {
    const before = { phase: 'round_active' };
    const after = { phase: 'ended', winnerId: 'p1' };
    const diff = { set: { phase: 'ended', winnerId: 'p1' }, deleted: [] };
    const events = translateDiffToEvents('game_end_', diff, makeContext(before, after));
    assert.ok(events.some(e => e.type === 'GameEnded'));
    assert.equal(events.find(e => e.type === 'GameEnded').payload.winnerId, 'p1');
  });

  it('pendingCombat created → CombatDeclared', () => {
    const before = {};
    const after = { pendingCombat: { attackerMsgId: 'msg1', defenderMsgId: 'msg2', attackerPlayerNum: 1 } };
    const diff = { set: { pendingCombat: after.pendingCombat }, deleted: [] };
    const events = translateDiffToEvents('attack_target_', diff, makeContext(before, after));
    assert.ok(events.some(e => e.type === 'CombatDeclared'));
  });

  it('pendingCombat deleted → CombatResolved', () => {
    const before = { pendingCombat: { attackerMsgId: 'msg1' } };
    const after = {};
    const diff = { set: {}, deleted: ['pendingCombat'] };
    const events = translateDiffToEvents('combat_resolve_', diff, makeContext(before, after));
    assert.ok(events.some(e => e.type === 'CombatResolved'));
  });

  it('figurePositions changed → FigureMoved', () => {
    const before = { figurePositions: { 1: { 'Trooper-0-0': 'A1' } } };
    const after = { figurePositions: { 1: { 'Trooper-0-0': 'B1' } } };
    const diff = { set: { figurePositions: after.figurePositions }, deleted: [] };
    const events = translateDiffToEvents('move_pick_', diff, makeContext(before, after));
    const moveEvent = events.find(e => e.type === 'FigureMoved');
    assert.ok(moveEvent);
    assert.equal(moveEvent.payload.fromCoord, 'A1');
    assert.equal(moveEvent.payload.toCoord, 'B1');
  });

  it('VP increase → VpAwarded', () => {
    const before = { player1VP: { total: 3, kills: 2, objectives: 1 } };
    const after = { player1VP: { total: 5, kills: 4, objectives: 1 } };
    const diff = { set: { player1VP: after.player1VP }, deleted: [] };
    const events = translateDiffToEvents('combat_resolve_', diff, makeContext(before, after));
    assert.ok(events.some(e => e.type === 'VpAwarded'));
    assert.equal(events.find(e => e.type === 'VpAwarded').payload.amount, 2);
  });

  it('figure removed from positions → FigureDefeated', () => {
    const before = { figurePositions: { 2: { 'Rebel-0-0': 'C3', 'Rebel-0-1': 'C4' } } };
    const after = { figurePositions: { 2: { 'Rebel-0-1': 'C4' } } };
    const diff = { set: { figurePositions: after.figurePositions }, deleted: [] };
    const events = translateDiffToEvents('combat_resolve_', diff, makeContext(before, after));
    assert.ok(events.some(e => e.type === 'FigureDefeated'));
    assert.equal(events.find(e => e.type === 'FigureDefeated').payload.figureKey, 'Rebel-0-0');
  });

  it('condition added → ConditionApplied', () => {
    const before = { figureConditions: { 'fig-0-0': ['Focus'] } };
    const after = { figureConditions: { 'fig-0-0': ['Focus', 'Stun'] } };
    const diff = { set: { figureConditions: after.figureConditions }, deleted: [] };
    const events = translateDiffToEvents('combat_resolve_', diff, makeContext(before, after));
    assert.ok(events.some(e => e.type === 'ConditionApplied'));
    assert.equal(events.find(e => e.type === 'ConditionApplied').payload.condition, 'Stun');
  });

  it('dcHealthState decrease → FigureDamaged', () => {
    const before = { dcHealthState: { 'Trooper-0-0': 5, 'Trooper-0-1': 3 } };
    const after = { dcHealthState: { 'Trooper-0-0': 2, 'Trooper-0-1': 3 } };
    const diff = { set: { dcHealthState: after.dcHealthState }, deleted: [] };
    const events = translateDiffToEvents('combat_resolve_', diff, makeContext(before, after));
    const dmgEvent = events.find(e => e.type === 'FigureDamaged');
    assert.ok(dmgEvent);
    assert.equal(dmgEvent.payload.figureKey, 'Trooper-0-0');
    assert.equal(dmgEvent.payload.amount, 3);
  });

  it('dcHealthState increase → FigureHealed', () => {
    const before = { dcHealthState: { 'Medic-0-0': 2 } };
    const after = { dcHealthState: { 'Medic-0-0': 5 } };
    const diff = { set: { dcHealthState: after.dcHealthState }, deleted: [] };
    const events = translateDiffToEvents('heal_', diff, makeContext(before, after));
    const healEvent = events.find(e => e.type === 'FigureHealed');
    assert.ok(healEvent);
    assert.equal(healEvent.payload.figureKey, 'Medic-0-0');
    assert.equal(healEvent.payload.amount, 3);
  });

  it('figurePowerTokens addition → PowerTokenGained', () => {
    const before = { figurePowerTokens: { 'fig-0-0': ['Hit'] } };
    const after = { figurePowerTokens: { 'fig-0-0': ['Hit', 'Block'] } };
    const diff = { set: { figurePowerTokens: after.figurePowerTokens }, deleted: [] };
    const events = translateDiffToEvents('token_', diff, makeContext(before, after));
    const tokenEvent = events.find(e => e.type === 'PowerTokenGained');
    assert.ok(tokenEvent);
    assert.equal(tokenEvent.payload.figureKey, 'fig-0-0');
    assert.equal(tokenEvent.payload.tokenType, 'Block');
  });

  it('figurePowerTokens removal → PowerTokenSpent', () => {
    const before = { figurePowerTokens: { 'fig-0-0': ['Hit', 'Block'] } };
    const after = { figurePowerTokens: { 'fig-0-0': ['Block'] } };
    const diff = { set: { figurePowerTokens: after.figurePowerTokens }, deleted: [] };
    const events = translateDiffToEvents('combat_token_', diff, makeContext(before, after));
    const tokenEvent = events.find(e => e.type === 'PowerTokenSpent');
    assert.ok(tokenEvent);
    assert.equal(tokenEvent.payload.figureKey, 'fig-0-0');
    assert.equal(tokenEvent.payload.tokenType, 'Hit');
  });

  it('currentRound change → RoundStarted', () => {
    const before = { currentRound: 2 };
    const after = { currentRound: 3 };
    const diff = { set: { currentRound: 3 }, deleted: [] };
    const events = translateDiffToEvents('round_', diff, makeContext(before, after));
    const roundEvent = events.find(e => e.type === 'RoundStarted');
    assert.ok(roundEvent);
    assert.equal(roundEvent.payload.roundNumber, 3);
  });

  it('new dcActionsData entry → DcActivated', () => {
    const before = { dcActionsData: {} };
    const after = { dcActionsData: { msg123: { remaining: 2, total: 2 } } };
    const diff = { set: { dcActionsData: after.dcActionsData }, deleted: [] };
    const events = translateDiffToEvents('dc_activate_', diff, makeContext(before, after));
    const actEvent = events.find(e => e.type === 'DcActivated');
    assert.ok(actEvent);
    assert.equal(actEvent.payload.msgId, 'msg123');
    assert.equal(actEvent.payload.totalActions, 2);
  });

  it('dcActionsData no prior state → DcActivated', () => {
    const before = {};
    const after = { dcActionsData: { msg456: { remaining: 2, total: 2 } } };
    const diff = { set: { dcActionsData: after.dcActionsData }, deleted: [] };
    const events = translateDiffToEvents('dc_activate_', diff, makeContext(before, after));
    const actEvent = events.find(e => e.type === 'DcActivated');
    assert.ok(actEvent);
    assert.equal(actEvent.payload.msgId, 'msg456');
  });

  it('condition removed → ConditionRemoved', () => {
    const before = { figureConditions: { 'fig-0-0': ['Focus', 'Stun'] } };
    const after = { figureConditions: { 'fig-0-0': ['Stun'] } };
    const diff = { set: { figureConditions: after.figureConditions }, deleted: [] };
    const events = translateDiffToEvents('combat_resolve_', diff, makeContext(before, after));
    const removeEvent = events.find(e => e.type === 'ConditionRemoved');
    assert.ok(removeEvent);
    assert.equal(removeEvent.payload.figureKey, 'fig-0-0');
    assert.equal(removeEvent.payload.condition, 'Focus');
  });

  it('dcActionsData remaining decreased → DcActionPerformed', () => {
    const before = { dcActionsData: { msg1: { remaining: 2, total: 2 } } };
    const after = { dcActionsData: { msg1: { remaining: 1, total: 2 } } };
    const diff = { set: { dcActionsData: after.dcActionsData }, deleted: [] };
    const events = translateDiffToEvents('dc_action_', diff, makeContext(before, after));
    const actionEvent = events.find(e => e.type === 'DcActionPerformed');
    assert.ok(actionEvent);
    assert.equal(actionEvent.payload.msgId, 'msg1');
    assert.equal(actionEvent.payload.actionCost, 1);
  });

  it('dcActionsData remaining → 0 → DcEndedActivation', () => {
    const before = { dcActionsData: { msg1: { remaining: 1, total: 2 } } };
    const after = { dcActionsData: { msg1: { remaining: 0, total: 2 } } };
    const diff = { set: { dcActionsData: after.dcActionsData }, deleted: [] };
    const events = translateDiffToEvents('dc_end_', diff, makeContext(before, after));
    assert.ok(events.some(e => e.type === 'DcEndedActivation'));
  });

  it('new figure in figurePositions → FigureDeployed (not FigureMoved)', () => {
    const before = { figurePositions: { 1: { 'Trooper-0-0': 'A1' } } };
    const after = { figurePositions: { 1: { 'Trooper-0-0': 'A1', 'Rebel-0-0': 'B2' } } };
    const diff = { set: { figurePositions: after.figurePositions }, deleted: [] };
    const events = translateDiffToEvents('deploy_', diff, makeContext(before, after));
    assert.ok(events.some(e => e.type === 'FigureDeployed'));
    assert.ok(!events.some(e => e.type === 'FigureMoved' && e.payload.figureKey === 'Rebel-0-0'));
    const deployEvent = events.find(e => e.type === 'FigureDeployed');
    assert.equal(deployEvent.payload.figureKey, 'Rebel-0-0');
    assert.equal(deployEvent.payload.coord, 'B2');
    assert.equal(deployEvent.payload.playerNum, 1);
  });

  it('skipTypes prevents duplicate events', () => {
    const diff = {
      set: {
        pendingCombat: {
          attackerMsgId: 'msg1', defenderMsgId: 'msg2',
          attackerPlayerNum: 1,
        },
      },
      deleted: [],
    };
    const context = {
      gameId: 'g1', playerId: 'p1',
      before: {},
      after: { pendingCombat: diff.set.pendingCombat },
    };

    // Without skipTypes: CombatDeclared emitted
    const events1 = translateDiffToEvents('attack_target_', diff, context);
    assert.ok(events1.some(e => e.type === 'CombatDeclared'));

    // With skipTypes: CombatDeclared skipped
    const events2 = translateDiffToEvents('attack_target_', diff, context, ['CombatDeclared']);
    assert.ok(!events2.some(e => e.type === 'CombatDeclared'));
  });

  it('phaseGate open → ready → cleared lifecycle', () => {
    // Open
    let before = {};
    let after = { phaseGate: { phase: 'start_of_round', p1Ready: false, p2Ready: false } };
    let diff = { set: { phaseGate: after.phaseGate }, deleted: [] };
    let events = translateDiffToEvents('round_', diff, makeContext(before, after));
    assert.ok(events.some(e => e.type === 'PhaseGateOpened'));

    // P1 ready
    before = { phaseGate: { phase: 'start_of_round', p1Ready: false, p2Ready: false } };
    after = { phaseGate: { phase: 'start_of_round', p1Ready: true, p2Ready: false } };
    diff = { set: { phaseGate: after.phaseGate }, deleted: [] };
    events = translateDiffToEvents('phase_gate_ready_', diff, makeContext(before, after));
    assert.ok(events.some(e => e.type === 'PhaseGatePlayerReady' && e.payload.playerNum === 1));

    // Cleared
    before = { phaseGate: { phase: 'start_of_round', p1Ready: true, p2Ready: true } };
    after = {};
    diff = { set: {}, deleted: ['phaseGate'] };
    events = translateDiffToEvents('phase_gate_ready_', diff, makeContext(before, after));
    assert.ok(events.some(e => e.type === 'PhaseGateCleared'));
  });
});
