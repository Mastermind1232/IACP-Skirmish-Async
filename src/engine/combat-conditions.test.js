import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { makeCondition, attackerDcName, conditionForRow, conditionalGuard, limitGuard, abilityLimitKey, markAbilityUsed } from './combat-conditions.js';

describe('once/round usage marking (owner-keyed, pipeline-driven)', () => {
  it('markAbilityUsed suppresses a once/round ability until the SOR reset clears it', () => {
    const game = {}; const combat = {};
    const limit = limitGuard('once per round', abilityLimitKey('Onar Koma', 'Get Down'));
    assert.ok(limit(game, combat), 'not used → available');
    markAbilityUsed(game, combat, { card: 'Onar Koma', ability: 'Get Down', limit: 'once per round' });
    assert.ok(!limit(game, combat), 'used this round → suppressed');
    game.roundAbilityUsed = {}; // SOR reset
    assert.ok(limit(game, combat), 'after SOR reset → available again');
  });

  it('keyed by owner (card+ability), not the attacker figure', () => {
    const game = {};
    markAbilityUsed(game, {}, { card: 'Onar Koma', ability: 'Get Down', limit: 'once per round' });
    assert.equal(game.roundAbilityUsed[abilityLimitKey('Onar Koma', 'Get Down')], true);
  });
});

describe('conditionForRow: self-then-others derivation', () => {
  it('affects_self=TRUE, affects_others=None → attacker_is_self', () => {
    const cond = conditionForRow({ card: 'Cara Dune', affects_self: 'TRUE', affects_others: 'None' });
    assert.ok(cond({}, { attackerDcName: 'Cara Dune' }), 'owner attacking → usable');
    assert.ok(!cond({}, { attackerDcName: 'Greedo' }), 'different attacker → not usable');
  });

  it('affects_self=FALSE, affects_others=None → not usable (no self, no others grant)', () => {
    const cond = conditionForRow({ card: 'X', affects_self: 'FALSE', affects_others: 'None' });
    assert.ok(!cond({}, { attackerDcName: 'X' }));
  });

  it('affects_others="figures in this group" → in_group_of_source (attacker in the owner group)', () => {
    const cond = conditionForRow({ card: 'Targeting Computer', affects_self: 'FALSE', affects_others: 'figures in this group' });
    assert.ok(cond({}, { attackerDcName: 'Targeting Computer' }), 'attacker in the owner group → usable');
    assert.ok(!cond({}, { attackerDcName: 'Other' }));
  });

  it('a defender-side aura centers on a FRIENDLY-to-the-defender owner (not the attacker, not enemy owners)', () => {
    // Get Down (Onar, defender-side): defender benefits iff a friendly Onar (on
    // the defender's team) is within 2. No map → can't resolve range → not usable.
    const cond = conditionForRow({ card: 'Onar Koma', attack_side: 'defender', affects_self: 'FALSE', affects_others: 'a small figure within 2 spaces' });
    const combat = { attackerPlayerNum: 1, defenderPlayerNum: 2, target: { figureKey: 'Stormtrooper-2-0' } };
    // Onar only on the ATTACKER's team (player 1) → not friendly to the defender → not usable.
    const enemyOnar = { selectedMap: { id: 'no-such-map' }, figurePositions: { 1: { 'Onar Koma-1-0': 'a1' }, 2: { 'Stormtrooper-2-0': 'a1' } } };
    assert.equal(cond(enemyOnar, combat), false);
  });

  it('ANDs the conditional-column guard (spend-token gate)', () => {
    const cond = conditionForRow({ card: 'Cara Dune', affects_self: 'TRUE', affects_others: 'None', conditional: 'after you spend a power token' });
    assert.ok(!cond({}, { attackerDcName: 'Cara Dune' }), 'self holds but no token spent → not usable');
    assert.ok(cond({}, { attackerDcName: 'Cara Dune', attackerSpentPowerToken: true }), 'token spent → usable');
  });
});

describe('combat-conditions: the condition-predicate layer', () => {
  it('attacker_is_self matches the attacking figure DC, variant-insensitive', () => {
    const c = makeCondition({ type: 'attacker_is_self', card: 'Cara Dune' });
    assert.ok(c({}, { attackerDcName: 'Cara Dune' }), 'exact');
    assert.ok(c({}, { attackerDcName: 'Cara Dune [Elite]' }), 'variant suffix ignored');
    assert.ok(!c({}, { attackerDcName: 'Greedo' }), 'different attacker → false');
  });

  it('spent_power_token reads combat.attackerSpentPowerToken', () => {
    const c = makeCondition({ type: 'spent_power_token' });
    assert.ok(c({}, { attackerSpentPowerToken: true }));
    assert.ok(!c({}, {}));
  });

  it('unknown / empty type defaults to always-true (never silently drops an ability)', () => {
    assert.ok(makeCondition()({}, {}));
    assert.ok(makeCondition({ type: 'not_a_real_type' })({}, {}));
    assert.ok(makeCondition({ type: 'always' })({}, {}));
  });

  it('attackerDcName falls back to the figure key', () => {
    assert.equal(attackerDcName({ attackerFigureKey: 'Cara Dune-1-0' }), 'cara dune');
  });
});

