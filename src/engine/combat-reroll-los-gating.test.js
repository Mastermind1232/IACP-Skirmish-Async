import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { abilitiesForWindow, getCombatAbility } from './combat-timing-registry.js';
import './combat-mods-gate.js'; // self-registers all data-driven combat abilities
import { COMBAT_RESOLVERS } from '../handlers/combat.js';

// LINE-OF-SIGHT gated reroll/mods abilities (gate-rework 2026-06-18). Each must be
// offered ONLY when its LOS condition holds. A real map with a blocking topology
// is needed: on chopper-base-atollon, l3↔m3 have LOS (and are adjacent / within 3),
// while l3↔i5 have NO LOS — so positioning a friendly at m3 vs i5 toggles the gate.
const MAP = { id: 'chopper-base-atollon' };
const idsR = (side, game, combat) => abilitiesForWindow('rerolls', side, game, combat, {}).map((a) => a.id);
const idsM = (side, game, combat) => abilitiesForWindow('mods', side, game, combat, {}).map((a) => a.id);

describe('Coordinated Hunt (Purge Commander) — LOS-gated reroll', () => {
  // A friendly HUNTER attacker (Bossk) at l3 + Purge Commander (the OWNER) whose
  // LOS to that HUNTER attacker toggles the reroll. Per the card the ATTACKER must
  // be a HUNTER (or Purge Commander itself) and Purge Commander must be in play
  // (alexanbv 2026-06-24). The owner-self branch is covered separately.
  const game = (pcCell) => ({
    selectedMap: MAP,
    figurePositions: { 1: { 'Bossk-1-0': 'l3', 'Purge Commander (Elite)-1-1': pcCell }, 2: { 'X-2-0': 'a1' } },
  });
  const combat = {
    attackerPlayerNum: 1, defenderPlayerNum: 2,
    attackerDcName: 'Bossk', attackerFigureKey: 'Bossk-1-0',
    target: { figureKey: 'X-2-0', coord: 'a1' }, attackDiceResults: [{ color: 'blue', dmg: 1 }],
  };
  it('IS offered when Purge Commander (owner) has LOS to the HUNTER attacker', () => {
    assert.ok(idsR('attacker', game('m3'), combat).includes('reroll:purge_commander_elite:attacker'));
  });
  it('is NOT offered when Purge Commander has no LOS to the HUNTER attacker', () => {
    assert.ok(!idsR('attacker', game('i5'), combat).includes('reroll:purge_commander_elite:attacker'));
  });
  it('is NOT offered when Purge Commander is not in the game (the reported bug)', () => {
    const g = { selectedMap: MAP, figurePositions: { 1: { 'Bossk-1-0': 'l3' }, 2: { 'X-2-0': 'a1' } } };
    assert.ok(!idsR('attacker', g, combat).includes('reroll:purge_commander_elite:attacker'));
  });
  it('IS offered to the Purge Commander itself (self branch)', () => {
    const g = { selectedMap: MAP, figurePositions: { 1: { 'Purge Commander (Elite)-1-0': 'l3' }, 2: { 'X-2-0': 'a1' } } };
    const c = { ...combat, attackerDcName: 'Purge Commander (Elite)', attackerFigureKey: 'Purge Commander (Elite)-1-0' };
    assert.ok(idsR('attacker', g, c).includes('reroll:purge_commander_elite:attacker'));
  });
  it('is NOT offered under noFriendliesActive (Lure / False Orders) — owner LOS branch', () => {
    assert.ok(!idsR('attacker', game('m3'), { ...combat, noFriendliesActive: true }).includes('reroll:purge_commander_elite:attacker'));
  });
  it('is NOT offered under noFriendliesActive even to the Purge Commander itself (self branch)', () => {
    const g = { selectedMap: MAP, figurePositions: { 1: { 'Purge Commander (Elite)-1-0': 'l3' }, 2: { 'X-2-0': 'a1' } } };
    const c = { ...combat, attackerDcName: 'Purge Commander (Elite)', attackerFigureKey: 'Purge Commander (Elite)-1-0', noFriendliesActive: true };
    assert.ok(!idsR('attacker', g, c).includes('reroll:purge_commander_elite:attacker'));
  });
});

