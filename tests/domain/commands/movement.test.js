import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import {
  handleStartMovement,
  handleMoveToSpace,
  handleCompleteMovement,
} from '../../../src/domain/commands/movement-commands.js';
import { createCommand } from '../../../src/domain/commands/index.js';
import { resetSeqCounter } from '../../../src/domain/events.js';

describe('Movement commands', () => {
  beforeEach(() => {
    resetSeqCounter('mov-1', 0);
  });

  it('full movement lifecycle: start → move ×3 → complete', () => {
    const state = { moveInProgress: true };

    // StartMovement
    const startCmd = createCommand('StartMovement', 'mov-1', 'user1', {
      figureKey: 'Trooper-0-0',
      movementPoints: 4,
    });
    const { events: startEvents, error: startErr } = handleStartMovement(state, startCmd);
    assert.equal(startErr, null);
    assert.equal(startEvents[0].type, 'MovementStarted');
    assert.equal(startEvents[0].payload.figureKey, 'Trooper-0-0');
    assert.equal(startEvents[0].payload.movementPoints, 4);

    // MoveToSpace ×3
    const coords = ['A2', 'A3', 'B3'];
    for (const coord of coords) {
      const moveCmd = createCommand('MoveToSpace', 'mov-1', 'user1', {
        figureKey: 'Trooper-0-0',
        toCoord: coord,
      });
      const { events, error } = handleMoveToSpace(state, moveCmd);
      assert.equal(error, null);
      assert.equal(events[0].type, 'FigureMoved');
      assert.equal(events[0].payload.toCoord, coord);
    }

    // CompleteMovement
    const completeCmd = createCommand('CompleteMovement', 'mov-1', 'user1', {
      figureKey: 'Trooper-0-0',
    });
    const { events: completeEvents, error: completeErr } = handleCompleteMovement(state, completeCmd);
    assert.equal(completeErr, null);
    assert.equal(completeEvents[0].type, 'MovementCompleted');
    assert.equal(completeEvents[0].payload.figureKey, 'Trooper-0-0');
  });

  it('StartMovement missing figureKey → error', () => {
    const cmd = createCommand('StartMovement', 'mov-1', 'user1', {});
    const { error } = handleStartMovement({}, cmd);
    assert.equal(error, 'Missing figureKey');
  });

  it('MoveToSpace missing toCoord → error', () => {
    const cmd = createCommand('MoveToSpace', 'mov-1', 'user1', {});
    const { error } = handleMoveToSpace({}, cmd);
    assert.equal(error, 'No movement session active');
  });

  it('MoveToSpace rejects when no movement session', () => {
    const cmd = createCommand('MoveToSpace', 'mov-1', 'user1', { toCoord: 'B3' });
    const { error } = handleMoveToSpace({}, cmd);
    assert.equal(error, 'No movement session active');
  });
});
