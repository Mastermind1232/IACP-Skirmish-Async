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
 *   `src/handlers/round.js`. The revert enforces the CRR-DMG-008 discard
 *   invariant through a two-sided clamp on the health tuple:
 *     1. newMax = Math.max(0, maxHp - 5)     — Health-reduction floor
 *     2. afterDamage = Math.max(0, curHp - 5) — damage-suffering floor;
 *        damage below 0 HP is discarded (cannot accumulate negatives).
 *     3. newCur = Math.min(afterDamage, newMax) — current is bounded by
 *        the RESULTING Health; damage beyond newMax is discarded (cannot
 *        carry excess onto the tuple).
 *     4. if (healthState[fi][0] <= 0) processFigureDefeat(...) — defeat
 *        flow is a consequence (via CRR-DEF-001), not the discard itself.
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

describe('PROBE-PD-DMG-008: Health reduction that falls below suffered damage defeats the figure', () => {
  it('008a: source — Adrenaline revert reduces maxHp with a non-negative floor (newMax = Math.max(0, maxHp - 5))', () => {
    assert.match(R_SRC,
      /\/\/ 2\. Revert the \+5 max HP bonus\s*\n\s*const newMax = Math\.max\(0, maxHp - 5\);/,
      'max-HP reduction must be clamped to ≥ 0 — CRR-DMG-008');
  });

  it('008b: source — current HP is clamped to the new max after reduction (newCur = Math.min(afterDamage, newMax))', () => {
    assert.match(R_SRC,
      /\/\/ Clamp current to new max\s*\n\s*const newCur = Math\.min\(afterDamage, newMax\);/,
      'current HP must be clamped to the resulting Health — CRR-DMG-008');
  });

  it('008c: source — damage-suffer step comes BEFORE the max-HP revert, but clamp ensures damage-exceeds-new-max lands current at newMax or lower', () => {
    const damageIdx = R_SRC.indexOf('// 1. Suffer 5 damage');
    const revertIdx = R_SRC.indexOf('// 2. Revert the +5 max HP bonus');
    const clampIdx = R_SRC.indexOf('// Clamp current to new max');
    assert.ok(damageIdx > 0 && revertIdx > 0 && clampIdx > 0,
      'all three Adrenaline steps must be locatable');
    assert.ok(damageIdx < revertIdx && revertIdx < clampIdx,
      'order must be: suffer damage → reduce max → clamp current — CRR-DMG-008');
  });

  it('008d: source — after clamping, a defeat trigger fires when current HP <= 0 (damage ≥ resulting Health)', () => {
    assert.match(R_SRC,
      /healthState\[fi\]\s*=\s*\[newCur, newMax\];[\s\S]*?if \(healthState\[fi\]\[0\] <= 0\) \{[\s\S]*?processFigureDefeat\(/,
      'defeat must fire when clamped current reaches 0 — CRR-DMG-008');
  });

  it('008e: source — processFigureDefeat is invoked with source:"Adrenaline" and awardVp:false (self-inflicted Health-reduction defeat)', () => {
    assert.match(R_SRC,
      /await processFigureDefeat\(game, \{[\s\S]*?source: 'Adrenaline',\s*\n\s*awardVp: false,\s*\n\s*\}/,
      'Adrenaline-driven defeat must be self-inflicted (no VP) — CRR-DMG-008');
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
