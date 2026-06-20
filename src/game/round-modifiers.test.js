import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  registerRoundModifier,
  clearRoundModifiersUntilEor,
  evaluateRoundModifiers,
  figureMeetsConditions,
} from './round-modifiers.js';
import { resolveAbility } from './abilities.js';
import { _registerDcMessageMeta } from './activation-state.js';
import { cleanupRoundStart } from './activation-state.js';

// Real DC keyword/affiliation facts used by the condition predicates:
//   Greedo            -> kw HUNTER,SMUGGLER ; aff Scum   (no VEHICLE/TROOPER/MOBILE)
//   Onar Koma         -> kw GUARDIAN,HUNTER ; aff Scum
//   AT-DP             -> kw MASSIVE,VEHICLE,HEAVY WEAPON ; aff Imperial
//   Boba Fett         -> kw HUNTER,VEHICLE,MOBILE ; aff Scum
//   Gar Saxon         -> kw TROOPER,VEHICLE,LEADER ; aff Scum

function newGame() {
  return { gameId: 'g-rm', activeRoundModifiers: [], selectedMap: { id: 'mos-eisley-outskirts' } };
}
// On mos-eisley-outskirts: m17↔m18 = 1, m17↔p17 = 3, m17↔r17 = 7 (out of 3-range).

test('registerRoundModifier pushes and de-dupes by id', () => {
  const game = newGame();
  const d = { id: 'x', card: 'Take Position', ownerPlayerNum: 1, side: 'defense', duration: 'until-eor', conditions: {}, effect: { block: 1 } };
  assert.strictEqual(registerRoundModifier(game, d), true);
  assert.strictEqual(registerRoundModifier(game, { ...d }), false, 'same id de-duped');
  assert.strictEqual(game.activeRoundModifiers.length, 1);
});

test('registerRoundModifier initializes array when absent', () => {
  const game = { gameId: 'g' };
  registerRoundModifier(game, { id: 'a', side: 'defense', ownerPlayerNum: 1, duration: 'until-eor', conditions: {}, effect: { evade: 1 } });
  assert.strictEqual(game.activeRoundModifiers.length, 1);
});

test('evaluate sums block/evade for all-figure defense descriptors of the owner', () => {
  const game = newGame();
  registerRoundModifier(game, { id: 'tp', card: 'Take Position', ownerPlayerNum: 1, sourceFigureKey: null, side: 'defense', duration: 'until-eor', conditions: {}, effect: { block: 1 } });
  registerRoundModifier(game, { id: 'si', card: 'Survival Instincts', ownerPlayerNum: 1, sourceFigureKey: null, side: 'defense', duration: 'until-eor', conditions: {}, effect: { block: 1, evade: 1 } });
  const r = evaluateRoundModifiers(game, { side: 'defense', figureKey: 'Greedo-1-0', playerNum: 1, combat: {} });
  assert.strictEqual(r.block, 2);
  assert.strictEqual(r.evade, 1);
  assert.strictEqual(r.sources.length, 2);
});

test('evaluate ignores descriptors owned by the other player', () => {
  const game = newGame();
  registerRoundModifier(game, { id: 'tp', card: 'Take Position', ownerPlayerNum: 2, side: 'defense', duration: 'until-eor', conditions: {}, effect: { block: 1 } });
  const r = evaluateRoundModifiers(game, { side: 'defense', figureKey: 'Greedo-1-0', playerNum: 1, combat: {} });
  assert.strictEqual(r.block, 0);
});

test('evaluate ignores descriptors of the wrong side', () => {
  const game = newGame();
  registerRoundModifier(game, { id: 'ss', card: 'Smuggled Supplies', ownerPlayerNum: 1, side: 'attack', duration: 'until-eor', conditions: {}, effect: { surge: 1 } });
  const r = evaluateRoundModifiers(game, { side: 'defense', figureKey: 'Greedo-1-0', playerNum: 1, combat: {} });
  assert.strictEqual(r.surge, 0);
});

test('selfKeyword VEHICLE: only VEHICLE figures qualify (Fuel Upgrade)', () => {
  const game = newGame();
  registerRoundModifier(game, { id: 'fu', card: 'Fuel Upgrade', ownerPlayerNum: 1, side: 'defense', duration: 'until-eor', conditions: { selfKeyword: 'VEHICLE' }, effect: { evade: 1 } });
  const vehicle = evaluateRoundModifiers(game, { side: 'defense', figureKey: 'AT-DP-1-0', playerNum: 1, combat: {} });
  const nonVehicle = evaluateRoundModifiers(game, { side: 'defense', figureKey: 'Greedo-1-0', playerNum: 1, combat: {} });
  assert.strictEqual(vehicle.evade, 1);
  assert.strictEqual(nonVehicle.evade, 0);
});

