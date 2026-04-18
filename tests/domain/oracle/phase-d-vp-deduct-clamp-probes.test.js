/**
 * Phase-D probes: VP-deduction clamping invariant.
 *
 * PROBE-PD-VPS-005: If an ability requires paying more VPs than a player
 *   has, that player pays all remaining VPs (total clamps at 0; the
 *   requesting ability does not fail, it just drains what's available).
 *   (CRR VICTORY POINTS)
 *   Implementation: src/game/vp-helpers.js `deductVp` uses
 *   `Math.max(0, vp.total - amount)` and `Math.max(0, kills - remaining)`,
 *   so requesting 999 from a 3-VP player reduces total to 0 without
 *   erroring.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { awardKillVp, awardObjectiveVp, deductVp } from '../../../src/game/vp-helpers.js';

function makeGame() {
  return { gameId: 'vp-probe', player1VP: null, player2VP: null };
}

describe('PROBE-PD-VPS-005: deducting more VP than a player has drains to 0', () => {
  it('005a: deducting 99 from a 3-VP player clamps total/kills/objectives to 0', () => {
    const game = makeGame();
    awardObjectiveVp(game, 1, 1);
    awardKillVp(game, 1, 2);
    assert.equal(game.player1VP.total, 3);
    deductVp(game, 1, 99);
    assert.equal(game.player1VP.total, 0,
      `VPS-005: over-deduction must clamp total to 0 (got ${game.player1VP.total})`);
    assert.equal(game.player1VP.objectives, 0);
    assert.equal(game.player1VP.kills, 0);
  });

  it('005b: deducting from 0-VP player is a no-op, not an error', () => {
    const game = makeGame();
    deductVp(game, 2, 5);
    assert.equal(game.player2VP.total, 0);
  });
});
