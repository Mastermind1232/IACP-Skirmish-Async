import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { abilitiesForWindow, getCombatAbility } from './combat-timing-registry.js';
import './combat-mods-gate.js'; // self-registers the data-driven reroll detection
import { markDieRerolled, dieId } from './combat-reroll-lock.js';

// Cara Dune: an UNCONDITIONAL attacker reroll row in docs/combat-spec.csv →
// registered data-driven as reroll:cara_dune:attacker (no hand-coded resolver).
const ID = 'reroll:cara_dune:attacker';
const combat = () => ({ attackerPlayerNum: 1, attackDiceResults: [{ color: 'blue', dmg: 0, surge: 0, acc: 1 }] });
const gameHolding = (card) => ({ p1DcList: card ? [{ dcName: card }] : [] });
const atkIds = (game, c) => abilitiesForWindow('rerolls', 'attacker', game, c, {}).map((a) => a.id);

describe('rerolls gate: data-driven (CSV) reroll detection', () => {
  it('registers reroll abilities from the CSV with params derived from the row', () => {
    const reg = getCombatAbility(ID);
    assert.ok(reg, 'Cara Dune reroll should be registered from the CSV');
    assert.equal(reg.params?.kind, 'reroll');
    assert.equal(reg.params?.pool, 'attack');
  });

  it('offers the reroll only when the side holds the card + an unlocked die exists', () => {
    assert.ok(atkIds(gameHolding('Cara Dune'), combat()).includes(ID), 'held → offered');
    assert.ok(!atkIds(gameHolding(null), combat()).includes(ID), 'not held → not offered');
  });

  it('does NOT offer once the only die is locked (binary reroll flag)', () => {
    const c = combat();
    markDieRerolled(c, dieId('attack', 0));
    assert.ok(!atkIds(gameHolding('Cara Dune'), c).includes(ID), 'locked die → not selectable → not offered');
  });
});
