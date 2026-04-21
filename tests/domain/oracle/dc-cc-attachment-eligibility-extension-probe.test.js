/**
 * Oracle: Bo-Katan Kryze's "Last Wielder of the Darksaber" passive extends
 * attachment eligibility for [The Darksaber], bypassing the printed
 * "MAUL OR SABINE WREN ONLY" restriction on the attachment itself.
 *
 * Covers DC-CC ledger atom:
 *   - DC-PASSIVE-LAST-WIELDER-DARKSABER (promoted exempt → covered)
 *
 * Four assertions pin the extension mechanism:
 *   1. Library entry `last_wielder_darksaber_bokatan` declares
 *      `extendsAttachmentEligibility: ["The Darksaber", "[The Darksaber]"]`.
 *   2. Bo-Katan Kryze's specialAbilityIds includes the slug.
 *   3. `findEligibilityExtender` returns "Bo-Katan Kryze" when she's in the
 *      army and the card is The Darksaber.
 *   4. `findEligibilityExtender` returns null when she's NOT in the army —
 *      the restriction is not bypassed for unrelated DCs.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { getAbilityLibrary, getDcEffects } from '../../../src/data-loader.js';
import { findEligibilityExtender } from '../../../src/game/validation.js';

describe('DC-CC: Last Wielder of the Darksaber — attachment eligibility extension', () => {
  it('library entry declares extendsAttachmentEligibility for The Darksaber', () => {
    const lib = getAbilityLibrary();
    const entry = lib.abilities?.last_wielder_darksaber_bokatan;
    assert.ok(entry, 'last_wielder_darksaber_bokatan missing from library');
    assert.equal(entry.type, 'dcPassive');
    assert.ok(Array.isArray(entry.extendsAttachmentEligibility));
    assert.ok(entry.extendsAttachmentEligibility.includes('The Darksaber'));
  });

  it('dc-effects: Bo-Katan Kryze references last_wielder_darksaber_bokatan', () => {
    const eff = getDcEffects()?.['Bo-Katan Kryze'];
    assert.ok(eff, 'Bo-Katan Kryze missing');
    assert.ok(Array.isArray(eff.specialAbilityIds));
    assert.ok(eff.specialAbilityIds.includes('last_wielder_darksaber_bokatan'));
  });

  it('findEligibilityExtender returns Bo-Katan when she is in the army', () => {
    const dcEffects = getDcEffects();
    const army = ['Bo-Katan Kryze', 'Rebel Trooper (Elite)'];
    const who = findEligibilityExtender('The Darksaber', army, dcEffects);
    assert.equal(who, 'Bo-Katan Kryze');
  });

  it('findEligibilityExtender returns null when Bo-Katan is not in the army', () => {
    const dcEffects = getDcEffects();
    const army = ['Rebel Trooper (Elite)', 'Ewok Warrior (Elite)'];
    const who = findEligibilityExtender('The Darksaber', army, dcEffects);
    assert.equal(who, null);
  });
});
