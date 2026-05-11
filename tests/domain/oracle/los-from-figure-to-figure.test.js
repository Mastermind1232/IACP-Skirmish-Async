/**
 * Tests for hasLosFromFigureToFigure — the team-agnostic, directional
 * LoS oracle in src/game/effective-los.js. Pin two scenarios that
 * exercise the post-declare LoS probe in handleCombatRoll:
 *
 *   1. Neither figure moves between declare and roll → LoS stays true.
 *      Regression-pins the "false positive abort" class of bug where
 *      the probe disagreed with the picker on a static board.
 *
 *   2. Lam-style mid-combat move pushes the target into a non-LoS
 *      cell → LoS becomes false. Confirms the probe still catches
 *      legitimate LoS-loss after declaration.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { hasLosFromFigureToFigure } from '../../../src/game/effective-los.js';
import { getFootprintCells } from '../../../src/game/coords.js';

// ── Synthetic 5×5 map ────────────────────────────────────────────────────────
// Grid a1..e5. No closed doors / shields / smoke / broken walls. The only
// figure-blocking happens via the figurePositions on the game object — the
// LoS oracle builds its blocking set from there.
function makeMap(blocking = []) {
  const spaces = [];
  for (let r = 1; r <= 5; r++) {
    for (let c = 0; c < 5; c++) {
      spaces.push(String.fromCharCode(97 + c) + r);
    }
  }
  return {
    spaces,
    adjacency: {}, // not used by LoS
    blocking,
    impassableEdges: [],
    movementBlockingEdges: [],
  };
}

function makeCtx({ blockingFigureKwAtkr = [], blockingFigureKwTgt = [], blockingFigureKwOther = [] } = {}) {
  const dcEffectsByName = {
    'Attacker DC': { keywords: blockingFigureKwAtkr, abilityText: '', specialAbilityIds: [] },
    'Target DC':   { keywords: blockingFigureKwTgt,  abilityText: '', specialAbilityIds: [] },
    'Wall DC':     { keywords: blockingFigureKwOther, abilityText: '', specialAbilityIds: [] },
  };
  return {
    getDcEffects: () => dcEffectsByName,
    getFigureSize: () => '1x1',
    getMapData: () => null, // not used here — game.selectedMap.id only triggers existence check
    getMapTokensData: () => ({}),
    getFootprintCells,
  };
}

function makeGame(map, figurePositions) {
  return {
    selectedMap: { id: 'test-map' },
    figurePositions,
    // hasLosFromFigureToFigure pulls ms from ctx.getMapData(mapId); we override
    // by replacing _buildLosEffectiveMs's path — the function falls through to
    // null when ctx.getMapData returns null. Instead we install the synthetic
    // map by monkey-patching ctx.getMapData below in each test.
    _map: map,
  };
}

describe('hasLosFromFigureToFigure — post-declare LoS probe', () => {
  it('Scenario 1: figures have not moved → LoS remains true between declare and roll', () => {
    const map = makeMap();
    const game = makeGame(map, {
      1: { 'Attacker DC-1-0': 'a1' },
      2: { 'Target DC-1-0':   'e5' },
    });
    const ctx = makeCtx();
    ctx.getMapData = () => map;

    // Declare time: LoS exists, picker would offer the target.
    const losAtDeclare = hasLosFromFigureToFigure(game, 'Attacker DC-1-0', 'Target DC-1-0', ctx);
    assert.equal(losAtDeclare, true, 'open board → LoS should exist at declare');

    // Roll time: nothing changed. Probe must report the same verdict —
    // the picker's offer is still valid. This is the "false positive
    // abort" regression that motivated the original audit.
    const losAtRoll = hasLosFromFigureToFigure(game, 'Attacker DC-1-0', 'Target DC-1-0', ctx);
    assert.equal(losAtRoll, true, 'no state change → probe must agree with picker (no abort)');
  });

  it('Scenario 2: Lam moves a figure into the LoS line → LoS becomes false', () => {
    const map = makeMap();
    const game = makeGame(map, {
      1: { 'Attacker DC-1-0': 'a3' },
      2: { 'Target DC-1-0':   'e3' },
    });
    const ctx = makeCtx();
    ctx.getMapData = () => map;

    // Declare time: clear horizontal line a3 → e3, no blockers, LoS true.
    const losAtDeclare = hasLosFromFigureToFigure(game, 'Attacker DC-1-0', 'Target DC-1-0', ctx);
    assert.equal(losAtDeclare, true, 'clear line a3 → e3 → LoS exists at declare');

    // Lam (Loku Kanoloa) interrupts: moves a hostile figure into the line
    // of sight. Here we simulate by placing a friendly Wall DC figure at
    // c3, directly between the attacker and target. (Lam is the canonical
    // mid-combat-move ability the original probe was designed to catch.)
    game.figurePositions[1]['Wall DC-1-0'] = 'c3';

    // Roll time: probe sees the new blocker in the line — LoS is now false.
    // The probe MUST abort here (and in the live handler that routes to
    // step 8 so Migs/Han/etc. still resolve).
    const losAtRoll = hasLosFromFigureToFigure(game, 'Attacker DC-1-0', 'Target DC-1-0', ctx);
    assert.equal(losAtRoll, false, 'Lam-moved blocker in line → LoS lost at roll, probe must abort');
  });
});
