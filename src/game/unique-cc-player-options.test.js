import { test } from 'node:test';
import assert from 'node:assert/strict';

import { getUniqueCcPlayerOptions } from './unique-figure-ccs.js';
import { resolveAbility } from './abilities.js';

// Real DC facts used here:
//   Luke Skywalker   -> FORCE USER
//   Leia Organa      -> FORCE USER, LEADER, SPY
//   Mara Jade        -> FORCE USER, BRAWLER ; adaptive_skills + fast_learner
//   Dengar           -> HUNTER (NOT a Force User) ; "Payback" is Dengar-restricted
//   Director Krennic -> LEADER (NOT a Force User) ; "Deploy the Garrison!" Krennic-restricted
//
// Unique-figure CCs used:
//   "Son of Skywalker"   -> Luke (FORCE USER)
//   "Payback"            -> Dengar (NOT a Force User)
//   "Deploy the Garrison!"-> Director Krennic (NOT a Force User)

function baseGame() {
  return {
    gameId: 'g-uccp',
    figurePositions: { 1: {}, 2: {} },
    p1DcList: [], p2DcList: [],
    roundFigureAbilityUsed: {},
  };
}

function byFk(options) {
  const m = {};
  for (const o of options) m[o.figureKey] = o;
  return m;
}

// ── THE WORKED EXAMPLE (must work) ─────────────────────────────────────────
test('Luke+Leia+Mara, There is Another active, Son of Skywalker → 3 options', () => {
  const game = baseGame();
  game.figurePositions[1] = {
    'Luke Skywalker-1-0': 'a1',
    'Leia Organa-1-0': 'a2',
    'Mara Jade-1-0': 'a3',
  };
  game.thereIsAnotherActive = { 1: true };

  const opts = getUniqueCcPlayerOptions(game, 1, 'Son of Skywalker');
  assert.strictEqual(opts.length, 3, 'all three figures eligible');
  const m = byFk(opts);
  assert.deepEqual(
    { kind: m['Luke Skywalker-1-0'].kind, consume: m['Luke Skywalker-1-0'].consume },
    { kind: 'named', consume: 'none' }, 'Luke = named/none');
  assert.deepEqual(
    { kind: m['Leia Organa-1-0'].kind, consume: m['Leia Organa-1-0'].consume },
    { kind: 'there_is_another', consume: 'none' }, 'Leia = There is Another/none');
  assert.deepEqual(
    { kind: m['Mara Jade-1-0'].kind, consume: m['Mara Jade-1-0'].consume },
    { kind: 'fast_learner', consume: 'fast_learner' }, 'Mara = Fast Learner/consume FL');
});

// ── A New Hope (non-Force-User CC): deplete only for non-named army figure ──
test('A New Hope active, Payback (Dengar, non-Force-User): non-named figure = a_new_hope', () => {
  const game = baseGame();
  game.figurePositions[1] = {
    'Dengar-1-0': 'a1',        // named figure
    'Director Krennic-1-0': 'a2', // any army figure (not Force User, not named, not Mara)
  };
  // Simulate an un-depleted [A New Hope] in the army.
  game.p1DcList = [{ dcName: 'Dengar' }, { dcName: 'Director Krennic' }, { dcName: '[A New Hope]' }];
  game.p1DcMessageIds = ['m-dengar', 'm-krennic', 'm-anh'];
  // (aNewHopeAvailable checks msgIds + not depleted; no depletion set → available)

  const opts = getUniqueCcPlayerOptions(game, 1, 'Payback');
  const m = byFk(opts);
  assert.deepEqual(
    { kind: m['Dengar-1-0'].kind, consume: m['Dengar-1-0'].consume },
    { kind: 'named', consume: 'none' }, 'Dengar = named/none (NOT depleted)');
  assert.deepEqual(
    { kind: m['Director Krennic-1-0'].kind, consume: m['Director Krennic-1-0'].consume },
    { kind: 'a_new_hope', consume: 'a_new_hope' }, 'Krennic = a_new_hope/deplete');
});

// ── Precedence: TIA over A New Hope for a Force User ─────────────────────────
test('TIA + A New Hope both active: Force User chosen via TIA → no deplete', () => {
  const game = baseGame();
  game.figurePositions[1] = {
    'Luke Skywalker-1-0': 'a1', // named
    'Leia Organa-1-0': 'a2',    // Force User (TIA) — should NOT be a_new_hope
  };
  game.thereIsAnotherActive = { 1: true };
  game.p1DcList = [{ dcName: 'Luke Skywalker' }, { dcName: 'Leia Organa' }, { dcName: '[A New Hope]' }];
  game.p1DcMessageIds = ['m-luke', 'm-leia', 'm-anh'];

  const opts = getUniqueCcPlayerOptions(game, 1, 'Son of Skywalker');
  const m = byFk(opts);
  assert.strictEqual(m['Leia Organa-1-0'].kind, 'there_is_another', 'TIA wins over A New Hope');
  assert.strictEqual(m['Leia Organa-1-0'].consume, 'none', 'no deplete (TIA precedence)');
});