test('selfKeyword TROOPER within 3 (Cavalry Charge attack hit)', () => {
  const game = newGame();
  game.figurePositions = { 1: { 'Gar Saxon-1-0': 'm18', 'Greedo-1-0': 'm17', 'Boba Fett-1-0': 'r17' } };
  registerRoundModifier(game, { id: 'cc', card: 'Cavalry Charge', ownerPlayerNum: 1, sourceFigureKey: 'Greedo-1-0', side: 'attack', duration: 'during-round', conditions: { selfKeyword: 'TROOPER', withinSpacesOfSource: 3 }, effect: { hit: 1 } });
  // Gar Saxon is TROOPER and adjacent to source → +1 Hit
  const trooper = evaluateRoundModifiers(game, { side: 'attack', figureKey: 'Gar Saxon-1-0', playerNum: 1, combat: {} });
  assert.strictEqual(trooper.hit, 1);
  // Boba Fett is not a TROOPER → nothing (also far away)
  const nonTrooper = evaluateRoundModifiers(game, { side: 'attack', figureKey: 'Boba Fett-1-0', playerNum: 1, combat: {} });
  assert.strictEqual(nonTrooper.hit, 0);
});

test('withinSpacesOfSource fails when target out of range', () => {
  const game = newGame();
  game.figurePositions = { 1: { 'Greedo-1-0': 'm17', 'Gar Saxon-1-0': 'r17' } };
  registerRoundModifier(game, { id: 'cc', card: 'Cavalry Charge', ownerPlayerNum: 1, sourceFigureKey: 'Greedo-1-0', side: 'attack', duration: 'during-round', conditions: { selfKeyword: 'TROOPER', withinSpacesOfSource: 3 }, effect: { hit: 1 } });
  const r = evaluateRoundModifiers(game, { side: 'attack', figureKey: 'Gar Saxon-1-0', playerNum: 1, combat: {} });
  assert.strictEqual(r.hit, 0, 'TROOPER out of range gets nothing');
});

test('selfIsSourceFigure: only the playing figure benefits (Personal Energy Shield / Deflection)', () => {
  const game = newGame();
  registerRoundModifier(game, { id: 'pes', card: 'Personal Energy Shield', ownerPlayerNum: 1, sourceFigureKey: 'Greedo-1-0', side: 'defense', duration: 'during-round', conditions: { selfIsSourceFigure: true }, effect: { blockPerEvade: 1 } });
  const self = evaluateRoundModifiers(game, { side: 'defense', figureKey: 'Greedo-1-0', playerNum: 1, combat: {} });
  const other = evaluateRoundModifiers(game, { side: 'defense', figureKey: 'Onar Koma-1-0', playerNum: 1, combat: {} });
  assert.strictEqual(self.blockPerEvade, 1);
  assert.strictEqual(other.blockPerEvade, 0);
});

test('excludeSourceFigure: OTHER friendly figures only (Armed Escort)', () => {
  const game = newGame();
  game.figurePositions = { 1: { 'Greedo-1-0': 'm17', 'Onar Koma-1-0': 'm18' } };
  registerRoundModifier(game, { id: 'ae', card: 'Armed Escort', ownerPlayerNum: 1, sourceFigureKey: 'Greedo-1-0', side: 'defense', duration: 'during-round', conditions: { excludeSourceFigure: true, withinSpacesOfSource: 2 }, effect: { evade: 1 } });
  const self = evaluateRoundModifiers(game, { side: 'defense', figureKey: 'Greedo-1-0', playerNum: 1, combat: {} });
  const other = evaluateRoundModifiers(game, { side: 'defense', figureKey: 'Onar Koma-1-0', playerNum: 1, combat: {} });
  assert.strictEqual(self.evade, 0, 'source figure excluded');
  assert.strictEqual(other.evade, 1, 'other friendly within 2 benefits');
});

test('attackType range: Deflection penalty only applies to Ranged attacks', () => {
  const game = newGame();
  registerRoundModifier(game, { id: 'defl', card: 'Deflection', ownerPlayerNum: 1, sourceFigureKey: 'Greedo-1-0', side: 'defense', duration: 'until-eor', conditions: { selfIsSourceFigure: true, attackType: 'range' }, effect: { accuracyPenalty: 2 } });
  const ranged = evaluateRoundModifiers(game, { side: 'defense', figureKey: 'Greedo-1-0', playerNum: 1, combat: { isRanged: true } });
  const melee = evaluateRoundModifiers(game, { side: 'defense', figureKey: 'Greedo-1-0', playerNum: 1, combat: { isRanged: false } });
  assert.strictEqual(ranged.accuracyPenalty, 2);
  assert.strictEqual(melee.accuracyPenalty, 0);
});

