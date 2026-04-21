/**
 * PROBE-DUBIOUS-COUNTERPARTS: Doctor Aphra's **Dubious Counterparts**.
 *
 * Card text: "After a friendly DROID resolves Missile Salvo or Invasive
 *  Procedure, that figure may perform 1 additional action. Scum DROID
 *  Deployment Cards are allowed in non-Scum armies."
 *
 * Phase 2 high-risk probe grind (2026-04-21). Atom was structural-only
 * with the trigger logic inlined at two handler call sites
 * (combat-special-effects.js Missile Salvo, dc-play-area.js Invasive
 * Procedure). Pure helpers extracted to src/game/dubious-counterparts-helpers.js.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  isAphraAlive,
  applyDubiousCounterpartsActionBump,
} from '../../../src/game/dubious-counterparts-helpers.js';

function gameWithAphra({ inList = true, hasFigure = true } = {}) {
  return {
    gameId: 'gdac',
    p1DcList: inList ? [{ dcName: 'Doctor Aphra' }, { dcName: 'BT-1' }] : [{ dcName: 'BT-1' }],
    p2DcList: [],
    figurePositions: {
      1: {
        'BT-1-1-0': 'a1',
        ...(hasFigure ? { 'Doctor Aphra-1-0': 'b2' } : {}),
      },
      2: {},
    },
  };
}

describe('PROBE-DUBIOUS-COUNTERPARTS-001: isAphraAlive requires both DC in list AND figure on board', () => {
  it('Aphra in DC list and on the board → alive', () => {
    assert.equal(isAphraAlive(gameWithAphra(), 1), true);
  });

  it('Aphra in DC list but no figure → not alive', () => {
    assert.equal(isAphraAlive(gameWithAphra({ hasFigure: false }), 1), false);
  });

  it('Aphra not in DC list → not alive (even if positions empty)', () => {
    assert.equal(isAphraAlive(gameWithAphra({ inList: false }), 1), false);
  });

  it('wrong player slot → not alive', () => {
    assert.equal(isAphraAlive(gameWithAphra(), 2), false);
  });

  it('missing figurePositions entry handled gracefully', () => {
    const g = { p1DcList: [{ dcName: 'Doctor Aphra' }], p2DcList: [] };
    assert.equal(isAphraAlive(g, 1), false);
  });

  it('missing DC list handled gracefully', () => {
    const g = { figurePositions: { 1: { 'Doctor Aphra-1-0': 'a1' } } };
    assert.equal(isAphraAlive(g, 1), false);
  });
});

describe('PROBE-DUBIOUS-COUNTERPARTS-002: action bump mirrors inline formula', () => {
  it('remaining=0, total=2 → bumped to 1 (min(3, 1))', () => {
    const a = { total: 2, remaining: 0 };
    const r = applyDubiousCounterpartsActionBump(a, 2);
    assert.equal(r, 1);
    assert.equal(a.remaining, 1);
  });

  it('remaining=1, total=2 → bumped to 2 (min(3, 2))', () => {
    const a = { total: 2, remaining: 1 };
    applyDubiousCounterpartsActionBump(a, 2);
    assert.equal(a.remaining, 2);
  });

  it('remaining=2, total=2 → bumped to 3 (cap is total+1, not total)', () => {
    const a = { total: 2, remaining: 2 };
    applyDubiousCounterpartsActionBump(a, 2);
    assert.equal(a.remaining, 3);
  });

  it('remaining=3, total=2 → stays at 3 (min(3, 4)=3)', () => {
    const a = { total: 2, remaining: 3 };
    applyDubiousCounterpartsActionBump(a, 2);
    assert.equal(a.remaining, 3);
  });

  it('no total set → uses fallback 2 → cap is 3', () => {
    const a = { remaining: 2 };
    applyDubiousCounterpartsActionBump(a, 2);
    assert.equal(a.remaining, 3);
  });

  it('fallback=DC_ACTIONS_PER_ACTIVATION (2) matches Invasive Procedure path', () => {
    const a = { remaining: 1 };
    applyDubiousCounterpartsActionBump(a, 2);
    assert.equal(a.remaining, 2);
  });

  it('null actionsData returns null (safe no-op)', () => {
    assert.equal(applyDubiousCounterpartsActionBump(null, 2), null);
  });
});

describe('PROBE-DUBIOUS-COUNTERPARTS-003: library entry wired', () => {
  it('dubious_counterparts_aphra entry exists', async () => {
    const { readFile } = await import('node:fs/promises');
    const lib = JSON.parse(await readFile(new URL('../../../data/ability-library.json', import.meta.url), 'utf8'));
    const entry = lib.abilities?.dubious_counterparts_aphra;
    assert.ok(entry, 'dubious_counterparts_aphra must exist');
    assert.match(entry.label || '', /Dubious Counterparts/);
  });
});

describe('PROBE-DUBIOUS-COUNTERPARTS-004: army validation excuses Scum DROIDs when Aphra present', () => {
  it('validateArmyAffiliation excuses Scum DROID (IG-88) when Doctor Aphra is in the army', async () => {
    const { validateArmyAffiliation } = await import('../../../src/game/validation.js');
    const squad = { dcList: ['Luke Skywalker', 'Leia Organa', 'Doctor Aphra', 'IG-88'] };
    const { warnings } = validateArmyAffiliation(squad);
    const hasIg88Warning = warnings.some((w) => w.includes('IG-88'));
    assert.equal(hasIg88Warning, false, `IG-88 should be excused; warnings: ${JSON.stringify(warnings)}`);
  });

  it('without Aphra, Scum DROID (IG-88) in Rebel army does warn', async () => {
    const { validateArmyAffiliation } = await import('../../../src/game/validation.js');
    const squad = { dcList: ['Luke Skywalker', 'Leia Organa', 'IG-88'] };
    const { warnings } = validateArmyAffiliation(squad);
    const hasIg88Warning = warnings.some((w) => w.includes('IG-88'));
    assert.equal(hasIg88Warning, true, `expected IG-88 warning; got: ${JSON.stringify(warnings)}`);
  });
});
