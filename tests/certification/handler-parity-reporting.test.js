/**
 * Handler-vs-Engine Target Enumeration Parity — non-mutating surfacing layer.
 *
 * Compares what the Discord handler (buildAndSendAttackTargets in
 * src/handlers/dc-play-area.js) would enumerate as legal attack targets
 * against what the AI engine (getAvailableActions in
 * src/engine/available-actions.js) enumerates for the same game state.
 *
 * Because buildAndSendAttackTargets is internal (sends Discord buttons as
 * a side effect), this test uses a small, scenario-scoped shadow function
 * that mirrors ONLY the handler rules exercised by the 5 scenarios:
 * range default, Reach (keyword/passive + nextAttackReach flag), Hide
 * filter, and Priority Target LOS bypass. The shadow does NOT replicate
 * every handler rule — scenarios that exercise other rules (Fire Mission,
 * Clawdite Scout, Marksman CC, Insignificant Dio, iMustGoAlone) will need
 * their own rule-specific shadow additions or a different approach.
 *
 * Baseline-and-fail-on-growth:
 *   - each scenario documents expectedHandlerOnly / expectedEngineOnly keys
 *   - on divergence from baseline (new unexpected gap OR a known gap
 *     disappearing), the test fails with a clear message
 *   - always logs handler targets / engine targets / diff per scenario
 *
 * Non-mutating: test-only. No src/ changes, no new exports required.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createTestGame } from '../fixtures/game-builder.js';
import { getAvailableActions } from '../../src/engine/available-actions.js';
import { defaultAttackRange } from '../../src/handlers/dc-play-area.js';
import { countSpaces } from '../../src/game/spatial.js';
import { dcNameFromFigureKey } from '../../src/game/dc-helpers.js';

// ── Shadow: narrow mirror of handler's target enumeration ───────────────────
// Covers only the rules exercised by the scenarios below. Expand carefully
// when scenarios are added; otherwise the shadow drifts from the real handler.
//
// Scoped LOS policy: the shadow does NOT model figure-blocking LOS. Scenarios
// are constructed so this is either trivially correct (open-terrain scenarios)
// or matches the real handler's bypass behavior (Marksman, Priority Target,
// Clawdite Scout, Fire Mission — all flag-active scenarios where the real
// handler also bypasses figure-blocking LOS).
function enumerateHandlerTargets(game, playerNum, attackerFigureKey, deps, dcMessageMeta) {
  const attackerPos = game.figurePositions?.[playerNum]?.[attackerFigureKey];
  if (!attackerPos) return [];

  const attackerDcName = dcNameFromFigureKey(attackerFigureKey);
  const stats = deps.getDcStats(attackerDcName);
  if (!stats?.attack) return [];

  // Pending free-attack windows — handler blocks normal attacks during these
  // (Note: the actual gate lives in combat.js, not in buildAndSendAttackTargets.
  // Modeled here as a scenario-level fact only.)
  if (game.pendingFiringSquad || game.pendingCoordinatedRaid || game.pendingFieldTactics) {
    return [];
  }

  const [minRange, maxRange] = defaultAttackRange(stats.attack);

  // Reach — keyword on attacker OR passive-named-REACH OR nextAttackReach flag
  const eff = deps.getDcEffects()[attackerDcName]
    || deps.getDcEffects()[attackerDcName.replace(/\s*\[.*\]\s*$/, '')]
    || {};
  const kws = (eff.keywords || []).map(k => String(k).toUpperCase());
  const passives = (eff.passives || []).map(p => String(p).toUpperCase());
  const hasReach =
    kws.includes('REACH') ||
    passives.includes('REACH') ||
    !!game.nextAttackReach?.[playerNum];
  const effMax = hasReach && maxRange < 2 ? 2 : maxRange;

  const ms = deps.getMapData(game.selectedMap.id);
  const enemyPn = playerNum === 1 ? 2 : 1;
  const enemies = game.figurePositions?.[enemyPn] || {};

  // I Must Go Alone — distance cap when flag set for the enemy player
  const iMustGoAlone = game.roundDefenderCannotBeTargetedUnlessWithinSpaces;
  const iMustGoAloneSpaces =
    iMustGoAlone && iMustGoAlone.playerNum === enemyPn ? iMustGoAlone.spaces : null;

  // Vanish immunity — filter targets whose figure key matches vanished DC name
  const vanishImmunity = game.vanishImmunityUntilNextActivation?.[enemyPn];
  const vanishMeta = vanishImmunity && dcMessageMeta?.get
    ? dcMessageMeta.get(vanishImmunity.msgId)
    : null;
  const vanishedDcPrefix = vanishMeta ? `${vanishMeta.dcName}-` : null;

  const targets = [];
  for (const [fk, coord] of Object.entries(enemies)) {
    if (!coord) continue;

    // Vanish immunity (handler-only): skip figures whose key starts with the
    // vanished DC's dcName.
    if (vanishedDcPrefix && fk.startsWith(vanishedDcPrefix)) continue;

    // Distance filter (includes Reach expansion)
    const dist = countSpaces(ms, attackerPos, coord);
    if (dist < minRange || dist > effMax) continue;

    // I Must Go Alone (handler-only): cap distance further
    if (iMustGoAloneSpaces != null && dist > iMustGoAloneSpaces) continue;

    // Insignificant (Dio): skip if target shares space with another
    // friendly-to-target figure. Implemented identically on both sides.
    const targetDcName = dcNameFromFigureKey(fk);
    const targetEff = deps.getDcEffects()[targetDcName]
      || deps.getDcEffects()[targetDcName.replace(/\s*\[.*\]\s*$/, '')]
      || {};
    if ((targetEff.specialAbilityIds || []).includes('insignificant_dio')) {
      const coordLc = String(coord).toLowerCase();
      const hasFriendlyInSpace = Object.entries(enemies).some(([ffk, fpos]) =>
        ffk !== fk && fpos && String(fpos).toLowerCase() === coordLc
      );
      if (hasFriendlyInSpace) continue;
    }

    // Hide is NOT a target-filter per CRR (removed 2026-04-16). Shadow
    // matches the post-fix handler.
    // LOS: shadow does not apply figure-blocking. Scenarios are authored
    // to either use open terrain OR set a flag that causes the real handler
    // to bypass figure-blocking LOS (Marksman, Priority Target, Clawdite
    // Scout form, Fire Mission).
    targets.push(fk);
  }
  return targets;
}

// ── Engine side: pull attack_target actions for a specific attacker ─────────
function enumerateEngineTargets(game, playerNum, attackerMsgId, attackerFigureIndex, deps) {
  const actions = getAvailableActions(game, playerNum, deps);
  const targets = [];
  for (const a of actions) {
    if (a.type !== 'attack_target') continue;
    if (!a.params?.targetFigureKey) continue;
    if (a.params.msgId !== attackerMsgId) continue;
    // figureIndex is embedded in the customId: attack_target_{msgId}_{figIdx}_{targetIdx}
    const parts = (a.customId || '').split('_');
    const figIdxFromId = Number(parts[parts.length - 2]);
    if (figIdxFromId !== attackerFigureIndex) continue;
    targets.push(a.params.targetFigureKey);
  }
  return targets;
}

// ── Helpers to set up an active attacker ────────────────────────────────────
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

// ── Scenarios (5) ────────────────────────────────────────────────────────────

const SCENARIOS = [
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
    reason: 'Engine now applies permanent Reach (fixed 2026-04-16; available-actions.js extends melee maxRange to 2 when attacker has REACH keyword or passive). Both sides agree. Fury of Kashyyyk conditional WOOKIEE Reach and Electrostaff loadout-card Reach remain engine-only gaps.',
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
    reason: 'Engine now reads game.nextAttackReach[playerNum] and extends melee maxRange to 2 when set (fixed 2026-04-16; available-actions.js:2149-2157). Both sides agree. Fury of Kashyyyk conditional WOOKIEE Reach and Electrostaff loadout-card Reach remain engine-only gaps.',
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
    // Expectation depends on whether the scenario actually places a blocking
    // figure such that engine rejects it. With a1 → a2 → a3 in a straight
    // line, engine's figure-blocking LOS excludes Greedo. Handler's
    // Priority Target bypass includes Greedo.
    expectedHandlerOnly: ['Greedo-1-0'],
    expectedEngineOnly: [],
    reason: 'engine does not parse abilityText for Priority Target; handler bypasses figure-blocking LOS for DCs whose abilityText mentions both "priority target" and "line of sight".',
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
    expectedHandlerOnly: ['Greedo-1-0'],
    expectedEngineOnly: [],
    reason: 'engine has no reference to game.nextAttackIgnoreFigureLOS; handler bypasses figure-blocking LOS for one attack when this flag is set (Marksman CC).',
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
    expectedHandlerOnly: ['Greedo-1-0'],
    expectedEngineOnly: [],
    reason: 'engine does not read figureConfig.form; handler treats Scout form as granting Priority Target (figure-blocking LOS bypass) via getConfig(game, figureKey).form === "Scout".',
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
    expectedEngineOnly: ['Greedo-1-0'],
    reason: 'engine has no reference to game.roundDefenderCannotBeTargetedUnlessWithinSpaces; handler filters targets beyond the spaces cap when the flag protects the enemy player (I Must Go Alone CC).',
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
    expectedHandlerOnly: ['Greedo-2-0'],
    expectedEngineOnly: [],
    reason: 'handler with fireMissionActive=true uses LOS from any figure in the group and adds Blast 1; engine only checks attacker LOS and has no fireMissionActive reference (Mortar Trooper Fire Mission).',
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
    expectedEngineOnly: ['Greedo-1-0'],
    reason: 'engine has no reference to game.vanishImmunityUntilNextActivation; handler filters targets whose figureKey starts with the vanished DC\'s dcName (Vanish CC).',
  },
];

// ── Runner ───────────────────────────────────────────────────────────────────
function sorted(a) { return [...a].sort(); }
function diff(a, b) {
  const setB = new Set(b);
  return [...a].filter(x => !setB.has(x));
}

describe('Handler-vs-Engine Target Enumeration Parity (non-mutating surfacing)', () => {
  for (const s of SCENARIOS) {
    it(s.name, () => {
      const ctx = s.setup();
      const { game, deps, dcMessageMeta, attacker } = ctx;

      const handlerTargets = enumerateHandlerTargets(game, attacker.playerNum, attacker.figureKey, deps, dcMessageMeta);
      const engineTargets = enumerateEngineTargets(
        game, attacker.playerNum, attacker.msgId, attacker.figureIndex, deps
      );

      const hSet = new Set(handlerTargets);
      const eSet = new Set(engineTargets);
      const handlerOnly = sorted(diff(hSet, eSet));
      const engineOnly = sorted(diff(eSet, hSet));

      console.log(`\n[parity] ${s.name}`);
      console.log(`  handler: [${sorted(hSet).join(', ')}]`);
      console.log(`  engine:  [${sorted(eSet).join(', ')}]`);
      console.log(`  handler_only: [${handlerOnly.join(', ')}]`);
      console.log(`  engine_only:  [${engineOnly.join(', ')}]`);
      const matchedBaseline =
        JSON.stringify(handlerOnly) === JSON.stringify(sorted(s.expectedHandlerOnly)) &&
        JSON.stringify(engineOnly) === JSON.stringify(sorted(s.expectedEngineOnly));
      console.log(`  baseline: ${matchedBaseline ? '✓ matches' : '✗ MISMATCH'}`);
      console.log(`  reason: ${s.reason}`);

      assert.deepStrictEqual(
        handlerOnly, sorted(s.expectedHandlerOnly),
        `handler_only drift. Expected ${JSON.stringify(sorted(s.expectedHandlerOnly))}, got ${JSON.stringify(handlerOnly)}. ` +
        `Either the handler-side logic changed (shadow needs updating), the engine closed this gap, or a new gap opened. Review and either update the baseline intentionally or fix the drift.`
      );
      assert.deepStrictEqual(
        engineOnly, sorted(s.expectedEngineOnly),
        `engine_only drift. Expected ${JSON.stringify(sorted(s.expectedEngineOnly))}, got ${JSON.stringify(engineOnly)}. ` +
        `Either the engine-side logic changed, the handler closed this gap, or a new gap opened. Review and either update the baseline intentionally or fix the drift.`
      );
    });
  }
});
