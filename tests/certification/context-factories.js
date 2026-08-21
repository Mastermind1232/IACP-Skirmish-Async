/**
 * Context factories for certification testing.
 * Each factory creates a deterministic game state for a specific timing window.
 * Zero randomness — all state is explicit.
 *
 * isCcPlayableNow checks getCcPlayContext which uses:
 *   startOfRound: game.currentRound && !!game.startOfRoundWhoseTurn (SoR window flag, holds a player ID)
 *   duringActivation: !inSorWindow && game.currentActivationTurnPlayerId === playerId && !game.endOfRoundWhoseTurn
 *   endOfRound: game.endOfRoundWhoseTurn === playerId
 *   duringAttack: !!(game.combat || game.pendingCombat)
 *   isAttacker: duringAttack && combat.attackerPlayerNum === playerNum
 *   isDefender: duringAttack && combat.defenderPlayerNum === playerNum
 *   duringRound: game.currentRound && game.currentActivationTurnPlayerId && !game.endOfRoundWhoseTurn
 *   recentDefeat: !!game.lastDefeatInfo
 */

import { createTestGame } from '../fixtures/game-builder.js';

// Standard armies for testing
const ATTACKER_ARMY = [{ dcName: 'Stormtrooper', count: 1 }];
const DEFENDER_ARMY = [{ dcName: 'Rebel Saboteur', count: 1 }];

// ── Helpers ───────────────────────────────────────────────────────

function syncToHarness(built) {
  const gamesMap = built.harness.getGamesMap();
  gamesMap.set(built.game.gameId, built.game);
}

function activateDcForPlayer(built, playerNum) {
  for (const [msgId, meta] of built.dcMessageMeta) {
    if (meta.playerNum === playerNum) {
      built.game.dcActionsData = built.game.dcActionsData || {};
      built.game.dcActionsData[msgId] = { remaining: 2, total: 2, specialsUsed: [], selectedFigure: 0 };
      built.game.activeDcMsgId = msgId;
      return msgId;
    }
  }
  return null;
}

function buildBase(opts) {
  const p1Army = opts.p1Army || ATTACKER_ARMY;
  const p2Army = opts.p2Army || DEFENDER_ARMY;
  return createTestGame()
    .withPlayer1Army(p1Army)
    .withPlayer2Army(p2Army)
    .withPlayer1CcHand(opts.p1CcHand || [])
    .withPlayer2CcHand(opts.p2CcHand || [])
    .inRound(opts.round || 1)
    .build();
}

function setupCombat(built, opts = {}) {
  const attackerPn = opts.attackerPlayerNum || 1;
  const defenderPn = attackerPn === 1 ? 2 : 1;

  const p1Figs = Object.keys(built.game.figurePositions[1] || {});
  const p2Figs = Object.keys(built.game.figurePositions[2] || {});
  const attackerKey = (attackerPn === 1 ? p1Figs : p2Figs)[0];
  const defenderKey = (defenderPn === 1 ? p1Figs : p2Figs)[0];

  built.game.pendingCombat = {
    attackerPlayerNum: attackerPn,
    defenderPlayerNum: defenderPn,
    attackerFigureKey: attackerKey,
    defenderFigureKey: defenderKey,
    attackerDcName: attackerKey?.split('-')[0],
    defenderDcName: defenderKey?.split('-')[0],
    attackDice: opts.attackDice || ['blue', 'green'],
    defenseDice: opts.defenseDice || ['white'],
    attackResults: opts.attackResults || { acc: 4, dmg: 2, surge: 1, dice: [] },
    defenseResults: opts.defenseResults || { block: 1, evade: 0, dodge: false },
    phase: opts.combatPhase || 'surges',
    surgeAbilities: opts.surgeAbilities || [],
    attackCcCount: 0,
    defenderCcCount: 0,
    attackerRerolledIndices: [],
    defenderRerolledIndices: [],
    hit: true,
  };

  // Also set on game.combat (some code checks game.combat)
  built.game.combat = built.game.pendingCombat;

  activateDcForPlayer(built, attackerPn);
}

