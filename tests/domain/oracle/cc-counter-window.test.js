/**
 * Game-level CC counter-window orchestration (alexanbv 2026-06-17): the stack
 * state machine that drives the recursive Negate/Comms chain and resolves it via
 * the rule-aware logic. Models the full exchange the Discord layer will drive.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  openCounterWindow, counterResponder, topAvailableCounters, pushCounter,
  resolveAndCloseWindow, topCard,
} from '../../../src/game/cc-counter-window.js';

describe('CC counter-window — open + responder', () => {
  it('opens for a played card and prompts the opponent', () => {
    const game = { gameId: 'g1' };
    openCounterWindow(game, { card: 'Element of Surprise', cost: 0, playedBy: 1 });
    assert.equal(counterResponder(game), 2);
    assert.equal(topCard(game).card, 'Element of Surprise');
  });
});

describe('CC counter-window — Comms counters Negate counters Element of Surprise', () => {
  it('runs the full exchange and resolves Element of Surprise', () => {
    const game = { gameId: 'g1' };
    // P1 plays Element of Surprise (cost 0).
    openCounterWindow(game, { card: 'Element of Surprise', cost: 0, playedBy: 1 });
    assert.equal(counterResponder(game), 2);
    // P2 may Negate (cost-0 target). With 0 SPY, Comms isn't offered.
    assert.deepEqual(topAvailableCounters(game, 0), ['Negation']);
    // P2 plays Negation.
    assert.deepEqual(pushCounter(game, { card: 'Negation', cost: 1, playedBy: 2, spyCount: 0 }), { ok: true });
    // Now P1 is prompted; against a Negation (cost 1) only Comms with ≥1 SPY works.
    assert.equal(counterResponder(game), 1);
    assert.deepEqual(topAvailableCounters(game, 1), ['Comm Disruption']);
    // P1 plays Comm Disruption (has 1 SPY).
    assert.deepEqual(pushCounter(game, { card: 'Comm Disruption', cost: 2, playedBy: 1, spyCount: 1 }), { ok: true });
    // P2 is prompted; with 0 SPY they can't Comms the Comms → they pass.
    assert.equal(counterResponder(game), 2);
    assert.deepEqual(topAvailableCounters(game, 0), []);
    // Resolve: Comms resolves → cancels Negation → Element of Surprise resolves.
    const outcome = resolveAndCloseWindow(game);
    assert.deepEqual(outcome.map((e) => [e.card, e.status]), [
      ['Element of Surprise', 'resolved'],
      ['Negation', 'cancelled'],
      ['Comm Disruption', 'resolved'],
    ]);
    assert.equal(game.ccCounterWindow, undefined, 'window cleared after resolution');
  });
});

describe('CC counter-window — illegal counters rejected', () => {
  it('Negation cannot counter a Negation', () => {
    const game = { gameId: 'g1' };
    openCounterWindow(game, { card: 'Element of Surprise', cost: 0, playedBy: 1 });
    pushCounter(game, { card: 'Negation', cost: 1, playedBy: 2, spyCount: 0 });
    // P1 tries to Negate the Negation (cost 1) — illegal (Negation only hits cost-0).
    const r = pushCounter(game, { card: 'Negation', cost: 1, playedBy: 1, spyCount: 9 });
    assert.equal(r.ok, false);
  });

  it('a passed window with no counters resolves the lone card', () => {
    const game = { gameId: 'g1' };
    openCounterWindow(game, { card: 'Element of Surprise', cost: 0, playedBy: 1 });
    const outcome = resolveAndCloseWindow(game);
    assert.deepEqual(outcome.map((e) => [e.card, e.status]), [['Element of Surprise', 'resolved']]);
  });
});
