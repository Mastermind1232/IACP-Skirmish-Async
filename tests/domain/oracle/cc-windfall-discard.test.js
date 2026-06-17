/**
 * Windfall (Doctor Aphra) + the central "when discarded" subroutine.
 *
 * alexanbv 2026-06-17: "Windfall should not need a flag. It is a discrete one
 * time event on play and a discrete one time event on discard." And: "When a
 * card is discarded (does NOT count when a CC is used/played) there should be a
 * marker that triggers a 'when discarded' subroutine. ... built on hope,
 * windfall, should have hooks into this."
 *
 *  - fireCcDiscarded: re-draw passives + Windfall hooks (and records the
 *    discarded card's cost for a Windfall reaction-play).
 *  - Windfall ccEffect (windfallOnPlay): gain VP equal to the recorded cost.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { fireCcDiscarded } from '../../../src/game/cc-passive-redraw.js';
import { resolveAbility } from '../../../src/game/abilities.js';

function vp(game, pn) { return (pn === 1 ? game.player1VP : game.player2VP)?.total ?? 0; }

describe('fireCcDiscarded — Windfall self-discard (+1 VP)', () => {
  it('awards 1 VP to the owner when Windfall itself is discarded', () => {
    const game = { player1VP: { total: 2, kills: 0, objectives: 0 } };
    const out = fireCcDiscarded(game, 1, 'Windfall', { fromDeck: false });
    assert.equal(out.windfallSelfVp, 1);
    assert.equal(vp(game, 1), 3);
  });
  it('does not award self-VP for a non-Windfall discard', () => {
    const game = { player2VP: { total: 0, kills: 0, objectives: 0 } };
    const out = fireCcDiscarded(game, 2, 'Some Other Card', { fromDeck: false });
    assert.equal(out.windfallSelfVp, 0);
    assert.equal(vp(game, 2), 0);
  });
  it('records the discarded card cost per player for a Windfall reaction-play', () => {
    const game = {};
    fireCcDiscarded(game, 1, 'Windfall', { fromDeck: false }); // Windfall is cost 0
    assert.equal(game.windfallDiscardCost[1], 0);
  });
});

describe('Windfall ccEffect — reaction play gains VP = discarded card cost', () => {
  it('gains VP equal to the recorded discard cost, then clears the marker', () => {
    const game = { player1VP: { total: 0, kills: 0, objectives: 0 }, windfallDiscardCost: { 1: 3 } };
    const r = resolveAbility('Windfall', { game, playerNum: 1 });
    assert.equal(r.applied, true);
    assert.equal(vp(game, 1), 3);
    assert.equal(game.windfallDiscardCost[1], undefined, 'marker cleared after use');
  });
  it('gains 0 when there is no recent discard to value', () => {
    const game = { player1VP: { total: 5, kills: 0, objectives: 0 } };
    const r = resolveAbility('Windfall', { game, playerNum: 1 });
    assert.equal(r.applied, true);
    assert.equal(vp(game, 1), 5);
  });
});
