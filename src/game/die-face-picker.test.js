/**
 * Shared die-face picker + Rapid Recalibration's hand path.
 *
 * Rapid Recalibration reads "Choose 1 attack die and turn that die to any
 * side." It has two play paths:
 *
 *   gate  — offered in the attacker reroll window, resolved by
 *           `_makeDieTurnResolver` in handlers/combat.js. Always correct; it
 *           turns the die and shares its factory with Zeb / Lasat Honor Guard.
 *   hand  — played from the CC hand during an attack (cc-timing.js allows
 *           `duringAttack && isAttacker`), which routes through resolveAbility.
 *
 * The hand path was wired to `rerollOneAttackDie`, the shared RANDOM reroll
 * counter that Mitigate / Officer's Training / Sniper / Bespin Security / Much
 * to Learn / Professional feed. So the same card did two different things
 * depending on how it was played, and the hand path was strictly weaker than
 * printed. alexanbv 2026-08-31: "rapid recall is a picker".
 */
import { test, describe } from 'node:test';
import assert from 'node:assert';
import {
  faceOptionsFor, formatFaceLabel, encodeFace, decodeFace,
  applyFaceToDie, totalsFor,
} from './die-face-picker.js';
import { resolveAbility } from './abilities.js';

describe('die-face-picker helpers', () => {
  test('offers only faces the die really has', () => {
    const red = faceOptionsFor('attack', 'red');
    assert.ok(red.length > 0, 'red attack die has faces');
    // data/dice.json red is all damage, no accuracy.
    assert.ok(red.every((f) => (f.acc ?? 0) === 0), 'red has no accuracy faces');
    assert.ok(red.some((f) => f.dmg === 3), 'red has a 3-damage face');
    assert.ok(!red.some((f) => f.dmg === 9), 'no invented faces');
  });

  test('distinct faces, so duplicates are not offered twice', () => {
    const red = faceOptionsFor('attack', 'red');
    const keys = red.map((f) => `${f.acc}|${f.dmg}|${f.surge}`);
    assert.equal(new Set(keys).size, keys.length, 'every offered face is distinct');
  });

  test('white defense die keeps its Dodge face, black does not', () => {
    assert.ok(faceOptionsFor('defense', 'white').some((f) => f.dodge), 'white has Dodge');
    assert.ok(!faceOptionsFor('defense', 'black').some((f) => f.dodge), 'black has no Dodge');
  });

  test('unknown pool yields nothing rather than throwing', () => {
    assert.deepEqual(faceOptionsFor('nonsense', 'red'), []);
  });

  test('encode/decode round-trips both pools', () => {
    const atk = { acc: 0, dmg: 2, surge: 1 };
    assert.deepEqual(decodeFace('attack', encodeFace('attack', atk).split('_')), atk);
    const def = { block: 1, evade: 0, dodge: true };
    assert.deepEqual(decodeFace('defense', encodeFace('defense', def).split('_')), def);
  });

  test('applying a face drops faceIdx so nothing re-derives the old roll', () => {
    const die = { color: 'red', acc: 0, dmg: 1, surge: 0, faceIdx: 0 };
    const out = applyFaceToDie('attack', die, { acc: 0, dmg: 3, surge: 0 });
    assert.equal(out.dmg, 3);
    assert.equal(out.color, 'red', 'colour is preserved');
    assert.ok(!('faceIdx' in out), 'stale face index is removed');
    assert.equal(die.dmg, 1, 'the original die object is not mutated');
  });

  test('a chosen Dodge face becomes +2 Block / +1 Evade', () => {
    const out = applyFaceToDie('defense', { color: 'white' }, { block: 0, evade: 0, dodge: true });
    assert.equal(out.block, 2);
    assert.equal(out.evade, 1);
    assert.equal(out.dodge, false, 'no dodge flag survives');
  });

  test('totals re-add correctly for both pools', () => {
    assert.deepEqual(
      totalsFor('attack', [{ acc: 1, dmg: 2, surge: 0 }, { acc: 0, dmg: 3, surge: 1 }]),
      { acc: 1, dmg: 5, surge: 1 },
    );
    assert.deepEqual(
      totalsFor('defense', [{ block: 1, evade: 1 }, { block: 2, evade: 0 }]),
      { block: 3, evade: 1, dodge: 0 },
    );
  });

  test('labels read as game terms, and a blank face says so', () => {
    assert.equal(formatFaceLabel('attack', { acc: 0, dmg: 2, surge: 1 }), '2 Damage / 1 Surge');
    assert.equal(formatFaceLabel('attack', { acc: 0, dmg: 0, surge: 0 }), 'Blank');
    assert.equal(formatFaceLabel('defense', { block: 1, evade: 0, dodge: true }), '1B/0E/Dodge');
  });
});

