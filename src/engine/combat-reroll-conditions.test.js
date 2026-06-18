import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { abilitiesForWindow, getCombatAbility } from './combat-timing-registry.js';
import './combat-mods-gate.js'; // self-registers the data-driven reroll detection

// Conditioned reroll abilities (gate-rework audit, 2026-06-18): each must be
// offered ONLY when its conditional holds, not regardless. A real map with an
// adjacency graph is needed for the spatial conditions; chopper-base-atollon
// cells l3/l4 are adjacent, n3 is far from l3.
const idsFor = (side, game, combat) => abilitiesForWindow('rerolls', side, game, combat, {}).map((a) => a.id);
const MAP = { id: 'chopper-base-atollon' };

describe('reroll conditionals: Cower — only while adjacent to a friendly figure', () => {
  const game = (allyCell) => ({
    selectedMap: MAP,
    figurePositions: { 1: { 'Stormtrooper-1-0': 'a1' }, 2: { 'C-3P0-2-0': 'l3', 'Gideon-2-0': allyCell } },
  });
  const combat = {
    attackerPlayerNum: 1, defenderPlayerNum: 2,
    attackerDcName: 'Stormtrooper', attackerFigureKey: 'Stormtrooper-1-0',
    defenderDcName: 'C-3P0', target: { figureKey: 'C-3P0-2-0' },
    defenseDiceResults: [{ color: 'white', block: 1, evade: 0 }],
  };

  it('IS offered when a friendly figure is adjacent', () => {
    assert.ok(idsFor('defender', game('l4'), combat).includes('reroll:c_3p0:defender'));
  });
  it('is NOT offered when no friendly figure is adjacent', () => {
    assert.ok(!idsFor('defender', game('n3'), combat).includes('reroll:c_3p0:defender'));
  });
});

describe('reroll conditionals: Squad Training — only while adjacent to another friendly TROOPER', () => {
  const game = (allyCell) => ({
    selectedMap: MAP,
    figurePositions: { 1: { 'Stormtrooper (Elite)-1-0': 'l3', 'Stormtrooper (Elite)-1-1': allyCell }, 2: {} },
  });
  const combat = { attackerPlayerNum: 1, defenderPlayerNum: 2, attackerDcName: 'Stormtrooper (Elite)', attackerFigureKey: 'Stormtrooper (Elite)-1-0', attackDiceResults: [{ color: 'blue', dmg: 1 }] };

  it('IS offered when adjacent to another friendly TROOPER', () => {
    assert.ok(idsFor('attacker', game('l4'), combat).includes('reroll:stormtrooper_elite:attacker'));
  });
  it('is NOT offered when alone (no adjacent friendly TROOPER)', () => {
    assert.ok(!idsFor('attacker', game('n3'), combat).includes('reroll:stormtrooper_elite:attacker'));
  });
});

describe('reroll conditionals: Precision — only against an adjacent figure', () => {
  const game = (targetCell) => ({
    selectedMap: MAP,
    figurePositions: { 1: { 'The Grand Inquisitor-1-0': 'l3' }, 2: { 'Greedo-2-0': targetCell } },
  });
  const combat = {
    attackerPlayerNum: 1, defenderPlayerNum: 2,
    attackerDcName: 'The Grand Inquisitor', attackerFigureKey: 'The Grand Inquisitor-1-0',
    defenderDcName: 'Greedo', target: { figureKey: 'Greedo-2-0' },
    attackDiceResults: [{ color: 'blue', dmg: 1 }], defenseDiceResults: [{ color: 'white', block: 1 }],
  };

  it('IS offered when attacker and target are adjacent', () => {
    assert.ok(idsFor('attacker', game('l4'), combat).includes('reroll:the_grand_inquisitor:attacker'));
  });
  it('is NOT offered when the target is not adjacent', () => {
    assert.ok(!idsFor('attacker', game('n3'), combat).includes('reroll:the_grand_inquisitor:attacker'));
  });
});

