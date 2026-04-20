/**
 * Phase-D probe: unused "Move up to X spaces" movement cannot be saved
 * for later — MP in the activation's movement bank is discarded at
 * activation end.
 *
 * PROBE-PD-MOVE-019: CRR MOVEMENT — "Unused 'move up to X spaces'
 *   movement cannot be saved for later."
 *
 * Implementation: the engine has a single MP container,
 *   `game.movementBank[msgId]`, keyed by the activating DC message id.
 *   `movementBank` is listed on `ACTIVATION_MSGID_FLAGS` in
 *   `src/game/activation-state.js`, and `cleanupActivation` deletes
 *   every entry keyed under the finishing msgId at end of activation.
 *   End-Turn (`handleDcEndTurn` in `src/handlers/activation.js`) and
 *   round rollover (`src/handlers/round.js`) both also delete the
 *   per-msgId bank directly for defense-in-depth. There is no MP
 *   storage keyed by figure, player, or game — i.e. there is nowhere
 *   for leftover MP to persist past the activation boundary.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '../../..');
const AS_SRC = readFileSync(resolve(ROOT, 'src/game/activation-state.js'), 'utf8');
const AC_SRC = readFileSync(resolve(ROOT, 'src/handlers/activation.js'), 'utf8');
const RD_SRC = readFileSync(resolve(ROOT, 'src/handlers/round.js'), 'utf8');

function* walkFiles(dir) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) yield* walkFiles(p);
    else if (p.endsWith('.js')) yield p;
  }
}

describe('PROBE-PD-MOVE-019: unused movement-bank MP is discarded at activation end (cannot be saved)', () => {
  it('019a: source — movementBank is listed on ACTIVATION_MSGID_FLAGS (the canonical per-activation cleanup list)', () => {
    assert.match(AS_SRC,
      /const ACTIVATION_MSGID_FLAGS = \[[\s\S]*?'movementBank',/,
      'movementBank must be on ACTIVATION_MSGID_FLAGS — CRR-MOVE-019');
  });

  it('019b: source — cleanupActivation deletes every ACTIVATION_MSGID_FLAGS entry for the finishing msgId', () => {
    assert.match(AS_SRC,
      /export function cleanupActivation\(game, msgId, playerNum, figureKeys\) \{\s*\n\s*for \(const key of ACTIVATION_MSGID_FLAGS\) \{\s*\n\s*if \(game\[key\]\?\.\[msgId\] !== undefined\) delete game\[key\]\[msgId\];/,
      'cleanupActivation must delete per-msgId flags (including movementBank) — CRR-MOVE-019');
  });

  it('019c: source — handleDcEndTurn also directly deletes game.movementBank[dcMsgId] at End Turn', () => {
    assert.match(AC_SRC,
      /if \(game\.movementBank\?\.\[dcMsgId\]\) delete game\.movementBank\[dcMsgId\];/,
      'End Turn path must delete the movement bank — CRR-MOVE-019');
  });

  it('019d: source — round rollover deletes movementBank per msgId (defense-in-depth across activation boundary)', () => {
    assert.match(RD_SRC,
      /if \(game\.movementBank\?\.\[msgId\]\) delete game\.movementBank\[msgId\];/,
      'Round rollover must delete the movement bank — CRR-MOVE-019');
  });

  it('019e: source — no MP storage container keyed by figure / player / game exists (no cross-activation MP carry-over site)', () => {
    const hits = [];
    for (const p of walkFiles(resolve(ROOT, 'src'))) {
      const src = readFileSync(p, 'utf8');
      // Any persistent MP storage keyed by figure or player would match these shapes.
      if (/figureMovementBank\b|playerMovementBank\b|savedMovementPoints\b|persistedMp\b/.test(src)) {
        hits.push(p.replace(ROOT + '/', ''));
      }
    }
    assert.deepEqual(hits, [],
      'no src file may declare a cross-activation MP carry-over container — CRR-MOVE-019');
  });
});
