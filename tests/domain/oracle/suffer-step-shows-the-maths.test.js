/**
 * The suffer-damage step shows BOTH halves of the maths.
 *
 * alexanbv 2026-09-10: "math to check range and damage minus blocks should be
 * shown in the suffer damage step to show how much damage figure takes."
 *
 * The damage maths already went there (his 2026-06-26 ruling split it out of
 * the final message so it lands right after "suffered X damage"). The RANGE
 * check did not — it rode the final result line, which arrives after every
 * post-attack effect has resolved, too late to read next to the damage it
 * justifies. Both now travel together in calcNote.
 */
import { test, describe } from 'node:test';
import assert from 'node:assert';
import { computeCombatResult } from '../../../src/game/combat.js';

const base = {
  surgeDamage: 0, surgePierce: 0, surgeAccuracy: 0,
  targetStats: { defense: ['white'] },
};
const ranged = (over = {}) => computeCombatResult({
  ...base,
  attackRoll: { acc: 6, dmg: 3, surge: 0 },
  defenseRoll: { block: 1, evade: 0, dodge: 0 },
  isRanged: true, distanceToTarget: 4,
  attackInfo: { dice: ['red', 'green'], type: 'range' },
  ...over,
});

describe('a ranged hit shows range AND damage', () => {
  const r = ranged();

  test('it hits, so there is a note at all', () => {
    assert.equal(r.hit, true);
    assert.ok(r.calcNote);
  });

  test('the range check comes first, with accuracy vs distance', () => {
    assert.match(r.calcNote, /^🎯 \*\*Range:\*\* 6 accuracy vs 4 distance\n/);
  });

  test('the damage maths follows on its own line', () => {
    assert.match(r.calcNote, /\n🧮 \*\*Damage:\*\* 3 damage − 1 block = \*\*2\*\*$/);
  });

  test('both are in the SUFFER-step note, not the final result text', () => {
    // The distinction is the whole point of the ruling: resultText arrives
    // after every post-attack effect.
    assert.ok(r.calcNote.includes('Range:'));
    assert.ok(r.calcNote.includes('Damage:'));
  });
});

describe('the range line appears only when range is meaningful', () => {
  test('a MELEE attack gets damage maths but no range check', () => {
    const r = computeCombatResult({
      ...base,
      attackRoll: { acc: 2, dmg: 4, surge: 0 },
      defenseRoll: { block: 2, evade: 0, dodge: 0 },
      isRanged: false, distanceToTarget: 1,
      targetStats: { defense: ['black'] },
      attackInfo: { dice: ['red', 'red'], type: 'melee' },
    });
    assert.ok(!/Range:/.test(r.calcNote), 'melee has no accuracy-vs-distance check');
    assert.match(r.calcNote, /🧮 \*\*Damage:\*\* 4 damage − 2 block = \*\*2\*\*/);
  });

  test('an unknown distance omits the range line rather than printing undefined', () => {
    const r = ranged({ distanceToTarget: null });
    assert.ok(!/Range:/.test(r.calcNote));
    assert.ok(!/undefined|null|NaN/.test(r.calcNote), `note leaked a non-value: ${r.calcNote}`);
  });
});

describe('a miss produces no maths note', () => {
  test('there is nothing to show when no damage is suffered', () => {
    const r = ranged({ attackRoll: { acc: 1, dmg: 3, surge: 0 }, distanceToTarget: 5 });
    assert.equal(r.hit, false);
    assert.equal(r.calcNote, '');
  });
});

describe('the pierce and cancel adjustments still show their working', () => {
  test('block adjustments are spelled out rather than folded in', () => {
    const r = ranged({ surgePierce: 2, defenseRoll: { block: 3, evade: 0, dodge: 0 } });
    assert.match(r.calcNote, /block .*−2 Pierce/, `got: ${r.calcNote}`);
  });
});
