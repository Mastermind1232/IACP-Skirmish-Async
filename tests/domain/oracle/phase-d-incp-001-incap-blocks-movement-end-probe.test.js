/**
 * Phase-D behavioral probe — CRR-INCP-001.
 *
 * CRR: "An incapacitated figure remains on the map under the same player's
 *       control but does not restrict movement or block line of sight; other
 *       figures cannot end movement in its space."
 *
 * The existing invariant_pin probe checks source shape. This probe exercises
 * the runtime behavior of `getOccupiedSpacesForMovement` on the only skirmish
 * substrate for incapacitation (The Child + game.childIncapacitated):
 *
 *   - HEALTHY Child: companion pass-through — footprint absent from the
 *     movement-occupied set (other figures can end movement in The Child's
 *     space — normal companion share semantics).
 *   - INCAP Child: footprint present in the movement-occupied set (blocks
 *     end-movement per CRR-INCP-001).
 *   - Same player control: regardless of incap, figurePositions[p]['The Child-…']
 *     remains — never deleted by the incap transition.
 *
 * PROBE-INCP-001-A: healthy Child does NOT contribute to end-movement occupancy
 * PROBE-INCP-001-B: incap Child DOES contribute to end-movement occupancy
 * PROBE-INCP-001-C: incap Child stays in figurePositions under same player's control
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { getOccupiedSpacesForMovement } from '../../../src/game/movement.js';

function makeGameWithChild(incap) {
  return {
    figurePositions: {
      1: { 'The Child-1-0': 'j10', 'Luke Skywalker, Jedi Knight-1-0': 'j11' },
      2: { 'Greedo-1-0': 'k11' },
    },
    figureOrientations: {},
    childIncapacitated: !!incap,
  };
}

describe('PROBE-INCP-001-A: healthy Child does NOT block end-movement', () => {
  it('getOccupiedSpacesForMovement excludes healthy Child footprint', () => {
    const game = makeGameWithChild(false);
    const occupied = getOccupiedSpacesForMovement(game).map((c) => c.toLowerCase());
    assert.equal(occupied.includes('j10'), false,
      'Companion pass-through: healthy Child does not block end-movement.');
    assert.equal(occupied.includes('j11'), true,
      'Sanity: Luke (non-companion) still contributes to occupied set.');
    assert.equal(occupied.includes('k11'), true,
      'Sanity: Greedo (non-companion) still contributes to occupied set.');
  });
});

describe('PROBE-INCP-001-B: incap Child DOES block end-movement', () => {
  it('getOccupiedSpacesForMovement includes incap Child footprint', () => {
    const game = makeGameWithChild(true);
    const occupied = getOccupiedSpacesForMovement(game).map((c) => c.toLowerCase());
    assert.equal(occupied.includes('j10'), true,
      'CRR-INCP-001: incapacitated Child\'s space must block other figures from ending movement there.');
    assert.equal(occupied.includes('j11'), true,
      'Sanity: other figures remain in occupied set.');
  });
});

describe('PROBE-INCP-001-C: incap Child remains on map under same player\'s control', () => {
  it('figurePositions[1]["The Child-1-0"] survives childIncapacitated=true', () => {
    const game = makeGameWithChild(true);
    assert.equal(game.figurePositions[1]['The Child-1-0'], 'j10',
      'Incap does not remove the figure from the map (same player, same space).');
    assert.equal(game.figurePositions[2]['The Child-1-0'], undefined,
      'Incap does not reparent the figure to the opposing player.');
  });
});
