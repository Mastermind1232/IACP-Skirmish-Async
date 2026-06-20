import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { getClosedDoorEdges, countGameSpaces, getFiguresOnOrAdjacentToSpace } from './board-helpers.js';
import { edgeKey } from './coords.js';

describe('getClosedDoorEdges', () => {
  it('returns empty set when game has no map', () => {
    const game = {};
    assert.strictEqual(getClosedDoorEdges(game).size, 0);
  });

  it('returns empty set for null game', () => {
    assert.strictEqual(getClosedDoorEdges(null).size, 0);
  });

  it('returns all door edges when no doors are opened', () => {
    const game = { selectedMap: { id: 'mos-eisley-outskirts' } };
    const edges = getClosedDoorEdges(game);
    // mos-eisley-outskirts current door set: r11|r12, s11|s12
    assert.strictEqual(edges.size, 2);
    assert.ok(edges.has(edgeKey('r11', 'r12')));
    assert.ok(edges.has(edgeKey('s11', 's12')));
  });

  it('excludes opened doors', () => {
    const game = {
      selectedMap: { id: 'mos-eisley-outskirts' },
      openedDoors: [edgeKey('r11', 'r12')],
    };
    const edges = getClosedDoorEdges(game);
    assert.strictEqual(edges.size, 1);
    assert.ok(!edges.has(edgeKey('r11', 'r12')));
    assert.ok(edges.has(edgeKey('s11', 's12')));
  });

  it('returns empty set when all doors are opened', () => {
    const game = {
      selectedMap: { id: 'mos-eisley-outskirts' },
      openedDoors: [
        edgeKey('r11', 'r12'),
        edgeKey('s11', 's12'),
      ],
    };
    assert.strictEqual(getClosedDoorEdges(game).size, 0);
  });
});

describe('countGameSpaces', () => {
  it('returns Infinity when game has no map', () => {
    assert.strictEqual(countGameSpaces({}, 'a1', 'a2'), Infinity);
  });

  it('returns 0 for same coord', () => {
    const game = { selectedMap: { id: 'mos-eisley-outskirts' } };
    assert.strictEqual(countGameSpaces(game, 'a1', 'a1'), 0);
  });

  it('returns BFS distance for adjacent spaces', () => {
    const game = { selectedMap: { id: 'mos-eisley-outskirts' } };
    // m17 and m16 are door-adjacent — with door closed, path must go around
    // m17 and m18 should be adjacent on the map (1 step)
    const dist = countGameSpaces(game, 'm17', 'm18');
    assert.ok(dist >= 0 && dist < Infinity, `expected finite distance, got ${dist}`);
  });
});

