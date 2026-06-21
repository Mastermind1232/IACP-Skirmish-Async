/**
 * Phase-D probe: companion figures and control counting.
 *
 * PROBE-PD-CMPCTRL-001: Companions that do not count for control must be
 *   excluded EVERYWHERE control is measured — including the named-area
 *   control path (getNamedAreaController in mission-rules.js), which is the
 *   one control site that previously hand-rolled its own (incomplete)
 *   exclusion set and silently counted BD-1 and J4X-7.
 *
 * Canonical predicate: board-helpers.isExcludedFromControl(game, pn, fk).
 *   - BD-1: always excluded ("Damaged Scomplink").
 *   - Salacious B. Crumb: always excluded ("[Indentured Jester]").
 *   - The Child: excluded only while game.childIncapacitated.
 *   - Dio: excluded only while Iden Versio is alive.
 *   - J4X-7: excluded only while Jarrod Kelvin is alive.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { isExcludedFromControl } from '../../../src/game/board-helpers.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '../../..');
const MR_SRC = readFileSync(resolve(ROOT, 'src/game/mission-rules.js'), 'utf8');

function gameWith(positions, flags = {}) {
  return { figurePositions: { 1: positions, 2: {} }, ...flags };
}

describe('PROBE-PD-CMPCTRL-001: companion control exclusion (canonical predicate)', () => {
  it('BD-1 is always excluded from control', () => {
    const g = gameWith({ 'BD-1-0-0': 'a1' });
    assert.equal(isExcludedFromControl(g, 1, 'BD-1-0-0'), true);
  });

  it('Salacious B. Crumb is always excluded from control', () => {
    const g = gameWith({ 'Salacious B. Crumb-0-0': 'a1' });
    assert.equal(isExcludedFromControl(g, 1, 'Salacious B. Crumb-0-0'), true);
  });

  it('The Child is excluded only while incapacitated', () => {
    const live = gameWith({ 'The Child-0-0': 'a1' });
    assert.equal(isExcludedFromControl(live, 1, 'The Child-0-0'), false);
    const incap = gameWith({ 'The Child-0-0': 'a1' }, { childIncapacitated: true });
    assert.equal(isExcludedFromControl(incap, 1, 'The Child-0-0'), true);
  });

  it('Dio is excluded only while Iden Versio is alive', () => {
    const withIden = gameWith({ 'Dio-0-0': 'a1', 'Iden Versio-1-0': 'a2' });
    assert.equal(isExcludedFromControl(withIden, 1, 'Dio-0-0'), true);
    const noIden = gameWith({ 'Dio-0-0': 'a1' });
    assert.equal(isExcludedFromControl(noIden, 1, 'Dio-0-0'), false);
  });

  it('J4X-7 is excluded only while Jarrod Kelvin is alive', () => {
    const withJarrod = gameWith({ 'J4X-7-0-0': 'a1', 'Jarrod Kelvin-1-0': 'a2' });
    assert.equal(isExcludedFromControl(withJarrod, 1, 'J4X-7-0-0'), true);
    const noJarrod = gameWith({ 'J4X-7-0-0': 'a1' });
    assert.equal(isExcludedFromControl(noJarrod, 1, 'J4X-7-0-0'), false);
  });

  it('a normal (non-companion) figure is never excluded', () => {
    const g = gameWith({ 'Stormtrooper-0-0': 'a1' });
    assert.equal(isExcludedFromControl(g, 1, 'Stormtrooper-0-0'), false);
  });

  it('source — getNamedAreaController routes through the canonical predicate (no hand-rolled set)', () => {
    // The named-area control path must call isExcludedFromControl rather than
    // maintaining its own divergent excludedNames set (regression guard:
    // the old set was missing BD-1 and J4X-7).
    assert.match(MR_SRC,
      /function getNamedAreaController\([\s\S]*?if \(isExcludedFromControl\(game, pn, fk\)\) continue;/,
      'getNamedAreaController must use board-helpers.isExcludedFromControl — CRR-CTRL-001');
    assert.doesNotMatch(MR_SRC,
      /const excludedNames = new Set/,
      'getNamedAreaController must not hand-roll its own exclusion set — CRR-CTRL-001');
  });
});
