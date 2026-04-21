/**
 * Phase-D behavioral probe — CRR-PLC-001 + CRR-PLC-003.
 *
 * CRR-PLC-001: "When a figure on the map is placed, it is removed from its
 *               current space and then placed where indicated."
 * CRR-PLC-003: "A player cannot choose to place a figure in a space where it
 *               cannot end movement (occupied, blocking, impassable) unless
 *               an ability explicitly allows it."
 *
 * The existing direct_oracle (krykna-placement-behavioral.test.js) pins one
 * assertion each. The missing half is the canonical write-path invariants for
 * `pushFigure` — the helper every place/teleport/displacement call site uses:
 *
 *   - Atomic overwrite: the figure's position record goes from prevPos to
 *     newPos in a single write; no intermediate "deleted" state is observable.
 *     (exits-old-enters-new clause of PLC-001 / PLC-004.)
 *   - Normalization: newPos is lowercased — guards against case-drift across
 *     case-insensitive coord comparisons elsewhere.
 *   - Ghost-write guard: pushFigure on a figure without a prior position
 *     returns null instead of writing — supports the PLC-003 "must have been
 *     on the map" precondition and prevents placement from materializing a
 *     figure that was never legally placed.
 *
 * PROBE-PLC-001-A: pushFigure overwrites prevPos → newPos atomically
 * PROBE-PLC-001-B: pushFigure lowercases newSpace
 * PROBE-PLC-001-C: pushFigure returns { prevPos, newPos } on success
 * PROBE-PLC-003-A: pushFigure returns null and writes nothing when prevPos missing
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { pushFigure } from '../../../src/game/player-helpers.js';

describe('PROBE-PLC-001-A: pushFigure overwrites prevPos with newPos atomically', () => {
  it('prevPos=a1 → newPos=c3: positions record holds only c3 after the call', () => {
    const game = { figurePositions: { 1: { 'Han Solo-1-0': 'a1' } } };
    const res = pushFigure(game, 1, 'Han Solo-1-0', 'c3');
    assert.equal(game.figurePositions[1]['Han Solo-1-0'], 'c3',
      'CRR-PLC-001: place writes new space atomically; record holds only the new position.');
    assert.equal(res.prevPos, 'a1',
      'Return value captures prevPos for callers that need the exits-old coord.');
    assert.equal(res.newPos, 'c3',
      'Return value captures the normalized newPos.');
  });
});

describe('PROBE-PLC-001-B: pushFigure normalizes newSpace to lowercase', () => {
  it('newSpace="C3" stored as "c3"', () => {
    const game = { figurePositions: { 1: { 'Han Solo-1-0': 'a1' } } };
    const res = pushFigure(game, 1, 'Han Solo-1-0', 'C3');
    assert.equal(game.figurePositions[1]['Han Solo-1-0'], 'c3',
      'Place writes the lowercased coord (case-insensitive downstream comparisons).');
    assert.equal(res.newPos, 'c3', 'Returned newPos matches the written value.');
  });
});

describe('PROBE-PLC-001-C: pushFigure returns null when the figure has no prior position', () => {
  it('no entry in figurePositions[playerNum] → returns null and writes nothing', () => {
    const game = { figurePositions: { 1: {} } };
    const res = pushFigure(game, 1, 'Han Solo-1-0', 'c3');
    assert.equal(res, null,
      'CRR-PLC-003 precondition: place/push of an un-deployed figure is rejected (no ghost writes).');
    assert.equal(game.figurePositions[1]['Han Solo-1-0'], undefined,
      'No ghost write: figurePositions must remain empty for the missing figureKey.');
  });

  it('missing playerNum bucket → returns null, no throw', () => {
    const game = { figurePositions: {} };
    const res = pushFigure(game, 1, 'Han Solo-1-0', 'c3');
    assert.equal(res, null, 'Defensive guard: absent player bucket returns null rather than throwing.');
  });
});

describe('PROBE-PLC-003-A: place does not re-enter a figure that was never on the map', () => {
  it('pushFigure rejects figureKey whose prevPos is explicitly undefined', () => {
    // Represents a DC that was defeated and removed from figurePositions.
    // Attempting to "place" it via pushFigure must not resurrect it — the
    // resurrection substrate is a separate pathway (setFigurePosition) that
    // is not used by place/push/displacement.
    const game = { figurePositions: { 1: { 'Han Solo-1-0': undefined } } };
    const res = pushFigure(game, 1, 'Han Solo-1-0', 'c3');
    assert.equal(res, null,
      'CRR-PLC-003 guard: a defeated (undefined prevPos) figure cannot be placed via pushFigure.');
    assert.equal(game.figurePositions[1]['Han Solo-1-0'], undefined,
      'Record remains undefined — no spontaneous re-entry.');
  });
});