describe('Shared Calculations (Zuckuss) — friendly DROID within 3 with LOS to target', () => {
  const game = (droidCell) => ({
    selectedMap: MAP,
    figurePositions: { 1: { 'Zuckuss-1-0': 'l3', 'IG-88-1-1': droidCell }, 2: { 'X-2-0': 'm3' } },
  });
  const combat = {
    attackerPlayerNum: 1, defenderPlayerNum: 2,
    attackerDcName: 'Zuckuss', attackerFigureKey: 'Zuckuss-1-0',
    target: { figureKey: 'X-2-0', coord: 'm3' }, defenseDiceResults: [{ color: 'white', block: 1 }],
  };
  it('IS offered when a friendly DROID within 3 has LOS to the target space', () => {
    assert.ok(idsR('attacker', game('m4'), combat).includes('reroll:zuckuss:attacker'));
  });
  it('is NOT offered when the DROID is out of range / has no LOS to the target', () => {
    assert.ok(!idsR('attacker', game('i5'), combat).includes('reroll:zuckuss:attacker'));
  });
});

describe('Light It Up (Rebel Pathfinder) — target had no LOS to attacker activation-start', () => {
  const game = (startCell) => ({
    selectedMap: MAP,
    activationStartPositions: { 'Rebel Pathfinder (Elite)-1-0': startCell },
    figurePositions: { 1: { 'Rebel Pathfinder (Elite)-1-0': 'm3' }, 2: { 'X-2-0': 'i5' } },
  });
  const combat = {
    attackerPlayerNum: 1, defenderPlayerNum: 2,
    attackerDcName: 'Rebel Pathfinder (Elite)', attackerFigureKey: 'Rebel Pathfinder (Elite)-1-0',
    target: { figureKey: 'X-2-0', coord: 'i5' }, attackDiceResults: [{ color: 'blue', dmg: 1 }],
  };
  it('IS offered when the target had NO LOS to the attacker start cell (l3→i5 blocked)', () => {
    assert.ok(idsR('attacker', game('l3'), combat).includes('reroll:rebel_pathfinder_elite:attacker'));
  });
  it('is NOT offered when the target HAD LOS to the attacker start cell (same cell)', () => {
    assert.ok(!idsR('attacker', game('i5'), combat).includes('reroll:rebel_pathfinder_elite:attacker'));
  });
});

describe('Shared Intuition (4-LOM) — mods passive +1 Damage, LOS-gated', () => {
  const game = (hunterCell) => ({
    selectedMap: MAP,
    figurePositions: { 1: { '4-LOM-1-0': 'l3', 'Zuckuss-1-1': hunterCell }, 2: { 'X-2-0': 'm3' } },
  });
  const combat = {
    attackerPlayerNum: 1, defenderPlayerNum: 2,
    attackerDcName: '4-LOM', attackerFigureKey: '4-LOM-1-0',
    target: { figureKey: 'X-2-0', coord: 'm3' },
  };
  it('registers as a mods-window attacker passive (not a timing-only on_declare placeholder)', () => {
    const a = getCombatAbility('shared_intuition');
    assert.deepEqual(a.windows, ['mods']);
    assert.equal(a.side, 'attacker');
    assert.equal(typeof a.applies, 'function');
  });
  it('IS offered when a friendly HUNTER within 3 has LOS to the target space', () => {
    assert.ok(idsM('attacker', game('m4'), combat).includes('shared_intuition'));
  });
  it('is NOT offered when the HUNTER is out of range / has no LOS to the target', () => {
    assert.ok(!idsM('attacker', game('i5'), combat).includes('shared_intuition'));
  });
});

