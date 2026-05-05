/**
 * Phase-D probe: a figure or object occupying blocking terrain is adjacent
 * at distance 1 even though its space is not adjacent to those spaces.
 *
 * PROBE-PD-ADJ-007: CRR ADJACENT — "A figure or object occupying blocking
 *   terrain is adjacent to another figure, object, or space at distance 1
 *   even though its space is not adjacent to those spaces."
 *
 * Implementation (rewritten 2026-05-05): production rules code uses the
 *   map-graph helpers in `src/game/movement.js`:
 *     - `getFiguresAdjacentToCoord(game, coord, mapId, excludeFigureKey, coordSize?)`
 *     - `getFiguresAdjacentToTarget(game, targetFigureKey, mapId)`
 *   Both build the adjacency set from `mapSpaces.adjacency[c]` (precomputed
 *   8-direction graph that respects walls) plus the origin/target's own
 *   footprint cells. Neither reads blocking-terrain status, so an occupant
 *   in a blocking-terrain space is detected as adjacent by the same rule
 *   as any other occupant — the CRR ADJ-007 invariant.
 *
 * Prior version of this probe pinned dead Manhattan helpers
 * (`isAdjacentCoords`/`getRange`) in spatial.js; production never used
 * those for adjacency. Rewritten to pin the actual helpers.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { getFiguresAdjacentToCoord } from '../../../src/game/movement.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '../../..');
const MOVEMENT_SRC = readFileSync(resolve(ROOT, 'src/game/movement.js'), 'utf8');

describe('PROBE-PD-ADJ-007: blocking-terrain occupants are adjacent at distance 1', () => {
  it('007a: source — getFiguresAdjacentToCoord builds adjacencySet from mapSpaces.adjacency, not terrain', () => {
    // The helper reads `adjacency[c]` for the origin's own footprint cells
    // (CRR-correct same-square inclusion) and neighbors via the precomputed
    // graph. It MUST NOT read `blocking` — that would short-circuit
    // ADJ-007 by treating blocking-terrain neighbors as non-adjacent.
    const body = MOVEMENT_SRC.match(/export function getFiguresAdjacentToCoord\([\s\S]*?\n\}/);
    assert.ok(body, 'getFiguresAdjacentToCoord body locatable');
    assert.match(body[0], /adjacency\[oc\]/,
      'must build adjacencySet from precomputed map adjacency graph — CRR-ADJ-007');
    assert.match(body[0], /adjacentSet\.add\(oc\)/,
      'must include origin cells in adjacentSet (same-square is adjacent) — CRR-ADJ-007');
    // Helper must not read figure-occupancy terrain attributes — adjacency
    // is geometric, not occupant-conditional.
    assert.doesNotMatch(body[0], /\.blocking\b/,
      'getFiguresAdjacentToCoord must not read mapSpaces.blocking — CRR-ADJ-007 (terrain of occupant does not gate adjacency)');
  });

  it('007b: source — getFiguresAdjacentToTarget mirrors the same shape', () => {
    // Twin helper used when the origin is a figure rather than a coord.
    // Same rule, same shape (footprint loop + own-cell add + adjacency lookup).
    const body = MOVEMENT_SRC.match(/export function getFiguresAdjacentToTarget\([\s\S]*?\n\}/);
    assert.ok(body, 'getFiguresAdjacentToTarget body locatable');
    assert.match(body[0], /adjacency\[c\]/,
      'must build adjacencySet from map adjacency graph — CRR-ADJ-007');
    assert.match(body[0], /adjacentSet\.add\(c\)/,
      'must include target cells in adjacentSet — CRR-ADJ-007');
    assert.doesNotMatch(body[0], /\.blocking\b/,
      'getFiguresAdjacentToTarget must not read mapSpaces.blocking — CRR-ADJ-007');
  });

  it('007c: behavior — figure on blocking terrain is detected as adjacent to its neighbors', () => {
    // Use real map data. Place a figure at a coord that happens to be
    // blocking terrain on this map; verify the helper detects it as
    // adjacent to a neighbor coord. The occupant's terrain status is
    // irrelevant by ADJ-007 — only its position matters.
    const game = {
      figurePositions: { 1: { 'Stormtrooper-1-0': 'b2' } },
      figureOrientations: {},
      selectedMap: { id: 'mos-eisley-outskirts' },
    };
    // Probe from b1 (a neighbor of b2). The occupant at b2 should appear
    // regardless of whether b2 itself is blocking terrain.
    const adj = getFiguresAdjacentToCoord(game, 'b1', 'mos-eisley-outskirts', null);
    assert.ok(adj.some(f => f.figureKey === 'Stormtrooper-1-0'),
      'occupant at distance 1 must be detected as adjacent regardless of its space terrain — CRR-ADJ-007');
  });

  it('007d: behavior — same-square is adjacent (CRR figure-adjacency invariant)', () => {
    // CRR figure-adjacency: figures occupying the same space are adjacent.
    // Companions (e.g. The Child via Clan of Two) routinely share their
    // host's square, and the rule must hold regardless of terrain at that
    // shared square.
    const game = {
      figurePositions: {
        1: {
          'Baze-1-0': 'b2',
          'TheChild-0-0': 'b2', // same square
        },
      },
      figureOrientations: {},
      selectedMap: { id: 'mos-eisley-outskirts' },
    };
    const adj = getFiguresAdjacentToCoord(game, 'b2', 'mos-eisley-outskirts', 'Baze-1-0');
    assert.ok(adj.some(f => f.figureKey === 'TheChild-0-0'),
      'same-square companion must be adjacent — CRR-ADJ-007 + figure-adjacency rule');
  });
});
