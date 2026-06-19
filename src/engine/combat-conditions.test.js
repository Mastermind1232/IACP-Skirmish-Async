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

describe('combat-conditions: deferred condition-based primitives (2026-06-18)', () => {
  // chopper-base-atollon: n4/n5/o4/o5/m8 are 'blocking' terrain; l3↔l4 adjacent,
  // l3 far from n3. m4/n3 share a corner/edge with the blocking cell n4.
  const MAP = { id: 'chopper-base-atollon' };

  // ── Set Your Sights (Loku) — target_has_recon_token ────────────────────────
  it('target_has_recon_token: fires iff the TARGET carries a Recon token', () => {
    const c = makeCondition({ type: 'target_has_recon_token' });
    assert.ok(c({ reconTokens: { 'Stormtrooper-2-0': true } }, { target: { figureKey: 'Stormtrooper-2-0' } }), 'recon → true');
    assert.ok(!c({ reconTokens: {} }, { target: { figureKey: 'Stormtrooper-2-0' } }), 'no recon → false');
    assert.ok(!c({}, { target: { figureKey: 'Stormtrooper-2-0' } }), 'no reconTokens container → false');
  });

  // ── Hunker Down (Cara Dune) — near_terrain_type (GEOMETRIC neighbours) ──────
  it('near_terrain_type: fires when the defender shares a corner/edge with blocking terrain', () => {
    const c = makeCondition({ type: 'near_terrain_type', side: 'defender', types: ['blocking', 'impassable', 'difficult'] });
    const game = (cell) => ({ selectedMap: MAP, figurePositions: { 2: { 'Cara Dune-2-0': cell } } });
    const combat = { defenderPlayerNum: 2, target: { figureKey: 'Cara Dune-2-0' }, defenderDcName: 'Cara Dune' };
    assert.ok(c(game('m4'), combat), 'm4 shares an edge/corner with blocking n4 → true');
    assert.ok(c(game('n3'), combat), 'n3 shares an edge with blocking n4 → true');
    assert.ok(!c(game('l3'), combat), 'l3 is clear of any blocking terrain → false');
  });

  // ── Improvised Cover (Verena Talos) — affected_adjacent_to_object_or_enemy ──
  it('affected_adjacent_to_object_or_enemy: adjacent to a NON-friendly figure other than the attacker', () => {
    const c = makeCondition({ type: 'affected_adjacent_to_object_or_enemy', side: 'defender' });
    const combat = { attackerPlayerNum: 1, defenderPlayerNum: 2, attackerFigureKey: 'Atk-1-0', target: { figureKey: 'Verena Talos-2-0' }, defenderDcName: 'Verena Talos' };
    // l3 (defender) adjacent to enemy Other-1-1 at l4 (≠ attacker) → true
    const gEnemy = { selectedMap: MAP, figurePositions: { 1: { 'Atk-1-0': 'm8', 'Other-1-1': 'l4' }, 2: { 'Verena Talos-2-0': 'l3' } } };
    assert.ok(c(gEnemy, combat), 'adjacent to a non-attacker enemy → true');
    // only the ATTACKER is adjacent (l4) → false ("other than the attacker")
    const gAtkOnly = { selectedMap: MAP, figurePositions: { 1: { 'Atk-1-0': 'l4' }, 2: { 'Verena Talos-2-0': 'l3' } } };
    assert.ok(!c(gAtkOnly, combat), 'only the attacker adjacent → false');
  });

  it('affected_adjacent_to_object_or_enemy: adjacent to a map OBJECT (crate)', () => {
    const c = makeCondition({ type: 'affected_adjacent_to_object_or_enemy', side: 'defender' });
    const combat = { attackerPlayerNum: 1, defenderPlayerNum: 2, attackerFigureKey: 'Atk-1-0', target: { figureKey: 'Verena Talos-2-0' }, defenderDcName: 'Verena Talos' };
    const g = { selectedMap: MAP, objectPositions: { 'crate-l4': 'l4' }, figurePositions: { 1: { 'Atk-1-0': 'm8' }, 2: { 'Verena Talos-2-0': 'l3' } } };
    assert.ok(c(g, combat), 'adjacent to a crate object → true');
    const gFar = { selectedMap: MAP, objectPositions: { 'crate-m8': 'm8' }, figurePositions: { 1: { 'Atk-1-0': 'm8' }, 2: { 'Verena Talos-2-0': 'l3' } } };
    assert.ok(!c(gFar, combat), 'object not adjacent → false');
  });

  // ── Light It Up (Rebel Pathfinder) — target_no_los_to_attacker_start uses the
  // TARGET's ACTIVATION-START position, not its (possibly moved) current cell ──
  it('target_no_los_to_attacker_start: uses the TARGET position AT THE ATTACKER ACTIVATION START (moved-target fix)', () => {
    const c = makeCondition({ type: 'target_no_los_to_attacker_start' });
    const combat = { attackerFigureKey: 'Pathfinder-1-0', defenderPlayerNum: 2, target: { figureKey: 'Tgt-2-0' } };
    // Target's CURRENT cell (m3) has LOS to the attacker start (l3); the target's
    // ACTIVATION-START cell (i5) did NOT. The condition must read the snapshot.
    const base = {
      selectedMap: MAP,
      activationStartPositions: { 'Pathfinder-1-0': 'l3' },
      figurePositions: { 1: { 'Pathfinder-1-0': 'l3' }, 2: { 'Tgt-2-0': 'm3' } },
      activationStartAllPositions: { 'Pathfinder-1-0': 'l3', 'Tgt-2-0': 'i5' },
    };
    assert.ok(c(base, combat), 'no LOS at the attacker activation start (snapshot) → true');
    // Without the snapshot it falls back to the current cell (which DOES have LOS) → false.
    const noSnap = { ...base, activationStartAllPositions: {} };
    assert.ok(!c(noSnap, combat), 'fallback to current cell (has LOS) → false');
  });
});