describe('Distracting (Han Solo / C-3PO) — mods passive +1 Evade, adjacency-gated (gate-rework port)', () => {
  // A defender figure carrying a distracting_* ability adjacent to the targeted
  // space grants the defender +1 Evade. l3↔m3 are adjacent on this map.
  const game = (c3poCell) => ({
    selectedMap: MAP,
    figurePositions: { 1: { 'A-1-0': 'a1' }, 2: { 'X-2-0': 'm3', 'C-3P0-2-1': c3poCell } },
  });
  const combat = {
    attackerPlayerNum: 1, defenderPlayerNum: 2,
    attackerDcName: 'A', attackerFigureKey: 'A-1-0',
    target: { figureKey: 'X-2-0', coord: 'm3' },
  };
  it('registers as an executable mods-window defender passive', () => {
    const a = getCombatAbility('distracting');
    assert.deepEqual(a.windows, ['mods']);
    assert.equal(a.side, 'defender');
    assert.equal(typeof a.applies, 'function');
    assert.ok(!a.timingOnly);
  });
  it('IS offered when a friendly figure with Distracting is adjacent to the target', () => {
    assert.ok(idsM('defender', game('l3'), combat).includes('distracting'));
  });
  it('is NOT offered when the Distracting figure is not adjacent to the target', () => {
    assert.ok(!idsM('defender', game('i5'), combat).includes('distracting'));
  });
});

describe('Sling Barrage (Ewok Warrior Elite) — rerolls slot per group-mate with LOS to defender (gate-rework port)', () => {
  // Armed by the special action (game.pendingSlingBarrage[figureKey]); one slot
  // offered per OTHER group figure with LOS to the defender. m3↔m4 adjacent (LOS).
  const game = (mateCell, armed = true) => ({
    selectedMap: MAP,
    pendingSlingBarrage: armed ? { 'Ewok Warrior (Elite)-1-0': true } : {},
    figurePositions: { 1: { 'Ewok Warrior (Elite)-1-0': 'l3', 'Ewok Warrior (Elite)-1-1': mateCell }, 2: { 'X-2-0': 'm4' } },
  });
  const combat = {
    attackerPlayerNum: 1, defenderPlayerNum: 2,
    attackerDcName: 'Ewok Warrior (Elite)', attackerFigureKey: 'Ewok Warrior (Elite)-1-0',
    target: { figureKey: 'X-2-0', coord: 'm4' }, attackDiceResults: [{ color: 'blue', dmg: 1 }],
  };
  it('offers slot 0 when one group-mate has LOS to the defender', () => {
    assert.ok(idsR('attacker', game('m3'), combat).includes('reroll:sling_barrage:attacker:0'));
  });
  it('does NOT offer slot 1 when only one group-mate has LOS (bonus = 1)', () => {
    assert.ok(!idsR('attacker', game('m3'), combat).includes('reroll:sling_barrage:attacker:1'));
  });
  it('is NOT offered when the special action did not arm pendingSlingBarrage', () => {
    assert.ok(!idsR('attacker', game('m3', false), combat).includes('reroll:sling_barrage:attacker:0'));
  });
  it('is NOT offered when the group-mate has no LOS to the defender', () => {
    // a1 has no LOS to the defender at m4 on this map.
    assert.ok(!idsR('attacker', game('a1'), combat).includes('reroll:sling_barrage:attacker:0'));
  });
});

