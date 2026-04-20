/**
 * Phase-D probe: LOS and distance between attacker and target are determined
 * separately; for large-figure targets, the two determinations may use
 * different spaces.
 *
 * PROBE-PD-ATK-025: CRR ATTACK — "Line of sight and distance between attacker
 *   and target are determined separately; for large figures, the two
 *   determinations may use different spaces."
 *
 * Implementation: in `src/engine/available-actions.js`, target enumeration
 *   runs two structurally independent iterations over the attacker × target
 *   footprint product:
 *     (a) Distance loop: `let dist = Infinity; for ac × tc { dist = min(dist, countSpaces(...)) }`
 *         — picks the minimum-distance pair.
 *     (b) LOS loop: `for ac × tc { if (hasLineOfSight(...)) { los = true; break } }`
 *         — picks the first LOS-passing pair.
 *   Neither loop consumes the other's chosen pair; they are separate
 *   reductions over the same Cartesian product. For a large-figure target,
 *   the pair used for distance need not be the pair used for LOS.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '../../..');
const AA_SRC = readFileSync(resolve(ROOT, 'src/engine/available-actions.js'), 'utf8');

describe('PROBE-PD-ATK-025: LOS and distance are determined independently', () => {
  it('025a: source — distance iteration is a standalone min-reduction over attacker-fp × target-fp', () => {
    assert.match(AA_SRC,
      /let dist = Infinity;\s*\n\s*for \(const ac of _aaAttackerFpCells\) \{\s*\n\s*for \(const tc of _aaTargetFpCells\) \{\s*\n\s*const d = countSpaces\(ms, ac, tc, _aaClosedDoorEdges\);\s*\n\s*if \(d < dist\) dist = d;/,
      'distance must be a min over attacker-fp × target-fp, not coupled to LOS — CRR-ATK-025');
  });

  it('025b: source — LOS iteration is a standalone first-hit search over attacker-fp × target-fp', () => {
    assert.match(AA_SRC,
      /let los = false;\s*\n\s*outer: for \(const ac of _aaAttackerFpCells\) \{\s*\n\s*for \(const tc of _aaTargetFpCells\) \{\s*\n\s*if \(hasLineOfSight\(ac, tc, _aaEffectiveMs, losBlockingCoords\)\) \{ los = true; break outer; \}/,
      'LOS must be a first-hit search over attacker-fp × target-fp, not coupled to distance — CRR-ATK-025');
  });

  it('025c: source — distance and LOS loops are separated (distance computed, range gate applied, then LOS computed)', () => {
    const distIdx = AA_SRC.indexOf('let dist = Infinity;');
    const rangeGateIdx = AA_SRC.indexOf('if (dist < minRange || dist > maxRange) continue;');
    const losIdx = AA_SRC.indexOf('let los = false;');
    assert.ok(distIdx > 0, 'distance loop must be locatable');
    assert.ok(rangeGateIdx > distIdx, 'range gate follows distance loop — CRR-ATK-025');
    assert.ok(losIdx > rangeGateIdx, 'LOS loop follows range gate (independent of distance winner) — CRR-ATK-025');
  });

  it('025d: source — the distance loop does NOT short-circuit on LOS; the LOS loop does NOT record distance', () => {
    const distBody = AA_SRC.match(/let dist = Infinity;[\s\S]*?if \(dist < minRange \|\| dist > maxRange\) continue;/);
    assert.ok(distBody, 'distance block must be locatable');
    assert.doesNotMatch(distBody[0], /hasLineOfSight/,
      'distance loop must not call hasLineOfSight — CRR-ATK-025');
    const losBody = AA_SRC.match(/let los = false;[\s\S]*?break outer; \}\s*\n\s*\}\s*\n\s*\}/);
    assert.ok(losBody, 'LOS block must be locatable');
    assert.doesNotMatch(losBody[0], /countSpaces/,
      'LOS loop must not call countSpaces — CRR-ATK-025');
  });

  it('025e: source — target-footprint cells are enumerated for multi-cell (non-1x1) targets', () => {
    assert.match(AA_SRC,
      /const _aaTargetFpCells = \(targetSize && targetSize !== '1x1'\)\s*\n\s*\? getFootprintCells\(coord, targetSize\)\.map\(c => String\(c\)\.toLowerCase\(\)\)\s*\n\s*: \[coordLc\];/,
      'multi-cell targets must expose their full footprint to both iterations — CRR-ATK-025');
  });
});
