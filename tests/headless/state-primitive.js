#!/usr/bin/env node
/**
 * State-primitive parity shim.
 *
 * Reads one line of JSON from stdin: {op, args}.
 * Runs the requested atomic state-mutation primitive and returns
 * {ok: true, result, state} where state is the mutated view of the
 * arguments (only the bits the primitive touches).
 *
 * Supported ops (each mirrors a src/game/*.js export):
 *   reduce_hp(dcHealthState, game, msgId, figIdx, damage, playerNum)
 *   heal_hp(dcHealthState, game, msgId, figIdx, amount, playerNum)
 *   apply_condition(game, figureKey, condition)
 *   filter_condition(game, figureKey, condition)
 *   grant_power_tokens(game, figureKey, tokenType, count)
 *   grant_movement_bank(game, msgId, amount)
 *   calculate_kill_vp(dcEntry)
 */
import { reduceHp, healHp } from '../../src/game/damage-helpers.js';
import { applyCondition, filterCondition } from '../../src/game/conditions.js';

function readStdin() {
  return new Promise((resolve, reject) => {
    let buf = '';
    process.stdin.setEncoding('utf8');
    process.stdin.on('data', (c) => { buf += c; });
    process.stdin.on('end', () => resolve(buf));
    process.stdin.on('error', reject);
  });
}

// JS dcHealthState is a Map but the parity test passes plain dict JSON.
// Convert dict → Map, call primitive, convert back.
function dictToMap(d) {
  const m = new Map();
  for (const [k, v] of Object.entries(d || {})) m.set(k, v);
  return m;
}

function mapToDict(m) {
  const d = {};
  for (const [k, v] of m.entries()) d[k] = v;
  return d;
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
  const {op, args} = payload;
  try {
    let result, state;
    if (op === 'reduce_hp') {
      const [dcHealth, game, msgId, figIdx, damage, playerNum] = args;
      const m = dictToMap(dcHealth);
      result = reduceHp(m, game, msgId, figIdx, damage, playerNum);
      state = {dcHealthState: mapToDict(m), game};
    } else if (op === 'heal_hp') {
      const [dcHealth, game, msgId, figIdx, amount, playerNum] = args;
      const m = dictToMap(dcHealth);
      result = healHp(m, game, msgId, figIdx, amount, playerNum);
      state = {dcHealthState: mapToDict(m), game};
    } else if (op === 'apply_condition') {
      const [game, figKey, cond] = args;
      result = applyCondition(game, figKey, cond);
      state = {game};
    } else if (op === 'filter_condition') {
      const [game, figKey, cond] = args;
      result = filterCondition(game, figKey, cond);
      state = {game};
    } else {
      process.stdout.write(JSON.stringify({ok: false, error: `unknown op: ${op}`}));
      process.exit(2);
    }
    process.stdout.write(JSON.stringify({ok: true, op, result, state}));
  } catch (e) {
    process.stdout.write(JSON.stringify({
      ok: false, op,
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
