/**
 * Phase-D probes: Move-action MP-grant invariant.
 *
 * PROBE-PD-MOVE-004: Performing a Move action grants MP equal to the figure's
 *   Speed attribute. (CRR MOVE ACTION)
 *   The Move-action entry-point in src/handlers/dc-play-area.js computes
 *   `speed = getEffectiveSpeed(...)` and seeds the movement bank's `total`
 *   and `mpRemaining` with that value before applying any bonus MP (Vanish,
 *   General's Ranks). getEffectiveSpeed itself reads the figure's stat-line
 *   Speed attribute (src/game/board-helpers.js).
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { getEffectiveSpeed } from '../../../src/game/board-helpers.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..', '..', '..');

describe('PROBE-PD-MOVE-004: Move-action grants MP equal to Speed', () => {
  it('004a: dc-play-area Move branch computes speed = getEffectiveSpeed and seeds the per-figure bank total with it', () => {
    const src = readFileSync(join(ROOT, 'src/handlers/dc-play-area.js'), 'utf8');
    const getSpeedIdx = src.indexOf('const speed = getEffectiveSpeed(meta.dcName, figureKey, game, playerNum);');
    assert.ok(getSpeedIdx > 0,
      'Move-action handler must derive grant amount from getEffectiveSpeed — CRR-MOVE-004');
    const tail = src.slice(getSpeedIdx, getSpeedIdx + 2000);
    assert.ok(tail.includes('mpRemaining = currentMp + speed'),
      'Move-action handler must add speed to current MP — CRR-MOVE-004');
    // Per alexanbv 2026-06-13: MP is STRICTLY per-figure — there is no
    // shared/top-level group bank. The Move grant writes the speed into
    // the activating figure's perFig[figureIndex] sub-bank (both the
    // running remaining and the accumulating total). Confirm both writes.
    assert.ok(tail.includes('_top.perFig[figureIndex].remaining = mpRemaining'),
      'Move-action handler must seed perFig[figureIndex].remaining with currentMp + speed — CRR-MOVE-004');
    assert.ok(tail.includes('_top.perFig[figureIndex].total = (_top.perFig[figureIndex].total ?? 0) + speed'),
      'Move-action handler must accumulate speed into perFig[figureIndex].total — CRR-MOVE-004');
  });

  it('004b: getEffectiveSpeed returns the DC stat-line speed when no modifiers apply', () => {
    // Stormtrooper speed is 4 in dc-stats; Cassian Andor is 4, Luke 5.
    const game = { figureContraband: {}, figureStrained: {} };
    const trooperSpeed = getEffectiveSpeed('Stormtrooper (Elite)', 'Stormtrooper (Elite)-1-0', game, 1);
    assert.ok(typeof trooperSpeed === 'number' && trooperSpeed > 0,
      `getEffectiveSpeed returned a usable speed number: ${trooperSpeed}`);
  });
});
