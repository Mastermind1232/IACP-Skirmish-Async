import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { movementReducerHandlers } from '../../../src/domain/reducer/movement-reducer.js';

describe('Movement Reducer', () => {
  it('movement start → move 3 spaces → complete', () => {
    let state = { figurePositions: { 1: { 'Trooper-0-0': 'A1' } }, moveInProgress: {} };

    state = movementReducerHandlers.MovementStarted(state, {
      figureKey: 'Trooper-0-0', movementPoints: 4, startCoord: 'A1',
    });
    assert.equal(state.moveInProgress['Trooper-0-0'].remaining, 4);

    state = movementReducerHandlers.FigureMoved(state, {
      figureKey: 'Trooper-0-0', fromCoord: 'A1', toCoord: 'A2', playerNum: 1, mpCost: 1,
    });
    assert.equal(state.figurePositions[1]['Trooper-0-0'], 'A2');
    assert.equal(state.moveInProgress['Trooper-0-0'].remaining, 3);

    state = movementReducerHandlers.FigureMoved(state, {
      figureKey: 'Trooper-0-0', fromCoord: 'A2', toCoord: 'B2', playerNum: 1, mpCost: 1,
    });
    assert.equal(state.moveInProgress['Trooper-0-0'].remaining, 2);

    state = movementReducerHandlers.FigureMoved(state, {
      figureKey: 'Trooper-0-0', fromCoord: 'B2', toCoord: 'B3', playerNum: 1, mpCost: 1,
    });
    assert.equal(state.figurePositions[1]['Trooper-0-0'], 'B3');
    assert.equal(state.moveInProgress['Trooper-0-0'].remaining, 1);

    state = movementReducerHandlers.MovementCompleted(state, { figureKey: 'Trooper-0-0' });
    assert.equal(state.moveInProgress['Trooper-0-0'], undefined);
  });

  it('movement cancel reverts position', () => {
    let state = {
      figurePositions: { 1: { 'Trooper-0-0': 'B2' } },
      moveInProgress: { 'Trooper-0-0': { remaining: 2 } },
    };
    state = movementReducerHandlers.MovementCancelled(state, {
      figureKey: 'Trooper-0-0', originalCoord: 'A1', playerNum: 1,
    });
    assert.equal(state.figurePositions[1]['Trooper-0-0'], 'A1');
    assert.equal(state.moveInProgress['Trooper-0-0'], undefined);
  });

  it('FigurePushed updates position without MP cost', () => {
    let state = {
      figurePositions: { 2: { 'Guard-0-0': 'C3' } },
      moveInProgress: {},
    };
    state = movementReducerHandlers.FigurePushed(state, {
      figureKey: 'Guard-0-0', fromCoord: 'C3', toCoord: 'C4', playerNum: 2,
    });
    assert.equal(state.figurePositions[2]['Guard-0-0'], 'C4');
  });
});
