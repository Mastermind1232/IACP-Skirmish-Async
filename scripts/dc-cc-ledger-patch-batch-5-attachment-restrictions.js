#!/usr/bin/env node
/**
 * Batch-5 DC/CC ledger patch: close the attachment-restriction campaign.
 *
 * Three shipped slices this batch covers:
 *
 *   A. Manual picker server-side re-check. `handleSetupAttachTo` calls
 *      `getAttachmentRestriction(card, armyDcNames).filter(chosenDcName)`
 *      before committing the player's choice, rejecting crafted interactions
 *      that bypass the filtered dropdown.
 *
 *   C. Eligibility-extending passives — first implementation is Bo-Katan
 *      Kryze's "Last Wielder of the Darksaber". Library entry declares
 *      `extendsAttachmentEligibility: ["The Darksaber", "[The Darksaber]"]`;
 *      shared `findEligibilityExtender` in src/game/validation.js is consumed
 *      by BOTH `parseAttachmentRestriction` (validation) and
 *      `getAttachmentRestriction` (setup picker). Bo-Katan's
 *      specialAbilityIds now references the slug.
 *
 *   D. Deck-legal validation now returns a structured warnings channel.
 *      `validateAttachmentTargets` returns `{ errors, warnings }`:
 *        - errors: unsatisfiable "X ONLY" restrictions (deck illegal)
 *        - warnings: attachments that are legal only through an
 *          eligibility-extender (advisory — deck stays legal)
 *      `buildSquadConfirmText` surfaces the warnings alongside existing
 *      upgrade/affiliation advisories.
 *
 * Closes DC-PASS-LAST-WIELDER-DARKSABER-BOKATAN: previously exempt with
 * reason "attachment eligibility not enforced anywhere in src/". That
 * enforcement is now in place and the passive is directly wired into it.
 *
 * Three oracle probes pin the behavior:
 *   - tests/domain/oracle/dc-cc-attachment-eligibility-extension-probe.test.js
 *   - tests/domain/oracle/dc-cc-attachment-manual-picker-gate-probe.test.js
 *   - tests/domain/oracle/dc-cc-validation-errors-warnings-split-probe.test.js
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');
const LEDGER_PATH = resolve(ROOT, 'docs/dc-cc-ledger.json');

const ledger = JSON.parse(readFileSync(LEDGER_PATH, 'utf8'));
const atom = ledger.atoms.find((a) => a.abilityKey === 'last_wielder_darksaber_bokatan');
if (!atom) throw new Error('last_wielder_darksaber_bokatan atom missing');

atom.status = 'covered';
atom.exemptReason = null;
atom.implHint = 'extendsAttachmentEligibility field on library entry; findEligibilityExtender consumed by both validation and setup picker';
atom.evidence = {
  files: [
    'data/ability-library.json',
    'data/dc-effects.json',
    'src/game/validation.js',
    'src/handlers/setup.js',
    'src/engine/hand-ui-helpers.js',
    'tests/domain/oracle/dc-cc-attachment-eligibility-extension-probe.test.js',
    'tests/domain/oracle/dc-cc-attachment-manual-picker-gate-probe.test.js',
    'tests/domain/oracle/dc-cc-validation-errors-warnings-split-probe.test.js',
  ],
  assertions: [
    'library entry last_wielder_darksaber_bokatan declares extendsAttachmentEligibility = ["The Darksaber","[The Darksaber]"]',
    'Bo-Katan Kryze dc-effects specialAbilityIds includes last_wielder_darksaber_bokatan',
    'findEligibilityExtender(cardName, army, dcEffects) returns the DC whose passive grants access, or null',
    'parseAttachmentRestriction + getAttachmentRestriction both short-circuit their filter to accept the extender DC',
    'handleSetupAttachTo re-runs getAttachmentRestriction server-side and rejects ineligible chosen DCs',
    'validateDeckLegal returns warnings surfacing extender-only-legal attachments',
  ],
};
atom.reviewedBy = { name: 'claude-opus-4-7', date: '2026-04-20' };
atom.notes = 'Campaign slice: attachment-eligibility extension. Before this batch, the "MAUL OR SABINE WREN ONLY" restriction on The Darksaber was never enforced anywhere in src/, which made Bo-Katan\'s passive effectively a no-op — players could already attach Darksaber to anyone. This batch ships the enforcement layer AND the first extending-passive wired into it, so both sides (restriction + bypass) are correctness-tested end-to-end. Attachment-card Special Actions (Orbital Bombardment, Overwatch, Smuggler\'s Run, The Darksaber, Vader\'s Finest, Z-6 Trooper) remain unwired dispatch — separate campaign (B-slice) deferred.';

ledger._meta = {
  ...ledger._meta,
  lastManualPatch: {
    at: new Date().toISOString(),
    batch: 'dc-cc-batch-5: attachment restriction + eligibility extension',
    patched: 1,
  },
};

writeFileSync(LEDGER_PATH, JSON.stringify(ledger, null, 2) + '\n');
console.log('[dc-cc-ledger-patch-5] promoted last_wielder_darksaber_bokatan exempt → covered');
