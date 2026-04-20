/**
 * Phase-D probe: for a large (multi-cell) target, the attacker may
 * target any space the target occupies; this space is used for LOS
 * and distance. The engine implements this by enumerating the
 * target's footprint cells and picking the best (min-distance,
 * any-pair LOS) space — equivalent to the attacker choosing the
 * optimal space.
 *
 * PROBE-PD-TGT-002: CRR TARGET — "If the target is a large figure,
 *   the attacker must target one space that the target occupies;
 *   this space is used for line of sight and some abilities."
 *
 * Implementation: both target-enumeration sites (the authoritative
 *   Discord-side picker in `src/handlers/dc-play-area.js` and the
 *   engine-side enumerator in `src/engine/available-actions.js`)
 *   expand a multi-cell target via `getFootprintCells(coord, size)`
 *   in `src/game/coords.js`, then:
 *     - compute distance as `Math.min(...)` over attacker-fp × target-fp
 *     - compute LOS as any-pair-has-LOS (break out of nested loops
 *       when any (attacker-cell → target-cell) pair succeeds)
 *   This is exactly the "attacker picks the optimal target space"
 *   semantics that CRR-TGT-002 mandates — the attacker is modelled
 *   as always picking whichever occupied space best serves the
 *   attack (rational-agent equivalence).
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '../../..');
const CD_SRC = readFileSync(resolve(ROOT, 'src/game/coords.js'), 'utf8');
const DP_SRC = readFileSync(resolve(ROOT, 'src/handlers/dc-play-area.js'), 'utf8');
const AA_SRC = readFileSync(resolve(ROOT, 'src/engine/available-actions.js'), 'utf8');

describe('PROBE-PD-TGT-002: attacker picks any space a large-figure target occupies for LOS/distance (engine picks optimal space)', () => {
  it('002a: source — getFootprintCells in coords.js is the canonical helper that enumerates all cells a multi-cell figure occupies', () => {
    assert.match(CD_SRC,
      /export function getFootprintCells\(topLeftCoord, size\) \{[\s\S]*?for \(let r = 0; r < \(rows \|\| 1\); r\+\+\) \{[\s\S]*?for \(let c = 0; c < \(cols \|\| 1\); c\+\+\) \{[\s\S]*?cells\.push\(colRowToCoord\(col \+ c, row \+ r\)\);/,
      'getFootprintCells must enumerate all cells of a multi-cell figure — CRR-TGT-002');
  });

  it('002b: source — dc-play-area.js target picker expands each enemy target via getFootprintCells(coord, size) before LOS/distance', () => {
    assert.match(DP_SRC,
      /const size = game\.figureOrientations\?\.\[k\] \|\| getFigureSize\(dcName\);\s*\n\s*const cells = getFootprintCells\(coord, size\);/,
      'dc-play-area.js must expand target footprint via getFootprintCells before target evaluation — CRR-TGT-002');
  });

  it('002c: source — dc-play-area.js distance is Math.min over attacker-footprint × target-footprint cell pairs (attacker picks the closest space)', () => {
    assert.match(DP_SRC,
      /const dist = Math\.min\(\.\.\.attackerFpCells\.flatMap\(ac => cells\.map\(tc => countSpaces\(ms, ac, tc, closedDoorEdges\)\)\)\);/,
      'dc-play-area.js must compute min distance across attacker/target footprint pairs — CRR-TGT-002');
  });

  it('002d: source — dc-play-area.js LOS is "any-pair succeeds" across attacker-fp × target-fp (attacker picks the space from which LOS exists)', () => {
    assert.match(DP_SRC,
      /\/\/ Large figures: LOS from any attacker cell to any target cell \(rules: "may be traced from any space it occupies"\)[\s\S]*?outer: for \(const ac of attackerFpCells\) \{\s*\n\s*for \(const tc of cells\) \{\s*\n\s*if \(hasLineOfSight\(ac, tc, effectiveMs, losCoords\)\) \{ los = true; break outer; \}/,
      'dc-play-area.js LOS check must try all attacker-cell × target-cell pairs — CRR-TGT-002');
  });

  it('002e: source — available-actions.js parity: engine-side target enumerator mirrors the Discord-side picker (multi-cell target-fp expansion + min-distance + any-pair LOS)', () => {
    // Target footprint expansion
    assert.match(AA_SRC,
      /const _aaTargetFpCells = \(targetSize && targetSize !== '1x1'\)\s*\n\s*\? getFootprintCells\(coord, targetSize\)\.map\(c => String\(c\)\.toLowerCase\(\)\)\s*:\s*\[coordLc\];/,
      'available-actions.js must expand multi-cell target footprint — CRR-TGT-002');
    // Distance: min over attacker-fp × target-fp
    assert.match(AA_SRC,
      /let dist = Infinity;\s*\n\s*for \(const ac of _aaAttackerFpCells\) \{\s*\n\s*for \(const tc of _aaTargetFpCells\) \{\s*\n\s*const d = countSpaces\(ms, ac, tc, _aaClosedDoorEdges\);\s*\n\s*if \(d < dist\) dist = d;/,
      'available-actions.js must compute min distance across attacker × target footprint pairs — CRR-TGT-002');
    // LOS: any-pair succeeds
    assert.match(AA_SRC,
      /outer: for \(const ac of _aaAttackerFpCells\) \{\s*\n\s*for \(const tc of _aaTargetFpCells\) \{\s*\n\s*if \(hasLineOfSight\(ac, tc, _aaEffectiveMs, losBlockingCoords\)\) \{ los = true; break outer; \}/,
      'available-actions.js LOS check must try all attacker-cell × target-cell pairs — CRR-TGT-002');
  });

  it('002f: source — MASSIVE-target LOS bypass is applied BEFORE footprint-based LOS iteration (parity across both sites), consistent with "target space is used for LOS"', () => {
    // In both dc-play-area.js and available-actions.js, MASSIVE targets skip figure-blocking entirely
    // (the "target space" framing still holds — LOS is traced to occupied spaces, just without figure blocking).
    assert.match(DP_SRC,
      /if \(\(targetEff\?\.keywords \|\| \[\]\)\.some\(kw => String\(kw\)\.toUpperCase\(\) === 'MASSIVE'\)\) \{\s*\n\s*losCoords = null;/,
      'dc-play-area.js must null losCoords when target is MASSIVE — CRR-TGT-002');
    assert.match(AA_SRC,
      /\} else if \(\(targetEff\?\.keywords \|\| \[\]\)\.some\(kw => String\(kw\)\.toUpperCase\(\) === 'MASSIVE'\)\) \{\s*\n\s*losBlockingCoords = null;/,
      'available-actions.js must null losBlockingCoords when target is MASSIVE — CRR-TGT-002');
  });
});
