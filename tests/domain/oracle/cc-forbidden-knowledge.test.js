/**
 * Forbidden Knowledge (Taron Malicos) — start of activation: draw 1, then
 * discard 1+ Command cards from hand. For EACH card discarded, the activating
 * figure recovers 1 Damage, gains 1 movement point, and discards 1 HARMFUL
 * condition.
 *
 * Implemented as a re-entrant requiresChoice loop in resolveAbility: the first
 * call draws + opens the picker, each pick discards one card and applies the
 * per-card effects, and "Done" finalizes. alexanbv 2026-06-17.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { resolveAbility } from '../../../src/game/abilities.js';

const MSG = 'm-malicos';
const FK_DONE = '✓ Done discarding';

function fixture() {
  const game = {
    gameId: 'g1',
    dcActionsData: { [MSG]: { actions: 2 } },
    figurePositions: { 1: { 'Taron Malicos-1-0': 'A1' } },
    figureConditions: { 'Taron Malicos-1-0': ['Bleed'] },
    player1CcDeck: ['Drawn Card'],
    player1CcHand: ['Card X', 'Card Y'],
    player1CcDiscard: [],
  };
  const dcMessageMeta = new Map([[MSG, { gameId: 'g1', playerNum: 1, dcName: 'Taron Malicos', displayName: 'Taron Malicos' }]]);
  const dcHealthState = new Map([[MSG, [[3, 6]]]]); // one figure, 3/6 (damaged)
  return { game, dcMessageMeta, dcHealthState };
}

describe('Forbidden Knowledge — re-entrant discard loop', () => {
  it('first call draws 1 and opens the discard picker', () => {
    const { game, dcMessageMeta, dcHealthState } = fixture();
    const r = resolveAbility('Forbidden Knowledge', { game, playerNum: 1, dcMessageMeta, dcHealthState });
    assert.equal(r.requiresChoice, true, 'opens a choice');
    assert.deepEqual(game.player1CcDeck, [], 'deck drained by the draw');
    assert.ok(game.player1CcHand.includes('Drawn Card'), 'drawn card is in hand');
    assert.deepEqual(r.choiceOptions.slice().sort(), ['Card X', 'Card Y', 'Drawn Card'], 'picker lists the hand');
    assert.ok(!r.choiceOptions.includes(FK_DONE), 'no Done before any discard (must discard 1+)');
    assert.ok(game.pendingForbiddenKnowledge, 'tracks progress');
  });

  it('each discard recovers 1 Damage, grants MP, removes a HARMFUL condition, and re-prompts with Done', () => {
    const { game, dcMessageMeta, dcHealthState } = fixture();
    resolveAbility('Forbidden Knowledge', { game, playerNum: 1, dcMessageMeta, dcHealthState });
    const r2 = resolveAbility('Forbidden Knowledge', { game, playerNum: 1, dcMessageMeta, dcHealthState, chosenOption: 'Card X' });
    assert.equal(r2.requiresChoice, true);
    assert.ok(r2.choiceOptions.includes(FK_DONE), 'Done offered after the first discard');
    assert.ok(game.player1CcDiscard.includes('Card X'), 'discarded card goes to the discard pile');
    assert.ok(!game.player1CcHand.includes('Card X'), 'discarded card leaves hand');
    assert.deepEqual(dcHealthState.get(MSG), [[4, 6]], 'recovered 1 Damage');
    assert.ok(!(game.figureConditions['Taron Malicos-1-0'] || []).includes('Bleed'), 'discarded the Bleed condition');
    assert.equal(game.pendingForbiddenKnowledge.discarded, 1, 'counted 1 discard');
  });

  it('Done finalizes and reports the total', () => {
    const { game, dcMessageMeta, dcHealthState } = fixture();
    resolveAbility('Forbidden Knowledge', { game, playerNum: 1, dcMessageMeta, dcHealthState });
    resolveAbility('Forbidden Knowledge', { game, playerNum: 1, dcMessageMeta, dcHealthState, chosenOption: 'Card X' });
    const done = resolveAbility('Forbidden Knowledge', { game, playerNum: 1, dcMessageMeta, dcHealthState, chosenOption: FK_DONE });
    assert.equal(done.applied, true);
    assert.match(done.logMessage, /discarded \*\*1\*\*/);
    assert.ok(!game.pendingForbiddenKnowledge, 'pending state cleared');
  });

  it('falls back to manual when no activation is in progress', () => {
    const game = { gameId: 'g1' };
    const r = resolveAbility('Forbidden Knowledge', { game, playerNum: 1, dcMessageMeta: new Map() });
    assert.equal(r.applied, false);
    assert.ok(r.manualMessage, 'manual fallback');
  });
});
