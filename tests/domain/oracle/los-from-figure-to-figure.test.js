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

  it('Scenario 2: Lam moves the defender out of LoS behind terrain → LoS becomes false', () => {
    // Map has terrain (a blocking tile) at c4 — an asteroid / crate /
    // wall-cell that blocks LoS through its space. The cell occupies
    // col=2, row=3 in (0,0)-indexed grid coords.
    const map = makeMap(['c4']);
    const game = makeGame(map, {
      1: { 'Attacker DC-1-0': 'a3' },
      2: { 'Target DC-1-0':   'e3' },
    });
    const ctx = makeCtx();
    ctx.getMapData = () => map;

    // Declare time: target at e3. Line a3 → e3 is a horizontal sweep at
    // row 2 (b3, c3, d3, e3) — doesn't pass through the terrain at c4.
    // LoS exists and the picker offers the target.
    const losAtDeclare = hasLosFromFigureToFigure(game, 'Attacker DC-1-0', 'Target DC-1-0', ctx);
    assert.equal(losAtDeclare, true, 'clear horizontal line a3 → e3 → LoS exists at declare');

    // Lam (Loku Kanoloa) interrupts mid-combat: the controller of Lam
    // moves the defender 2 spaces from e3 down to e5. The new line of
    // sight a3 → e5 cuts diagonally through the c4 terrain tile.
    game.figurePositions[2]['Target DC-1-0'] = 'e5';

    // Roll time: probe re-traces a3 → e5. The diagonal line passes
    // through c4 (terrain blocker), so LoS is now lost. The probe MUST
    // abort here — and in the live handler the abort routes through
    // _forceMissAndStep8 so Migs/Han Return Fire etc. still resolve.
    const losAtRoll = hasLosFromFigureToFigure(game, 'Attacker DC-1-0', 'Target DC-1-0', ctx);
    assert.equal(losAtRoll, false, 'defender Lam-moved behind terrain → LoS lost at roll, probe must abort');
  });
});