// ── Timing Factories ──────────────────────────────────────────────

export const TIMING_FACTORIES = {};

// Helper to register under multiple keys
function registerFactory(keys, fn) {
  for (const k of keys) {
    TIMING_FACTORIES[k] = fn;
  }
}

// ── startOfRound ──────────────────────────────────────────────────

function createStartOfRoundContext(opts = {}) {
  const built = buildBase(opts);
  const playerNum = opts.playerNum || 1;
  const playerId = playerNum === 1 ? built.game.player1Id : built.game.player2Id;

  // getCcPlayContext gates startOfRound on: game.currentRound && !!game.startOfRoundWhoseTurn
  // (the authoritative Start-of-Round window flag, which holds the player ID whose SoR
  // turn it is). duringActivation/duringRound are suppressed while this flag is set.
  built.game.currentRound = built.game.round || 1;
  built.game.startOfRoundWhoseTurn = playerId;
  // Clear activation turn so duringActivation is false
  built.game.currentActivationTurnPlayerId = null;
  built.game.endOfRoundWhoseTurn = null;

  syncToHarness(built);
  return { ...built, playerNum };
}
registerFactory(['startOfRound', 'startOfStatusPhase'], createStartOfRoundContext);

// ── duringActivation ──────────────────────────────────────────────

function createDuringActivationContext(opts = {}) {
  const built = buildBase(opts);
  const playerNum = opts.playerNum || 1;
  const playerId = playerNum === 1 ? built.game.player1Id : built.game.player2Id;

  // isCcPlayableNow checks: game.currentActivationTurnPlayerId === playerId && !game.endOfRoundWhoseTurn
  built.game.currentActivationTurnPlayerId = playerId;
  built.game.endOfRoundWhoseTurn = null;
  built.game.currentRound = built.game.round || 1;
  // Clear startOfRound flags
  built.game.roundActivationMessageId = null;

  activateDcForPlayer(built, playerNum);

  syncToHarness(built);
  return { ...built, playerNum };
}
registerFactory([
  'duringActivation', 'startOfActivation', 'endOfActivation',
  'specialAction', 'doubleActionSpecial',
  'afterSpecial',
  'whileYouDeclareAttack', 'beforeYouDeclareAttack',
  'whenHostileFigureEntersAdjacentSpace', 'whenHostileFigureEntersSpaceWithin3Spaces',
  'whenYouEndMovementInSpacesWithOtherFigures',
  'whenYouHaveSufferedDamageEqualToYourHealth',
  'whenFriendlyFigureWithin2SpacesSuffers3PlusDamage',
  'whenFriendlyFigureWithin3SpacesWouldBeDefeated',
  'afterActivationResolves', 'afterYouResolveGroupsActivation',
  'whenYouDeclareLightsaberThrow', 'afterDamage',
  'whenAttackDeclaredTargetingFriendlySmallFigureCost10OrLessWithin3Spaces',
  'whenAttackDeclaredOnAdjacentFriendly',
  'atStartOfActivationOfHostileFigureInYourLineOfSight',
  'useWhenYouUseGambit', 'beforeDeclaringRangedAttack',
  'whenHostileFigureWithin3SpacesDefeated',
  'whenHostileFigureDefeatedNotYourActivation',
  'afterYouResolveCloseAndPersonal', 'afterYouResolveInterrogate',
  'atStartOfHostileFigureActivation',
  'useWhenYouUseDualBladedFury', 'useWhenYouUseEmperor',
  'whenCommandCardDiscardedFromHandOrDeck', 'whenCommandCardPlayed',
  'whenEnemyFigureActivates', 'whenHostileFigureExitsAdjacentSpace',
  'blackMarketPrices', 'other',
  'afterHostileFigureSuffersDamage', 'afterAttackHostileFigureSuffersDamage',
], createDuringActivationContext);

