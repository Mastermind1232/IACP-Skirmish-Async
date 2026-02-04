/**
 * Test the map renderer - outputs a sample PNG
 * Run: node scripts/test-map-render.js
 */

import { writeFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { renderMap } from '../src/map-renderer.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

async function main() {
  const mapId = process.argv[2] || 'training-ground';
  const buffer = await renderMap(mapId, {
    showGrid: true,
    figures: [
      { id: 's1', coord: 'B3', label: '1a', color: '#888' },
      { id: 'v1', coord: 'D5', label: '1b', color: '#333' },
    ],
  });
  const out = join(__dirname, '..', 'test-map-output.png');
  writeFileSync(out, buffer);
  console.log(`Wrote ${out}`);
}

main().catch(console.error);
