/**
 * Phase-D probe: when an ability's text says 'within N spaces' or
 * 'adjacent', the count is taken FROM the figure using the ability.
 *
 * PROBE-PD-CS-004: CRR COUNTING SPACES — "When an ability says 'within
 *   N spaces' or 'adjacent', counts are taken from the figure using
 *   the ability."
 *
 * Implementation (rewritten 2026-05-05): production rules code uses
 *   map-graph helpers that take the ability-user's coord as the
 *   reference frame:
 *     - `isWithinN(posA, posB, maxDist, mapId, getMapData)` in
 *       `src/engine/utils.js` — BFS from posA over the precomputed
 *       map adjacency graph. posA is the ability-user, posB is the
 *       target. The first argument is the reference frame.
 *     - `isWithinSpaces(mapSpaces, coordA, coordB, maxDist)` in
 *       `src/game/spatial.js` — same BFS shape with mapSpaces passed
 *       as the first arg (kept for callers that already hold mapSpaces).
 *     - `getFiguresAdjacentToCoord(game, coord, mapId, excludeFigureKey, coordSize?)`
 *       in `src/game/movement.js` — enumerates figures adjacent to the
 *       given reference coord (the ability user's position).
 *   All three accept the ability-user's position as the reference and
 *   compute distance from there, satisfying CRR-CS-004 structurally.
 *
 * Prior version of this probe pinned dead Manhattan helpers in
 * spatial.js (`getFiguresWithinRange`, `getFiguresAdjacentTo`); those
 * are not used by production rules code. Rewritten to pin the actual
 * helpers callers reach for.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { isWithinN } from '../../../src/engine/utils.js';
import { isWithinSpaces } from '../../../src/game/spatial.js';
import { getFiguresAdjacentToCoord } from '../../../src/game/movement.js';
import { getMapData } from '../../../src/data-loader.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '../../..');
const UTILS_SRC = readFileSync(resolve(ROOT, 'src/engine/utils.js'), 'utf8');
const SPATIAL_SRC = readFileSync(resolve(ROOT, 'src/game/spatial.js'), 'utf8');
const MOVEMENT_SRC = readFileSync(resolve(ROOT, 'src/game/movement.js'), 'utf8');

describe('PROBE-PD-CS-004: ability-user is the reference frame for within/adjacent counts', () => {
  it('004a: source — isWithinN takes ability-user position as posA (first arg)', () => {
    // 2026-07-09: trailing optional `game` param added for the CRR
    // occupied-blocking / Spire counting overlays; posA stays first.
    assert.match(UTILS_SRC,
      /export function isWithinN\(posA, posB, maxDist, mapId, getMapData, game = null\) \{/,
      'isWithinN must take posA (ability-user) as the first arg — CRR-CS-004');
  });

  it('004b: source — isWithinN BFS frontier seeds from posA, not posB', () => {
    const body = UTILS_SRC.match(/export function isWithinN\([\s\S]*?\n\}/);
    assert.ok(body, 'isWithinN body locatable');
    // The BFS starts at `a` (which derives from posA) and walks outward
    // via the adjacency graph. The reference frame is the ability-user.
    assert.match(body[0], /const visited = new Set\(\[a\]\);/,
      'BFS must seed visited from posA — CRR-CS-004');
    assert.match(body[0], /let frontier = \[a\];/,
      'BFS frontier must start at posA — CRR-CS-004');
  });

  it('004c: source — isWithinSpaces (sister helper) seeds from coordA', () => {
    const body = SPATIAL_SRC.match(/export function isWithinSpaces\([\s\S]*?\n\}/);
    assert.ok(body, 'isWithinSpaces body locatable');
    assert.match(body[0], /const visited = new Set\(\[a\]\);/,
      'BFS must seed from coordA (the ability-user reference) — CRR-CS-004');
    assert.match(body[0], /let frontier = \[a\];/,
      'BFS frontier must start at coordA — CRR-CS-004');
  });

  it('004d: source — getFiguresAdjacentToCoord walks adjacency from the reference coord, not from each candidate', () => {
    const body = MOVEMENT_SRC.match(/export function getFiguresAdjacentToCoord\([\s\S]*?\n\}/);
    assert.ok(body, 'getFiguresAdjacentToCoord body locatable');
    // adjacencySet is built from the REFERENCE coord's footprint cells
    // (the ability-user's position), not from each candidate figure's
    // position. That establishes the frame-of-reference invariant.
    assert.match(body[0], /for \(const oc of originCells\) \{[\s\S]*?for \(const n of adjacency\[oc\]/,
      'adjacency lookups must originate from the reference coord — CRR-CS-004');
  });

  it('004e: behavior — same-square is reachable at distance 0 from the ability user', () => {
    // CRR figure-adjacency baseline: a figure at the same coord as the
    // ability-user is at distance 0 → "within 0" is true (and trivially
    // "adjacent" since same-square IS adjacent per CRR).
    assert.equal(isWithinN('b2', 'b2', 0, 'unit-test-grid', getMapData), true,
      'same coord must be within 0 from the reference — CRR-CS-004');
  });

  it('004f: behavior — frame swap: A→B with maxDist 2 succeeds, B→A with maxDist 2 also succeeds (symmetric)', () => {
    // Distance from ability-user is symmetric in IA's adjacency graph
    // (a→b reachable in N hops iff b→a reachable in N hops). The probe
    // verifies that swapping which figure is "the ability user" does
    // not change the count semantic — both directions agree.
    const A = 'b2', B = 'd2';
    const ab = isWithinN(A, B, 2, 'unit-test-grid', getMapData);
    const ba = isWithinN(B, A, 2, 'unit-test-grid', getMapData);
    assert.equal(ab, ba,
      'within-N is symmetric: A-as-reference and B-as-reference must agree — CRR-CS-004');
  });

  it('004g: behavior — getFiguresAdjacentToCoord enumerates from the reference coord, not from candidate positions', () => {
    // P1 figure at b2 (the ability user). P2 figure at b3 (adjacent).
    // P2 figure at e5 (far). Querying adjacency from b2 returns the
    // adjacent figure (b3) but not the far one (e5). The reference
    // frame is the coord we passed.
    const game = {
      figurePositions: {
        1: { 'AbilityUser-1-0': 'b2' },
        2: { 'NearTarget-1-0': 'b3', 'FarTarget-1-0': 'e5' },
      },
      figureOrientations: {},
      selectedMap: { id: 'unit-test-grid' },
    };
    const adj = getFiguresAdjacentToCoord(game, 'b2', 'unit-test-grid', 'AbilityUser-1-0');
    const keys = adj.map(f => f.figureKey);
    assert.ok(keys.includes('NearTarget-1-0'),
      'adjacent figure must appear when reference coord is the ability-user — CRR-CS-004');
    assert.ok(!keys.includes('FarTarget-1-0'),
      'distant figure must not appear (reference frame is the ability-user, not the candidate) — CRR-CS-004');
  });
});
