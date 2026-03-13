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
