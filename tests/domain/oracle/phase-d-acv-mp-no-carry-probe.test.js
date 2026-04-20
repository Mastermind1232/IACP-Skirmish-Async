/**
 * Phase-D probe: unspent movement points do NOT carry over to the figure's
 * next activation.
 *
 * PROBE-PD-ACV-005: CRR ACTIVATION — "After performing up to two actions and
 *   'during your activation' abilities, a figure declares the end of its
 *   activation; ... remaining actions and unspent movement points do not
 *   carry over to the figure's next activation."
 *
 * Implementation: `cleanupActivation` in src/game/activation-state.js. The
 *   function wipes every per-msgId flag listed in ACTIVATION_MSGID_FLAGS,
 *   which includes `movementBank` (the figure's unspent MP bank). Called
 *   at end-of-activation from activation.js, which guarantees the next
 *   activation starts with a fresh, empty MP bank.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  cleanupActivation,
  ACTIVATION_MSGID_FLAGS,
} from '../../../src/game/activation-state.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '../../..');
const STATE_SRC = readFileSync(resolve(ROOT, 'src/game/activation-state.js'), 'utf8');
const ACT_SRC = readFileSync(resolve(ROOT, 'src/handlers/activation.js'), 'utf8');

describe('PROBE-PD-ACV-005: unspent MP does not carry over to next activation', () => {
  it('005a: source — movementBank is listed as a per-activation per-msgId flag', () => {
    assert.ok(
      ACTIVATION_MSGID_FLAGS.includes('movementBank'),
      'movementBank must be in ACTIVATION_MSGID_FLAGS so cleanupActivation wipes it — CRR-ACV-005');
  });

  it('005b: source — cleanupActivation deletes every per-msgId flag for the ending msgId', () => {
    assert.match(STATE_SRC,
      /for \(const key of ACTIVATION_MSGID_FLAGS\) \{\s*\n\s*if \(game\[key\]\?\.\[msgId\] !== undefined\) delete game\[key\]\[msgId\];\s*\n\s*\}/,
      'cleanupActivation must iterate ACTIVATION_MSGID_FLAGS and delete the per-msgId entry — CRR-ACV-005');
  });

  it('005c: source — activation.js calls cleanupActivation at end-of-activation', () => {
    assert.match(ACT_SRC,
      /cleanupActivation\(game,[^)]*\)/,
      'handlers/activation.js must invoke cleanupActivation when a figure ends its activation — CRR-ACV-005');
  });

  it('005d: behavior — cleanupActivation empties the msgId movementBank entry', () => {
    const msgId = 'dg-42';
    const game = {
      movementBank: { [msgId]: 3, 'other-dg': 2 },
      dcActionsData: { [msgId]: { actions: 1 } },
    };
    cleanupActivation(game, msgId, 1, []);
    assert.equal(game.movementBank[msgId], undefined,
      'unspent MP for this activation\'s msgId is wiped — CRR-ACV-005');
    assert.equal(game.movementBank['other-dg'], 2,
      'other msgIds are untouched (only the ending activation is cleaned)');
    assert.equal(game.dcActionsData[msgId], undefined,
      'remaining actions for this activation\'s msgId are wiped — CRR-ACV-005');
  });

  it('005e: behavior — next activation starts with no inherited MP', () => {
    const msgA = 'dg-A';
    const msgB = 'dg-B';
    const game = { movementBank: { [msgA]: 4 } };
    // End activation A
    cleanupActivation(game, msgA, 1, []);
    // Begin activation B — simulate granting MP
    game.movementBank[msgB] = 2;
    assert.equal(game.movementBank[msgA], undefined,
      'A\'s unspent MP was not inherited by B — CRR-ACV-005');
    assert.equal(game.movementBank[msgB], 2,
      'B starts fresh with only its own granted MP');
  });
});
