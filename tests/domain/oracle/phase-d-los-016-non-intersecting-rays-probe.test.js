/**
 * Phase-D probe: CRR LOS-016 — "The two corner-to-corner lines used for
 * LOS tracing must be non-intersecting and non-overlapping."
 *
 * Updated 2026-04-28 for the LOS rewrite (commit ec853f2): the algorithm
 * was migrated to Nick Hansen's reference, so these source-pin tripwires
 * now read `src/game/los-engine.js` (the new module) instead of
 * `src/game/spatial.js`, and the regexes match the new algorithm's
 * structure. The intent of each pin is preserved — they're flagging the
 * exact code structure that satisfies the rule.
 *
 * The IA rule (consolidated-rules-raw.txt 1748-1750): "the player draws
 * imaginary, non-intersecting and non-overlapping lines from ONE corner
 * of the space the figure using the ability is occupying to TWO ADJACENT
 * corners of the target's space."
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '../../..');
const ENGINE_SRC = readFileSync(resolve(ROOT, 'src/game/los-engine.js'), 'utf8');

describe('PROBE-PD-LOS-016: corner-to-corner LOS lines are non-intersecting and non-overlapping', () => {
  it('016a: source — LOS fixes a single source corner per determination (outer loop)', () => {
    // tileToTileLos's outer loop iterates the 4 attacker corners; each
    // iteration holds the source corner fixed while the inner loop iterates
    // the 4 valid (defender_corner_pair, edge_midpoint) combinations.
    assert.match(ENGINE_SRC,
      /for \(const aCorner of \[att\.tl, att\.tr, att\.bl, att\.br\]\)/,
      'LOS must fix a single source corner per determination — CRR-LOS-016');
  });

  it('016b: source — only adjacent target corners are valid (no diagonal-only LOS)', () => {
    // Per Nick Hansen / Destruct CRR audit: the two target corners must be
    // adjacent (forming an edge), not diagonal. The pairs array enumerates
    // exactly the 4 adjacent-edge combinations (top/right/bottom/left).
    assert.match(ENGINE_SRC,
      /\[def\.tl, def\.tr, def\.top\s*\]/,
      'LOS must require adjacent (top edge) target-corner pair — CRR-LOS-016');
    assert.match(ENGINE_SRC,
      /\[def\.tr, def\.br, def\.right\]/,
      'LOS must require adjacent (right edge) target-corner pair — CRR-LOS-016');
    assert.match(ENGINE_SRC,
      /\[def\.bl, def\.br, def\.bot\s*\]/,
      'LOS must require adjacent (bottom edge) target-corner pair — CRR-LOS-016');
    assert.match(ENGINE_SRC,
      /\[def\.tl, def\.bl, def\.left\s*\]/,
      'LOS must require adjacent (left edge) target-corner pair — CRR-LOS-016');
  });

  it('016c: source — corners are exact integer grid points (no INSET fudge factor)', () => {
    // Nick Hansen's algorithm uses exact integer corners so corner-threading
    // works correctly. Any reintroduction of INSET would re-break BT-1's
    // corner-thread case on corellian-underground.
    assert.doesNotMatch(ENGINE_SRC, /const INSET = /,
      'engine must not reintroduce INSET — corners must be exact integers');
    assert.match(ENGINE_SRC,
      /tl: \{ x: fromX,\s+y: fromY\s+\}/,
      'attacker corners must be at integer grid points — CRR-LOS-016');
  });

  it('016d: source — pathsOverlap rejects co-linear, same-direction line pairs', () => {
    // Two co-linear rays from the same source going the same way are really
    // ONE line; the rule requires TWO distinct lines.
    assert.match(ENGINE_SRC,
      /if \(pathsOverlap\(aCorner, d1, d2\)\) continue;/,
      'pathsOverlap rejection guards distinct-lines invariant — CRR-LOS-016');
  });

  it('016e: source — interior corner-intersection blocks LOS at ≥2-obstacle corners', () => {
    // CRR p.22: a ray cannot trace through a corner where 2+ obstacles meet.
    // Implemented in getLosFromCornerToCorner as the wallEndpoints + adjacent-
    // cell obstacle-count loop.
    assert.match(ENGINE_SRC,
      /if \(count >= 2\) return false;/,
      'engine must reject rays threading a ≥2-obstacle corner — CRR-LOS-016 companion');
  });
});
