/**
 * CC counter-window cancel rules (alexanbv 2026-06-17):
 *   Negate cancels cost-0 only (never Negate/Comms). Comms cancels cost ≤ SPY
 *   count (Negate needs ≥1 SPY, Comms needs ≥2 SPY).
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { canCancelCc, availableCounters, NEGATION, COMM_DISRUPTION } from '../../../src/game/cc-counter-rules.js';

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
