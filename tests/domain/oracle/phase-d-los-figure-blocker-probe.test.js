/**
 * Phase-D LOS figure-blocker probes — CRR-LOS-001 / CRR-LOS-002.
 *
 * CRR p.28 names the LOS blocker set as "wall, door, non-companion figure,
 * energy shield, or blocking terrain". Existing slice-2 probes cover doors,
 * shields, and multi-cell footprints, but no probe exercises the
 * figure-as-blocker path. `hasLineOfSight` accepts a `figureBlockingCoords`
 * Set — these probes lock in that param's behavior so a refactor that drops
 * the check (or misspells the coord key) hard-fails here instead of silently
 * granting LOS through an interposed figure.
 *
 * Layout for all three probes is a straight east-west row:
 *   a3  b3  c3  d3  e3
 * with the attacker at a3 and target at e3. c3 is the collinear middle cell.
 *
 * PROBE-LOS-FIG-001: figure on c3 (collinear middle) blocks a3 → e3 LOS
 * PROBE-LOS-FIG-002: empty figureBlockingCoords leaves a3 → e3 LOS open (control)
 * PROBE-LOS-FIG-003: figure on an off-line cell (c5) does NOT block a3 → e3
 * PROBE-LOS-FIG-004: figure on target cell e3 itself does NOT self-block LOS
 * PROBE-LOS-FIG-005: figure on attacker cell a3 itself does NOT self-block LOS
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { hasLineOfSight } from '../../../src/game/spatial.js';

const EMPTY_MAP = { blocking: [], impassableEdges: [] };

describe('PROBE-LOS-FIG-001: non-companion figure on collinear middle cell blocks LOS', () => {
  it('a3 → e3 with figure on c3 returns false', () => {
    const figureBlockers = new Set(['c3']);
    const los = hasLineOfSight('a3', 'e3', EMPTY_MAP, figureBlockers);
    assert.strictEqual(los, false,
      'CRR: a non-companion figure on the sightline must block LOS (a3 → e3 blocked by c3).');
  });
});

describe('PROBE-LOS-FIG-002: empty figureBlockingCoords leaves LOS open (control)', () => {
  it('a3 → e3 with no figure blockers returns true', () => {
    const los = hasLineOfSight('a3', 'e3', EMPTY_MAP, new Set());
    assert.strictEqual(los, true,
      'Control: empty figureBlockingCoords must not block an otherwise-clear sightline.');
  });

  it('a3 → e3 with null figureBlockingCoords returns true', () => {
    const los = hasLineOfSight('a3', 'e3', EMPTY_MAP, null);
    assert.strictEqual(los, true,
      'Control: null figureBlockingCoords must not block an otherwise-clear sightline.');
  });
});

describe('PROBE-LOS-FIG-003: off-line figure does not block LOS', () => {
  it('a3 → e3 with figure on c5 (two rows off the line) returns true', () => {
    const figureBlockers = new Set(['c5']);
    const los = hasLineOfSight('a3', 'e3', EMPTY_MAP, figureBlockers);
    assert.strictEqual(los, true,
      'An off-line figure must not block a straight-row sightline.');
  });
});

describe('PROBE-LOS-FIG-004: figure on target cell does not self-block', () => {
  it('a3 → e3 with figure on e3 itself returns true', () => {
    const figureBlockers = new Set(['e3']);
    const los = hasLineOfSight('a3', 'e3', EMPTY_MAP, figureBlockers);
    assert.strictEqual(los, true,
      'A figure occupying the target cell must not self-block LOS to it.');
  });
});

describe('PROBE-LOS-FIG-005: figure on attacker cell does not self-block', () => {
  it('a3 → e3 with figure on a3 itself returns true', () => {
    const figureBlockers = new Set(['a3']);
    const los = hasLineOfSight('a3', 'e3', EMPTY_MAP, figureBlockers);
    assert.strictEqual(los, true,
      'A figure occupying the attacker cell must not self-block LOS from it.');
  });
});
