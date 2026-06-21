/**
 * Phase-D probe: when an effect reduces a figure's Health and the figure has
 * suffered more damage than the resulting Health, the excess damage is
 * discarded (no effect carries forward).
 *
 * PROBE-PD-DMG-008: CRR DAMAGE — "If an effect reduces a figure's Health and
 *   it has suffered more damage than the resulting Health, the excess
 *   damage is discarded and has no effect."
 *
 * Implementation: in skirmish, the SOLE effect that reduces a figure's
 *   Health (max HP) is the end-of-round Adrenaline revert in
 *   `src/handlers/round.js`. Adrenaline's spec (combat-spec.csv:528) ONLY
 *   grants "+5 Health to each of your WOOKIEEs during this round" — there is
 *   NO damage clause, so the end-of-round revert must NOT deal damage and
 *   must NOT defeat the figure. The revert enforces the CRR-DMG-008 discard
 *   invariant through a clamp on the health tuple:
 *     1. newMax = Math.max(0, maxHp - 5)     — Health-reduction floor
 *     2. newCur = Math.min(curHp, newMax)    — current is bounded by the
 *        RESULTING Health; HP that no longer fits under the lowered max is
 *        discarded (cannot carry excess onto the tuple), but no damage is
 *        dealt and no figure is defeated.
 *   No other source file mutates maxHp downward, so the CRR-DMG-008
 *   discard invariant has a single enforcement site.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '../../..');
const R_SRC = readFileSync(resolve(ROOT, 'src/handlers/round.js'), 'utf8');

function* walkFiles(dir) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) yield* walkFiles(p);
    else if (p.endsWith('.js')) yield p;
  }
}

describe('PROBE-PD-DMG-008: Health reduction discards excess HP without dealing damage', () => {
  it('008a: source — Adrenaline revert reduces maxHp with a non-negative floor (newMax = Math.max(0, maxHp - 5))', () => {
    assert.match(R_SRC,
      /const newMax = Math\.max\(0, maxHp - 5\);/,
      'max-HP reduction must be clamped to ≥ 0 — CRR-DMG-008');
  });

  it('008b: source — current HP is clamped to the new max after reduction (newCur = Math.min(curHp, newMax))', () => {
    assert.match(R_SRC,
      /const newCur = Math\.min\(curHp, newMax\);/,
      'current HP must be clamped to the resulting Health (no damage) — CRR-DMG-008');
  });

  it('008c: source — the Adrenaline revert deals NO damage (spec: +5 Health only, no damage clause)', () => {
    // The fixed revert must not subtract a flat 5 from current HP.
    const adrIdx = R_SRC.indexOf('Adrenaline: at end of round');
    assert.ok(adrIdx >= 0, 'Adrenaline revert block must be present');
    const block = R_SRC.slice(adrIdx, adrIdx + 1500);
    assert.ok(!/Suffer 5 damage|curHp - 5/.test(block),
      'Adrenaline must NOT deal 5 damage on revert — CRR-DMG-008 / spec is +5 Health only');
  });

  it('008d: source — the Adrenaline revert does NOT defeat figures (no processFigureDefeat in the block)', () => {
    const adrIdx = R_SRC.indexOf('Adrenaline: at end of round');
    const block = R_SRC.slice(adrIdx, adrIdx + 1500);
    assert.ok(!/processFigureDefeat/.test(block),
      'Adrenaline revert must not defeat figures — the card never harms your WOOKIEEs');
  });

  it('008f: source — Adrenaline in round.js is the sole code site that reduces maxHp anywhere in src/', () => {
    const hits = [];
    for (const p of walkFiles(resolve(ROOT, 'src'))) {
      const src = readFileSync(p, 'utf8');
      if (/Math\.max\(0,\s*maxHp\s*-/.test(src)) hits.push(p.replace(ROOT + '/', ''));
    }
    assert.deepEqual(hits, ['src/handlers/round.js'],
      'only round.js may reduce maxHp — CRR-DMG-008 single enforcement site');
  });
});