test('affiliationScum within 3: Just Business reroll only for Scum figures in range', () => {
  const game = newGame();
  game.figurePositions = { 1: { 'Greedo-1-0': 'm17', 'Onar Koma-1-0': 'm18', 'Gar Saxon-1-0': 'r17' } };
  registerRoundModifier(game, { id: 'jb', card: 'Just Business', ownerPlayerNum: 1, sourceFigureKey: 'Greedo-1-0', side: 'attack', duration: 'during-round', conditions: { affiliationScum: true, withinSpacesOfSource: 3 }, effect: { rerollAttackDice: 1 } });
  const scumInRange = evaluateRoundModifiers(game, { side: 'attack', figureKey: 'Onar Koma-1-0', playerNum: 1, combat: {} });
  assert.strictEqual(scumInRange.rerollAttackDice, 1);
  const scumOutOfRange = evaluateRoundModifiers(game, { side: 'attack', figureKey: 'Gar Saxon-1-0', playerNum: 1, combat: {} });
  assert.strictEqual(scumOutOfRange.rerollAttackDice, 0, 'Scum out of range gets nothing');
});

test('personalCombatShield boolean aggregation (Choose a Side SCUM)', () => {
  const game = newGame();
  registerRoundModifier(game, { id: 'cas', card: 'Choose a Side (SCUM)', ownerPlayerNum: 1, sourceFigureKey: 'Boba Fett-1-0', side: 'defense', duration: 'during-round', conditions: { selfKeyword: 'MOBILE', excludeSourceFigure: true }, effect: { personalCombatShield: true } });
  // Another MOBILE figure (not the source) → shield active
  const other = evaluateRoundModifiers(game, { side: 'defense', figureKey: 'Greedo-1-0', playerNum: 1, combat: {} });
  // Greedo is not MOBILE → no shield
  assert.strictEqual(other.personalCombatShield, false);
});

test('clearRoundModifiersUntilEor drops until-eor but keeps during-round', () => {
  const game = newGame();
  registerRoundModifier(game, { id: 'eor', card: 'Survival Instincts', ownerPlayerNum: 1, side: 'defense', duration: 'until-eor', conditions: {}, effect: { block: 1 } });
  registerRoundModifier(game, { id: 'dur', card: 'Take Position', ownerPlayerNum: 1, side: 'defense', duration: 'during-round', conditions: {}, effect: { block: 1 } });
  clearRoundModifiersUntilEor(game);
  assert.strictEqual(game.activeRoundModifiers.length, 1);
  assert.strictEqual(game.activeRoundModifiers[0].id, 'dur');
});

test('figureMeetsConditions: empty conditions always true', () => {
  const game = newGame();
  const d = { id: 'x', sourceFigureKey: null, conditions: {} };
  assert.strictEqual(figureMeetsConditions(game, d, 'Greedo-1-0', {}), true);
});

// ── Integration: resolveAbility → registry → per-figure evaluation ──────────
// Proves the key win (alexanbv 2026-06-20): a card's bonus reaches a figure
// only IF that figure meets the conditions at the moment it attacks/defends,
// including an End-of-Round-phase attack scenario.

function integrationGame(id) {
  return {
    gameId: id,
    activeRoundModifiers: [],
    selectedMap: { id: 'mos-eisley-outskirts' },
    figurePositions: { 1: {}, 2: {} },
    dcActionsData: {},
  };
}

