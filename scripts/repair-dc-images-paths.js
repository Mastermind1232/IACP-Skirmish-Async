/**
 * Repair dc-images.json: for every entry whose file is missing (old path after renames),
 * find the actual file on disk by matching clean name and update the path.
 * Run from repo root: node scripts/repair-dc-images-paths.js
 */
import { readFileSync, writeFileSync, existsSync, readdirSync } from 'fs';
import { join, dirname, extname, basename } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, '..');
const dcImagesPath = join(root, 'data', 'dc-images.json');

const DC_SKIRMISH_UPGRADES = join(root, 'vassal_extracted/images/DC Skirmish Upgrades');
const DC_FIGURES = join(root, 'vassal_extracted/images/dc-figures');

function extractCleanBase(oldBasename) {
  let s = oldBasename;
  if (/^(?:IACP\d*_)?D card-[^\-]+--/i.test(s)) s = s.replace(/^(?:IACP\d*_)?D card-[^\-]+--/i, '');
  s = s.trim();
  const ext = extname(s);
  const base = s.slice(0, -ext.length).trim();
  return { base, ext: ext.toLowerCase() };
}

function allFilesInDir(dirAbs, relDir) {
  const files = readdirSync(dirAbs);
  return files.map((f) => ({ name: f, rel: relDir + '/' + f }));
}

const data = JSON.parse(readFileSync(dcImagesPath, 'utf8'));
const dcImages = data.dcImages || {};

const figureFiles = allFilesInDir(DC_FIGURES, 'vassal_extracted/images/dc-figures');
const upgradeFiles = allFilesInDir(DC_SKIRMISH_UPGRADES, 'vassal_extracted/images/DC Skirmish Upgrades');
const byDir = {
  'vassal_extracted/images/dc-figures': figureFiles,
  'vassal_extracted/images/DC Skirmish Upgrades': upgradeFiles,
};

function findMatch(dirRel, oldBasename) {
  const list = byDir[dirRel];
  if (!list) return null;
  const { base: wantBase, ext: wantExt } = extractCleanBase(oldBasename);
  const wantBaseNorm = wantBase.toLowerCase();
  const candidates = list.filter((f) => {
    const e = extname(f.name).toLowerCase();
    const b = f.name.slice(0, -e.length).trim();
    const bNorm = b.toLowerCase();
    if (e !== wantExt) return false;
    if (bNorm === wantBaseNorm) return true;
    if (bNorm.startsWith(wantBaseNorm + ' (')) return true;
    return false;
  });
  if (candidates.length === 0) return null;
  if (candidates.length === 1) return candidates[0].rel;
  const exact = candidates.find((c) => c.name.slice(0, -extname(c.name).length).trim().toLowerCase() === wantBaseNorm);
  return (exact || candidates[0]).rel;
}

let repaired = 0;
const stillMissing = [];

for (const [card, relPath] of Object.entries(dcImages)) {
  if (!relPath) continue;
  const full = join(root, relPath);
  if (existsSync(full)) continue;
  const dirRel = dirname(relPath).replace(/\\/g, '/');
  const oldBasename = basename(relPath);
  const newRel = findMatch(dirRel, oldBasename);
  if (newRel) {
    dcImages[card] = newRel;
    repaired++;
  } else {
    stillMissing.push({ card, relPath });
  }
}

writeFileSync(dcImagesPath, JSON.stringify({ ...data, dcImages, updatedAt: new Date().toISOString() }, null, 2), 'utf8');
console.log('Repaired', repaired, 'dc-images paths to existing files.');
if (stillMissing.length) {
  console.log('Still missing', stillMissing.length, ':', stillMissing.map((m) => m.card).join(', '));
}
