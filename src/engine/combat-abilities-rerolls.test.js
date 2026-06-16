import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { abilitiesForWindow } from './combat-timing-registry.js';
import './combat-mods-gate.js'; // self-registers the executable rerolls detection
import { markDieRerolled, dieId } from './combat-reroll-lock.js';

// [Driven by Hatred] is the first effect whose text yields an innate attack
// reroll (getInnateRerolls → attackReroll:1); used as the positive fixture.
const combatFor = (dcName) => ({ attackerDcName: dcName, attackDiceResults: [{ color: 'blue', dmg: 0, surge: 0, acc: 1 }] });
const atkRerollIds = (combat) => abilitiesForWindow('rerolls', 'attacker', {}, combat, {}).map((a) => a.id);

describe('rerolls gate: generic innate reroll detection', () => {
  it('offers innate_attack_reroll when the attacker DC has an innate attack reroll + an unlocked die', () => {
    assert.ok(atkRerollIds(combatFor('[Driven by Hatred]')).includes('innate_attack_reroll'));
  });

  it('does NOT offer when the DC has no innate reroll', () => {
    assert.ok(!atkRerollIds(combatFor('Greedo')).includes('innate_attack_reroll'));
  });

  it('does NOT offer once the only die is locked (binary reroll flag)', () => {
    const c = combatFor('[Driven by Hatred]');
    markDieRerolled(c, dieId('attack', 0));
    assert.ok(!atkRerollIds(c).includes('innate_attack_reroll'), 'locked die → not selectable → not offered');
  });
});
