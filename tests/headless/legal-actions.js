#!/usr/bin/env node
/**
 * JS-side legal-actions shim for Python parity harness.
 *
 * Reads {game, playerNum} from stdin.
 * Runs getAvailableActions from src/engine/available-actions.js.
 * Prints {ok, actions, game} where actions is a list of
 * {type, customId, opts} so Python can diff against its Action enum.
 *
 * The `deps` object is filled with no-op stubs for everything
 * getAvailableActions needs but doesn't mutate through — map data,
 * range/LOS helpers, dcMessageMeta. These are read-only dependencies
 * that the harness supplies deterministically via the game's
 * embedded fixture fields (dcMessageMeta, selectedMap, etc.).
 */
import { getAvailableActions } from '../../src/engine/available-actions.js';
import { getDcEffects, getFigureSize, getMapData } from '../../src/data-loader.js';
import { getAbility } from '../../src/game/abilities.js';
import { hasLineOfSight, getRange } from '../../src/game/spatial.js';
import { getEffectiveFigureSize } from '../../src/game/board-helpers.js';
import { parseFigureKey, dcNameFromFigureKey, getDcEffect } from '../../src/game/dc-helpers.js';

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
  const {game, playerNum} = payload;
  // Reconstruct dcMessageMeta as a Map (JSON serialized as array of pairs).
  if (Array.isArray(game.dcMessageMeta)) {
    game.dcMessageMeta = new Map(game.dcMessageMeta);
  }

  // Build a minimal deps object. Most functions used by
  // getAvailableActions are pure (no network / no Discord).
  const deps = {
    getDcEffect, getDcEffects,
    getAbility,
    hasLineOfSight, getRange,
    getMapData,
    getFigureSize, getEffectiveFigureSize,
    parseFigureKey, dcNameFromFigureKey,
    dcMessageMeta: game.dcMessageMeta,
  };

  try {
    const actions = getAvailableActions(game, playerNum, deps);
    // Normalize: keep only fields we diff on.
    const normalized = (actions || []).map((a) => ({
      type: a.type || null,
      customId: a.customId || null,
      opts: a.opts || a.options || null,
    }));
    process.stdout.write(JSON.stringify({ok: true, actions: normalized}));
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