describe('forcedRerollQueue drain — gate rerolls window surfaces queued grants', () => {
  const game = { selectedMap: MAP, figurePositions: { 1: { 'A-1-0': 'l3' }, 2: { 'B-2-0': 'm3' } } };
  const combat = (queue) => ({
    attackerPlayerNum: 1, defenderPlayerNum: 2,
    attackerDcName: 'A', attackerFigureKey: 'A-1-0', defenderDcName: 'B', target: { figureKey: 'B-2-0', coord: 'm3' },
    attackDiceResults: [{ color: 'blue', dmg: 1 }], defenseDiceResults: [{ color: 'white', block: 1 }],
    forcedRerollQueue: queue,
  });
  it('surfaces a Guardian-Stance-style grant (controlPlayer=defender, pool any) in the defender gate', () => {
    const q = [{ controlPlayer: 2, pool: 'any', remaining: 1, source: 'Guardian Stance' }];
    assert.ok(idsR('defender', game, combat(q)).includes('forced_reroll:defender:0'));
  });
  it('does NOT surface a defender grant in the attacker gate', () => {
    const q = [{ controlPlayer: 2, pool: 'any', remaining: 1, source: 'Guardian Stance' }];
    assert.ok(!idsR('attacker', game, combat(q)).some((id) => id.startsWith('forced_reroll')));
  });
  it('surfaces an attacker grant (Battlefield Awareness) in the attacker gate', () => {
    const q = [{ controlPlayer: 1, pool: 'any', remaining: 1, source: 'Battlefield Awareness' }];
    assert.ok(idsR('attacker', game, combat(q)).includes('forced_reroll:attacker:0'));
  });
  it('offers one SLOT per pending grant (two grants → two slots)', () => {
    const q = [
      { controlPlayer: 2, pool: 'any', remaining: 1, source: 'Guardian Stance' },
      { controlPlayer: 2, pool: 'defense', remaining: 1, source: 'Cross Training' },
    ];
    const ids = idsR('defender', game, combat(q)).filter((id) => id.startsWith('forced_reroll'));
    assert.deepEqual(ids.sort(), ['forced_reroll:defender:0', 'forced_reroll:defender:1']);
  });
  it('does NOT surface a slot for an empty queue or a remaining:0 entry', () => {
    assert.ok(!idsR('defender', game, combat([])).some((id) => id.startsWith('forced_reroll')));
    const q = [{ controlPlayer: 2, pool: 'any', remaining: 0, source: 'Guardian Stance' }];
    assert.ok(!idsR('defender', game, combat(q)).some((id) => id.startsWith('forced_reroll')));
  });
});

describe('Defensive Stance (Diala Passil) reroll RIDER — converts Dodge to 2 Block + 1 Evade', () => {
  it('on a non-skip reroll that yields a Dodge, converts each Dodge to +2 Block, +1 Evade and clears it', async () => {
    const r = COMBAT_RESOLVERS['reroll:diala_passil:defender'];
    assert.ok(r && typeof r.apply === 'function');
    const combat = {
      attackerPlayerNum: 1, defenderPlayerNum: 2, target: { figureKey: 'Diala Passil-2-0' },
      defenseDiceResults: [{ color: 'white', block: 0, evade: 0, dodge: false }],
      defenseRoll: { block: 0, evade: 0, dodge: false },
      defenseDiceTotals: { block: 0, evade: 0, dodge: false },
    };
    // Stub ctx so rerollDie produces a Dodge on the rerolled die and recompute sets
    // the roll's dodge flag (mirrors the live recalc the conversion reads).
    const ctx = {
      rollSingleDefenseDie: () => ({ color: 'white', block: 0, evade: 0, dodge: true }),
      recalcDefenseTotals: () => { combat.defenseRoll = { block: 0, evade: 0, dodge: true }; return { block: 0, evade: 0, dodge: true }; },
    };
    const sent = [];
    const thread = { send: async (m) => { sent.push(typeof m === 'string' ? m : m.content); } };
    await r.apply('0', { game: {}, combat, thread, ctx, gameId: 'g', id: 'reroll:diala_passil:defender' });
    assert.equal(combat.defenseRoll.dodge, false, 'Dodge consumed by conversion');
    assert.equal(combat.defenseRoll.block, 2, 'Dodge → +2 Block');
    assert.equal(combat.defenseRoll.evade, 1, 'Dodge → +1 Evade');
    assert.ok(sent.some((s) => /Dodge converted to \+2 Block, \+1 Evade/.test(s)));
  });
  it('does NOT convert when the player SKIPs the reroll', async () => {
    const r = COMBAT_RESOLVERS['reroll:diala_passil:defender'];
    const combat = {
      attackerPlayerNum: 1, defenderPlayerNum: 2, target: { figureKey: 'Diala Passil-2-0' },
      defenseDiceResults: [{ color: 'white', block: 0, evade: 0, dodge: true }],
      defenseRoll: { block: 0, evade: 0, dodge: true },
    };
    const thread = { send: async () => {} };
    await r.apply('skip', { game: {}, combat, thread, ctx: {}, gameId: 'g', id: 'reroll:diala_passil:defender' });
    assert.equal(combat.defenseRoll.dodge, true, 'Dodge untouched on skip');
    assert.equal(combat.defenseRoll.block, 0);
  });
});
