/**
 * [Smuggling Compartment] hand-protection — the reusable hook shared by every
 * ability that affects an opponent's CC hand (Interrogate, Headhunter, ...).
 *
 * Tests the pure-ish core: availability detection and the set-aside apply
 * (move out of hand + exhaust + stock the return pile). alexanbv 2026-06-17.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { scReactionAvailable, applyScSetAside } from '../../../src/handlers/sc-hand-protection.js';

function harness() {
  return {
    gameId: 'g1',
    player2Id: 'u2',
    player2CcHand: ['A', 'B', 'C'],
    p2DcList: [{ dcName: '[Smuggling Compartment]' }],
    p2DcMessageIds: ['m-sc'],
    exhaustedSkirmishUpgrades: {},
  };
}

describe('sc-hand-protection — scReactionAvailable', () => {
  it('true when the card is owned, un-exhausted, and the hand is non-empty', () => {
    assert.equal(scReactionAvailable(harness(), 2), true);
  });
  it('false when the card is already exhausted', () => {
    const g = harness();
    g.exhaustedSkirmishUpgrades['m-sc'] = ['Smuggling Compartment'];
    assert.equal(scReactionAvailable(g, 2), false);
  });
  it('false when the hand is empty', () => {
    const g = harness();
    g.player2CcHand = [];
    assert.equal(scReactionAvailable(g, 2), false);
  });
  it('false when the player does not own the card', () => {
    const g = harness();
    g.p2DcList = [{ dcName: 'Han Solo' }];
    assert.equal(scReactionAvailable(g, 2), false);
  });
});

describe('sc-hand-protection — applyScSetAside', () => {
  it('moves chosen cards out of hand, exhausts the card, and stocks the return pile', () => {
    const g = harness();
    const n = applyScSetAside(g, 2, ['A', 'C']);
    assert.equal(n, 2);
    assert.deepEqual(g.player2CcHand, ['B']);
    assert.deepEqual(g.smugglingCompartmentSetAside[2], ['A', 'C']);
    assert.ok((g.exhaustedSkirmishUpgrades['m-sc'] || []).some((x) => /Smuggling Compartment/.test(x)));
  });
  it('is a no-op (no exhaust) when nothing valid is chosen', () => {
    const g = harness();
    const n = applyScSetAside(g, 2, ['Z']);
    assert.equal(n, 0);
    assert.deepEqual(g.player2CcHand, ['A', 'B', 'C']);
    assert.equal(g.exhaustedSkirmishUpgrades['m-sc'], undefined);
  });
  it('appends across multiple calls (return pile accumulates)', () => {
    const g = harness();
    applyScSetAside(g, 2, ['A']);
    applyScSetAside(g, 2, ['B']);
    assert.deepEqual(g.smugglingCompartmentSetAside[2], ['A', 'B']);
  });
});
