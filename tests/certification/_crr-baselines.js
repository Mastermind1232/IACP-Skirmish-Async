/**
 * Shared CRR-suite baselines and scenario data — non-test helper module.
 *
 * This file holds the constants that multiple CRR surfacing tests rely on:
 *   - direct-detection baseline (per-family + total)
 *   - round-flags baseline (duplicates, unused, type-mismatch)
 *   - dep-bag allowlist
 *   - handler-vs-engine parity scenarios (including their setup closures)
 *
 * The crr-status-consistency test imports from here instead of from the
 * individual layer test files. That keeps those imports side-effect-free:
 * top-level `describe(...)` calls don't double-execute, and the test-count
 * signal stays clean.
 *
 * Non-mutating: pure data + scenario setup closures. No `describe/it`, no
 * src/ modifications, no gameplay behavior.
 */
import { createTestGame } from '../fixtures/game-builder.js';

// ── Direct-detection census ─────────────────────────────────────────────────
// Captured empirically on 2026-04-16 after the range-fix + coord-label
// commits. Represents the full current debt — every entry here is a known
// direct-detection site that future consolidation work should chip away at.
//
// Top concentrations (informational):
//   src/handlers/combat.js ..................... 40 sites
//   src/engine/activation-setup.js ............. 23 sites
//   src/engine/combat-bridge.js ................ 15 sites
//
// `dcName_startsWith` counts include the legitimate attachment-stripping
// fallback in src/game/dc-helpers.js (bracket-name resolution).
// 2026-04-17: dcName_equality 55→56. Engine-side Fury of Kashyyyk Reach
// check at available-actions.js mirrors the handler's `_hasFuryReach`
// (closes parity scenarios 12/13). Attachment is identified by bracket name;
// no specialAbilityIds-style pointer exists for DC-attachment lookups.
// 2026-04-20: dcName_equality 56→57. CRR-INCP-001 requires an incapacitated
// figure's space to block movement-end (the exception to G39 companion
// space-sharing). Only skirmish substrate is The Child (childIncapacitated
// flag set by Force Exhaustion); getOccupiedSpacesForMovement now includes
// The Child's footprint when incapacitated. Single known incap-capable
// figure, so a dcName equality check is the correct shape here.
export const DD_BASELINE = {
  dcName_equality: 57,
  dcName_includes: 5,
  dcName_startsWith: 4,
  cardNameIncludes: 82,
};
export const DD_BASELINE_TOTAL = Object.values(DD_BASELINE).reduce((a, b) => a + b, 0);

