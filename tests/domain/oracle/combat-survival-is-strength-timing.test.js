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
 * Card text (data/dc-effects.json: "The Armorer"):
 *   "Survival is Strength: While a friendly figure within 3 spaces is
 *    defending, if it spent a Block symbol during this attack, it may
 *    reroll 1 attack die."
 *
 * Old code put SiS into proceedAfterTokens (post-rerolls, post-tokens).
 * That triggered a reroll AFTER the attacker had finished rerolling — so
 * the defender could force a reroll on a die the attacker had already
 * decided not to reroll, violating step-3 ordering.
 *
 * New flow: at the start of the reroll phase, build a forced-reroll queue
 * entry for SiS if defenderSpentBlock + an Armorer-with-ability is within
 * 3 of the defender. The entry resolves through the existing forced-reroll
 * UI in step 3.
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

  it('forced-reroll queue is populated with a Survival is Strength entry when defenderSpentBlock + Armorer within 3', () => {
    // The reroll-phase entry must exist alongside Versatile Weaponry / Raider /
    // Precision / Fyrnock Style — same shape, source = "Survival is Strength".
    assert.match(H_CB_SRC,
      /survival_is_strength_armorer[\s\S]*?combat\.forcedRerollQueue\.push\(\{[\s\S]*?source:\s*'Survival is Strength'/,
      'reroll-phase build must push a SiS entry when the Armorer/condition match');
  });

  it('SiS forced-reroll entry includes armorerFigKey for ability-used tracking', () => {
    // Without armorerFigKey on the entry, the forced-reroll handler can't mark
    // roundFigureAbilityUsed — which would let SiS fire repeatedly.
    assert.match(H_CB_SRC,
      /source:\s*'Survival is Strength',\s*\n\s*armorerFigKey:\s*_sisFk/,
      'SiS queue entry must carry armorerFigKey for round-once enforcement');
  });

  it('forced-reroll handler marks SiS used only after a reroll fires (skip preserves the ability)', () => {
    // Per CRR "may" semantics: skipping the SiS prompt should NOT consume the
    // once-per-round ability. The mark-used must live in the reroll-fired
    // branch, NOT in the skip branch.
    const handler = H_CB_SRC.match(/--- Forced reroll phase handling ---[\s\S]*?if \(\(combat\.forcedRerollQueue \|\| \[\]\)\.length > 0\) \{[\s\S]*?return;\s*\n\s*\}/);
    assert.ok(handler, 'forced-reroll handler block must be locatable');
    const body = handler[0];
    // Must mark SiS used in the reroll-fired branch
    assert.match(body, /_frEntry\.source === 'Survival is Strength'[\s\S]*?_frEntry\.armorerFigKey[\s\S]*?roundFigureAbilityUsed/,
      'reroll-fired branch must mark SiS used via roundFigureAbilityUsed');
    // The shift on Skip / exhausted should be source-agnostic — no special
    // mark-used logic next to the shift call (otherwise Skip would burn the ability).
    const shiftIdx = body.indexOf('combat.forcedRerollQueue.shift()');
    if (shiftIdx >= 0) {
      const around = body.slice(Math.max(0, shiftIdx - 200), shiftIdx + 200);
      assert.doesNotMatch(around, /Survival is Strength[\s\S]{0,100}roundFigureAbilityUsed/,
        'Skip branch must not mark SiS used — that would defeat the "may" semantics');
    }
  });

  it('handleCombatPassive no longer has a survival branch (legacy prompt fully removed)', () => {
    assert.doesNotMatch(H_CB_SRC, /} else if \(abilityKey === 'survival'\)/,
      'handleCombatPassive survival branch is dead code under the step-3 flow');
  });
});
