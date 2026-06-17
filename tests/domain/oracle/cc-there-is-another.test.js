/**
 * There is Another (Leia CC) — a Force-User-only Fast Learner.
 *
 * Ruling (alexanbv 2026-06-17): "Normally Leia can't play Yoda's CC. This lets
 * Leia play a unique CC with other Force User names. For example, Leia could
 * play Son of Skywalker. This is a restricted version of Mara's Fast Learner."
 *
 * So while There is Another is active for a player this round, that player may
 * play a unique CC whose figure-name restriction names ANY Force User — even
 * one not fielded — provided the army contains a Force User. Trait restrictions
 * and non-Force-User figure restrictions are unaffected.
 *
 * The relaxation lives in isCcPlayLegalByRestriction (src/game/cc-timing.js);
 * the per-player round flag game.thereIsAnotherActive is set by the
 * setsThereIsAnother ccEffect handler and cleared at round start.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '../../..');

// A CC restricted to Luke (Son of Skywalker–style), Luke NOT in the army.
const fakeEffects = {
  'SonOfSkywalker': { playableBy: 'Luke Skywalker' },
  'HanOnly': { playableBy: 'Han Solo' }, // non-Force-User figure name
};
const fakeGetEffect = (name) => fakeEffects[name] || null;

describe('There is Another — Force-User-only Fast Learner relaxation', () => {
  it('blocks a Luke-restricted CC for a Leia-only army when inactive', async () => {
    const { isCcPlayLegalByRestriction } = await import(resolve(ROOT, 'src/game/cc-timing.js'));
    const game = { p1DcList: ['Leia Organa'] };
    const r = isCcPlayLegalByRestriction(game, 1, 'SonOfSkywalker', fakeGetEffect);
    assert.equal(r.legal, false, 'without There is Another, Leia cannot play Luke\'s CC');
  });

  it('allows a Luke-restricted CC for a Leia army while active (Luke not fielded)', async () => {
    const { isCcPlayLegalByRestriction } = await import(resolve(ROOT, 'src/game/cc-timing.js'));
    const game = { p1DcList: ['Leia Organa'], thereIsAnotherActive: { 1: true } };
    const r = isCcPlayLegalByRestriction(game, 1, 'SonOfSkywalker', fakeGetEffect);
    assert.equal(r.legal, true, 'There is Another lets Leia play a Force-User-named CC');
    assert.equal(r.thereIsAnother, true, 'legality is granted via the There is Another relaxation');
  });

  it('does NOT relax a non-Force-User figure restriction', async () => {
    const { isCcPlayLegalByRestriction } = await import(resolve(ROOT, 'src/game/cc-timing.js'));
    const game = { p1DcList: ['Leia Organa'], thereIsAnotherActive: { 1: true } };
    const r = isCcPlayLegalByRestriction(game, 1, 'HanOnly', fakeGetEffect);
    assert.equal(r.legal, false, 'Han Solo is not a Force User — There is Another does not apply');
  });

  it('does not apply to a player whose flag is unset', async () => {
    const { isCcPlayLegalByRestriction } = await import(resolve(ROOT, 'src/game/cc-timing.js'));
    const game = { p1DcList: ['Leia Organa'], p2DcList: ['Leia Organa'], thereIsAnotherActive: { 2: true } };
    const r = isCcPlayLegalByRestriction(game, 1, 'SonOfSkywalker', fakeGetEffect);
    assert.equal(r.legal, false, 'the flag is per-player — player 1 is unaffected by player 2\'s There is Another');
  });
});

describe('There is Another — setsThereIsAnother effect handler', () => {
  it('draws a card and sets the per-player round flag', async () => {
    const { resolveAbility } = await import(resolve(ROOT, 'src/game/abilities.js'));
    const game = {
      player1CcDeck: ['Card A', 'Card B'],
      player1CcHand: [],
    };
    const res = resolveAbility('There is Another', { game, playerNum: 1 });
    assert.equal(res.applied, true, 'handler applies');
    assert.ok(game.thereIsAnotherActive?.[1], 'sets thereIsAnotherActive for the player');
  });
});
