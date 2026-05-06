// Counter-window state machine (slice 3.2).
//
// Per destruct's 2026-05-05 audit: every CC play opens an opponent-only
// counter-window. Cancellation comprehensively suppresses the canceled
// CC's effects — including "when discarded" triggers (the YWNDM /
// Second Chance pattern doesn't fire when the host CC is canceled).
//
// Counters are recursive: Negation on Brace (depth 1), Comm Disruption on
// Negation (depth 2), Negation on Comm Disruption (depth 3), etc. Each
// level alternates which player gets prompted.
//
// Pure state-transition functions over the AttackFrame.ccPlayStack.

import { makeCcPlayStackEntry } from './combat-frame.js';

/** Returns the player who should be prompted next on the counter-window. */
export function nextCounterPrompt(stack) {
  if (stack.length === 0) return null;
  const top = stack[stack.length - 1];
  // The opponent of the player who just played the top of the stack.
  return top.playerNum === 1 ? 2 : 1;
}

/**
 * Push a new CC play onto the stack. If the stack is non-empty, this is a
 * counter — depth = top.depth + 1.
 *
 * Returns `{ stack: newStack, entry, awaitingCounterFrom: playerNum }`.
 *
 * @param {object[]} stack
 * @param {{ ccName: string, playerNum: 1 | 2, payload?: object }} args
 */
export function pushCcPlay(stack, { ccName, playerNum, payload }) {
  const top = stack[stack.length - 1];
  if (top && top.playerNum === playerNum) {
    throw new Error(`pushCcPlay: counter must come from opponent (top played by ${top.playerNum}, attempted ${playerNum})`);
  }
  const depth = top ? top.depth + 1 : 0;
  const entry = makeCcPlayStackEntry({ ccName, playerNum, payload, depth });
  const newStack = [...stack, entry];
  return {
    stack: newStack,
    entry,
    awaitingCounterFrom: playerNum === 1 ? 2 : 1,
  };
}

/**
 * Resolve the top CC play. Pops it from the stack and marks it resolved. If
 * the stack still has entries below, the next-down CC is now considered
 * canceled (the resolved counter consumed it).
 *
 * Returns `{ stack: newStack, resolvedEntry, canceledEntry }`. canceledEntry
 * is null when resolving a top-level (non-counter) CC.
 */
export function resolveTopCc(stack) {
  if (stack.length === 0) {
    throw new Error('resolveTopCc: stack is empty');
  }
  const top = { ...stack[stack.length - 1], resolved: true };
  let canceledEntry = null;
  let newStack = stack.slice(0, -1);
  if (newStack.length > 0) {
    // The next-down CC is being canceled by this counter.
    const target = newStack[newStack.length - 1];
    canceledEntry = { ...target, canceled: true };
    newStack = [...newStack.slice(0, -1), canceledEntry];
    // Then pop the canceled CC too — it's done.
    newStack = newStack.slice(0, -1);
  }
  return { stack: newStack, resolvedEntry: top, canceledEntry };
}

/**
 * Pass the counter-window — opponent declines to counter. The top of stack
 * resolves normally (its effects fire). If the top is itself a counter, the
 * CC below it is canceled.
 *
 * Functionally identical to resolveTopCc but with semantically clearer name
 * for the "no counter played" case.
 */
export function passCounterWindow(stack) {
  return resolveTopCc(stack);
}

/**
 * Returns true if the top of stack is canceled (its effects must be
 * suppressed before discard, per destruct 2026-05-05).
 */
export function isTopCanceled(stack) {
  if (stack.length === 0) return false;
  return stack[stack.length - 1].canceled === true;
}

/**
 * Inspect the top of stack without mutating it.
 */
export function peekTop(stack) {
  if (stack.length === 0) return null;
  return stack[stack.length - 1];
}
