/**
 * Phase-D probe: when an ability's text says 'within N spaces' or
 * 'adjacent', the count is taken FROM the figure using the ability.
 *
 * PROBE-PD-CS-004: CRR COUNTING SPACES — "When an ability says 'within
 *   N spaces' or 'adjacent', counts are taken from the figure using
 *   the ability."
 *
 * Implementation: the two shared helpers in `src/game/spatial.js`
 *   both take a single reference `coord` argument (the caller's
 *   position), and every distance read inside is
 *   `getRange(coord, fCoord)` or `getRange(coord, c)` — i.e., the
 *   first argument is ALWAYS the ability-user's position, and the
 *   second is the target. The helpers are:
 *     - `getFiguresWithinRange(game, coord, range, playerNum)`
 *       → used by "within N" abilities.
 *     - `getFiguresAdjacentTo(game, coord, playerNum)` which is a
 *       thin wrapper: `getFiguresWithinRange(game, coord, 1, playerNum)
 *         .filter((f) => f.distance === 1)`
 *       → used by "adjacent" abilities.
 *   Because both flows share one implementation, and both accept the
 *   ability-user's coord as the reference, the CRR "counts taken from
 *   the ability user" framing is structurally guaranteed.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  getFiguresWithinRange,
  getFiguresAdjacentTo,
  getRange,
  isAdjacentCoords,
} from '../../../src/game/spatial.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '../../..');
const SPATIAL_SRC = readFileSync(resolve(ROOT, 'src/game/spatial.js'), 'utf8');

describe('PROBE-PD-CS-004: ability-user is the reference frame for within/adjacent counts', () => {
  it('004a: source — getFiguresWithinRange takes a single `coord` reference argument', () => {
    assert.match(SPATIAL_SRC,
      /export function getFiguresWithinRange\(game, coord, range, playerNum = null\) \{/,
      'getFiguresWithinRange must take one reference coord — CRR-CS-004');
  });

  it('004b: source — distance inside getFiguresWithinRange is getRange(coord, …) with coord as first arg', () => {
    assert.match(SPATIAL_SRC,
      /d = Math\.min\(\.\.\.cells\.map\(c => getRange\(coord, c\)\)\);[\s\S]*?d = getRange\(coord, fCoord\);/,
      'distance must be computed from the ability-user coord — CRR-CS-004');
  });

  it('004c: source — getFiguresAdjacentTo is a thin wrapper that reuses the same reference coord', () => {
    assert.match(SPATIAL_SRC,
      /export function getFiguresAdjacentTo\(game, coord, playerNum = null\) \{\s*\n\s*return getFiguresWithinRange\(game, coord, 1, playerNum\)\s*\n\s*\.filter\(\(f\) => f\.distance === 1\);/,
      'getFiguresAdjacentTo must reuse getFiguresWithinRange with the SAME coord — CRR-CS-004');
  });

  it('004d: behavior — a figure at a1 sees self at distance 0 and a figure at a3 at distance 2', () => {
    const game = {
      figurePositions: {
        1: { p1f1: 'a1' },
        2: { p2f1: 'a3' },
      },
      figureOrientations: {},
    };
    const r = getFiguresWithinRange(game, 'a1', 5);
    const asMap = Object.fromEntries(r.map((f) => [f.figureKey, f.distance]));
    assert.equal(asMap.p1f1, 0, 'self-distance from a1 is 0 — CRR-CS-004');
    assert.equal(asMap.p2f1, 2, 'distance to a3 from a1 is 2 — CRR-CS-004');
  });

  it('004e: behavior — frame-of-reference swap: same two figures, range-from-other-figure flips the count semantic', () => {
    const game = {
      figurePositions: {
        1: { p1f1: 'b2' },
        2: { p2f1: 'd2' },
      },
      figureOrientations: {},
    };
    // "Adjacent to P1f1 (at b2)" → only P1f1 (self) at distance 0; P2f1 at distance 2.
    const r1 = getFiguresAdjacentTo(game, 'b2');
    assert.equal(r1.length, 0, 'nobody is adjacent when counted from P1f1 — CRR-CS-004');
    // Sanity: raw Manhattan confirms 2 spaces apart.
    assert.equal(getRange('b2', 'd2'), 2, 'b2→d2 Manhattan is 2 — CRR-CS-004');
    assert.equal(isAdjacentCoords('b2', 'd2'), false, 'b2→d2 not adjacent — CRR-CS-004');
  });

  it('004f: source — the range-gate inside getFiguresWithinRange uses the computed d vs range (no coord swap)', () => {
    assert.match(SPATIAL_SRC,
      /if \(d <= range\) results\.push\(\{ figureKey: fk, playerNum: pn, coord: fCoord, distance: d \}\);/,
      'range gate must use the distance computed from the reference coord — CRR-CS-004');
  });
});
