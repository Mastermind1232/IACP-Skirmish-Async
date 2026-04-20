/**
 * Phase-D probe: a figure or object occupying blocking terrain is adjacent
 * at distance 1 even though its space is not adjacent to those spaces.
 *
 * PROBE-PD-ADJ-007: CRR ADJACENT — "A figure or object occupying blocking
 *   terrain is adjacent to another figure, object, or space at distance 1
 *   even though its space is not adjacent to those spaces."
 *
 * Implementation: `getRange` in src/game/spatial.js is a pure Manhattan
 *   distance on the grid coordinates, unaffected by terrain of either
 *   endpoint. `isAdjacentCoords` is defined as `getRange(c1,c2) === 1`.
 *   Because the helper never inspects `mapSpaces.blocking` or any terrain
 *   attribute, an occupant in a blocking-terrain space is correctly
 *   treated as adjacent to any grid-Manhattan-1 neighbor.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { getRange, isAdjacentCoords } from '../../../src/game/spatial.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '../../..');
const SPATIAL_SRC = readFileSync(resolve(ROOT, 'src/game/spatial.js'), 'utf8');

describe('PROBE-PD-ADJ-007: blocking-terrain occupants are adjacent at distance 1', () => {
  it('007a: source — getRange is pure Manhattan, not terrain-aware', () => {
    assert.match(SPATIAL_SRC,
      /export function getRange\(coord1, coord2\) \{[\s\S]*?return Math\.abs\(a\.col - b\.col\) \+ Math\.abs\(a\.row - b\.row\);/,
      'getRange must be pure Manhattan distance — CRR-ADJ-007');
    // Find the getRange body and verify it does NOT read blocking or adjacency
    const body = SPATIAL_SRC.match(/export function getRange\(coord1, coord2\) \{[\s\S]*?\n\}/);
    assert.ok(body, 'getRange body locatable');
    assert.doesNotMatch(body[0], /blocking/, 'getRange must not read blocking — CRR-ADJ-007');
    assert.doesNotMatch(body[0], /adjacency/, 'getRange must not read adjacency graph — CRR-ADJ-007');
  });

  it('007b: source — isAdjacentCoords is defined as getRange === 1', () => {
    assert.match(SPATIAL_SRC,
      /export function isAdjacentCoords\(coord1, coord2\) \{\s*\n\s*return getRange\(coord1, coord2\) === 1;/,
      'isAdjacentCoords must be a thin wrapper around getRange === 1 — CRR-ADJ-007');
  });

  it('007c: behavior — Manhattan-1 neighbors are adjacent (baseline)', () => {
    assert.equal(isAdjacentCoords('a1', 'a2'), true, 'horizontal neighbor — adjacent');
    assert.equal(isAdjacentCoords('a1', 'b1'), true, 'vertical neighbor — adjacent');
    assert.equal(isAdjacentCoords('b5', 'a5'), true, 'wrap-case neighbor — adjacent');
  });

  it('007d: behavior — blocking-terrain occupant at distance 1 is still adjacent', () => {
    // The occupant's space terrain never enters the adjacency calculation;
    // isAdjacentCoords/getRange only read the coordinates. This pin is
    // structural: since the helper ignores terrain by construction, a
    // blocking-terrain occupant at a1 is adjacent to a2 by the same rule
    // as any other occupant at a1.
    assert.equal(getRange('a1', 'a2'), 1,
      'distance to blocking-terrain occupant at a1 is 1 from a2 — CRR-ADJ-007');
    assert.equal(isAdjacentCoords('a1', 'a2'), true,
      'blocking-terrain occupant at a1 is adjacent to a2 — CRR-ADJ-007');
  });

  it('007e: behavior — diagonals are not adjacent (Manhattan distance = 2)', () => {
    assert.equal(isAdjacentCoords('a1', 'b2'), false,
      'diagonal is not adjacent — CRR-ADJ-007 is about distance-1, not distance-≥2');
  });
});
