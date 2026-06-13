import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { enumerateActivatorEoaDescriptors } from './eoa-orchestrator.js';

// Uses real card data (data/dc-effects.json) via getDcEffects().
function gameFor(dcName, displayName, selectedFigure = 0) {
  const msgId = 'm1';
  return {
    game: {
      dcMessageMeta: new Map([[msgId, { displayName, gameId: 'g', playerNum: 1, dcName }]]),
      dcActionsData: { [msgId]: { selectedFigure } },
      figurePositions: { 1: {} },
    },
    opts: { dcName, playerNum: 1, msgId },
  };
}

describe('enumerateActivatorEoaDescriptors — DC passive EoA abilities', () => {
  it('Baze Malbus -> Hold the Line', () => {
    const { game, opts } = gameFor('Baze Malbus', 'Baze Malbus');
    const keys = enumerateActivatorEoaDescriptors(game, opts).map((d) => d.subPromptKey);
    assert.ok(keys.includes('hold_the_line'));
  });

  it('Riot Trooper (Elite) -> Shield', () => {
    const { game, opts } = gameFor('Riot Trooper (Elite)', 'Riot Trooper (Elite) [Group 1]');
    const keys = enumerateActivatorEoaDescriptors(game, opts).map((d) => d.subPromptKey);
    assert.ok(keys.includes('shield'));
  });

  it('ISB Infiltrator (Elite) -> In The Shadows, keyed to the activating figure', () => {
    const { game, opts } = gameFor('ISB Infiltrator (Elite)', 'ISB Infiltrator (Elite) [Group 1]', 1);
    const descs = enumerateActivatorEoaDescriptors(game, opts);
    const its = descs.find((d) => d.subPromptKey === 'in_the_shadows');
    assert.ok(its, 'In The Shadows descriptor present');
    // per-figure: selected figure 1 -> self key ...-1-1
    assert.strictEqual(its.extras.selfFigureKey, 'ISB Infiltrator (Elite)-1-1');
  });

  it('ISB Infiltrator (Regular) -> NO In The Shadows (Elite-only hide)', () => {
    const { game, opts } = gameFor('ISB Infiltrator (Regular)', 'ISB Infiltrator (Regular) [Group 1]');
    const keys = enumerateActivatorEoaDescriptors(game, opts).map((d) => d.subPromptKey);
    assert.ok(!keys.includes('in_the_shadows'));
  });

  it('0-0-0 -> Unnerving (special-cased, not in passives)', () => {
    const { game, opts } = gameFor('0-0-0', '0-0-0');
    const keys = enumerateActivatorEoaDescriptors(game, opts).map((d) => d.subPromptKey);
    assert.ok(keys.includes('unnerving'));
  });

  it('a plain trooper -> no EoA descriptors', () => {
    const { game, opts } = gameFor('Stormtrooper', 'Stormtrooper [Group 1]');
    assert.deepStrictEqual(enumerateActivatorEoaDescriptors(game, opts), []);
  });
});
