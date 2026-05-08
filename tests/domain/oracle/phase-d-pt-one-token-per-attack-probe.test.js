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
    // Per CRR p.50, the token phase now runs pre-roll. After both sides finish:
    //   - pre-roll path → postRollDiceButton (post the Roll Combat Dice button)
    //   - post-roll path (legacy / safety) → proceedAfterTokens (passives + surge)
    // Per CRR p.50 + destruct 2026-05-08 on-declare merge: function may
    // open with a short-circuit branch when combat.onDeclareTokenContext
    // is set (per-player on_declare window keeps control until Ready),
    // BUT the legacy path must still: clear tokenPhase, promote attacker
    // → defender (and ONLY in that direction), then branch on attackRoll
    // to either postRollDiceButton (pre-roll) or proceedAfterTokens
    // (post-roll). The match below is anchored on the legacy block only.
    assert.match(H_CB_SRC,
      /combat\.tokenPhase = null;\s*\n\s*if \(completedRole === 'attacker'\) \{[\s\S]*?combat\.tokenPhase = 'defender';[\s\S]*?\}\s*\n\s*if \(!combat\.attackRoll\) \{\s*\n\s*await postRollDiceButton\(thread, game, combat, ctx\);\s*\n\s*return;\s*\n\s*\}\s*\n\s*await proceedAfterTokens\(thread, game, combat, ctx\);\s*\n\}/,
      'advanceTokenPhase legacy path must branch on attackRoll: pre-roll → postRollDiceButton, post-roll → proceedAfterTokens — CRR-PT-005');
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

  it('005e: source — every sendTokenWindow call site sets combat.tokenPhase first', () => {
    // After on-declare merge (destruct 2026-05-08): proceedToTokenPhase
    // is gone. sendTokenWindow is now opened from:
    //   - sendOnDeclareTokenWindow (parameterized by `role`) — one call site
    //   - advanceTokenPhase legacy attacker→defender promotion ('defender'
    //     literal) — kept as a safety branch even though on-declare path
    //     short-circuits via onDeclareTokenContext.
    // Total: 2 distinct call sites.
    const allSendWindow = H_CB_SRC.match(/await sendTokenWindow\(thread, game\.gameId, /g) || [];
    assert.ok(allSendWindow.length >= 2 && allSendWindow.length <= 3,
      'sendTokenWindow must have 2–3 call sites (sendOnDeclareTokenWindow + legacy advance) — CRR-PT-005');
    // Each call must be preceded by a combat.tokenPhase = ... assignment
    // within ~200 chars (allow @-ping resolution lines in between).
    const paired = H_CB_SRC.match(/combat\.tokenPhase = (?:role|'attacker'|'defender');[\s\S]{0,200}?await sendTokenWindow\(thread, game\.gameId, /g) || [];
    assert.equal(paired.length, allSendWindow.length,
      'every sendTokenWindow call must be preceded by tokenPhase assignment — CRR-PT-005');
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
