// Unit tests for the counter-window state machine (slice 3.2).

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  nextCounterPrompt,
  pushCcPlay,
  resolveTopCc,
  passCounterWindow,
  isTopCanceled,
  peekTop,
} from './combat-counter-window.js';

// ── pushCcPlay ────────────────────────────────────────────────────────────────

test('pushCcPlay onto empty stack creates depth=0 entry', () => {
  const { stack, entry, awaitingCounterFrom } = pushCcPlay([], {
    ccName: 'Brace for Impact',
    playerNum: 2,
  });
  assert.equal(stack.length, 1);
  assert.equal(entry.ccName, 'Brace for Impact');
  assert.equal(entry.playerNum, 2);
  assert.equal(entry.depth, 0);
  assert.equal(awaitingCounterFrom, 1, 'opponent prompted for counter');
});

test('pushCcPlay onto non-empty stack increments depth', () => {
  const { stack: s1 } = pushCcPlay([], { ccName: 'Brace', playerNum: 2 });
  const { stack: s2, entry, awaitingCounterFrom } = pushCcPlay(s1, {
    ccName: 'Comm Disruption',
    playerNum: 1,
  });
  assert.equal(s2.length, 2);
  assert.equal(entry.depth, 1);
  assert.equal(awaitingCounterFrom, 2, 'next prompt goes back to original CC owner');
});

test('pushCcPlay refuses counter from same player as top', () => {
  const { stack } = pushCcPlay([], { ccName: 'Brace', playerNum: 2 });
  assert.throws(() => pushCcPlay(stack, { ccName: 'Negation', playerNum: 2 }),
    /counter must come from opponent/);
});

// ── resolveTopCc ──────────────────────────────────────────────────────────────

test('resolveTopCc on a single play resolves it cleanly', () => {
  const { stack: s1 } = pushCcPlay([], { ccName: 'Brace', playerNum: 2 });
  const { stack: s2, resolvedEntry, canceledEntry } = resolveTopCc(s1);
  assert.equal(s2.length, 0, 'stack empty after resolve');
  assert.equal(resolvedEntry.ccName, 'Brace');
  assert.equal(resolvedEntry.resolved, true);
  assert.equal(canceledEntry, null, 'no canceled entry when resolving a top-level CC');
});

test('resolveTopCc on a counter cancels the CC below it', () => {
  const { stack: s1 } = pushCcPlay([], { ccName: 'Brace', playerNum: 2 });
  const { stack: s2 } = pushCcPlay(s1, { ccName: 'Comm Disruption', playerNum: 1 });
  const { stack: s3, resolvedEntry, canceledEntry } = resolveTopCc(s2);
  assert.equal(s3.length, 0, 'both entries pop after counter resolves and cancels target');
  assert.equal(resolvedEntry.ccName, 'Comm Disruption', 'counter resolves');
  assert.equal(resolvedEntry.resolved, true);
  assert.equal(canceledEntry.ccName, 'Brace', 'target CC is canceled');
  assert.equal(canceledEntry.canceled, true);
});

test('resolveTopCc on a counter-on-counter (depth 2) cancels the depth-1 counter', () => {
  // Sequence:
  //   P2 plays Brace (depth 0)
  //   P1 plays Comm Disruption to negate Brace (depth 1)
  //   P2 plays Negation to negate the CD (depth 2)
  //   No more counters → P2's Negation resolves, CD is canceled.
  //   The original Brace is therefore NOT canceled — its target (the CD that
  //   would have canceled it) is itself canceled, so Brace lives.
  let s = [];
  ({ stack: s } = pushCcPlay(s, { ccName: 'Brace', playerNum: 2 }));
  ({ stack: s } = pushCcPlay(s, { ccName: 'Comm Disruption', playerNum: 1 }));
  ({ stack: s } = pushCcPlay(s, { ccName: 'Negation', playerNum: 2 }));
  // Resolve the Negation
  const { stack: s2, resolvedEntry: r1, canceledEntry: c1 } = resolveTopCc(s);
  assert.equal(r1.ccName, 'Negation');
  assert.equal(c1.ccName, 'Comm Disruption', 'Negation cancels the CD');
  assert.equal(c1.canceled, true);
  // Brace remains on the stack and resolves next, normally
  assert.equal(s2.length, 1);
  assert.equal(s2[0].ccName, 'Brace');
  const { stack: s3, resolvedEntry: r2 } = resolveTopCc(s2);
  assert.equal(r2.ccName, 'Brace');
  assert.equal(s3.length, 0);
});

test('resolveTopCc throws on empty stack', () => {
  assert.throws(() => resolveTopCc([]), /stack is empty/);
});

// ── passCounterWindow ────────────────────────────────────────────────────────

test('passCounterWindow on a depth-0 CC resolves it', () => {
  const { stack: s1 } = pushCcPlay([], { ccName: 'Brace', playerNum: 2 });
  const { stack: s2, resolvedEntry, canceledEntry } = passCounterWindow(s1);
  assert.equal(s2.length, 0);
  assert.equal(resolvedEntry.ccName, 'Brace');
  assert.equal(canceledEntry, null);
});

test('passCounterWindow on a counter pops counter + cancels target', () => {
  // Defender plays Brace, attacker counters with CD, defender does not counter the CD.
  // → CD resolves, Brace canceled.
  let s = [];
  ({ stack: s } = pushCcPlay(s, { ccName: 'Brace', playerNum: 2 }));
  ({ stack: s } = pushCcPlay(s, { ccName: 'Comm Disruption', playerNum: 1 }));
  const { stack: s2, resolvedEntry, canceledEntry } = passCounterWindow(s);
  assert.equal(resolvedEntry.ccName, 'Comm Disruption');
  assert.equal(canceledEntry.ccName, 'Brace');
  assert.equal(canceledEntry.canceled, true);
  assert.equal(s2.length, 0);
});

// ── isTopCanceled / peekTop ───────────────────────────────────────────────────

test('isTopCanceled returns false on empty stack', () => {
  assert.equal(isTopCanceled([]), false);
});

test('peekTop returns null on empty stack', () => {
  assert.equal(peekTop([]), null);
});

test('peekTop returns top without mutating', () => {
  const { stack } = pushCcPlay([], { ccName: 'Brace', playerNum: 2 });
  const top = peekTop(stack);
  assert.equal(top.ccName, 'Brace');
  assert.equal(stack.length, 1, 'peek must not mutate');
});

// ── nextCounterPrompt ─────────────────────────────────────────────────────────

test('nextCounterPrompt returns null on empty stack', () => {
  assert.equal(nextCounterPrompt([]), null);
});

test('nextCounterPrompt always names the opponent of the top player', () => {
  const { stack: s1 } = pushCcPlay([], { ccName: 'Brace', playerNum: 2 });
  assert.equal(nextCounterPrompt(s1), 1);
  const { stack: s2 } = pushCcPlay(s1, { ccName: 'CD', playerNum: 1 });
  assert.equal(nextCounterPrompt(s2), 2);
  const { stack: s3 } = pushCcPlay(s2, { ccName: 'Negation', playerNum: 2 });
  assert.equal(nextCounterPrompt(s3), 1);
});
