import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  parseInnatePassives,
  applyInnateAttackerPassives,
  applyInnateDefenderPassives,
} from './innate-passive-helpers.js';

const ZERO = { damage: 0, surge: 0, block: 0, evade: 0, accuracy: 0, pierce: 0, blast: 0, cleave: 0 };

test('parseInnatePassives: empty / null', () => {
  assert.deepEqual(parseInnatePassives(null), ZERO);
  assert.deepEqual(parseInnatePassives([]), ZERO);
  assert.deepEqual(parseInnatePassives(undefined), ZERO);
});

test('parseInnatePassives: "+1 Damage" form', () => {
  assert.equal(parseInnatePassives(['+1 Damage']).damage, 1);
  assert.equal(parseInnatePassives(['+2 Damage']).damage, 2);
  assert.equal(parseInnatePassives(['+1 Hit']).damage, 1);
  assert.equal(parseInnatePassives(['+2 Hits']).damage, 2);
});

test('parseInnatePassives: "Block N" / "+N Block" / "Block 1" form', () => {
  assert.equal(parseInnatePassives(['Block 1']).block, 1);
  assert.equal(parseInnatePassives(['+1 Block']).block, 1);
  assert.equal(parseInnatePassives(['+2 Block']).block, 2);
});

test('parseInnatePassives: "+1 Evade" / "Evade 1" form', () => {
  assert.equal(parseInnatePassives(['+1 Evade']).evade, 1);
  assert.equal(parseInnatePassives(['Evade 1']).evade, 1);
});

test('parseInnatePassives: "+1 Surge" form', () => {
  assert.equal(parseInnatePassives(['+1 Surge']).surge, 1);
  assert.equal(parseInnatePassives(['+2 Surge']).surge, 2);
});

test('parseInnatePassives: comma-separated multi-bonus string', () => {
  // Drokkatta: "+1 Hit, +1 Accuracy, +1 Block" — accuracy out of scope, hit + block in
  const r = parseInnatePassives(['+1 Hit, +1 Accuracy, +1 Block']);
  assert.equal(r.damage, 1, 'extracts +1 hit as damage');
  assert.equal(r.block, 1, 'extracts +1 block');
  assert.equal(r.evade, 0);
  assert.equal(r.surge, 0);
});

test('parseInnatePassives: +Accuracy / Pierce / Blast (scope-expanded 2026-05-06)', () => {
  const r = parseInnatePassives(['+2 Accuracy', 'Pierce 1', 'Pierce 3']);
  assert.equal(r.accuracy, 2);
  assert.equal(r.pierce, 4); // 1 + 3
  assert.equal(r.blast, 0);
  // Original four still 0
  assert.equal(r.damage, 0);
  assert.equal(r.surge, 0);
  assert.equal(r.block, 0);
  assert.equal(r.evade, 0);
});

test('parseInnatePassives: multi-entry array sums correctly', () => {
  // Boba Fett: ['Block 1', '+1 Evade']
  const r = parseInnatePassives(['Block 1', '+1 Evade']);
  assert.equal(r.block, 1);
  assert.equal(r.evade, 1);
});

test('parseInnatePassives: known DC values', () => {
  // Luke Jedi Knight: ['+1 Hit', '+1 Evade']
  const luke = parseInnatePassives(['+1 Hit', '+1 Evade']);
  assert.deepEqual(luke, { ...ZERO, damage: 1, evade: 1 });

  // R2-D2: ['+2 Accuracy', '+1 Surge']
  const r2 = parseInnatePassives(['+2 Accuracy', '+1 Surge']);
  assert.deepEqual(r2, { ...ZERO, surge: 1, accuracy: 2 });

  // Wampa Elite: ['+2 Hit']
  const wampa = parseInnatePassives(['+2 Hit']);
  assert.deepEqual(wampa, { ...ZERO, damage: 2 });

  // Emperor Palpatine: ['Pierce 3']
  const emp = parseInnatePassives(['Pierce 3']);
  assert.deepEqual(emp, { ...ZERO, pierce: 3 });

  // AT-DP: ['Block 1', '+3 Accuracy']
  const atdp = parseInnatePassives(['Block 1', '+3 Accuracy']);
  assert.deepEqual(atdp, { ...ZERO, block: 1, accuracy: 3 });
});

test('applyInnateAttackerPassives: mutates bonusHits / bonusSurge / bonusAccuracy / bonusPierce / bonusBlast', () => {
  const combat = {};
  applyInnateAttackerPassives(combat, { passives: ['+1 Hit', '+1 Surge', '+2 Accuracy', 'Pierce 1', '+1 Blast'] });
  assert.equal(combat.bonusHits, 1);
  assert.equal(combat.bonusSurge, 1);
  assert.equal(combat.bonusAccuracy, 2);
  assert.equal(combat.bonusPierce, 1);
  assert.equal(combat.bonusBlast, 1);
});

test('applyInnateAttackerPassives: stacks with existing bonus', () => {
  const combat = { bonusHits: 2, bonusSurge: 1 };
  applyInnateAttackerPassives(combat, { passives: ['+1 Hit'] });
  assert.equal(combat.bonusHits, 3);
  assert.equal(combat.bonusSurge, 1, 'unchanged when no surge passive');
});

test('applyInnateDefenderPassives: mutates combat.bonusBlock and bonusEvade', () => {
  const combat = {};
  applyInnateDefenderPassives(combat, { passives: ['Block 1', '+1 Evade'] });
  assert.equal(combat.bonusBlock, 1);
  assert.equal(combat.bonusEvade, 1);
});

test('null-safety: missing dcEffect or combat is no-op', () => {
  // Should not throw
  applyInnateAttackerPassives(null, { passives: ['+1 Hit'] });
  applyInnateAttackerPassives({}, null);
  applyInnateAttackerPassives({}, undefined);
  applyInnateDefenderPassives(null, { passives: ['Block 1'] });
  applyInnateDefenderPassives({}, null);
});
