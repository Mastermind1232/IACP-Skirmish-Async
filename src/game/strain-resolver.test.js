import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  resolveSingleStrainChoice,
  pazReturnAvailable,
  findUnderDuressDepleters,
  STRAIN_OPTIONS,
} from './strain-resolver.js';

function makeGame(overrides = {}) {
  return {
    player1CcDeck: [],
    player2CcDeck: [],
    player1CcDiscard: [],
    player2CcDiscard: [],
    gameBox: [],
    figurePositions: { 1: {}, 2: {} },
    ...overrides,
  };
}

test('resolveSingleStrainChoice TAKE_DAMAGE returns damageInflicted=1', () => {
  const g = makeGame();
  const r = resolveSingleStrainChoice(g, 1, STRAIN_OPTIONS.TAKE_DAMAGE);
  assert.equal(r.applied, true);
  assert.equal(r.damageInflicted, 1);
  assert.equal(r.deckDiscarded, 0);
  assert.equal(r.pazReturned, 0);
});

test('resolveSingleStrainChoice DISCARD_DECK_TOP moves 1 card from deck → discard', () => {
  const g = makeGame({ player1CcDeck: ['Cunning', 'Stand Firm', 'Tough Luck'] });
  const r = resolveSingleStrainChoice(g, 1, STRAIN_OPTIONS.DISCARD_DECK_TOP);
  assert.equal(r.applied, true);
  assert.equal(r.deckDiscarded, 1);
  assert.equal(r.damageInflicted, 0);
  assert.equal(g.player1CcDeck.length, 2);
  assert.equal(g.player1CcDiscard.length, 1);
  assert.equal(g.player1CcDiscard[0], 'Cunning');
});

test('resolveSingleStrainChoice DISCARD_DECK_TOP with cost mult 2 (Under Duress) discards 2', () => {
  const g = makeGame({ player1CcDeck: ['A', 'B', 'C'] });
  const r = resolveSingleStrainChoice(g, 1, STRAIN_OPTIONS.DISCARD_DECK_TOP, { costMultiplier: 2 });
  assert.equal(r.applied, true);
  assert.equal(r.deckDiscarded, 2);
  assert.equal(g.player1CcDeck.length, 1);
  assert.equal(g.player1CcDiscard.length, 2);
  assert.deepEqual(g.player1CcDiscard, ['A', 'B']);
});

test('resolveSingleStrainChoice DISCARD_DECK_TOP empty deck falls through to damage', () => {
  const g = makeGame({ player1CcDeck: [] });
  const r = resolveSingleStrainChoice(g, 1, STRAIN_OPTIONS.DISCARD_DECK_TOP);
  assert.equal(r.applied, true);
  assert.equal(r.damageInflicted, 1);
  assert.equal(r.deckDiscarded, 0);
  assert.equal(r.fellThroughTo, STRAIN_OPTIONS.TAKE_DAMAGE);
});

test('resolveSingleStrainChoice DISCARD_DECK_TOP with cost mult 2 + only 1 card → damage fallthrough', () => {
  const g = makeGame({ player1CcDeck: ['Solo'] });
  const r = resolveSingleStrainChoice(g, 1, STRAIN_OPTIONS.DISCARD_DECK_TOP, { costMultiplier: 2 });
  assert.equal(r.damageInflicted, 1);
  assert.equal(r.deckDiscarded, 0);
  assert.equal(g.player1CcDeck.length, 1, 'lone card stays — UD requires 2');
  assert.equal(r.fellThroughTo, STRAIN_OPTIONS.TAKE_DAMAGE);
});

test('resolveSingleStrainChoice PAZ_RETURN moves 1 card from discard → game box', () => {
  const g = makeGame({ player1CcDiscard: ['Distract', 'Cunning'] });
  const r = resolveSingleStrainChoice(g, 1, STRAIN_OPTIONS.PAZ_RETURN_FROM_DISCARD);
  assert.equal(r.applied, true);
  assert.equal(r.pazReturned, 1);
  assert.equal(g.player1CcDiscard.length, 1);
  assert.equal(g.gameBox.length, 1);
});

test('resolveSingleStrainChoice PAZ_RETURN with discardCardName picks specific card', () => {
  const g = makeGame({ player1CcDiscard: ['Distract', 'Cunning', 'Tough Luck'] });
  const r = resolveSingleStrainChoice(g, 1, STRAIN_OPTIONS.PAZ_RETURN_FROM_DISCARD, { discardCardName: 'Cunning' });
  assert.equal(r.pazReturned, 1);
  assert.equal(g.gameBox[0], 'Cunning');
  assert.deepEqual(g.player1CcDiscard, ['Distract', 'Tough Luck']);
});

test('resolveSingleStrainChoice PAZ_RETURN empty discard falls through to damage', () => {
  const g = makeGame({ player1CcDiscard: [] });
  const r = resolveSingleStrainChoice(g, 1, STRAIN_OPTIONS.PAZ_RETURN_FROM_DISCARD);
  assert.equal(r.damageInflicted, 1);
  assert.equal(r.pazReturned, 0);
  assert.equal(r.fellThroughTo, STRAIN_OPTIONS.TAKE_DAMAGE);
});

test('pazReturnAvailable: false for non-Paz figure', () => {
  const g = makeGame({ player1CcDiscard: ['x'] });
  assert.equal(pazReturnAvailable(g, 1, 'IG-11-1-0'), false);
});

test('pazReturnAvailable: true for Paz with non-empty discard', () => {
  const g = makeGame({ player1CcDiscard: ['x'] });
  assert.equal(pazReturnAvailable(g, 1, 'Paz Vizsla-1-0'), true);
});

test('pazReturnAvailable: false for Paz with empty discard', () => {
  const g = makeGame({ player1CcDiscard: [] });
  assert.equal(pazReturnAvailable(g, 1, 'Paz Vizsla-1-0'), false);
});

test('findUnderDuressDepleters: empty when opponent army has no UD', () => {
  const g = makeGame({
    p2DcList: [{ dcName: 'Stormtrooper' }, { dcName: 'IG-88' }],
    p2DcMessageIds: ['m1', 'm2'],
  });
  assert.deepEqual(findUnderDuressDepleters(g, 1), []);
});

test('findUnderDuressDepleters: empty if game has no army at all', () => {
  const g = makeGame();
  assert.deepEqual(findUnderDuressDepleters(g, 1), []);
});

test('findUnderDuressDepleters: returns msgIds where opponent has [Under Duress] in army + not depleted', () => {
  const g = makeGame({
    p2DcList: [{ dcName: 'Stormtrooper' }, { dcName: '[Under Duress]' }],
    p2DcMessageIds: ['m1', 'm2'],
    p2DepletedDcMessageIds: [],
  });
  const out = findUnderDuressDepleters(g, 1);
  assert.deepEqual(out, ['m2']);
});

test('findUnderDuressDepleters: skips already-depleted UD', () => {
  const g = makeGame({
    p2DcList: [{ dcName: '[Under Duress]' }],
    p2DcMessageIds: ['m1'],
    p2DepletedDcMessageIds: ['m1'],
  });
  assert.deepEqual(findUnderDuressDepleters(g, 1), []);
});

test('findUnderDuressDepleters: matches case-insensitively + with/without brackets', () => {
  const g = makeGame({
    p2DcList: [{ dcName: 'Under Duress' }],  // unbracketed alias
    p2DcMessageIds: ['m1'],
  });
  assert.deepEqual(findUnderDuressDepleters(g, 1), ['m1']);
});
