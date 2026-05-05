/**
 * CRR-COND-HIDDEN: a Hidden attacker applies +1 Damage to the attack
 * results.
 *
 * Source: canonical IACP Hidden condition card —
 *   "While defending, apply -2 Accuracy to the attack results.
 *    While attacking, apply +1 [Damage] to the attack results.
 *    After you resolve an attack, you must discard this condition."
 *   (verified against vassal_extracted/images/conditions/Condition card--Hidden.jpg)
 *
 * IACP CRR p.34 paraphrases this as "+1 while attacking" without naming
 * the symbol; the card image is authoritative.
 *
 * Pre-fix audit 2026-05-05: handlers/combat.js incorrectly applied +1
 * Surge for Hidden attackers (commented "Hidden on attacker: +1 surge").
 * Fixed by adding +1 Damage in computeCombatResult and removing the
 * wrong +1 Surge line.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { computeCombatResult } from '../../../src/game/combat.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '../../..');
const COMBAT_SRC = readFileSync(resolve(ROOT, 'src/game/combat.js'), 'utf8');
const HCOMBAT_SRC = readFileSync(resolve(ROOT, 'src/handlers/combat.js'), 'utf8');

function makeCombat(overrides = {}) {
  return {
    attackRoll: { acc: 0, dmg: 2, surge: 0 },
    defenseRoll: { block: 0, evade: 0, dodge: false },
    surgeDamage: 0, surgePierce: 0, surgeAccuracy: 0,
    attackerConds: [],
    defenderConds: [],
    isRanged: false,
    ...overrides,
  };
}

describe('CRR-COND-HIDDEN: Hidden attacker applies +1 Damage', () => {
  it('source — computeCombatResult adds +1 Damage when attacker has Hide', () => {
    const body = COMBAT_SRC.match(/export function computeCombatResult\([\s\S]*?\n\}/);
    assert.ok(body, 'computeCombatResult body locatable');
    assert.match(body[0], /attackerConds\?\.includes\(['"]Hide['"]\)/,
      'must check attackerConds for Hide — CRR-COND-HIDDEN');
    assert.match(body[0], /hiddenDmgBonus/,
      'must apply hiddenDmgBonus into damage calc — CRR-COND-HIDDEN');
  });

  it('source — handlers/combat.js no longer treats Hidden attacker as a +1 Surge bonus (was wrong)', () => {
    // The pre-fix code had `// Hidden on attacker: +1 surge` followed by
    // `const hiddenSurgeBonus = combat.attackerConds?.includes('Hide') ? 1 : 0;`
    // which was a misread of the CRR paraphrase. The card grants +1
    // Damage, not +1 Surge — pinned removed here.
    assert.doesNotMatch(HCOMBAT_SRC,
      /Hidden on attacker: \+1 surge/,
      'handlers/combat.js must not say "Hidden on attacker: +1 surge" — that interpretation is wrong per the canonical Hidden card');
    assert.doesNotMatch(HCOMBAT_SRC,
      /const hiddenSurgeBonus = combat\.attackerConds\?\.includes\(['"]Hide['"]\)/,
      'handlers/combat.js must not derive hiddenSurgeBonus from attackerConds.Hide — CRR-COND-HIDDEN');
  });

  it('behavior — Hidden attacker hitting for 2 dmg deals 3 (2 + 1 Hidden bonus)', () => {
    const c = makeCombat({
      attackRoll: { acc: 5, dmg: 2, surge: 0 },
      defenseRoll: { block: 0, evade: 0, dodge: false },
      attackerConds: ['Hide'],
    });
    const r = computeCombatResult(c);
    assert.equal(r.hit, true, 'must hit (no dodge, no accuracy issue)');
    assert.equal(r.damage, 3, '2 attack dmg + 1 Hidden bonus = 3 damage');
  });

  it('behavior — non-Hidden attacker hitting for 2 dmg deals 2 (no bonus)', () => {
    const c = makeCombat({
      attackRoll: { acc: 5, dmg: 2, surge: 0 },
      defenseRoll: { block: 0, evade: 0, dodge: false },
      attackerConds: [],
    });
    const r = computeCombatResult(c);
    assert.equal(r.damage, 2, 'no Hidden = no bonus');
  });

  it('behavior — Hidden bonus stacks BEFORE block (block can still reduce 3 → 1)', () => {
    const c = makeCombat({
      attackRoll: { acc: 5, dmg: 2, surge: 0 },
      defenseRoll: { block: 2, evade: 0, dodge: false },
      attackerConds: ['Hide'],
    });
    const r = computeCombatResult(c);
    assert.equal(r.hit, true);
    assert.equal(r.damage, 1, '2 + 1 Hidden = 3, minus 2 block = 1');
  });

  it('behavior — Hidden + Weakened attacker: Hidden adds +1 dmg, Weakened removes -1 dmg afterwards', () => {
    // Weakened applies after Hidden in the current implementation order.
    // Combined effect: +1 (Hidden) -1 (Weakened) = net +0. Verifies the
    // two condition modifiers compose correctly.
    const c = makeCombat({
      attackRoll: { acc: 5, dmg: 2, surge: 0 },
      defenseRoll: { block: 0, evade: 0, dodge: false },
      attackerConds: ['Hide', 'Weaken'],
    });
    const r = computeCombatResult(c);
    assert.equal(r.damage, 2, 'Hidden +1 then Weakened -1 = net 2 damage');
  });

  it('behavior — miss (no accuracy) → Hidden bonus does not produce damage', () => {
    const c = makeCombat({
      attackRoll: { acc: 0, dmg: 2, surge: 0 },
      defenseRoll: { block: 0, evade: 0, dodge: false },
      attackerConds: ['Hide'],
      isRanged: true,
      distanceToTarget: 3,
    });
    const r = computeCombatResult(c);
    assert.equal(r.hit, false, 'miss on accuracy');
    assert.equal(r.damage, 0, 'miss → 0 damage even with Hidden bonus');
  });
});
