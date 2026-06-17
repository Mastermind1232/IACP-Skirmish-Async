/**
 * Reroll-ability limits in the gate (alexanbv 2026-06-17):
 *  - EVERY reroll is once-per-attack by DEFAULT ("everything is by default limit
 *    once/attack unless otherwise specified"; there is no unlimited reroll).
 *  - "once per round" (Saska / Power Converter — a shared device-token limit;
 *    the global card:ability round key blocks every figure once any uses it).
 *  - "once per activation" (Lando / Shrewd Scoundrel — in its bespoke resolver).
 * Limits ride in the registration params; the gate's _markGateAbilityUsed marks
 * the owner used-list on resolve and `applies` re-checks it.
 *
 * Also the "player that rolled it must reroll" force-reroll idiom (Precision,
 * Raider → any pool; Fyrnock Style → attack pool).
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
    attackDiceResults: [{ color: 'blue', acc: 1, dmg: 1, surge: 0 }],
    defenseDiceResults: [{ color: 'white', block: 1, evade: 0, dodge: false }],
    _rerolledDieIds: new Set(),
  };
}

describe('Every reroll is once-per-attack by default', () => {
  it('a "None"-limit reroll (Cara Dune) defaults to once per attack and resets per attack', () => {
    const ab = getCombatAbility('reroll:cara_dune:attacker');
    assert.ok(ab, 'Cara Dune reroll registered');
    assert.equal(ab.params.limit, 'once per attack', 'default limit applied');
    const game = holds(1, 'Cara Dune'), combat = atkCombat('Cara Dune');
    assert.equal(ab.applies(game, combat), true, 'offered before use');
    markAbilityUsed(game, combat, ab.params);
    assert.equal(ab.applies(game, combat), false, 'suppressed within the same attack');
    // a fresh attack object clears the per-attack used-list
    assert.equal(ab.applies(game, atkCombat('Cara Dune')), true, 'available again next attack');
  });
});

describe('Wider-scope reroll limits', () => {
  it('Saska Teft / Power Converter is once per round (global key blocks all that round)', () => {
    const ab = getCombatAbility('reroll:saska_teft:attacker');
    assert.equal(ab.params.limit, 'once per round');
    const game = holds(1, 'Saska Teft'), combat = atkCombat('Saska Teft');
    assert.equal(ab.applies(game, combat), true);
    markAbilityUsed(game, combat, ab.params);
    // a brand-new attack the same round is still suppressed (round-scoped, shared)
    assert.equal(ab.applies(game, atkCombat('Saska Teft')), false, 'suppressed for the rest of the round');
  });
});

describe('"player that rolled it must reroll" force-reroll idiom routes the pool', () => {
  it('Precision (Grand Inquisitor) — choose any die → pool "any"', () => {
    const ab = getCombatAbility('reroll:the_grand_inquisitor:attacker');
    assert.ok(ab); assert.equal(ab.params.pool, 'any');
  });
  it('Raider (Weequay Pirate Elite) — choose any die → pool "any"', () => {
    const ab = getCombatAbility('reroll:weequay_pirate_elite:attacker');
    assert.ok(ab); assert.equal(ab.params.pool, 'any');
  });
  it('Fyrnock Style (Tress Hacnua) — choose 1 attack die → pool "attack"', () => {
    const ab = getCombatAbility('reroll:tress_hacnua:attacker');
    assert.ok(ab); assert.equal(ab.params.pool, 'attack');
  });
});
