import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { abilitiesForWindow, getCombatAbility } from './combat-timing-registry.js';
import './combat-mods-gate.js'; // self-registers the data-driven reroll detection
import { markDieRerolled, dieId } from './combat-reroll-lock.js';

// Cara Dune: an UNCONDITIONAL DC attacker reroll row in docs/combat-spec.csv →
// registered data-driven as reroll:cara_dune:attacker. As a DC self-ability its
// condition is attacker_is_self (the figure must be the one attacking).
const ID = 'reroll:cara_dune:attacker';
const combat = (attackerDcName) => ({ attackerPlayerNum: 1, attackerDcName, attackDiceResults: [{ color: 'blue', dmg: 0, surge: 0, acc: 1 }] });
const atkIds = (game, c) => abilitiesForWindow('rerolls', 'attacker', game, c, {}).map((a) => a.id);

describe('rerolls gate: data-driven (CSV) reroll detection', () => {
  it('registers reroll abilities from the CSV with params derived from the row', () => {
    const reg = getCombatAbility(ID);
    assert.ok(reg, 'Cara Dune reroll should be registered from the CSV');
    assert.equal(reg.params?.kind, 'reroll');
    assert.equal(reg.params?.pool, 'attack');
  });

  it('offers a DC self-reroll only when that figure is the ATTACKER (not merely held)', () => {
    assert.ok(atkIds({}, combat('Cara Dune')).includes(ID), 'Cara Dune attacking → offered');
    assert.ok(!atkIds({}, combat('Greedo')).includes(ID), 'a different attacker → not offered (self/aura distinction)');
  });

  it('does NOT offer once the only die is locked (binary reroll flag)', () => {
    const c = combat('Cara Dune');
    markDieRerolled(c, dieId('attack', 0));
    assert.ok(!atkIds({}, c).includes(ID), 'locked die → not selectable → not offered');
  });
});
