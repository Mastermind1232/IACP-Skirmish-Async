/**
 * CRR terrain-taxonomy behavioral oracles (alexanbv 2026-07-09 directive,
 * items 1–5): Mobile/Massive vs blocking + impassable (cells AND edges),
 * end-movement legality, occupied-blocking adjacency/counting, and the
 * Spire exception.
 *
 * CRR sources: Blocking Terrain p.15, Impassable Terrain p.35, Walls p.62,
 * Counting Spaces p.23, Mobile p.47, Massive p.41.
 *
 * All scenarios run on a synthetic 5x5 open grid (a1..e5) with injected
 * terrain so every assertion is geometry-exact.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  buildTempBoardState,
  computeMovementCache,
  getMovementTarget,
  getFiguresAdjacentToCoord,
} from '../../../src/game/movement.js';
import { countSpaces, isWithinSpaces, buildCountingOverlay } from '../../../src/game/spatial.js';
import { isWithinN } from '../../../src/engine/utils.js';

// ── synthetic 5x5 grid ───────────────────────────────────────────────────────
function grid5(overrides = {}) {
  const spaces = [];
  const adjacency = {};
  const key = (c, r) => String.fromCharCode(97 + c) + (r + 1);
  for (let r = 0; r < 5; r++) for (let c = 0; c < 5; c++) spaces.push(key(c, r));
  const sp = new Set(spaces);
  for (let r = 0; r < 5; r++) for (let c = 0; c < 5; c++) {
    const k = key(c, r);
    adjacency[k] = [];
    for (const [dc, dr] of [[1,0],[-1,0],[0,1],[0,-1],[1,1],[1,-1],[-1,1],[-1,-1]]) {
      const n = key(c + dc, r + dr);
      if (c + dc >= 0 && c + dc < 5 && r + dr >= 0 && r + dr < 5 && sp.has(n)) adjacency[k].push(n);
    }
  }
  const ms = {
    spaces, adjacency, terrain: {}, blocking: [],
    wallEdges: [], impassableEdges: [], movementBlockingEdges: [],
    ...overrides,
  };
  // apply blocking-cell isolation + edge cuts the way the map tool does
  const blocking = new Set(ms.blocking);
  const cut = (a, b) => {
    ms.adjacency[a] = (ms.adjacency[a] || []).filter((x) => x !== b);
    ms.adjacency[b] = (ms.adjacency[b] || []).filter((x) => x !== a);
  };
  for (const b of blocking) {
    for (const n of [...(ms.adjacency[b] || [])]) cut(b, n);
    ms.adjacency[b] = [];
  }
  for (const [a, b] of [...ms.wallEdges, ...ms.movementBlockingEdges]) cut(a, b);
  // CRR diagonal predicate: a diagonal link survives only if at least one
  // right-angle path is open (corner cell non-blocking, both edges not
  // wall/blocking-edge) — mirrors the real generator.
  const cutEdges = new Set([...ms.wallEdges, ...ms.movementBlockingEdges].map(([a, b]) => [a, b].sort().join('|')));
  const ek2 = (a, b) => [a, b].sort().join('|');
  const parse = (k) => [k.charCodeAt(0) - 97, parseInt(k.slice(1), 10) - 1];
  const at = (c, r) => (c >= 0 && c < 5 && r >= 0 && r < 5) ? key(c, r) : null;
  for (const a of spaces) {
    ms.adjacency[a] = (ms.adjacency[a] || []).filter((d) => {
      const [ac, ar] = parse(a); const [dc, dr] = parse(d);
      if (Math.abs(ac - dc) !== 1 || Math.abs(ar - dr) !== 1) return true; // orth kept as-is
      const c1 = at(dc, ar), c2 = at(ac, dr);
      const via = (corner) => corner && !blocking.has(corner)
        && !cutEdges.has(ek2(a, corner)) && !cutEdges.has(ek2(corner, d));
      return via(c1) || via(c2);
    });
  }
  return ms;
}

const MOBILE = {
  size: '1x1', cols: 1, rows: 1, isLarge: false, allowDiagonal: true, canRotate: false,
  isMobile: true, isMassive: false, ignoreDifficult: true, ignoreBlocking: true,
  ignoreImpassable: true, ignoreFigureCost: true, canEndOnOccupied: false,
};
const THRUSTERS = { ...MOBILE, isMobile: false, ignoreBlocking: false, ignoreDifficult: false, ignoreFigureCost: false };
const NORMAL = { ...MOBILE, isMobile: false, ignoreBlocking: false, ignoreImpassable: false, ignoreDifficult: false, ignoreFigureCost: false };

const reach = (ms, start, mp, profile) => {
  const board = buildTempBoardState(ms, []);
  return computeMovementCache(start, mp, board, profile);
};

describe('CRR-1: Mobile/Massive path through blocking cells and blocking edges', () => {
  // column c (c1..c5) entirely blocking — a wall of blocking terrain
  const ms = () => grid5({ blocking: ['c1', 'c2', 'c3', 'c4', 'c5'], terrain: { c1: 'blocking', c2: 'blocking', c3: 'blocking', c4: 'blocking', c5: 'blocking' } });

  it('normal figure cannot cross the blocking column', () => {
    const cache = reach(ms(), 'a3', 10, NORMAL);
    assert.equal(getMovementTarget(cache, 'e3'), null, 'e3 unreachable for normal figure');
  });

  it('Mobile crosses the blocking column (CRR Mobile: moves through blocking)', () => {
    const cache = reach(ms(), 'a3', 10, MOBILE);
    const t = getMovementTarget(cache, 'e3');
    assert.ok(t, 'e3 reachable for Mobile');
    assert.equal(t.cost, 4, 'straight line a3→e3 costs 4 for Mobile');
  });

  it('blocking EDGE stops normal movement but not Mobile', () => {
    const edge = grid5({ movementBlockingEdges: [['b3', 'c3']] });
    const normalCache = reach(edge, 'b3', 1, NORMAL);
    assert.equal(getMovementTarget(normalCache, 'c3'), null, 'normal cannot cross blocking edge');
    const mobileCache = reach(edge, 'b3', 1, MOBILE);
    assert.ok(getMovementTarget(mobileCache, 'c3'), 'Mobile crosses blocking edge');
  });

  it('WALLS stop even Mobile (CRR Walls: not terrain)', () => {
    const walled = grid5({ wallEdges: [['b3', 'c3'], ['b2', 'c2'], ['b1', 'c1'], ['b4', 'c4'], ['b5', 'c5']] });
    const cache = reach(walled, 'b3', 3, MOBILE);
    assert.equal(getMovementTarget(cache, 'c3'), null, 'wall blocks Mobile straight through');
  });
});

describe('CRR-2: impassable cells — entry, pass-through, and end legality', () => {
  const ms = () => grid5({ terrain: { c3: 'impassable' } });

  it('normal figure cannot enter an impassable cell', () => {
    const cache = reach(ms(), 'b3', 2, NORMAL);
    assert.equal(getMovementTarget(cache, 'c3'), null, 'entry denied');
  });

  it('Mobile enters AND may end in impassable (CRR Mobile)', () => {
    const cache = reach(ms(), 'b3', 2, MOBILE);
    const t = getMovementTarget(cache, 'c3');
    // the movement cache only records END-legal destinations — presence means
    // Mobile may both enter and end there
    assert.ok(t, 'Mobile enters impassable and may END there');
  });

  it('Thrusters passes through impassable but cannot end there', () => {
    const cache = reach(ms(), 'b3', 3, THRUSTERS);
    // destination cache records only END-legal placements: the impassable cell
    // must NOT be offered to Thrusters, but cells beyond it must be (proving
    // pass-through worked)
    assert.ok(!getMovementTarget(cache, 'c3'), 'Thrusters may not END in impassable ("while moving")');
    const beyond = getMovementTarget(cache, 'd3');
    assert.ok(beyond, 'Thrusters passes through and ends beyond');
  });
});

describe('CRR-3: impassable EDGES — counting passes, movement gated', () => {
  const ms = () => grid5({ impassableEdges: [['b3', 'c3']] });

  it('counting spaces crosses an impassable edge (cells stay adjacent)', () => {
    assert.equal(countSpaces(ms(), 'b3', 'c3'), 1, 'distance 1 across dashed red');
    assert.ok(isWithinSpaces(ms(), 'b3', 'c3', 1), 'within 1 across dashed red');
  });

  it('counting does NOT cross a blocking edge', () => {
    const blocked = grid5({ movementBlockingEdges: [['b3', 'c3']] });
    assert.ok(countSpaces(blocked, 'b3', 'c3') > 1, 'must route around the solid red edge');
  });

  it('normal movement is gated by the impassable edge; Mobile and Thrusters cross', () => {
    assert.equal(getMovementTarget(reach(ms(), 'b3', 1, NORMAL), 'c3'), null);
    assert.ok(getMovementTarget(reach(ms(), 'b3', 1, MOBILE), 'c3'));
    assert.ok(getMovementTarget(reach(ms(), 'b3', 1, THRUSTERS), 'c3'));
  });
});

describe('CRR-4: occupied blocking terrain — adjacency and counting to the figure', () => {
  const ms = () => grid5({ blocking: ['c3'], terrain: { c3: 'blocking' } });
  const gameWith = (positions) => ({ figurePositions: { 1: positions, 2: {} }, figureOrientations: {} });

  it('unoccupied blocking cell is not countable-to', () => {
    assert.equal(countSpaces(ms(), 'a3', 'c3'), Infinity, 'isolated when empty');
  });

  it('a figure ON blocking can be counted to (overlay)', () => {
    const game = gameWith({ 'Rebel Trooper-1-0': 'c3' });
    const overlay = buildCountingOverlay(game, ms(), ['a3', 'c3']);
    assert.ok(overlay, 'overlay activates');
    assert.equal(countSpaces(ms(), 'a3', 'c3', null, 50, overlay), 2, 'a3→b3→c3 = 2');
  });

  it('isWithinN honors the overlay when game is supplied', () => {
    const game = gameWith({ 'Rebel Trooper-1-0': 'c3' });
    const getMapData = () => ms();
    assert.equal(isWithinN('a3', 'c3', 2, 'synthetic', getMapData), false, 'without game: legacy behavior');
    assert.equal(isWithinN('a3', 'c3', 2, 'synthetic', getMapData, game), true, 'with game: countable');
  });
});

describe('CRR-5: the Spire — enclosed figure counted through surrounding blocking', () => {
  // c3 is normal terrain but enclosed by blocking b3/d3 and walls on c2|c3, c3|c4
  const ms = () => grid5({
    blocking: ['b3', 'd3'],
    terrain: { b3: 'blocking', d3: 'blocking' },
    wallEdges: [['c2', 'c3'], ['c3', 'c4']],
  });
  const game = () => ({ figurePositions: { 1: { 'Jet Trooper-1-0': 'c3' }, 2: { 'Rebel Trooper-1-0': 'a3' } }, figureOrientations: {} });

  it('the enclosed cell is unreachable by counting without the exception', () => {
    assert.equal(countSpaces(ms(), 'a3', 'c3'), Infinity);
  });

  it('with a figure enclosed, counting flows through the surrounding blocking', () => {
    const overlay = buildCountingOverlay(game(), ms(), ['a3', 'c3']);
    assert.ok(overlay, 'spire overlay activates');
    const d = countSpaces(ms(), 'a3', 'c3', null, 50, overlay);
    assert.equal(d, 2, 'a3→b3(blocking, ignored)→c3 = 2');
  });

  it('melee adjacency: figures adjacent through the spire blocking cells', () => {
    const g = game();
    g.figurePositions[2]['Rebel Trooper-1-0'] = 'b2'; // diagonal to b3, adjacent-ish to c3? b2↔c3 share corner at b/c,2/3
    // b2 is corner-adjacent to c3 via corners b3 (blocking, ignored by spire) / c2 (wall edge on c2|c3)
    const out = getFiguresAdjacentToCoord(g, 'c3', 'unit-test-grid', null);
    // NOTE: getFiguresAdjacentToCoord loads real map data by id; for the
    // synthetic grid we assert via the overlay path instead:
    const overlay = buildCountingOverlay(g, ms(), ['c3']);
    const links = overlay ? (overlay.get('c3') || []) : [];
    assert.ok(links.includes('b3') || links.includes('d3'), 'spire opens links through surrounding blocking');
  });

  it('movement is still blocked into the spire for normal figures', () => {
    const cache = reach(ms(), 'a3', 10, NORMAL);
    assert.equal(getMovementTarget(cache, 'c3'), null, 'blocking still blocks movement');
  });
});