// ── Board presence: a defeated named figure is not offered ──────────────────
test('defeated named figure (off board) is not offered', () => {
  const game = baseGame();
  // Only Mara on the board; Luke defeated (no position).
  game.figurePositions[1] = { 'Mara Jade-1-0': 'a3' };
  const opts = getUniqueCcPlayerOptions(game, 1, 'Son of Skywalker');
  const m = byFk(opts);
  assert.ok(!m['Luke Skywalker-1-0'], 'defeated Luke not offered');
  // Mara still offered via Fast Learner.
  assert.strictEqual(m['Mara Jade-1-0']?.kind, 'fast_learner');
});

test('only the named figure on board → single named option', () => {
  const game = baseGame();
  game.figurePositions[1] = { 'Luke Skywalker-1-0': 'a1' };
  const opts = getUniqueCcPlayerOptions(game, 1, 'Son of Skywalker');
  assert.strictEqual(opts.length, 1);
  assert.strictEqual(opts[0].kind, 'named');
  assert.strictEqual(opts[0].consume, 'none');
});

test('Fast Learner already used: Mara not offered via FL (but TIA if applicable)', () => {
  const game = baseGame();
  game.figurePositions[1] = { 'Mara Jade-1-0': 'a3' };
  game.roundFigureAbilityUsed = { 'Mara Jade_fast_learner': true };
  // No TIA → Mara has no remaining qualification for a Luke CC.
  const opts = getUniqueCcPlayerOptions(game, 1, 'Son of Skywalker');
  assert.strictEqual(opts.length, 0, 'FL spent, no TIA → Mara ineligible');

  // With TIA active, Mara (a Force User) re-qualifies for free.
  game.thereIsAnotherActive = { 1: true };
  const opts2 = getUniqueCcPlayerOptions(game, 1, 'Son of Skywalker');
  assert.strictEqual(opts2.length, 1);
  assert.strictEqual(opts2[0].kind, 'there_is_another');
  assert.strictEqual(opts2[0].consume, 'none');
});

// ── Range anchor honors the chosen figure for each kind ─────────────────────
test('range anchor: ccPlayedByFigureKey flips Cavalry Charge anchor to chosen figure', () => {
  const game = {
    gameId: 'g-anchor', activeRoundModifiers: [],
    selectedMap: { id: 'mos-eisley-outskirts' },
    figurePositions: { 1: {
      'Mara Jade-1-0': 'r17',
      'Captain Terro-1-0': 'm17',
      'Gar Saxon-1-0': 'm18',
    } },
  };
  // Chosen = Mara (general field).
  game.ccPlayedByFigureKey = 'Mara Jade-1-0';
  const r = resolveAbility('Cavalry Charge', { game, playerNum: 1 });
  delete game.ccPlayedByFigureKey;
  assert.strictEqual(r.applied, true);
  const blockD = (game.activeRoundModifiers || []).find((m) => m.card === 'Cavalry Charge' && m.side === 'defense');
  assert.strictEqual(blockD.sourceFigureKey, 'Mara Jade-1-0', 'general ccPlayedByFigureKey honored');
});

test('range anchor: legacy ccPlayedByFastLearnerFigureKey still honored', () => {
  const game = {
    gameId: 'g-anchor2', activeRoundModifiers: [],
    selectedMap: { id: 'mos-eisley-outskirts' },
    figurePositions: { 1: {
      'Mara Jade-1-0': 'r17',
      'Captain Terro-1-0': 'm17',
    } },
  };
  game.ccPlayedByFastLearnerFigureKey = 'Mara Jade-1-0';
  const r = resolveAbility('Cavalry Charge', { game, playerNum: 1 });
  delete game.ccPlayedByFastLearnerFigureKey;
  assert.strictEqual(r.applied, true);
  const blockD = (game.activeRoundModifiers || []).find((m) => m.card === 'Cavalry Charge' && m.side === 'defense');
  assert.strictEqual(blockD.sourceFigureKey, 'Mara Jade-1-0', 'legacy alias honored');
});

test('non-unique-figure CC returns no options', () => {
  const game = baseGame();
  game.figurePositions[1] = { 'Luke Skywalker-1-0': 'a1' };
  assert.deepEqual(getUniqueCcPlayerOptions(game, 1, 'Brace'), []);
});
