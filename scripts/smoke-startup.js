/**
 * Smoke test: verify the production entrypoint loads without errors.
 *
 * Sets BOT_STARTUP_SMOKE=1 so index.js skips client.login() and exits
 * cleanly after all modules load and startup validation passes.
 *
 * This catches: broken imports, missing exports, invalid paths,
 * top-level exceptions, and context/dependency boot regressions.
 */

import { fork } from 'child_process';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const entrypoint = join(__dirname, '..', 'index.js');

const child = fork(entrypoint, [], {
  env: {
    ...process.env,
    BOT_STARTUP_SMOKE: '1',
    DISCORD_TOKEN: process.env.DISCORD_TOKEN || 'smoke-test',
  },
  stdio: 'inherit',
});

child.on('exit', (code) => {
  process.exit(code || 0);
});

child.on('error', (err) => {
  console.error('[smoke:startup] Failed to fork entrypoint:', err.message);
  process.exit(1);
});
