/**
 * Phase-D behavioral probe — CRR-DT-005.
 *
 * CRR: "When a large figure enters difficult terrain, it spends only one
 * additional movement point regardless of how many spaces of difficult
 * terrain it occupies."
 *
 * The existing invariant_pin probe checks the source shape of
 * `enteringDifficult` (Array.some → boolean, not a count; single +1 surcharge
 * line). This probe exercises the cost calculator end-to-end via
 * `buildTempBoardState` + `computeMovementCache`, so a refactor that converts
 * the boolean into a per-cell tally fails on a concrete MP number instead of
 * a regex.
 *
 * Setup: 2x2 large figure on a 3-col × 2-row open grid. Moving right (dx=1)
 * the figure's entering cells are [c1, c2]. Varying how many of those are
 * difficult terrain lets us pin the rule directly.
 *
 * PROBE-DT-005-A: both entering cells difficult → 1 MP surcharge (cost 2)
 * PROBE-DT-005-B: one entering cell difficult → 1 MP surcharge (cost 2)
 * PROBE-DT-005-C: zero entering cells difficult → no surcharge (cost 1)
 * PROBE-DT-005-D: 1x1 parity — single-cell figure pays +1 the same way
 * PROBE-DT-005-E: ignoreDifficult (Massive/Mobile) zeroes the surcharge
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { buildTempBoardState, computeMovementCache } from '../../../src/game/movement.js';

// 3 cols (a,b,c) × 2 rows (1,2): 6 cells, fully adjacent.
const MAP = {
  spaces: ['a1', 'b1', 'c1', 'a2', 'b2', 'c2'],
  adjacency: {
    a1: ['b1', 'a2'], b1: ['a1', 'c1', 'b2'], c1: ['b1', 'c2'],
    a2: ['a1', 'b2'], b2: ['a2', 'c2', 'b1'], c2: ['b2', 'c1'],
  },
  terrain: {},
  blocking: [],
  movementBlockingEdges: [],
  impassableEdges: [],
};

const LARGE_PROFILE = {
  size: '2x2', cols: 2, rows: 2,
  isLarge: true, allowDiagonal: false, canRotate: false,
  isMassive: false, isMobile: false,
  ignoreDifficult: false, ignoreBlocking: false, ignoreFigureCost: false,
  canEndOnOccupied: false,
  treatBlockingAsDifficult: false,
};

const SMALL_PROFILE = {
  ...LARGE_PROFILE,
  size: '1x1', cols: 1, rows: 1, isLarge: false,
};

function costLargeRightStep({ difficultCells = [], profileOverrides = {} } = {}) {
  const terrain = {};
  for (const c of difficultCells) terrain[c] = 'difficult';
  const board = buildTempBoardState({ ...MAP, terrain }, [], null);
  const profile = { ...LARGE_PROFILE, ...profileOverrides };
  // Large 2x2 starting at topLeft=a1 (footprint a1,b1,a2,b2); step right reaches
  // topLeft=b1 (footprint b1,c1,b2,c2). Ending-cost is read from topLeft=b1.
  const cache = computeMovementCache('a1', 10, board, profile);
  return cache.cells.get('b1')?.cost;
}

function costSmallStep({ difficultCells = [], profileOverrides = {} } = {}) {
  const terrain = {};
  for (const c of difficultCells) terrain[c] = 'difficult';
  const board = buildTempBoardState({ ...MAP, terrain }, [], null);
  const profile = { ...SMALL_PROFILE, ...profileOverrides };
  const cache = computeMovementCache('a1', 10, board, profile);
  return cache.cells.get('b1')?.cost;
}

describe('PROBE-DT-005-A: large figure entering 2 difficult cells pays only +1 MP', () => {
  it('entering [c1, c2] both difficult costs 2 MP (base 1 + surcharge 1), NOT 3', () => {
    const cost = costLargeRightStep({ difficultCells: ['c1', 'c2'] });
    assert.equal(cost, 2,
      'CRR-DT-005: large figure pays only ONE additional MP regardless of how many DT cells it enters.');
  });
});

describe('PROBE-DT-005-B: large figure entering 1 of 2 difficult cells pays +1 MP', () => {
  it('entering [c1] difficult, [c2] normal costs 2 MP', () => {
    const cost = costLargeRightStep({ difficultCells: ['c1'] });
    assert.equal(cost, 2, 'Single difficult cell in the entering footprint → +1 surcharge.');
  });
  it('entering [c2] difficult, [c1] normal costs 2 MP (order-independent)', () => {
    const cost = costLargeRightStep({ difficultCells: ['c2'] });
    assert.equal(cost, 2, 'Surcharge is a boolean, not a per-cell tally.');
  });
});

describe('PROBE-DT-005-C: large figure entering 0 difficult cells pays no surcharge', () => {
  it('entering [c1, c2] both normal costs 1 MP', () => {
    const cost = costLargeRightStep({ difficultCells: [] });
    assert.equal(cost, 1, 'Control: no difficult cells → base cost only.');
  });
});

describe('PROBE-DT-005-D: 1x1 parity — small figure pays +1 on a single DT cell', () => {
  it('1x1 into b1 difficult costs 2 MP (sanity check — same rule, N=1)', () => {
    const cost = costSmallStep({ difficultCells: ['b1'] });
    assert.equal(cost, 2, 'Small figure also pays +1 — the difference is only in the N≥2 large case.');
  });
});

describe('PROBE-DT-005-E: ignoreDifficult zeroes the DT surcharge for large figures', () => {
  it('Massive/Mobile large figure entering [c1, c2] both difficult costs 1 MP', () => {
    const cost = costLargeRightStep({
      difficultCells: ['c1', 'c2'],
      profileOverrides: { ignoreDifficult: true },
    });
    assert.equal(cost, 1, 'ignoreDifficult (Massive/Mobile) must fully suppress DT surcharge.');
  });
});
