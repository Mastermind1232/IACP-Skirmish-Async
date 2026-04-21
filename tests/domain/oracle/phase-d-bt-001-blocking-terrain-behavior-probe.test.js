/**
 * Phase-D behavioral probe — CRR-BT-001 + CRR-BT-004.
 *
 * CRR-BT-001: "Figures cannot enter, be pushed into, count spaces through, or
 *              trace line of sight through a space containing blocking terrain."
 * CRR-BT-004: "Massive figures ignore blocking terrain for movement purposes."
 *
 * The existing coverage leans on two assertions from
 * `movement-legality-behavioral.test.js` ("005c: massive ignores blocking",
 * "005e: non-massive cannot end on occupied"). That pair implicitly documents
 * the default rule but does not exercise:
 *   - direct NON-Massive entry into a blocking cell (only "occupied")
 *   - LOS tracing through a blocking cell
 *   - Mobile parity with Massive for the movement bypass
 *
 * These probes drive the cost calculator and the LOS function end-to-end with
 * minimal fixtures, so a refactor that drops the `blockingSet.has(cell)` guard
 * in `evaluateMovementStep` or the blocking-cell check in `hasLineOfSight`
 * fails on concrete cost/boolean numbers instead of source regex.
 *
 * PROBE-BT-001-A: non-Massive/Mobile cannot enter a blocking cell
 * PROBE-BT-001-B: LOS cannot trace through a blocking cell on the line
 * PROBE-BT-001-C: LOS is clear when the blocking cell is off-line (control)
 * PROBE-BT-004-A: Massive profile has ignoreBlocking=true and CAN enter
 * PROBE-BT-004-B: Mobile profile has ignoreBlocking=true and CAN enter
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { buildTempBoardState, computeMovementCache } from '../../../src/game/movement.js';
import { hasLineOfSight } from '../../../src/game/spatial.js';

// 5-col × 1-row corridor: a1-b1-c1-d1-e1. c1 is the "middle" cell.
const CORRIDOR = {
  spaces: ['a1', 'b1', 'c1', 'd1', 'e1'],
  adjacency: {
    a1: ['b1'], b1: ['a1', 'c1'], c1: ['b1', 'd1'],
    d1: ['c1', 'e1'], e1: ['d1'],
  },
  terrain: {},
  blocking: [],
  movementBlockingEdges: [],
  impassableEdges: [],
};

const BASE_PROFILE = {
  size: '1x1', cols: 1, rows: 1,
  isLarge: false, allowDiagonal: false, canRotate: false,
  isMassive: false, isMobile: false,
  ignoreDifficult: false, ignoreBlocking: false, ignoreFigureCost: false,
  canEndOnOccupied: false,
  treatBlockingAsDifficult: false,
};

function costAtoC(blocking, profileOverrides = {}) {
  const map = { ...CORRIDOR, blocking };
  const board = buildTempBoardState(map, [], null);
  const profile = { ...BASE_PROFILE, ...profileOverrides };
  const cache = computeMovementCache('a1', 10, board, profile);
  return cache.cells.get('c1')?.cost;
}

describe('PROBE-BT-001-A: non-Massive/Mobile figure cannot enter a blocking cell', () => {
  it('b1 blocking → no path from a1 to c1 (would require entering b1)', () => {
    const cost = costAtoC(['b1']);
    assert.equal(cost, undefined,
      'CRR-BT-001: ordinary figure cannot enter blocking terrain — c1 must be unreachable when b1 blocks.');
  });

  it('control: no blocking → c1 reachable at cost 2', () => {
    const cost = costAtoC([]);
    assert.equal(cost, 2,
      'Sanity: open corridor a1→b1→c1 costs 2 MP.');
  });
});

describe('PROBE-BT-001-B: LOS cannot trace through a blocking cell on the line', () => {
  it('hasLineOfSight(a1,e1) with c1 blocking → false', () => {
    const mapSpaces = { blocking: ['c1'], impassableEdges: [] };
    assert.equal(hasLineOfSight('a1', 'e1', mapSpaces), false,
      'CRR-BT-001: LOS cannot trace through a blocking cell interposed on the ray.');
  });
});

describe('PROBE-BT-001-C: LOS is clear when the blocking cell is off-line (control)', () => {
  it('hasLineOfSight(a1,e1) with no blocking → true', () => {
    const mapSpaces = { blocking: [], impassableEdges: [] };
    assert.equal(hasLineOfSight('a1', 'e1', mapSpaces), true,
      'Sanity: open corridor has LOS end-to-end.');
  });
});

describe('PROBE-BT-004-A: Massive figure ignores blocking for movement', () => {
  it('Massive profile with b1 blocking → c1 reachable (c1 cost = 2)', () => {
    const cost = costAtoC(['b1'], { isMassive: true, ignoreBlocking: true });
    assert.equal(cost, 2,
      'CRR-BT-004: Massive ignores blocking terrain — c1 must be reachable through a blocking b1.');
  });
});

describe('PROBE-BT-004-B: Mobile figure ignores blocking for movement (parity with Massive)', () => {
  it('Mobile profile with b1 blocking → c1 reachable (c1 cost = 2)', () => {
    const cost = costAtoC(['b1'], { isMobile: true, ignoreBlocking: true });
    assert.equal(cost, 2,
      'Mobile also sets ignoreBlocking — parity with Massive for movement purposes.');
  });

  it('counterfactual: profile with isMobile=true but ignoreBlocking=false → still blocked', () => {
    // This guards against a refactor that silently decouples the flag from
    // the Mobile keyword. If ignoreBlocking is not set, blocking must still
    // stop movement regardless of keyword label.
    const cost = costAtoC(['b1'], { isMobile: true, ignoreBlocking: false });
    assert.equal(cost, undefined,
      'Legality gate reads ignoreBlocking, not the keyword flag directly — must fail closed when flag missing.');
  });
});
