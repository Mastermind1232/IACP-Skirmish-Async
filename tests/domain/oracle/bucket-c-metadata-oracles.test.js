/**
 * Oracle tests for Bucket C high-confidence metadata fixes:
 *   - MHD-19: improper_procedure added to specialAbilityIds
 *   - Sentry Droid (Regular): multi_fire added to specialAbilityIds
 *
 * Also verifies invariants:
 *   - Sentry Droid (Elite) is NOT modified in this patch
 *   - Tauntaun Rider is NOT modified in this patch
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { getDcEffects, getDcStats, getAbilityLibrary } from '../../../src/data-loader.js';

const dcEffects = getDcEffects();
const abilityLib = getAbilityLibrary();

// ══════════════════════════════════════════════════════════════════════════════
// ORACLE-BC-001: MHD-19 improper_procedure metadata
// ══════════════════════════════════════════════════════════════════════════════

describe('ORACLE-BC-001: MHD-19 improper_procedure metadata', () => {
  it('001a: MHD-19 has improper_procedure in specialAbilityIds', () => {
    const eff = dcEffects['MHD-19'];
    assert.ok(eff, 'MHD-19 must exist in dc-effects.json');
    const sIds = eff.specialAbilityIds || [];
    assert.ok(sIds.includes('improper_procedure'),
      `MHD-19.specialAbilityIds must include "improper_procedure". Got: [${sIds}]`);
  });

  it('001b: MHD-19 still has medical_loadout', () => {
    const sIds = dcEffects['MHD-19'].specialAbilityIds || [];
    assert.ok(sIds.includes('medical_loadout'),
      'medical_loadout must not be displaced');
  });

  it('001c: improper_procedure exists in ability-library with wiredStatus "wired"', () => {
    const entry = abilityLib?.abilities?.['improper_procedure'];
    assert.ok(entry, 'ability-library.json must contain "improper_procedure"');
    assert.strictEqual(entry.wiredStatus, 'wired',
      `improper_procedure must have wiredStatus "wired", got "${entry.wiredStatus}"`);
  });

  it('001d: improper_procedure has targetHostileFigure shape', () => {
    const entry = abilityLib.abilities['improper_procedure'];
    assert.ok(entry.targetHostileFigure, 'improper_procedure must have targetHostileFigure');
    assert.strictEqual(entry.targetHostileFigure.damage, 1);
    assert.strictEqual(entry.targetHostileFigure.applyCondition, 'Weaken');
    assert.strictEqual(entry.targetHostileFigure.range, 1);
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// ORACLE-BC-002: MHD-19 UI reachability via getDcStats
// ══════════════════════════════════════════════════════════════════════════════

describe('ORACLE-BC-002: MHD-19 UI reachability', () => {
  it('002a: getDcStats resolves MHD-19 specials to include "Improper Procedure"', () => {
    const stats = getDcStats('MHD-19');
    assert.ok(stats, 'getDcStats must return stats for MHD-19');
    assert.ok(stats.specials.includes('Improper Procedure'),
      `MHD-19 specials should include "Improper Procedure". Got: [${stats.specials}]`);
  });

  it('002b: getDcStats resolves MHD-19 specials to include Medical Loadout', () => {
    const stats = getDcStats('MHD-19');
    assert.ok(stats.specials.some(s => s.startsWith('Medical Loadout')),
      `MHD-19 specials should include a Medical Loadout entry. Got: [${stats.specials}]`);
  });

  it('002c: MHD-19 has exactly 2 specials', () => {
    const stats = getDcStats('MHD-19');
    assert.strictEqual(stats.specials.length, 2,
      `MHD-19 should have exactly 2 specials. Got: [${stats.specials}]`);
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// ORACLE-BC-003: Sentry Droid (Regular) multi_fire metadata
// ══════════════════════════════════════════════════════════════════════════════

describe('ORACLE-BC-003: Sentry Droid (Regular) multi_fire metadata', () => {
  it('003a: Sentry Droid (Regular) has multi_fire in specialAbilityIds', () => {
    const eff = dcEffects['Sentry Droid (Regular)'];
    assert.ok(eff, 'Sentry Droid (Regular) must exist in dc-effects.json');
    const sIds = eff.specialAbilityIds || [];
    assert.ok(sIds.includes('multi_fire'),
      `Sentry Droid (Regular).specialAbilityIds must include "multi_fire". Got: [${sIds}]`);
  });

  it('003b: Sentry Droid (Regular) still has targeting_computer_sentry_reg and charged_shot_reg', () => {
    const sIds = dcEffects['Sentry Droid (Regular)'].specialAbilityIds || [];
    assert.ok(sIds.includes('targeting_computer_sentry_reg'),
      'targeting_computer_sentry_reg must not be displaced');
    assert.ok(sIds.includes('charged_shot_reg'),
      'charged_shot_reg must not be displaced');
  });

  it('003c: multi_fire exists in ability-library with wiredStatus "wired"', () => {
    const entry = abilityLib?.abilities?.['multi_fire'];
    assert.ok(entry, 'ability-library.json must contain "multi_fire"');
    assert.strictEqual(entry.wiredStatus, 'wired');
  });

  it('003d: multi_fire has multiFireDoubleAttack flag', () => {
    const entry = abilityLib.abilities['multi_fire'];
    assert.strictEqual(entry.multiFireDoubleAttack, true,
      'multi_fire must have multiFireDoubleAttack: true');
  });

  it('003e: Biv Bodhrik also uses multi_fire (reference case)', () => {
    const eff = dcEffects['Biv Bodhrik'];
    assert.ok(eff, 'Biv Bodhrik must exist');
    const sIds = eff.specialAbilityIds || [];
    assert.ok(sIds.includes('multi_fire'),
      'Biv Bodhrik should also have multi_fire (reference case)');
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// ORACLE-BC-004: Sentry Droid (Regular) UI reachability via getDcStats
// ══════════════════════════════════════════════════════════════════════════════

describe('ORACLE-BC-004: Sentry Droid (Regular) UI reachability', () => {
  it('004a: getDcStats resolves specials to include "Multi-Fire"', () => {
    const stats = getDcStats('Sentry Droid (Regular)');
    assert.ok(stats, 'getDcStats must return stats for Sentry Droid (Regular)');
    assert.ok(stats.specials.includes('Multi-Fire'),
      `Sentry Droid (Regular) specials should include "Multi-Fire". Got: [${stats.specials}]`);
  });

  it('004b: getDcStats resolves specials to include "Charged Shot"', () => {
    const stats = getDcStats('Sentry Droid (Regular)');
    assert.ok(stats.specials.includes('Charged Shot'),
      `Sentry Droid (Regular) specials should include "Charged Shot". Got: [${stats.specials}]`);
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// ORACLE-BC-005: Invariant — Sentry Droid (Elite) NOT modified
// ══════════════════════════════════════════════════════════════════════════════

describe('ORACLE-BC-005: Invariant — Sentry Droid (Elite) unchanged', () => {
  it('005a: Sentry Droid (Elite) does NOT have multi_fire in specialAbilityIds', () => {
    const eff = dcEffects['Sentry Droid (Elite)'];
    assert.ok(eff, 'Sentry Droid (Elite) must exist');
    const sIds = eff.specialAbilityIds || [];
    assert.ok(!sIds.includes('multi_fire'),
      `Sentry Droid (Elite) must NOT include "multi_fire" in this patch (pending rules confirmation). Got: [${sIds}]`);
  });

  it('005b: Sentry Droid (Elite) retains only targeting_computer_sentry_elite and charged_shot_elite', () => {
    const sIds = dcEffects['Sentry Droid (Elite)'].specialAbilityIds || [];
    assert.deepStrictEqual(sIds, ['targeting_computer_sentry_elite', 'charged_shot_elite'],
      `Sentry Droid (Elite) specialAbilityIds must be exactly the pre-patch set. Got: [${sIds}]`);
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// ORACLE-BC-006: Invariant — Tauntaun Rider NOT modified
// ══════════════════════════════════════════════════════════════════════════════

describe('ORACLE-BC-006: Invariant — Tauntaun Rider unchanged', () => {
  it('006a: Tauntaun Rider does NOT have useful_hide_tauntaun in specialAbilityIds', () => {
    const eff = dcEffects['Tauntaun Rider'];
    assert.ok(eff, 'Tauntaun Rider must exist');
    const sIds = eff.specialAbilityIds || [];
    assert.ok(!sIds.includes('useful_hide_tauntaun'),
      'Tauntaun Rider must NOT include useful_hide_tauntaun (direct-detection architecture, intentionally omitted)');
  });

  it('006b: Tauntaun Rider specialAbilityIds contains only headbutt_tauntaun', () => {
    const sIds = dcEffects['Tauntaun Rider'].specialAbilityIds || [];
    assert.deepStrictEqual(sIds, ['headbutt_tauntaun'],
      `Tauntaun Rider specialAbilityIds must be exactly ["headbutt_tauntaun"]. Got: [${sIds}]`);
  });
});
