/**
 * Eye on the Prize (Scum CC) — at the start of a round, each friendly figure
 * carrying or controlling a crate or mission token may recover 1 Damage, gain 1
 * Block Token, or discard 1 HARMFUL condition.
 *
 * Per-figure interactive via the requiresChoice loop. The token is a BLOCK
 * token, not a generic Power Token: the card prints the Block face rather than
 * the choose-a-face badge, so the player gets no type choice (12.0 Playtest
 * image; audit 2026-08-21). The enumeration (carrying = figureContraband;
 * controlling = on/adjacent to a controlled crate or mission token) lives in
 * board-helpers. alexanbv 2026-06-17.
 *
 * These tests exercise the carrying path (no map-control dependency) and the
 * per-figure loop, plus the Block-token grant.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { resolveAbility } from '../../../src/game/abilities.js';
import { eyesOnThePrizeEligibleFigures } from '../../../src/game/board-helpers.js';

function fixture() {
  return {
    gameId: 'g1',
    selectedMap: { id: 'no-such-map' }, // unknown map → no crate/mission tokens; only carrying counts
    figurePositions: { 1: { 'Jawa-1-0': 'A1', 'Jawa-1-1': 'B1' } },
    figureContraband: { 'Jawa-1-0': 1 },
    figureConditions: { 'Jawa-1-0': ['Bleed'] },
  };
}

describe('Eye on the Prize — enumeration (carrying)', () => {
  it('lists figures carrying a crate/contraband', () => {
    const figs = eyesOnThePrizeEligibleFigures(fixture(), 1, 'no-such-map');
    assert.deepEqual(figs, ['Jawa-1-0']);
  });
  it('ignores a carry flag for a figure not on the board', () => {
    const game = fixture();
    game.figureContraband = { 'Ghost-1-0': 1 }; // no position
    assert.deepEqual(eyesOnThePrizeEligibleFigures(game, 1, 'no-such-map'), []);
  });
});

describe('Eye on the Prize — per-figure loop', () => {
  it('opens a 3-way (+skip) choice for the first eligible figure', () => {
    const game = fixture();
    const r = resolveAbility('Eye on the Prize', { game, playerNum: 1 });
    assert.equal(r.requiresChoice, true);
    assert.deepEqual(r.choiceValues, ['recover', 'powertoken', 'condition', 'skip']);
    assert.equal(r.choiceOptions.length, 4);
    assert.ok(game.pendingEyesOnThePrize, 'tracks the cursor');
  });

  it('discards a HARMFUL condition when chosen, then finalizes', () => {
    const game = fixture();
    resolveAbility('Eye on the Prize', { game, playerNum: 1 });
    const done = resolveAbility('Eye on the Prize', { game, playerNum: 1, chosenFigureKey: 'condition' });
    assert.equal(done.applied, true);
    assert.ok(!(game.figureConditions['Jawa-1-0'] || []).includes('Bleed'), 'Bleed discarded');
    assert.ok(!game.pendingEyesOnThePrize, 'cursor cleared');
  });

  it('grants a Block token outright, with no type choice', () => {
    const game = fixture();
    resolveAbility('Eye on the Prize', { game, playerNum: 1 });
    const done = resolveAbility('Eye on the Prize', { game, playerNum: 1, chosenFigureKey: 'powertoken' });
    assert.equal(done.applied, true);
    assert.equal(done.requiresPowerTokenChoice, undefined, 'the card prints Block, so no face is chosen');
    assert.equal(game.pendingPowerTokenGrant, undefined, 'no pending type picker');
    assert.deepEqual(game.figurePowerTokens['Jawa-1-0'], ['Block']);
  });

  it('offers the Block token by name in the per-figure prompt', () => {
    const game = fixture();
    const r = resolveAbility('Eye on the Prize', { game, playerNum: 1 });
    assert.ok(r.choiceOptions.some((o) => /Gain 1 Block Token/.test(o)),
      `expected a Block Token option, got ${JSON.stringify(r.choiceOptions)}`);
    assert.ok(!r.choiceOptions.some((o) => /Power Token/.test(o)),
      'the generic Power Token wording must not survive');
  });

  it('skip applies nothing', () => {
    const game = fixture();
    resolveAbility('Eye on the Prize', { game, playerNum: 1 });
    const done = resolveAbility('Eye on the Prize', { game, playerNum: 1, chosenFigureKey: 'skip' });
    assert.equal(done.applied, true);
    assert.deepEqual(game.figureConditions['Jawa-1-0'], ['Bleed'], 'condition untouched');
    assert.equal(game.pendingPowerTokenGrant, undefined);
  });

  it('reports when no figure qualifies', () => {
    const game = fixture();
    game.figureContraband = {};
    const r = resolveAbility('Eye on the Prize', { game, playerNum: 1 });
    assert.equal(r.applied, true);
    assert.match(r.logMessage, /no friendly figures/);
  });
});
