/**
 * Pierce stacks from every source.
 *
 * alexanbv 2026-09-02: "setting pierce for example in Critical Hit seems weird.
 * This should stack with other sources of pierce (for example, Expose
 * Weakness). Confirm that the way for ALL pierce abilities is implemented is
 * that pierce just stacks."
 *
 * It does, and the `out.pierce = 2` that prompted the question is not what it
 * looks like: parseSurgeEffect returns a FRESH object per surge, so the
 * assignment writes to that surge's own scratch value, never to a running
 * total. The accumulation happens one layer up.
 *
 * The chain, in order:
 *
 *   combat.bonusPierce  seeded at attack creation from the next-attack sources,
 *                       themselves summed: nextAttackBonusPierce (attacker-keyed)
 *                       + nextAttackPierceVsDefender (Expose Weakness,
 *                       defender-keyed) + an override pool's pierce
 *   combat.bonusPierce += 1 per innate/passive source (Pierce N, and the
 *                       named passives)
 *   combat.surgePierce += mod.pierce per surge actually spent, so two
 *                       pierce-granting surges give both
 *   totalPierce       = Math.max(0, surgePierce + bonusPierce)
 *
 * The single non-additive write is Cortosis Weave, which is a deliberate
 * REDUCTION of the accumulated value (-2, floored at 0), not a clobber.
 */
import { test, describe } from 'node:test';
import assert from 'node:assert';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseSurgeEffect } from '../../../src/game/combat.js';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../../../');
const gameCombat = readFileSync(resolve(root, 'src/game/combat.js'), 'utf8');
const handlers = readFileSync(resolve(root, 'src/handlers/combat.js'), 'utf8');

describe("Critical Hit's assignment is per-surge scratch, not a running total", () => {
  test('parseSurgeEffect hands back a fresh object every call', () => {
    const a = parseSurgeEffect('critical_hit');
    const b = parseSurgeEffect('critical_hit');
    assert.notStrictEqual(a, b, 'a shared object is what would make "= 2" a clobber');
    a.pierce = 99;
    assert.equal(parseSurgeEffect('critical_hit').pierce, 2, 'and mutating one cannot affect the next');
  });

  test('every surge starts from pierce: 0', () => {
    assert.equal(parseSurgeEffect('damage 2').pierce, 0);
    assert.equal(parseSurgeEffect('focus').pierce, 0);
  });

  test('within one combo surge, pierce accumulates rather than replaces', () => {
    // "pierce 1, pierce 2" is not a real card, but the combo splitter's += is
    // what makes a combo carrying pierce alongside other effects safe.
    assert.equal(parseSurgeEffect('accuracy 2, pierce 1').pierce, 1);
    assert.match(gameCombat, /out\.pierce \+= parseInt\(pierce\[1\], 10\)/);
  });
});

describe('the accumulation layer sums every source', () => {
  test('surge pierce accumulates across surges spent', () => {
    assert.match(handlers, /combat\.surgePierce = \(combat\.surgePierce \|\| 0\) \+ \(mod\.pierce \?\? 0\);/);
  });

  test('the total is surge PLUS bonus, floored at zero', () => {
    assert.match(gameCombat, /const totalPierce = Math\.max\(0, surgeP \+ bonusPierce\);/);
  });

  test('innate pierce adds rather than assigns', () => {
    assert.match(handlers, /combat\.bonusPierce\s+= \(combat\.bonusPierce\s+\|\| 0\) \+/);
  });

  test('Expose Weakness is summed with the other next-attack sources', () => {
    assert.match(handlers, /const nextPierce = \(game\.nextAttackBonusPierce\?\.\[attackerFigureKey\] \|\| 0\)\s*\n\s*\+ \(_defKeyForPierce \? \(game\.nextAttackPierceVsDefender\?\.\[_defKeyForPierce\] \|\| 0\) : 0\)\s*\n\s*\+ \(overrideDice\?\.pierce \|\| 0\)/);
    assert.match(handlers, /bonusPierce: nextPierce,/, 'and seeds the combat object');
  });

  test('the ONLY non-additive write is Cortosis Weave, and it is a reduction', () => {
    const writes = handlers.match(/combat\.bonusPierce = (?!\(combat\.bonusPierce)/g) || [];
    assert.equal(writes.length, 1, 'a second plain assignment would clobber accumulated pierce');
    assert.match(handlers, /id === 'cortosis_weave'[\s\S]{0,160}combat\.bonusPierce = r\.bonusPierce;/);
    const helper = readFileSync(resolve(root, 'src/game/cortosis-weave-helpers.js'), 'utf8');
    assert.match(helper, /bonusPierce: \(bonusPierce \|\| 0\) \+ CORTOSIS_WEAVE_PIERCE_DELTA/,
      'it reduces the value it was handed rather than replacing it');
  });
});

describe('arithmetic proof, using the real total', () => {
  const total = (surgeP, bonusP) => Math.max(0, surgeP + bonusP);

  test('Critical Hit stacks with Expose Weakness', () => {
    // Critical Hit surge (2) + Expose Weakness on the defender (3) = 5.
    assert.equal(total(parseSurgeEffect('critical_hit').pierce, 3), 5);
  });

  test('and with an innate Pierce 1 on top', () => {
    assert.equal(total(parseSurgeEffect('critical_hit').pierce, 3 + 1), 6);
  });

  test('two pierce surges both count', () => {
    const a = parseSurgeEffect('critical_hit').pierce;
    const b = parseSurgeEffect('pierce 2').pierce;
    assert.equal(total(a + b, 0), 4, 'nothing collapses them to a single 2');
  });

  test('Cortosis Weave subtracts from the stack and floors at zero', () => {
    assert.equal(total(2, 3 - 2), 3, 'reduces the total, does not zero it');
    assert.equal(total(0, 1 - 2), 0, 'and never goes negative');
  });
});
