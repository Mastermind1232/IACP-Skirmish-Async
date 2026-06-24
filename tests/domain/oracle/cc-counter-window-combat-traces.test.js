/**
 * Combat counter-window traces (alexanbv 2026-06-17: "carefully implement the
 * combat window... write test cases for yourself to trace. Use the two
 * Baze/Migs and Vader/HK examples and add in that one or both players have
 * negate and comms").
 *
 * Combat CCs go through the SAME counter-window as hand CCs — the only
 * difference is figure + timing are prepopulated. These traces drive the tested
 * orchestrator (openCounterWindow → pushCounter → resolveAndCloseWindow) with
 * combat-flavored plays, covering: no counter, a single Negate/Comms cancel, and
 * recursive chains when one or both players hold Negate and Comms.
 *
 * Rules recap: Negate (cost 1) cancels cost-0 only; Comms (cost 2) needs ≥1 SPY
 * and cancels cost ≤ SPY (Negate needs ≥1 SPY, Comms needs ≥2).
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  openCounterWindow, counterResponder, topAvailableCounters, pushCounter, resolveAndCloseWindow,
  NEGATION, COMM_DISRUPTION,
} from '../../../src/handlers/cc-pipeline.js';

// Helper: status map for a finished window.
function statuses(outcome) { return outcome.map((e) => [e.card, e.status]); }

// ── Baze Malbus (P1) attacks Migs Mayfeld (P2) ──────────────────────────────
describe('Combat trace — Baze vs Migs', () => {
  it('Baze plays a cost-1 combat CC; Migs has no SPY → no counter offered → it resolves', () => {
    const game = { gameId: 'baze1' };
    // figure + timing prepopulated for a combat play; the window only cares about card/cost.
    openCounterWindow(game, { card: 'Vibro-Knucklers', cost: 1, playedBy: 1, figureKey: 'Baze Malbus-1-0' });
    assert.equal(counterResponder(game), 2);
    assert.deepEqual(topAvailableCounters(game, 0), []); // Migs: 0 SPY, no Negate target (cost 1) → nothing
    assert.deepEqual(statuses(resolveAndCloseWindow(game)), [['Vibro-Knucklers', 'resolved']]);
  });

  it("Baze plays a cost-1 combat CC; Migs has 1 SPY + Comms → Comms cancels it", () => {
    const game = { gameId: 'baze2' };
    openCounterWindow(game, { card: 'Vibro-Knucklers', cost: 1, playedBy: 1, figureKey: 'Baze Malbus-1-0' });
    assert.deepEqual(topAvailableCounters(game, 1), [COMM_DISRUPTION]); // cost-1 ≤ 1 SPY
    assert.deepEqual(pushCounter(game, { card: COMM_DISRUPTION, cost: 2, playedBy: 2, spyCount: 1 }), { ok: true });
    // Baze prompted to counter the Comms (cost 2) — needs 2 SPY; Baze has none → can't.
    assert.deepEqual(topAvailableCounters(game, 0), []);
    assert.deepEqual(statuses(resolveAndCloseWindow(game)), [
      ['Vibro-Knucklers', 'cancelled'],
      [COMM_DISRUPTION, 'resolved'],
    ]);
  });

  it('Baze plays a cost-0 combat CC; Migs Negates; Baze (1 SPY) Comms the Negate → the CC resolves', () => {
    const game = { gameId: 'baze3' };
    openCounterWindow(game, { card: 'Element of Surprise', cost: 0, playedBy: 1, figureKey: 'Baze Malbus-1-0' });
    assert.deepEqual(topAvailableCounters(game, 0), [NEGATION]); // Migs may Negate a cost-0 card
    pushCounter(game, { card: NEGATION, cost: 1, playedBy: 2, spyCount: 0 });
    assert.equal(counterResponder(game), 1);
    assert.deepEqual(topAvailableCounters(game, 1), [COMM_DISRUPTION]); // Baze Comms the Negation (1 SPY)
    pushCounter(game, { card: COMM_DISRUPTION, cost: 2, playedBy: 1, spyCount: 1 });
    assert.deepEqual(statuses(resolveAndCloseWindow(game)), [
      ['Element of Surprise', 'resolved'],
      [NEGATION, 'cancelled'],
      [COMM_DISRUPTION, 'resolved'],
    ]);
  });
});

// ── Darth Vader (P1) attacks HK assassin droids (P2) ────────────────────────
describe('Combat trace — Vader vs HK', () => {
  it('Vader plays a cost-0 combat CC; HK Negates it → cancelled', () => {
    const game = { gameId: 'vader1' };
    openCounterWindow(game, { card: 'Price of Glory', cost: 0, playedBy: 1, figureKey: 'Darth Vader-1-0' });
    pushCounter(game, { card: NEGATION, cost: 1, playedBy: 2, spyCount: 0 });
    assert.deepEqual(statuses(resolveAndCloseWindow(game)), [
      ['Price of Glory', 'cancelled'],
      [NEGATION, 'resolved'],
    ]);
  });

  it('both hold Negate + Comms: Vader cost-0 CC → HK Negate → Vader Comms → HK Comms the Comms (2 SPY) → the original is cancelled again', () => {
    const game = { gameId: 'vader2' };
    // P1 Vader plays a cost-0 combat CC.
    openCounterWindow(game, { card: 'Price of Glory', cost: 0, playedBy: 1, figureKey: 'Darth Vader-1-0' });
    // P2 HK Negates it.
    pushCounter(game, { card: NEGATION, cost: 1, playedBy: 2, spyCount: 2 });
    // P1 Vader Comms the Negation (1 SPY enough).
    pushCounter(game, { card: COMM_DISRUPTION, cost: 2, playedBy: 1, spyCount: 2 });
    // P2 HK Comms Vader's Comms (cost 2 → needs 2 SPY, HK has 2).
    assert.deepEqual(topAvailableCounters(game, 2), [COMM_DISRUPTION]);
    pushCounter(game, { card: COMM_DISRUPTION, cost: 2, playedBy: 2, spyCount: 2 });
    // Resolution unwinds: top Comms resolves → cancels Vader's Comms → Vader's Comms
    // can't cancel the Negation → Negation resolves → cancels the original CC.
    assert.deepEqual(statuses(resolveAndCloseWindow(game)), [
      ['Price of Glory', 'cancelled'],
      [NEGATION, 'resolved'],
      [COMM_DISRUPTION, 'cancelled'],
      [COMM_DISRUPTION, 'resolved'],
    ]);
  });

  it('Vader plays a cost-2 combat CC; HK (1 SPY) cannot Comms it (needs 2) → it resolves', () => {
    const game = { gameId: 'vader3' };
    openCounterWindow(game, { card: 'Some Cost-2 Combat CC', cost: 2, playedBy: 1, figureKey: 'Darth Vader-1-0' });
    assert.deepEqual(topAvailableCounters(game, 1), []); // cost-2 needs 2 SPY for Comms; Negate can't (cost>0)
    assert.deepEqual(statuses(resolveAndCloseWindow(game)), [['Some Cost-2 Combat CC', 'resolved']]);
  });
});