// ── Round-flags completeness ────────────────────────────────────────────────
// Captured 2026-04-16 on commit after d610d62. Pre-existing violations on the
// day this layer was added; new violations beyond these lists fail the build.
export const RF_BASELINE_DUPLICATES = [];
export const RF_BASELINE_UNUSED = [
  'deviceRerollGranted',
  'drivenByHatredForceChoke',
  // pendingBELReorder is read/written via _belGame alias (handlers/interrupts.js);
  // scanner regex requires `game.X`. Real usage exists.
  'pendingBELReorder',
];
export const RF_BASELINE_TYPE_MISMATCH = [
  'overdriveUsedThisActivation',
  'diplomaticMissionEvade',
  'sitTightPlayerNum',
  'roundInTheShadowsPlayerNum',
  'roundUtinniJawaBuffs',
  'roundSmugglersTricksPlayerNum',
  'squadSwarmPlayerNum',
  'squadSwarmCumulativeCost',
  'pendingFiringSquad',
  'holdGroundPlayerNum',
  'toughLuckPlayerNum',
  'thereIsNoTryPlayerNum',
  'mandaAsteelPlayerNum',
  'stillFasterPlayerNum',
  'terminalControlPlayerNum',
  'shadowOpsBlockedPlayer',
  'criticalHitBlockedPlayer',
  'powerfulInfluencePlayerNum',
  'restInPeaceActive',
  'extraProtectionTriggeredThisCombat',
  'pendingMissionSorReveal',
  // Pending* consolidation (project_pending_consolidation_plan.md) —
  // these fields now go through setPending* / clearPending* helpers in
  // src/game/interrupts.js. Direct game.pendingX = Y writes only exist
  // inside the helper functions; the test scanner doesn't follow into
  // helpers, so add migrated fields to the baseline. Remove once the
  // legacy fields are dropped entirely (Phase 3 cutover).
  'pendingNegation',
  'pendingCcChoice',
  'pendingCelebration',
  'pendingCcConfirmation',
  'pendingCcSpaceChoice',
  'pendingCcAttachment',
  'pendingCleave',
  'pendingCoverFire',
  'pendingBoltslinger',
  'pendingMissionSorReveal',
  'pendingShoulderRush',
  'pendingRushPush',
  'pendingHeavyFire',
  'pendingLastResort',
  'pendingFalseOrders',
  'pendingStrainChoice',
  'pendingIllicitArms',
  'pendingWantonDestruction',
  'pendingTokenDistribution',
  'pendingIllegalCcPlay',
  'pendingMassivePush',
  'pendingItWillBeAlright',
  'pendingHavocShot',
  'pendingGeneralsOrders',
  'pendingCoordinatedRaid',
  'pendingExecutiveOrder',
  'pendingFightingKnife',
  'pendingFieldTactics',
  'pendingThereIsNoTry',
  'pendingSpreadThePain',
  'pendingPunishingStrike',
  'pendingPowerConverter',
  'pendingDeflect',
  'pendingConspire',
  'pendingDioFollow',
  'pendingExtraProtection',
  'pendingDurasteelFistPush',
  'pendingZilloDiscard',
  'pendingSurgeOverflow',
  'pendingOrderedMove',
  'pendingWookSlamPush',
  'pendingToughLuck',
  'pendingRogueOneTokenPick',
  'pendingReaction',
  'pendingCommDisruptionPrompt',
  'pendingIndiscriminateFire',
  'pendingConcussiveBolt',
  'pendingYHSIW',
  'pendingTrustedAlly',
  'pendingSuppressiveFireMp',
  'pendingStrikeMeDown',
  'pendingSlowOnTheDraw',
  'pendingScavengedWeaponryTransfer',
  'pendingRightBackAtYa',
  'pendingOrbitalBombardment',
  'pendingMotivation',
  'pendingLure',
  'pendingLoadoutSelection',
  'pendingLieInAmbush',
  'pendingIKnowEverything',
  'pendingForceExhaustion',
  'pendingFigurehead',
  'pendingEmperorInterrupt',
  'pendingChannelTheForceStrain',
  'pendingBombardmentSorin',
  'pendingBattlefieldLeadership',
  'pendingAssassinsBlade',
  'pendingStillFaster',
  'pendingSelfDestruct',
  'pendingMastery',
  'pendingInterrogate',
  'pendingHunterProtocol',
  'pendingExecutorInterrupt',
  'pendingBELReorder',
  'pendingUnhingedDirector',
  'pendingUnhingedStrain',
];

// ── Dep-bag parity allowlist ────────────────────────────────────────────────
// Captured 2026-04-16. Every entry names a handler-group dep that
// `buildHeadlessDeps` is known to *intentionally* not provide. Reason is
// required. Remove entries when the provider starts supplying the key; the
// test will tighten automatically.
export const DEP_BAG_ALLOWED_OMISSIONS = {
  buildSquadConfirmText:            'Discord text builder for squad-confirmation messages; no Discord messages in headless',
  channelDeleteGuard:               'Discord channel-delete safeguard; headless never deletes real channels',
  getDetermineInitiativeButtons:    'Discord button builder for initiative prompts; headless has no Discord UI',
  populatePlayAreas:                'Creates Discord play-area channel messages; headless uses no Discord channels',
  postFluctuationSwapButtons:       'Discord button post for mission fluctuation-swap UI; no Discord UI in headless',
  postGameOver:                     'Discord game-over message poster; headless uses an inline wrapper inside checkWinConditions (see headless-deps.js line ~363)',
  postKryknaPlaceButtons:           'Discord button post for Krykna NPC placement prompts; headless resolves Krykna via auto-queue (self-play.js)',
  renderDcEmbed:                    'Discord embed renderer for DC cards; Discord-side callers guard with optional chaining',
  reorderPlayAreaAfterAttachments:  'Reorders Discord channels after setup-attachments phase; headless has no channels to reorder',
};

// ── Handler-vs-engine parity scenarios ──────────────────────────────────────
// Shared scenario-setup helpers. Small and generic; moved here so both the
// parity test and the status test can read PARITY_SCENARIOS without the
// status test re-registering the parity describe/it block.
function findDcMsgId(dcMessageMeta, gameId, playerNum, dcName) {
  for (const [msgId, meta] of dcMessageMeta) {
    if (meta.gameId !== gameId) continue;
    if (meta.playerNum !== playerNum) continue;
    if (meta.dcName === dcName) return msgId;
  }
  return null;
}

function enableAttackFor(game, msgId) {
  game.dcActionsData = game.dcActionsData || {};
  game.dcActionsData[msgId] = { remaining: 2, total: 2, specialsUsed: [] };
}

