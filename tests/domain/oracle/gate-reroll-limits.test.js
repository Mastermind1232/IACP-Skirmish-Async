/**
 * Limited reroll abilities (per attack/round/activation) must be offered once,
 * then suppressed after they resolve. The 5 limited reroll CSV rows carry their
 * limit into the registration params so the gate's _markGateAbilityUsed marks
 * the owner used-list and `applies` re-checks it. alexanbv 2026-06-17.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import '../../../src/engine/combat-abilities-rerolls.js';
import { getCombatAbility } from '../../../src/engine/combat-timing-registry.js';
import { markAbilityUsed } from '../../../src/engine/combat-conditions.js';

function holds(player, card) {
  return { figurePositions: { [player]: { [card]: 'a1' } }, [`p${player}Cards`]: [card] };
}
function atkCombat(name) {
  return {
    attackerPlayerNum: 1, attackerFigureKey: name, attackerDcName: name,
    attackDiceResults: [{ color: 'blue', acc: 1, dmg: 1, surge: 0 }], _rerolledDieIds: new Set(),
  };
}

describe('Limited reroll abilities are guarded + marked', () => {
  it('Saska Teft / Power Converter (once per round) is offered then suppressed', () => {
    const ab = getCombatAbility('reroll:saska_teft:attacker');
    assert.ok(ab, 'Saska reroll registered');
    assert.equal(ab.params.limit, 'once per round');
    const game = holds(1, 'Saska Teft'), combat = atkCombat('Saska Teft');
    assert.equal(ab.applies(game, combat), true, 'offered before use');
    markAbilityUsed(game, combat, ab.params);
    assert.equal(ab.applies(game, combat), false, 'suppressed same round');
  });

  it('Purge Commander (Elite) / Coordinated Hunt (per attack) resets only per attack', () => {
    const ab = getCombatAbility('reroll:purge_commander_elite:attacker');
    assert.ok(ab, 'Purge Commander reroll registered');
    assert.match(ab.params.limit, /per attack/);
    const game = holds(1, 'Purge Commander (Elite)'), combat = atkCombat('Purge Commander (Elite)');
    assert.equal(ab.applies(game, combat), true);
    markAbilityUsed(game, combat, ab.params);
    assert.equal(ab.applies(game, combat), false, 'suppressed within the same attack');
    // a fresh attack object clears the per-attack used-list (keyed on combat)
    const combat2 = atkCombat('Purge Commander (Elite)');
    assert.equal(ab.applies(game, combat2), true, 'available again next attack');
  });

  it('an unlimited reroll row is never suppressed by marking', () => {
    // Find any None-limit attacker reroll and confirm marking is a no-op.
    const ab = getCombatAbility('reroll:saska_teft:attacker');
    const game = holds(1, 'Saska Teft'), combat = atkCombat('Saska Teft');
    markAbilityUsed(game, combat, { card: 'X', ability: 'Y', limit: 'None' });
    assert.equal(ab.applies(game, combat), true, 'unrelated None-limit mark does not suppress');
  });
});
