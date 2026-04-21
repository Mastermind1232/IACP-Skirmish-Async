/**
 * Oracle: the manual-picker server-side re-check (handleSetupAttachTo) must
 * reject an "X ONLY" attachment when the chosen DC does not satisfy the
 * restriction — even if a crafted Discord interaction bypasses the filtered
 * dropdown. The check delegates to `getAttachmentRestriction(...).filter`,
 * so these probes pin the filter's accept/reject behavior for a representative
 * "LEADER ONLY" attachment:
 *
 *   1. "[Advanced Com Systems]" (LEADER ONLY) — filter accepts a LEADER DC.
 *   2. Same card — filter rejects a non-LEADER, non-extender DC.
 *   3. Eligibility extension still applies through this filter path:
 *      "The Darksaber" (MAUL OR SABINE WREN ONLY) — filter accepts
 *      Bo-Katan Kryze only when she is in the army.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { getAttachmentRestriction } from '../../../src/handlers/setup.js';

describe('DC-CC: manual attachment picker gate — server-side restriction re-check', () => {
  it('LEADER ONLY attachment: filter accepts a LEADER DC', () => {
    const r = getAttachmentRestriction('[Advanced Com Systems]');
    assert.ok(r, 'expected restriction for LEADER ONLY attachment');
    assert.equal(r.filter('Gideon Argus'), true);
  });

  it('LEADER ONLY attachment: filter rejects a non-LEADER DC', () => {
    const r = getAttachmentRestriction('[Advanced Com Systems]');
    assert.ok(r);
    assert.equal(r.filter('Rebel Trooper (Elite)'), false);
  });

  it('Darksaber: filter accepts Bo-Katan Kryze via eligibility extension', () => {
    const r = getAttachmentRestriction('[The Darksaber]', ['Bo-Katan Kryze', 'Rebel Trooper (Elite)']);
    assert.ok(r);
    assert.equal(r.extenderDcName, 'Bo-Katan Kryze');
    assert.equal(r.filter('Bo-Katan Kryze'), true);
  });

  it('Darksaber: filter rejects Bo-Katan Kryze when she is not in the army', () => {
    const r = getAttachmentRestriction('[The Darksaber]', ['Rebel Trooper (Elite)', 'Gideon Argus']);
    assert.ok(r);
    assert.equal(r.extenderDcName, null);
    assert.equal(r.filter('Bo-Katan Kryze'), false);
  });
});
