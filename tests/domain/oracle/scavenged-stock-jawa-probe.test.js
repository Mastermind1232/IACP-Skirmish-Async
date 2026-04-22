/**
 * PROBE-SCAVENGED-STOCK: Jawa Scavenger (Elite)'s **Scavenged Stock**.
 *
 * Card text: "Your army may include up to 3 DROID cards from other
 *  affiliations."
 *
 * Phase 2 high-risk probe grind (2026-04-21). Atom was structural-only
 * with the excusal loop inlined in validateArmyAffiliation. Pure helper
 * extracted to src/game/scavenged-stock-helpers.js.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  scavengedStockExcusals,
  SCAVENGED_STOCK_JAWA_NAME,
  SCAVENGED_STOCK_MAX,
} from '../../../src/game/scavenged-stock-helpers.js';
import { validateArmyAffiliation } from '../../../src/game/validation.js';

function dc(name, affiliation, keywords = []) {
  return { name, affiliation, keywords };
}

describe('PROBE-SCAVENGED-STOCK-001: constants', () => {
  it('exported canonical name', () => {
    assert.equal(SCAVENGED_STOCK_JAWA_NAME, 'Jawa Scavenger (Elite)');
  });
  it('exported max = 3', () => {
    assert.equal(SCAVENGED_STOCK_MAX, 3);
  });
});

describe('PROBE-SCAVENGED-STOCK-002: scavengedStockExcusals predicate', () => {
  it('excuses Imperial DROID in a Scum army', () => {
    const resolved = [
      dc('Jawa Scavenger (Elite)', 'Scum'),
      dc('IG-88', 'Scum', ['DROID']),
      dc('Probe Droid', 'Imperial', ['DROID']),
    ];
    const out = scavengedStockExcusals(resolved, 'Scum');
    assert.deepStrictEqual(out, ['Probe Droid']);
  });

  it('caps at 3 even when 5 cross-affiliation DROID DCs are present', () => {
    const resolved = [
      dc('Jawa Scavenger (Elite)', 'Scum'),
      dc('IG-88', 'Imperial', ['DROID']),
      dc('4-LOM', 'Imperial', ['DROID']),
      dc('HK-47', 'Imperial', ['DROID']),
      dc('R2-D2', 'Rebel', ['DROID']),
      dc('C-3PO', 'Rebel', ['DROID']),
    ];
    const out = scavengedStockExcusals(resolved, 'Scum');
    assert.equal(out.length, SCAVENGED_STOCK_MAX);
    assert.deepStrictEqual(out, ['IG-88', '4-LOM', 'HK-47']);
  });

  it('skips non-DROID cross-affiliation DCs', () => {
    const resolved = [
      dc('Jawa Scavenger (Elite)', 'Scum'),
      dc('Stormtrooper (Regular)', 'Imperial', ['TROOPER']),
      dc('Probe Droid', 'Imperial', ['DROID']),
    ];
    const out = scavengedStockExcusals(resolved, 'Scum');
    assert.deepStrictEqual(out, ['Probe Droid']);
  });

  it('skips same-affiliation DROIDs (no excuse needed)', () => {
    const resolved = [
      dc('Jawa Scavenger (Elite)', 'Scum'),
      dc('IG-88', 'Scum', ['DROID']),
    ];
    const out = scavengedStockExcusals(resolved, 'Scum');
    assert.deepStrictEqual(out, []);
  });

  it('skips Any-affiliation DCs (already universally legal)', () => {
    const resolved = [
      dc('Jawa Scavenger (Elite)', 'Scum'),
      dc('Mercenary Droid', 'Any', ['DROID']),
    ];
    const out = scavengedStockExcusals(resolved, 'Scum');
    assert.deepStrictEqual(out, []);
  });

  it('skips DCs already in alreadyExcused (budget preserved)', () => {
    const resolved = [
      dc('Jawa Scavenger (Elite)', 'Scum'),
      dc('IG-88', 'Imperial', ['DROID']),
      dc('4-LOM', 'Imperial', ['DROID']),
      dc('HK-47', 'Imperial', ['DROID']),
      dc('C-3PO', 'Rebel', ['DROID']),
    ];
    const already = new Set(['IG-88']); // e.g., excused by another ability
    const out = scavengedStockExcusals(resolved, 'Scum', already);
    // Budget of 3 applied to remaining: 4-LOM, HK-47, C-3PO
    assert.deepStrictEqual(out, ['4-LOM', 'HK-47', 'C-3PO']);
  });

  it('empty / missing inputs handled safely', () => {
    assert.deepStrictEqual(scavengedStockExcusals([], 'Scum'), []);
    assert.deepStrictEqual(scavengedStockExcusals(null, 'Scum'), []);
    assert.deepStrictEqual(scavengedStockExcusals([dc('X', 'Scum', ['DROID'])], null), []);
  });

  it('DROID keyword match is case-insensitive', () => {
    const resolved = [
      dc('Jawa Scavenger (Elite)', 'Scum'),
      dc('Probe Droid', 'Imperial', ['droid']),
      dc('Other', 'Imperial', ['Droid']),
    ];
    const out = scavengedStockExcusals(resolved, 'Scum');
    assert.deepStrictEqual(out, ['Probe Droid', 'Other']);
  });

  it('preserves resolved order in excusal list', () => {
    const resolved = [
      dc('Jawa Scavenger (Elite)', 'Scum'),
      dc('C-3PO', 'Rebel', ['DROID']),
      dc('IG-88', 'Imperial', ['DROID']),
    ];
    const out = scavengedStockExcusals(resolved, 'Scum');
    assert.deepStrictEqual(out, ['C-3PO', 'IG-88']);
  });
});

describe('PROBE-SCAVENGED-STOCK-003: library entry wired', () => {
  it('scavenged_stock_jawa_elite entry exists and is wired', async () => {
    const { readFile } = await import('node:fs/promises');
    const lib = JSON.parse(
      await readFile(new URL('../../../data/ability-library.json', import.meta.url), 'utf8'),
    );
    const entry = lib.abilities?.scavenged_stock_jawa_elite;
    assert.ok(entry);
    assert.equal(entry.wiredStatus, 'wired');
    assert.equal(entry.label, 'Scavenged Stock');
  });

  it('dc-effects.json wires Jawa Scavenger (Elite) to scavenged_stock_jawa_elite', async () => {
    const { readFile } = await import('node:fs/promises');
    const effects = JSON.parse(
      await readFile(new URL('../../../data/dc-effects.json', import.meta.url), 'utf8'),
    );
    const jawa = effects.cards?.['Jawa Scavenger (Elite)'];
    assert.ok(jawa, 'Jawa Scavenger (Elite) DC must exist');
    assert.ok(
      (jawa.specialAbilityIds || []).includes('scavenged_stock_jawa_elite'),
      'Jawa Scavenger (Elite) must reference scavenged_stock_jawa_elite',
    );
  });
});

describe('PROBE-SCAVENGED-STOCK-004: validateArmyAffiliation integration', () => {
  // With Jawa Scavenger (Elite) in a Scum army, three cross-affiliation DROID
  // DCs should NOT produce an off-affiliation warning. Without the Jawa, the
  // same DCs SHOULD produce warnings.

  // Scum majority = Jawa + 4-LOM + HK-47 + IG-88 (4 Scum DCs).
  // Cross-affiliation DROIDs: Imperial (Probe Droid (Elite), BT-1, 0-0-0) and Rebel (R2-D2).

  it('Scum army with Jawa (Elite) + 3 Imperial DROIDs: no affiliation warning for those DROIDs', () => {
    const { primaryAffiliation, warnings } = validateArmyAffiliation({
      dcList: [
        'Jawa Scavenger (Elite)',
        '4-LOM',
        'HK-47',
        'IG-88',
        'Probe Droid (Elite)',
        'BT-1',
        '0-0-0',
      ],
    });
    assert.equal(primaryAffiliation, 'Scum');
    const offAffil = warnings.filter(
      (w) => /affiliation/i.test(w) && /(Probe Droid|BT-1|0-0-0)/.test(w),
    );
    assert.equal(
      offAffil.length,
      0,
      `expected no off-affiliation warnings for Imperial DROIDs; got: ${JSON.stringify(warnings)}`,
    );
  });

  it('Scum army WITHOUT Jawa (Elite): Imperial DROID produces an affiliation warning', () => {
    const { primaryAffiliation, warnings } = validateArmyAffiliation({
      dcList: ['4-LOM', 'HK-47', 'IG-88', 'Probe Droid (Elite)'],
    });
    assert.equal(primaryAffiliation, 'Scum');
    const offAffil = warnings.find((w) => /Probe Droid/.test(w));
    assert.ok(
      offAffil,
      `expected off-affiliation warning for Probe Droid; got: ${JSON.stringify(warnings)}`,
    );
  });

  it('Scum army with Jawa (Elite) + 4 cross-affiliation DROIDs: 4th still warns (cap=3)', () => {
    const { primaryAffiliation, warnings } = validateArmyAffiliation({
      dcList: [
        'Jawa Scavenger (Elite)',
        '4-LOM',
        'HK-47',
        'IG-88',
        'Probe Droid (Elite)',
        'BT-1',
        '0-0-0',
        'R2-D2',
      ],
    });
    assert.equal(primaryAffiliation, 'Scum');
    // Three Imperial DROIDs fill the Scavenged Stock budget; R2-D2 (Rebel DROID)
    // should still produce an off-affiliation warning naming it.
    const r2 = warnings.find((w) => /R2-D2/.test(w));
    assert.ok(
      r2,
      `expected 4th cross-affiliation DROID to warn; got: ${JSON.stringify(warnings)}`,
    );
  });
});
