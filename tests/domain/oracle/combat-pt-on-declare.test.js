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
  it('handleCombatReady advances to postRollDiceButton (tokens already spent in on_declare merge)', () => {
    // Per destruct 2026-05-08: tokens are spent inside the per-player
    // on_declare window (sendOnDeclareTokenWindow), so by the time both
    // players ack the gate, token phase is done. handleCombatReady's
    // post-ack path goes straight to postRollDiceButton.
    const fnMatch = H_CB_SRC.match(/export async function handleCombatReady\(interaction, ctx\) \{[\s\S]*?^}/m);
    assert.ok(fnMatch, 'handleCombatReady body must be locatable');
    const body = fnMatch[0];
    assert.match(body, /await postRollDiceButton\(thread, game, combat, ctx\);/,
      'handleCombatReady must call postRollDiceButton after both ack — tokens done in declare');
    assert.doesNotMatch(body, /await proceedToTokenPhase\b/,
      'handleCombatReady must not call the deleted proceedToTokenPhase — tokens are merged into on_declare');
    assert.doesNotMatch(body, /setLabel\('Roll Combat Dice'\)/,
      'handleCombatReady must not post the roll button itself — postRollDiceButton owns it');
  });

  it('on_declare gate posts sendOnDeclareTokenWindow inline so cards + tokens land in same player window', () => {
    // The merge replaces the legacy "all cards first, then tokens
    // sequentially" with a per-player combined window. Source-pin the
    // wiring at the attack-declaration site.
    assert.match(H_CB_SRC,
      /await sendCombatGate\(thread, game, game\.pendingCombat, 'on_declare', ctx\);\s*\n\s*await sendOnDeclareTokenWindow\(thread, game, game\.pendingCombat, 'attacker', ctx\);/,
      'attack-declare must post on_declare gate AND attacker token window inline — destruct 2026-05-08');
  });

  it('handleCombatGateReady posts defender token window after attacker acks on_declare', () => {
    // Bug found 2026-05-11: live combat_gate_ flow only posted the
    // attacker's token window — defender saw the gate Ready button but
    // never got a token-spend UI. Fix: post sendOnDeclareTokenWindow
    // for the defender during the attacker→defender rotation, scoped
    // to the on_declare phase only.
    const fnMatch = H_CB_SRC.match(/export async function handleCombatGateReady\(interaction, ctx\) \{[\s\S]*?^}/m);
    assert.ok(fnMatch, 'handleCombatGateReady body must be locatable');
    const body = fnMatch[0];
    assert.match(body, /sendOnDeclareTokenWindow\(thread, game, combat, 'defender', ctx\)/,
      'handleCombatGateReady must post defender on-declare token window after attacker acks');
    assert.match(body, /gate\.phase === 'on_declare' && effectivePn === atkPn/,
      'defender token-window post must be guarded by phase=on_declare AND attacker-just-acked');
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
