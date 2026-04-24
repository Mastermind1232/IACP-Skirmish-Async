#!/usr/bin/env node
/**
 * JS-side ability-apply CLI for Python parity harness.
 *
 * Reads one JSON line from stdin of shape:
 *   { abilityId, game, context }
 *
 * Calls src/game/abilities.js:resolveAbility(abilityId, context) after
 * attaching `game` into context. Prints result as JSON to stdout:
 *   { ok: true, game, result }          — on success
 *   { ok: false, error, stack }         — on thrown exception
 *
 * Designed for per-ability parity testing against the Python engine.
 * Not a performance path — one process per call. Safe to reuse via
 * node --eval wrappers.
 */
import { resolveAbility } from '../../src/game/abilities.js';

function readStdin() {
  return new Promise((resolve, reject) => {
    let buf = '';
    process.stdin.setEncoding('utf8');
    process.stdin.on('data', (chunk) => { buf += chunk; });
    process.stdin.on('end', () => resolve(buf));
    process.stdin.on('error', reject);
  });
}

async function main() {
  const raw = await readStdin();
  if (!raw.trim()) {
    process.stdout.write(JSON.stringify({
      ok: false, error: 'empty stdin',
    }));
    process.exit(2);
  }
  let payload;
  try {
    payload = JSON.parse(raw);
  } catch (e) {
    process.stdout.write(JSON.stringify({
      ok: false, error: `invalid JSON: ${e.message}`,
    }));
    process.exit(2);
  }
  const { abilityId, game = {}, context = {} } = payload;
  if (!abilityId) {
    process.stdout.write(JSON.stringify({
      ok: false, error: 'missing abilityId',
    }));
    process.exit(2);
  }
  // Attach game into context; resolveAbility mutates game in-place.
  const ctx = { ...context, game };
  try {
    const result = resolveAbility(abilityId, ctx);
    process.stdout.write(JSON.stringify({
      ok: true,
      abilityId,
      game,
      result,
    }));
  } catch (e) {
    process.stdout.write(JSON.stringify({
      ok: false,
      abilityId,
      error: `${e.constructor.name}: ${e.message}`,
      stack: e.stack,
    }));
    process.exit(1);
  }
}

main().catch((e) => {
  process.stdout.write(JSON.stringify({
    ok: false,
    error: `top-level: ${e.message}`,
    stack: e.stack,
  }));
  process.exit(3);
});
