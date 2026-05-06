import { test } from 'node:test';
import assert from 'node:assert/strict';

import { buildArsenalSelectOptions } from '../../src/handlers/dc-play-area.js';

test('buildArsenalSelectOptions: 2-die Arsenal returns all color pairs (no max-2 rule)', () => {
  const opts = buildArsenalSelectOptions(2);
  // 4 colors, combinations with repetition = C(4+2-1, 2) = 10
  assert.equal(opts.length, 10);
  assert.ok(opts.some((o) => o.value === 'red,red'), 'allows red+red');
  assert.ok(opts.some((o) => o.value === 'green,green'), 'allows green+green');
});

test('buildArsenalSelectOptions: Epic Arsenal (no focus) excludes triple-same-color', () => {
  const opts = buildArsenalSelectOptions(3);
  for (const o of opts) {
    const dice = o.value.split(',');
    const colors = ['red', 'blue', 'yellow', 'green'];
    for (const c of colors) {
      const count = dice.filter((d) => d === c).length;
      assert.ok(count <= 2, `combo ${o.value} has ${count} ${c} dice (max 2)`);
    }
  }
  // 4 colors, combinations with repetition = C(4+3-1, 3) = 20; minus 4 triples = 16
  assert.equal(opts.length, 16);
});

test('buildArsenalSelectOptions: Epic Arsenal with green focus die — chosen greens cap at 1', () => {
  // destruct 2026-05-06: focus die (green) counts toward the max-2-same-color
  // cap, so chosen 3 dice can include at most 1 green when focused.
  const opts = buildArsenalSelectOptions(3, { extraDie: 'green' });
  for (const o of opts) {
    const dice = o.value.split(',');
    const greens = dice.filter((d) => d === 'green').length;
    assert.ok(greens <= 1, `combo ${o.value} has ${greens} chosen greens — exceeds 1 when focus adds a green`);
  }
  // Sanity: still has plenty of options
  assert.ok(opts.length > 5, `expected many surviving combos, got ${opts.length}`);
  assert.ok(opts.some((o) => o.value === 'red,red,blue'), 'red+red+blue still allowed');
  assert.ok(opts.some((o) => o.value === 'red,blue,green'), 'red+blue+green still allowed (1 chosen green + 1 focus = 2)');
});

test('buildArsenalSelectOptions: Epic Arsenal with green focus — disallows green-heavy combos', () => {
  const opts = buildArsenalSelectOptions(3, { extraDie: 'green' });
  // green,green,X would total 3 greens after focus die — must NOT appear
  assert.ok(!opts.some((o) => o.value.startsWith('green,green')), 'no combo starts with green,green');
  assert.ok(!opts.some((o) => /green.*green/.test(o.value)), 'no combo has 2 greens');
});

test('buildArsenalSelectOptions: extraDie of non-green color enforces same cap on that color', () => {
  // Hypothetical: if a future ability adds a red focus die instead.
  const opts = buildArsenalSelectOptions(3, { extraDie: 'red' });
  for (const o of opts) {
    const dice = o.value.split(',');
    const reds = dice.filter((d) => d === 'red').length;
    assert.ok(reds <= 1, `combo ${o.value} has ${reds} chosen reds — exceeds 1 when extra red is added`);
  }
});
