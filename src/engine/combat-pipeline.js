// Combat pipeline gate machine (slice 3.1).
//
// Pure state transitions over an AttackFrame. Nothing in this file mutates
// game state or calls Discord — the gate machine is a function of (frame,
// event) → newFrame. Wiring to real combat happens in later slices.
//
// The canonical sequence is enforced by COMBAT_STEPS in combat-frame.js;
// this file enforces *who must pass* at each step and *when the engine
// auto-advances*. Per destruct's 2026-05-05 audit, conflict order during
// an attack is always attacker → defender, and many sub-windows are
// attacker-only or defender-only.

import { COMBAT_STEPS, stepIndex } from './combat-frame.js';

/**
 * For each step, declares which roles must pass before the engine advances.
 *
 * - attacker-only sub-windows: step1+2-attacker, step3-attacker,
 *   step3-rapidrecal, step4-attacker, step5
 * - defender-only sub-windows: step1+2-defender, step3-defender,
 *   step4-defender, zillo-window
 * - engine-driven (no player pass needed): pre-declare, roll, step6, step7,
 *   step8, resolved
 *
 * Note: counter-windows are NOT in this list — they're orthogonal,
 * driven by the CC-play stack (slice 3.2). A counter-window can open
 * inside any of these steps when a player declares a CC.
 */
const STEP_REQUIRED_PASSES = Object.freeze({
  'pre-declare': [],
  'step1+2-attacker': ['attacker'],
  'step1+2-defender': ['defender'],
  'roll': [],
  'step3-attacker': ['attacker'],
  'step3-rapidrecal': ['attacker'],
  'step3-defender': ['defender'],
  'step4-attacker': ['attacker'],
  'step4-defender': ['defender'],
  'step5': ['attacker'],
  'zillo-window': ['defender'],
  'step6': [],
  'step7': [],
  'step8': [],
  'resolved': [],
});

/** Returns the role(s) whose pass is required to advance from this step. */
export function requiredPassesForStep(step) {
  return STEP_REQUIRED_PASSES[step] || [];
}

/** Returns the next step in canonical order, or null if at terminal. */
export function nextStep(step) {
  const idx = stepIndex(step);
  if (idx < 0 || idx >= COMBAT_STEPS.length - 1) return null;
  return COMBAT_STEPS[idx + 1];
}

/**
 * Record that a player has passed for the current step. If both sides have
 * passed (or only one side is required and they passed), advance to the next
 * step.
 *
 * Engine-driven steps (pre-declare, roll, step6, step7, step8) auto-advance
 * via advanceEngineStep instead — recordPlayerPass is for player-input steps
 * only and refuses to no-op past their pass.
 *
 * Returns `{ frame, advanced }`. Throws if role isn't 'attacker' or
 * 'defender', or if the current step is already resolved.
 *
 * @param {object} frame
 * @param {'attacker' | 'defender'} role
 */
export function recordPlayerPass(frame, role) {
  if (role !== 'attacker' && role !== 'defender') {
    throw new Error(`recordPlayerPass: role must be 'attacker' or 'defender', got '${role}'`);
  }
  if (frame.currentStep === 'resolved') {
    throw new Error(`recordPlayerPass: frame is already resolved`);
  }
  const required = requiredPassesForStep(frame.currentStep);
  if (!required.includes(role)) {
    throw new Error(
      `recordPlayerPass: role '${role}' has no pass required at step '${frame.currentStep}' (required: ${JSON.stringify(required)})`
    );
  }
  const stepPasses = { ...frame.perStepPasses[role], [frame.currentStep]: true };
  const newPerStepPasses = {
    ...frame.perStepPasses,
    [role]: stepPasses,
  };
  const allRequiredPassed = required.every((r) => newPerStepPasses[r]?.[frame.currentStep]);
  let newFrame = { ...frame, perStepPasses: newPerStepPasses };
  let advanced = false;
  if (allRequiredPassed) {
    const next = nextStep(frame.currentStep);
    if (next) {
      newFrame = { ...newFrame, currentStep: next };
      advanced = true;
    }
  }
  return { frame: newFrame, advanced };
}

/**
 * Engine-driven advance for steps that don't require player input
 * (pre-declare → step1+2-attacker, roll → step3-attacker, step6 → step7, etc.).
 * Throws if the current step does require a player pass — the engine cannot
 * skip a player-input step.
 *
 * Returns the new frame.
 */
export function advanceEngineStep(frame) {
  if (frame.currentStep === 'resolved') {
    throw new Error('advanceEngineStep: already resolved');
  }
  const required = requiredPassesForStep(frame.currentStep);
  if (required.length > 0) {
    throw new Error(
      `advanceEngineStep: step '${frame.currentStep}' requires player pass (${JSON.stringify(required)}); use recordPlayerPass`
    );
  }
  const next = nextStep(frame.currentStep);
  if (!next) {
    throw new Error(`advanceEngineStep: no next step from '${frame.currentStep}'`);
  }
  return { ...frame, currentStep: next };
}

/**
 * Run the engine forward through any consecutive engine-driven steps,
 * stopping at the first player-input step or 'resolved'. Useful when
 * downstream player input is required next; transparently advances past
 * engine-only stages between two player windows.
 */
export function runEngineSteps(frame) {
  let f = frame;
  while (true) {
    if (f.currentStep === 'resolved') return f;
    const required = requiredPassesForStep(f.currentStep);
    if (required.length > 0) return f;
    f = advanceEngineStep(f);
  }
}
