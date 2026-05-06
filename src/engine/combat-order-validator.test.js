// Unit tests for the combat-order validator (slice 3.4).

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  classifyCcStep,
  validateCcPlayAtStep,
  classificationCount,
  assertClassificationsAreValid,
  CC_STEP_CLASSIFICATIONS,
} from './combat-order-validator.js';

// ── Classification consistency ────────────────────────────────────────────────

test('all classifications use valid steps and sides', () => {
  // Throws on misclassification.
  assertClassificationsAreValid();
});

test('classificationCount is positive and stable', () => {
  // Sentinel — protects against accidental wholesale deletion of the registry.
  assert.ok(classificationCount() >= 27, 'expected ≥27 classifications populated');
});

// ── Session 4 additions ──────────────────────────────────────────────────────

test('Hunter Protocol classified as Step 4 attacker (while-attacking)', () => {
  const c = classifyCcStep('Hunter Protocol');
  assert.equal(c.step, 'step4-attacker');
  assert.equal(c.side, 'attacker');
  assert.match(c.reason, /persists.*Step 5|surge|double-trigger/i);
});

test('Rapid Recalibration classified as Step 3 sub-window (rapidrecal)', () => {
  const c = classifyCcStep('Rapid Recalibration');
  assert.equal(c.step, 'step3-rapidrecal');
  assert.equal(c.side, 'attacker');
});

test('Targeting Network classified as Step 3 attacker (reroll)', () => {
  const c = classifyCcStep('Targeting Network');
  assert.equal(c.step, 'step3-attacker');
  assert.match(c.reason, /reroll/i);
});

test('There Is No Try classified as Step 3 (post-roll micro-window)', () => {
  const c = classifyCcStep('There Is No Try');
  assert.equal(c.step, 'step3-attacker');
  assert.match(c.reason, /post-roll|after.*roll/i);
});

test('Lando Resourceful / Gambit / Shrewd Scoundrel classified as Step 3', () => {
  for (const name of ['Resourceful', 'Gambit', 'Shrewd Scoundrel']) {
    const c = classifyCcStep(name);
    assert.equal(c.step, 'step3-attacker', `${name} must be step3`);
  }
});

test('Saska Power Converter classified as Step 3 attacker (once per round)', () => {
  const c = classifyCcStep('Saska Power Converter');
  assert.equal(c.step, 'step3-attacker');
  assert.match(c.reason, /once per round/i);
});

// ── classifyCcStep — destruct's audit walk-throughs ──────────────────────────

test('Camouflage classified as Step 1+2 defender (on-declare)', () => {
  const c = classifyCcStep('Camouflage');
  assert.equal(c.step, 'step1+2-defender');
  assert.equal(c.side, 'defender');
  assert.match(c.reason, /on-declare|declared/);
});

test('Force Illusion classified as Step 4 defender (while-attacking)', () => {
  const c = classifyCcStep('Force Illusion');
  assert.equal(c.step, 'step4-defender');
  assert.equal(c.side, 'defender');
  assert.match(c.reason, /while/);
});

test('Brace for Impact is Step 1+2 (pool-mod overrides "while defending" wording)', () => {
  const c = classifyCcStep('Brace for Impact');
  assert.equal(c.step, 'step1+2-defender');
  assert.match(c.reason, /pool-mod/);
});

test('Knowledge and Defense is Step 1+2 (pool-mod overrides "while defending")', () => {
  const c = classifyCcStep('Knowledge and Defense');
  assert.equal(c.step, 'step1+2-defender');
  assert.match(c.reason, /pool-mod/);
});

test('Tools for the Job is Step 1+2 attacker', () => {
  const c = classifyCcStep('Tools for the Job');
  assert.equal(c.step, 'step1+2-attacker');
  assert.match(c.reason, /pool-mod|on-declare/);
});

test('Element of Surprise is Step 1+2 attacker', () => {
  const c = classifyCcStep('Element of Surprise');
  assert.equal(c.step, 'step1+2-attacker');
});

test('On the Lam is Step 1+2 defender', () => {
  const c = classifyCcStep('On the Lam');
  assert.equal(c.step, 'step1+2-defender');
});

test('Get Behind Me! is Step 1+2 defender (target redirect)', () => {
  const c = classifyCcStep('Get Behind Me!');
  assert.equal(c.step, 'step1+2-defender');
});

test('Iron Will is Step 1+2 defender (cap declared, enforced at Step 7)', () => {
  const c = classifyCcStep('Iron Will');
  assert.equal(c.step, 'step1+2-defender');
});

test('Assassinate is Step 4 attacker (while-attacking result modifier)', () => {
  const c = classifyCcStep('Assassinate');
  assert.equal(c.step, 'step4-attacker');
  assert.match(c.reason, /while attacking/);
});

