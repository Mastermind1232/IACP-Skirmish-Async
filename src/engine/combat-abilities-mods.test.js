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

  it('defender Defensive Stance passive appears only on a dodge', () => {
    const d = deps({ Atk: {}, Def: { specialAbilityIds: ['defensive_stance'] } });
    assert.equal(find(at('defender', game(), combat(), d), 'defensive_stance'), undefined);
    const dodge = at('defender', game(), combat({ defenseRoll: { dodge: true } }), d);
    assert.equal(find(dodge, 'defensive_stance').kind, 'passive');
  });

  it('R2-D2 Lucky passive appears only on a BLANK defense-die result (not a dodge)', () => {
    const d = deps({ Atk: {}, Def: { specialAbilityIds: ['lucky_r2d2'] } });
    // A dodge (no blank face) does NOT trigger Lucky — it triggers on a blank.
    const dodgeOnly = combat({ defenseRoll: { dodge: true }, defenseDiceResults: [{ block: 1, evade: 0, dodge: false }, { block: 0, evade: 0, dodge: true }] });
    assert.equal(find(at('defender', game(), dodgeOnly, d), 'lucky'), undefined);
    // A blank face (0 block / 0 evade / no dodge) DOES trigger Lucky.
    const withBlank = combat({ defenseRoll: { block: 1, dodge: false }, defenseDiceResults: [{ block: 1, evade: 0, dodge: false }, { block: 0, evade: 0, dodge: false }] });
    assert.equal(find(at('defender', game(), withBlank, d), 'lucky').kind, 'passive');
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

describe('FIX-1/2/3 mods gating via the timing registry', () => {
  // ── FIX-1: Charge Generators (AT-DP) — +1 Damage half at MODS, gated suffered<9
  it('charge_generators (mods +1 Damage): offered while suffered<9, gone at >=9', () => {
    const eff = { 'AT-DP': { specialAbilityIds: ['charge_generators'] }, Def: {} };
    const c = combat({ attackerDcName: 'AT-DP', attackerMsgId: 'm', attackerFigureIndex: 0 });
    const dLt = { ...deps(eff), dcHealthState: new Map([['m', [[8, 16]]]]) }; // suffered 8 < 9
    const dGe = { ...deps(eff), dcHealthState: new Map([['m', [[7, 16]]]]) }; // suffered 9
    assert.equal(find(at('attacker', game(), c, dLt), 'charge_generators').kind, 'interactive');
    assert.equal(find(at('attacker', game(), c, dGe), 'charge_generators'), undefined);
    // Once used this attack → no longer offered.
    const cUsed = { ...c, _abilityUsedThisAttack: { 'AT-DP:Charge Generators (+1 Damage)': true } };
    assert.equal(find(at('attacker', game(), cUsed, dLt), 'charge_generators'), undefined);
  });

  // ── FIX-2: Rogue One — needs a listed attacker + Rogue One upgrade + ally token
  it('rogue_one: offered only with a listed figure, the upgrade, and an ally Power Token', () => {
    const eff = { 'Cassian Andor': {}, 'Jyn Erso': {}, Def: {} };
    const base = game({
      figurePositions: { 1: { 'Cassian Andor-1-0': 'a1', 'Jyn Erso-1-0': 'a2' }, 2: { 'Def-1-0': 'c3' } },
      figurePowerTokens: { 'Jyn Erso-1-0': ['Damage'] },
      p1DcList: [{ dcName: '[Rogue One]' }, { dcName: 'Cassian Andor' }],
    });
    const c = combat({ attackerFigureKey: 'Cassian Andor-1-0', attackerDcName: 'Cassian Andor' });
    assert.equal(find(at('attacker', base, c, deps(eff)), 'rogue_one').kind, 'interactive');
    // No ally token → not offered.
    const noTok = game({ ...base, figurePowerTokens: {} });
    assert.equal(find(at('attacker', noTok, c, deps(eff)), 'rogue_one'), undefined);
    // No Rogue One upgrade → not offered.
    const noUpg = game({ ...base, p1DcList: [{ dcName: 'Cassian Andor' }] });
    assert.equal(find(at('attacker', noUpg, c, deps(eff)), 'rogue_one'), undefined);
  });

  // ── FIX-2: Illicit Arms — usable by ANY friendly figure; only restriction is
  // the player's ARMY affiliation = Scum (alexanbv 2026-06-18). Gated on a Bib
  // Fortuna (Illicit Arms) in play + a Scum army + a Command card in hand.
  it('illicit_arms: Scum army + Bib Fortuna in play + a Command card (any attacking figure)', () => {
    // Attacker figure (Atk) is non-Scum ("Any"); army primary affiliation is Scum.
    const eff = { Atk: { affiliation: 'Any' }, 'Bib Fortuna': { specialAbilityIds: ['illicit_arms_bib'], affiliation: 'Scum' }, Def: {} };
    const g = game({
      figurePositions: { 1: { 'Atk-1-0': 'a1', 'Bib Fortuna-1-0': 'a2' }, 2: { 'Def-1-0': 'c3' } },
      p1DcList: [{ dcName: 'Bib Fortuna' }, { dcName: 'Atk' }],
      player1CcHand: ['Tough Luck'],
    });
    // Offered even though the attacking figure itself is not SCUM (any figure may use it).
    assert.equal(find(at('attacker', g, combat(), deps(eff)), 'illicit_arms').kind, 'interactive');
    // No CC in hand → not offered.
    const noCc = game({ ...g, player1CcHand: [] });
    assert.equal(find(at('attacker', noCc, combat(), deps(eff)), 'illicit_arms'), undefined);
    // Non-Scum ARMY → not offered (the restriction is army affiliation, not the figure).
    const effImp = { Atk: { affiliation: 'Imperial' }, 'Bib Fortuna': { specialAbilityIds: ['illicit_arms_bib'], affiliation: 'Imperial' }, Def: {} };
    assert.equal(find(at('attacker', g, combat(), deps(effImp)), 'illicit_arms'), undefined);
    // Bib Fortuna not in play → not offered even in a Scum army.
    const noBib = game({ ...g, figurePositions: { 1: { 'Atk-1-0': 'a1' }, 2: { 'Def-1-0': 'c3' } } });
    assert.equal(find(at('attacker', noBib, combat(), deps(eff)), 'illicit_arms'), undefined);
    // MIGRATED (deleted combat-behavioral reroll cluster): once per attack —
    // not re-offered after a prior use this attack.
    const cUsed = combat({ _abilityUsedThisAttack: { 'Bib Fortuna:Illicit Arms': true } });
    assert.equal(find(at('attacker', g, cUsed, deps(eff)), 'illicit_arms'), undefined);
  });

  // ── FIX-2: Zillo Block Boost — defender [Zillo Technique] + a CC in hand
  it('zillo_technique_discard (Block Boost): requires [Zillo Technique] + a CC in hand', () => {
    const g = game({ p2DcList: [{ dcName: '[Zillo Technique]' }], player2CcHand: ['Tough Luck'] });
    assert.equal(find(at('defender', g, combat(), deps({ Atk: {}, Def: {} })), 'zillo_technique_discard').kind, 'interactive');
    // No CC in hand → not offered.
    const noCc = game({ ...g, player2CcHand: [] });
    assert.equal(find(at('defender', noCc, combat(), deps({ Atk: {}, Def: {} })), 'zillo_technique_discard'), undefined);
    // No Zillo card → not offered.
    const noZt = game({ ...g, p2DcList: [] });
    assert.equal(find(at('defender', noZt, combat(), deps({ Atk: {}, Def: {} })), 'zillo_technique_discard'), undefined);
  });

  // ── MIGRATED from deleted combat-zillo-discard-step4-timing.test.js: the
  // discard-CC for +1 Block is a once-per-attack option regardless of exhaust.
  it('zillo_technique_discard (Block Boost): once per attack — not re-offered after a use this attack', () => {
    const g = game({ p2DcList: [{ dcName: '[Zillo Technique]' }], player2CcHand: ['Tough Luck', 'Element of Surprise'] });
    // Fresh attack → offered (even with multiple CCs in hand).
    assert.equal(find(at('defender', g, combat(), deps({ Atk: {}, Def: {} })), 'zillo_technique_discard').kind, 'interactive');
    // Used once this attack → NOT re-offered (the per-attack flag suppresses it).
    const cUsed = combat({ _abilityUsedThisAttack: { '[Zillo Technique]:Block Boost': true } });
    assert.equal(find(at('defender', g, cUsed, deps({ Atk: {}, Def: {} })), 'zillo_technique_discard'), undefined);
    // An unrelated ability's per-attack mark does NOT block it.
    const cOther = combat({ _abilityUsedThisAttack: { something_else: true } });
    assert.equal(find(at('defender', g, cOther, deps({ Atk: {}, Def: {} })), 'zillo_technique_discard').kind, 'interactive');
  });

  // ── IACP 2026-06-21: Guidance Systems — LIMIT once per attack; stops at Damage 0
  it('guidance_systems: SU-figure-scoped, once-per-attack, gated on the [Mortar Trooper] attachment + Damage>0', () => {
    const g = game({ p1DcAttachments: { m: ['[Mortar Trooper]'] } });
    // The Mortar SU FIGURE is the attacker (combat.suAttackerCard).
    const c = combat({ attackerMsgId: 'm', suAttackerCard: 'Mortar Trooper', attackRoll: { dmg: 3 } });
    assert.equal(find(at('attacker', g, c, deps({ Atk: {}, Def: {} })), 'guidance_systems').kind, 'interactive');
    // NOT re-offered after a prior use this attack (once per attack).
    const cUsed = { ...c, _abilityUsedThisAttack: { '[Mortar Trooper]:Guidance Systems': true } };
    assert.equal(find(at('attacker', g, cUsed, deps({ Atk: {}, Def: {} })), 'guidance_systems'), undefined);
    // An unrelated ability's per-attack mark does NOT block it.
    const cOther = { ...c, _abilityUsedThisAttack: { 'whatever': true } };
    assert.equal(find(at('attacker', g, cOther, deps({ Atk: {}, Def: {} })), 'guidance_systems').kind, 'interactive');
    // Damage already 0 → -1 would underflow → not offered.
    const c0 = combat({ attackerMsgId: 'm', suAttackerCard: 'Mortar Trooper', attackRoll: { dmg: 0 }, bonusHits: 0 });
    assert.equal(find(at('attacker', g, c0, deps({ Atk: {}, Def: {} })), 'guidance_systems'), undefined);
    // No Mortar Trooper attachment → not offered.
    const noAtt = game({ p1DcAttachments: { m: [] } });
    assert.equal(find(at('attacker', noAtt, c, deps({ Atk: {}, Def: {} })), 'guidance_systems'), undefined);
    // A BASE group-mate (attachment present, but not the SU figure) → not offered.
    const cBase = combat({ attackerMsgId: 'm', attackerFigureKey: 'Shoretrooper-1-0', attackRoll: { dmg: 3 } });
    assert.equal(find(at('attacker', g, cBase, deps({ Atk: {}, Def: {} })), 'guidance_systems'), undefined);
  });
});

describe('Deferred condition-based mods passives (2026-06-18)', () => {
  // These use the REAL map (chopper-base-atollon) since their conditions read
  // getMapData() directly, not the injected deps.getMapData. n4 is 'blocking';
  // m4/n3 share a corner/edge with n4; l3↔l4 adjacent.
  const MAP = { id: 'chopper-base-atollon' };

  it('set_your_sights (attacker): fires iff target has a Recon token AND a friendly Loku is in play', () => {
    const d = deps({ 'Loku Kanoloa': { specialAbilityIds: ['set_your_sights_loku'] }, Atk: { specialAbilityIds: [] }, Stormtrooper: {} });
    const g = (recon, withLoku = true) => game({
      selectedMap: MAP, reconTokens: recon,
      figurePositions: { 1: withLoku ? { 'Atk-1-0': 'l3', 'Loku Kanoloa-1-1': 'm3' } : { 'Atk-1-0': 'l3' }, 2: { 'Stormtrooper-2-0': 'n3' } },
    });
    // Recon tokens are OWNER-keyed: game.reconTokens[playerNum] = { figureKey }.
    const c = combat({ attackerPlayerNum: 1, attackerDcName: 'Atk', target: { figureKey: 'Stormtrooper-2-0' }, defenderDcName: 'Stormtrooper' });
    assert.equal(find(at('attacker', g({ 1: { figureKey: 'Stormtrooper-2-0' } }), c, d), 'set_your_sights')?.kind, 'passive', 'recon + Loku → offered');
    assert.equal(find(at('attacker', g({}), c, d), 'set_your_sights'), undefined, 'no recon token → not offered');
    // Token on a DIFFERENT figure → not offered (must sit on the target).
    assert.equal(find(at('attacker', g({ 1: { figureKey: 'Other-2-9' } }), c, d), 'set_your_sights'), undefined, 'token on another figure → not offered');
    assert.equal(find(at('attacker', g({ 1: { figureKey: 'Stormtrooper-2-0' } }, false), c, d), 'set_your_sights'), undefined, 'no Loku in play → not offered');
  });

  it('hunker_down (defender): +1 Evade only when Cara Dune shares a corner/edge with blocking terrain', () => {
    const d = deps({ Atk: {}, 'Cara Dune': { specialAbilityIds: ['hunker_down'] } });
    const g = (cell) => game({ selectedMap: MAP, figurePositions: { 1: { 'Atk-1-0': 'a1' }, 2: { 'Cara Dune-2-0': cell } } });
    const c = combat({ target: { figureKey: 'Cara Dune-2-0' }, defenderDcName: 'Cara Dune' });
    assert.equal(find(at('defender', g('m4'), c, d), 'hunker_down')?.kind, 'passive', 'adjacent to blocking n4 → offered');
    assert.equal(find(at('defender', g('l3'), c, d), 'hunker_down'), undefined, 'clear of terrain → not offered');
    const noSid = deps({ Atk: {}, 'Cara Dune': { specialAbilityIds: [] } });
    assert.equal(find(at('defender', g('m4'), c, noSid), 'hunker_down'), undefined, 'no hunker_down sid → not offered');
  });

  it('improvised_cover_verena (defender): +1 Block when adjacent to an object or non-friendly figure', () => {
    const d = deps({ Atk: {}, Other: {}, 'Verena Talos': { specialAbilityIds: ['improvised_cover_verena'] } });
    const c = combat({ attackerFigureKey: 'Atk-1-0', target: { figureKey: 'Verena Talos-2-0' }, defenderDcName: 'Verena Talos' });
    const gEnemy = game({ selectedMap: MAP, figurePositions: { 1: { 'Atk-1-0': 'm8', 'Other-1-1': 'l4' }, 2: { 'Verena Talos-2-0': 'l3' } } });
    assert.equal(find(at('defender', gEnemy, c, d), 'improvised_cover_verena')?.kind, 'passive', 'adjacent enemy → offered');
    const gAlone = game({ selectedMap: MAP, figurePositions: { 1: { 'Atk-1-0': 'm8' }, 2: { 'Verena Talos-2-0': 'l3' } } });
    assert.equal(find(at('defender', gAlone, c, d), 'improvised_cover_verena'), undefined, 'nothing adjacent → not offered');
  });

  it('vague_and_unconvincing (defender): offered iff K-2SO is the defender', () => {
    const d = deps({ Atk: {}, 'K-2S0': { specialAbilityIds: ['vague_and_unconvincing_k2s0'] }, Other: { specialAbilityIds: [] } });
    const cK2 = combat({ target: { figureKey: 'K-2S0-2-0' }, defenderDcName: 'K-2S0' });
    assert.equal(find(at('defender', game({ selectedMap: MAP }), cK2, d), 'vague_and_unconvincing')?.kind, 'passive');
    const cOther = combat({ target: { figureKey: 'Other-2-0' }, defenderDcName: 'Other' });
    assert.equal(find(at('defender', game({ selectedMap: MAP }), cOther, d), 'vague_and_unconvincing'), undefined);
  });
});
