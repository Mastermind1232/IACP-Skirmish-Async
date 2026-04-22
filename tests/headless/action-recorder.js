/**
 * action-recorder.js — wraps createHarness.submitAction to emit JSONL suitable
 * for the Python replay harness (`python.parity.replay_harness`).
 *
 * Output JSONL format (1 header line + N step lines):
 *
 *   Header (line 1):
 *     {
 *       schemaVersion: 1,
 *       gameId: string,
 *       recordedAt: ISO timestamp,
 *       initialState: <full game snapshot>
 *     }
 *
 *   Step (lines 2..N+1):
 *     {
 *       seq: 0-based integer,
 *       customId: string,
 *       userId: string,
 *       actionOpts: object | null,
 *       diceRolled: Array<{seq, role, color, faceIdx, face}>,
 *       dicePools: { attack: {<color>: [idx...]}, defense: {<color>: [idx...]} },
 *       stateSnapshot: <full game snapshot after action>,
 *       ok: boolean,
 *       error?: string
 *     }
 *
 *   `dicePools` matches the schema in python/parity/dice_stream_schema.md
 *   and can be fed directly into Python's DiceStream.from_dict() so replay
 *   consumes identical face indices in identical call order.
 *
 * Dice capture is transparent to callers: the recorder installs a dice hook
 * in `src/game/combat.js` that fires only while an action is in flight.
 *
 * Usage:
 *   const harness = createRecordingHarness(initialGame, { outStream });
 *   await harness.submitAction(customId, userId, opts);
 *   // outStream receives one JSONL line per action.
 */

import fs from 'node:fs';
import { createHarness } from '../../src/headless/game-harness.js';
import {
  setDiceRecorder,
  clearDiceHooks,
  getDiceHooks,
} from '../../src/game/combat.js';

const SCHEMA_VERSION = 1;

function snapshot(game) {
  if (!game) return null;
  return JSON.parse(JSON.stringify(game));
}

/**
 * Wrap a harness so every submitAction is appended to `outStream` as JSONL.
 *
 * @param {object} initialGame - starting game object
 * @param {object} options
 * @param {NodeJS.WritableStream} options.outStream - writable JSONL sink
 * @param {...} options - all other options passed through to createHarness
 * @returns {object} harness with patched submitAction
 */
export function createRecordingHarness(initialGame, options = {}) {
  const { outStream, ...harnessOptions } = options;
  if (!outStream || typeof outStream.write !== 'function') {
    throw new Error('createRecordingHarness: options.outStream must be a writable stream');
  }

  const harness = createHarness(initialGame, harnessOptions);
  const origSubmit = harness.submitAction.bind(harness);

  // Emit header line with initial state.
  outStream.write(JSON.stringify({
    schemaVersion: SCHEMA_VERSION,
    gameId: initialGame?.gameId ?? null,
    recordedAt: new Date().toISOString(),
    initialState: snapshot(initialGame),
  }) + '\n');

  let seq = 0;

  harness.submitAction = async function recordingSubmit(customId, userId, actionOpts = {}) {
    // Guard: refuse to nest recorders (caller bug — the combat.js hook is
    // module-level, so nesting would stomp the outer recorder's log).
    const priorHooks = getDiceHooks();
    if (priorHooks.recorder) {
      throw new Error('action-recorder: a dice recorder is already installed');
    }

    const recorder = { pools: { attack: {}, defense: {} }, log: [] };
    setDiceRecorder(recorder);

    let result, err;
    try {
      result = await origSubmit(customId, userId, actionOpts);
    } catch (e) {
      err = e;
    } finally {
      setDiceRecorder(null);
    }

    // Emit both the audit log (call-order with face materializations) and
    // the pools (grouped-by-color FIFO queues) so Python DiceStream can
    // consume either. Pools match python/parity/dice_stream_schema.md
    // and feed DiceStream.from_dict() directly.
    const record = {
      seq: seq++,
      customId,
      userId,
      actionOpts: actionOpts || null,
      diceRolled: recorder.log,
      dicePools: {
        attack: Object.fromEntries(
          Object.entries(recorder.pools.attack || {}).map(([c, q]) => [c, [...q]])
        ),
        defense: Object.fromEntries(
          Object.entries(recorder.pools.defense || {}).map(([c, q]) => [c, [...q]])
        ),
      },
      stateSnapshot: snapshot(harness.getGame()),
      ok: !err,
    };
    if (err) record.error = err.message || String(err);
    outStream.write(JSON.stringify(record) + '\n');

    if (err) throw err;
    return result;
  };

  return harness;
}

/**
 * High-level convenience: record a scripted sequence of actions to a file.
 *
 * @param {object} initialGame
 * @param {Array<{customId, userId, opts?}>} actions
 * @param {string} outPath
 * @param {object} [harnessOptions]
 */
export async function recordGameToFile(initialGame, actions, outPath, harnessOptions = {}) {
  const stream = fs.createWriteStream(outPath);
  try {
    const harness = createRecordingHarness(initialGame, { ...harnessOptions, outStream: stream });
    for (const { customId, userId, opts } of actions) {
      await harness.submitAction(customId, userId, opts);
    }
    return harness.getGame();
  } finally {
    await new Promise((resolve) => stream.end(resolve));
    clearDiceHooks();
  }
}
