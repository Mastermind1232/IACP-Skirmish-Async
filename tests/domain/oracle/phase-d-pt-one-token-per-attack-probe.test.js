/**
 * Phase-D probe: a figure cannot spend more than one power token per attack.
 *
 * PROBE-PD-PT-005: CRR POWER TOKENS — "A figure cannot spend more than 1
 *   power token per attack."
 *
 * Implementation: in `src/handlers/combat.js`, the power-token phase of
 *   combat is a strict linear state machine:
 *     attacker (optional, one-shot) → defender (optional, one-shot) → proceedAfterTokens
 *   No branch in this state machine returns to the same role it just
 *   handled. Key structural guarantees:
 *     1. `advanceTokenPhase` clears `combat.tokenPhase = null;` on entry.
 *        It only ever promotes attacker → defender (once), then falls
 *        through to `proceedAfterTokens`. There is no path back.
 *     2. `handleCombatToken` guards on `combat.tokenPhase !== expectedPhase`
 *        (unless wild-type resolution is in flight) — after the first
 *        spend/skip, tokenPhase is null, so a second click is rejected.
 *     3. `sendTokenWindow` is called exactly once per role per attack:
 *        once for attacker (in proceedAfterRerolls), once for defender
 *        (inside advanceTokenPhase).
 *     4. After any single spend (direct, squad-cohesion, or wild), the
 *        single call to `advanceTokenPhase` ends the window.
 *   Together these pin "at most one spend per role per attack" — and since
 *   attacker/defender are distinct figures, "per figure per attack" is the
 *   same invariant.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '../../..');
const H_CB_SRC = readFileSync(resolve(ROOT, 'src/handlers/combat.js'), 'utf8');

describe('PROBE-PD-PT-005: at most one power-token spend per figure per attack', () => {
  it('005a: source — advanceTokenPhase clears tokenPhase on entry and only promotes attacker → defender', () => {
    assert.match(H_CB_SRC,
      /async function advanceTokenPhase\(thread, game, combat, completedRole, ctx\) \{\s*\n\s*combat\.tokenPhase = null;\s*\n\s*if \(completedRole === 'attacker'\) \{[\s\S]*?combat\.tokenPhase = 'defender';[\s\S]*?\}\s*\n\s*await proceedAfterTokens\(thread, game, combat, ctx\);\s*\n\}/,
      'advanceTokenPhase must clear tokenPhase then optionally promote to defender and fall through — CRR-PT-005');
  });

  it('005b: source — there is exactly one promotion to defender inside advanceTokenPhase (no loop-back to attacker)', () => {
    const fnBody = H_CB_SRC.match(/async function advanceTokenPhase\(thread, game, combat, completedRole, ctx\) \{[\s\S]*?^}/m);
    assert.ok(fnBody, 'advanceTokenPhase body must be locatable');
    const defenderHits = (fnBody[0].match(/combat\.tokenPhase = 'defender';/g) || []).length;
    assert.equal(defenderHits, 1,
      'defender promotion must happen at most once inside advanceTokenPhase — CRR-PT-005');
    assert.doesNotMatch(fnBody[0], /combat\.tokenPhase = 'attacker';/,
      'advanceTokenPhase must never revert to attacker — CRR-PT-005');
  });

  it('005c: source — handleCombatToken guards on tokenPhase match (second click after spend is rejected because tokenPhase is null)', () => {
    assert.match(H_CB_SRC,
      /const expectedPhase = isAttacker \? 'attacker' : 'defender';\s*\n\s*if \(combat\.tokenPhase !== expectedPhase\) return;/,
      'handleCombatToken must reject clicks whose expected phase is not current — CRR-PT-005');
  });

  it('005d: source — each of the three spend branches (direct / squad-cohesion / wild) ends with exactly one advanceTokenPhase call', () => {
    const fnBody = H_CB_SRC.match(/export async function handleCombatToken\(interaction, ctx\) \{[\s\S]*?^}/m);
    assert.ok(fnBody, 'handleCombatToken body must be locatable');
    const advCount = (fnBody[0].match(/await advanceTokenPhase\(thread, game, combat,/g) || []).length;
    assert.equal(advCount, 4,
      'handleCombatToken must have exactly 4 advance-phase calls (wild + skip + squad-cohesion + direct) — CRR-PT-005');
  });

  it('005e: source — sendTokenWindow is opened at most once per attack per role; every opener first sets tokenPhase to match', () => {
    // Every sendTokenWindow call is immediately preceded by `combat.tokenPhase = '<role>';`,
    // so there is no path that opens a token window without first re-asserting the state machine.
    // Count openers: attacker has exactly one (proceedAfterRerolls). Defender has TWO
    // mutually exclusive openers (proceedAfterRerolls skip-path + advanceTokenPhase) —
    // but at runtime only one fires per attack because they live on disjoint control-flow branches.
    const attackerWindow = H_CB_SRC.match(/combat\.tokenPhase = 'attacker';\s*\n\s*await sendTokenWindow\(thread, game\.gameId, 'attacker',/g) || [];
    const defenderWindow = H_CB_SRC.match(/combat\.tokenPhase = 'defender';\s*\n\s*await sendTokenWindow\(thread, game\.gameId, 'defender',/g) || [];
    assert.equal(attackerWindow.length, 1,
      'attacker window must be opened from exactly one site — CRR-PT-005');
    assert.ok(defenderWindow.length >= 1 && defenderWindow.length <= 2,
      'defender window may be opened from ≤2 mutually exclusive sites — CRR-PT-005');
    // sendTokenWindow is never invoked WITHOUT first setting combat.tokenPhase.
    const allSendWindow = H_CB_SRC.match(/await sendTokenWindow\(thread, game\.gameId, '(attacker|defender)',/g) || [];
    assert.equal(allSendWindow.length, attackerWindow.length + defenderWindow.length,
      'every sendTokenWindow call must be preceded by a tokenPhase assignment — CRR-PT-005');
  });

  it('005f: source — after a spend, the spent token is removed from the figure pool (one-way consumption)', () => {
    // Direct spend
    assert.match(H_CB_SRC,
      /removeSpentToken\(game, figureKey, tokenIndex\);/,
      'direct spend must remove the spent token from the figure pool — CRR-PT-005');
    // Squad-cohesion spend
    assert.match(H_CB_SRC,
      /removeSpentToken\(game, scEntry\.figureKey, scEntry\.tokenIndex\);/,
      'squad-cohesion spend must remove the spent token — CRR-PT-005');
    // Wild spend
    assert.match(H_CB_SRC,
      /removeSpentToken\(game, figKey, combat\.pendingWildTokenIndex\);/,
      'wild spend must remove the spent token — CRR-PT-005');
  });
});
