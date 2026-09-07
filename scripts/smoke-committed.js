#!/usr/bin/env node
/**
 * Boot-test the COMMITTED tree, not the working tree.
 *
 * On 2026-09-03 a push broke production: a commit deleted two modules and
 * removed their imports from handlers/combat.js, but only the deletions were
 * staged. main shipped deletions of files that were still imported, and the
 * process could not start.
 *
 * Every other check passed, because every other check runs against the WORKING
 * TREE — which had the fix. smoke:imports and smoke:startup are only as honest
 * as the tree they run in.
 *
 * This checks out HEAD into a throwaway git worktree (so uncommitted edits are
 * excluded by construction), symlinks node_modules, and runs the import and
 * startup smokes there. It is the only check that would have caught it.
 *
 * Usage:  npm run smoke:committed
 *         npm run smoke:committed -- origin/main    (verify what is PUSHED)
 */
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, symlinkSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const ref = process.argv[2] || 'HEAD';
const run = (cmd, args, opts = {}) =>
  execFileSync(cmd, args, { cwd: root, encoding: 'utf8', stdio: 'pipe', ...opts });

let dir = null;
try {
  const sha = run('git', ['rev-parse', '--short', ref]).trim();
  dir = mkdtempSync(join(tmpdir(), 'iacp-committed-'));
  // A detached worktree of the ref: uncommitted changes cannot leak in.
  run('git', ['worktree', 'add', '--detach', '--quiet', dir, ref]);

  const nm = join(root, 'node_modules');
  if (!existsSync(nm)) {
    console.error('[smoke:committed] no node_modules to link — run npm install first');
    process.exit(1);
  }
  symlinkSync(nm, join(dir, 'node_modules'), 'dir');

  console.log(`[smoke:committed] booting ${ref} (${sha}) from a clean checkout…`);
  for (const script of ['smoke-imports.js', 'smoke-startup.js']) {
    try {
      const out = execFileSync(process.execPath, [join('scripts', script)],
        { cwd: dir, encoding: 'utf8', stdio: 'pipe' });
      console.log(out.trim().split('\n').slice(-2).join('\n'));
    } catch (e) {
      console.error(`\n[smoke:committed] FAILED in ${script} against ${ref} (${sha}).`);
      console.error('This is what the working tree cannot tell you — the committed tree is broken.\n');
      console.error((e.stdout || '') + (e.stderr || ''));
      process.exit(1);
    }
  }
  console.log(`[smoke:committed] ${ref} (${sha}) boots clean.`);
} finally {
  if (dir) {
    try { run('git', ['worktree', 'remove', '--force', dir]); } catch { /* best effort */ }
    try { rmSync(dir, { recursive: true, force: true }); } catch { /* best effort */ }
  }
}
