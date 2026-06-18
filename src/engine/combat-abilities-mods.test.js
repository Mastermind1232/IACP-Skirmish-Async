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

// ── Third-party / automatic mods passives (slice: round-trigger-wiring) ───────
describe('third-party mods passives via the timing registry', () => {
  // deps where adjacency is data-driven by an explicit near-set rather than
  // always-true, so "fires when adjacent / not when far" can be exercised.
  function depsAdj(effMap, nearPairs = []) {
    const near = new Set(nearPairs.map(([a, b]) => `${a}|${b}`));
    return {
      getDcEffects: () => effMap,
      getMapData: () => ({ adjacency: {} }),
      isWithinSpaces: (_m, a, b) => near.has(`${a}|${b}`) || near.has(`${b}|${a}`),
      getFigureSize: () => [1, 1],
      findDcMessageIdForFigure: () => null,
    };
  }

  it('Protector: +1 Block passive only when a friendly protector owner is adjacent to the target', () => {
    const eff = { Atk: { specialAbilityIds: [] }, Chewbacca: { specialAbilityIds: ['protector'] }, Def: { specialAbilityIds: [] } };
    const g = game({ figurePositions: { 1: { 'Atk-1-0': 'a1' }, 2: { 'Def-1-0': 'c3', 'Chewbacca-1-0': 'c4' } } });
    // Adjacent → fires.
    const fires = at('defender', g, combat(), depsAdj(eff, [['c4', 'c3']]));
    assert.equal(find(fires, 'protector').kind, 'passive');
    // Not adjacent → does not fire.
    const notFires = at('defender', g, combat(), depsAdj(eff, []));
    assert.equal(find(notFires, 'protector'), undefined);
  });

  it('Protector: suppressed when the protector owner has the Wookiee Avenger attachment', () => {
    const eff = { Atk: {}, Chewbacca: { specialAbilityIds: ['protector'] }, Def: {} };
    const g = game({ figurePositions: { 1: { 'Atk-1-0': 'a1' }, 2: { 'Def-1-0': 'c3', 'Chewbacca-1-0': 'c4' } } });
    g.p2DcAttachments = { msg1: ['Wookiee Avenger'] };
    const d = depsAdj(eff, [['c4', 'c3']]);
    d.findDcMessageIdForFigure = () => 'msg1';
    assert.equal(find(at('defender', g, combat(), d), 'protector'), undefined);
  });

  it('Sentinel: fires for a non-GUARDIAN defender, suppressed when the defender is a GUARDIAN', () => {
    const eff = { Atk: {}, RG: { specialAbilityIds: ['sentinel'] }, Def: { keywords: [] } };
    const g = game({ figurePositions: { 1: { 'Atk-1-0': 'a1' }, 2: { 'Def-1-0': 'c3', 'RG-1-0': 'c4' } } });
    const d = depsAdj(eff, [['c4', 'c3']]);
    assert.equal(find(at('defender', g, combat(), d), 'sentinel').kind, 'passive');
    // GUARDIAN defender → Sentinel does NOT shield it.
    const effG = { Atk: {}, RG: { specialAbilityIds: ['sentinel'] }, Def: { keywords: ['GUARDIAN'] } };
    const dG = depsAdj(effG, [['c4', 'c3']]);
    assert.equal(find(at('defender', g, combat({ defenderDcName: 'Def' }), dG), 'sentinel'), undefined);
  });

  it('Supporting Fire: +1 Pierce passive when ANOTHER friendly attacks a figure adjacent to J4X-7; not once used', () => {
    const eff = { Atk: {}, 'J4X-7': { specialAbilityIds: ['supporting_fire'] }, Def: {} };
    const g = game({ figurePositions: { 1: { 'Atk-1-0': 'a1', 'J4X-7-1-0': 'c4' }, 2: { 'Def-1-0': 'c3' } } });
    const d = depsAdj(eff, [['c4', 'c3']]);
    assert.equal(find(at('attacker', g, combat(), d), 'supporting_fire').kind, 'passive');
    // Once-per-activation used → suppressed.
    const gUsed = game({ figurePositions: g.figurePositions, activationAbilityUsed: { 'J4X-7:Supporting Fire': true } });
    assert.equal(find(at('attacker', gUsed, combat(), d), 'supporting_fire'), undefined);
    // J4X-7 itself attacking ("another friendly") → suppressed.
    assert.equal(find(at('attacker', g, combat({ attackerDcName: 'J4X-7' }), d), 'supporting_fire'), undefined);
  });

  it('Air Support: +2 Accuracy passive only with a spent power token, Bodhi in play, and an unfocused attacker', () => {
    const eff = { Atk: {}, 'Bodhi Rook': { specialAbilityIds: ['air_support_bodhi'] }, Def: {} };
    const g = game({ figurePositions: { 1: { 'Atk-1-0': 'a1', 'Bodhi Rook-1-0': 'b1' }, 2: { 'Def-1-0': 'c3' } } });
    const d = depsAdj(eff, []);
    // No token spent → nothing.
    assert.equal(find(at('attacker', g, combat(), d), 'air_support'), undefined);
    // Token spent + unfocused → fires.
    assert.equal(find(at('attacker', g, combat({ attackerSpentPowerToken: true }), d), 'air_support').kind, 'passive');
    // Focused attacker → suppressed.
    const gF = game({ figurePositions: g.figurePositions, figureConditions: { 'Atk-1-0': ['Focus'] } });
    assert.equal(find(at('attacker', gF, combat({ attackerSpentPowerToken: true }), d), 'air_support'), undefined);
    // Bodhi not in play → suppressed.
    const gNoBodhi = game({ figurePositions: { 1: { 'Atk-1-0': 'a1' }, 2: { 'Def-1-0': 'c3' } } });
    assert.equal(find(at('attacker', gNoBodhi, combat({ attackerSpentPowerToken: true }), d), 'air_support'), undefined);
  });

  it("The General's Ranks: +1 Damage passive only outside the owner's activation", () => {
    const eff = { Atk: {}, Def: {} };
    const d = depsAdj(eff, []);
    // Attachment present, no active activation thread → fires.
    const gOut = game({ p1DcAttachments: { msgA: ["The General's Ranks"] }, dcActionsData: { msgA: {} } });
    assert.equal(find(at('attacker', gOut, combat({ attackerMsgId: 'msgA' }), d), 'the_generals_ranks').kind, 'passive');
    // During the owner's activation (threadId set) → suppressed.
    const gIn = game({ p1DcAttachments: { msgA: ["The General's Ranks"] }, dcActionsData: { msgA: { threadId: 't1' } } });
    assert.equal(find(at('attacker', gIn, combat({ attackerMsgId: 'msgA' }), d), 'the_generals_ranks'), undefined);
    // No attachment → suppressed.
    assert.equal(find(at('attacker', game(), combat({ attackerMsgId: 'msgA' }), d), 'the_generals_ranks'), undefined);
  });

  it('Fury (Wookiee Warrior): +1 Surge passive only when the attacker has suffered 5+ Damage', () => {
    const eff = { Atk: { specialAbilityIds: ['fury_wookiee_elite'] }, Def: {} };
    // dcHealthState: Map<msgId, [[currentHp, maxHp], ...]>. Suffered = max - current.
    const hs5 = new Map([['msgA', [[5, 10]]]]); // suffered 5 → fires
    const hs4 = new Map([['msgA', [[6, 10]]]]); // suffered 4 → no
    const d5 = { ...depsAdj(eff, []), dcHealthState: hs5 };
    const d4 = { ...depsAdj(eff, []), dcHealthState: hs4 };
    const c = combat({ attackerMsgId: 'msgA', attackerFigureIndex: 0 });
    assert.equal(find(at('attacker', game(), c, d5), 'fury_wookiee').kind, 'passive');
    assert.equal(find(at('attacker', game(), c, d4), 'fury_wookiee'), undefined);
    // No Fury ability id → never offered.
    const dNo = { ...depsAdj({ Atk: { specialAbilityIds: [] }, Def: {} }, []), dcHealthState: hs5 };
    assert.equal(find(at('attacker', game(), c, dNo), 'fury_wookiee'), undefined);
  });
});
