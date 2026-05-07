/**
 * CRR-COND-HIDDEN: a Hidden attacker applies +1 SURGE to the attack
 * results.
 *
 * Source: canonical IACP Hidden condition card —
 *   "While defending, apply -2 Accuracy to the attack results.
 *    While attacking, apply +1 [Surge] to the attack results.
 *    After you resolve an attack, you must discard this condition."
 *   (verified against vassal_extracted/images/conditions/Condition card--Hidden.jpg
 *    + destruct 2026-05-07 confirmation: "hidden applies +1 surge, not +1 damage")
 *
 * Implementation split (post 2026-05-07 fix):
 *   - +1 SURGE bonus is applied UPSTREAM in handlers/combat.js
 *     handleCombatSurge alongside Weakened's surge penalty (rawSurge calc).
 *   - computeCombatResult only surfaces the flag in resultText for log
 *     readability; it does NOT modify damage based on Hidden.
 *
 * Earlier audit (2026-05-05) misread the card's symbol as Damage and
 * wrongly applied +1 Damage in computeCombatResult; that path was
 * removed when destruct corrected the canonical reading.
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

describe('CRR-COND-HIDDEN: Hidden attacker applies +1 Surge', () => {
  it('source — handlers/combat.js applies +1 Surge bonus when attacker has Hide', () => {
    assert.match(HCOMBAT_SRC,
      /_attackerHiddenSurge\s*=\s*combat\.attackerConds\?\.includes\(['"]Hide['"]\)/,
      'handlers/combat.js must derive a Hidden-surge flag from attackerConds.Hide — CRR-COND-HIDDEN');
    assert.match(HCOMBAT_SRC,
      /_hiddenSurgeBonus\s*=\s*_attackerHiddenSurge\s*\?\s*1\s*:\s*0/,
      'handlers/combat.js must compute _hiddenSurgeBonus = 1 when Hide is set — CRR-COND-HIDDEN');
  });

  it('source — computeCombatResult does NOT apply +1 Damage from Hidden anymore', () => {
    const body = COMBAT_SRC.match(/export function computeCombatResult\([\s\S]*?\n\}/);
    assert.ok(body, 'computeCombatResult body locatable');
    assert.doesNotMatch(body[0], /hiddenDmgBonus\s*=\s*attackerHidden/,
      'computeCombatResult must not derive hiddenDmgBonus from attackerHidden — that was the wrong reading; Hidden is +1 surge upstream now');
  });

  it('behavior — Hidden attacker hitting for 2 dmg (no surge interaction) deals 2 (no Damage bonus from Hidden)', () => {
    // computeCombatResult is the pure-compute layer. Hidden's surge bonus
    // is upstream of this — when called directly without surge-spend
    // routing, Hidden doesn't change the damage formula.
    const c = makeCombat({
      attackRoll: { acc: 5, dmg: 2, surge: 0 },
      defenseRoll: { block: 0, evade: 0, dodge: false },
      attackerConds: ['Hide'],
    });
    const r = computeCombatResult(c);
    assert.equal(r.hit, true, 'must hit (no dodge, no accuracy issue)');
    assert.equal(r.damage, 2, 'computeCombatResult does not add +1 from Hidden directly — surge bonus is upstream');
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

  it('behavior — Hidden attacker pre-applied surgeDamage routes through normal block reduction (3 → 1)', () => {
    // Simulates the upstream-applied Hidden surge bonus having already
    // been spent on +1 damage via the surge-spend path (surgeDamage=1).
    // Damage calc: dmg(2) + surgeD(1) - block(2) = 1.
    const c = makeCombat({
      attackRoll: { acc: 5, dmg: 2, surge: 0 },
      defenseRoll: { block: 2, evade: 0, dodge: false },
      surgeDamage: 1,
      attackerConds: ['Hide'],
    });
    const r = computeCombatResult(c);
    assert.equal(r.hit, true);
    assert.equal(r.damage, 1, 'pre-applied surge-damage from Hidden bonus survives block reduction');
  });

  it('behavior — miss (no accuracy) → Hidden does not produce damage', () => {
    const c = makeCombat({
      attackRoll: { acc: 0, dmg: 2, surge: 0 },
      defenseRoll: { block: 0, evade: 0, dodge: false },
      attackerConds: ['Hide'],
      isRanged: true,
      distanceToTarget: 3,
    });
    const r = computeCombatResult(c);
    assert.equal(r.hit, false);
    assert.equal(r.damage, 0);
  });
});