// ── afterSpecialOrInteract ────────────────────────────────────────
// All in a Day's Work: isCcPlayableNow requires ctx.duringActivation AND
// game.specialOrInteractResolvedThisActivation (set when a Special Action or
// Interact resolves; wiped at activation end).
function createAfterSpecialOrInteractContext(opts = {}) {
  const built = createDuringActivationContext(opts);
  built.game.specialOrInteractResolvedThisActivation = true;
  syncToHarness(built);
  return built;
}
registerFactory(['afterSpecialOrInteract'], createAfterSpecialOrInteractContext);

// ── endOfRound ────────────────────────────────────────────────────

function createEndOfRoundContext(opts = {}) {
  const built = buildBase(opts);
  const playerNum = opts.playerNum || 1;
  const playerId = playerNum === 1 ? built.game.player1Id : built.game.player2Id;

  // isCcPlayableNow checks: game.endOfRoundWhoseTurn === playerId
  built.game.endOfRoundWhoseTurn = playerId;
  built.game.currentActivationTurnPlayerId = null;
  built.game.currentRound = built.game.round || 1;
  built.game.p1ActivationsRemaining = 0;
  built.game.p2ActivationsRemaining = 0;
  built.game.roundActivationMessageId = null;

  syncToHarness(built);
  return { ...built, playerNum };
}
registerFactory(['endOfRound'], createEndOfRoundContext);

// ── duringAttack (attacker perspective) ───────────────────────────

function createDuringAttackContext(opts = {}) {
  const built = buildBase(opts);
  const playerNum = opts.playerNum || 1;
  const playerId = playerNum === 1 ? built.game.player1Id : built.game.player2Id;

  // Need duringActivation context + combat
  built.game.currentActivationTurnPlayerId = playerId;
  built.game.endOfRoundWhoseTurn = null;
  built.game.currentRound = built.game.round || 1;
  built.game.roundActivationMessageId = null;

  setupCombat(built, { attackerPlayerNum: opts.attackerPlayerNum || playerNum, ...opts });

  syncToHarness(built);
  return { ...built, playerNum };
}
registerFactory([
  'duringAttack',
  'whileAttackingBeforeDefenderRerolls',
  'whenAnotherFriendlyTrooperDeclaresAttackTargetingInYourLineOfSight',
  // whenYouDeclareAttack → isCcPlayableNow requires ctx.duringAttack && ctx.isAttacker
  // (combat exists with the CC player as attacker). Previously fell through to the
  // duringActivation fallback (no combat) so isCcPlayableNow returned false.
  'whenYouDeclareAttack',
  'whenYouDeclareAttackTargetingHostileWithHighestFigureCost',
], createDuringAttackContext);

// ── afterAttack (attacker, with a recent defeat) ──────────────────
// Most afterAttack CCs only need ctx.duringAttack, but Glory of the Kill also
// requires ctx.recentDefeat (game.lastDefeatInfo set). Setting lastDefeatInfo is
// harmless for the other afterAttack cards (their gate is just duringAttack).
function createAfterAttackContext(opts = {}) {
  const built = createDuringAttackContext(opts);
  built.game.lastDefeatInfo = { figureKey: 'Stormtrooper-1-0', playerNum: 2 };
  syncToHarness(built);
  return built;
}
registerFactory([
  'afterAttack', 'afterAttackDice',
], createAfterAttackContext);

// ── whileDefending (defender perspective) ─────────────────────────

