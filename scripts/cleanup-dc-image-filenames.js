/**
 * 1) Rename __dc_rename_* temp files to clean names and update dc-images.
 * 2) Rename "D card-X--Name" → "Name.ext", "IACP...--Name" → "Name (IACP).ext", "NNN Name Final" → "Name.ext".
 *    IACP prefix is preserved as " (IACP)" in the filename so duplicate variants are distinguishable.
 * Run from repo root: node scripts/cleanup-dc-image-filenames.js
 */
import { readFileSync, writeFileSync, existsSync, renameSync, readdirSync } from 'fs';
import { join, dirname, extname, basename } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, '..');
const dcImagesPath = join(root, 'data', 'dc-images.json');

const DC_SKIRMISH_UPGRADES = join(root, 'vassal_extracted/images/DC Skirmish Upgrades');
const DC_FIGURES = join(root, 'vassal_extracted/images/dc-figures');

function cleanBasename(name) {
  let s = name;
  const hadIACP = /^(?:__dc_rename_\d+_)?(?:IACP\d*_)/i.test(s);
  if (/^__dc_rename_\d+_/.test(s)) s = s.replace(/^__dc_rename_\d+_/, '');
  if (/^(?:IACP\d*_)?D card-[^\-]+--/i.test(s)) s = s.replace(/^(?:IACP\d*_)?D card-[^\-]+--/i, '');
  if (/^\d{3}\s+(.+?)\s+final\.(png|jpg|gif|jpeg)$/i.test(s)) s = s.replace(/^\d{3}\s+(.+?)\s+final\.(png|jpg|gif|jpeg)$/i, '$1.$2');
  s = s.trim();
  if (hadIACP && s && !/\(IACP\)/i.test(s)) {
    const ext = extname(s);
    const base = s.slice(0, -ext.length);
    s = base + ' (IACP)' + ext;
  }
  return s;
}

function isMessy(name) {
  return /^__dc_rename_\d+_/.test(name) ||
    /^(?:IACP\d*_)?D card-[^\-]+--/i.test(name) ||
    /^\d{3}\s+.+\s+final\.(png|jpg|gif|jpeg)$/i.test(name);
}

const data = JSON.parse(readFileSync(dcImagesPath, 'utf8'));
const dcImages = data.dcImages || {};
const relDir = (dir) => dir === DC_SKIRMISH_UPGRADES ? 'vassal_extracted/images/DC Skirmish Upgrades' : 'vassal_extracted/images/dc-figures';

// Fix existing: any card name containing "(IACP)" should point to a file whose name contains "(IACP)"
const fixIACP = [];
for (const [cardName, relPath] of Object.entries(dcImages)) {
  if (!relPath || !cardName.includes('(IACP)')) continue;
  const fn = basename(relPath);
  if (/\(IACP\)/i.test(fn)) continue;
  const fullPath = join(root, relPath);
  if (!existsSync(fullPath)) continue;
  const dir = dirname(relPath);
  const ext = extname(fn);
  const base = fn.slice(0, -ext.length);
  const newRelPath = join(dir, base + ' (IACP)' + ext).replace(/\\/g, '/');
  if (newRelPath === relPath) continue;
  fixIACP.push({ cardName, relPath, newRelPath, fullPath, fullNew: join(root, newRelPath) });
}
const usedByFix = new Set(fixIACP.map((r) => r.newRelPath));
for (const r of fixIACP) {
  if (existsSync(r.fullNew) && r.fullNew !== r.fullPath) {
    const dir = dirname(r.newRelPath);
    const ext = extname(r.newRelPath);
    const base = basename(r.newRelPath).slice(0, -ext.length);
    let n = 1;
    let candidate = join(dir, base + ' (' + n + ')' + ext).replace(/\\/g, '/');
    while (usedByFix.has(candidate) || existsSync(join(root, candidate))) {
      n++;
      candidate = join(dir, base + ' (' + n + ')' + ext).replace(/\\/g, '/');
    }
    r.newRelPath = candidate;
    r.fullNew = join(root, candidate);
    usedByFix.add(candidate);
  }
}
for (const r of fixIACP) {
  renameSync(r.fullPath, r.fullNew);
  dcImages[r.cardName] = r.newRelPath;
}
if (fixIACP.length) {
  writeFileSync(dcImagesPath, JSON.stringify({ ...data, dcImages, updatedAt: new Date().toISOString() }, null, 2), 'utf8');
  console.log('Fixed', fixIACP.length, 'IACP variant filenames (added " (IACP)" to path).');
}

const renames = [];
const usedNewPaths = new Set();

for (const dir of [DC_SKIRMISH_UPGRADES, DC_FIGURES]) {
  const files = readdirSync(dir);
  for (const name of files) {
    if (!isMessy(name)) continue;
    const fullPath = join(dir, name);
    if (!existsSync(fullPath)) continue;
    const cleanName = cleanBasename(name);
    if (cleanName === name) continue;
    const dirRel = relDir(dir);
    let newRelPath = join(dirRel, cleanName).replace(/\\/g, '/');
    let n = 1;
    const ext = extname(cleanName);
    const base = cleanName.slice(0, -ext.length);
    while (usedNewPaths.has(newRelPath)) {
      newRelPath = join(dirRel, `${base} (${n})${ext}`).replace(/\\/g, '/');
      n++;
    }
    usedNewPaths.add(newRelPath);
    const oldRelPath = join(dirRel, name).replace(/\\/g, '/');
    renames.push({
      fullPath,
      oldRelPath,
      newRelPath,
      fullNew: join(root, newRelPath),
    });
  }
}

// Update dc-images: any key pointing to oldRelPath -> newRelPath
for (const r of renames) {
  for (const key of Object.keys(dcImages)) {
    if (dcImages[key] === r.oldRelPath) dcImages[key] = r.newRelPath;
  }
}

// Two-phase rename
const tempPrefix = '__dc_clean_';
for (let i = 0; i < renames.length; i++) {
  const r = renames[i];
  const tempPath = join(dirname(r.fullPath), tempPrefix + i + '_' + basename(r.fullPath));
  renameSync(r.fullPath, tempPath);
  r.tempPath = tempPath;
}
for (const r of renames) {
  renameSync(r.tempPath, r.fullNew);
}

writeFileSync(dcImagesPath, JSON.stringify({ ...data, dcImages, updatedAt: new Date().toISOString() }, null, 2), 'utf8');
console.log('Cleaned', renames.length, 'DC image filenames and updated dc-images.json');
