/**
 * CRR-COMBAT-ZILLO-PIERCE: Zillo Technique exhaust window fires AFTER surge
 * spending, not at attack-declare.
 *
 * Card text (Zillo Technique, dc-effects.json):
 *   "Exhaust this card while a friendly figure is defending to reduce the
 *    Pierce value of the attack results by 2, to a minimum of 0."
 *
 * Per Destruct's CRR ordering:
 *   "Then attacker chooses how to spend surges. From DC abilities... The
 *    exhaust for Zillo has a special timing window here, to cancel 2 pierce,
 *    after attacker decides whether or not to surge for pierce."
 *
 * Old code auto-exhausted Zillo Technique at attack-declare time, regardless
 * of whether the attack ended up having any Pierce. That removed the
 * defender's choice and burned the card on no-pierce attacks. New flow
 * prompts the defender after surge resolution, so they can react to actual
 * final Pierce value.
 *
 * This test pins the source-level timing so future refactors can't silently
 * move Zillo back to declare-time auto-exhaust.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '../../..');
const H_CB_SRC = readFileSync(resolve(ROOT, 'src/handlers/combat.js'), 'utf8');
const H_IDX_SRC = readFileSync(resolve(ROOT, 'src/handlers/index.js'), 'utf8');

describe('CRR-COMBAT-ZILLO-PIERCE: exhaust window fires post-surge, not at declare', () => {
  it('attack-declare path no longer auto-exhausts Zillo Technique', () => {
    // The auto-exhaust block used to live near "// --- Zillo Technique" at the
    // attack-declare site and would set defenderReducePierce += 2 unconditionally.
    // It must be gone — defender choice is now offered after surge spending.
    const declareBlock = H_CB_SRC.match(/--- Zillo Technique[\s\S]*?Discard 1 Command card/);
    assert.ok(declareBlock, 'declare-site Zillo block must still exist (for the discard-CC prompt)');
    assert.doesNotMatch(declareBlock[0], /defenderReducePierce\s*=\s*\(.*\|\| 0\)\s*\+\s*2/,
      'declare-time auto-exhaust must be removed — Zillo exhaust is now post-surge per CRR step-4 timing');
    assert.doesNotMatch(declareBlock[0], /Exhausted: Pierce reduced by 2 for this attack/,
      'auto-exhaust message must not fire at declare time');
  });

  it('maybePromptZilloPierceCancel exists and gates on real Pierce > 0', () => {
    const fn = H_CB_SRC.match(/async function maybePromptZilloPierceCancel\(thread, game, ctx\) \{[\s\S]*?^}/m);
    assert.ok(fn, 'maybePromptZilloPierceCancel must exist');
    const body = fn[0];
    // Must compute total pierce from all sources before prompting
    assert.match(body, /combat\.bonusPierce/,    'must include bonusPierce');
    assert.match(body, /combat\.surgePierce/,    'must include surgePierce (post step-5 contribution)');
    assert.match(body, /combat\.attackInfo\?\.pierce/, 'must include attackInfo.pierce (override-dice contribution)');
    assert.match(body, /combat\.defenderReducePierce/, 'must subtract any prior reductions');
    assert.match(body, /if \(totalPierce <= 0\) return false;/,
      'no Zillo prompt when Pierce is 0 — defender should not waste exhaust');
    assert.match(body, /zillo_pierce_use_/,  'must offer "use" button');
    assert.match(body, /zillo_pierce_skip_/, 'must offer "skip" button');
  });

  it('sendReadyToResolveRolls calls the Zillo prompt before posting the pre_resolve gate', () => {
    const fn = H_CB_SRC.match(/export async function sendReadyToResolveRolls\(thread, gameId, game, ctx\) \{[\s\S]*?^}/m);
    assert.ok(fn, 'sendReadyToResolveRolls body must be locatable');
    const body = fn[0];
    const promptIdx = body.indexOf('maybePromptZilloPierceCancel');
    const gateIdx = body.indexOf("sendCombatGate(thread, game, game.pendingCombat, 'pre_resolve'");
    assert.notStrictEqual(promptIdx, -1, 'must call maybePromptZilloPierceCancel');
    assert.notStrictEqual(gateIdx, -1, 'must post the pre_resolve gate');
    assert.ok(promptIdx < gateIdx, 'Zillo prompt must run before the pre_resolve gate');
  });

  it('handleZilloPierceCancel is exported and registered for both use + skip prefixes', () => {
    assert.match(H_CB_SRC, /export async function handleZilloPierceCancel\(interaction, ctx\) \{/,
      'handleZilloPierceCancel must be exported');
    assert.match(H_IDX_SRC, /register\('zillo_pierce_use_',\s*handleZilloPierceCancel,\s*'combat'\)/,
      'zillo_pierce_use_ must be registered');
    assert.match(H_IDX_SRC, /register\('zillo_pierce_skip_',\s*handleZilloPierceCancel,\s*'combat'\)/,
      'zillo_pierce_skip_ must be registered');
  });

  it('handleZilloPierceCancel adds 2 to defenderReducePierce on use and re-enters sendReadyToResolveRolls', () => {
    const fn = H_CB_SRC.match(/export async function handleZilloPierceCancel\(interaction, ctx\) \{[\s\S]*?^}/m);
    assert.ok(fn, 'handleZilloPierceCancel body must be locatable');
    const body = fn[0];
    assert.match(body, /combat\.defenderReducePierce = \(combat\.defenderReducePierce \|\| 0\) \+ 2/,
      'use branch must add 2 to defenderReducePierce');
    assert.match(body, /sendReadyToResolveRolls\(thread, gameId, game, ctx\)/,
      'after the choice (use or skip), must re-enter sendReadyToResolveRolls to advance to pre_resolve gate');
  });
});
