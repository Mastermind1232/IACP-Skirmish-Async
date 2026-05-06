// Unit tests for the combat orchestrator (slice 3.3).

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { makeAttackFrame } from './combat-frame.js';
import {
  createOrchestrator,
  declareCcPlay,
  passCounter,
  passStep,
  whoIsPrompted,
  isResolved,
} from './combat-orchestrator.js';

function freshOrchestrator() {
  const frame = makeAttackFrame({
    frameId: 'root',
    attackerFigureKey: 'A-1-0',
    attackerPlayerNum: 1,
    defenderFigureKey: 'B-1-0',
    defenderPlayerNum: 2,
    attackPool: ['red', 'green'],
    defensePool: ['white'],
  });
  return createOrchestrator(frame);
}

// ── Initial state ─────────────────────────────────────────────────────────────

test('createOrchestrator auto-runs past pre-declare to first player window', () => {
  const o = freshOrchestrator();
  assert.equal(o.frame.currentStep, 'step1+2-attacker');
  const prompt = whoIsPrompted(o);
  assert.deepEqual(prompt, {
    kind: 'step-pass',
    role: 'attacker',
    step: 'step1+2-attacker',
  });
});

// ── Simplest attack: no CCs, both sides pass everything ──────────────────────

test('attack with no CCs walks the full sequence to resolved', () => {
  let o = freshOrchestrator();
  // Step 1+2 attacker → defender → roll → step3 cycle → step4 cycle → step5 → zillo → step6 → step7 → step8 → resolved
  o = passStep(o, 'attacker'); // step1+2-attacker → step1+2-defender (then roll auto)
  assert.equal(o.frame.currentStep, 'step1+2-defender');
  o = passStep(o, 'defender'); // step1+2-defender → roll → step3-attacker
  assert.equal(o.frame.currentStep, 'step3-attacker');
  o = passStep(o, 'attacker'); // → step3-rapidrecal
  assert.equal(o.frame.currentStep, 'step3-rapidrecal');
  o = passStep(o, 'attacker'); // → step3-defender
  assert.equal(o.frame.currentStep, 'step3-defender');
  o = passStep(o, 'defender'); // → step4-attacker
  assert.equal(o.frame.currentStep, 'step4-attacker');
  o = passStep(o, 'attacker'); // → step4-defender
  assert.equal(o.frame.currentStep, 'step4-defender');
  o = passStep(o, 'defender'); // → step5
  assert.equal(o.frame.currentStep, 'step5');
  o = passStep(o, 'attacker'); // → zillo-window
  assert.equal(o.frame.currentStep, 'zillo-window');
  o = passStep(o, 'defender'); // → step6 → step7 → step8 → resolved
  assert.equal(o.frame.currentStep, 'resolved');
  assert.equal(isResolved(o), true);
});

// ── CC play with no counter ──────────────────────────────────────────────────

test('attacker plays a CC at step1+2-attacker, defender passes the counter', () => {
  let o = freshOrchestrator();
  o = declareCcPlay(o, { ccName: 'Element of Surprise', playerNum: 1 });
  // Counter-window now opens for defender
  assert.deepEqual(whoIsPrompted(o), {
    kind: 'counter-window',
    playerNum: 2,
  });
  o = passCounter(o);
  // Element resolves, no cancellation
  assert.equal(o.lastResolved.ccName, 'Element of Surprise');
  assert.equal(o.lastCanceled, null);
  assert.equal(o.frame.ccPlayStack.length, 0);
  // Prompt returns to step-pass for attacker
  assert.deepEqual(whoIsPrompted(o), {
    kind: 'step-pass',
    role: 'attacker',
    step: 'step1+2-attacker',
  });
});

// ── Counter chain: defender Negates attacker's CC ────────────────────────────

