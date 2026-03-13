import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { figureReducerHandlers } from '../../../src/domain/reducer/figure-reducer.js';

describe('Figure Reducer', () => {
  it('deploy → damage → condition → defeat lifecycle', () => {
    let state = {
      figurePositions: {},
      dcHealthState: {},
      depletedFigures: [],
      player1VP: { total: 0, kills: 0, objectives: 0 },
      player2VP: { total: 0, kills: 0, objectives: 0 },
    };

    state = figureReducerHandlers.FigureDeployed(state, {
      figureKey: 'Trooper-0-0', dcName: 'Stormtrooper', playerNum: 1, coord: 'A1',
    });
    assert.equal(state.figurePositions[1]['Trooper-0-0'], 'A1');

    state.dcHealthState['Trooper-0-0'] = 3;
    state = figureReducerHandlers.FigureDamaged(state, { figureKey: 'Trooper-0-0', amount: 2 });
    assert.equal(state.dcHealthState['Trooper-0-0'], 1);

    state = figureReducerHandlers.ConditionApplied(state, {
      figureKey: 'Trooper-0-0', condition: 'Stun',
    });
    assert.deepEqual(state.figureConditions['Trooper-0-0'], ['Stun']);

    state = figureReducerHandlers.FigureDefeated(state, {
      figureKey: 'Trooper-0-0', dcName: 'Stormtrooper', playerNum: 1, vpValue: 2,
    });
    assert.equal(state.figurePositions[1]['Trooper-0-0'], undefined);
    assert.ok(state.depletedFigures.includes('Trooper-0-0'));
    assert.equal(state.player2VP.kills, 2);
    assert.equal(state.player2VP.total, 2);
  });

  it('heal respects max HP', () => {
    let state = { dcHealthState: { 'fig-0-0': 2 } };
    state = figureReducerHandlers.FigureHealed(state, { figureKey: 'fig-0-0', amount: 5, maxHp: 4 });
    assert.equal(state.dcHealthState['fig-0-0'], 4);
  });

  it('damage does not go below 0', () => {
    let state = { dcHealthState: { 'fig-0-0': 1 } };
    state = figureReducerHandlers.FigureDamaged(state, { figureKey: 'fig-0-0', amount: 5 });
    assert.equal(state.dcHealthState['fig-0-0'], 0);
  });

  it('power token gain/spend lifecycle', () => {
    let state = { figurePowerTokens: {} };

    state = figureReducerHandlers.PowerTokenGained(state, { figureKey: 'fig-0-0', tokenType: 'Hit' });
    state = figureReducerHandlers.PowerTokenGained(state, { figureKey: 'fig-0-0', tokenType: 'Block' });
    assert.deepEqual(state.figurePowerTokens['fig-0-0'], ['Hit', 'Block']);

    state = figureReducerHandlers.PowerTokenSpent(state, { figureKey: 'fig-0-0', tokenType: 'Hit' });
    assert.deepEqual(state.figurePowerTokens['fig-0-0'], ['Block']);
  });

  it('condition applied is idempotent', () => {
    let state = { figureConditions: { 'fig-0-0': ['Focus'] } };
    state = figureReducerHandlers.ConditionApplied(state, { figureKey: 'fig-0-0', condition: 'Focus' });
    assert.deepEqual(state.figureConditions['fig-0-0'], ['Focus']);
  });

  it('condition removed filters correctly', () => {
    let state = { figureConditions: { 'fig-0-0': ['Focus', 'Stun', 'Hidden'] } };
    state = figureReducerHandlers.ConditionRemoved(state, { figureKey: 'fig-0-0', condition: 'Stun' });
    assert.deepEqual(state.figureConditions['fig-0-0'], ['Focus', 'Hidden']);
  });

  it('multiple conditions on same figure', () => {
    let state = { figureConditions: {} };
    state = figureReducerHandlers.ConditionApplied(state, { figureKey: 'fig-0-0', condition: 'Focus' });
    state = figureReducerHandlers.ConditionApplied(state, { figureKey: 'fig-0-0', condition: 'Hidden' });
    state = figureReducerHandlers.ConditionApplied(state, { figureKey: 'fig-0-0', condition: 'Bleeding' });
    state = figureReducerHandlers.ConditionApplied(state, { figureKey: 'fig-0-0', condition: 'Stun' });
    assert.deepEqual(state.figureConditions['fig-0-0'], ['Focus', 'Hidden', 'Bleeding', 'Stun']);
  });

  it('condition removal leaves others intact', () => {
    let state = { figureConditions: { 'fig-0-0': ['Focus', 'Hidden', 'Bleeding', 'Stun'] } };
    state = figureReducerHandlers.ConditionRemoved(state, { figureKey: 'fig-0-0', condition: 'Hidden' });
    assert.deepEqual(state.figureConditions['fig-0-0'], ['Focus', 'Bleeding', 'Stun']);
  });

  it('power token grant/spend chain with Wild', () => {
    let state = { figurePowerTokens: {} };
    state = figureReducerHandlers.PowerTokenGained(state, { figureKey: 'fig-0-0', tokenType: 'Hit' });
    state = figureReducerHandlers.PowerTokenGained(state, { figureKey: 'fig-0-0', tokenType: 'Block' });
    state = figureReducerHandlers.PowerTokenGained(state, { figureKey: 'fig-0-0', tokenType: 'Wild' });
    assert.deepEqual(state.figurePowerTokens['fig-0-0'], ['Hit', 'Block', 'Wild']);

    state = figureReducerHandlers.PowerTokenSpent(state, { figureKey: 'fig-0-0', tokenType: 'Block' });
    assert.deepEqual(state.figurePowerTokens['fig-0-0'], ['Hit', 'Wild']);
  });
});
