#!/usr/bin/env node
/**
 * Copy token images from an extracted Vassal .vmod folder into vassal_extracted/images/tokens/.
 * Use after extracting the .vmod (e.g. rename to .zip and unzip).
 * Run: node scripts/copy-token-images.js <path-to-extracted-folder>
 * Example: node scripts/copy-token-images.js ./extracted/ImperialAssault
 * The script looks for filenames from data/token-images.json (terminals, missionA, missionB, doors) recursively under the given path.
 */
import { readdirSync, copyFileSync, mkdirSync, existsSync, readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, '..');
const tokensDir = join(root, 'vassal_extracted', 'images', 'tokens');

function findFile(dir, filename) {
  if (!existsSync(dir)) return null;
  for (const f of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, f.name);
    if (f.isFile() && f.name === filename) return full;
    if (f.isDirectory()) {
      const found = findFile(full, filename);
      if (found) return found;
    }
  }
  return null;
}

function main() {
  const srcDir = process.argv[2];
  if (!srcDir) {
    console.error('Usage: node scripts/copy-token-images.js <path-to-extracted-vmod-folder>');
    console.error('Example: node scripts/copy-token-images.js ./extracted/ImperialAssault');
    process.exit(1);
  }
  const absSrc = join(process.cwd(), srcDir);
  if (!existsSync(absSrc)) {
    console.error('Source folder not found:', absSrc);
    process.exit(1);
  }

  let config;
  try {
    config = JSON.parse(readFileSync(join(root, 'data', 'token-images.json'), 'utf8'));
  } catch (err) {
    console.error('Could not read data/token-images.json:', err.message);
    process.exit(1);
  }

  const filenames = [config.terminals, config.missionA, config.missionB, config.doors].filter(Boolean);
  if (!existsSync(tokensDir)) mkdirSync(tokensDir, { recursive: true });

  let copied = 0;
  for (const name of filenames) {
    const srcPath = findFile(absSrc, name);
    if (srcPath) {
      const dst = join(tokensDir, name);
      try {
        copyFileSync(srcPath, dst);
        console.log('Copied:', name);
        copied++;
      } catch (err) {
        console.error('Failed to copy', name, err.message);
      }
    } else {
      console.warn('Not found in source:', name);
    }
  }
  console.log('\nDone. Copied', copied, 'files to', tokensDir);
}

main();
