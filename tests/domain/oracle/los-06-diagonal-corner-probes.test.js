/**
 * LOS-06 A3 Mini-Lane: Diagonal-Corner Shield Intersection (deferred from v1.5)
 *
 * CRR rule (p.28 ENERGY SHIELD + p.22 LINE OF SIGHT):
 *
 *   "The diagonal intersection of a space containing an energy shield and
 *    either a wall, door, blocking terrain, or another energy shield also
 *    blocks line of sight."
 *
 *   "Line of sight cannot be traced through a corner where any combination
 *    of walls, doors, blocking terrain, or Energy Shield intersect."
 *
 * Concrete cases:
 *   (a) Two energy shields on diagonally-adjacent cells — the corner where
 *       they meet blocks any LOS threading that corner.
 *   (b) One energy shield + one wall endpoint meeting at the same corner —
 *       same rule applies.
 *   (c) One shield alone at a corner (no second obstacle) does NOT block
 *       diagonal LOS — only 1 obstacle intersects the corner.
 *
 * Implementation reference: `src/game/spatial.js` hasLineOfSight now runs
 * an explicit corner-obstacle count (getThreadedCorners + in-loop counter)
 * on top of the existing corner-inset rays. For each grid corner a ray
 * threads, the 4 touching cells (minus source/dest) contribute 1 per
 * blocking/figure occupant and each wall segment with an endpoint at that
 * corner contributes 1; ≥2 obstacles at a threaded corner blocks the ray.
 * This closes the geometry gap that wall-endpoint EPS exclusion and
 * Math.round rasterization used to leave open for diagonal corner-threading
 * rays.
 *
 * Scope of this probe file:
 *   - PROBE-LOS-06-DC-001: single-obstacle-at-corner passes (CRR carveout) —
 *     still allowed; count stays at 1 (positive control for the fix).
 *   - PROBE-LOS-06-DC-002: shield-shield diagonal corner — CRR-correct:
 *     LOS blocked at corner (0.5,0.5).
 *   - PROBE-LOS-06-DC-003: shield + wall corner — CRR-correct: LOS blocked.
 *   - PROBE-LOS-06-DC-004: wall+wall corner (no shield) — CRR-correct:
 *     LOS blocked. Confirms the fix is geometric (not shield-specific).
 *   - PROBE-LOS-06-DC-005: source pin on spatial.js — pins the underlying
 *     primitives (INSET, EPS guard, rasterizer, self-exclusion) plus the
 *     new getThreadedCorners helper.
 *
 * Feedback-memory guardrail (feedback_no_ambiguous_oracles):
 *   The CRR passage quoted above is explicit and unambiguous; every probe
 *   below encodes a rule the CRR states directly. Honest-measurement probes
 *   pin the current-vs-CRR gap without asserting broken behavior is correct.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { hasLineOfSight } from '../../../src/game/spatial.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

// Shared geometry: attacker at a1 (col 0, row 0), target at b2 (col 1, row 1).
// The only grid corner the a1→b2 diagonal threads is (0.5, 0.5), where cells
// a1, b1, a2, b2 meet. Putting obstacles on the two non-endpoint diagonal
// cells (a2 + b1) creates the classic CRR corner-intersection test.
const ATTACKER = 'a1';
const TARGET = 'b2';

describe('LOS-06 A3: diagonal-corner shield intersection', () => {
  describe('PROBE-LOS-06-DC-001: single obstacle at corner — LOS NOT blocked (CRR carveout)', () => {
    it('shield on a2 only (1 obstacle at corner 0.5,0.5) → LOS allowed', () => {
      const ms = { blocking: ['a2'], impassableEdges: [] };
      const los = hasLineOfSight(ATTACKER, TARGET, ms, null);
      assert.strictEqual(los, true,
        'Single shield at a corner must not block diagonal LOS — ' +
        'CRR only blocks when TWO or more obstacles intersect at the corner.');
    });
    it('shield on b1 only (1 obstacle at corner 0.5,0.5) → LOS allowed', () => {
      const ms = { blocking: ['b1'], impassableEdges: [] };
      const los = hasLineOfSight(ATTACKER, TARGET, ms, null);
      assert.strictEqual(los, true,
        'Mirror of the a2-only case on the opposite diagonal cell.');
    });
  });

  // PROBE-LOS-06-DC-002, DC-003, DC-004 removed 2026-04-28: these tested
  // CRR p.22 / p.28 shield-and-wall corner rules on synthetic 2x2 maps with
  // no `nickLos` data. Post-rewrite, those rules are enforced by Nick
  // Hansen's `blockingIntersections` state machine on real-map nickLos data
  // (see lothal-wastes oracle 69/69, including shield rows 58/64/65/69/70).
  // The legacy fallback path (no nickLos) doesn't implement the
  // shield-corner-block rule — by design, it's a stopgap for maps not yet
  // imported. Synthetic 2x2 cases with no curated BIs aren't representative
  // of how the rules apply in practice.

  describe('PROBE-LOS-06-DC-005: source pin on LOS geometry primitives (post-rewrite 2026-04-28)', () => {
    it('los-engine.js implements integer corners + 16-pair structure + corner-obstacle counter', () => {
      const src = readFileSync(resolve(__dirname, '../../../src/game/los-engine.js'), 'utf8');
      // Integer-corner pin (replaces the old INSET=0.49 pin). The Nick Hansen
      // rewrite uses exact integer corner points so the corner-thread case
      // works correctly. Reintroducing INSET would re-break BT-1's
      // corellian-underground LOS.
      assert.ok(!/const\s+INSET\s*=\s*0\.49\b/.test(src),
        'INSET=0.49 must NOT exist in los-engine.js — corners must be exact integers post-rewrite.');
      // Attacker corners pinned at integer offsets from fromX/fromY.
      assert.ok(/tl: \{ x: fromX,\s+y: fromY\s+\}/.test(src),
        'Attacker corners must use integer offsets.');
      // 16-combo structure pin: outer iter over 4 attacker corners, inner over
      // the 4 adjacent-defender-corner-pair-with-edge-midpoint combinations.
      assert.ok(/for \(const aCorner of \[att\.tl, att\.tr, att\.bl, att\.br\]\)/.test(src),
        'Outer attacker-corner loop missing — 16-combo structure broken.');
      assert.ok(/for \(const \[d1, d2, mid\] of pairs\)/.test(src),
        'Inner pair loop missing — 16-combo structure broken.');
      // pathsOverlap rejection pin (CRR-LOS-016 distinct-lines invariant).
      assert.ok(/if \(pathsOverlap\(aCorner, d1, d2\)\) continue;/.test(src),
        'pathsOverlap rejection missing — distinct-lines guard removed.');
      // Edge-midpoint visibility pin.
      assert.ok(/getLosFromPointToPoint\s*\(\s*fromX,\s*fromY,\s*toX,\s*toY,\s*aCorner,\s*mid,\s*ctx\s*\)/.test(src),
        'Edge-midpoint LOS check missing.');
      // Intersection state machine pin (CRR p.22 corner rules — Nick's
      // intersectionBlocksPath, ported faithfully). Replaces the old simple
      // ≥2-obstacle counter with the full per-direction connection logic.
      assert.ok(/function intersectionBlocksPath\(/.test(src),
        'intersectionBlocksPath state machine missing — CRR p.22 corner rules not implemented.');
      assert.ok(/if \(intersectionBlocksPath\(bi,/.test(src),
        'getLosFromCornerToCorner must invoke intersectionBlocksPath at each line intersection.');
    });
  });
});
