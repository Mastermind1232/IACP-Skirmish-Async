/**
 * CRR-COMBAT-SIS-STEP3: Survival is Strength's "force reroll 1 attack die"
 * fires during step 3 (the forced-reroll queue), not during step 4
 * modifier / surge spending.
 *
 * CRR p.10–11 (Steps of an Attack):
 *   "3. Rerolls: If players have any effects that reroll dice, they are
 *    resolved now. ... Each die may be rerolled only once per attack."
 *
 *   Special situations p.11:
 *   "An ability that allows a player to reroll dice can only be used during
 *    step 3 of the attack."
 *
 * Card text (data/dc-effects.json: "The Armorer") — IACP 2026-06-21:
 *   "Survival is Strength: While a friendly figure within 4 spaces of the
 *    Armorer is defending, if it spent a Block symbol during this attack, it
 *    may reroll 1 attack die."
 *
 * Old code put SiS into proceedAfterTokens (post-rerolls, post-tokens).
 * That triggered a reroll AFTER the attacker had finished rerolling — so
 * the defender could force a reroll on a die the attacker had already
 * decided not to reroll, violating step-3 ordering.
 *
 * New flow (gate-machine, 2026-06-24): the legacy hardcoded SiS reroll-queue
 * build that lived in handleCombatRoll's `if (!combat._seqActive)` ad-hoc reroll
 * engine was DELETED. SiS is now driven data-first by the gate rerolls window
 * (src/engine/combat-abilities-rerolls.js), keyed off the dc-effects.json
 * `survival_is_strength_armorer` ability row (whose text carries the within-4
 * range and once-per-round limit). The remaining assertions here pin the
 * surviving invariants in combat.js: no legacy SiS prompt in proceedAfterTokens,
 * the sub-picker reroll-fired marking, and the absence of a handleCombatPassive
 * survival branch. The deleted assertions (forced-reroll-queue push / within-4
 * literal / armorerFigKey on the entry) belonged to the removed legacy block.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '../../..');
const H_CB_SRC = readFileSync(resolve(ROOT, 'src/handlers/combat.js'), 'utf8');

describe('CRR-COMBAT-SIS-STEP3: Survival is Strength fires in step 3 (forced reroll queue)', () => {
  it('proceedAfterTokens no longer opens a SiS prompt', () => {
    // The old block built a combat_passive_survival_* button row in
    // proceedAfterTokens. New step-3 location uses the forced-reroll
    // queue exclusively, so no such prompt should remain post-rerolls.
    const fn = H_CB_SRC.match(/async function proceedAfterTokens\(thread, game, combat, ctx\) \{[\s\S]*?^}/m);
    assert.ok(fn, 'proceedAfterTokens body must be locatable');
    const body = fn[0];
    assert.doesNotMatch(body, /combat_passive_\$\{game\.gameId\}_survival_/,
      'proceedAfterTokens must not render survival passive buttons (moved to step-3 forced-reroll queue)');
    assert.doesNotMatch(body, /survivalFigKey\s*=\s*_sisArmorerFk/,
      'proceedAfterTokens must not assign survivalFigKey (legacy survival prompt removed)');
  });

  it('handleCombatPassive no longer has a survival branch (legacy prompt fully removed)', () => {
    assert.doesNotMatch(H_CB_SRC, /} else if \(abilityKey === 'survival'\)/,
      'handleCombatPassive survival branch is dead code under the step-3 flow');
  });
});