describe('combat-conditions: gate-rework reroll-condition primitives (2026-06-18)', () => {
  // chopper-base-atollon: l3↔l4 adjacent, n3 far from l3.
  const MAP = { id: 'chopper-base-atollon' };

  it('affected_adjacent_to_friendly: another friendly figure within 1 (Cower)', () => {
    const c = makeCondition({ type: 'affected_adjacent_to_friendly', side: 'defender' });
    const game = (allyCell) => ({ selectedMap: MAP, figurePositions: { 2: { 'C-3P0-2-0': 'l3', 'Ally-2-0': allyCell } } });
    const combat = { defenderPlayerNum: 2, target: { figureKey: 'C-3P0-2-0' }, defenderDcName: 'C-3P0' };
    assert.ok(c(game('l4'), combat), 'adjacent ally → true');
    assert.ok(!c(game('n3'), combat), 'no adjacent ally → false');
  });

  it('affected_adjacent_to_friendly excludes the figure itself (needs ANOTHER figure)', () => {
    const c = makeCondition({ type: 'affected_adjacent_to_friendly', side: 'defender' });
    const game = { selectedMap: MAP, figurePositions: { 2: { 'C-3P0-2-0': 'l3' } } };
    assert.ok(!c(game, { defenderPlayerNum: 2, target: { figureKey: 'C-3P0-2-0' }, defenderDcName: 'C-3P0' }), 'alone → false');
  });

  it('affected_adjacent_to_friendly with keyword filter (Squad Training: TROOPER)', () => {
    const c = makeCondition({ type: 'affected_adjacent_to_friendly', keyword: 'TROOPER', side: 'attacker' });
    const game = (allyDc) => ({ selectedMap: MAP, figurePositions: { 1: { 'Stormtrooper (Elite)-1-0': 'l3', [`${allyDc}-1-1`]: 'l4' } } });
    const combat = { attackerPlayerNum: 1, attackerDcName: 'Stormtrooper (Elite)', attackerFigureKey: 'Stormtrooper (Elite)-1-0' };
    assert.ok(c(game('Stormtrooper (Elite)'), combat), 'adjacent friendly TROOPER → true');
    assert.ok(!c(game('Greedo'), combat), 'adjacent friendly non-TROOPER → false');
  });

  it('attacker_target_adjacent: attacker and target within 1 (Precision)', () => {
    const c = makeCondition({ type: 'attacker_target_adjacent' });
    // Real DC names so the footprint-size lookup is deterministic (Greedo/Stormtrooper are 1×1).
    const game = (tgtCell) => ({ selectedMap: MAP, figurePositions: { 1: { 'Greedo-1-0': 'l3' }, 2: { 'Stormtrooper-2-0': tgtCell } } });
    const combat = { attackerPlayerNum: 1, defenderPlayerNum: 2, attackerFigureKey: 'Greedo-1-0', target: { figureKey: 'Stormtrooper-2-0' } };
    assert.ok(c(game('l4'), combat), 'adjacent target → true');
    assert.ok(!c(game('n3'), combat), 'distant target → false');
  });

  it('defender_spent_block reads combat.defenderSpentBlock (Survival is Strength)', () => {
    const c = makeCondition({ type: 'defender_spent_block' });
    assert.ok(c({}, { defenderSpentBlock: true }));
    assert.ok(!c({}, { defenderSpentBlock: false }));
  });

  it('conditionalGuard maps the recognised reroll-condition prose to primitives', () => {
    // "spent a Block symbol" → defender_spent_block
    assert.ok(conditionalGuard('friendly figure within 3 spaces spent a Block symbol during this attack')({}, { defenderSpentBlock: true }));
    assert.ok(!conditionalGuard('it spent a Block symbol during this attack')({}, {}));
    // "against an adjacent figure" → attacker_target_adjacent (no map → false)
    assert.ok(!conditionalGuard('attacking or defending against an adjacent figure')({}, { attackerPlayerNum: 1, defenderPlayerNum: 2, attackerFigureKey: 'A-1-0', target: { figureKey: 'B-2-0' } }));
  });
});