test('Positioning Advantage is Step 4 attacker', () => {
  const c = classifyCcStep('Positioning Advantage');
  assert.equal(c.step, 'step4-attacker');
});

test('Overwhelming Impact is Step 4 attacker', () => {
  const c = classifyCcStep('Overwhelming Impact');
  assert.equal(c.step, 'step4-attacker');
});

test('Parry is Step 4 defender', () => {
  const c = classifyCcStep('Parry');
  assert.equal(c.step, 'step4-defender');
});

test('Furious Charge is Step 8 defender (after-attack-resolves)', () => {
  const c = classifyCcStep('Furious Charge');
  assert.equal(c.step, 'step8');
  assert.equal(c.side, 'defender');
});

test('Final Stand is Step 7 (before-defeated interrupt)', () => {
  const c = classifyCcStep('Final Stand');
  assert.equal(c.step, 'step7');
  assert.match(c.reason, /defeated|interrupt/);
});

test('Extra Protection is Step 7 (suffer-damage interrupt)', () => {
  const c = classifyCcStep('Extra Protection');
  assert.equal(c.step, 'step7');
});

test('Debts Repaid is Step 7 (when defeated)', () => {
  const c = classifyCcStep('Debts Repaid');
  assert.equal(c.step, 'step7');
});

test('Negation is counter-window (not a step)', () => {
  const c = classifyCcStep('Negation');
  assert.equal(c.step, 'counter-window');
});

test('Comm Disruption is counter-window', () => {
  const c = classifyCcStep('Comm Disruption');
  assert.equal(c.step, 'counter-window');
});

// ── classifyCcStep — unknown / invalid input ──────────────────────────────────

test('classifyCcStep returns null for unknown CCs', () => {
  assert.equal(classifyCcStep('Some Unregistered Card'), null);
});

test('classifyCcStep returns null for non-string input', () => {
  assert.equal(classifyCcStep(null), null);
  assert.equal(classifyCcStep(undefined), null);
  assert.equal(classifyCcStep(42), null);
});

// ── validateCcPlayAtStep ──────────────────────────────────────────────────────

test('validateCcPlayAtStep accepts a CC played at its canonical step', () => {
  const v = validateCcPlayAtStep('Camouflage', 'step1+2-defender');
  assert.equal(v.ok, true);
  assert.equal(v.classification.step, 'step1+2-defender');
});

test('validateCcPlayAtStep rejects a CC played at the wrong step', () => {
  const v = validateCcPlayAtStep('Camouflage', 'step4-defender');
  assert.equal(v.ok, false);
  assert.match(v.reason, /should fire at step 'step1\+2-defender'/);
  assert.match(v.reason, /at 'step4-defender'/);
});

test('validateCcPlayAtStep counter-window CCs are always valid', () => {
  const v = validateCcPlayAtStep('Negation', 'step3-attacker');
  assert.equal(v.ok, true);
  assert.equal(v.classification.step, 'counter-window');
});

test('validateCcPlayAtStep on unknown CC: ok=true by default (warn-mode)', () => {
  const v = validateCcPlayAtStep('Unknown Card', 'step1+2-attacker');
  assert.equal(v.ok, true);
  assert.equal(v.classification, null);
});

test('validateCcPlayAtStep on unknown CC: ok=false in strict mode', () => {
  const v = validateCcPlayAtStep('Unknown Card', 'step1+2-attacker', { strict: true });
  assert.equal(v.ok, false);
});

// ── Migration-readiness check ─────────────────────────────────────────────────

test('all attacker-side CCs in registry have step in attacker sub-windows or shared steps', () => {
  for (const [name, c] of Object.entries(CC_STEP_CLASSIFICATIONS)) {
    if (c.side !== 'attacker') continue;
    const stepOk =
      c.step === 'step1+2-attacker' ||
      c.step === 'step3-attacker' ||
      c.step === 'step3-rapidrecal' ||
      c.step === 'step4-attacker' ||
      c.step === 'step5' ||
      c.step === 'step8' ||
      c.step === 'counter-window';
    assert.ok(stepOk, `${name} has side='attacker' but step='${c.step}' which is not an attacker-side step`);
  }
});

test('all defender-side CCs in registry have step in defender sub-windows or step7/8', () => {
  for (const [name, c] of Object.entries(CC_STEP_CLASSIFICATIONS)) {
    if (c.side !== 'defender') continue;
    const stepOk =
      c.step === 'step1+2-defender' ||
      c.step === 'step3-defender' ||
      c.step === 'step4-defender' ||
      c.step === 'zillo-window' ||
      c.step === 'step7' ||
      c.step === 'step8' ||
      c.step === 'counter-window';
    assert.ok(stepOk, `${name} has side='defender' but step='${c.step}' which is not a defender-side step`);
  }
});