test('defender Negates attacker CC: original CC is canceled', () => {
  let o = freshOrchestrator();
  o = declareCcPlay(o, { ccName: 'Element of Surprise', playerNum: 1 });
  o = declareCcPlay(o, { ccName: 'Negation', playerNum: 2 });
  // Now attacker is prompted: counter the Negation?
  assert.deepEqual(whoIsPrompted(o), {
    kind: 'counter-window',
    playerNum: 1,
  });
  o = passCounter(o);
  // Negation resolves, cancels Element of Surprise
  assert.equal(o.lastResolved.ccName, 'Negation');
  assert.equal(o.lastCanceled.ccName, 'Element of Surprise');
  assert.equal(o.lastCanceled.canceled, true);
  assert.equal(o.frame.ccPlayStack.length, 0);
  // Step-pass prompt returns
  assert.deepEqual(whoIsPrompted(o), {
    kind: 'step-pass',
    role: 'attacker',
    step: 'step1+2-attacker',
  });
});

// ── Counter-on-counter chain (depth 2) ───────────────────────────────────────

test('counter-on-counter: original CC survives because counter is canceled', () => {
  let o = freshOrchestrator();
  // Defender plays Brace at step1+2-defender (after attacker passes)
  o = passStep(o, 'attacker');
  assert.equal(o.frame.currentStep, 'step1+2-defender');
  o = declareCcPlay(o, { ccName: 'Brace for Impact', playerNum: 2 });
  // Attacker counters with Comm Disruption
  o = declareCcPlay(o, { ccName: 'Comm Disruption', playerNum: 1 });
  // Defender counters CD with Negation
  o = declareCcPlay(o, { ccName: 'Negation', playerNum: 2 });
  assert.equal(o.frame.ccPlayStack.length, 3);
  // Attacker prompted to counter Negation
  assert.deepEqual(whoIsPrompted(o), {
    kind: 'counter-window',
    playerNum: 1,
  });
  // Attacker passes — Negation resolves, CD canceled
  o = passCounter(o);
  assert.equal(o.lastResolved.ccName, 'Negation');
  assert.equal(o.lastCanceled.ccName, 'Comm Disruption');
  // Brace remains on stack
  assert.equal(o.frame.ccPlayStack.length, 1);
  assert.equal(o.frame.ccPlayStack[0].ccName, 'Brace for Impact');
  // Now attacker is prompted to counter Brace
  assert.deepEqual(whoIsPrompted(o), {
    kind: 'counter-window',
    playerNum: 1,
  });
  // Attacker passes → Brace resolves
  o = passCounter(o);
  assert.equal(o.lastResolved.ccName, 'Brace for Impact');
  assert.equal(o.lastCanceled, null, 'Brace was not canceled, no target to cancel');
});

// ── Sanity: passStep refuses while counter-window is open ────────────────────

test('passStep refuses while a CC is pending in counter-window', () => {
  let o = freshOrchestrator();
  o = declareCcPlay(o, { ccName: 'Element of Surprise', playerNum: 1 });
  assert.throws(() => passStep(o, 'attacker'),
    /cannot pass step while a CC play is pending/);
});

// ── isResolved ────────────────────────────────────────────────────────────────

test('isResolved is false until the full sequence completes', () => {
  let o = freshOrchestrator();
  assert.equal(isResolved(o), false);
  o = passStep(o, 'attacker');
  o = passStep(o, 'defender');
  o = passStep(o, 'attacker');
  o = passStep(o, 'attacker');
  o = passStep(o, 'defender');
  o = passStep(o, 'attacker');
  o = passStep(o, 'defender');
  o = passStep(o, 'attacker');
  o = passStep(o, 'defender');
  assert.equal(isResolved(o), true);
});

// ── Transcript captures all events ────────────────────────────────────────────

test('transcript records cc-declared, counter-passed, cc-resolved, step-pass events', () => {
  let o = freshOrchestrator();
  o = declareCcPlay(o, { ccName: 'Element of Surprise', playerNum: 1 });
  o = passCounter(o);
  o = passStep(o, 'attacker');
  const types = o.transcript.map(t => t.type);
  assert.ok(types.includes('cc-declared'));
  assert.ok(types.includes('counter-window-passed'));
  assert.ok(types.includes('cc-resolved'));
  assert.ok(types.includes('step-pass'));
});
