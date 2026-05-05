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
  it('handleCombatReady invokes proceedToTokenPhase (not the roll button) once both players ready', () => {
    // Locate the body of handleCombatReady.
    const fnMatch = H_CB_SRC.match(/export async function handleCombatReady\(interaction, ctx\) \{[\s\S]*?^}/m);
    assert.ok(fnMatch, 'handleCombatReady body must be locatable');
    const body = fnMatch[0];
    // After the both-ready guard, the next phase call must be proceedToTokenPhase.
    assert.match(body, /await proceedToTokenPhase\(thread, game, combat, ctx\);/,
      'handleCombatReady must call proceedToTokenPhase before the roll — CRR p.50');
    // It must NOT post the Roll Combat Dice button directly inside handleCombatReady —
    // that would skip the pre-roll PT phase. The button is posted by postRollDiceButton.
    assert.doesNotMatch(body, /setLabel\('Roll Combat Dice'\)/,
      'handleCombatReady must not post the roll button itself — postRollDiceButton owns it — CRR p.50');
  });

  it('proceedToTokenPhase exists, opens the attacker token window, and falls through to postRollDiceButton', () => {
    const fnMatch = H_CB_SRC.match(/export async function proceedToTokenPhase\(thread, game, combat, ctx\) \{[\s\S]*?^}/m);
    assert.ok(fnMatch, 'proceedToTokenPhase must exist as an exported function');
    const body = fnMatch[0];
    assert.match(body, /combat\.tokenPhase = 'attacker';/,
      'proceedToTokenPhase must promote tokenPhase to attacker first');
    assert.match(body, /combat\.tokenPhase = 'defender';/,
      'proceedToTokenPhase must promote tokenPhase to defender as fallback');
    assert.match(body, /await postRollDiceButton\(thread, game, combat, ctx\);/,
      'proceedToTokenPhase must end with postRollDiceButton when no tokens to spend');
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
