/**
 * Sequence driver (alexanbv 2026-06-15 rebuild). Proves the event-driven driver
 * walks the full attack sequence in order, dispatching gate steps to driveGate
 * and mechanic steps to runMechanic, advancing on each step's completion, and
 * firing onComplete at the end.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { startSequence, advanceSequence, currentStep } from '../../../src/engine/combat-sequence-driver.js';
import { ATTACK_STEPS, isGateStep } from '../../../src/engine/combat-sequence.js';

describe('combat-sequence-driver', () => {
  it('walks the full sequence, routing gate vs mechanic steps, then completes', async () => {
    const combat = {};
    const log = [];
    let done = false;
    // Each handler records the step then immediately advances (simulating a
    // step that resolves with no player input).
    const handlers = {
      driveGate: async (step, c) => { log.push(`gate:${step}`); await advanceSequence(c, handlers); },
      runMechanic: async (step, c) => { log.push(`mech:${step}`); await advanceSequence(c, handlers); },
      onComplete: async () => { done = true; },
    };
    await startSequence(combat, handlers);

    const expected = ATTACK_STEPS.map((s) => `${isGateStep(s) ? 'gate' : 'mech'}:${s}`);
    assert.deepEqual(log, expected);
    assert.equal(done, true, 'onComplete fired at end');
    assert.equal(currentStep(combat), null, 'sequence ended');
  });

  it('pauses at a step until advance is called (event-driven)', async () => {
    const combat = {};
    const seen = [];
    const handlers = {
      driveGate: async (step) => { seen.push(step); },   // do NOT auto-advance
      runMechanic: async (step) => { seen.push(step); },
    };
    await startSequence(combat, handlers);
    assert.deepEqual(seen, ['on_declare'], 'stopped at first step awaiting completion');
    assert.equal(currentStep(combat), 'on_declare');
    await advanceSequence(combat, handlers); // simulate the step finishing
    assert.deepEqual(seen, ['on_declare', 'roll'], 'advanced to the next step');
    assert.equal(currentStep(combat), 'roll');
  });
});