describe('getFiguresOnOrAdjacentToSpace — multi-cell footprint', () => {
  // 2026-05-05 audit: function only checked figure anchors, missing Massive
  // figures whose footprint touches the controlSet via a non-anchor cell.
  // Real CRR deviation for crate control + crate explosion damage rules.
  // Mirrors the footprint loop in getFiguresAdjacentToCoord.
  const MAP_ID = 'mos-eisley-outskirts';

  it('detects a 1x1 figure on the target coord (sanity)', () => {
    const game = {
      selectedMap: { id: MAP_ID },
      figurePositions: { 1: { 'Stormtrooper-1-0': 'b2' } },
      figureOrientations: {},
    };
    const result = getFiguresOnOrAdjacentToSpace(game, 1, 'b2', MAP_ID);
    assert.ok(result.includes('Stormtrooper-1-0'), 'figure on coord must be detected');
  });

  it('detects a 1x1 figure adjacent to the target coord (sanity)', () => {
    const game = {
      selectedMap: { id: MAP_ID },
      figurePositions: { 1: { 'Stormtrooper-1-0': 'b1' } },
      figureOrientations: {},
    };
    const result = getFiguresOnOrAdjacentToSpace(game, 1, 'b2', MAP_ID);
    assert.ok(result.includes('Stormtrooper-1-0'), 'orthogonally adjacent figure must be detected');
  });

  it('LATENT-MASSIVE-CONTROL: 2x2 figure adjacent via non-anchor footprint cell must be detected (target d2)', () => {
    // AT-DP at b2 ({b2, c2, b3, c3}). Target d2.
    //   - Anchor b2: Chebyshev distance 2 from d2 → NOT in d2's controlSet.
    //   - Footprint cell c2: distance 1 from d2 → IS in d2's neighbors.
    // Pre-fix (anchor-only): missed. Post-fix (footprint loop): detected.
    // This is the tripwire — fails immediately if anyone reverts the
    // footprint iteration back to a single-coord check.
    const game = {
      selectedMap: { id: MAP_ID },
      figurePositions: { 1: { 'AT-DP-1-0': 'b2' } },
      figureOrientations: { 'AT-DP-1-0': '2x2' },
    };
    const result = getFiguresOnOrAdjacentToSpace(game, 1, 'd2', MAP_ID);
    assert.ok(
      result.includes('AT-DP-1-0'),
      '2x2 figure must be detected via footprint-cell adjacency, not just anchor adjacency',
    );
  });

  it('LATENT-MASSIVE-CONTROL: 2x2 figure adjacent via diagonal footprint cell must be detected (target d3)', () => {
    // Second tripwire pinning a diagonal-adjacency case. AT-DP at b2,
    // target d3. Anchor b2 is Chebyshev distance 2 from d3; footprint
    // cell c3 is distance 1 from d3 (diagonal).
    const game = {
      selectedMap: { id: MAP_ID },
      figurePositions: { 1: { 'AT-DP-1-0': 'b2' } },
      figureOrientations: { 'AT-DP-1-0': '2x2' },
    };
    const result = getFiguresOnOrAdjacentToSpace(game, 1, 'd3', MAP_ID);
    assert.ok(
      result.includes('AT-DP-1-0'),
      '2x2 figure must be detected via diagonal-adjacent footprint cell',
    );
  });

  it('does not detect figures of the wrong player', () => {
    const game = {
      selectedMap: { id: MAP_ID },
      figurePositions: { 2: { 'Rebel-1-0': 'b2' } },
      figureOrientations: {},
    };
    const result = getFiguresOnOrAdjacentToSpace(game, 1, 'b2', MAP_ID);
    assert.equal(result.length, 0, 'player filter must hold (only playerNum=1 figures returned)');
  });
});

import { getDcKeywords } from '../data-loader.js';

describe('getDcKeywords — Programming Override (4-LOM) trait injection', () => {
  it('injects the round-chosen trait into 4-LOM keywords', () => {
    const game = { roundProgrammingOverrideTrait: { 1: 'HUNTER' }, p1DcList: [{ dcName: '4-LOM' }] };
    const kw = getDcKeywords(game)['4-LOM'];
    assert.ok(kw.map((k) => String(k).toUpperCase()).includes('HUNTER'), 'HUNTER injected');
    assert.ok(kw.map((k) => String(k).toUpperCase()).includes('DROID'), 'base DROID retained');
  });

  it('does not inject when 4-LOM is not in that player\'s army', () => {
    const game = { roundProgrammingOverrideTrait: { 2: 'SMUGGLER' }, p1DcList: [{ dcName: '4-LOM' }], p2DcList: [] };
    const kw = getDcKeywords(game)['4-LOM'] || [];
    assert.ok(!kw.map((k) => String(k).toUpperCase()).includes('SMUGGLER'), 'no cross-player injection');
  });

  it('no trait set → 4-LOM keeps only its base keywords', () => {
    const game = { roundProgrammingOverrideTrait: {}, p1DcList: [{ dcName: '4-LOM' }] };
    const kw = getDcKeywords(game)['4-LOM'];
    assert.deepStrictEqual(kw.map((k) => String(k).toUpperCase()).sort(), ['DROID']);
  });
});