describe('reroll conditionals: Overpower — die-color restriction (RED attacker / BLACK defender)', () => {
  const base = {
    attackerPlayerNum: 1, defenderPlayerNum: 2,
    attackerDcName: 'Royal Guard Champion', attackerFigureKey: 'Royal Guard Champion-1-0',
    defenderDcName: 'X', target: { figureKey: 'X-2-0' },
  };

  it('registers a dieColor restriction (not a whole-pool / color-swap)', () => {
    const atk = getCombatAbility('reroll:royal_guard_champion:attacker');
    const def = getCombatAbility('reroll:royal_guard_champion:defender');
    assert.equal(atk.params.dieColor, 'red');
    assert.equal(atk.params.colorSwap, false);
    assert.equal(def.params.dieColor, 'black');
  });
  it('IS offered when a RED attack die is present', () => {
    const c = { ...base, attackDiceResults: [{ color: 'red', dmg: 1, acc: 0, surge: 0 }] };
    assert.ok(idsFor('attacker', {}, c).includes('reroll:royal_guard_champion:attacker'));
  });
  it('is NOT offered when no RED attack die is present', () => {
    const c = { ...base, attackDiceResults: [{ color: 'blue', dmg: 1, acc: 0, surge: 0 }] };
    assert.ok(!idsFor('attacker', {}, c).includes('reroll:royal_guard_champion:attacker'));
  });
});

describe('reroll conditionals: Rancor (Trained) — strain cost modeled on the reroll', () => {
  it('carries a strainCost param', () => {
    assert.equal(getCombatAbility('reroll:rancor:attacker').params.strainCost, 1);
  });
});

describe('reroll conditionals: The Armorer (Survival is Strength)', () => {
  const game = {
    selectedMap: MAP,
    figurePositions: { 1: { 'Stormtrooper-1-0': 'a1' }, 2: { 'The Armorer-2-0': 'l3', 'Target-2-0': 'l4' } },
  };
  const combat = (spentBlock) => ({
    attackerPlayerNum: 1, defenderPlayerNum: 2,
    attackerDcName: 'Stormtrooper', attackerFigureKey: 'Stormtrooper-1-0',
    defenderDcName: 'Target', target: { figureKey: 'Target-2-0' },
    attackDiceResults: [{ color: 'blue', dmg: 1 }], defenseDiceResults: [{ color: 'white', block: 1 }],
    defenderSpentBlock: spentBlock,
  });

  it('rerolls the ATTACK pool, not defense (pool was previously wrong)', () => {
    assert.equal(getCombatAbility('reroll:the_armorer:defender').params.pool, 'attack');
  });
  it('IS offered only when a Block was spent during this attack', () => {
    assert.ok(idsFor('defender', game, combat(true)).includes('reroll:the_armorer:defender'));
  });
  it('is NOT offered when no Block was spent', () => {
    assert.ok(!idsFor('defender', game, combat(false)).includes('reroll:the_armorer:defender'));
  });
});

describe('reroll conditionals: Bespin Security — adjacent friendly LEADER or SCUM TROOPER', () => {
  // Jawa Scavenger (Elite): LEADER keyword. Royal Guard Champion: neither LEADER
  // nor a Scum TROOPER. Both placed adjacent (l4) to the Wing Guard source (l3).
  const game = (attackerKey) => ({
    selectedMap: MAP,
    figurePositions: { 1: { 'Wing Guard (Elite)-1-0': 'l3', [attackerKey]: 'l4' }, 2: {} },
  });
  const combat = (dc, fk) => ({ attackerPlayerNum: 1, defenderPlayerNum: 2, attackerDcName: dc, attackerFigureKey: fk, attackDiceResults: [{ color: 'blue', dmg: 1 }] });

  it('IS offered to an adjacent friendly LEADER that is attacking', () => {
    assert.ok(idsFor('attacker', game('Jawa Scavenger (Elite)-1-0'), combat('Jawa Scavenger (Elite)', 'Jawa Scavenger (Elite)-1-0')).includes('reroll:wing_guard_elite:attacker'));
  });
  it('is NOT offered to an adjacent figure that is neither LEADER nor SCUM TROOPER', () => {
    assert.ok(!idsFor('attacker', game('Royal Guard Champion-1-0'), combat('Royal Guard Champion', 'Royal Guard Champion-1-0')).includes('reroll:wing_guard_elite:attacker'));
  });
});
