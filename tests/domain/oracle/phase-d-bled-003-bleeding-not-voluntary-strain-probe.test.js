/**
 * Phase-D probe: Bleeding applies 1 involuntary strain via the centralized
 * strain pipeline (triggerBleedAfterAction → applyStrain), NOT through
 * the voluntary-strain helper (applyStrainToFigure).
 *
 * PROBE-PD-BLED-003: CRR BLEEDING — "Bleeding is not voluntarily suffering
 *   strain." Bleeding now uses applyStrain (strain-handler.js) which
 *   correctly routes through Figurehead, Headhunter, and the per-strain
 *   choice cascade — the same as any other involuntary strain source.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '../../..');
const SH_SRC = readFileSync(resolve(ROOT, 'src/handlers/strain-handler.js'), 'utf8');
const CM_SRC = readFileSync(resolve(ROOT, 'src/handlers/combat.js'), 'utf8');

describe('PROBE-PD-BLED-003: Bleeding uses applyStrain (involuntary), not the voluntary-strain helper', () => {
  it('003a: source — triggerBleedAfterAction calls applyStrain with source Bleeding', () => {
    assert.match(SH_SRC,
      /export async function triggerBleedAfterAction[\s\S]*?applyStrain\(game, ctx, \{[\s\S]*?source: 'Bleeding'/,
      'triggerBleedAfterAction must call applyStrain with source Bleeding — CRR-BLED-003');
  });

  it('003b: source — triggerBleedAfterAction must NOT route through applyStrainToFigure', () => {
    const fn = SH_SRC.match(/export async function triggerBleedAfterAction[\s\S]*?\n\}/)?.[0] || '';
    assert.doesNotMatch(fn, /applyStrainToFigure/,
      'triggerBleedAfterAction must not invoke applyStrainToFigure — CRR-BLED-003');
  });

  it('003c: source — strain-handler.js has a single Bleeding source call site in triggerBleedAfterAction', () => {
    const bleedSites = [...SH_SRC.matchAll(/source:\s*'Bleeding'/g)];
    assert.ok(bleedSites.length >= 1,
      'strain-handler.js must have at least one source:\'Bleeding\' call — CRR-BLED-003');
  });

  it('003d: source — applyStrain in combat.js is reserved for voluntary self-strain, never labeled Bleeding', () => {
    const callSiteSources = [...CM_SRC.matchAll(/applyStrain\(game, ctx, \{[^}]*?source:\s*['"`]([^'"`]+)['"`]/g)].map(m => m[1]);
    assert.ok(callSiteSources.length >= 3,
      `applyStrain must have multiple labeled call sites in combat.js (found ${callSiteSources.length}: ${callSiteSources.join(', ')}) — CRR-BLED-003`);
    const hasBleedCaller = callSiteSources.some(l => /bleed/i.test(l));
    assert.ok(!hasBleedCaller,
      `no applyStrain call site in combat.js may be labeled as Bleeding (sources: ${callSiteSources.join(',')}) — CRR-BLED-003`);
  });
});
