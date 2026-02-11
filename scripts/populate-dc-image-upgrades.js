/**
 * Populates data/dc-image-upgrades.json with DC figures only (figure deployment cards that have images).
 * Skirmish upgrades [Bracket], Command cards (CC), and companions are not included.
 * Run: node scripts/populate-dc-image-upgrades.js
 */

import { readFileSync, writeFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, '..');

const dcImagesPath = join(root, 'data', 'dc-images.json');
const upgradesPath = join(root, 'data', 'dc-image-upgrades.json');

// Load existing (keep dc_upgrades, cc, companions as-is so editor still works)
let existing = { description: '', dc_figures: [], dc_upgrades: [], cc: [], companions: [] };
try {
  const raw = JSON.parse(readFileSync(upgradesPath, 'utf8'));
  existing = {
    description: raw.description || existing.description,
    dc_figures: Array.isArray(raw.dc_figures) ? raw.dc_figures : [],
    dc_upgrades: Array.isArray(raw.dc_upgrades) ? raw.dc_upgrades : [],
    cc: Array.isArray(raw.cc) ? raw.cc : [],
    companions: Array.isArray(raw.companions) ? raw.companions : [],
  };
} catch (_) {}

// DC figures only from dc-images (exclude [Skirmish Upgrade] names)
const dcData = JSON.parse(readFileSync(dcImagesPath, 'utf8'));
const dcImages = dcData.dcImages || {};
const dcFigures = Object.keys(dcImages).filter(
  (name) => !(name.startsWith('[') && name.endsWith(']'))
);

// Union with existing dc_figures, dedupe, sort
const merged = [...new Set([...existing.dc_figures, ...dcFigures])].sort((a, b) =>
  a.localeCompare(b, 'en', { sensitivity: 'base' })
);

const out = {
  description: existing.description || 'Tracks which DC figures have had their images upgraded with better quality versions',
  dc_figures: merged,
  dc_upgrades: [],  // high-res list is DC figures only
  cc: [],
  companions: [],
};

writeFileSync(upgradesPath, JSON.stringify(out, null, 2), 'utf8');

console.log('dc-image-upgrades.json updated (DC figures only):');
console.log('  dc_figures:', out.dc_figures.length);
