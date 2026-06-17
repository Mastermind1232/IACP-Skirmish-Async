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
    // The token-bearer Saska attacks; another device-token figure can't reuse it
    // the same round (shared round key).
    const game = { ...holds(1, 'Saska Teft'), deviceTokens: { 'Saska Teft': 1, 'Cara Dune': 1 } };
    game.figurePositions[1]['Cara Dune'] = 'b1';
    const combat = atkCombat('Saska Teft');
    assert.equal(ab.applies(game, combat), true);
    markAbilityUsed(game, combat, ab.params);
    // a brand-new attack the same round by a DIFFERENT token-bearer is suppressed
    const combat2 = atkCombat('Cara Dune');
    assert.equal(ab.applies(game, combat2), false, 'shared round limit blocks all bearers that round');
  });
});

describe('Saska Power Converter is gated on a Device token (any friendly bearer)', () => {
  it('only a token-bearing attacker may use it', () => {
    const ab = getCombatAbility('reroll:saska_teft:attacker');
    const game = {
      figurePositions: { 1: { 'Saska Teft': 'a1', 'Cara Dune': 'b1' } },
      p1Cards: ['Saska Teft', 'Cara Dune'],
    };
    const combat = {
      attackerPlayerNum: 1, attackerFigureKey: 'Cara Dune', attackerDcName: 'Cara Dune',
      attackDiceResults: [{ color: 'blue', acc: 1, dmg: 1, surge: 0 }], _rerolledDieIds: new Set(),
    };
    assert.equal(ab.applies({ ...game, deviceTokens: {} }, combat), false, 'no token → not offered');
    assert.equal(ab.applies({ ...game, deviceTokens: { 'Cara Dune': 1 } }, combat), true, 'token bearer → offered');
    assert.equal(ab.params.colorSwap, true, 'Power Converter can replace the die with any color');
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
