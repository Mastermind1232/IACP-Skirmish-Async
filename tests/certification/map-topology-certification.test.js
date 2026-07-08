/**
 * D10 Map Topology Certification — non-mutating surfacing layer.
 *
 * Validates the structural correctness of the adjacency graph stored in
 * `data/map-spaces.json`. Movement, LOS, and space-control all ride on
 * this graph, so a silent adjacency corruption (asymmetric edge, phantom
 * neighbor, non-king-move teleport) would simultaneously break three
 * subsystems without tripping any existing oracle.
 *
 * This is a CRR heat-map D10 coverage upgrade: inferred_only → certification.
 * Scope is narrow on purpose:
 *   - Graph-level invariants that must hold for every playable map.
 *   - A small set of handcrafted BFS anchor-pair distances on
 *     mos-eisley-outskirts, verified against the map image (main-street
 *     row 17 corridor l17↔o17 = 3, e21↔h21 = 3). Rebuilt 2026-07-08 when
 *     the placeholder full-grid spaces were replaced with the real traced
 *     cells (a1/b1/d1 are off-map background now).
 *
 * What this catches:
 *   - Orphan adjacency entries (coord in adj but not in spaces).
 *   - Phantom neighbors (neighbor coord missing from spaces).
 *   - Self-loops (coord lists itself as a neighbor).
 *   - Duplicate neighbors in a single adjacency list.
 *   - Asymmetric edges (a → b without b → a).
 *   - Non-king-move edges (Chebyshev distance > 1 in the grid).
 *   - Malformed impassable / movement-blocking edges (not two adjacent coords).
 *   - Map-layout corruption that would silently break BFS distance math.
 *
 * What this does NOT catch:
 *   - Semantic correctness of terrain labels.
 *   - Door/blocking-region placement correctness.
 *   - Deployment zone legality (separate lane, D6).
 *   - Connectivity across the whole map (islands are allowed — bridge maps).
 *
 * Failures are aggregated per map so a single run surfaces every violation.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { getMapData, getMapRegistry } from '../../src/data-loader.js';

const MAP_IDS = getMapRegistry()
  .map((m) => m.id)
  .filter((id) => {
    const data = getMapData(id);
    return data && Array.isArray(data.spaces) && data.adjacency;
  });

const COORD_RE = /^([a-z]+)(\d+)$/;

function coordToXY(c) {
  const m = String(c).match(COORD_RE);
  if (!m) return null;
  let col = 0;
  for (const ch of m[1]) col = col * 26 + (ch.charCodeAt(0) - 96);
  return [col - 1, parseInt(m[2], 10) - 1];
}

function chebyshev(a, b) {
  const xa = coordToXY(a);
  const xb = coordToXY(b);
  if (!xa || !xb) return Infinity;
  return Math.max(Math.abs(xa[0] - xb[0]), Math.abs(xa[1] - xb[1]));
}

function bfsDistance(adjacency, src, dst) {
  if (src === dst) return 0;
  const seen = new Set([src]);
  const queue = [[src, 0]];
  let i = 0;
  while (i < queue.length) {
    const [node, d] = queue[i++];
    for (const nb of adjacency[node] || []) {
      if (nb === dst) return d + 1;
      if (!seen.has(nb)) {
        seen.add(nb);
        queue.push([nb, d + 1]);
      }
    }
  }
  return -1;
}

describe('D10 Map Topology Certification', () => {
  it('at least one playable map is registered', () => {
    assert.ok(
      MAP_IDS.length > 0,
      `No playable maps found in data/map-spaces.json; data-loader returned empty set.`
    );
  });

  describe('CERT-MAP-001: adjacency keys ⊆ spaces set', () => {
    for (const mapId of MAP_IDS) {
      it(`${mapId}: every adjacency key is a listed space`, () => {
        const data = getMapData(mapId);
        const spaces = new Set(data.spaces);
        const orphans = Object.keys(data.adjacency).filter((k) => !spaces.has(k));
        assert.deepStrictEqual(
          orphans,
          [],
          `Map ${mapId} has ${orphans.length} adjacency entries whose key is not in the spaces list; first few: ${orphans.slice(0, 5).join(', ')}`
        );
      });
    }
  });

  describe('CERT-MAP-002: every neighbor is a listed space', () => {
    for (const mapId of MAP_IDS) {
      it(`${mapId}: no phantom neighbor coords`, () => {
        const data = getMapData(mapId);
        const spaces = new Set(data.spaces);
        const phantoms = [];
        for (const [a, neighbors] of Object.entries(data.adjacency)) {
          for (const b of neighbors) {
            if (!spaces.has(b)) phantoms.push(`${a}→${b}`);
          }
        }
        assert.deepStrictEqual(
          phantoms,
          [],
          `Map ${mapId} has ${phantoms.length} adjacency edges pointing to non-spaces; first few: ${phantoms.slice(0, 5).join(', ')}`
        );
      });
    }
  });

  describe('CERT-MAP-003: no self-loops', () => {
    for (const mapId of MAP_IDS) {
      it(`${mapId}: no coord lists itself as a neighbor`, () => {
        const data = getMapData(mapId);
        const loops = Object.entries(data.adjacency)
          .filter(([a, neighbors]) => neighbors.includes(a))
          .map(([a]) => a);
        assert.deepStrictEqual(
          loops,
          [],
          `Map ${mapId} has ${loops.length} self-loops; first few: ${loops.slice(0, 5).join(', ')}`
        );
      });
    }
  });

  describe('CERT-MAP-004: no duplicate neighbors', () => {
    for (const mapId of MAP_IDS) {
      it(`${mapId}: each adjacency list is deduped`, () => {
        const data = getMapData(mapId);
        const dupes = [];
        for (const [a, neighbors] of Object.entries(data.adjacency)) {
          if (new Set(neighbors).size !== neighbors.length) dupes.push(a);
        }
        assert.deepStrictEqual(
          dupes,
          [],
          `Map ${mapId} has ${dupes.length} adjacency lists with duplicate neighbors; first few: ${dupes.slice(0, 5).join(', ')}`
        );
      });
    }
  });

  describe('CERT-MAP-005: symmetric adjacency', () => {
    for (const mapId of MAP_IDS) {
      it(`${mapId}: b ∈ adj[a] ⟹ a ∈ adj[b]`, () => {
        const data = getMapData(mapId);
        const asymmetric = [];
        for (const [a, neighbors] of Object.entries(data.adjacency)) {
          for (const b of neighbors) {
            const back = data.adjacency[b] || [];
            if (!back.includes(a)) asymmetric.push(`${a}→${b}`);
          }
        }
        assert.deepStrictEqual(
          asymmetric,
          [],
          `Map ${mapId} has ${asymmetric.length} asymmetric edges; first few: ${asymmetric.slice(0, 5).join(', ')}`
        );
      });
    }
  });

  describe('CERT-MAP-006: every edge is a king-move (Chebyshev ≤ 1)', () => {
    for (const mapId of MAP_IDS) {
      it(`${mapId}: no teleport edges`, () => {
        const data = getMapData(mapId);
        const teleports = [];
        for (const [a, neighbors] of Object.entries(data.adjacency)) {
          for (const b of neighbors) {
            const d = chebyshev(a, b);
            if (d > 1) teleports.push(`${a}→${b} (d=${d})`);
          }
        }
        assert.deepStrictEqual(
          teleports,
          [],
          `Map ${mapId} has ${teleports.length} non-king-move edges; first few: ${teleports.slice(0, 5).join(', ')}`
        );
      });
    }
  });

  describe('CERT-MAP-007: impassable / movement-blocking edges are valid pairs', () => {
    // Edge pairs encode walls between coords. At least one endpoint must
    // be in `spaces` (the wall touches the playable region); the other
    // may be outside (boundary walls at the map edge). The pair must be
    // a king-move step (Chebyshev 1) and not a self-pair.
    for (const mapId of MAP_IDS) {
      it(`${mapId}: every edge is a 2-coord king-move pair touching spaces`, () => {
        const data = getMapData(mapId);
        const spaces = new Set(data.spaces);
        const bad = [];
        const check = (label, edges) => {
          for (const [k, pair] of Object.entries(edges || {})) {
            if (!Array.isArray(pair) || pair.length !== 2) {
              bad.push(`${label}[${k}]: not a 2-element array`);
              continue;
            }
            const [x, y] = pair;
            if (!coordToXY(x)) bad.push(`${label}[${k}]: ${x} is not a valid coord`);
            if (!coordToXY(y)) bad.push(`${label}[${k}]: ${y} is not a valid coord`);
            if (x === y) bad.push(`${label}[${k}]: self-pair ${x}|${y}`);
            if (!spaces.has(x) && !spaces.has(y)) {
              bad.push(`${label}[${k}]: neither ${x} nor ${y} is in spaces`);
            }
            const d = chebyshev(x, y);
            if (d !== 1) bad.push(`${label}[${k}]: ${x}|${y} not adjacent (cheb=${d})`);
          }
        };
        check('impassableEdges', data.impassableEdges);
        check('movementBlockingEdges', data.movementBlockingEdges);
        assert.deepStrictEqual(
          bad,
          [],
          `Map ${mapId} has ${bad.length} malformed edge entries; first few: ${bad.slice(0, 5).join('; ')}`
        );
      });
    }
  });

  describe('CERT-MAP-008: handcrafted BFS anchor distances (mos-eisley-outskirts)', () => {
    const ANCHORS = [
      // l17↔o17 = 3 — open main-street corridor, verified on the map image.
      { src: 'l17', dst: 'o17', expected: 3 },
      // e21↔h21 = 3 — interact legality terminal reachability (heat-map D1 PROBE-INT-*).
      { src: 'e21', dst: 'h21', expected: 3 },
      // m17↔n17 = 1 — adjacent street cells.
      { src: 'm17', dst: 'n17', expected: 1 },
    ];

    for (const { src, dst, expected } of ANCHORS) {
      it(`mos-eisley-outskirts: ${src} ↔ ${dst} = ${expected}`, () => {
        const data = getMapData('mos-eisley-outskirts');
        assert.ok(data, 'mos-eisley-outskirts map data missing');
        const forward = bfsDistance(data.adjacency, src, dst);
        const reverse = bfsDistance(data.adjacency, dst, src);
        assert.strictEqual(
          forward,
          expected,
          `BFS ${src}→${dst} expected ${expected}, got ${forward}`
        );
        assert.strictEqual(
          reverse,
          expected,
          `BFS ${dst}→${src} expected ${expected} (symmetric), got ${reverse}`
        );
      });
    }
  });
});
