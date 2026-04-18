/**
 * Phase-D probes: adjacency graph invariants around blocking terrain.
 *
 * The pre-built map adjacency graph (data/map-spaces.json) is the single
 * source of truth for whether two spaces are "adjacent" for rule purposes
 * (ability ranges, token control, counting spaces, etc.). The graph is
 * constructed so blocking-terrain cells are isolated — they have no
 * outgoing neighbors and appear in no other cell's neighbor list.
 *
 * PROBE-PD-ADJ-006: A space that is blocking terrain is not adjacent to
 *   any other space. (CRR p.16 ADJACENT)
 *   Structural invariant: for every blocking cell b in every map,
 *   adjacency[b] === [] AND no other cell lists b in its neighbors.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const mapSpacesPath = join(__dirname, '../../../data/map-spaces.json');
const mapSpaces = JSON.parse(readFileSync(mapSpacesPath, 'utf8'));

describe('PROBE-PD-ADJ-006: blocking terrain cells are isolated in the adjacency graph', () => {
  const mapsWithBlocking = Object.entries(mapSpaces.maps)
    .filter(([, spec]) => Array.isArray(spec.blocking) && spec.blocking.length > 0);

  assert.ok(mapsWithBlocking.length > 0,
    'at least one map must have blocking terrain to pin this invariant');

  for (const [mapId, spec] of mapsWithBlocking) {
    it(`006/${mapId}: every blocking cell has empty neighbors AND is not listed as a neighbor by any other cell`, () => {
      const adj = spec.adjacency || {};
      const blockingSet = new Set(spec.blocking.map(c => String(c).toLowerCase()));
      for (const b of spec.blocking) {
        const bLower = String(b).toLowerCase();
        const neighbors = adj[bLower] ?? adj[b] ?? [];
        assert.deepStrictEqual(neighbors, [],
          `blocking cell ${b} on ${mapId} must have empty neighbor list — CRR-ADJ-006 violation: adjacency[${b}] = ${JSON.stringify(neighbors)}`);
      }
      for (const [cell, nbrs] of Object.entries(adj)) {
        if (blockingSet.has(String(cell).toLowerCase())) continue;
        if (!Array.isArray(nbrs)) continue;
        for (const n of nbrs) {
          assert.ok(!blockingSet.has(String(n).toLowerCase()),
            `cell ${cell} on ${mapId} lists blocking cell ${n} as a neighbor — CRR-ADJ-006 violation`);
        }
      }
    });
  }
});
