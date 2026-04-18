/**
 * CRR Ledger completeness certification.
 *
 * PILOT SCOPE (2026-04-17):
 *   - Runs against docs/crr-ledger.json atoms only.
 *   - Does NOT fail because other CRR sections are unatomized.
 *   - Every seededSections entry in _meta must have at least one atom.
 *   - Every atom must pass scripts/ledger-validate.js checks.
 *
 * Scaling beyond the pilot: when Phase C atomization proceeds, add each
 * newly-covered section name to _meta.seededSections; that expands the
 * completeness surface without touching this test.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { validateLedger } from '../../scripts/ledger-validate.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '../..');
const LEDGER_PATH = resolve(ROOT, 'docs/crr-ledger.json');

describe('CRR ledger completeness (pilot-scoped)', () => {
  const ledger = JSON.parse(readFileSync(LEDGER_PATH, 'utf8'));

  it('ledger is declared pilot-scoped to skirmish mode', () => {
    assert.equal(ledger._meta.scope, 'skirmish',
      'Ledger scope must be skirmish — other modes are out of scope for this bot.');
    assert.equal(ledger._meta.pilot, true,
      'Phase-A pilot flag must be explicit so reviewers do not mistake this for full CRR coverage.');
  });

  it('_meta.seededSections is a non-empty string array', () => {
    assert.ok(Array.isArray(ledger._meta.seededSections), 'seededSections must be an array');
    assert.ok(ledger._meta.seededSections.length > 0, 'seededSections must not be empty');
    for (const s of ledger._meta.seededSections) {
      assert.equal(typeof s, 'string', 'seededSections entries must be strings');
    }
  });

  it('every seededSections entry has at least one atom in the ledger', () => {
    const sectionCounts = new Map();
    for (const atom of ledger.atoms) {
      const s = atom.crr?.section;
      sectionCounts.set(s, (sectionCounts.get(s) || 0) + 1);
    }
    for (const sectionName of ledger._meta.seededSections) {
      const count = sectionCounts.get(sectionName) || 0;
      assert.ok(count > 0,
        `seededSections entry '${sectionName}' has no atoms — seed it or remove from seededSections.`);
    }
  });

  it('validator passes with zero errors for every atom in the ledger', () => {
    const { ok, errors, warnings, atomCount } = validateLedger({ updateShas: false });
    if (!ok) {
      const msg = errors.join('\n  ');
      assert.fail(
        `CRR ledger validator failed for ${errors.length} atom issue(s):\n  ${msg}\n\n` +
        `Warnings: ${warnings.length}. Total atoms: ${atomCount}. ` +
        `Fix the atoms or rerun UPDATE_CRR_LEDGER=1 to backfill SHAs.`
      );
    }
    assert.ok(ok, 'validator must pass');
  });

  it('every covered atom pins at least one assertion substring grep-findable in its evidence files', () => {
    // This property is enforced by validateLedger, but we re-state it as its own
    // assertion so that regressions surface with a readable failure message.
    const covered = ledger.atoms.filter((a) => a.status === 'covered');
    assert.ok(covered.length > 0, 'pilot must seed at least one covered atom');
    for (const atom of covered) {
      assert.ok(
        Array.isArray(atom.evidence?.assertions) && atom.evidence.assertions.length > 0,
        `${atom.id}: covered atom missing evidence.assertions`
      );
      assert.ok(
        Array.isArray(atom.evidence?.files) && atom.evidence.files.length > 0,
        `${atom.id}: covered atom missing evidence.files`
      );
      assert.ok(
        atom.reviewedBy?.name && atom.reviewedBy?.date,
        `${atom.id}: covered atom missing reviewedBy`
      );
    }
  });

  it('every covered_by_ref atom has non-empty seeAlso', () => {
    const refs = ledger.atoms.filter((a) => a.status === 'covered_by_ref');
    for (const atom of refs) {
      assert.ok(Array.isArray(atom.seeAlso) && atom.seeAlso.length > 0,
        `${atom.id}: covered_by_ref must have seeAlso`);
    }
  });

  it('atom IDs are unique', () => {
    const seen = new Set();
    for (const atom of ledger.atoms) {
      assert.ok(!seen.has(atom.id), `duplicate atom id: ${atom.id}`);
      seen.add(atom.id);
    }
  });
});
