/**
 * Phase-D probe: CRR MOVE-016 — "Additional MP costs apply to rotation if
 * the Large figure does not have Massive or Mobile."
 *
 * MOVE-015 (already covered) pins the 1-MP base cost for a plain rotation.
 * MOVE-016 extends that cost matrix: when a baseline Large figure (no
 * Massive / Mobile / Efficient Travel / Survivalist) rotates such that its
 * NEW footprint enters a difficult-terrain cell or a cell containing a
 * hostile figure, the +1 adder applies — the same rule as ordinary step
 * movement. Massive / Mobile set profile.ignoreDifficult + ignoreFigureCost
 * in getMovementProfile, so their rotation stays flat-1-MP.
 *
 * Implementation: src/game/movement.js → evaluateMovementStep, rotate branch
 * now derives `entering = nextFootprint \ prevFootprint` and adds +1 for
 * difficult terrain (gated by profile.ignoreDifficult) and +1 for hostile
 * figures (gated by profile.ignoreFigureCost), matching the ordinary-step
 * cost computation below it.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  computeMovementCache,
  getMovementTarget,
  buildTempBoardState,
} from '../../../src/game/movement.js';

function buildGrid(cols, rows, { difficult = [] } = {}) {
  const spaces = [];
  const adjacency = {};
  const terrain = {};
  const coord = (c, r) => String.fromCharCode(97 + c) + (r + 1);
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const k = coord(c, r);
      spaces.push(k);
      terrain[k] = difficult.includes(k) ? 'difficult' : 'normal';
      const neighbors = [];
      for (const [dc, dr] of [[0, -1], [0, 1], [-1, 0], [1, 0]]) {
        const nc = c + dc, nr = r + dr;
        if (nc >= 0 && nc < cols && nr >= 0 && nr < rows) neighbors.push(coord(nc, nr));
      }
      adjacency[k] = neighbors;
    }
  }
  return { spaces, adjacency, terrain, blocking: [], movementBlockingEdges: [], impassableEdges: [] };
}

// 1x2 Large figure (vertical). Will rotate 90° to 2x1 (horizontal, entering b1).
const baselineProfile = {
  size: '1x2', cols: 1, rows: 2, isLarge: true, allowDiagonal: false, canRotate: true,
  isMassive: false, isMobile: false,
  ignoreDifficult: false, ignoreBlocking: false, ignoreFigureCost: false,
  canEndOnOccupied: false,
};
const massiveProfile = { ...baselineProfile, isMassive: true, ignoreDifficult: true, ignoreFigureCost: true, canEndOnOccupied: true };
const mobileProfile  = { ...baselineProfile, isMobile:  true, ignoreDifficult: true, ignoreFigureCost: true };

describe('PROBE-PD-MOVE-016: rotation cost matrix (baseline vs Massive/Mobile)', () => {
  it('016a: baseline Large rotating into difficult terrain costs 2 MP (1 base + 1 difficult)', () => {
    // 1x2 at a1, footprint [a1,a2]. Rotate → 2x1 footprint [a1,b1]. b1 difficult.
    const mapSpaces = buildGrid(6, 6, { difficult: ['b1'] });
    const board = buildTempBoardState(mapSpaces, [], []);
    const cache = computeMovementCache('a1', 3, board, baselineProfile);
    const rotated = [...cache.nodes.values()].find((n) => n.topLeft === 'a1' && n.size === '2x1');
    assert.ok(rotated, 'rotated orientation reachable');
    assert.strictEqual(rotated.cost, 2, 'baseline rotation into difficult cell costs 2 MP — CRR-MOVE-016');
  });

  it('016b: Massive Large rotating into difficult terrain stays flat 1 MP (ignoreDifficult)', () => {
    const mapSpaces = buildGrid(6, 6, { difficult: ['b1'] });
    const board = buildTempBoardState(mapSpaces, [], []);
    const cache = computeMovementCache('a1', 3, board, massiveProfile);
    const rotated = [...cache.nodes.values()].find((n) => n.topLeft === 'a1' && n.size === '2x1');
    assert.ok(rotated, 'rotated orientation reachable');
    assert.strictEqual(rotated.cost, 1, 'Massive rotation into difficult cell stays 1 MP — CRR-MOVE-016');
  });

  it('016c: Mobile Large rotating into difficult terrain stays flat 1 MP (ignoreDifficult)', () => {
    const mapSpaces = buildGrid(6, 6, { difficult: ['b1'] });
    const board = buildTempBoardState(mapSpaces, [], []);
    const cache = computeMovementCache('a1', 3, board, mobileProfile);
    const rotated = [...cache.nodes.values()].find((n) => n.topLeft === 'a1' && n.size === '2x1');
    assert.ok(rotated, 'rotated orientation reachable');
    assert.strictEqual(rotated.cost, 1, 'Mobile rotation into difficult cell stays 1 MP — CRR-MOVE-016');
  });

  it('016d: baseline Large rotating into hostile-occupied cell costs 2 MP (1 base + 1 hostile) when canEndOnOccupied', () => {
    // Rotation still blocks when canEndOnOccupied=false, so use a Massive-style
    // end-on-occupied profile BUT keep ignoreFigureCost=false so the adder still applies.
    const hostileProfile = { ...baselineProfile, canEndOnOccupied: true };
    const mapSpaces = buildGrid(6, 6);
    const board = buildTempBoardState(mapSpaces, ['b1'], ['b1']); // b1 = hostile occupant
    const cache = computeMovementCache('a1', 3, board, hostileProfile);
    const rotated = [...cache.nodes.values()].find((n) => n.topLeft === 'a1' && n.size === '2x1');
    assert.ok(rotated, 'rotated orientation reachable when canEndOnOccupied');
    assert.strictEqual(rotated.cost, 2, 'baseline rotation into hostile cell costs 2 MP — CRR-MOVE-016');
  });

  it('016e: plain rotation (no difficult, no hostile) still costs 1 MP — MOVE-015 invariant preserved', () => {
    const mapSpaces = buildGrid(6, 6);
    const board = buildTempBoardState(mapSpaces, [], []);
    const cache = computeMovementCache('a1', 3, board, baselineProfile);
    const rotated = [...cache.nodes.values()].find((n) => n.topLeft === 'a1' && n.size === '2x1');
    assert.ok(rotated, 'rotated orientation reachable');
    assert.strictEqual(rotated.cost, 1, 'plain rotation = 1 MP — CRR-MOVE-015 preserved under MOVE-016 fix');
  });
});
