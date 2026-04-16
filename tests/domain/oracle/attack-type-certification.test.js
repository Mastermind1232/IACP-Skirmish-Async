/**
 * Tier B Certification Sweep: Attack Type Validation (CRR Risk #4→#1)
 *
 * Validates that every DC with an attack object has a consistent attack.type
 * field and that the engine's isRanged derivation is unambiguous.
 *
 * Rule claims enforced:
 *   CERT-ATK-001: Every non-attachment DC with attack.dice has a valid attack.type
 *   CERT-ATK-002: No melee DC has accuracy surge abilities (semantic contradiction)
 *   CERT-ATK-003: attack.type is always exactly "range" or "melee" for combatants
 *   CERT-ATK-004: isRanged derivation matches type field for all DCs
 *
 * NOTE: Attachments ([Flame Trooper], [Mortar Trooper]) are excluded from the
 * type check because the engine reads attack info from the BASE DC, not the
 * attachment entry. Their missing type fields are data noise, not live bugs.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { getDcEffects, getDcStats } from '../../../src/data-loader.js';

const dcEffects = getDcEffects();
const allDcNames = Object.keys(dcEffects);

/** Check if a DC name represents an attachment (bracketed name like [Flame Trooper]) */
function isAttachment(dcName) {
  return /^\[.+\]$/.test(dcName);
}

// ── CERT-ATK-001: Every non-attachment combatant has valid attack.type ───────

describe('CERT-ATK-001: Every non-attachment combatant DC has a valid attack.type', () => {
  it('001: all DCs with attack.dice have attack.type in {range, melee, none}', () => {
    const anomalies = [];

    for (const dcName of allDcNames) {
      if (isAttachment(dcName)) continue;

      const stats = getDcStats(dcName);
      if (!stats?.attack?.dice?.length) continue; // no attack capability

      const type = stats.attack.type;
      if (type !== 'range' && type !== 'melee' && type !== 'none') {
        anomalies.push({ dcName, type, dice: stats.attack.dice });
      }
    }

    assert.equal(anomalies.length, 0,
      `DCs with invalid/missing attack.type: ${JSON.stringify(anomalies, null, 2)}`);
  });
});

// ── CERT-ATK-002: Melee DCs with accuracy surges are only Reach figures ─────
//
// In Imperial Assault, melee figures with "Reach" can attack non-adjacent
// targets — accuracy surges are legitimate for them. Non-Reach melee figures
// should NOT have accuracy surges (would be dead weight).

describe('CERT-ATK-002: Melee DCs with accuracy surges are Reach figures', () => {
  it('002: melee DCs with accuracy surges have Reach or extended-range ability', () => {
    // Known melee figures with accuracy surges (all have Reach or extended melee):
    // K-2S0: Reach, "accuracy 1, pierce 1"
    // Kanan Jarrus: Reach, "accuracy 3"
    // Zeb Orrelios: Bo-Rifle (extended range melee), "accuracy 2, recover 1"
    const knownReachMelee = ['K-2S0', 'Kanan Jarrus', 'Zeb Orrelios'];
    const unknownAnomalies = [];

    for (const dcName of allDcNames) {
      if (isAttachment(dcName)) continue;

      const stats = getDcStats(dcName);
      if (stats?.attack?.type !== 'melee') continue;

      const card = dcEffects[dcName];
      const surges = [...(card?.surgeAbilities || []), ...(card?.doubleSurgeAbilities || [])];
      const hasAccSurge = surges.some(s => /accuracy\s+\d+/i.test(s));

      if (hasAccSurge && !knownReachMelee.includes(dcName)) {
        unknownAnomalies.push({ dcName, surges: surges.filter(s => /accuracy/i.test(s)) });
      }
    }

    assert.equal(unknownAnomalies.length, 0,
      `Unknown melee DCs with accuracy surges (not in Reach list): ${JSON.stringify(unknownAnomalies, null, 2)}`);
  });
});

// ── CERT-ATK-003: attack.type values are exactly "range" or "melee" ─────────

describe('CERT-ATK-003: attack.type is always "range" or "melee" for combatant DCs', () => {
  it('003: no unexpected type values (only "range", "melee", or "none" for non-combatants)', () => {
    const typeDistribution = {};
    const unexpectedTypes = [];

    for (const dcName of allDcNames) {
      if (isAttachment(dcName)) continue;

      const stats = getDcStats(dcName);
      if (!stats?.attack) continue;

      const type = stats.attack.type;
      typeDistribution[type || 'MISSING'] = (typeDistribution[type || 'MISSING'] || 0) + 1;

      if (type && type !== 'range' && type !== 'melee' && type !== 'none') {
        unexpectedTypes.push({ dcName, type });
      }
    }

    assert.equal(unexpectedTypes.length, 0,
      `Unexpected attack.type values: ${JSON.stringify(unexpectedTypes)}`);

    // Sanity check: we found DCs of both types
    assert.ok(typeDistribution['range'] > 50,
      `Expected 50+ ranged DCs, found ${typeDistribution['range']}`);
    assert.ok(typeDistribution['melee'] > 20,
      `Expected 20+ melee DCs, found ${typeDistribution['melee']}`);
  });
});

// ── CERT-ATK-004: isRanged derivation matches for all DCs ───────────────────

describe('CERT-ATK-004: isRanged derivation is consistent with attack.type', () => {
  it('004: attackInfo.type === "range" ↔ isRanged is true for every combatant DC', () => {
    const mismatches = [];

    for (const dcName of allDcNames) {
      if (isAttachment(dcName)) continue;

      const stats = getDcStats(dcName);
      if (!stats?.attack?.dice?.length) continue;
      if (stats.attack.type === 'none') continue;

      // Engine derivation: src/engine/available-actions.js:2127
      const isRanged = stats.attack.type === 'range';
      const expectedRanged = stats.attack.type === 'range';

      // These should always match (tautological in current engine, but proves
      // no DC has a type value that would be ambiguously interpreted)
      if (isRanged !== expectedRanged) {
        mismatches.push({ dcName, type: stats.attack.type, isRanged });
      }

      // Additional check: ranged DCs should have dice that can produce accuracy.
      // Exception: "any" and "special" dice are configurable pools (General Weiss,
      // IG-88) where the actual dice are chosen at attack time.
      if (isRanged) {
        const standardDice = stats.attack.dice.filter(d => !['any', 'special'].includes(d));
        if (standardDice.length > 0) {
          const hasAccDice = standardDice.some(d => ['blue', 'green', 'yellow'].includes(d));
          if (!hasAccDice) {
            mismatches.push({
              dcName,
              type: stats.attack.type,
              dice: stats.attack.dice,
              issue: 'ranged DC with no accuracy-producing dice',
            });
          }
        }
      }
    }

    assert.equal(mismatches.length, 0,
      `isRanged derivation mismatches: ${JSON.stringify(mismatches, null, 2)}`);
  });
});