test('Cavalry Charge (integration): +1 Hit reaches a TROOPER within 3, nothing to non-TROOPER or out-of-range', () => {
  const game = integrationGame('g-cc-int');
  const msgId = 'm-cc';
  game.dcActionsData[msgId] = { selectedFigure: 0 };
  // Source = Gar Saxon (the card-playing figure). Positions on the map.
  game.figurePositions[1] = {
    'Gar Saxon-1-0': 'm17',   // source + TROOPER (also attacker-eligible)
    'Greedo-1-0': 'm18',      // non-TROOPER within range → no hit
    'Jet Trooper (Regular)-1-0': 'p17', // TROOPER at distance 3 → in range
  };
  const dcMessageMeta = new Map([[msgId, { gameId: 'g-cc-int', playerNum: 1, dcName: 'Gar Saxon', displayName: 'Gar Saxon [Group 1]' }]]);
  _registerDcMessageMeta(dcMessageMeta);
  const r = resolveAbility('Cavalry Charge', { game, playerNum: 1, dcMessageMeta });
  assert.strictEqual(r.applied, true);

  const hitFor = (fk) => evaluateRoundModifiers(game, { side: 'attack', figureKey: fk, playerNum: 1, combat: {} }).hit;
  assert.strictEqual(hitFor('Gar Saxon-1-0'), 1, 'TROOPER source (dist 0) gets +1 Hit');
  assert.strictEqual(hitFor('Jet Trooper (Regular)-1-0'), 1, 'TROOPER at dist 3 gets +1 Hit');
  assert.strictEqual(hitFor('Greedo-1-0'), 0, 'non-TROOPER gets nothing');

  // Cavalry Charge also grants army-wide +1 Block defense.
  const blockFor = (fk) => evaluateRoundModifiers(game, { side: 'defense', figureKey: fk, playerNum: 1, combat: {} }).block;
  assert.strictEqual(blockFor('Greedo-1-0'), 1, 'army-wide +1 Block when defending');
});

test('EOR-stage attack: until-eor bonus is GONE, during-round bonus still applies per-figure', () => {
  const game = integrationGame('g-eor-int');
  // Survival Instincts (until-eor, defense +1 Block/+1 Evade, army-wide).
  const siMsg = 'm-si';
  game.dcActionsData[siMsg] = { selectedFigure: 0 };
  const siMeta = new Map([[siMsg, { gameId: 'g-eor-int', playerNum: 1, dcName: 'Greedo', displayName: 'Greedo [Group 1]' }]]);
  _registerDcMessageMeta(siMeta);
  resolveAbility('Survival Instincts', { game, playerNum: 1, dcMessageMeta: siMeta });
  // Take Position (during-round, defense +1 Block, army-wide).
  resolveAbility('Take Position', { game, playerNum: 1, dcMessageMeta: siMeta });

  // Mid-round: both apply (block 1+1 = 2, evade 1).
  let mid = evaluateRoundModifiers(game, { side: 'defense', figureKey: 'Greedo-1-0', playerNum: 1, combat: {} });
  assert.strictEqual(mid.block, 2);
  assert.strictEqual(mid.evade, 1);

  // EOR-phase start clears 'until-eor' descriptors (Survival Instincts) BEFORE
  // EOR-stage attacks resolve. 'during-round' (Take Position) persists.
  clearRoundModifiersUntilEor(game);
  let eor = evaluateRoundModifiers(game, { side: 'defense', figureKey: 'Greedo-1-0', playerNum: 1, combat: {} });
  assert.strictEqual(eor.block, 1, 'only Take Position (during-round) remains');
  assert.strictEqual(eor.evade, 0, 'Survival Instincts evade gone at EOR');

  // Round boundary clears the rest.
  cleanupRoundStart(game);
  assert.deepStrictEqual(game.activeRoundModifiers, [], 'all modifiers cleared at round boundary');
});

test('Just Business (integration): Scum within 3 gets a reroll, non-Scum and out-of-range get nothing', () => {
  const game = integrationGame('g-jb-int');
  const msgId = 'm-jb';
  game.dcActionsData[msgId] = { selectedFigure: 0 };
  game.figurePositions[1] = {
    'Greedo-1-0': 'm17',                 // source (Scum)
    'Onar Koma-1-0': 'm18',              // Scum within 3
    'Jet Trooper (Regular)-1-0': 'p17',  // Imperial within 3 → no reroll
    'Boba Fett-1-0': 'r17',              // Scum but out of range (dist 7)
  };
  const dcMessageMeta = new Map([[msgId, { gameId: 'g-jb-int', playerNum: 1, dcName: 'Greedo', displayName: 'Greedo [Group 1]' }]]);
  _registerDcMessageMeta(dcMessageMeta);
  resolveAbility('Just Business', { game, playerNum: 1, dcMessageMeta });

  const rerollFor = (fk) => evaluateRoundModifiers(game, { side: 'attack', figureKey: fk, playerNum: 1, combat: {} }).rerollAttackDice;
  assert.strictEqual(rerollFor('Onar Koma-1-0'), 1, 'Scum within 3 gets a reroll');
  assert.strictEqual(rerollFor('Jet Trooper (Regular)-1-0'), 0, 'non-Scum gets nothing');
  assert.strictEqual(rerollFor('Boba Fett-1-0'), 0, 'Scum out of range gets nothing');
});
