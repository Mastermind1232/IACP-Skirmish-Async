/**
 * Kuiil "Hop On!" on-enter push helper (computeHopOnPush) — alexanbv 2026-06-21
 * CORRECTED model. Pure geometry tests, including the designer's worked example.
 *
 * Worked example (designer): a line of spaces A1..A10. Kuiil is 2x1 starting in
 * A1-2. A SMALL friendly figure in A4. After Hop On designates the A4 figure and
 * Kuiil starts moving step-by-step rightward (increasing column), each step that
 * ENTERS the figure's space pushes it 1 space ahead:
 *   - Kuiil A2-3 → A3-4 (front cell enters A4) → push A4 figure to A5.
 *   - Kuiil A3-4 → A4-5 (enters A5 where the figure now is) → push A5 → A6.
 *   - …repeats for remaining MP.
 *
 * NOTE: this repo's coordinate convention is letter=COLUMN, number=ROW. To model
 * the designer's straight LINE we hold the row constant and march across COLUMNS
 * (a4, b4, c4, …), which is geometrically identical to their A1..A10 line.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { computeHopOnPush, stepDirection, applyHopOnPush } from './hop-on.js';

// A small open patch of board: rows 3..5, cols a..f, all valid + empty.
function openBoard() {
  const cols = ['a', 'b', 'c', 'd', 'e', 'f', 'g'];
  const rows = [3, 4, 5];
  const spacesSet = new Set();
  for (const c of cols) for (const r of rows) spacesSet.add(`${c}${r}`);
  return { spacesSet, occupiedSet: new Set(), blockingSet: new Set() };
}

describe('stepDirection', () => {
  it('normalizes a single-column step to +1 dx', () => {
    assert.deepEqual(stepDirection('b4', 'c4'), { dx: 1, dy: 0 });
  });
  it('normalizes a single-row step to +1 dy', () => {
    assert.deepEqual(stepDirection('b4', 'b5'), { dx: 0, dy: 1 });
  });
  it('returns null for no movement', () => {
    assert.equal(stepDirection('b4', 'b4'), null);
  });
  it('normalizes a multi-space jump to a unit vector (defensive)', () => {
    assert.deepEqual(stepDirection('a4', 'd4'), { dx: 1, dy: 0 });
  });
});

describe('computeHopOnPush — entry detection', () => {
  it('no push when Kuiil does not enter the designated figure space', () => {
    const board = openBoard();
    const r = computeHopOnPush({
      kuiilStartCoord: 'a4', kuiilNewCoord: 'b4', kuiilSize: '1x1',
      designatedPos: 'd4', designatedSize: '1x1', ...board,
    });
    assert.equal(r.entered, false);
    assert.equal(r.pushed, false);
  });

  it('pushes 1 space ahead (in travel direction) when Kuiil ENTERS the space', () => {
    const board = openBoard();
    // Kuiil (1x1) moves c4 → d4, entering the figure at d4. Travel = +col.
    const r = computeHopOnPush({
      kuiilStartCoord: 'c4', kuiilNewCoord: 'd4', kuiilSize: '1x1',
      designatedPos: 'd4', designatedSize: '1x1', ...board,
    });
    assert.equal(r.entered, true);
    assert.equal(r.pushed, true);
    assert.equal(r.fromPos, 'd4');
    assert.equal(r.toPos, 'e4', 'figure pushed straight ahead (one column further) along the move');
  });

  it('detects entry via a 2x1 Kuiil footprint (designer example shape)', () => {
    const board = openBoard();
    // Kuiil 2x1 (topLeft + the cell to its right): topLeft c4 occupies c4,d4.
    // Moving b4(→b4,c4) → c4(→c4,d4): the new footprint's right cell d4 enters
    // the figure at d4 → push to e4.
    const r = computeHopOnPush({
      kuiilStartCoord: 'b4', kuiilNewCoord: 'c4', kuiilSize: '2x1',
      designatedPos: 'd4', designatedSize: '1x1', ...board,
    });
    assert.equal(r.entered, true);
    assert.equal(r.pushed, true);
    assert.equal(r.toPos, 'e4');
  });
});

describe('computeHopOnPush — designer worked example (repeated pushes)', () => {
  it('reproduces the chain: enter → push ahead → repeats each step', () => {
    const board = openBoard();
    // Mutable figure position, marched by a 1x1 Kuiil across columns a..f at row 4.
    let figPos = 'c4';
    const steps = [
      { from: 'b4', to: 'c4' }, // Kuiil enters c4 (figure) → push c4 → d4
      { from: 'c4', to: 'd4' }, // Kuiil enters d4 (figure now here) → push d4 → e4
      { from: 'd4', to: 'e4' }, // Kuiil enters e4 → push e4 → f4
    ];
    const pushes = [];
    for (const s of steps) {
      const r = computeHopOnPush({
        kuiilStartCoord: s.from, kuiilNewCoord: s.to, kuiilSize: '1x1',
        designatedPos: figPos, designatedSize: '1x1', ...board,
      });
      assert.equal(r.entered, true, `step ${s.from}->${s.to} should enter the figure space`);
      assert.equal(r.pushed, true, `step ${s.from}->${s.to} should push`);
      pushes.push(r.toPos);
      figPos = r.toPos; // figure advances; Kuiil chases it next step
    }
    assert.deepEqual(pushes, ['d4', 'e4', 'f4'], 'figure pushed one space ahead on each entry');
  });
});

describe('applyHopOnPush — applies the push to game state (worked example)', () => {
  function buildGame(figPos) {
    return { figurePositions: { 1: { 'Kuiil-1-0': 'b4', 'Bodhi Rook-1-0': figPos } } };
  }
  it('writes the pushed figure position when Kuiil enters its space', () => {
    const board = openBoard();
    const game = buildGame('c4');
    const r = applyHopOnPush(game, 1, 'Bodhi Rook-1-0', {
      kuiilStartCoord: 'b4', kuiilNewCoord: 'c4', kuiilSize: '1x1',
      designatedSize: '1x1', ...board,
    });
    assert.equal(r.pushed, true);
    assert.equal(game.figurePositions[1]['Bodhi Rook-1-0'], 'd4', 'figure pushed ahead in game state');
  });

  it('chains across repeated entries — figure advances each step', () => {
    const board = openBoard();
    const game = buildGame('c4');
    const steps = [
      { from: 'b4', to: 'c4' },
      { from: 'c4', to: 'd4' },
      { from: 'd4', to: 'e4' },
    ];
    const seen = [];
    for (const s of steps) {
      const r = applyHopOnPush(game, 1, 'Bodhi Rook-1-0', {
        kuiilStartCoord: s.from, kuiilNewCoord: s.to, kuiilSize: '1x1',
        designatedSize: '1x1', ...board,
      });
      assert.equal(r.pushed, true);
      seen.push(game.figurePositions[1]['Bodhi Rook-1-0']);
    }
    assert.deepEqual(seen, ['d4', 'e4', 'f4'], 'figure pushed one space ahead on each entry');
  });

  it('leaves game state unchanged when Kuiil does not enter the figure space', () => {
    const board = openBoard();
    const game = buildGame('f3');
    const r = applyHopOnPush(game, 1, 'Bodhi Rook-1-0', {
      kuiilStartCoord: 'b4', kuiilNewCoord: 'c4', kuiilSize: '1x1',
      designatedSize: '1x1', ...board,
    });
    assert.equal(r.entered, false);
    assert.equal(game.figurePositions[1]['Bodhi Rook-1-0'], 'f3', 'figure not moved');
  });
});

describe('computeHopOnPush — blocked / graceful handling', () => {
  it('entered but not pushed when the straight-ahead space is off-board and no flank works', () => {
    // Tiny board: only b4,c4 exist. Kuiil enters c4; straight ahead d4 off-board.
    const spacesSet = new Set(['b4', 'c4']);
    const r = computeHopOnPush({
      kuiilStartCoord: 'b4', kuiilNewCoord: 'c4', kuiilSize: '1x1',
      designatedPos: 'c4', designatedSize: '1x1',
      spacesSet, occupiedSet: new Set(), blockingSet: new Set(),
    });
    assert.equal(r.entered, true);
    assert.equal(r.pushed, false);
    assert.equal(r.reason, 'blocked');
  });

  it('falls back to a flanking diagonal when straight-ahead is occupied', () => {
    const board = openBoard();
    // Straight-ahead e4 occupied → push should flank to e3 or e5.
    board.occupiedSet = new Set(['e4']);
    const r = computeHopOnPush({
      kuiilStartCoord: 'c4', kuiilNewCoord: 'd4', kuiilSize: '1x1',
      designatedPos: 'd4', designatedSize: '1x1', ...board,
    });
    assert.equal(r.entered, true);
    assert.equal(r.pushed, true);
    assert.ok(['e3', 'e5'].includes(r.toPos), `flank push used (${r.toPos})`);
  });

  it('skips a blocking-terrain destination', () => {
    const board = openBoard();
    board.blockingSet = new Set(['e4']);
    const r = computeHopOnPush({
      kuiilStartCoord: 'c4', kuiilNewCoord: 'd4', kuiilSize: '1x1',
      designatedPos: 'd4', designatedSize: '1x1', ...board,
    });
    assert.equal(r.pushed, true);
    assert.notEqual(r.toPos, 'e4', 'blocking terrain not used as a push destination');
  });
});
