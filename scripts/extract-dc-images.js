/**
 * Extracts Deployment Card name -> image path from Vassal buildFile.xml
 * Run: node scripts/extract-dc-images.js
 */

import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const rootDir = join(__dirname, '..');
const buildFile = join(rootDir, 'vassal_extracted', 'buildFile.xml');
const imagesDir = join(rootDir, 'vassal_extracted', 'images');
const outputFile = join(rootDir, 'data', 'dc-images.json');

const xml = readFileSync(buildFile, 'utf8');

// Match piece;;;IMAGEFILE;CARDNAME/ for Deployment Cards (D card-Imp--, D card-Reb--, IACP_D card-, etc.)
const pieceRe = /piece;;;(D card-[^;]+\.(?:jpg|png|gif)|IACP[^;]*D card-[^;]+\.(?:jpg|png|gif));([^/\\]+)\//g;

const map = {};
let m;
while ((m = pieceRe.exec(xml)) !== null) {
  const [, imageFile, cardName] = m;
  const name = cardName.trim();
  if (!name) continue;
  // Prefer first seen; later try alternate filenames (IACP_ vs non-IACP) if file doesn't exist
  if (!map[name]) {
    map[name] = imageFile;
  }
}

// Resolve to paths that actually exist (try imageFile, then fallbacks)
const resolved = {};
for (const [name, imageFile] of Object.entries(map)) {
  const basePath = join(imagesDir, imageFile);
  if (existsSync(basePath)) {
    resolved[name] = `vassal_extracted/images/${imageFile}`;
    continue;
  }
  // Try without IACP_ prefix
  const alt = imageFile.replace(/^IACP\d*_/, '');
  const altPath = join(imagesDir, alt);
  if (existsSync(altPath)) {
    resolved[name] = `vassal_extracted/images/${alt}`;
  }
}

const output = {
  source: 'Vassal buildFile.xml',
  extractedAt: new Date().toISOString(),
  count: Object.keys(resolved).length,
  dcImages: resolved,
};

mkdirSync(join(rootDir, 'data'), { recursive: true });
writeFileSync(outputFile, JSON.stringify(output, null, 2), 'utf8');
console.log(`Extracted ${output.count} DC images to ${outputFile}`);
