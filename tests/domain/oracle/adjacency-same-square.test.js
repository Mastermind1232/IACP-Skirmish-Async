/**
 * Regression: figure-adjacency must include same-square figures.
 *
 * CRR rule (figure adjacency): "Two figures are adjacent if a space one
 * occupies is adjacent to a space the other occupies, OR if both figures
 * occupy the same space."
 *
 * Companions (e.g. The Child via Clan of Two) are the most common
 * same-square case — they routinely share the host's space. Other
 * cases: massive-figure displacement that ends with a small rider on
 * the same space, etc.
 *
 * 2026-05-04 incident: live game 00001 — destruct's C-3PO walked onto
 * The Child's square at t12. Inform's "adjacent friendly figure" picker
 * silently skipped The Child because getFiguresAdjacentToTarget didn't
 * include the activator's own footprint cells in the adjacency set
 * (its sister function getFiguresAdjacentToCoord, used for blast/cleave,
 * already does). Two functions drifted on this one detail.
 *
 * This test pins same-square = adjacent for getFiguresAdjacentToTarget
 * using real map data so any future regression that re-excludes the
 * own-cell will fail.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { getFiguresAdjacentToTarget } from '../../../src/game/movement.js';

function makeGame(positions) {
  return {
    figurePositions: positions,
    figureOrientations: {},
    selectedMap: { id: 'mos-eisley-outskirts' },
  };
}

describe('getFiguresAdjacentToTarget — same-square adjacency (CRR figure rule)', () => {
  it('returns a friendly figure that shares the activator\'s space (companion case)', () => {
    // Activator (C-3PO analogue) and friendly companion (The Child analogue)
    // both at b2. CRR: same-square IS adjacent.
    const game = makeGame({
      2: {
        'C-3PO-1-0': 'b2',
        'The Child-0-0': 'b2',
      },
    });
    const adj = getFiguresAdjacentToTarget(game, 'C-3PO-1-0', 'mos-eisley-outskirts');
    const found = adj.find((f) => f.figureKey === 'The Child-0-0');
    assert.ok(found, 'same-square companion must appear in adjacency result');
    assert.equal(found.playerNum, 2);
  });

  it('still returns a neighbor figure (does not regress non-same-square case)', () => {
    // Sanity: actual neighbor figures must still come through.
    const game = makeGame({
      2: {
        'C-3PO-1-0': 'b2',
        'Baze Malbus-1-0': 'b3', // adjacent (south)
      },
    });
    const adj = getFiguresAdjacentToTarget(game, 'C-3PO-1-0', 'mos-eisley-outskirts');
    const found = adj.find((f) => f.figureKey === 'Baze Malbus-1-0');
    assert.ok(found, 'orthogonal neighbor must still appear in adjacency result');
  });

  it('LATENT-ADJ-OWN-CELL: same-square inclusion is a stable invariant — both same-square and neighbors return together', () => {
    // Tripwire: if anyone removes adjacentSet.add(c), the same-square
    // companion vanishes from the result while the neighbor stays — a
    // very specific failure shape that this test pins.
    const game = makeGame({
      2: {
        'C-3PO-1-0': 'b2',
        'The Child-0-0': 'b2',  // same square
        'Baze Malbus-1-0': 'b3', // adjacent neighbor
      },
    });
    const adj = getFiguresAdjacentToTarget(game, 'C-3PO-1-0', 'mos-eisley-outskirts');
    const keys = new Set(adj.map((f) => f.figureKey));
    assert.ok(keys.has('The Child-0-0'),
      'same-square companion must be present (tripwire: own-cell excluded if missing)');
    assert.ok(keys.has('Baze Malbus-1-0'),
      'neighbor figure must be present (tripwire: regression in adjacency lookup)');
  });
});
