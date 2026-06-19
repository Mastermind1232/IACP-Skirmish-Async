/**
 * CC counter-window cancel rules (alexanbv 2026-06-17):
 *   Negate cancels cost-0 only (never Negate/Comms). Comms cancels cost ≤ SPY
 *   count (Negate needs ≥1 SPY, Comms needs ≥2 SPY).
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { canCancelCc, availableCounters, resolveCounterStack, NEGATION, COMM_DISRUPTION } from '../../../src/game/cc-counter-rules.js';

describe('canCancelCc — Negation', () => {
  it('cancels a cost-0 card', () => {
    assert.equal(canCancelCc(NEGATION, 0, 0), true);
    assert.equal(canCancelCc(NEGATION, 0, 5), true);
  });
  it('cannot cancel a cost-1+ card (so never Negation or Comms)', () => {
    assert.equal(canCancelCc(NEGATION, 1, 9), false); // Negation is cost 1
    assert.equal(canCancelCc(NEGATION, 2, 9), false); // Comm Disruption is cost 2
  });
});

describe('canCancelCc — Comm Disruption', () => {
  it('cancels a card whose cost ≤ the canceller SPY count (needs ≥1 SPY)', () => {
    assert.equal(canCancelCc(COMM_DISRUPTION, 0, 1), true);
    assert.equal(canCancelCc(COMM_DISRUPTION, 1, 1), true); // cancels Negation with ≥1 SPY
    assert.equal(canCancelCc(COMM_DISRUPTION, 2, 2), true); // cancels Comms with ≥2 SPY
  });
  it('cannot cancel with no SPY, or when cost exceeds SPY count', () => {
    assert.equal(canCancelCc(COMM_DISRUPTION, 0, 0), false); // needs ≥1 SPY group to use Comms at all
    assert.equal(canCancelCc(COMM_DISRUPTION, 1, 0), false);
    assert.equal(canCancelCc(COMM_DISRUPTION, 2, 1), false); // needs 2 SPY to cancel Comms
  });
});

describe('availableCounters', () => {
  it('cost-0 card: both counters are rule-legal with SPY', () => {
    assert.deepEqual(availableCounters(0, 1).sort(), [COMM_DISRUPTION, NEGATION].sort());
  });
  it('cost-0 card with 0 SPY: only Negation', () => {
    assert.deepEqual(availableCounters(0, 0), [NEGATION]);
  });
  it('a Negation (cost 1): only Comms, and only with ≥1 SPY', () => {
    assert.deepEqual(availableCounters(1, 1), [COMM_DISRUPTION]);
    assert.deepEqual(availableCounters(1, 0), []);
  });
  it('a Comms (cost 2): only Comms, and only with ≥2 SPY', () => {
    assert.deepEqual(availableCounters(2, 2), [COMM_DISRUPTION]);
    assert.deepEqual(availableCounters(2, 1), []);
  });
});

describe('resolveCounterStack — chains', () => {
  // alexanbv 2026-06-17: "write a test case for comms countering negate
  // countering element of surprise."
  it('Comms counters Negate counters Element of Surprise → Element of Surprise resolves', () => {
    const stack = [
      { card: 'Element of Surprise', cost: 0 },          // A plays it (cost 0)
      { card: NEGATION, cost: 1, spyCount: 0 },           // B Negates it (cost-0 target → legal)
      { card: COMM_DISRUPTION, cost: 2, spyCount: 1 },    // A Comms the Negation (cost-1 ≤ A's 1 SPY)
    ];
    assert.deepEqual(resolveCounterStack(stack), ['resolved', 'cancelled', 'resolved']);
  });

  it('Negate alone cancels a cost-0 card', () => {
    const stack = [
      { card: 'Element of Surprise', cost: 0 },
      { card: NEGATION, cost: 1, spyCount: 0 },
    ];
    assert.deepEqual(resolveCounterStack(stack), ['cancelled', 'resolved']);
  });

  it('a lone played card with no counter resolves', () => {
    assert.deepEqual(resolveCounterStack([{ card: 'Element of Surprise', cost: 0 }]), ['resolved']);
  });

  it('Comms cancels a cost-1 card directly', () => {
    const stack = [
      { card: 'Some Cost-1 Card', cost: 1 },
      { card: COMM_DISRUPTION, cost: 2, spyCount: 1 },
    ];
    assert.deepEqual(resolveCounterStack(stack), ['cancelled', 'resolved']);
  });

  it('Comms-counters-Comms-counters-cost-2 (needs the second Comms to have ≥2 SPY)', () => {
    const stack = [
      { card: 'Some Cost-2 Card', cost: 2 },
      { card: COMM_DISRUPTION, cost: 2, spyCount: 2 }, // B cancels it (2 SPY)
      { card: COMM_DISRUPTION, cost: 2, spyCount: 2 }, // A cancels the Comms (needs 2 SPY)
    ];
    assert.deepEqual(resolveCounterStack(stack), ['resolved', 'cancelled', 'resolved']);
  });

  // alexanbv 2026-06-19: "confirm comms can cancel comms can cancel negate can
  // cancel a 0 pt." The full 4-deep chain on a cost-0 card.
  it('Comms ← Comms ← Negate ← cost-0 card: the top Comms cancels the inner Comms, so Negate resolves and the 0-cost card is cancelled', () => {
    const stack = [
      { card: 'Element of Surprise', cost: 0 },           // A plays a cost-0 card
      { card: NEGATION, cost: 1, spyCount: 0 },            // B Negates it (cost-0 → legal)
      { card: COMM_DISRUPTION, cost: 2, spyCount: 1 },     // A Comms the Negation (cost-1 ≤ 1 SPY)
      { card: COMM_DISRUPTION, cost: 2, spyCount: 2 },     // B Comms A's Comms (cost-2 ≤ 2 SPY)
    ];
    // Top Comms resolves → cancels A's Comms → Negation resolves → cancels the 0-cost card.
    assert.deepEqual(resolveCounterStack(stack), ['cancelled', 'resolved', 'cancelled', 'resolved']);
  });
});