describe('Rapid Recalibration hand path turns a die instead of rerolling it', () => {
  const makeCombat = () => ({
    attackerPlayerNum: 1,
    attackDiceResults: [
      { color: 'red', acc: 0, dmg: 1, surge: 0, faceIdx: 0 },
      { color: 'blue', acc: 2, dmg: 1, surge: 0, faceIdx: 1 },
    ],
    attackRoll: { acc: 2, dmg: 2, surge: 0 },
  });

  test('phase 1 lists the rolled dice', () => {
    const combat = makeCombat();
    const r = resolveAbility('Rapid Recalibration', { game: {}, playerNum: 1, combat });
    assert.ok(r.requiresChoice, 'prompts');
    assert.equal(r.choiceOptions.length, 2, 'one option per rolled die');
    assert.match(r.choiceOptions[0], /Die #1 \(red\)/);
  });

  test('phase 2 lists that die\'s real faces', () => {
    const combat = makeCombat();
    resolveAbility('Rapid Recalibration', { game: {}, playerNum: 1, combat });
    const r = resolveAbility('Rapid Recalibration', { game: {}, playerNum: 1, combat, choiceIndex: 0 });
    assert.ok(r.requiresChoice, 'prompts again for the face');
    assert.deepEqual(
      r.choiceOptions,
      faceOptionsFor('attack', 'red').map((f) => formatFaceLabel('attack', f)),
      'offers exactly the red die\'s distinct faces',
    );
  });

  test('phase 3 sets the face and re-totals the attack', () => {
    const combat = makeCombat();
    resolveAbility('Rapid Recalibration', { game: {}, playerNum: 1, combat, choiceIndex: 0 });
    const faces = faceOptionsFor('attack', 'red');
    const best = faces.reduce((a, b) => ((b.dmg ?? 0) > (a.dmg ?? 0) ? b : a));
    const bestIdx = faces.indexOf(best);

    const r = resolveAbility('Rapid Recalibration', { game: {}, playerNum: 1, combat, choiceIndex: bestIdx });
    assert.ok(r.applied, 'resolves');
    assert.equal(combat.attackDiceResults[0].dmg, best.dmg, 'die shows the chosen face');
    assert.equal(combat.attackRoll.dmg, best.dmg + 1, 'totals include the other die');
    assert.ok(!combat._pendingSetDieFace, 'pending state is cleared');
  });

  test('it does NOT feed the shared random-reroll counter', () => {
    const combat = makeCombat();
    resolveAbility('Rapid Recalibration', { game: {}, playerNum: 1, combat, choiceIndex: 0 });
    resolveAbility('Rapid Recalibration', { game: {}, playerNum: 1, combat, choiceIndex: 0 });
    assert.ok(!combat.rerollOneAttackDie, 'no reroll is granted — the card turns a die');
    assert.ok(!combat.forcedRerollQueue?.length, 'nothing queued for a reroll');
  });

  test('refuses cleanly before the dice are rolled', () => {
    const r = resolveAbility('Rapid Recalibration', {
      game: {}, playerNum: 1, combat: { attackerPlayerNum: 1, attackDiceResults: [] },
    });
    assert.equal(r.applied, false);
    assert.match(r.manualMessage, /not been rolled/);
  });

  test('the shipped card data uses the picker, not the reroll counter', async () => {
    const { getAbilityLibrary } = await import('../data-loader.js');
    const lib = getAbilityLibrary()?.abilities || {};
    const rr = lib['Rapid Recalibration'];
    assert.ok(rr, 'entry exists');
    assert.ok(rr.setAttackDieFace, 'wired to the die-face picker');
    assert.ok(!rr.rerollOneAttackDie, 'no longer wired to the random reroll counter');
  });
});
