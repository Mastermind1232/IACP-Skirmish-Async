/**
 * Extracts Deployment Card name -> image path from Vassal buildFile.xml
 * Always prefers IACP variants when duplicates exist (emb2 Alt Art or primary piece).
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

// Build IACP overrides: for each PieceSlot, if it has an IACP image in emb2 or piece, use it
const iacpOverrides = {};
const slotRe = /entryName="([^"]+)"[^>]*>([\s\S]*?)<\/VASSAL\.build\.widget\.PieceSlot>/g;
let slotM;
while ((slotM = slotRe.exec(xml)) !== null) {
  const entryName = slotM[1];
  const content = slotM[2];
  const iacpMatch = content.match(/(IACP\d*_?D card-[^;]+\.(?:jpg|png|gif))/i);
  if (iacpMatch) iacpOverrides[entryName] = iacpMatch[1];
}

// Match piece;;;IMAGEFILE;CARDNAME/ for Deployment Cards
const pieceRe = /piece;;;(D card-[^;]+\.(?:jpg|png|gif)|IACP[^;]*D card-[^;]+\.(?:jpg|png|gif));([^/\\]+)\//g;

const map = {};
let m;
while ((m = pieceRe.exec(xml)) !== null) {
  const [, imageFile, cardName] = m;
  const name = cardName.trim();
  if (!name) continue;
  // Prefer IACP: use override if this card has one, else use IACP piece if present, else use piece
  const iacp = iacpOverrides[name];
  const isIacp = /^IACP/i.test(imageFile);
  if (iacp) {
    map[name] = iacp;
  } else if (!map[name] || isIacp) {
    map[name] = imageFile;
  }
}

// Resolve to paths that actually exist (try imageFile, then non-IACP fallback)
function findImagePath(imageFile) {
  const basePath = join(imagesDir, imageFile);
  if (existsSync(basePath)) return `vassal_extracted/images/${imageFile}`;
  // Try dc-figures/DC Skirmish Upgrades subfolders
  for (const sub of ['dc-figures', 'DC Skirmish Upgrades']) {
    const subPath = join(imagesDir, sub, imageFile.split('/').pop());
    if (existsSync(subPath)) return `vassal_extracted/images/${sub}/${imageFile.split('/').pop()}`;
  }
  // Fallback: try without IACP_ prefix (original)
  const alt = imageFile.replace(/^IACP\d*_?/i, '');
  const altPath = join(imagesDir, alt);
  if (existsSync(altPath)) return `vassal_extracted/images/${alt}`;
  return null;
}

const resolved = {};
for (const [name, imageFile] of Object.entries(map)) {
  const path = findImagePath(imageFile);
  if (path) resolved[name] = path;
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
