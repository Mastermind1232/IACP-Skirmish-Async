#!/usr/bin/env node
/**
 * Organize images into subfolders:
 *   cc/           - Command Cards
 *   dc-figures/   - Deployment Cards with figures
 *   dc-figureless/- Deployment Cards without figures (upgrades)
 *   figures/      - Circular figure tokens for map (Figure-*)
 *   tokens/       - Counters, mission tokens (Counter--*, Mission Token--*)
 *   maps/         - Map images (Map_*)
 *   mission-cards/- Mission cards (SkMission Card--*)
 * Run: node scripts/organize-images.js
 * Safe to run multiple times (skips already-moved files).
 */
import { readdirSync, renameSync, mkdirSync, existsSync, readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, '..');
const imagesDir = join(root, 'vassal_extracted', 'images');

const SUBFOLDERS = {
  cc: ['C card--', 'IACP_C card--', 'IACP9_C card--', 'IACP11_C card--', 'Command cardback'],
  'dc-figures': [], // populated by dc-images (non-bracket keys)
  'dc-figureless': [], // populated by dc-images (bracket keys)
  figures: ['Figure-'],
  tokens: ['Counter--', 'Mission Token--', 'Door'],
  maps: ['Map_'],
  'mission-cards': ['SkMission Card--', 'SkMission card--'],
};

function loadFigurelessDcFilenames() {
  const set = new Set();
  try {
    const dcData = JSON.parse(readFileSync(join(root, 'data', 'dc-images.json'), 'utf8'));
    const dcImages = dcData.dcImages || {};
    for (const [key, path] of Object.entries(dcImages)) {
      if (/^\[.+\]$/.test(key)) {
        const filename = path.split(/[/\\]/).pop();
        if (filename) set.add(filename);
      }
    }
  } catch (err) {
    console.warn('Could not load dc-images.json for figureless DC detection:', err.message);
  }
  return set;
}

function getDestSubfolder(filename, figurelessFilenames) {
  if (SUBFOLDERS.cc.some((p) => filename.startsWith(p))) return 'cc';
  if (SUBFOLDERS.maps.some((p) => filename.startsWith(p))) return 'maps';
  if (SUBFOLDERS['mission-cards'].some((p) => filename.startsWith(p))) return 'mission-cards';
  if (SUBFOLDERS.figures.some((p) => filename.startsWith(p))) return 'figures';
  if (SUBFOLDERS.tokens.some((p) => filename.startsWith(p))) return 'tokens';

  const dcPrefixes = ['D card-', 'IACP_D card-', 'IACP9_D card-', 'IACP11_D card-'];
  if (dcPrefixes.some((p) => filename.startsWith(p))) {
    return figurelessFilenames.has(filename) ? 'dc-figureless' : 'dc-figures';
  }
  return null;
}

function* collectFiles(dir) {
  if (!existsSync(dir)) return;
  for (const f of readdirSync(dir, { withFileTypes: true })) {
    if (f.isFile()) {
      yield { name: f.name, dir };
    } else if (f.isDirectory() && !SUBFOLDERS[f.name] && !['cc', 'dc'].includes(f.name)) {
      for (const sub of collectFiles(join(dir, f.name))) {
        yield sub;
      }
    }
  }
}

function main() {
  if (!existsSync(imagesDir)) {
    console.error('vassal_extracted/images not found.');
    process.exit(1);
  }

  const figurelessFilenames = loadFigurelessDcFilenames();
  const dirs = ['cc', 'dc-figures', 'dc-figureless', 'figures', 'tokens', 'maps', 'mission-cards'];
  for (const d of dirs) {
    const p = join(imagesDir, d);
    if (!existsSync(p)) mkdirSync(p, { recursive: true });
  }

  const counts = {};
  for (const d of dirs) counts[d] = 0;

  const seen = new Set();

  for (const subdir of ['', 'cc', 'dc']) {
    const scanDir = subdir ? join(imagesDir, subdir) : imagesDir;
    if (!existsSync(scanDir)) continue;

    for (const f of readdirSync(scanDir, { withFileTypes: true })) {
      if (!f.isFile()) continue;
      const name = f.name;
      const src = join(scanDir, name);
      const key = scanDir + '/' + name;
      if (seen.has(key)) continue;
      seen.add(key);

      const dest = getDestSubfolder(name, figurelessFilenames);
      if (!dest) continue;

      const destDir = join(imagesDir, dest);
      const dst = join(destDir, name);
      if (src === dst) continue;

      if (existsSync(src) && !existsSync(dst)) {
        try {
          renameSync(src, dst);
          counts[dest]++;
          console.log(`${dest}: ${name}`);
        } catch (err) {
          console.error(`Failed to move ${name}:`, err.message);
        }
      }
    }
  }

  console.log('\nDone.');
  for (const d of dirs) {
    if (counts[d] > 0) console.log(`  ${d}: ${counts[d]} files`);
  }
}

main();
