/**
 * Oracle: `validateDeckLegal` surfaces attachment-legality issues via two
 * distinct channels so the UI can block vs. inform:
 *
 *   - `errors`:   an attachment whose "X ONLY" restriction cannot be
 *                  satisfied by any DC in the army. Deck is illegal.
 *   - `warnings`: an attachment that is legal only because of an
 *                  eligibility-extending passive (e.g. Bo-Katan's "Last
 *                  Wielder of the Darksaber"). Deck is legal; the note
 *                  makes the non-obvious dependency visible to the user.
 *
 * Probes:
 *   1. Return shape — `warnings` array is always present.
 *   2. Unsatisfiable restriction populates `errors` and flips `legal=false`.
 *   3. Extender-only legality populates `warnings` but keeps `legal=true`.
 *   4. Printed-match + extender present → no warning (extender is redundant).
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { validateDeckLegal, normalizeSquadInput } from '../../../src/game/validation.js';

// Minimal helper: validate a raw dc/cc list pair without asserting cost.
// These probes only care about the attachment channels, not the 40/15 totals.
function validate(dcList, ccList = []) {
  const squad = normalizeSquadInput({ dcList: [...dcList], ccList: [...ccList] });
  return validateDeckLegal(squad);
}

describe('DC-CC: validateDeckLegal — errors vs warnings split', () => {
  it('return shape always includes a warnings array', () => {
    const v = validate(['Rebel Trooper (Elite)']);
    assert.ok(Array.isArray(v.errors));
    assert.ok(Array.isArray(v.warnings));
  });

  it('unsatisfiable restriction → error (deck illegal)', () => {
    // "[Advanced Com Systems]" is LEADER ONLY. No LEADER in this army.
    const v = validate(['[Advanced Com Systems]', 'Rebel Trooper (Elite)']);
    const hasAttachmentError = v.errors.some(e => /Advanced Com Systems/i.test(e));
    assert.ok(hasAttachmentError, `expected attachment error, got: ${JSON.stringify(v.errors)}`);
    assert.equal(v.legal, false);
  });

  it('extender-only legality → warning (deck legal)', () => {
    // "[The Darksaber]" is MAUL OR SABINE WREN ONLY. Neither is in the army,
    // but Bo-Katan Kryze's "Last Wielder" passive extends eligibility.
    const v = validate(['[The Darksaber]', 'Bo-Katan Kryze']);
    const attachmentErrors = v.errors.filter(e => /Darksaber/i.test(e));
    assert.equal(attachmentErrors.length, 0, `unexpected Darksaber errors: ${JSON.stringify(attachmentErrors)}`);
    const hasExtenderWarning = v.warnings.some(w => /Darksaber/i.test(w) && /Bo-Katan Kryze/i.test(w));
    assert.ok(hasExtenderWarning, `expected extender warning, got: ${JSON.stringify(v.warnings)}`);
  });

  it('printed-match satisfied → no extender warning even if extender is in army', () => {
    // Sabine Wren is named in the printed restriction, so Bo-Katan's
    // passive is redundant — no warning should be emitted.
    const v = validate(['[The Darksaber]', 'Bo-Katan Kryze', 'Sabine Wren']);
    const extenderWarnings = v.warnings.filter(w => /Darksaber/i.test(w));
    assert.equal(extenderWarnings.length, 0, `unexpected redundant warning: ${JSON.stringify(extenderWarnings)}`);
  });
});
