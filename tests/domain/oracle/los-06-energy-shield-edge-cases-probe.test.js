/**
 * LOS-06 Energy Shield Edge-Case Probes.
 *
 * Extends `los-06-energy-shield-probes.test.js` to cover the uncovered
 * edge cases that the original LOS audit flagged as "P2 open — mitigated
 * by engine self-exclusion." The mitigation lives at `src/game/spatial.js`:
 *
 *   - lines 174-175: source/dest cells are skipped in the blocking-set loop
 *   - lines 188-189: source/dest cells are skipped in the corner-intersection
 *     loop (CRR p.22/p.28 "≥2 obstacles at threaded corner" rule)
 *
 * The original probes covered attacker-on-shield, target-on-shield, and
 * shield-between for a 1x1 pair + 2x2 attacker. These probes close the
 * remaining edge cases:
 *
 *   PROBE-LOS-06-005: BOTH attacker and target on shield cells — double
 *     self-exclusion; LOS still drawn.
 *   PROBE-LOS-06-006: target on shield + blocker on path — target's own
 *     shield is self-excluded, but other blockers on the path still count.
 *   PROBE-LOS-06-007: 2x2 target with shield on one footprint cell — at
 *     least one target cell is reachable (symmetric to PROBE-004).
 *   PROBE-LOS-06-008: corner-intersection rule — a shield on the source
 *     cell is NOT double-counted at a threaded corner (source-cell
 *     self-exclusion applies in the corner loop too).
 *
 * These probes lock the engine-level fix for LOS-06. No handler-layer
 * exclusion is needed: the engine already absorbs the occupying-figure
 * exception at the hasLineOfSight boundary.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { hasLineOfSight } from '../../../src/game/spatial.js';
import { getFootprintCells } from '../../../src/game/coords.js';

// ── PROBE-LOS-06-005: both attacker AND target on shield cells ─────────────

describe('PROBE-LOS-06-005: both endpoints on shield cells — double self-exclusion', () => {
  it('b3 → e3 with shields on b3 AND e3 returns true', () => {
    // Both attacker and target stand on shield spaces. CRR allows LOS both
    // OUT of (rule 3) and INTO (rule 2) shield spaces independently, so the
    // combination must still resolve true: self-exclusion fires on both
    // endpoints of the path-blocking check at spatial.js:174-175.
    const mapSpaces = {
      blocking: ['b3', 'e3'],
      impassableEdges: [],
    };
    const los = hasLineOfSight('b3', 'e3', mapSpaces, null);
    assert.strictEqual(los, true,
      'Attacker on b3-shield AND target on e3-shield must still have LOS ' +
      '(double self-exclusion).');
  });
});

// ── PROBE-LOS-06-006: target-on-shield does not suppress other blockers ────

describe('PROBE-LOS-06-006: target self-exclusion does not ignore mid-path blockers', () => {
  it('b3 → e3 with shield on e3 (target) AND blocking on c3 returns false', () => {
    // Target on a shield is self-excluded at the destination. A SEPARATE
    // blocking-terrain cell between source and target must still block —
    // self-exclusion is per-cell, not a blanket suppression of the blocking
    // set. Positive control for PROBE-002's self-exclusion: verify it's
    // scoped correctly (only to the destination cell, not to every match).
    const mapSpaces = {
      blocking: ['e3', 'c3'],
      impassableEdges: [],
    };
    const los = hasLineOfSight('b3', 'e3', mapSpaces, null);
    assert.strictEqual(los, false,
      'Target on e3-shield is self-excluded, but mid-path blocker on c3 ' +
      'must still block LOS.');
  });

  it('b3 → e3 with shield on b3 (attacker) AND blocking on c3 returns false', () => {
    // Mirror of the above — attacker self-exclusion at the source must not
    // suppress other blockers on the path.
    const mapSpaces = {
      blocking: ['b3', 'c3'],
      impassableEdges: [],
    };
    const los = hasLineOfSight('b3', 'e3', mapSpaces, null);
    assert.strictEqual(los, false,
      'Attacker on b3-shield is self-excluded, but mid-path blocker on c3 ' +
      'must still block LOS.');
  });
});

// ── PROBE-LOS-06-007: multi-cell target with shield on footprint ───────────

describe('PROBE-LOS-06-007: 2x2 target — shield on target footprint does not hide target', () => {
  it('1x1 attacker at g3 against 2x2 target at a3 with shield on b3 — LOS true from ≥1 cell', () => {
    // Target is a 2x2 figure occupying {a3, b3, a4, b4}. Shield is on b3
    // (one cell of the target's own footprint). From the attacker g3 to
    // target cell b3: b3 IS self-excluded as destination → LOS true.
    // The handler's cell-× iteration accepts if any attacker × target cell
    // pair succeeds. Symmetric to PROBE-004 (shield on attacker footprint).
    const mapSpaces = { blocking: ['b3'], impassableEdges: [] };
    const targetCells = getFootprintCells('a3', '2x2');
    assert.strictEqual(targetCells.length, 4,
      `2x2 footprint must expand to 4 cells. Got: ${JSON.stringify(targetCells)}`);

    let anyHasLos = false;
    const losPerTargetCell = {};
    for (const cell of targetCells) {
      const seen = hasLineOfSight('g3', cell, mapSpaces, null);
      losPerTargetCell[cell] = seen;
      if (seen) anyHasLos = true;
    }

    assert.strictEqual(anyHasLos, true,
      `Attacker at g3 with 2x2 target at a3 and shield on b3 must have LOS ` +
      `to at least one target cell. Per-cell LOS: ${JSON.stringify(losPerTargetCell)}`);
    assert.strictEqual(losPerTargetCell['b3'], true,
      `LOS to b3 (the shield cell itself as target) must be allowed by ` +
      `destination self-exclusion. Per-cell LOS: ${JSON.stringify(losPerTargetCell)}`);
  });
});

// ── PROBE-LOS-06-008: corner-intersection self-exclusion ───────────────────

describe('PROBE-LOS-06-008: corner-intersection rule self-excludes source cell', () => {
  it('diagonal LOS with shield on source does not get corner-blocked by own shield', () => {
    // Source at b2, destination at d4 — diagonal ray passes through the
    // shared corner at c3/b3 and c3/b2 grid intersections. With shield
    // only on b2 (source), the corner-intersection loop at spatial.js:185
    // must self-exclude b2 via lines 188-189. Otherwise the attacker's own
    // shield would illegitimately corner-block their own LOS.
    const mapSpaces = {
      blocking: ['b2'],
      impassableEdges: [],
    };
    const los = hasLineOfSight('b2', 'd4', mapSpaces, null);
    assert.strictEqual(los, true,
      'Attacker on b2-shield must draw diagonal LOS to d4 without being ' +
      'corner-blocked by its own shield cell.');
  });

  it('positive control: two non-source shields at a threaded corner DO block', () => {
    // Same geometry but the shield is at c2 and c3 — two obstacles meeting
    // at the same threaded corner (c2/c3 shared edge), neither is source
    // or destination. Corner-intersection rule must fire: count >= 2.
    const mapSpaces = {
      blocking: ['c2', 'c3'],
      impassableEdges: [],
    };
    const los = hasLineOfSight('b2', 'd4', mapSpaces, null);
    assert.strictEqual(los, false,
      'Two shields at a threaded corner (c2+c3) must corner-block LOS from ' +
      'b2 to d4.');
  });
});
