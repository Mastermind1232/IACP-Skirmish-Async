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

  describe('PROBE-LOS-06-DC-002: two shields diagonal-corner intersection', () => {
    it('shields at a2 AND b1 → LOS BLOCKED at corner (0.5,0.5) [CRR p.28]', () => {
      const ms = { blocking: ['a2', 'b1'], impassableEdges: [] };
      const losActual = hasLineOfSight(ATTACKER, TARGET, ms, null);
      assert.strictEqual(losActual, false,
        'Two shields on diagonally-adjacent cells must block LOS at ' +
        'their shared corner (0.5, 0.5). CRR p.28 energy-shield corner rule.');
    });
  });

  describe('PROBE-LOS-06-DC-003: shield + wall corner intersection', () => {
    it('shield at a2 AND wall between b1|b2 → LOS BLOCKED at corner (0.5,0.5) [CRR p.28]', () => {
      // Wall b1|b2 has endpoints (0.5, 0.5) and (1.5, 0.5); its west
      // endpoint is exactly the intersection corner with the shield at a2.
      const ms = { blocking: ['a2'], impassableEdges: [['b1', 'b2']] };
      const losActual = hasLineOfSight(ATTACKER, TARGET, ms, null);
      assert.strictEqual(losActual, false,
        'Energy shield + wall endpoint sharing corner (0.5, 0.5) ' +
        'must block diagonal LOS. CRR p.28 shield-wall corner rule.');
    });
  });

  describe('PROBE-LOS-06-DC-004: wall + wall corner (shield-free control)', () => {
    it('walls a1|a2 AND b1|b2 both terminate at corner (0.5,0.5) → LOS BLOCKED [CRR p.22]', () => {
      // wall a1|a2: horizontal segment at y=0.5, x ∈ [-0.5, 0.5] — east endpoint (0.5, 0.5)
      // wall b1|b2: horizontal segment at y=0.5, x ∈ [ 0.5, 1.5] — west endpoint (0.5, 0.5)
      const ms = { blocking: [], impassableEdges: [['a1', 'a2'], ['b1', 'b2']] };
      const losActual = hasLineOfSight(ATTACKER, TARGET, ms, null);
      assert.strictEqual(losActual, false,
        'Two walls sharing endpoint (0.5, 0.5) must block diagonal LOS. ' +
        'CRR p.22 line-of-sight corner rule. Shield-free control — ' +
        'confirms the fix is geometric, not shield-specific.');
    });
  });

  describe('PROBE-LOS-06-DC-005: source pin on hasLineOfSight geometry primitives', () => {
    it('spatial.js still uses INSET=0.49, strict-endpoint wall exclusion, and Math.round rasterization', () => {
      const src = readFileSync(resolve(__dirname, '../../../src/game/spatial.js'), 'utf8');
      // INSET pin: the corner inset is the reason corner-threading rays
      // exist at all. Any change to this constant invalidates the gap
      // measurements above.
      assert.ok(/const\s+INSET\s*=\s*0\.49\b/.test(src),
        'INSET=0.49 constant missing from spatial.js — A3 probe measurements ' +
        'depend on this exact corner-inset value.');
      // Wall strict-endpoint exclusion pin: if segmentsStrictlyIntersect
      // ever stops excluding t=0/1 or u=0/1 endpoints, the wall-corner
      // gap in DC-003/DC-004 closes automatically.
      assert.ok(/t\s*>\s*EPS\s*&&\s*t\s*<\s*1\s*-\s*EPS\s*&&\s*u\s*>\s*EPS\s*&&\s*u\s*<\s*1\s*-\s*EPS/.test(src),
        'segmentsStrictlyIntersect strict-endpoint EPS guard missing — ' +
        'A3 DC-003/DC-004 wall-corner gap depends on this exclusion.');
      // Rasterizer pin: Math.round sampling bias is the reason the very
      // short corner-threading rays do not catch the diagonal blocker pair.
      assert.ok(/Math\.round\(x1\s*\+\s*t\s*\*\s*dx\)/.test(src)
        || /col\s*=\s*Math\.round\(/.test(src),
        'getCellsAlongLine Math.round rasterization missing — ' +
        'A3 DC-002 shield-shield gap depends on this sampling approach.');
      // Self-exclusion pin: cements LOS-06 001/002 carveout behavior for
      // the non-corner cases. Also required by A3 probes above because
      // the threading ray from (0.49, 0.49) to (0.51, 0.51) only rasterizes
      // source + dest cells, both self-excluded.
      assert.ok(/if\s*\(col\s*===\s*a\.col\s*&&\s*row\s*===\s*a\.row\)\s*continue/.test(src),
        'source-cell self-exclusion missing from hasLineOfSight.');
      assert.ok(/if\s*\(col\s*===\s*b\.col\s*&&\s*row\s*===\s*b\.row\)\s*continue/.test(src),
        'destination-cell self-exclusion missing from hasLineOfSight.');
      // Corner-obstacle counter pin: the CRR p.22/p.28 corner-intersection
      // fix relies on getThreadedCorners + an in-loop counter that sums
      // blocking cells (minus source/dest) and wall endpoints at each
      // threaded grid corner. Removing either trips this pin.
      assert.ok(/function\s+getThreadedCorners\s*\(/.test(src),
        'getThreadedCorners helper missing — A3 corner-intersection fix removed.');
      assert.ok(/getThreadedCorners\s*\(\s*ax\s*,\s*ay\s*,\s*bx\s*,\s*by\s*\)/.test(src),
        'hasLineOfSight must invoke getThreadedCorners for each target-corner ray.');
      assert.ok(/count\s*>=\s*2/.test(src),
        'Corner-obstacle counter must block when ≥2 obstacles meet at a threaded corner.');
    });
  });
});
