/**
 * Smoke test: verify every source module resolves its imports correctly.
 *
 * This catches broken named imports, missing exports, and invalid paths
 * that `node --check` (syntax-only) does NOT catch.
 *
 * Scans src/ and the root entrypoint for .js files and dynamically imports
 * each one. Any module that fails to load causes a nonzero exit.
 *
 * Safe to run without Discord credentials — no network calls are made.
 */

import { readdir } from 'fs/promises';
import { join, relative } from 'path';
import { fileURLToPath, pathToFileURL } from 'url';

const __dirname = fileURLToPath(new URL('.', import.meta.url));
const ROOT = join(__dirname, '..');

async function collectJsFiles(dir) {
  const files = [];
  const entries = await readdir(dir, { withFileTypes: true });
  for (const entry of entries) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      // Skip node_modules, tests, .git, tmp dirs, scripts (this file lives there)
      if (['node_modules', '.git', 'tests', 'tmp-s12', 'tmp-s12-new', 'scripts', '.cursor'].includes(entry.name)) continue;
      files.push(...await collectJsFiles(full));
    } else if (entry.name.endsWith('.js') && !entry.name.startsWith('.')) {
      files.push(full);
    }
  }
  return files;
}

// Set env so index.js doesn't try to login
process.env.BOT_STARTUP_SMOKE = '1';
process.env.DISCORD_TOKEN = process.env.DISCORD_TOKEN || 'smoke-test';

const files = await collectJsFiles(join(ROOT, 'src'));
// Add root entrypoint
files.push(join(ROOT, 'index.js'));

let passed = 0;
let failed = 0;
const failures = [];

for (const file of files) {
  const rel = relative(ROOT, file);
  try {
    await import(pathToFileURL(file).href);
    passed++;
  } catch (err) {
    failed++;
    failures.push({ file: rel, error: err.message });
    console.error(`FAIL  ${rel}`);
    console.error(`      ${err.message}\n`);
  }
}

console.log(`\n${passed + failed} modules scanned: ${passed} OK, ${failed} FAILED`);
if (failures.length) {
  console.error('\nFailing modules:');
  for (const f of failures) {
    console.error(`  ${f.file}: ${f.error}`);
  }
  process.exit(1);
} else {
  console.log('All imports resolved successfully.');
  process.exit(0);
}
