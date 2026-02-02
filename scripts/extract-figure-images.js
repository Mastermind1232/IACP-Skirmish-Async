/**
 * Extracts Figure image paths and sizes from Vassal buildFile.xml
 * Run: node scripts/extract-figure-images.js
 */

import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const rootDir = join(__dirname, '..');
const buildFile = join(rootDir, 'vassal_extracted', 'buildFile.xml');
const imagesDir = join(rootDir, 'vassal_extracted', 'images');
const outputFile = join(rootDir, 'data', 'figure-images.json');
const sizesFile = join(rootDir, 'data', 'figure-sizes.json');

const xml = readFileSync(buildFile, 'utf8');

// Match piece;;;IMAGEFILE;CARDNAME/ and look back for Figure - (1x1|1x2|2x2|2x3)
const figureRe = /piece;;;(Figure-[^;]+\.(?:jpg|png|gif));([^/\\]+)\//g;
const sizeRe = /Figure - (1x1|1x2|2x2|2x3)/g;

const imageMap = {};
const sizeMap = {};
let m;
while ((m = figureRe.exec(xml)) !== null) {
  const [, imageFile, cardName] = m;
  const name = cardName.trim();
  if (!name) continue;
  const pre = xml.slice(Math.max(0, m.index - 800), m.index);
  const sizeMatches = [...pre.matchAll(sizeRe)];
  const size = sizeMatches.length > 0 ? sizeMatches[sizeMatches.length - 1][1] : '1x1';
  if (!imageMap[name]) {
    imageMap[name] = imageFile;
    sizeMap[name] = size;
  }
}

// Resolve images to paths that actually exist
const resolved = {};
const resolvedSizes = {};
for (const [name, imageFile] of Object.entries(imageMap)) {
  const basePath = join(imagesDir, imageFile);
  if (existsSync(basePath)) {
    resolved[name] = `vassal_extracted/images/${imageFile}`;
    resolvedSizes[name] = sizeMap[name];
  }
}

const output = {
  source: 'Vassal buildFile.xml - circular figure tokens',
  extractedAt: new Date().toISOString(),
  count: Object.keys(resolved).length,
  figureImages: resolved,
};

const sizesOutput = {
  source: 'Vassal buildFile.xml - figure base sizes for map rendering',
  extractedAt: new Date().toISOString(),
  figureSizes: resolvedSizes,
};

mkdirSync(join(rootDir, 'data'), { recursive: true });
writeFileSync(outputFile, JSON.stringify(output, null, 2), 'utf8');
writeFileSync(sizesFile, JSON.stringify(sizesOutput, null, 2), 'utf8');
console.log(`Extracted ${output.count} figure images to ${outputFile}`);
console.log(`Extracted figure sizes to ${sizesFile}`);
