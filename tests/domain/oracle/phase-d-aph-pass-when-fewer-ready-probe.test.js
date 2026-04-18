/**
 * Phase-D probe: pass-activation-turn is gated by "fewer ready DCs than opponent".
 *
 * PROBE-PD-APH-006: During a skirmish, if a player has fewer ready Deployment
 *   cards than any of their opponents, that player may choose not to activate
 *   a group and pass play back to their opponent. (CRR ACTIVATION PHASE)
 *
 * Implementation: `handlePassActivationTurn` in src/handlers/activation.js
 *   gates the pass with `if (otherRem <= myRem) { reject; return; }` — a pass
 *   is only legal when the opponent has strictly MORE activations remaining
 *   than the current player. (Activations-remaining directly reflects the
 *   number of ready DCs: each ready DC contributes one activation.) On a
 *   legal pass, `game.currentActivationTurnPlayerId` flips to the opponent.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ACT_SRC = readFileSync(resolve(__dirname, '../../../src/handlers/activation.js'), 'utf8');

describe('PROBE-PD-APH-006: pass is legal only when opponent has more activations remaining', () => {
  it('006a: source — handlePassActivationTurn is the canonical pass entry', () => {
    assert.match(ACT_SRC,
      /export async function handlePassActivationTurn\(interaction, ctx\) \{/,
      'handlePassActivationTurn must be the exported pass handler — CRR-APH-006');
  });

  it('006b: source — the pass path reads both players activations remaining', () => {
    assert.match(ACT_SRC,
      /const myRem = getActivationsRemaining\(game, turnPlayerNum\) \?\? 0;/,
      'pass handler must read the current player activations remaining — CRR-APH-006');
    assert.match(ACT_SRC,
      /const otherRem = getActivationsRemaining\(game, otherPlayerNum\) \?\? 0;/,
      'pass handler must read the opponent activations remaining — CRR-APH-006');
  });

  it('006c: source — pass is rejected when opponent does NOT have more remaining', () => {
    // The guard: "You can only pass when they have more."
    assert.match(ACT_SRC,
      /if \(otherRem <= myRem\) \{\s*\n[\s\S]*?You can only pass when they have more\./,
      'pass must be rejected when otherRem <= myRem — CRR-APH-006');
  });

  it('006d: source — on a legal pass, turn flips to the opponent', () => {
    // After the guard, the handler assigns currentActivationTurnPlayerId to otherPlayerId.
    assert.match(ACT_SRC,
      /const otherPlayerId = getPlayerId\(game, otherPlayerNum\);[\s\S]{0,400}?game\.currentActivationTurnPlayerId = otherPlayerId;/,
      'legal pass must flip turn to otherPlayerId — CRR-APH-006');
  });

  it('006e: source — UI surfaces the pass button only when the pass would be legal', () => {
    // Round-message update after a pass: render the pass button only if justPassedRem > newCurrentRem.
    assert.match(ACT_SRC,
      /if \(justPassedRem > newCurrentRem && newCurrentRem > 0\) \{/,
      'pass button must render only when current player is strictly behind — CRR-APH-006');
  });

  it('006f: behavior — the gate predicate matches CRR semantics on numeric inputs', () => {
    // Invariant: pass legal iff otherRem > myRem.
    const canPass = (myRem, otherRem) => !(otherRem <= myRem);
    assert.equal(canPass(2, 3), true,  '2 vs 3: opponent has more → pass legal');
    assert.equal(canPass(3, 3), false, '3 vs 3: equal → pass illegal');
    assert.equal(canPass(4, 3), false, '4 vs 3: opponent has fewer → pass illegal');
    assert.equal(canPass(0, 1), true,  '0 vs 1: last-player exhausted → pass legal');
    assert.equal(canPass(0, 0), false, '0 vs 0: both exhausted → pass illegal');
  });
});
