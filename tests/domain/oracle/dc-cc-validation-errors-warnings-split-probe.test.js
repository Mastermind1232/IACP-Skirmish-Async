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
import { validateDeckLegal, normalizeSquadInput, UNIMPLEMENTED_CARDS } from '../../../src/game/validation.js';

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

describe('DC-CC: validateDeckLegal — unimplemented-card guard', () => {
  it('UNIMPLEMENTED_CARDS lists Set a Trap and Harsh Environment', () => {
    assert.ok(UNIMPLEMENTED_CARDS.includes('Set a Trap'));
    assert.ok(UNIMPLEMENTED_CARDS.includes('Harsh Environment'));
  });

  it('a CC list containing Set a Trap warns "is not implemented"', () => {
    const v = validate(['Rebel Trooper (Elite)'], ['Set a Trap']);
    const w = v.warnings.find(x => /Set a Trap/i.test(x) && /not implemented/i.test(x));
    assert.ok(w, `expected Set a Trap unimplemented warning, got: ${JSON.stringify(v.warnings)}`);
  });

  it('a CC list containing Harsh Environment warns "is not implemented"', () => {
    const v = validate(['Rebel Trooper (Elite)'], ['Harsh Environment']);
    const w = v.warnings.find(x => /Harsh Environment/i.test(x) && /not implemented/i.test(x));
    assert.ok(w, `expected Harsh Environment unimplemented warning, got: ${JSON.stringify(v.warnings)}`);
  });

  it('both cards present → both warned, deck still legal as far as the guard is concerned', () => {
    const v = validate(['Rebel Trooper (Elite)'], ['Set a Trap', 'Harsh Environment']);
    assert.ok(v.warnings.some(x => /Set a Trap/i.test(x) && /not implemented/i.test(x)));
    assert.ok(v.warnings.some(x => /Harsh Environment/i.test(x) && /not implemented/i.test(x)));
    // The guard emits warnings, never errors — it does not hard-block.
    assert.equal(v.errors.some(e => /not implemented/i.test(e)), false);
  });

  it('no unimplemented cards → no "not implemented" warnings', () => {
    const v = validate(['Rebel Trooper (Elite)'], ['Element of Surprise']);
    assert.equal(v.warnings.some(x => /not implemented/i.test(x)), false);
  });
});
