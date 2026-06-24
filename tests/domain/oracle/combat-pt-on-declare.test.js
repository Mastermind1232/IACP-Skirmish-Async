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
  it('attack-declare site walks the gate sequence; on_declare precedes roll (tokens pre-roll)', () => {
    // Gate cutover (alexanbv 2026-06-16): the declare site runs the gate
    // sequence. The CRR pre-roll-token guarantee now comes from ATTACK_STEPS
    // ordering — the on_declare gate (which offers power-token spends) precedes
    // the roll mechanic, so tokens are still committed before dice are seen.
    assert.match(H_CB_SRC,
      /await runAttackSequence\(thread, game, game\.pendingCombat, ctx\);/,
      'attack-declare must launch the gate sequence (runAttackSequence)');
    const seqSrc = readFileSync(resolve(ROOT, 'src/engine/combat-sequence.js'), 'utf8');
    const stepsMatch = seqSrc.match(/export const ATTACK_STEPS = Object\.freeze\(\[([\s\S]*?)\]\)/);
    assert.ok(stepsMatch, 'ATTACK_STEPS must be locatable');
    const order = [...stepsMatch[1].matchAll(/'([a-z_]+)'/g)].map((m) => m[1]);
    assert.ok(order.indexOf('on_declare') >= 0 && order.indexOf('roll') >= 0
      && order.indexOf('on_declare') < order.indexOf('roll'),
      'on_declare (power-token spend window) must precede roll in ATTACK_STEPS');
  });

  it('legacy on-declare Y/N chain (sendOnDeclareYn / handleCombatOnDeclareYn) is removed', () => {
    // Gate cutover (alexanbv 2026-06-16): the sequential on-declare Y/N chain is
    // retired — the gate's on_declare window handles on-declare effects + the
    // power-token spend before the roll step.
    assert.doesNotMatch(H_CB_SRC, /export async function sendOnDeclareYn\(/,
      'sendOnDeclareYn must be deleted (gate on_declare window replaces it)');
    assert.doesNotMatch(H_CB_SRC, /export async function handleCombatOnDeclareYn\(/,
      'handleCombatOnDeclareYn must be deleted');
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
});
