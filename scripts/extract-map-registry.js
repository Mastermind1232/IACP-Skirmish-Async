/**
 * Extracts map definitions from Vassal buildFile.xml into map-registry.json
 * Run: node scripts/extract-map-registry.js
 */

import { readFileSync, writeFileSync, mkdirSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const rootDir = join(__dirname, '..');
const buildFile = join(rootDir, 'vassal_extracted', 'buildFile.xml');
const outputFile = join(rootDir, 'data', 'map-registry.json');

const xml = readFileSync(buildFile, 'utf8');

// Extract only the Main Map BoardPicker (title="Choose Map") - skip Player Hands, Search, etc.
const chooseMapStart = xml.indexOf('title="Choose Map"');
if (chooseMapStart === -1) throw new Error('Could not find Choose Map BoardPicker');
const sectionStart = xml.lastIndexOf('<VASSAL.build.module.map.BoardPicker', chooseMapStart);
const sectionEnd = xml.indexOf('</VASSAL.build.module.map.BoardPicker>', sectionStart) + '</VASSAL.build.module.map.BoardPicker>'.length;
const mapSection = xml.slice(sectionStart, sectionEnd);

// Match Board elements with nested SquareGrid
const boardRe = /<VASSAL\.build\.module\.map\.boardPicker\.Board\s+image="([^"]+)"\s+name="([^"]+)"[^>]*>[\s\S]*?<VASSAL\.build\.module\.map\.boardPicker\.board\.SquareGrid[^>]*\s+dx="([^"]+)"\s+dy="([^"]+)"[^>]*\s+x0="([^"]+)"\s+y0="([^"]+)"[^>]*>/g;

const maps = [];
let m;
while ((m = boardRe.exec(mapSection)) !== null) {
  const [, image, name, dx, dy, x0, y0] = m;
  maps.push({
    id: name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, ''),
    name,
    vassalImage: image,
    grid: {
      dx: parseFloat(dx),
      dy: parseFloat(dy),
      x0: parseFloat(x0),
      y0: parseFloat(y0),
    },
    // Image path: maps live in vassal_extracted/images/maps/
    imagePath: `vassal_extracted/images/maps/${image}`,
  });
}

const registry = {
  source: 'Vassal buildFile.xml',
  extractedAt: new Date().toISOString(),
  maps,
};

mkdirSync(join(rootDir, 'data'), { recursive: true });

writeFileSync(outputFile, JSON.stringify(registry, null, 2), 'utf8');
console.log(`Extracted ${maps.length} maps to ${outputFile}`);
