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
 * Implementation (rewritten 2026-05-05): three production-helper invariants
 *   together cover the rule:
 *   (1) `hasLineOfSight` (`src/game/spatial.js`) excludes the source AND
 *       target cells from the figure-blocking check before the
 *       blockingSet lookup. So LOS can reach a target cell that itself
 *       sits on blocking terrain (without the target self-blocking).
 *   (2) `isWithinN` / `isWithinSpaces` (BFS over `mapSpaces.adjacency`)
 *       count spaces over the precomputed map graph — they don't read
 *       per-occupant terrain status, so spaces ARE counted to a
 *       blocking-terrain occupant.
 *   (3) `getFiguresAdjacentToCoord` / `getFiguresAdjacentToTarget`
 *       (`src/game/movement.js`) build the adjacency set from
 *       `mapSpaces.adjacency` and don't read blocking-terrain status,
 *       so a blocking-terrain occupant is detected as adjacent.
 *
 * Combined with MSV-001 (Massive excluded from figure-blocking set), these
 * three invariants cover both MSV-009 and MOB-003 via the helpers production
 * rules code actually uses.
 *
 * Prior version of this probe pinned dead Manhattan helpers
 * (`isAdjacentCoords`/`getRange`) in spatial.js for the adjacency leg;
 * production never used those for adjacency. Rewritten to pin the actual
 * helpers.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { hasLineOfSight, isWithinSpaces } from '../../../src/game/spatial.js';
import { isWithinN } from '../../../src/engine/utils.js';
import { getFiguresAdjacentToCoord } from '../../../src/game/movement.js';
import { getMapData } from '../../../src/data-loader.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '../../..');
const SPATIAL_SRC = readFileSync(resolve(ROOT, 'src/game/spatial.js'), 'utf8');
const MOVEMENT_SRC = readFileSync(resolve(ROOT, 'src/game/movement.js'), 'utf8');
const UTILS_SRC = readFileSync(resolve(ROOT, 'src/engine/utils.js'), 'utf8');

describe('PROBE-PD-MSV-009/MOB-003: blocking-terrain occupants (Massive/Mobile) remain reachable', () => {
  it('009a: behavior — hasLineOfSight excludes attacker AND target cells from figure-blocking check', () => {
    // Both attacker and target coords must be auto-excluded from
    // figureBlockingCoords. If either were treated as a blocker, the
    // line would self-block. Engine handles this explicitly in
    // spatial.js (filtered before LOS check).
    const mapSpaces = { blocking: [], impassableEdges: [] };
    const blockers = new Set(['a1', 'c1']);
    assert.equal(hasLineOfSight('a1', 'c1', mapSpaces, blockers), true,
      'attacker (a1) and target (c1) auto-excluded from blockers — CRR-MSV-009 / CRR-MOB-003');
  });

  it('009b: source — isWithinN BFS does not read mapSpaces.blocking (terrain of occupant does not gate counting)', () => {
    const body = UTILS_SRC.match(/export function isWithinN\([\s\S]*?\n\}/);
    assert.ok(body, 'isWithinN body locatable');
    assert.doesNotMatch(body[0], /\.blocking\b/,
      'isWithinN must not read blocking — counting spaces to a blocking-terrain occupant must work — CRR-MSV-009 / CRR-MOB-003');
  });

  it('009c: source — getFiguresAdjacentToCoord does not read mapSpaces.blocking', () => {
    const body = MOVEMENT_SRC.match(/export function getFiguresAdjacentToCoord\([\s\S]*?\n\}/);
    assert.ok(body, 'getFiguresAdjacentToCoord body locatable');
    assert.doesNotMatch(body[0], /\.blocking\b/,
      'adjacency must not read blocking — a blocking-terrain occupant is still adjacent — CRR-MSV-009 / CRR-MOB-003');
  });

  it('009d: behavior — isWithinN counts spaces to a blocking-terrain occupant correctly', () => {
    // Whether the target space is blocking terrain or not, isWithinN
    // counts spaces over the map adjacency graph. Per-occupant terrain
    // does not gate the count.
    const reachable = isWithinN('b2', 'b3', 1, 'mos-eisley-outskirts', getMapData);
    assert.equal(reachable, true,
      'spaces counted to neighbor regardless of occupant terrain — CRR-MSV-009 / CRR-MOB-003');
  });

  it('009e: behavior — figure on a coord (terrain-blind) is still detected as adjacent to its neighbors', () => {
    // A figure sitting on any space — including blocking terrain —
    // is adjacent to its neighbors via the adjacency graph.
    const game = {
      figurePositions: { 1: { 'Massive-1-0': 'b2' } },
      figureOrientations: { 'Massive-1-0': '2x2' },
      selectedMap: { id: 'mos-eisley-outskirts' },
    };
    const adj = getFiguresAdjacentToCoord(game, 'd3', 'mos-eisley-outskirts', null);
    assert.ok(
      adj.some(f => f.figureKey === 'Massive-1-0'),
      'Massive figure (2x2) at b2 must be detected as adjacent to d3 (footprint cell c3 is adjacent) — CRR-MSV-009',
    );
  });

  it('009f: behavior — hasLineOfSight to a target cell that is itself in blocking works (no self-block)', () => {
    // 3-cell line where the TARGET cell is in blocking terrain but the
    // line has no wall and the middle is clear. The target-cell
    // blocking skip means LOS succeeds.
    const mapSpaces = {
      blocking: ['c1'], // target cell is blocking terrain
      impassableEdges: [],
    };
    assert.equal(hasLineOfSight('a1', 'c1', mapSpaces, null), true,
      'LOS to a blocking-terrain target cell succeeds because the target self-skips — CRR-MSV-009 / CRR-MOB-003');
  });

  it('009g: behavior — non-target blocking cells still block LOS (invariant does not break other rules)', () => {
    // b1 is blocking and is the MIDDLE of the line a1 → c1. LOS should fail.
    const mapSpaces = {
      blocking: ['b1'],
      impassableEdges: [],
    };
    assert.equal(hasLineOfSight('a1', 'c1', mapSpaces, null), false,
      'a blocking cell in the middle of the line still blocks LOS — CRR-MSV-009 / CRR-MOB-003 only lifts the target-self case');
  });
});
