/**
 * Oracle tests for specialAbilityIds metadata coverage (Phase 1).
 *
 * Root cause: Multiple DCs had empty or missing specialAbilityIds and passives
 * arrays. Engine code checks these arrays via .includes() — missing entries
 * cause abilities to silently not fire, same class as the Clan of Two bug.
 *
 * Phase 1 fixes (data-only):
 *   - Yoda: calming_presence_yoda, wisdom_yoda, do_or_do_not_yoda, force_deflection_yoda
 *   - The Armorer: "Beskar Armor" in passives, survival_is_strength_armorer in specialAbilityIds
 *   - The Child: force_heal in specialAbilityIds
 *   - Bantha Rider: trample_bantha in specialAbilityIds
 *   - CT-1701: barrage_ct1701 in specialAbilityIds
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { getDcEffects, getDcStats, getAbilityLibrary } from '../../../src/data-loader.js';

const dcEffects = getDcEffects();
const abilityLib = getAbilityLibrary();

// ══════════════════════════════════════════════════════════════════════════════
// HELPER: assert a DC's specialAbilityIds contains an expected ID
// ══════════════════════════════════════════════════════════════════════════════

function assertHasAbilityId(dcName, expectedId) {
  const eff = dcEffects[dcName];
  assert.ok(eff, `${dcName} must exist in dc-effects.json`);
  const sIds = eff.specialAbilityIds || [];
  assert.ok(sIds.includes(expectedId),
    `${dcName}.specialAbilityIds must include "${expectedId}". Got: [${sIds}]`);
}

function assertHasPassive(dcName, expectedPassive) {
  const eff = dcEffects[dcName];
  assert.ok(eff, `${dcName} must exist in dc-effects.json`);
  const passives = eff.passives || [];
  assert.ok(passives.includes(expectedPassive),
    `${dcName}.passives must include "${expectedPassive}". Got: [${passives}]`);
}

function assertLibraryEntryWired(abilityId) {
  const entry = abilityLib?.abilities?.[abilityId];
  assert.ok(entry, `ability-library.json must contain "${abilityId}"`);
  assert.strictEqual(entry.wiredStatus, 'wired',
    `${abilityId} must have wiredStatus "wired", got "${entry.wiredStatus}"`);
}

// ══════════════════════════════════════════════════════════════════════════════
// ORACLE-SIDS-001: Yoda metadata + reachability
// ══════════════════════════════════════════════════════════════════════════════

describe('ORACLE-SIDS-001: Yoda specialAbilityIds', () => {
  it('001a: Yoda has calming_presence_yoda in specialAbilityIds', () => {
    assertHasAbilityId('Yoda', 'calming_presence_yoda');
  });

  it('001b: Yoda has wisdom_yoda in specialAbilityIds', () => {
    assertHasAbilityId('Yoda', 'wisdom_yoda');
  });

  it('001c: Yoda has do_or_do_not_yoda in specialAbilityIds', () => {
    assertHasAbilityId('Yoda', 'do_or_do_not_yoda');
  });

  it('001d: Yoda has force_deflection_yoda in specialAbilityIds', () => {
    assertHasAbilityId('Yoda', 'force_deflection_yoda');
  });

  it('001e: All 4 Yoda abilities exist and are wired in ability-library', () => {
    for (const id of ['calming_presence_yoda', 'wisdom_yoda', 'do_or_do_not_yoda', 'force_deflection_yoda']) {
      assertLibraryEntryWired(id);
    }
  });

  it('001f: getDcStats resolves Yoda specials to UI-ready labels', () => {
    const stats = getDcStats('Yoda');
    assert.ok(stats, 'getDcStats must return stats for Yoda');
    // do_or_do_not_yoda is active (Special Action) so it should appear in specials
    // calming_presence_yoda, wisdom_yoda, force_deflection_yoda are passive-category — may be filtered
    assert.ok(stats.specials.length > 0,
      `Yoda should have at least 1 special action button. Got: [${stats.specials}]`);
    assert.ok(stats.specials.includes('Do or Do Not'),
      `Yoda specials should include "Do or Do Not". Got: [${stats.specials}]`);
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// ORACLE-SIDS-002: The Armorer metadata + reachability
// ══════════════════════════════════════════════════════════════════════════════

describe('ORACLE-SIDS-002: The Armorer passives + specialAbilityIds', () => {
  it('002a: The Armorer has "Beskar Armor" in passives', () => {
    assertHasPassive('The Armorer', 'Beskar Armor');
  });

  it('002b: The Armorer has survival_is_strength_armorer in specialAbilityIds', () => {
    assertHasAbilityId('The Armorer', 'survival_is_strength_armorer');
  });

  it('002c: survival_is_strength_armorer exists and is wired in ability-library', () => {
    assertLibraryEntryWired('survival_is_strength_armorer');
  });

  it('002d: Beskar Armor passive matches The Mandalorian reference case', () => {
    const mando = dcEffects['The Mandalorian'];
    assert.ok(mando, 'The Mandalorian must exist');
    assert.ok((mando.passives || []).includes('Beskar Armor'),
      'The Mandalorian should also have Beskar Armor in passives (reference case)');
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// ORACLE-SIDS-003: The Child metadata + reachability
// ══════════════════════════════════════════════════════════════════════════════

describe('ORACLE-SIDS-003: The Child specialAbilityIds', () => {
  it('003a: The Child has force_heal in specialAbilityIds', () => {
    assertHasAbilityId('The Child', 'force_heal');
  });

  it('003b: force_heal exists and is wired in ability-library', () => {
    assertLibraryEntryWired('force_heal');
  });

  it('003c: getDcStats resolves The Child specials to include Force Heal', () => {
    const stats = getDcStats('The Child');
    assert.ok(stats, 'getDcStats must return stats for The Child');
    assert.ok(stats.specials.includes('Force Heal'),
      `The Child specials should include "Force Heal". Got: [${stats.specials}]`);
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// ORACLE-SIDS-004: Bantha Rider metadata + reachability
// ══════════════════════════════════════════════════════════════════════════════

describe('ORACLE-SIDS-004: Bantha Rider specialAbilityIds', () => {
  it('004a: Bantha Rider has trample_bantha in specialAbilityIds', () => {
    assertHasAbilityId('Bantha Rider', 'trample_bantha');
  });

  it('004b: trample_bantha exists and is wired in ability-library', () => {
    assertLibraryEntryWired('trample_bantha');
  });

  it('004c: getDcStats resolves Bantha Rider specials to include Trample', () => {
    const stats = getDcStats('Bantha Rider');
    assert.ok(stats, 'getDcStats must return stats for Bantha Rider');
    assert.ok(stats.specials.includes('Trample'),
      `Bantha Rider specials should include "Trample". Got: [${stats.specials}]`);
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// ORACLE-SIDS-005: CT-1701 metadata + reachability
// ══════════════════════════════════════════════════════════════════════════════

describe('ORACLE-SIDS-005: CT-1701 specialAbilityIds', () => {
  it('005a: CT-1701 has barrage_ct1701 in specialAbilityIds', () => {
    assertHasAbilityId('CT-1701', 'barrage_ct1701');
  });

  it('005b: barrage_ct1701 exists and is wired in ability-library', () => {
    assertLibraryEntryWired('barrage_ct1701');
  });

  it('005c: getDcStats resolves CT-1701 specials to include Barrage', () => {
    const stats = getDcStats('CT-1701');
    assert.ok(stats, 'getDcStats must return stats for CT-1701');
    assert.ok(stats.specials.includes('Barrage'),
      `CT-1701 specials should include "Barrage". Got: [${stats.specials}]`);
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// ORACLE-SIDS-006: Schema invariant — all specialAbilityIds resolve to library
// ══════════════════════════════════════════════════════════════════════════════

describe('ORACLE-SIDS-006: Schema invariant — all specialAbilityIds resolve', () => {
  it('006a: Every specialAbilityId across all DCs resolves to an ability-library entry', () => {
    const broken = [];
    for (const [dcName, eff] of Object.entries(dcEffects)) {
      for (const id of (eff.specialAbilityIds || [])) {
        if (!abilityLib?.abilities?.[id]) {
          broken.push(`${dcName} → "${id}" (not in ability-library)`);
        }
      }
    }
    assert.strictEqual(broken.length, 0,
      `All specialAbilityIds must resolve:\n${broken.join('\n')}`);
  });

  it('006b: No DC has both empty specialAbilityIds and abilityText mentioning "Special Action"', () => {
    const issues = [];
    for (const [dcName, eff] of Object.entries(dcEffects)) {
      if (dcName.startsWith('[')) continue; // skip attachments
      const text = eff.abilityText || '';
      if (!text.toLowerCase().includes('special action')) continue;
      const sIds = eff.specialAbilityIds || [];
      const specials = eff.specials || [];
      if (sIds.length === 0 && specials.length === 0) {
        issues.push(dcName);
      }
    }
    assert.strictEqual(issues.length, 0,
      `DCs with "Special Action" in prose but no specialAbilityIds or specials:\n${issues.join(', ')}`);
  });
});
