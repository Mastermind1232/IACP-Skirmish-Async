/**
 * Rename DC images to clean "CardName.ext" (and "CardName (IACP).ext" where needed).
 * Updates data/dc-images.json. Run from repo root: node scripts/rename-dc-images.js
 */
import { readFileSync, writeFileSync, existsSync, renameSync, readdirSync } from 'fs';
import { join, dirname, extname, basename } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, '..');
const dcImagesPath = join(root, 'data', 'dc-images.json');

function safeFilename(cardName) {
  let s = cardName.replace(/^\[|\]$/g, '').trim();
  s = s.replace(/[/\\?*:|"]/g, '_').replace(/\s+/g, ' ').trim();
  return s || 'Unnamed';
}

const data = JSON.parse(readFileSync(dcImagesPath, 'utf8'));
const dcImages = data.dcImages || {};

// Group by oldRelPath (same file can be referenced by multiple card names)
const pathToCards = new Map();
for (const [cardName, oldRelPath] of Object.entries(dcImages)) {
  if (!oldRelPath || typeof oldRelPath !== 'string') continue;
  const norm = oldRelPath.replace(/\\/g, '/');
  if (!pathToCards.has(norm)) pathToCards.set(norm, []);
  pathToCards.get(norm).push(cardName);
}

const renames = [];
const usedNewPaths = new Set();

for (const [oldRelPath, cardNames] of pathToCards) {
  const fullOld = join(root, oldRelPath);
  if (!existsSync(fullOld)) {
    console.warn('Missing:', oldRelPath);
    continue;
  }
  const dir = dirname(oldRelPath);
  const ext = extname(oldRelPath).toLowerCase() || '.png';
  // Prefer a name with (IACP) for the filename so IACP variant is clear when there are duplicates
  const canonical = cardNames.find((n) => n.includes('(IACP)')) || cardNames[0];
  let base = safeFilename(canonical);
  let newRelPath = join(dir, base + ext).replace(/\\/g, '/');
  let n = 1;
  while (usedNewPaths.has(newRelPath)) {
    newRelPath = join(dir, `${base} (${n})${ext}`).replace(/\\/g, '/');
    n++;
  }
  usedNewPaths.add(newRelPath);
  if (newRelPath !== oldRelPath) {
    renames.push({
      oldRelPath,
      cardNames,
      newRelPath,
      fullOld,
      fullNew: join(root, newRelPath),
    });
  }
}

// Two-phase rename to avoid overwriting
const tempPrefix = '__dc_rename_';
for (let i = 0; i < renames.length; i++) {
  const r = renames[i];
  const tempPath = join(dirname(r.fullOld), tempPrefix + i + '_' + basename(r.fullOld));
  renameSync(r.fullOld, tempPath);
  r.tempPath = tempPath;
}
const newRelNorm = (p) => p.replace(/\\/g, '/');
for (const r of renames) {
  renameSync(r.tempPath, r.fullNew);
  for (const cardName of r.cardNames) {
    dcImages[cardName] = newRelNorm(r.newRelPath);
  }
}

writeFileSync(dcImagesPath, JSON.stringify({ ...data, dcImages, updatedAt: new Date().toISOString() }, null, 2), 'utf8');
console.log('Renamed', renames.length, 'DC images to clean names and updated dc-images.json');
