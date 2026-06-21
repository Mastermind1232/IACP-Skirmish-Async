import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  registerRoundModifier,
  clearRoundModifiersUntilEor,
  evaluateRoundModifiers,
  evaluateFigureAuras,
  buildFigureAuraDescriptors,
  figureMeetsConditions,
} from './round-modifiers.js';
import { FIGURE_AURA_DESCRIPTORS } from './figure-auras.js';
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

  // Cavalry Charge's "+1 Block when defending" is FIGURE-SCOPED to the playing
  // figure (alexanbv 2026-06-20: "'you' = ONLY the figure that played the
  // card"). The anchor resolves to the named unique figure (Captain Terro) via
  // resolveUniqueFigureCcFigureKey when there's no activation, but in this
  // integration the activating figure (Gar Saxon) is the anchor.
  const blockFor = (fk) => evaluateRoundModifiers(game, { side: 'defense', figureKey: fk, playerNum: 1, combat: {} }).block;
  assert.strictEqual(blockFor('Gar Saxon-1-0'), 1, 'playing figure gets +1 Block when defending');
  assert.strictEqual(blockFor('Greedo-1-0'), 0, 'a different friendly figure gets NO Block (figure-scoped)');
});

test('EOR-stage attack: until-eor bonus is GONE, during-round bonus still applies per-figure', () => {
  const game = integrationGame('g-eor-int');
  // Survival Instincts (until-eor, defense +1 Block/+1 Evade, FIGURE-SCOPED to
  // the playing figure Greedo). We register figure positions so Greedo is the
  // resolvable anchor for both cards.
  game.figurePositions[1] = { 'Greedo-1-0': 'm17' };
  const siMsg = 'm-si';
  game.dcActionsData[siMsg] = { selectedFigure: 0 };
  const siMeta = new Map([[siMsg, { gameId: 'g-eor-int', playerNum: 1, dcName: 'Greedo', displayName: 'Greedo [Group 1]' }]]);
  _registerDcMessageMeta(siMeta);
  resolveAbility('Survival Instincts', { game, playerNum: 1, dcMessageMeta: siMeta });
  // Take Position (during-round, defense +1 Block, FIGURE-SCOPED to Greedo).
  resolveAbility('Take Position', { game, playerNum: 1, dcMessageMeta: siMeta });

  // Mid-round: both apply to the playing figure Greedo (block 1+1 = 2, evade 1).
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

// ── LIVE-SCENARIO anchor resolution (alexanbv 2026-06-20 ruling) ────────────
// These tests exercise each card under its REAL play timing with NO manual
// sourceFigureKey injection — they prove resolveRoundModifierAnchor resolves a
// correct NON-NULL anchor through the real code path:
//   - Deflection (defender reaction, no activation): anchor = the DEFENDER being
//     attacked (game.pendingCombat.target.figureKey).
//   - Cavalry Charge (start_of_round, no activation, no combat): anchor = the
//     card's named unique figure (Captain Terro) via the unique-figure-cc map.
//   - Take Position (during activation): anchor = the ACTIVATING figure only; a
//     DIFFERENT friendly figure gets nothing.
// Before this fix Deflection and Cavalry Charge resolved a NULL anchor at real
// play time (no activation present), so selfIsSourceFigure / the TROOPER
// position check silently never matched — REGRESSED. These prove the fix.

test('LIVE Deflection (defender reaction, no activation): anchor = attacked defender, −2 Acc vs Ranged', () => {
  // Player 2 is the DEFENDER. Player 1 (attacker) is mid-attack: there is NO
  // activation for player 2, so the OLD findActiveActivationMsgId path returned
  // null and Deflection's selfIsSourceFigure descriptor never matched. The new
  // anchor falls back to pendingCombat.target.figureKey (the defender).
  const game = integrationGame('g-defl-live');
  game.figurePositions[2] = { 'Onar Koma-2-0': 'm17' };
  game.pendingCombat = {
    attackerPlayerNum: 1,
    isRanged: true,
    target: { figureKey: 'Onar Koma-2-0' },
  };
  // NO dcMessageMeta / dcActionsData for player 2 → no activation. The anchor
  // must come from the combat defender.
  const r = resolveAbility('Deflection', { game, playerNum: 2 });
  assert.strictEqual(r.applied, true);

  const d = (game.activeRoundModifiers || []).find((m) => m.card === 'Deflection' && m.side === 'defense');
  assert.ok(d, 'Deflection descriptor registered');
  assert.strictEqual(d.sourceFigureKey, 'Onar Koma-2-0', 'anchor = the attacked defender (NOT null)');

  // The defending figure gets −2 Accuracy vs the Ranged attack.
  const accFor = (fk, isRanged) => evaluateRoundModifiers(game, {
    side: 'defense', figureKey: fk, playerNum: 2, combat: { isRanged },
  }).accuracyPenalty;
  assert.strictEqual(accFor('Onar Koma-2-0', true), 2, 'defender gets −2 Acc vs Ranged');
  assert.strictEqual(accFor('Onar Koma-2-0', false), 0, 'no penalty vs Melee (Ranged-only)');
  // A different friendly figure of player 2 gets nothing.
  assert.strictEqual(accFor('Greedo-2-0', true), 0, 'a different figure gets nothing');
});

test('LIVE Cavalry Charge (start_of_round, no activation): anchor = named figure Captain Terro', () => {
  // start_of_round: NO activation and NO combat. The OLD path returned a null
  // anchor → the +1 Block (selfIsSourceFigure) and the TROOPER-position check
  // silently never applied. The new anchor resolves to the named unique figure
  // (Captain Terro) via the unique-figure-cc registry.
  const game = integrationGame('g-cc-live');
  game.figurePositions[1] = {
    'Captain Terro-1-0': 'm17',          // named figure = the anchor ("you")
    'Gar Saxon-1-0': 'm18',              // friendly TROOPER within 3
    'Greedo-1-0': 'm17',                 // non-TROOPER within range
    'Boba Fett-1-0': 'r17',              // out of range (dist 7)
  };
  // NO dcMessageMeta and NO pendingCombat → anchor must come from the named-figure registry.
  const r = resolveAbility('Cavalry Charge', { game, playerNum: 1 });
  assert.strictEqual(r.applied, true);

  const blockD = (game.activeRoundModifiers || []).find((m) => m.card === 'Cavalry Charge' && m.side === 'defense');
  assert.ok(blockD, 'Cavalry Charge defense descriptor registered');
  assert.strictEqual(blockD.sourceFigureKey, 'Captain Terro-1-0', 'anchor = Captain Terro (NOT null)');

  // +1 Block is figure-scoped to Captain Terro.
  const blockFor = (fk) => evaluateRoundModifiers(game, { side: 'defense', figureKey: fk, playerNum: 1, combat: {} }).block;
  assert.strictEqual(blockFor('Captain Terro-1-0'), 1, 'Captain Terro gets +1 Block');
  assert.strictEqual(blockFor('Gar Saxon-1-0'), 0, 'a different figure gets no Block');

  // +1 Hit reaches a friendly TROOPER within 3 of Captain Terro (position-anchored).
  const hitFor = (fk) => evaluateRoundModifiers(game, { side: 'attack', figureKey: fk, playerNum: 1, combat: {} }).hit;
  assert.strictEqual(hitFor('Gar Saxon-1-0'), 1, 'TROOPER within 3 of Captain Terro gets +1 Hit');
  assert.strictEqual(hitFor('Greedo-1-0'), 0, 'non-TROOPER gets nothing');
  assert.strictEqual(hitFor('Boba Fett-1-0'), 0, 'TROOPER out of range gets nothing');
});

test('LIVE Take Position (during activation): only the activating figure gets +1 Block', () => {
  // During the controller's activation the anchor = the activating figure.
  // A DIFFERENT friendly figure must NOT benefit (figure-scoped "you").
  const game = integrationGame('g-tp-live');
  const msgId = 'm-tp-live';
  game.dcActionsData[msgId] = { selectedFigure: 0 };
  game.figurePositions[1] = { 'Gar Saxon-1-0': 'm17', 'Greedo-1-0': 'm18' };
  const dcMessageMeta = new Map([[msgId, { gameId: 'g-tp-live', playerNum: 1, dcName: 'Gar Saxon', displayName: 'Gar Saxon [Group 1]' }]]);
  _registerDcMessageMeta(dcMessageMeta);
  const r = resolveAbility('Take Position', { game, playerNum: 1, dcMessageMeta });
  assert.strictEqual(r.applied, true);

  const d = (game.activeRoundModifiers || []).find((m) => m.card === 'Take Position' && m.side === 'defense');
  assert.strictEqual(d.sourceFigureKey, 'Gar Saxon-1-0', 'anchor = the activating figure');

  const blockFor = (fk) => evaluateRoundModifiers(game, { side: 'defense', figureKey: fk, playerNum: 1, combat: {} }).block;
  assert.strictEqual(blockFor('Gar Saxon-1-0'), 1, 'activating figure gets +1 Block');
  assert.strictEqual(blockFor('Greedo-1-0'), 0, 'a DIFFERENT friendly figure gets nothing');
});

// ── MARA JADE FAST LEARNER anchor override (alexanbv 2026-06-21) ────────────
// A unique-figure CC played via Mara Jade's Fast Learner must anchor its RANGE
// component on MARA — even when BOTH the named figure and Mara are on the board.
// cc-hand.js records Mara's figureKey on game.ccPlayedByFastLearnerFigureKey for
// the current resolution; resolveUniqueFigureCcFigureKey / resolveRoundModifierAnchor
// honor it (priority over the named-figure preference). These tests prove the
// override flips the anchor to Mara, and that WITHOUT it the named figure wins.

test('Cavalry Charge via Mara Fast Learner: range anchors on MARA, not Captain Terro', () => {
  const game = integrationGame('g-cc-fl');
  // Captain Terro near the TROOPER (m17/m18 = dist 1); Mara FAR (r17, dist 7
  // from the TROOPER). If the anchor were (wrongly) Captain Terro, the TROOPER
  // would be in range; with the FL override anchoring on Mara it is NOT.
  game.figurePositions[1] = {
    'Mara Jade-1-0': 'r17',            // the actual player (via Fast Learner)
    'Captain Terro-1-0': 'm17',        // named figure, also on board
    'Gar Saxon-1-0': 'm18',            // friendly TROOPER: dist 1 from Terro, 7 from Mara
  };
  // Simulate cc-hand recording the Fast-Learner-played-by figure (Mara).
  game.ccPlayedByFastLearnerFigureKey = 'Mara Jade-1-0';
  const r = resolveAbility('Cavalry Charge', { game, playerNum: 1 });
  delete game.ccPlayedByFastLearnerFigureKey; // cc-hand clears after resolution
  assert.strictEqual(r.applied, true);

  const blockD = (game.activeRoundModifiers || []).find((m) => m.card === 'Cavalry Charge' && m.side === 'defense');
  assert.ok(blockD, 'Cavalry Charge defense descriptor registered');
  assert.strictEqual(blockD.sourceFigureKey, 'Mara Jade-1-0', 'anchor = MARA (FL override), NOT Captain Terro');

  // +1 Block is figure-scoped to Mara (the playing figure), not Captain Terro.
  const blockFor = (fk) => evaluateRoundModifiers(game, { side: 'defense', figureKey: fk, playerNum: 1, combat: {} }).block;
  assert.strictEqual(blockFor('Mara Jade-1-0'), 1, 'Mara gets +1 Block');
  assert.strictEqual(blockFor('Captain Terro-1-0'), 0, 'Captain Terro (not the player) gets no Block');

  // +1 Hit reaches a friendly TROOPER within 3 of MARA — Gar Saxon is 7 away → NO hit.
  const hitFor = (fk) => evaluateRoundModifiers(game, { side: 'attack', figureKey: fk, playerNum: 1, combat: {} }).hit;
  assert.strictEqual(hitFor('Gar Saxon-1-0'), 0, 'TROOPER out of range of Mara gets nothing (anchored on Mara)');
});

test('Cavalry Charge NORMAL (no Fast Learner): range anchors on Captain Terro', () => {
  const game = integrationGame('g-cc-normal');
  game.figurePositions[1] = {
    'Mara Jade-1-0': 'r17',            // present, but NOT the player this time
    'Captain Terro-1-0': 'm17',        // named figure = the player
    'Gar Saxon-1-0': 'm18',            // friendly TROOPER within 3 of Terro
  };
  // No ccPlayedByFastLearnerFigureKey → named-figure preference applies.
  const r = resolveAbility('Cavalry Charge', { game, playerNum: 1 });
  assert.strictEqual(r.applied, true);

  const blockD = (game.activeRoundModifiers || []).find((m) => m.card === 'Cavalry Charge' && m.side === 'defense');
  assert.strictEqual(blockD.sourceFigureKey, 'Captain Terro-1-0', 'anchor = Captain Terro (named figure)');

  const hitFor = (fk) => evaluateRoundModifiers(game, { side: 'attack', figureKey: fk, playerNum: 1, combat: {} }).hit;
  assert.strictEqual(hitFor('Gar Saxon-1-0'), 1, 'TROOPER within 3 of Captain Terro gets +1 Hit');
});

test('I Must Go Alone via Mara Fast Learner: shielded figure = MARA, not Obi-Wan', () => {
  const game = integrationGame('g-imga-fl');
  game.figurePositions[1] = {
    'Mara Jade-1-0': 'r17',
    'Obi-Wan Kenobi-1-0': 'm17',
  };
  game.ccPlayedByFastLearnerFigureKey = 'Mara Jade-1-0';
  const r = resolveAbility('I Must Go Alone', { game, playerNum: 1 });
  delete game.ccPlayedByFastLearnerFigureKey;
  assert.strictEqual(r.applied, true);
  assert.strictEqual(game.roundDefenderCannotBeTargetedUnlessWithinSpaces?.figureKey, 'Mara Jade-1-0',
    'the shielded "you" = Mara (FL override), not Obi-Wan');
});

test('I Must Go Alone NORMAL: shielded figure = Obi-Wan (named figure)', () => {
  const game = integrationGame('g-imga-normal');
  game.figurePositions[1] = {
    'Mara Jade-1-0': 'r17',
    'Obi-Wan Kenobi-1-0': 'm17',
  };
  const r = resolveAbility('I Must Go Alone', { game, playerNum: 1 });
  assert.strictEqual(r.applied, true);
  assert.strictEqual(game.roundDefenderCannotBeTargetedUnlessWithinSpaces?.figureKey, 'Obi-Wan Kenobi-1-0',
    'the shielded "you" = Obi-Wan (named figure)');
});

test('Mandalorian Steel via Mara Fast Learner: within-4 anchor = MARA, not The Armorer', () => {
  const game = integrationGame('g-ms-fl');
  game.figurePositions[1] = {
    'Mara Jade-1-0': 'r17',
    'The Armorer-1-0': 'm17',
  };
  game.ccPlayedByFastLearnerFigureKey = 'Mara Jade-1-0';
  const r = resolveAbility('Mandalorian Steel', { game, playerNum: 1 });
  delete game.ccPlayedByFastLearnerFigureKey;
  assert.strictEqual(r.applied, true);
  assert.strictEqual(game.mandaAsteelArmorerFigureKey, 'Mara Jade-1-0',
    'within-4 anchor = Mara (FL override), not The Armorer');
});

test('Mandalorian Steel NORMAL: within-4 anchor = The Armorer (named figure)', () => {
  const game = integrationGame('g-ms-normal');
  game.figurePositions[1] = {
    'Mara Jade-1-0': 'r17',
    'The Armorer-1-0': 'm17',
  };
  const r = resolveAbility('Mandalorian Steel', { game, playerNum: 1 });
  assert.strictEqual(r.applied, true);
  assert.strictEqual(game.mandaAsteelArmorerFigureKey, 'The Armorer-1-0',
    'within-4 anchor = The Armorer (named figure)');
});

test('Deploy the Garrison via Mara Fast Learner: within-4 anchored on MARA, not Director Krennic', () => {
  const game = integrationGame('g-dg-fl');
  // Director Krennic at m17 (dist 1 from the TROOPER m18); Mara at r17 (dist 7).
  game.figurePositions[1] = {
    'Mara Jade-1-0': 'r17',
    'Director Krennic-1-0': 'm17',
    'Gar Saxon-1-0': 'm18',            // TROOPER: within 4 of Krennic, NOT of Mara
  };
  game.ccPlayedByFastLearnerFigureKey = 'Mara Jade-1-0';
  const r = resolveAbility('Deploy the Garrison', { game, playerNum: 1, dcMessageMeta: new Map() });
  delete game.ccPlayedByFastLearnerFigureKey;
  // Anchored on Mara → the only TROOPER is 7 away → none eligible.
  assert.ok(!(r.choiceValues || []).includes('Gar Saxon-1-0'),
    'TROOPER out of range of Mara is NOT eligible (anchored on Mara)');
});

test('Deploy the Garrison NORMAL: within-4 anchored on Director Krennic', () => {
  const game = integrationGame('g-dg-normal');
  game.figurePositions[1] = {
    'Mara Jade-1-0': 'r17',
    'Director Krennic-1-0': 'm17',
    'Gar Saxon-1-0': 'm18',
  };
  const r = resolveAbility('Deploy the Garrison', { game, playerNum: 1, dcMessageMeta: new Map() });
  assert.ok((r.choiceValues || []).includes('Gar Saxon-1-0'),
    'TROOPER within 4 of Krennic IS eligible (anchored on the named figure)');
});

test('Field Supply via Mara Fast Learner: within-3 "other figures" anchored on MARA, not Ko-Tun Feralo', () => {
  const game = integrationGame('g-fs-fl');
  // Ko-Tun at m17 (dist 1 from Greedo m18); Mara at r17 (dist 7 from Greedo).
  game.figurePositions[1] = {
    'Mara Jade-1-0': 'r17',
    'Ko-Tun Feralo-1-0': 'm17',
    'Greedo-1-0': 'm18',              // "other" friendly: within 3 of Ko-Tun, NOT of Mara
  };
  game.ccPlayedByFastLearnerFigureKey = 'Mara Jade-1-0';
  const r = resolveAbility('Field Supply', { game, playerNum: 1, dcMessageMeta: new Map() });
  delete game.ccPlayedByFastLearnerFigureKey;
  // Anchored on Mara → Greedo is 7 away → not an eligible target.
  const vals = (r.choiceValues || []);
  assert.ok(!vals.some(v => String(v).startsWith('Greedo-1-0|')),
    'Greedo out of range of Mara is NOT an eligible Field Supply target (anchored on Mara)');
});

test('Field Supply NORMAL: within-3 "other figures" anchored on Ko-Tun Feralo', () => {
  const game = integrationGame('g-fs-normal');
  game.figurePositions[1] = {
    'Mara Jade-1-0': 'r17',
    'Ko-Tun Feralo-1-0': 'm17',
    'Greedo-1-0': 'm18',
  };
  const r = resolveAbility('Field Supply', { game, playerNum: 1, dcMessageMeta: new Map() });
  const vals = (r.choiceValues || []);
  assert.ok(vals.some(v => String(v).startsWith('Greedo-1-0|')),
    'Greedo within 3 of Ko-Tun IS an eligible target (anchored on the named figure)');
});

// ── STANDING FIGURE AURAS (alexanbv 2026-06-20) ─────────────────────────────
// A figure's passive aura projects a combat-stat bonus onto OTHER nearby
// friendly figures, evaluated PER-FIGURE (keyword / within-N of the AURA SOURCE
// figure / attack-type) through the SAME path as played-CC round modifiers.
// The production FIGURE_AURA_DESCRIPTORS table is intentionally empty (every
// genuine outward combat-stat aura currently in data is already handled
// per-figure by dedicated handlers in src/handlers/combat.js — folding them in
// here would double-count). These tests inject a SYNTHETIC aura descriptor
// (anchored to a real carrier specialAbilityId) to pin the evaluation hook.

function withSyntheticAura(descriptor, fn) {
  FIGURE_AURA_DESCRIPTORS.push(descriptor);
  try { fn(); } finally { FIGURE_AURA_DESCRIPTORS.pop(); }
}

test('production FIGURE_AURA_DESCRIPTORS table is empty (no double-count of ad-hoc auras)', () => {
  assert.deepStrictEqual(FIGURE_AURA_DESCRIPTORS, [], 'empty until a pure-additive aura is migrated');
});

test('figure aura: +1 Block reaches a qualifying OTHER friendly within 2, not the source nor an out-of-range figure', () => {
  const game = newGame();
  // Carrier = Gar Saxon (real DC carrying specialAbilityId airborne_commander_gar_saxon).
  game.figurePositions = { 1: {
    'Gar Saxon-1-0': 'm17',   // aura SOURCE (excluded — projects onto OTHERS)
    'Onar Koma-1-0': 'm18',   // friendly within 2 → +1 Block
    'Boba Fett-1-0': 'r17',   // friendly out of range (dist 7) → nothing
  } };
  const aura = {
    specialAbilityId: 'airborne_commander_gar_saxon',
    card: 'Synthetic Block Aura',
    side: 'defense',
    conditions: { excludeSourceFigure: true, withinSpacesOfSource: 2 },
    effect: { block: 1 },
  };
  withSyntheticAura(aura, () => {
    const blockFor = (fk) => evaluateRoundModifiers(game, { side: 'defense', figureKey: fk, playerNum: 1, combat: {} }).block;
    assert.strictEqual(blockFor('Onar Koma-1-0'), 1, 'OTHER friendly within 2 gets +1 Block');
    assert.strictEqual(blockFor('Gar Saxon-1-0'), 0, 'the aura source itself is excluded');
    assert.strictEqual(blockFor('Boba Fett-1-0'), 0, 'out-of-range friendly gets nothing');
    // evaluateFigureAuras (sibling) yields the same aura-only contribution.
    assert.strictEqual(evaluateFigureAuras(game, { side: 'defense', figureKey: 'Onar Koma-1-0', playerNum: 1, combat: {} }).block, 1);
  });
});

test('figure aura: keyword + attack-type conditions gate per-figure (attack-side reroll aura)', () => {
  const game = newGame();
  game.figurePositions = { 1: {
    'Gar Saxon-1-0': 'm17',                 // carrier/source
    'Boba Fett-1-0': 'm18',                 // VEHICLE within 3 (qualifies on keyword)
    'Onar Koma-1-0': 'm18',                 // not VEHICLE → no reroll
  } };
  const aura = {
    specialAbilityId: 'airborne_commander_gar_saxon',
    card: 'Synthetic Reroll Aura',
    side: 'attack',
    conditions: { selfKeyword: 'VEHICLE', withinSpacesOfSource: 3, attackType: 'range' },
    effect: { rerollAttackDice: 1 },
  };
  withSyntheticAura(aura, () => {
    const rr = (fk, isRanged) => evaluateRoundModifiers(game, { side: 'attack', figureKey: fk, playerNum: 1, combat: { isRanged } }).rerollAttackDice;
    assert.strictEqual(rr('Boba Fett-1-0', true), 1, 'VEHICLE within 3 on a Ranged attack gets the reroll');
    assert.strictEqual(rr('Boba Fett-1-0', false), 0, 'Melee attack does not qualify (Ranged-only aura)');
    assert.strictEqual(rr('Onar Koma-1-0', true), 0, 'non-VEHICLE gets nothing');
  });
});

test('figure aura: only applies for the OWNING player (auras are friendly)', () => {
  const game = newGame();
  game.figurePositions = {
    1: { 'Gar Saxon-1-0': 'm17' },           // p1 carrier
    2: { 'Onar Koma-2-0': 'm18' },           // p2 figure — must NOT receive p1's aura
  };
  const aura = {
    specialAbilityId: 'airborne_commander_gar_saxon',
    card: 'Synthetic Owner-Scoped Aura',
    side: 'defense',
    conditions: {},
    effect: { evade: 1 },
  };
  withSyntheticAura(aura, () => {
    // Descriptors are built per owning player; p2's evaluation sees no p1 carrier.
    assert.strictEqual(buildFigureAuraDescriptors(game, 1).length, 1, 'p1 has the carrier');
    assert.strictEqual(buildFigureAuraDescriptors(game, 2).length, 0, 'p2 has no carrier');
    assert.strictEqual(evaluateRoundModifiers(game, { side: 'defense', figureKey: 'Onar Koma-2-0', playerNum: 2, combat: {} }).evade, 0);
  });
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
