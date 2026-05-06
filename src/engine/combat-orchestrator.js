// Combat orchestrator (slice 3.3).
//
// Stitches the gate machine (combat-pipeline.js) and counter-window state
// machine (combat-counter-window.js) into a single driver over an
// AttackFrame. Pure: no Discord calls, no game state mutation. Caller is
// responsible for translating prompts (whoIsPrompted) into UI and feeding
// player decisions back via the action functions.
//
// Usage shape:
//   let o = createOrchestrator(frame);   // auto-advances past pre-declare
//   let prompt = whoIsPrompted(o);       // {kind:'step-pass', role:'attacker', step:'step1+2-attacker'}
//   o = declareCcPlay(o, {ccName:'Element of Surprise', playerNum:1});
//   prompt = whoIsPrompted(o);           // {kind:'counter-window', playerNum:2}
//   o = passCounter(o);                  // P2 declines → EoS resolves
//   o = passStep(o, 'attacker');         // P1 done with step1+2-attacker
//   ... etc through the canonical sequence

import { runEngineSteps, recordPlayerPass, requiredPassesForStep } from './combat-pipeline.js';
import {
  pushCcPlay,
  passCounterWindow,
  nextCounterPrompt,
} from './combat-counter-window.js';

/**
 * Construct an orchestrator state from a freshly-created AttackFrame.
 * Auto-runs past pre-declare and any other consecutive engine-driven
 * steps so the first prompt is meaningful (typically step1+2-attacker).
 */
export function createOrchestrator(frame) {
  return {
    frame: runEngineSteps(frame),
    transcript: [],
  };
}

/**
 * Player declares a CC. Pushes onto the counter stack so the opponent
 * can be prompted for a counter. The CC's effect is NOT yet applied —
 * effect resolution happens when the counter-window passes (passCounter)
 * or is countered itself.
 *
 * Throws if the player is the same as the top of stack (counter must be
 * from opponent — this is enforced by pushCcPlay).
 *
 * @param {object} o orchestrator
 * @param {{ ccName: string, playerNum: 1 | 2, payload?: object }} args
 */
export function declareCcPlay(o, { ccName, playerNum, payload = null }) {
  const { stack, entry } = pushCcPlay(o.frame.ccPlayStack, {
    ccName,
    playerNum,
    payload,
  });
  const newFrame = { ...o.frame, ccPlayStack: stack };
  return {
    ...o,
    frame: newFrame,
    transcript: [...o.transcript, {
      type: 'cc-declared',
      ccName,
      playerNum,
      depth: entry.depth,
    }],
  };
}

/**
 * Opponent declines to counter the top CC. Top resolves; if it's a counter
 * (depth >= 1), the CC below it is canceled (with all triggers suppressed
 * per destruct 2026-05-05).
 *
 * Returns the new orchestrator with `lastResolved` and `lastCanceled` set
 * for the caller to inspect (effect application + cleanup happens at the
 * call site).
 */
export function passCounter(o) {
  if (o.frame.ccPlayStack.length === 0) {
    throw new Error('passCounter: no pending CC play to counter');
  }
  const { stack: newStack, resolvedEntry, canceledEntry } = passCounterWindow(o.frame.ccPlayStack);
  const newFrame = { ...o.frame, ccPlayStack: newStack };
  const transcript = [
    ...o.transcript,
    { type: 'counter-window-passed' },
    {
      type: 'cc-resolved',
      ccName: resolvedEntry.ccName,
      playerNum: resolvedEntry.playerNum,
    },
  ];
  if (canceledEntry) {
    transcript.push({
      type: 'cc-canceled',
      ccName: canceledEntry.ccName,
      playerNum: canceledEntry.playerNum,
    });
  }
  return {
    ...o,
    frame: newFrame,
    transcript,
    lastResolved: resolvedEntry,
    lastCanceled: canceledEntry,
  };
}

/**
 * Player passes the current step. Advances the gate machine when all
 * required passes for that step are in. Throws if the role is wrong for
 * the current step (see recordPlayerPass).
 *
 * Auto-runs through any consecutive engine-driven steps after advance,
 * so the next whoIsPrompted is meaningful.
 *
 * @param {object} o
 * @param {'attacker' | 'defender'} role
 */
export function passStep(o, role) {
  if (o.frame.ccPlayStack.length > 0) {
    throw new Error(
      `passStep: cannot pass step while a CC play is pending in counter-window (top: ${o.frame.ccPlayStack[o.frame.ccPlayStack.length - 1].ccName})`
    );
  }
  const stepBefore = o.frame.currentStep;
  const { frame: postPass, advanced } = recordPlayerPass(o.frame, role);
  const finalFrame = runEngineSteps(postPass);
  return {
    ...o,
    frame: finalFrame,
    transcript: [
      ...o.transcript,
      { type: 'step-pass', role, step: stepBefore, advanced },
    ],
  };
}

/**
 * Returns the next prompt the caller should surface to a player, or null
 * if the attack is resolved.
 *
 * Prompt shapes:
 * - `{ kind: 'counter-window', playerNum }` — opponent of top CC must
 *   choose: counter or pass.
 * - `{ kind: 'step-pass', role, step }` — player whose step is active
 *   must finish their actions (declare any CCs, then pass).
 * - `null` — attack resolved.
 */
export function whoIsPrompted(o) {
  if (o.frame.currentStep === 'resolved') return null;
  if (o.frame.ccPlayStack.length > 0) {
    return {
      kind: 'counter-window',
      playerNum: nextCounterPrompt(o.frame.ccPlayStack),
    };
  }
  const required = requiredPassesForStep(o.frame.currentStep);
  if (required.length > 0) {
    return {
      kind: 'step-pass',
      role: required[0],
      step: o.frame.currentStep,
    };
  }
  // Engine-driven step with no prompt — caller should call advanceEngineStep
  // explicitly (or use runEngineSteps via passStep which auto-bridges).
  return {
    kind: 'engine-advance',
    step: o.frame.currentStep,
  };
}

/**
 * Returns true if the attack has fully resolved (terminal state).
 */
export function isResolved(o) {
  return o.frame.currentStep === 'resolved';
}
