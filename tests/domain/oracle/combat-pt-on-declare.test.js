/**
 * CRR-COMBAT-PT-DECLARE: power-token spend window happens BEFORE rolling dice.
 *
 * CRR (Combat Rules Reference) p.50, Power Tokens:
 *   "When a figure with a power token declares an attack or is declared as
 *    the target of an attack, that figure may spend 1 of its power tokens
 *    to apply +1 of the symbol on that token to the attack results."
 *
 * The trigger is declaration. The spend decision happens at declare, before
 * dice are rolled — players cannot see roll results before deciding whether
 * to commit a token. Spending after rolls would be information the rules do
 * not grant.
 *
 * This test pins the source-level ordering so a future refactor can't
 * silently move the token phase back to its old (buggy) post-reroll location.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '../../..');
const H_CB_SRC = readFileSync(resolve(ROOT, 'src/handlers/combat.js'), 'utf8');

describe('CRR-COMBAT-PT-DECLARE: power-token phase happens pre-roll', () => {
  it('dispatchCombatGateAdvance routes on_declare to postRollDiceButton (tokens already spent)', () => {
    // Per destruct 2026-05-08: tokens are spent inside the per-player
    // on_declare window (sendOnDeclareTokenWindow), so by the time both
    // players ack the gate, token phase is done. The on_declare branch
    // of dispatchCombatGateAdvance goes straight to postRollDiceButton.
    const fnMatch = H_CB_SRC.match(/async function dispatchCombatGateAdvance\(thread, game, combat, subPhase, ctx\) \{[\s\S]*?^}/m);
    assert.ok(fnMatch, 'dispatchCombatGateAdvance body must be locatable');
    const body = fnMatch[0];
    assert.match(body, /case 'on_declare':[\s\S]*?await postRollDiceButton\(thread, game, combat, ctx\);/,
      'dispatchCombatGateAdvance on_declare branch must call postRollDiceButton — tokens done in declare');
    assert.doesNotMatch(body, /await proceedToTokenPhase\b/,
      'dispatchCombatGateAdvance must not call the deleted proceedToTokenPhase');
  });

  it('attack-declare site posts sendOnDeclareYn (sequential per-player Y/N gate)', () => {
    // Per alexanbv 2026-05-12: on-declare effects use the same Y/N
    // shape as step-4 sendModsYn — single prompt per player, attacker
    // first, sequential. Replaces the prior parallel "Ready button +
    // auto-posted token window" pair which gave each player two
    // simultaneous prompts.
    assert.match(H_CB_SRC,
      /await sendOnDeclareYn\(thread, game, game\.pendingCombat, 'attacker'\);/,
      'attack-declare must post sendOnDeclareYn for the attacker (sequential Y/N gate)');
  });

  it('sendOnDeclareYn body opens the token window only inside the Yes branch of handleCombatOnDeclareYn', () => {
    // The token window is no longer auto-posted alongside the gate.
    // It opens only when the player clicks Yes, alongside the
    // "Done with on-declare — continue" follow-up.
    const handlerMatch = H_CB_SRC.match(/export async function handleCombatOnDeclareYn\(interaction, ctx\) \{[\s\S]*?^}/m);
    assert.ok(handlerMatch, 'handleCombatOnDeclareYn body must be locatable');
    const body = handlerMatch[0];
    assert.match(body, /sendOnDeclareTokenWindow\(thread, game, combat, isAtk \? 'attacker' : 'defender', ctx\)/,
      "Yes branch must open the on-declare token window for the clicker's role");
    assert.match(body, /combat_on_declare_yn_\$\{gameId\}_\$\{side\}_continue/,
      'Yes branch must post a Continue follow-up button');
    assert.match(body, /sendOnDeclareYn\(thread, game, combat, 'defender'\)/,
      "Attacker's No/Continue must advance to defender Y/N");
    assert.match(body, /postRollDiceButton\(thread, game, combat, ctx\)/,
      "Defender's No/Continue must advance to dice roll");
  });

  it('proceedToTokenPhase has been removed', () => {
    assert.doesNotMatch(H_CB_SRC, /export async function proceedToTokenPhase\(/,
      'proceedToTokenPhase function must be deleted — its callers go through sendOnDeclareTokenWindow + postRollDiceButton now');
  });

  it('postRollDiceButton always auto-rolls (no roll button posted)', () => {
    const fnMatch = H_CB_SRC.match(/async function postRollDiceButton\(thread, game, combat, ctx\) \{[\s\S]*?^}/m);
    assert.ok(fnMatch, 'postRollDiceButton must exist');
    const body = fnMatch[0];
    // 2026-05-04 final: held-roll buttons + held-unsafe predicate fully
    // removed. VI atk + Guidance Systems migrated to sendModsYn (CRR step 4),
    // VI def + TINT + Doubt fire from inside the def synth's defense block
    // and re-enter via sendRerollUI / proceedAfterRerolls. Auto-roll is now
    // safe for every combat.
    assert.match(body, /await autoRollDice\(thread, game, combat, ctx\);/,
      'postRollDiceButton must call autoRollDice unconditionally');
    assert.doesNotMatch(body, /_isHeldRollSafe/,
      'postRollDiceButton must no longer branch on _isHeldRollSafe (predicate removed)');
    assert.doesNotMatch(body, /setLabel\('Roll Combat Dice'\)/,
      'postRollDiceButton must NOT post the legacy single-button fallback anymore');
    assert.doesNotMatch(body, /setLabel\('⚔️ Roll Attack Dice'\)/,
      'postRollDiceButton must NOT post the held-roll attack button');
    assert.doesNotMatch(body, /setLabel\('🛡️ Roll Defense Dice'\)/,
      'postRollDiceButton must NOT post the held-roll defense button');
  });

  it('_isHeldRollSafe predicate fully removed from combat.js', () => {
    assert.doesNotMatch(H_CB_SRC, /function _isHeldRollSafe\b/,
      '_isHeldRollSafe predicate must be deleted (auto-roll is universal)');
  });

  it('autoRollDice exists and synthesizes both roll-button clicks', () => {
    const fnMatch = H_CB_SRC.match(/async function autoRollDice\(thread, game, combat, ctx\) \{[\s\S]*?^}/m);
    assert.ok(fnMatch, 'autoRollDice must exist');
    const body = fnMatch[0];
    assert.match(body, /handleCombatRoll/,
      'autoRollDice must invoke handleCombatRoll to reuse existing roll + reroll-window logic');
    assert.match(body, /combat_roll_\$\{role\}/,
      'autoRollDice must synthesize a role-suffixed roll customId');
    assert.match(body, /'atk'/,
      'autoRollDice must call synth with role=atk');
    assert.match(body, /'def'/,
      'autoRollDice must call synth with role=def');
  });

  it('proceedAfterRerolls no longer opens token windows (tokens already resolved pre-roll)', () => {
    const fnMatch = H_CB_SRC.match(/export async function proceedAfterRerolls\(thread, game, combat, ctx\) \{[\s\S]*?^}/m);
    assert.ok(fnMatch, 'proceedAfterRerolls body must be locatable');
    const body = fnMatch[0];
    assert.doesNotMatch(body, /combat\.tokenPhase = '(attacker|defender)';/,
      'proceedAfterRerolls must not assign tokenPhase — token phase ran pre-roll — CRR p.50');
    assert.doesNotMatch(body, /sendTokenWindow\(/,
      'proceedAfterRerolls must not open a token window — CRR p.50');
  });
});
