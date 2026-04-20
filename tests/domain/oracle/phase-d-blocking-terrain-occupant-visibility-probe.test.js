/**
 * Phase-D probe: a figure with Massive or Mobile occupying blocking terrain
 * can still be traced LOS to, counted spaces to, and attacked by adjacent
 * figures.
 *
 * PROBE-PD-MSV-009: CRR MASSIVE — "A Massive figure occupying blocking
 *   terrain can be traced LOS to, counted spaces to, and attacked by
 *   adjacent figures."
 * PROBE-PD-MOB-003: CRR MOBILE — "A Mobile figure occupying blocking
 *   terrain can still be seen by LOS, have spaces counted to it, and be
 *   attacked by adjacent figures."
 *
 * Implementation: three unified invariants in `src/game/spatial.js`:
 *   (1) `hasLineOfSight` excludes the source AND target cells from the
 *       blocking-cell check (`if (col === a.col && row === a.row) continue;`
 *       and `if (col === b.col && row === b.row) continue;` before the
 *       `blockingSet.has(...)` read). So LOS can reach a target cell that
 *       sits on blocking terrain.
 *   (2) `getRange` is pure Manhattan over col/row and never reads terrain
 *       — so distance to a blocking-terrain occupant is the grid Manhattan
 *       distance (ADJ-007 / CS-005).
 *   (3) `isAdjacentCoords` = `getRange === 1` — adjacency is terrain-blind.
 *
 * Combined with MSV-001 (Massive excluded from figure-blocking set), these
 * three invariants cover both MSV-009 and MOB-003: a Massive or Mobile
 * occupant of blocking terrain is reachable by LOS, distance-countable,
 * and adjacency-determinable.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { getRange, isAdjacentCoords, hasLineOfSight } from '../../../src/game/spatial.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '../../..');
const SPATIAL_SRC = readFileSync(resolve(ROOT, 'src/game/spatial.js'), 'utf8');

describe('PROBE-PD-MSV-009/MOB-003: blocking-terrain occupants (Massive/Mobile) remain reachable', () => {
  it('009a: source — hasLineOfSight skips the target cell from the blocking-cell check', () => {
    assert.match(SPATIAL_SRC,
      /for \(const \[col, row\] of cells\) \{\s*\n\s*if \(col === a\.col && row === a\.row\) continue;\s*\n\s*if \(col === b\.col && row === b\.row\) continue;\s*\n\s*if \(blockingSet\.has\(colRowToCoord\(col, row\)\)\) \{ spaceBlocked = true; break; \}/,
      'hasLineOfSight must skip target cell (b) from blocking-cell check — CRR-MSV-009 / CRR-MOB-003');
  });

  it('009b: source — getRange is pure Manhattan, terrain-blind', () => {
    assert.match(SPATIAL_SRC,
      /export function getRange\(coord1, coord2\) \{[\s\S]*?return Math\.abs\(a\.col - b\.col\) \+ Math\.abs\(a\.row - b\.row\);/,
      'getRange is pure Manhattan distance — CRR-MSV-009 / CRR-MOB-003 (shared with ADJ-007)');
  });

  it('009c: source — isAdjacentCoords is getRange === 1 (terrain-blind)', () => {
    assert.match(SPATIAL_SRC,
      /export function isAdjacentCoords\(coord1, coord2\) \{\s*\n\s*return getRange\(coord1, coord2\) === 1;/,
      'isAdjacentCoords must be a thin Manhattan wrapper — CRR-MSV-009 / CRR-MOB-003');
  });

  it('009d: behavior — distance to a space that would hold a blocking-terrain occupant is grid Manhattan', () => {
    // Whether the occupant is Massive or Mobile or not, getRange returns
    // Manhattan — there is no per-occupant terrain gating.
    assert.equal(getRange('a1', 'a2'), 1,
      'distance is Manhattan regardless of who occupies the target — CRR-MSV-009 / CRR-MOB-003');
    assert.equal(isAdjacentCoords('a1', 'a2'), true,
      'adjacency is Manhattan === 1 regardless of occupant — CRR-MSV-009 / CRR-MOB-003');
  });

  it('009e: behavior — hasLineOfSight to a target cell that is itself in blocking works (no self-block)', () => {
    // Construct a 3-cell line where the TARGET cell is in blocking terrain
    // but the line has no wall and the middle is clear. The target-cell
    // blocking skip (009a) means LOS succeeds.
    const mapSpaces = {
      blocking: ['c1'], // target cell is blocking terrain
      impassableEdges: [],
    };
    assert.equal(hasLineOfSight('a1', 'c1', mapSpaces, null), true,
      'LOS to a blocking-terrain target cell succeeds because the target self-skips — CRR-MSV-009 / CRR-MOB-003');
  });

  it('009f: behavior — non-target blocking cells still block LOS (invariant does not break other rules)', () => {
    // b1 is blocking and is the MIDDLE of the line a1 → c1. LOS should fail.
    const mapSpaces = {
      blocking: ['b1'],
      impassableEdges: [],
    };
    assert.equal(hasLineOfSight('a1', 'c1', mapSpaces, null), false,
      'a blocking cell in the middle of the line still blocks LOS — CRR-MSV-009 / CRR-MOB-003 only lifts the target-self case');
  });
});
