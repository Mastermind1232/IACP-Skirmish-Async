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
 * that mirrors handler rules exercised by the 13 scenarios: range default,
 * Reach (keyword/passive + nextAttackReach flag + Fury of Kashyyyk + Electrostaff
 * loadout), Hide non-filter, Priority Target / Marksman / Clawdite LOS bypass,
 * Fire Mission group LOS, Vanish immunity, I Must Go Alone, Insignificant (Dio).
 * The shadow does NOT replicate every handler rule — new scenarios may need
 * rule-specific shadow additions.
 *
 * Baseline-and-fail-on-growth:
 *   - each scenario documents expectedHandlerOnly / expectedEngineOnly keys
 *   - on divergence from baseline (new unexpected gap OR a known gap
 *     disappearing), the test fails with a clear message
 *   - always logs handler targets / engine targets / diff per scenario
 *
 * Scenario data lives in `_crr-baselines.js` so the status-rollup test can
 * read it without re-registering this file's describe block.
 *
 * Non-mutating: test-only. No src/ changes, no new exports required.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { getAvailableActions } from '../../src/engine/available-actions.js';
import { defaultAttackRange } from '../../src/handlers/dc-play-area.js';
import { countSpaces, hasLineOfSight } from '../../src/game/spatial.js';
import { edgeKey, getFootprintCells } from '../../src/game/coords.js';
import { dcNameFromFigureKey } from '../../src/game/dc-helpers.js';
import { getDcList } from '../../src/game/player-helpers.js';
import { getLoadoutCards, getMapTokensData, getFigureSize } from '../../src/data-loader.js';
import { getBrokenWallEdges } from '../../src/game/movement.js';
import { PARITY_SCENARIOS as SCENARIOS } from './_crr-baselines.js';