export const PARITY_SCENARIOS = [
  // 1. Baseline sanity — expect exact agreement
  {
    name: 'baseline — ranged attacker vs single target, no special flags',
    setup() {
      const built = createTestGame()
        .withPlayer1Army([{ dcName: 'Bossk' }])
        .withPlayer2Army([{ dcName: 'Greedo' }])
        .inRound(1)
        .build();
      const { game, dcMessageMeta } = built;
      // Pin positions: Bossk at a1, Greedo at a3 (distance 2)
      game.figurePositions = {
        1: { 'Bossk-1-0': 'a1' },
        2: { 'Greedo-1-0': 'a3' },
      };
      const attackerMsgId = findDcMsgId(dcMessageMeta, game.gameId, 1, 'Bossk');
      enableAttackFor(game, attackerMsgId);
      return {
        ...built,
        attacker: { playerNum: 1, figureKey: 'Bossk-1-0', msgId: attackerMsgId, figureIndex: 0 },
      };
    },
    expectedHandlerOnly: [],
    expectedEngineOnly: [],
    reason: 'no special rules in play; handler and engine should agree.',
  },

  // 2. Reach (keyword/passive on attacker DC) — handler includes distance-2, engine does not
  {
    name: 'Reach — melee attacker with Reach passive vs distance-2 target',
    setup() {
      const built = createTestGame()
        .withPlayer1Army([{ dcName: 'Royal Guard (Regular)' }])
        .withPlayer2Army([{ dcName: 'Greedo' }])
        .inRound(1)
        .build();
      const { game, dcMessageMeta } = built;
      game.figurePositions = {
        1: { 'Royal Guard (Regular)-1-0': 'a1' },
        2: { 'Greedo-1-0': 'a3' },   // 2 spaces away
      };
      const attackerMsgId = findDcMsgId(dcMessageMeta, game.gameId, 1, 'Royal Guard (Regular)');
      enableAttackFor(game, attackerMsgId);
      return {
        ...built,
        attacker: { playerNum: 1, figureKey: 'Royal Guard (Regular)-1-0', msgId: attackerMsgId, figureIndex: 0 },
      };
    },
    expectedHandlerOnly: [],
    expectedEngineOnly: [],
    reason: 'Engine now applies permanent Reach (fixed 2026-04-16; available-actions.js extends melee maxRange to 2 when attacker has REACH keyword or passive). Both sides agree. Fury of Kashyyyk and Electrostaff loadout-card Reach also closed 2026-04-17 (scenarios 12/13).',
  },

  // 3. Hide — handler filters Hidden targets, engine does not
  {
    name: 'Hide — ranged attacker vs target with Hide condition',
    setup() {
      const built = createTestGame()
        .withPlayer1Army([{ dcName: 'Bossk' }])
        .withPlayer2Army([{ dcName: 'Greedo' }])
        .inRound(1)
        .build();
      const { game, dcMessageMeta } = built;
      game.figurePositions = {
        1: { 'Bossk-1-0': 'a1' },
        2: { 'Greedo-1-0': 'a3' },
      };
      game.figureConditions = {
        'Greedo-1-0': ['Hide'],
      };
      const attackerMsgId = findDcMsgId(dcMessageMeta, game.gameId, 1, 'Bossk');
      enableAttackFor(game, attackerMsgId);
      return {
        ...built,
        attacker: { playerNum: 1, figureKey: 'Bossk-1-0', msgId: attackerMsgId, figureIndex: 0 },
      };
    },
    expectedHandlerOnly: [],
    expectedEngineOnly: [],
    reason: 'Handler no longer filters Hidden targets (fixed 2026-04-16; dc-play-area.js target enumeration loop). Both sides now correctly include the Hidden target; combat resolution applies the -2 accuracy penalty per CRR (combat.js:221–224 + PROBE-TOKEN-001..003).',
  },

  // 4. nextAttackReach flag — same outcome shape as #2 but triggered by a flag
  //    rather than a DC keyword. Exercises the per-attack override path.
  {
    name: 'nextAttackReach flag — melee attacker granted Reach for next attack via flag',
    setup() {
      const built = createTestGame()
        .withPlayer1Army([{ dcName: 'Kanan Jarrus' }])   // melee, no REACH keyword
        .withPlayer2Army([{ dcName: 'Greedo' }])
        .inRound(1)
        .build();
      const { game, dcMessageMeta } = built;
      game.figurePositions = {
        1: { 'Kanan Jarrus-1-0': 'a1' },
        2: { 'Greedo-1-0': 'a3' },
      };
      const attackerMsgId = findDcMsgId(dcMessageMeta, game.gameId, 1, 'Kanan Jarrus');
      enableAttackFor(game, attackerMsgId);
      // Grant Reach for next attack via flag
      game.nextAttackReach = { 1: attackerMsgId };
      return {
        ...built,
        attacker: { playerNum: 1, figureKey: 'Kanan Jarrus-1-0', msgId: attackerMsgId, figureIndex: 0 },
      };
    },
    expectedHandlerOnly: [],
    expectedEngineOnly: [],
    reason: 'Engine now reads game.nextAttackReach[playerNum] and extends melee maxRange to 2 when set (fixed 2026-04-16; available-actions.js:2149-2170). Both sides agree. Fury of Kashyyyk and Electrostaff loadout-card Reach also closed 2026-04-17 (scenarios 12/13).',
  },

  // 5. Priority Target — handler ignores figure-blocking LOS via abilityText
  //    parse; engine counts intervening figures as blockers.
  {
    name: 'Priority Target — ranged attacker with Priority Target vs target behind friendly figure',
    setup() {
      const built = createTestGame()
        .withPlayer1Army([
          { dcName: 'Rebel Saboteur (Elite)' },  // has Priority Target abilityText
          { dcName: 'Bossk' },                   // the friendly figure that would block LOS for engine
        ])
        .withPlayer2Army([{ dcName: 'Greedo' }])
        .inRound(1)
        .build();
      const { game, dcMessageMeta } = built;
      // Place attacker at a1, blocker at a2, target at a3 — engine sees a2 blocking LOS
      game.figurePositions = {
        1: {
          'Rebel Saboteur (Elite)-1-0': 'a1',
          'Bossk-2-0': 'a2',
        },
        2: { 'Greedo-1-0': 'a3' },
      };
      const attackerMsgId = findDcMsgId(dcMessageMeta, game.gameId, 1, 'Rebel Saboteur (Elite)');
      enableAttackFor(game, attackerMsgId);
      return {
        ...built,
        attacker: {
          playerNum: 1,
          figureKey: 'Rebel Saboteur (Elite)-1-0',
          msgId: attackerMsgId,
          figureIndex: 0,
        },
      };
    },
    expectedHandlerOnly: [],
    expectedEngineOnly: [],
    reason: 'Engine now parses abilityText for Priority Target and nulls the figure-blocking set when abilityText contains both "priority target" and "line of sight" (fixed 2026-04-17; available-actions.js:2205-2220). Both sides agree.',
  },

  // 6. Marksman CC (nextAttackIgnoreFigureLOS) — handler-only LOS bypass flag
  {
    name: 'Marksman CC — figure-blocked LOS bypassed via nextAttackIgnoreFigureLOS flag',
    setup() {
      const built = createTestGame()
        .withPlayer1Army([{ dcName: 'Bossk' }, { dcName: 'Stormtrooper (Regular)' }])
        .withPlayer2Army([{ dcName: 'Greedo' }])
        .inRound(1)
        .build();
      const { game, dcMessageMeta } = built;
      // Bossk at a1 (attacker), friendly Stormtrooper at a2 (blocker), Greedo at a3
      game.figurePositions = {
        1: {
          'Bossk-1-0': 'a1',
          'Stormtrooper (Regular)-2-0': 'a2',
        },
        2: { 'Greedo-1-0': 'a3' },
      };
      const attackerMsgId = findDcMsgId(dcMessageMeta, game.gameId, 1, 'Bossk');
      enableAttackFor(game, attackerMsgId);
      game.nextAttackIgnoreFigureLOS = { [attackerMsgId]: true };
      return {
        ...built,
        attacker: { playerNum: 1, figureKey: 'Bossk-1-0', msgId: attackerMsgId, figureIndex: 0 },
      };
    },
    expectedHandlerOnly: [],
    expectedEngineOnly: [],
    reason: 'Engine now reads game.nextAttackIgnoreFigureLOS[msgId] and nulls the figure-blocking set when set (fixed 2026-04-17; available-actions.js:2205-2220). Both sides agree. Handler consumes the flag at attack resolution; engine target enumeration remains read-only.',
  },

  // 7. Clawdite Shapeshifter Scout form — handler-only LOS bypass via figure config
  {
    name: 'Clawdite Scout form — figure-blocked LOS bypassed via figureConfig.form',
    setup() {
      const built = createTestGame()
        .withPlayer1Army([
          { dcName: 'Clawdite Shapeshifter (Regular)' },
          { dcName: 'Stormtrooper (Regular)' },
        ])
        .withPlayer2Army([{ dcName: 'Greedo' }])
        .inRound(1)
        .build();
      const { game, dcMessageMeta } = built;
      game.figurePositions = {
        1: {
          'Clawdite Shapeshifter (Regular)-1-0': 'a1',
          'Stormtrooper (Regular)-2-0': 'a2',   // friendly blocker
        },
        2: { 'Greedo-1-0': 'a3' },
      };
      const attackerMsgId = findDcMsgId(dcMessageMeta, game.gameId, 1, 'Clawdite Shapeshifter (Regular)');
      enableAttackFor(game, attackerMsgId);
      // Set Clawdite form to 'Scout' (grants Priority Target per handler logic)
      game.figureConfig = { 'Clawdite Shapeshifter (Regular)-1-0': { form: 'Scout' } };
      return {
        ...built,
        attacker: {
          playerNum: 1,
          figureKey: 'Clawdite Shapeshifter (Regular)-1-0',
          msgId: attackerMsgId,
          figureIndex: 0,
        },
      };
    },
    expectedHandlerOnly: [],
    expectedEngineOnly: [],
    reason: 'Engine now reads figureConfig.form via getConfig and nulls the figure-blocking set when form === "Scout" (fixed 2026-04-17; available-actions.js:2205-2220). Both sides agree.',
  },

  // 8. Insignificant (Dio) — BOTH sides implement; positive-control / regression guard
  {
    name: 'Insignificant (Dio) — both sides exclude Dio when sharing a space with friendly (positive control)',
    setup() {
      const built = createTestGame()
        .withPlayer1Army([{ dcName: 'Bossk' }])
        .withPlayer2Army([{ dcName: 'Iden Versio' }, { dcName: 'Dio' }])
        .inRound(1)
        .build();
      const { game, dcMessageMeta } = built;
      game.figurePositions = {
        1: { 'Bossk-1-0': 'a1' },
        2: {
          'Iden Versio-1-0': 'a3',
          'Dio-2-0': 'a3',                   // Dio on same space as Iden (companion)
        },
      };
      const attackerMsgId = findDcMsgId(dcMessageMeta, game.gameId, 1, 'Bossk');
      enableAttackFor(game, attackerMsgId);
      return {
        ...built,
        attacker: { playerNum: 1, figureKey: 'Bossk-1-0', msgId: attackerMsgId, figureIndex: 0 },
      };
    },
    expectedHandlerOnly: [],
    expectedEngineOnly: [],
    reason: 'Insignificant (Dio) is implemented identically on both sides — handler at dc-play-area.js:990–998 and engine at available-actions.js:2209–2216 both skip Dio when on same space as another P2 figure. Positive control: this scenario fails if either side removes the check.',
  },

  // 9. I Must Go Alone (roundDefenderCannotBeTargetedUnlessWithinSpaces) — handler-only distance cap
  //    Using Boba Fett (accuracy ceiling 11) as attacker so the engine's
  //    accuracy-based range cap doesn't hide the divergence.
  {
    name: 'I Must Go Alone — handler applies distance cap; engine does not',
    setup() {
      const built = createTestGame()
        .withPlayer1Army([{ dcName: 'Boba Fett' }])
        .withPlayer2Army([{ dcName: 'Greedo' }])
        .inRound(1)
        .build();
      const { game, dcMessageMeta } = built;
      // Boba Fett at a1, Greedo at a5 (distance 4 on grid)
      game.figurePositions = {
        1: { 'Boba Fett-1-0': 'a1' },
        2: { 'Greedo-1-0': 'a5' },
      };
      const attackerMsgId = findDcMsgId(dcMessageMeta, game.gameId, 1, 'Boba Fett');
      enableAttackFor(game, attackerMsgId);
      // Protect P2 within-3-spaces only — Greedo is 4 spaces away, handler filters
      game.roundDefenderCannotBeTargetedUnlessWithinSpaces = { playerNum: 2, spaces: 3 };
      return {
        ...built,
        attacker: { playerNum: 1, figureKey: 'Boba Fett-1-0', msgId: attackerMsgId, figureIndex: 0 },
      };
    },
    expectedHandlerOnly: [],
    expectedEngineOnly: [],
    reason: 'Closed 2026-04-17 at available-actions.js:2268-2271 — engine now mirrors handler dc-play-area.js:1012-1013 by filtering targets beyond game.roundDefenderCannotBeTargetedUnlessWithinSpaces.spaces when the flag protects the enemy player (I Must Go Alone CC). Positive control: this scenario fails if either side removes the check.',
  },

  // 10. Fire Mission — handler uses group-LOS delegation; engine only checks attacker LOS
  {
    name: 'Fire Mission — handler uses group-LOS delegation; engine only checks attacker LOS',
    setup() {
      const built = createTestGame()
        .withPlayer1Army([{ dcName: 'Stormtrooper (Regular)' }])     // 3-figure group
        .withPlayer2Army([{ dcName: 'Boba Fett' }, { dcName: 'Greedo' }])
        .inRound(1)
        .build();
      const { game, dcMessageMeta } = built;
      game.figurePositions = {
        1: {
          'Stormtrooper (Regular)-1-0': 'a1',  // attacker (LOS blocked)
          'Stormtrooper (Regular)-1-1': 'c1',  // group member with alt LOS
          'Stormtrooper (Regular)-1-2': 'z1',  // parked
        },
        2: {
          'Boba Fett-1-0': 'a2',               // blocker + valid target at dist 1
          'Greedo-2-0': 'a3',                  // target behind blocker (dist 2)
        },
      };
      const attackerMsgId = findDcMsgId(dcMessageMeta, game.gameId, 1, 'Stormtrooper (Regular)');
      enableAttackFor(game, attackerMsgId);
      game.fireMissionActive = { [attackerMsgId]: true };
      return {
        ...built,
        attacker: {
          playerNum: 1,
          figureKey: 'Stormtrooper (Regular)-1-0',
          msgId: attackerMsgId,
          figureIndex: 0,
        },
      };
    },
    expectedHandlerOnly: [],
    expectedEngineOnly: [],
    reason: 'Closed 2026-04-17 at available-actions.js:2297-2318 — engine now mirrors handler dc-play-area.js:1032-1050 by retrying LOS from every other figure in the attacker group when game.fireMissionActive[msgId] is set. Attachment-aware figure count adjusts for Z-6/Mortar/Riot Trooper upgrades. Uses same _aaEffectiveMs and losBlockingCoords as primary LOS, so doors/shields/figure-blocking rules stay consistent. Blast 1 is a combat-resolution concern and out of scope for target enumeration parity. Positive control: this scenario fails if either side removes the group-LOS retry.',
  },

  // 11. Vanish immunity — handler-only exclusion by matching DC name prefix
  {
    name: 'Vanish immunity — handler filters target whose DC name matches vanished entry; engine does not',
    setup() {
      const built = createTestGame()
        .withPlayer1Army([{ dcName: 'Bossk' }])
        .withPlayer2Army([{ dcName: 'Greedo' }])
        .inRound(1)
        .build();
      const { game, dcMessageMeta } = built;
      game.figurePositions = {
        1: { 'Bossk-1-0': 'a1' },
        2: { 'Greedo-1-0': 'a3' },
      };
      const attackerMsgId = findDcMsgId(dcMessageMeta, game.gameId, 1, 'Bossk');
      const greedoMsgId = findDcMsgId(dcMessageMeta, game.gameId, 2, 'Greedo');
      enableAttackFor(game, attackerMsgId);
      // Greedo just used Vanish — immune until next activation
      game.vanishImmunityUntilNextActivation = {
        2: { msgId: greedoMsgId, nextMp: 0 },
      };
      return {
        ...built,
        attacker: { playerNum: 1, figureKey: 'Bossk-1-0', msgId: attackerMsgId, figureIndex: 0 },
      };
    },
    expectedHandlerOnly: [],
    expectedEngineOnly: [],
    reason: 'Closed 2026-04-17 at available-actions.js:2267-2274 — engine now mirrors handler dc-play-area.js:1002-1006 by reading game.vanishImmunityUntilNextActivation[enemyPn], looking up the protected dcName via deps.dcMessageMeta, and skipping figureKeys that start with that dcName (covers all group/figure indices). Positive control: this scenario fails if either side removes the check.',
  },

  // 12. Fury of Kashyyyk — attachment-granted Reach for WOOKIEE attackers
  {
    name: 'Fury of Kashyyyk — WOOKIEE melee attacker with [Fury of Kashyyyk] attachment gains Reach in handler only',
    setup() {
      const built = createTestGame()
        .withPlayer1Army([
          { dcName: 'Wookiee Warrior (Regular)' },   // melee, WOOKIEE, no permanent Reach
          { dcName: '[Fury of Kashyyyk]' },          // figureless attachment
        ])
        .withPlayer2Army([{ dcName: 'Greedo' }])
        .inRound(1)
        .build();
      const { game, dcMessageMeta } = built;
      game.figurePositions = {
        1: { 'Wookiee Warrior (Regular)-1-0': 'a1' },
        2: { 'Greedo-1-0': 'a3' },                   // distance 2
      };
      const attackerMsgId = findDcMsgId(dcMessageMeta, game.gameId, 1, 'Wookiee Warrior (Regular)');
      enableAttackFor(game, attackerMsgId);
      return {
        ...built,
        attacker: {
          playerNum: 1,
          figureKey: 'Wookiee Warrior (Regular)-1-0',
          msgId: attackerMsgId,
          figureIndex: 0,
        },
      };
    },
    expectedHandlerOnly: [],
    expectedEngineOnly: [],
    reason: 'Engine now applies Fury of Kashyyyk Reach to WOOKIEE attackers when the attachment is in the dcList (fixed 2026-04-17; available-actions.js:2149-2170 extends melee maxRange to 2). Both sides agree.',
  },

  // 13. Electrostaff loadout-card Reach — handler reads loadout-card passive
  {
    name: 'Electrostaff loadout — Purge Trooper (Elite) with Electrostaff loadout gains Reach in handler only',
    setup() {
      const built = createTestGame()
        .withPlayer1Army([{ dcName: 'Purge Trooper (Elite)' }])
        .withPlayer2Army([{ dcName: 'Greedo' }])
        .inRound(1)
        .build();
      const { game, dcMessageMeta } = built;
      game.figurePositions = {
        1: { 'Purge Trooper (Elite)-1-0': 'a1' },
        2: { 'Greedo-1-0': 'a3' },                     // distance 2
      };
      const attackerMsgId = findDcMsgId(dcMessageMeta, game.gameId, 1, 'Purge Trooper (Elite)');
      enableAttackFor(game, attackerMsgId);
      // Simulate the loadout selection (normally chosen via the Imperial
      // Loadout picker after deployment). Electrostaff's passive is 'Reach'
      // in data/loadout-cards.json.
      game.figureConfig = {
        'Purge Trooper (Elite)-1-0': { loadout: 'Electrostaff' },
      };
      return {
        ...built,
        attacker: {
          playerNum: 1,
          figureKey: 'Purge Trooper (Elite)-1-0',
          msgId: attackerMsgId,
          figureIndex: 0,
        },
      };
    },
    expectedHandlerOnly: [],
    expectedEngineOnly: [],
    reason: 'Engine now reads figureConfig.loadout and treats loadout-card passive === "Reach" as an attacker-side Reach grant (fixed 2026-04-17; available-actions.js:2149-2170 via getLoadoutCards + getConfig). Both sides agree.',
  },

  // 14. Closed door — engine does not merge closed-door edges into mapSpaces
  //    before calling hasLineOfSight. Handler merges them into effectiveMs so
  //    the door becomes a wall for LOS purposes.
  {
    name: 'Closed door — engine ignores door edges in LOS; handler merges them as walls',
    setup() {
      const built = createTestGame()
        .withMap('mos-eisley-outskirts')      // doors: r11|r12 and s11|s12
        .withPlayer1Army([{ dcName: 'Bossk' }])
        .withPlayer2Army([{ dcName: 'Greedo' }])
        .inRound(1)
        .build();
      const { game, dcMessageMeta } = built;
      // Bossk (1x1) at r11, Greedo (1x1) at r12 — straight across closed door.
      // Both doors default-closed (game.openedDoors unset).
      game.figurePositions = {
        1: { 'Bossk-1-0': 'r11' },
        2: { 'Greedo-1-0': 'r12' },
      };
      const attackerMsgId = findDcMsgId(dcMessageMeta, game.gameId, 1, 'Bossk');
      enableAttackFor(game, attackerMsgId);
      return {
        ...built,
        attacker: { playerNum: 1, figureKey: 'Bossk-1-0', msgId: attackerMsgId, figureIndex: 0 },
      };
    },
    expectedHandlerOnly: [],
    expectedEngineOnly: [],
    reason: 'Engine now merges closed-door edges into effectiveMs.impassableEdges before calling hasLineOfSight (fixed 2026-04-17; available-actions.js:2165-2190). Both sides agree: closed doors block LOS.',
  },

  // 15. Multi-cell attacker — engine only calls hasLineOfSight with the
  //    attacker's top-left cell; handler iterates attacker footprint × target
  //    footprint. Scenario uses the static p14|q14 impassable edge in
  //    mos-eisley-outskirts: the wall blocks sightlines from the top row of
  //    the 2x2 attacker (o14, p14) but not from the back row (o15, p15).
  {
    name: 'Multi-cell attacker — engine checks top-left only; handler iterates footprint',
    setup() {
      const built = createTestGame()
        .withMap('mos-eisley-outskirts')
        .withPlayer1Army([{ dcName: 'AT-RT' }])      // 2x2 ranged attacker
        .withPlayer2Army([{ dcName: 'Greedo' }])
        .inRound(1)
        .build();
      const { game, dcMessageMeta } = built;
      // AT-RT top-left at o14 occupies {o14, p14, o15, p15}. Static wall
      // p14|q14 (vertical edge at x=15.5 across row 13) blocks sightlines
      // from o14 and p14 to r14. Back-row cells o15/p15 are at row 14 — their
      // sightlines to r14 clear the wall. No doors involved; purely static
      // impassableEdges, so the engine sees the wall too.
      game.figurePositions = {
        1: { 'AT-RT-1-0': 'o14' },
        2: { 'Greedo-1-0': 'r14' },
      };
      const attackerMsgId = findDcMsgId(dcMessageMeta, game.gameId, 1, 'AT-RT');
      enableAttackFor(game, attackerMsgId);
      return {
        ...built,
        attacker: { playerNum: 1, figureKey: 'AT-RT-1-0', msgId: attackerMsgId, figureIndex: 0 },
      };
    },
    expectedHandlerOnly: [],
    expectedEngineOnly: [],
    reason: 'Engine now iterates attacker-footprint × target-footprint for both distance and LOS (fixed 2026-04-17; available-actions.js:2219-2272). Both sides find a clear line from the back-row cell o15 or p15 to r14 and include Greedo.',
  },

  // 16. Energy shield — engine is shield-blind; handler merges shield spaces
  //    into mapSpaces.blocking. Open row 3 in mos-eisley-outskirts has no
  //    static walls or doors, so the shield placed at e3 is the ONLY LOS
  //    blocker between attacker at d3 and target at f3. CRR p.28: "A space
  //    containing an energy shield blocks LOS" but "LOS can be traced to"
  //    and "drawn out of" the shielded space. Here the shield is between
  //    (not on either endpoint), so LOS must be blocked — only the handler
  //    enforces this. Distance d3 → f3 = 2, within Bossk's 3-acc ceiling
  //    so the range gate does not confound the LOS signal.
  {
    name: 'Energy shield — engine ignores shield spaces; handler merges them into blocking',
    setup() {
      const built = createTestGame()
        .withMap('mos-eisley-outskirts')
        .withPlayer1Army([{ dcName: 'Bossk' }])
        .withPlayer2Army([{ dcName: 'Greedo' }])
        .inRound(1)
        .build();
      const { game, dcMessageMeta } = built;
      game.figurePositions = {
        1: { 'Bossk-1-0': 'd3' },
        2: { 'Greedo-1-0': 'f3' },
      };
      game.ancillaryTokens = { energyShield: ['e3'] };
      const attackerMsgId = findDcMsgId(dcMessageMeta, game.gameId, 1, 'Bossk');
      enableAttackFor(game, attackerMsgId);
      return {
        ...built,
        attacker: { playerNum: 1, figureKey: 'Bossk-1-0', msgId: attackerMsgId, figureIndex: 0 },
      };
    },
    expectedHandlerOnly: [],
    expectedEngineOnly: [],
    reason: 'Engine now merges game.ancillaryTokens.energyShield into effectiveMs.blocking before calling hasLineOfSight (fixed 2026-04-17; available-actions.js:2165-2190). Both sides exclude Greedo when a shield at e3 sits between d3 and f3.',
  },

  // 17. C54 Smoke Grenade — engine was smoke-blind; handler merges smoke
  //    spaces into mapSpaces.blocking alongside energy shields. Same open
  //    row 3 corridor on mos-eisley-outskirts: smoke at e3 is the only LOS
  //    blocker between attacker at d3 and target at f3. Same shape as
  //    scenario 16 (shield) — they now share the engine's extraBlocking lane.
  {
    name: 'Smoke token — engine ignores smoke spaces; handler merges them into blocking',
    setup() {
      const built = createTestGame()
        .withMap('mos-eisley-outskirts')
        .withPlayer1Army([{ dcName: 'Bossk' }])
        .withPlayer2Army([{ dcName: 'Greedo' }])
        .inRound(1)
        .build();
      const { game, dcMessageMeta } = built;
      game.figurePositions = {
        1: { 'Bossk-1-0': 'd3' },
        2: { 'Greedo-1-0': 'f3' },
      };
      game.ancillaryTokens = { smoke: ['e3'] };
      const attackerMsgId = findDcMsgId(dcMessageMeta, game.gameId, 1, 'Bossk');
      enableAttackFor(game, attackerMsgId);
      return {
        ...built,
        attacker: { playerNum: 1, figureKey: 'Bossk-1-0', msgId: attackerMsgId, figureIndex: 0 },
      };
    },
    expectedHandlerOnly: [],
    expectedEngineOnly: [],
    reason: 'Engine now merges game.ancillaryTokens.smoke into effectiveMs.blocking alongside energyShield (fixed 2026-04-17; available-actions.js:2177-2201). Both sides exclude Greedo when a smoke token at e3 sits between d3 and f3.',
  },
];
