/**
 * Generates initial map-spaces.json from deployment zones + map registry.
 * Builds full grid, orthogonal adjacency, default terrain.
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

  for (let row = 0; row < numRows; row++) {
    for (let col = 0; col < numCols; col++) {
      const k = coordKey(col, row);
      spaces.push(k);
      terrain[k] = terrainOverrides[k] || 'normal';

      const neighbors = [];
      const deltas = [[0, -1], [0, 1], [-1, 0], [1, 0]];
      for (const [dc, dr] of deltas) {
        const nc = col + dc, nr = row + dr;
        if (nc >= 0 && nc < numCols && nr >= 0 && nr < numRows) {
          const nk = coordKey(nc, nr);
          const edgeKey = [k, nk].sort().join('|');
          if (!impSet.has(edgeKey)) {
            neighbors.push(nk);
          }
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
