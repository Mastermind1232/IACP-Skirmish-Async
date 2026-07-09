// ⚠️ BOOTSTRAP-ERA SCRIPT — FROZEN 2026-07-09 (alexanbv directive).
// The map tool's saved data (data/map-spaces.json via the hosted editor) is
// now the ONLY ground truth for spaces/terrain/edges. Do NOT rerun this
// script against tool-authored data — it would overwrite manual corrections.
// Kept for historical reference and for bootstrapping brand-new maps ONLY
// (and then only before any manual tool edits exist for that map).
/**
 * Generates initial map-spaces.json from deployment zones + map registry.
 * Builds full grid with orthogonal AND diagonal adjacency per IA rules:
 *   "A space is adjacent to each other space that shares an edge or corner."
 *   "Spaces on either side of the diagonal intersection of walls, doors,
 *    and/or blocking terrain are not adjacent."
 *   "A space that is blocking terrain is not adjacent to any other space."
 * Run: node scripts/generate-map-spaces.js
 *
 * Use extract-map-spaces.html to refine: mark impassable edges, terrain.
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { loadImage } from 'canvas';

const __dirname = dirname(fileURLToPath(import.meta.url));
const rootDir = join(__dirname, '..');

function colToLetter(col) {
  if (col < 26) return String.fromCharCode(65 + col);
  return colToLetter(Math.floor(col / 26) - 1) + colToLetter(col % 26);
}

function coordKey(col, row) {
  return colToLetter(col).toLowerCase() + (row + 1);
}

async function getGridDimensions(mapDef) {
  const imagePath = join(rootDir, mapDef.imagePath);
  if (!existsSync(imagePath)) return null;
  const img = await loadImage(imagePath);
  const { dx, dy, x0, y0 } = mapDef.grid;
  const numCols = Math.floor((img.width - x0) / dx);
  const numRows = Math.floor((img.height - y0) / dy);
  return { numCols, numRows };
}

function edgeKeyFromArr(e) {
  return Array.isArray(e) ? [String(e[0]).toLowerCase(), String(e[1]).toLowerCase()].sort().join('|') : e;
}

function buildMapSpaces(mapId, numCols, numRows, impassableEdges = [], movementBlockingEdges = [], terrainOverrides = {}, blockingOverrides = []) {
  const spaces = [];
  const adjacency = {};
  const terrain = {};
  const blocking = [...blockingOverrides];
  const impSet = new Set([
    ...(impassableEdges || []).map(edgeKeyFromArr),
    ...(movementBlockingEdges || []).map(edgeKeyFromArr),
  ]);

  // Build blocking terrain set for diagonal adjacency checks
  const blockingSet = new Set(blocking.map(s => String(s).toLowerCase()));

  for (let row = 0; row < numRows; row++) {
    for (let col = 0; col < numCols; col++) {
      const k = coordKey(col, row);
      spaces.push(k);
      terrain[k] = terrainOverrides[k] || 'normal';

      // "A space that is blocking terrain is not adjacent to any other space."
      if (blockingSet.has(k)) {
        adjacency[k] = [];
        continue;
      }

      const neighbors = [];

      // Orthogonal neighbors (share an edge)
      const orthoDeltas = [[0, -1], [0, 1], [-1, 0], [1, 0]];
      for (const [dc, dr] of orthoDeltas) {
        const nc = col + dc, nr = row + dr;
        if (nc >= 0 && nc < numCols && nr >= 0 && nr < numRows) {
          const nk = coordKey(nc, nr);
          if (blockingSet.has(nk)) continue;
          const edgeKey = [k, nk].sort().join('|');
          if (!impSet.has(edgeKey)) {
            neighbors.push(nk);
          }
        }
      }

      // Diagonal neighbors (share a corner)
      // Blocked when walls/doors/blocking terrain at the corner block both
      // orthogonal paths around it. For A↔B diagonal with intermediates C, D:
      //   pathC open = edge A↔C passable AND C not blocking AND edge C↔B passable
      //   pathD open = edge A↔D passable AND D not blocking AND edge D↔B passable
      //   diagonal open = pathC OR pathD
      const diagDeltas = [[-1, -1], [-1, 1], [1, -1], [1, 1]];
      for (const [dc, dr] of diagDeltas) {
        const nc = col + dc, nr = row + dr;
        if (nc < 0 || nc >= numCols || nr < 0 || nr >= numRows) continue;
        const nk = coordKey(nc, nr);        // B (diagonal target)
        if (blockingSet.has(nk)) continue;

        const ck = coordKey(col + dc, row); // C (shares row with A, col with B)
        const dk = coordKey(col, row + dr); // D (shares col with A, row with B)

        const cInBounds = (col + dc) >= 0 && (col + dc) < numCols;
        const dInBounds = (row + dr) >= 0 && (row + dr) < numRows;

        // Path through C: A→C→B
        let pathC = false;
        if (cInBounds) {
          const cBlocking = blockingSet.has(ck);
          const acEdge = [k, ck].sort().join('|');
          const cbEdge = [ck, nk].sort().join('|');
          pathC = !cBlocking && !impSet.has(acEdge) && !impSet.has(cbEdge);
        }

        // Path through D: A→D→B
        let pathD = false;
        if (dInBounds) {
          const dBlocking = blockingSet.has(dk);
          const adEdge = [k, dk].sort().join('|');
          const dbEdge = [dk, nk].sort().join('|');
          pathD = !dBlocking && !impSet.has(adEdge) && !impSet.has(dbEdge);
        }

        if (pathC || pathD) {
          neighbors.push(nk);
        }
      }

      adjacency[k] = neighbors;
    }
  }

  return { spaces, adjacency, terrain, blocking, impassableEdges: impassableEdges || [], movementBlockingEdges: movementBlockingEdges || [] };
}

async function main() {
  const registryPath = join(rootDir, 'data', 'map-registry.json');
  const zonesPath = join(rootDir, 'data', 'deployment-zones.json');
  const existingSpacesPath = join(rootDir, 'data', 'map-spaces.json');

  const registry = JSON.parse(readFileSync(registryPath, 'utf8'));
  const zones = JSON.parse(readFileSync(zonesPath, 'utf8'));
  let existing = { maps: {} };
  if (existsSync(existingSpacesPath)) {
    existing = JSON.parse(readFileSync(existingSpacesPath, 'utf8'));
  }

  const maps = registry.maps || [];
  const output = {
    source: 'generate-map-spaces.js + extract-map-spaces.html',
    maps: { ...existing.maps },
  };

  for (const mapId of Object.keys(zones.maps || {})) {
    const mapDef = maps.find((m) => m.id === mapId);
    if (!mapDef) {
      console.warn(`Map ${mapId} in zones but not in registry`);
      continue;
    }

    const dims = await getGridDimensions(mapDef);
    if (!dims) {
      console.warn(`Could not load image for ${mapId}`);
      continue;
    }

    const prev = existing.maps[mapId] || {};
    const { spaces, adjacency, terrain, blocking, impassableEdges, movementBlockingEdges } = buildMapSpaces(
      mapId,
      dims.numCols,
      dims.numRows,
      prev.impassableEdges || [],
      prev.movementBlockingEdges || [],
      prev.terrain || {},
      prev.blocking || []
    );

    output.maps[mapId] = {
      spaces,
      adjacency,
      terrain,
      blocking,
      impassableEdges: prev.impassableEdges || [],
      movementBlockingEdges: prev.movementBlockingEdges || [],
    };
    console.log(`${mapId}: ${spaces.length} spaces, grid ${dims.numCols}x${dims.numRows}`);
  }

  mkdirSync(join(rootDir, 'data'), { recursive: true });
  writeFileSync(existingSpacesPath, JSON.stringify(output, null, 2), 'utf8');
  console.log(`Wrote ${existingSpacesPath}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
