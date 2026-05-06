// Unit tests for the combat-pipeline gate machine (slice 3.1).

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { makeAttackFrame } from './combat-frame.js';
import {
  requiredPassesForStep,
  nextStep,
  recordPlayerPass,
  advanceEngineStep,
  runEngineSteps,
} from './combat-pipeline.js';

function freshFrame() {
  return makeAttackFrame({
    frameId: 'root',
    attackerFigureKey: 'A-1-0',
    attackerPlayerNum: 1,
    defenderFigureKey: 'B-1-0',
    defenderPlayerNum: 2,
  });
}

// ── Required-passes table ─────────────────────────────────────────────────────

test('attacker-only sub-windows require attacker pass', () => {
  for (const step of ['step1+2-attacker', 'step3-attacker', 'step3-rapidrecal', 'step4-attacker', 'step5']) {
    assert.deepEqual(requiredPassesForStep(step), ['attacker'],
      `${step} must require attacker only`);
  }
});

test('defender-only sub-windows require defender pass', () => {
  for (const step of ['step1+2-defender', 'step3-defender', 'step4-defender', 'zillo-window']) {
    assert.deepEqual(requiredPassesForStep(step), ['defender'],
      `${step} must require defender only`);
  }
});

test('engine-driven steps require no player pass', () => {
  for (const step of ['pre-declare', 'roll', 'step6', 'step7', 'step8', 'resolved']) {
    assert.deepEqual(requiredPassesForStep(step), [],
      `${step} must be engine-driven`);
  }
});

// ── nextStep ─────────────────────────────────────────────────────────────────

test('nextStep walks the canonical sequence', () => {
  assert.equal(nextStep('pre-declare'), 'step1+2-attacker');
  assert.equal(nextStep('step1+2-attacker'), 'step1+2-defender');
  assert.equal(nextStep('step1+2-defender'), 'roll');
  assert.equal(nextStep('roll'), 'step3-attacker');
  assert.equal(nextStep('step5'), 'zillo-window');
  assert.equal(nextStep('step8'), 'resolved');
  assert.equal(nextStep('resolved'), null);
});

// ── recordPlayerPass — basic advancement ──────────────────────────────────────

test('attacker pass at step1+2-attacker advances to step1+2-defender', () => {
  const f0 = { ...freshFrame(), currentStep: 'step1+2-attacker' };
  const { frame: f1, advanced } = recordPlayerPass(f0, 'attacker');
  assert.equal(advanced, true);
  assert.equal(f1.currentStep, 'step1+2-defender');
  assert.equal(f1.perStepPasses.attacker['step1+2-attacker'], true);
});

test('defender pass at step1+2-attacker is rejected (wrong role)', () => {
  const f0 = { ...freshFrame(), currentStep: 'step1+2-attacker' };
  assert.throws(() => recordPlayerPass(f0, 'defender'),
    /role 'defender' has no pass required at step 'step1\+2-attacker'/);
});

test('attacker pass at step1+2-defender is rejected (wrong role)', () => {
  const f0 = { ...freshFrame(), currentStep: 'step1+2-defender' };
  assert.throws(() => recordPlayerPass(f0, 'attacker'),
    /role 'attacker' has no pass required at step 'step1\+2-defender'/);
});

test('recordPlayerPass on engine-driven step is rejected', () => {
  const f0 = { ...freshFrame(), currentStep: 'roll' };
  assert.throws(() => recordPlayerPass(f0, 'attacker'),
    /no pass required at step 'roll'/);
});

test('recordPlayerPass on resolved frame throws', () => {
  const f0 = { ...freshFrame(), currentStep: 'resolved' };
  assert.throws(() => recordPlayerPass(f0, 'attacker'), /already resolved/);
});

test('recordPlayerPass throws on unknown role', () => {
  const f0 = { ...freshFrame(), currentStep: 'step1+2-attacker' };
  assert.throws(() => recordPlayerPass(f0, 'spectator'), /role must be/);
});

// ── advanceEngineStep ─────────────────────────────────────────────────────────

