import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import './combat-abilities-mods.js'; // self-registers mods-window abilities
import { abilitiesForWindow } from './combat-timing-registry.js';

function deps(effMap) {
  return {
    getDcEffects: () => effMap,
    getMapData: () => ({ adjacency: {} }),
    isWithinSpaces: () => true,
    getFigureSize: () => [1, 1],
  };
}
function game(o = {}) {
  return {
    player1VP: { total: 0 }, player2VP: { total: 0 },
    figurePositions: { 1: {}, 2: {} }, figureContraband: {}, figureOrientations: {},
    roundFigureAbilityUsed: {}, selectedMap: { id: 'm' }, selectedMission: { rules: {} }, ...o,
  };
}
function combat(o = {}) {
  return {
    attackerFigureKey: 'Atk-1-0', attackerDcName: 'Atk', attackerPlayerNum: 1, defenderPlayerNum: 2,
    target: { figureKey: 'Def-1-0' }, defenseRoll: { block: 0, dodge: false }, attackType: 'Melee', ...o,
  };
}
const at = (side, g, c, d) => abilitiesForWindow('mods', side, g, c, d);
const find = (list, id) => list.find((a) => a.id === id);

describe('mods-window abilities via the timing registry', () => {
  it('attacker: Spray Fire interactive; nothing when DC has no abilities', () => {
    assert.deepEqual(at('attacker', game(), combat(), deps({ Atk: { specialAbilityIds: [] }, Def: { specialAbilityIds: [] } })), []);
    const out = at('attacker', game(), combat(), deps({ Atk: { specialAbilityIds: ['spray_fire_heavy_stormtrooper'] }, Def: {} }));
    assert.equal(find(out, 'spray_fire').kind, 'interactive');
  });

  it('Negotiate is NOT a mods ability (two-timing: moved to on_declare)', () => {
    // Two-timing model (alexanbv 2026-06-18): Negotiate is now PLAYED/CHOSEN at
    // on_declare; its +2 Damage lands at mods via a pending modifier, not by
    // being offered as a mods ability.
    const d = deps({ Atk: { specialAbilityIds: ['negotiate_hondo'] }, Def: {} });
    assert.equal(find(at('attacker', game({ player2VP: { total: 1 } }), combat(), d), 'negotiate'), undefined);
    assert.equal(find(at('attacker', game({ player2VP: { total: 9 } }), combat(), d), 'negotiate'), undefined);
  });

  it('pending_modifiers_drain passive appears only when a mods modifier is stashed', () => {
    const d = deps({ Atk: { specialAbilityIds: [] }, Def: {} });
    assert.equal(find(at('attacker', game(), combat(), d), 'pending_modifiers_drain'), undefined);
    const c = combat({ pendingModifiers: { mods: [{ source: 'X', effect: { bonusHits: 1 } }] } });
    assert.equal(find(at('attacker', game(), c, d), 'pending_modifiers_drain').kind, 'passive');
  });

  it('Pulse Cannon (passive) only with a spent power token', () => {
    const d = deps({ Atk: { specialAbilityIds: ['pulse_cannon_iden'] }, Def: {} });
    assert.equal(find(at('attacker', game(), combat(), d), 'pulse_cannon'), undefined);
    assert.equal(find(at('attacker', game(), combat({ attackerSpentPowerToken: true }), d), 'pulse_cannon').kind, 'passive');
  });

  it('defender: Agile interactive only with a Block; Defensible interactive (idempotency is the gate, not detection)', () => {
    const d = deps({ Atk: {}, Def: { specialAbilityIds: ['agile_jet_trooper_reg', 'defensible_sc2m'] } });
    const none = at('defender', game(), combat(), d);
    assert.equal(find(none, 'agile'), undefined); // no block
    assert.equal(find(none, 'defensible').kind, 'interactive');
    const withBlock = at('defender', game(), combat({ defenseRoll: { block: 2, dodge: false } }), d);
    assert.equal(find(withBlock, 'agile').kind, 'interactive');
    // alexanbv 2026-06-16: a "used" ability is suppressed by the gate's generic
    // resolved-tracking, NOT by a per-ability flag in detection — so detection
    // still offers it regardless of any per-ability resolved flag.
    assert.equal(find(at('defender', game(), combat({ defensibleResolved: true }), d), 'defensible').kind, 'interactive');
  });

  it('defender Dodge passives appear only on a dodge', () => {
    const d = deps({ Atk: {}, Def: { specialAbilityIds: ['defensive_stance', 'lucky_r2d2'] } });
    assert.equal(find(at('defender', game(), combat(), d), 'defensive_stance'), undefined);
    const dodge = at('defender', game(), combat({ defenseRoll: { dodge: true } }), d);
    assert.equal(find(dodge, 'defensive_stance').kind, 'passive');
    assert.equal(find(dodge, 'lucky').kind, 'passive');
  });

  it('attacker query returns no defender abilities and vice-versa', () => {
    const d = deps({ Atk: { specialAbilityIds: ['spray_fire_heavy_stormtrooper'] }, Def: { specialAbilityIds: ['defensible_sc2m'] } });
    assert.equal(find(at('attacker', game(), combat(), d), 'defensible'), undefined);
    assert.equal(find(at('defender', game(), combat(), d), 'spray_fire'), undefined);
  });
});
