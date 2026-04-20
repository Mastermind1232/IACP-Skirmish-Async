/**
 * Phase-D probe: attribute-icon-gated interacts are a campaign mechanic and
 * do not appear in any skirmish mission; CRR-IACT-005 is vacuously satisfied.
 *
 * PROBE-PD-IACT-005: CRR INTERACT — "If mission rules have an attribute
 *   icon in parentheses after the target of an interact, the figure must
 *   pass the corresponding attribute test to resolve the effect."
 *
 * Implementation: no skirmish mission in `data/mission-cards.json` uses
 *   attribute-icon-gated interacts. The four IACP attribute tokens —
 *   (Tech), (Insight), (Strength), (Wisdom) — appear nowhere in the data
 *   tree. The interact handler in `src/handlers/interact.js` has no
 *   attribute-test branch either: no `attribute`, `test`, or attribute-name
 *   keywords appear in its body. CRR-ELI-004 (exempt) already pins that
 *   attribute tests are a campaign-only mechanic, and this probe confirms
 *   the skirmish scope is free of any attribute-gated interact.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '../../..');
const MC_SRC = readFileSync(resolve(ROOT, 'data/mission-cards.json'), 'utf8');
const I_SRC = readFileSync(resolve(ROOT, 'src/handlers/interact.js'), 'utf8');

describe('PROBE-PD-IACT-005: skirmish has no attribute-gated interact; rule vacuously satisfied', () => {
  it('005a: data — no skirmish mission rule contains IACP attribute-icon tokens (Tech/Insight/Strength/Wisdom)', () => {
    assert.doesNotMatch(MC_SRC, /\(Tech\)|\(Insight\)|\(Strength\)|\(Wisdom\)/,
      'no mission card may encode an attribute-icon-gated interact — CRR-IACT-005');
  });

  it('005b: data — no mission rule references an attribute-test in its interact, setup, or persistent text', () => {
    assert.doesNotMatch(MC_SRC, /attribute\s*test|attributeTest|pass.*(?:Tech|Insight|Strength|Wisdom)/i,
      'no mission may require an attribute test — CRR-IACT-005');
  });

  it('005c: source — the interact handler has no attribute-test branch (no "attribute", "Tech", "Insight" tokens)', () => {
    assert.doesNotMatch(I_SRC, /attribute|\btech\b|\binsight\b|\bstrength\b|\bwisdom\b/i,
      'src/handlers/interact.js must not branch on attribute tests — CRR-IACT-005');
  });

  it('005d: source — the interact handler resolves every legal option through getLegalInteractOptions without attribute-test gating', () => {
    assert.match(I_SRC, /getLegalInteractOptions/,
      'interact resolution must go through the legal-options helper — CRR-IACT-005');
    assert.doesNotMatch(I_SRC, /if\s*\(\s*[\w.]+test[\w.]*[\s)]/,
      'no attribute-test conditional may gate interact resolution — CRR-IACT-005');
  });

  it('005e: cross-ref — ELI-004 (attribute tests are campaign-only) pins the parent exemption; this probe pins the skirmish-scope vacuous-satisfaction', () => {
    const ledger = JSON.parse(readFileSync(resolve(ROOT, 'docs/crr-ledger.json'), 'utf8'));
    const eli004 = ledger.atoms.find(a => a.id === 'CRR-ELI-004');
    assert.ok(eli004, 'CRR-ELI-004 must exist in the ledger');
    assert.equal(eli004.status, 'exempt',
      'CRR-ELI-004 must be exempt (attribute tests are campaign-only) — CRR-IACT-005 context');
  });
});