// ── Shadow: narrow mirror of handler's target enumeration ───────────────────
// Covers only the rules exercised by the scenarios below. Expand carefully
// when scenarios are added; otherwise the shadow drifts from the real handler.
//
// Scoped LOS policy:
//   * wall-based LOS IS modeled. The shadow merges closed-door edges into
//     mapSpaces.impassableEdges and energy-shield spaces into
//     mapSpaces.blocking (parity with dc-play-area.js:940–970), and iterates
//     attacker-footprint × target-footprint (multi-cell LOS) before calling
//     hasLineOfSight. Figure-blocking LOS is passed as null.
//   * figure-blocking LOS is NOT modeled. Scenarios are constructed so this
//     is either trivially correct (open-terrain scenarios) or matches the
//     real handler's bypass behavior (Marksman, Priority Target, Clawdite
//     Scout, Fire Mission — all flag-active scenarios where the real handler
//     also bypasses figure-blocking LOS).
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
  // Fury of Kashyyyk: conditional Reach grant for WOOKIEE attackers when
  // the [Fury of Kashyyyk] attachment is in the player's dcList. Mirrors
  // handler's _hasFuryReach at dc-play-area.js:35-39.
  const _furyReach =
    kws.includes('WOOKIEE') &&
    (getDcList(game, playerNum) || []).some(dc => dc.dcName === '[Fury of Kashyyyk]');
  // Electrostaff: loadout-card Reach. Handler reads
  // getLoadoutCards()[figureConfig[fk].loadout]?.passive === 'Reach'.
  const _loadoutName = game.figureConfig?.[attackerFigureKey]?.loadout;
  const _loadoutReach = _loadoutName
    && getLoadoutCards()?.[_loadoutName]?.passive === 'Reach';
  const hasReach =
    kws.includes('REACH') ||
    passives.includes('REACH') ||
    !!game.nextAttackReach?.[playerNum] ||
    _furyReach ||
    _loadoutReach;
  const effMax = hasReach && maxRange < 2 ? 2 : maxRange;

  const ms = deps.getMapData(game.selectedMap.id);

  // Door + shield + smoke + Wasskah merged LOS: mirrors dc-play-area.js:940–970.
  // Closed-door edges merge into mapSpaces.impassableEdges (and
  // closedDoorEdges passes to countSpaces for distance gating).
  // Energy-shield and C54 Smoke Grenade spaces merge into mapSpaces.blocking
  // per CRR p.28 and the C54 card. Wasskah breakable walls (blue-line edges
  // between two difficult-terrain spaces) are subtracted from base
  // impassableEdges so LOS can pass through them.
  const mapId = game.selectedMap.id;
  const allDoors = getMapTokensData()?.[mapId]?.doors || [];
  const openedSet = new Set((game.openedDoors || []).map(k => String(k).toLowerCase()));
  const closedDoorsRaw = allDoors.filter(e => {
    const a = String(e[0]).toLowerCase(), b = String(e[1]).toLowerCase();
    return !openedSet.has(`${a}|${b}`) && !openedSet.has(`${b}|${a}`);
  });
  const closedDoorEdges = new Set(closedDoorsRaw.map(e => edgeKey(e[0], e[1])));
  const shieldSpaces = (game.ancillaryTokens?.energyShield || []).map(s => String(s).toLowerCase());
  const smokeSpaces = (game.ancillaryTokens?.smoke || []).map(s => String(s).toLowerCase());
  const extraBlocking = [...shieldSpaces, ...smokeSpaces];
  const brokenWalls = getBrokenWallEdges(game, ms);
  const baseImpassable = ms?.impassableEdges || [];
  const filteredImpassable = brokenWalls.size > 0
    ? baseImpassable.filter(e => !brokenWalls.has(edgeKey(e[0], e[1])))
    : baseImpassable;
  const needsOverride = closedDoorsRaw.length > 0 || extraBlocking.length > 0 || brokenWalls.size > 0;
  const effectiveMs = needsOverride
    ? {
        ...ms,
        impassableEdges: closedDoorsRaw.length > 0
          ? [...filteredImpassable, ...closedDoorsRaw]
          : filteredImpassable,
        blocking: extraBlocking.length > 0
          ? [...(ms.blocking || []), ...extraBlocking]
          : ms.blocking,
      }
    : ms;

  // Attacker footprint (multi-cell LOS)
  const attackerSize = game.figureOrientations?.[attackerFigureKey] || getFigureSize(attackerDcName);
  const attackerFpCells = getFootprintCells(attackerPos, attackerSize);

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

    // Target footprint (multi-cell LOS)
    const targetDcName = dcNameFromFigureKey(fk);
    const targetSize = game.figureOrientations?.[fk] || getFigureSize(targetDcName);
    const targetFpCells = getFootprintCells(coord, targetSize);

    // Distance filter (includes Reach expansion, multi-cell attacker-fp ×
    // target-fp minimum, closed-door edges for BFS — mirrors handler).
    const dist = Math.min(...attackerFpCells.flatMap(ac =>
      targetFpCells.map(tc => countSpaces(effectiveMs, ac, tc, closedDoorEdges))
    ));
    if (dist < minRange || dist > effMax) continue;

    // I Must Go Alone (handler-only): cap distance further
    if (iMustGoAloneSpaces != null && dist > iMustGoAloneSpaces) continue;

    // Insignificant (Dio): skip if target shares space with another
    // friendly-to-target figure. Implemented identically on both sides.
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

    // Wall-based LOS (includes closed doors via effectiveMs). Iterates
    // attacker footprint × target footprint — handler grants LOS if any
    // cell-to-cell sightline is clear. Figure-blocking LOS is passed as
    // null (shadow does not model figure blocking; see policy comment).
    let hasLos = false;
    for (const ac of attackerFpCells) {
      for (const tc of targetFpCells) {
        if (hasLineOfSight(ac, tc, effectiveMs, null)) { hasLos = true; break; }
      }
      if (hasLos) break;
    }
    if (!hasLos) continue;

    // Hide is NOT a target-filter per CRR (removed 2026-04-16). Shadow
    // matches the post-fix handler.
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