function createWhileDefendingContext(opts = {}) {
  const built = buildBase(opts);
  const playerNum = opts.playerNum || 1;
  // The CC player is the defender; attacker is the opponent
  const attackerPn = playerNum === 1 ? 2 : 1;
  const attackerId = attackerPn === 1 ? built.game.player1Id : built.game.player2Id;

  // Need the attacker's activation to be active for duringAttack
  built.game.currentActivationTurnPlayerId = attackerId;
  built.game.endOfRoundWhoseTurn = null;
  built.game.currentRound = built.game.round || 1;
  built.game.roundActivationMessageId = null;

  setupCombat(built, { attackerPlayerNum: attackerPn, ...opts });

  syncToHarness(built);
  return { ...built, playerNum };
}
registerFactory([
  'whileDefending', 'whenAttackDeclaredOnYou',
  'afterAttackTargetingYouResolved', 'afterDefenseRoll',
  'whenHostileFigureInYourLineOfSightAttacking',
  'whileAdjacentFriendlyFigureDefending',
  'whenFigureWithin3SpacesDefending',
  'whenFriendlyRebelForceUserWithin4SpacesRollsDice',
], createWhileDefendingContext);

// ── afterAttack attacker perspective ──────────────────────────────

function createAfterAttackHitContext(opts = {}) {
  return createDuringAttackContext({ ...opts, combatPhase: 'resolved' });
}
registerFactory([
  'afterYouResolveAttackThatDidNotMissDueToAccuracy',
  'afterYouResolveAttackTargetingFigure',
  'whenYouDeclareAttackTargetingHostileWithHighestFigureCost',
  'whenYouDeclareCloseQuarters', 'whenYouDeclareIndiscriminateFire',
  'whenYouPerformRapidFire',
  'whenAnotherFriendlyTrooperDeclaresAttackTargetingYourLineOfSight',
], createAfterAttackHitContext);

// ── defeat context ────────────────────────────────────────────────

function createAfterDefeatContext(opts = {}) {
  const ctx = createDuringActivationContext(opts);
  ctx.game.lastDefeatInfo = { figureKey: 'Stormtrooper-1-0', playerNum: 2 };
  syncToHarness(ctx);
  return ctx;
}
registerFactory([
  'afterUniqueHostileDefeated', 'whenOneOfYourFiguresDefeated',
], createAfterDefeatContext);

// ── Celebration special (needs unique hostile defeated during activation)
function createCelebrationContext(opts = {}) {
  const ctx = createDuringActivationContext(opts);
  ctx.game.lastDefeatInfo = { figureKey: 'Stormtrooper-1-0', playerNum: 2 };
  ctx.game.recentDefeat = true;
  syncToHarness(ctx);
  return ctx;
}
registerFactory(['afterUniqueHostileDefeatedDuringActivation'], createCelebrationContext);

// ── Card-Specific Overrides ────────────────────────────────────────

/**
 * Per-card scenario overrides. Key: card name, Value: opts to pass to timing factory.
 */
