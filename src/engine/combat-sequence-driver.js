// Sequence driver — walks an attack through ATTACK_STEPS (alexanbv 2026-06-15
// "proceed with sequence drive"). Event-driven, not a loop: each step posts its
// prompt(s) and PAUSES; when the step finishes (gate complete / mechanic done /
// player clicked through), the step's completion calls advance(), which enters
// the next step. This matches the Discord button-driven flow where control
// returns between steps.
//
// The driver is pure orchestration over injected handlers, so it is unit-tested
// in isolation; the real handlers (build+drive a window gate; run the
// roll/surge/damage mechanic) live in the combat handler and are wired in next.
//
// handlers:
//   driveGate(step, combat)    → open + drive the gate window for `step`
//   runMechanic(step, combat)  → run the mechanic for `step`
//   onComplete(combat)         → attack sequence finished (optional)

import { firstStep, nextStep, isGateStep } from './combat-sequence.js';

/** Enter a step: record it and dispatch to gate vs mechanic. null → complete. */
async function enterStep(combat, step, handlers) {
  combat._seqStep = step ?? null;
  if (step == null) { await handlers.onComplete?.(combat); return; }
  if (isGateStep(step)) await handlers.driveGate(step, combat);
  else await handlers.runMechanic(step, combat);
}

/** Begin a fresh attack at the first step. */
export async function startSequence(combat, handlers) {
  return enterStep(combat, firstStep(), handlers);
}

/**
 * Advance from the current step to the next. Called by a step's completion
 * (gate onComplete / mechanic done). Idempotent w.r.t. the recorded step.
 */
export async function advanceSequence(combat, handlers) {
  const cur = combat._seqStep ?? firstStep();
  return enterStep(combat, nextStep(cur), handlers);
}

/** The step the attack is currently in (or null). */
export function currentStep(combat) {
  return combat?._seqStep ?? null;
}
