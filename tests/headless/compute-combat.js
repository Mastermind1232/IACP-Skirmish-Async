#!/usr/bin/env node
/**
 * JS-side computeCombatResult shim for Python parity harness.
 *
 * Reads ONE line of JSON from stdin of shape {combat: {...}}.
 * Runs src/game/combat.js:computeCombatResult.
 * Prints the result as JSON to stdout:
 *   {ok: true, result: {hit, damage, effectiveBlock, resultText},
 *    combat: <mutated combat>}
 *
 * The combat argument is printed back because computeCombatResult
 * may mutate it (Set-for-Stun pushes to bonusConditions; Wookiee
 * Avenger converts dodge→evade on defenseRoll).
 */
import { computeCombatResult } from '../../src/game/combat.js';

function readStdin() {
  return new Promise((resolve, reject) => {
    let buf = '';
    process.stdin.setEncoding('utf8');
    process.stdin.on('data', (c) => { buf += c; });
    process.stdin.on('end', () => resolve(buf));
    process.stdin.on('error', reject);
  });
}

async function main() {
  const raw = await readStdin();
  if (!raw.trim()) {
    process.stdout.write(JSON.stringify({ok: false, error: 'empty stdin'}));
    process.exit(2);
  }
  let payload;
  try { payload = JSON.parse(raw); }
  catch (e) {
    process.stdout.write(JSON.stringify({ok: false, error: `bad JSON: ${e.message}`}));
    process.exit(2);
  }
  const combat = payload.combat || {};
  try {
    const result = computeCombatResult(combat);
    process.stdout.write(JSON.stringify({ok: true, result, combat}));
  } catch (e) {
    process.stdout.write(JSON.stringify({
      ok: false,
      error: `${e.constructor.name}: ${e.message}`,
      stack: e.stack,
    }));
    process.exit(1);
  }
}

main().catch((e) => {
  process.stdout.write(JSON.stringify({ok: false, error: `top: ${e.message}`}));
  process.exit(3);
});