export const CARD_OVERRIDES = {
  // CCs requiring specific DC names (unique characters whose names match dc-effects keys exactly)
  'All in a Day\'s Work': { p1Army: [{ dcName: 'Saska Teft', count: 1 }] },
  'Ambush': { p1Army: [{ dcName: 'Cara Dune', count: 1 }] },
  'Apex Predator': { p1Army: [{ dcName: 'Rancor', count: 1 }] },
  'Assassinate': { p1Army: [{ dcName: 'IG-88', count: 1 }] },
  'Ballistics Matrix': { p1Army: [{ dcName: 'BT-1', count: 1 }] },
  'Battle Scars': { p1Army: [{ dcName: 'Gaarkhan', count: 1 }] },
  'Bladestorm': { p1Army: [{ dcName: 'Shyla Varad', count: 1 }] },
  'Blitz': { p1Army: [{ dcName: 'CT-1701', count: 1 }] },
  'Cal\'s Buddy': { p1Army: [{ dcName: 'Cal Kestis', count: 1 }] },
  'Capitalize': { p1Army: [{ dcName: 'Bossk', count: 1 }] },
  'Cavalry Charge': { p1Army: [{ dcName: 'Captain Terro', count: 1 }] },
  'Celebration': { p1Army: [{ dcName: 'Luke Skywalker', count: 1 }] },
  'Chaotic Force': { p1Army: [{ dcName: 'Luke Skywalker', count: 1 }] },
  'Close and Personal': { p1Army: [{ dcName: 'Biv Bodhrik', count: 1 }] },
  'Combat Resupply': { p1Army: [{ dcName: 'Darth Vader', count: 1 }] },
  'Concentrated Fire': { p1Army: [{ dcName: 'Kayn Somos', count: 1 }] },
  'Corrupting Force': { p1Army: [{ dcName: 'Darth Vader', count: 1 }] },
  'Dark Energy': { p1Army: [{ dcName: 'Darth Vader', count: 1 }] },
  'Deadeye': { p1Army: [{ dcName: 'Boba Fett', count: 1 }] },
  'Deadly Precision': { p1Army: [{ dcName: 'Darth Vader', count: 1 }] },
  "Definition: 'Love'": { p1Army: [{ dcName: 'HK-47', count: 1 }] },
  'Demoralizing Monologue': { p1Army: [{ dcName: 'Moff Gideon', count: 1 }] },
  'Disable': { p1Army: [{ dcName: 'Saska Teft', count: 1 }] },
  'Dioxis Fumes': { p1Army: [{ dcName: 'IG-88', count: 1 }] },
  'Espionage Mastery': { p1Army: [{ dcName: 'Agent Blaise', count: 1 }] },
  'Eye on the Prize': { p1Army: [{ dcName: 'Boba Fett', count: 1 }] },
  'Face Me!': { p1Army: [{ dcName: 'Agent Kallus', count: 1 }] },
  'Feral Swipes': { p1Army: [{ dcName: 'Rancor', count: 1 }] },
  'Ferocity': { p1Army: [{ dcName: 'Rancor', count: 1 }] },
  'Force Illusion': { p1Army: [{ dcName: 'Luke Skywalker', count: 1 }] },
  'Force Lightning': { p1Army: [{ dcName: 'Emperor Palpatine', count: 1 }] },
  'Furious Charge': { p1Army: [{ dcName: 'Gaarkhan', count: 1 }] },
  'Gauntlet Blade': { p1Army: [{ dcName: 'Bo-Katan Kryze', count: 1 }] },
  'Get Behind Me!': { p1Army: [{ dcName: 'Gaarkhan', count: 1 }] },
  'Guild Programming': { p1Army: [{ dcName: 'IG-11', count: 1 }] },
  'Guardian Stance': { p1Army: [{ dcName: 'Gaarkhan', count: 1 }] },
  'Heart of Freedom': { p1Army: [{ dcName: 'Luke Skywalker', count: 1 }] },
  'Hunt Them Down': { p1Army: [{ dcName: 'The Grand Inquisitor', count: 1 }] },
  'I Can Feel It': { p1Army: [{ dcName: 'Luke Skywalker', count: 1 }] },
  'In the Shadows': { p1Army: [{ dcName: 'Han Solo', count: 1 }] },
  'Intelligence Leak': { p1Army: [{ dcName: 'Cassian Andor', count: 1 }], p2CcHand: ['Negation'] },
  'Interrogation': { p1Army: [{ dcName: 'Agent Blaise', count: 1 }] },
  'Jedi Mind Trick': { p1Army: [{ dcName: 'Luke Skywalker', count: 1 }] },
  'Jundland Terror': { p1Army: [{ dcName: 'Bantha Rider', count: 1 }] },
  'Leia\'s Reinforcements': { p1Army: [{ dcName: 'Leia Organa', count: 1 }] },
  'Lord of the Sith': { p1Army: [{ dcName: 'Darth Vader', count: 1 }] },
  'Mandalorian Steel': { p1Army: [{ dcName: 'The Armorer', count: 1 }] },
  'Mandalorian Tactics': { p1Army: [{ dcName: 'Boba Fett', count: 1 }] },
  'Marked Territory': { p1Army: [{ dcName: 'Rancor', count: 1 }] },
  'Master Operative': { p1Army: [{ dcName: 'Verena Talos', count: 1 }] },
  'Negation': { p1Army: [{ dcName: 'Darth Vader', count: 1 }] },
  // 'No Cheating' (Asajj-only CC) removed 2026-05-07 with Asajj Ventress per
  // destruct 2026-05-05; Session 8.3 of combat-rebuild plan.
  'Of No Importance': { p1Army: [{ dcName: 'Darth Vader', count: 1 }] },
  'Overcharged Weapons': { p1Army: [{ dcName: 'AT-DP', count: 1 }] },
  'Pack Alpha': { p1Army: [{ dcName: 'Rancor', count: 1 }] },
  'Paid in Beskar': { p1Army: [{ dcName: 'The Mandalorian', count: 1 }] },
  'Parting Blow': { p1Army: [{ dcName: 'Gaarkhan', count: 1 }] },
  'Personal Energy Shield': { p1Army: [{ dcName: 'Saska Teft', count: 1 }] },
  'Price of Glory': { p1Army: [{ dcName: 'Darth Vader', count: 1 }] },
  'Primary Target': { p1Army: [{ dcName: 'Boba Fett', count: 1 }] },
  'Protect the Old Ways': { p1Army: [{ dcName: 'Kanan Jarrus', count: 1 }] },
  'Rapid Recalibration': { p1Army: [{ dcName: 'IG-88', count: 1 }] },
  'Reverse Engineer': { p1Army: [{ dcName: 'Saska Teft', count: 1 }] },
  'Roar': { p1Army: [{ dcName: 'Chewbacca', count: 1 }] },
  'Savage Vigor': { p1Army: [{ dcName: 'Rancor', count: 1 }] },
  'Self-Augmentation': { p1Army: [{ dcName: 'Saska Teft', count: 1 }] },
  'Set the Charge': { p1Army: [{ dcName: 'Saska Teft', count: 1 }] },
  'Shadow Ops': { p1Army: [{ dcName: "Mak Eshka'rey", count: 1 }] },
  'Stay Down': { p1Army: [{ dcName: 'Biv Bodhrik', count: 1 }] },
  'Still Faster Than You': { p1Army: [{ dcName: 'Cad Bane', count: 1 }] },
  'Supercharge': { p1Army: [{ dcName: 'Saska Teft', count: 1 }] },
  'Survival Instincts': { p1Army: [{ dcName: 'Rancor', count: 1 }] },
  'There Is No Try': { p1Army: [{ dcName: 'Yoda', count: 1 }] },
  'Trandoshan Terror': { p1Army: [{ dcName: 'Bossk', count: 1 }] },
  'Unlimited Power': { p1Army: [{ dcName: 'Emperor Palpatine', count: 1 }] },
  'Wild Fury': { p1Army: [{ dcName: 'Rancor', count: 1 }] },
  'Wookiee Rage': { p1Army: [{ dcName: 'Gaarkhan', count: 1 }] },
  'Wreak Vengeance': { p1Army: [{ dcName: 'Maul', count: 1 }] },
};

/**
 * Get the factory function for a given CC timing string.
 * Normalizes the timing string for lookup.
 */
export function getFactoryForTiming(timing) {
  // Direct match
  if (TIMING_FACTORIES[timing]) return TIMING_FACTORIES[timing];

  // Case-insensitive match
  const lower = timing.toLowerCase();
  for (const [key, factory] of Object.entries(TIMING_FACTORIES)) {
    if (key.toLowerCase() === lower) return factory;
  }

  // Fallback: many timings map to duringActivation in isCcPlayableNow
  // If we can't find a specific factory, use duringActivation as default
  // since most reactive/trigger timings require duringActivation context
  return TIMING_FACTORIES.duringActivation || null;
}

/**
 * Build a context for a specific card, using CARD_OVERRIDES if available.
 */
export function buildContextForCard(cardName, timing, additionalOpts = {}) {
  const factory = getFactoryForTiming(timing);
  if (!factory) return null;
  const overrides = CARD_OVERRIDES[cardName] || {};
  return factory({ ...overrides, ...additionalOpts });
}
