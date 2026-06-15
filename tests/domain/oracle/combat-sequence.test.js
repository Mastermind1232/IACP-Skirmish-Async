/**
 * Canonical attack step sequence (alexanbv 2026-06-15 rebuild). Pins the order
 * the gate driver walks: on_declare → roll → rerolls → special → mods →
 * spend_surges → damage → after_resolve, and which steps open a gate.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { ATTACK_STEPS, GATE_STEPS, isGateStep, nextStep, firstStep } from '../../../src/engine/combat-sequence.js';

describe('combat-sequence', () => {
  it('defines the full ordered attack sequence', () => {
    assert.deepEqual(ATTACK_STEPS, [
      'on_declare', 'roll', 'rerolls', 'special', 'mods',
      'spend_surges', 'zillo', 'damage', 'after_resolve',
    ]);
    assert.equal(firstStep(), 'on_declare');
    // special (Zeb/Rapid Recal) is after ALL rerolls + before mods;
    // zillo (exhaust) is after spend_surges + before damage.
    assert.ok(ATTACK_STEPS.indexOf('special') > ATTACK_STEPS.indexOf('rerolls'));
    assert.ok(ATTACK_STEPS.indexOf('special') < ATTACK_STEPS.indexOf('mods'));
    assert.ok(ATTACK_STEPS.indexOf('zillo') > ATTACK_STEPS.indexOf('spend_surges'));
    assert.ok(ATTACK_STEPS.indexOf('zillo') < ATTACK_STEPS.indexOf('damage'));
  });

  it('nextStep walks the sequence and ends with null', () => {
    let s = firstStep();
    const walked = [s];
    while ((s = nextStep(s)) != null) walked.push(s);
    assert.deepEqual(walked, ATTACK_STEPS);
    assert.equal(nextStep('after_resolve'), null);
    assert.equal(nextStep('not-a-step'), null);
  });

  it('classifies gate steps vs mechanic steps', () => {
    for (const g of ['on_declare', 'rerolls', 'special', 'mods', 'zillo', 'after_resolve']) {
      assert.equal(isGateStep(g), true, `${g} is a gate step`);
      assert.ok(GATE_STEPS.has(g));
    }
    for (const m of ['roll', 'spend_surges', 'damage']) {
      assert.equal(isGateStep(m), false, `${m} is a mechanic step`);
    }
  });
});
