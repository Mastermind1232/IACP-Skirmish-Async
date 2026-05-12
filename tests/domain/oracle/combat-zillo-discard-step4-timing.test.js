/**
 * CRR-COMBAT-ZILLO-DISCARD-STEP4: Zillo Technique's discard-CC for +1 Block
 * fires during step 4 (Apply Modifiers — defender modifiers), not at attack
 * declare and not in the post-step-4 surge/resolve flow.
 *
 * Card text (data/dc-effects.json: "[Zillo Technique]"):
 *   "While a friendly figure is defending, you may discard 1 Command card to
 *    apply +1 Block to the defense results. Limit once per attack."
 *
 * CRR p.10 (Steps of an Attack):
 *   "4. Apply Modifiers: If players have any effects that add or remove
 *    symbols or Accuracy, they are applied at this time."
 *
 * +1 Block to defense results = step-4 defender modifier. Per alexanbv
 * 2026-05-12, the canonical implementation site is sendModsYn(defender) —
 * the in-engine step-4-defender gate. An earlier implementation parked the
 * prompt inside proceedAfterRerolls (step 5 territory), producing a confusing
 * second prompt AFTER the defender's mods Y/N closed. Now the prompt fires
 * INSIDE the step-4-defender sub-window, alongside the Y/N gate.
 *
 * Flow: sendModsYn(defender) → Zillo discard Y/N (if eligible) →
 *       handleZilloDiscard → re-enter sendModsYn(defender) → mods Y/N gate →
 *       step 5 → proceedAfterRerolls.
 *
 * Zillo Technique's exhaust ability (cancel +2 Pierce in the zillo-window
 * step between step 5 and step 6) is unrelated and remains in
 * sendReadyToResolveRolls; the discard ability is what moves here.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '../../..');
const H_CB_SRC = readFileSync(resolve(ROOT, 'src/handlers/combat.js'), 'utf8');

describe('CRR-COMBAT-ZILLO-DISCARD-STEP4: discard-CC for +1 Block fires in sendModsYn(defender)', () => {
  it('attack-declare path does not render the Zillo discard-CC prompt', () => {
    const declareBlock = H_CB_SRC.match(/Zillo Technique \(I51-I52\) defender's team SU[\s\S]*?Z-6 Trooper Rotary Cannon/);
    assert.ok(declareBlock, 'declare-site Zillo placeholder must exist (comments only)');
    assert.doesNotMatch(declareBlock[0], /Discard 1 Command card for \*\*\+1 Block\*\*/,
      'declare-time discard-CC prompt must be removed — moved to sendModsYn(defender)');
    assert.doesNotMatch(declareBlock[0], /pendingZilloDiscard\s*=/,
      'declare-time pendingZilloDiscard assignment must be removed');
  });

  it('proceedAfterRerolls DEF block no longer contains the Zillo discard-CC prompt', () => {
    const fn = H_CB_SRC.match(/export async function proceedAfterRerolls\(thread, game, combat, ctx\) \{[\s\S]*?^}/m);
    assert.ok(fn, 'proceedAfterRerolls body must be locatable');
    const body = fn[0];
    assert.doesNotMatch(body, /Discard 1 Command card for \*\*\+1 Block\*\*/,
      'proceedAfterRerolls must NOT render the Zillo discard prompt — it lives in sendModsYn(defender)');
    assert.doesNotMatch(body, /setPendingZilloDiscard\(/,
      'proceedAfterRerolls must NOT set pendingZilloDiscard — moved to sendModsYn');
  });

  it('sendModsYn body contains the Zillo discard-CC prompt for the defender branch', () => {
    const fn = H_CB_SRC.match(/export async function sendModsYn\(thread, game, combat, role\) \{[\s\S]*?^}/m);
    assert.ok(fn, 'sendModsYn body must be locatable');
    const body = fn[0];
    assert.match(body, /Zillo Technique[\s\S]*?Discard 1 Command card for \*\*\+1 Block\*\*/,
      'sendModsYn must include the step-4 Zillo discard-CC prompt text');
    assert.match(body, /combat\.zilloDiscardResolved/,
      'block must use a once-per-attack flag (combat.zilloDiscardResolved)');
    assert.match(body, /!isAtk &&/,
      'block must gate on defender role (!isAtk)');
  });

  it('handleZilloDiscard re-enters sendModsYn(defender) after the choice (use or skip)', () => {
    const fn = H_CB_SRC.match(/export async function handleZilloDiscard\(interaction, ctx\) \{[\s\S]*?^}/m);
    assert.ok(fn, 'handleZilloDiscard body must be locatable');
    const body = fn[0];
    assert.match(body, /combat\.zilloDiscardResolved\s*=\s*true/,
      'must set the once-per-attack flag (Skip and use both consume the per-attack option)');
    assert.match(body, /sendModsYn\(thread, game, combat, 'defender'\)/,
      'must re-enter sendModsYn(defender) so the basic mods Y/N gate still fires after the Zillo choice');
  });
});
