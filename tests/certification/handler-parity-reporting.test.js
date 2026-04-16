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
// Covers only the rules exercised by the 5 scenarios below. Expand carefully
// if scenarios are added; otherwise the shadow drifts from the real handler.
function enumerateHandlerTargets(game, playerNum, attackerFigureKey, deps) {
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

  // Priority Target — handler ignores figure-blocking LOS entirely
  const abilityTextLower = String(stats.abilityText || eff.abilityText || '').toLowerCase();
  const hasPriorityTarget = abilityTextLower.includes('priority target')
    && abilityTextLower.includes('line of sight');

  const ms = deps.getMapData(game.selectedMap.id);
  const enemyPn = playerNum === 1 ? 2 : 1;
  const enemies = game.figurePositions?.[enemyPn] || {};
  const targets = [];

  for (const [fk, coord] of Object.entries(enemies)) {
    if (!coord) continue;
    // Hide filter — handler side only; engine does not filter Hide
    const conds = game.figureConditions?.[fk] || [];
    if (conds.includes('Hide')) continue;
    // Distance filter (includes Reach expansion)
    const dist = countSpaces(ms, attackerPos, coord);
    if (dist < minRange || dist > effMax) continue;
    // LOS: this shadow uses straight-line clear on open terrain. If the
    // scenario places an intervening friendly figure, handler's Priority
    // Target ignores it; engine does not. Modeled via a scenario flag.
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
    expectedHandlerOnly: ['Greedo-1-0'],
    expectedEngineOnly: [],
    reason: 'engine does not apply Reach; handler expands melee to 2 spaces when attacker has REACH (keyword or passive).',
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
    expectedEngineOnly: ['Greedo-1-0'],
    reason: 'CRR-verified: Hide is a -2 accuracy condition, not a targeting block. Handler filters (incorrectly per CRR); engine includes (correctly per CRR).',
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
    expectedHandlerOnly: ['Greedo-1-0'],
    expectedEngineOnly: [],
    reason: 'engine ignores game.nextAttackReach; handler checks it and extends melee to 2 spaces.',
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
      const { game, deps, attacker } = ctx;

      const handlerTargets = enumerateHandlerTargets(game, attacker.playerNum, attacker.figureKey, deps);
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