test('advanceEngineStep walks engine-driven steps', () => {
  let f = { ...freshFrame(), currentStep: 'roll' };
  f = advanceEngineStep(f);
  assert.equal(f.currentStep, 'step3-attacker');
});

test('advanceEngineStep refuses to skip a player-input step', () => {
  const f0 = { ...freshFrame(), currentStep: 'step1+2-attacker' };
  assert.throws(() => advanceEngineStep(f0), /requires player pass/);
});

test('advanceEngineStep refuses on resolved', () => {
  const f0 = { ...freshFrame(), currentStep: 'resolved' };
  assert.throws(() => advanceEngineStep(f0), /already resolved/);
});

// ── runEngineSteps ────────────────────────────────────────────────────────────

test('runEngineSteps advances from pre-declare to step1+2-attacker', () => {
  const f0 = freshFrame();
  assert.equal(f0.currentStep, 'pre-declare');
  const f1 = runEngineSteps(f0);
  assert.equal(f1.currentStep, 'step1+2-attacker', 'pre-declare auto-advances; halts at attacker player-input window');
});

test('runEngineSteps stops at a player-input window', () => {
  const f0 = { ...freshFrame(), currentStep: 'step1+2-attacker' };
  const f1 = runEngineSteps(f0);
  assert.equal(f1.currentStep, 'step1+2-attacker', 'no advance — already at player window');
});

test('runEngineSteps from roll advances through to step3-attacker', () => {
  const f0 = { ...freshFrame(), currentStep: 'roll' };
  const f1 = runEngineSteps(f0);
  assert.equal(f1.currentStep, 'step3-attacker');
});

test('runEngineSteps stops at resolved', () => {
  const f0 = { ...freshFrame(), currentStep: 'resolved' };
  const f1 = runEngineSteps(f0);
  assert.equal(f1.currentStep, 'resolved');
});

// ── End-to-end canonical walk ────────────────────────────────────────────────

test('full attack walks the canonical sequence with attacker→defender ordering', () => {
  let f = freshFrame();
  // Engine: pre-declare → step1+2-attacker
  f = runEngineSteps(f);
  assert.equal(f.currentStep, 'step1+2-attacker');

  // Attacker passes → advance to step1+2-defender
  ({ frame: f } = recordPlayerPass(f, 'attacker'));
  assert.equal(f.currentStep, 'step1+2-defender');

  // Defender passes → advance to roll → step3-attacker
  ({ frame: f } = recordPlayerPass(f, 'defender'));
  f = runEngineSteps(f);
  assert.equal(f.currentStep, 'step3-attacker');

  // Step 3: attacker → rapid-recal → defender
  ({ frame: f } = recordPlayerPass(f, 'attacker'));
  assert.equal(f.currentStep, 'step3-rapidrecal');
  ({ frame: f } = recordPlayerPass(f, 'attacker'));
  assert.equal(f.currentStep, 'step3-defender');
  ({ frame: f } = recordPlayerPass(f, 'defender'));
  assert.equal(f.currentStep, 'step4-attacker');

  // Step 4: attacker → defender
  ({ frame: f } = recordPlayerPass(f, 'attacker'));
  assert.equal(f.currentStep, 'step4-defender');
  ({ frame: f } = recordPlayerPass(f, 'defender'));
  assert.equal(f.currentStep, 'step5');

  // Step 5: attacker spends surges
  ({ frame: f } = recordPlayerPass(f, 'attacker'));
  assert.equal(f.currentStep, 'zillo-window');

  // Zillo window: defender-only
  ({ frame: f } = recordPlayerPass(f, 'defender'));
  // step6 → step7 → step8 are engine-driven
  f = runEngineSteps(f);
  assert.equal(f.currentStep, 'resolved', 'engine walks the rest of the sequence');
});

test('attacker cannot pass step1+2-defender even if attacker tried first', () => {
  // Reasoning: at step1+2-defender, only defender's pass is required — attacker
  // already finished their step1+2-attacker window and we've moved on. attacker
  // attempting to pass again is invalid.
  let f = { ...freshFrame(), currentStep: 'step1+2-defender' };
  assert.throws(() => recordPlayerPass(f, 'attacker'), /no pass required/);
});
