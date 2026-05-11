/**
 * Effective line-of-sight: full-fidelity LOS check shared by every
 * attack-eligibility surface so they stay in sync.
 *
 * Inputs:
 *   - closed doors block LOS (rules p.27)
 *   - energy shields block LOS (rules p.29)
 *   - Smoke Grenade tokens block LOS (CRR C54)
 *   - Wasskah broken walls (passable LOS)
 *   - figure blocking, with these exemptions:
 *       * Massive figures don't block (the attacker's keyword)
 *       * Priority Target — attacker ignores figure blocking
 *       * Clawdite Scout form — Priority Target while in Scout form
 *       * Marksman CC played for this attack (`marksmanActive`)
 *       * Massive targets are seen through other figures (target-side)
 *   - multi-cell footprints — LOS allowed from any attacker cell to
 *     any target cell (rules: "may be traced from any space it occupies")
 *
 * Used by:
 *   - dc-play-area.js buildAndSendAttackTargets (target picker)
 *   - handlers/combat.js handleCombatRoll attacker-validity probe
 *   - any future LOS-gated surface
 *
 * `ctx` carries the data-loader / spatial helpers so callers can pass
 * either the handler ctx or a deps bag.
 */
import { hasLineOfSight, countSpaces } from './spatial.js';
import { getBrokenWallEdges } from './movement.js';
import { dcNameFromFigureKey } from './dc-helpers.js';
import { edgeKey } from './coords.js';
import { getConfig } from './figure-config.js';

// Camouflage reciprocal: figures with these abilities do not block LOS for
// hostile figures 4+ spaces away (per card text: "You do not block line of
// sight for those figures"). Mirror buildFigureBlockingCoords in
// dc-play-area.js so the post-declare probe matches the target picker.
const _CAMO_RECIPROCAL_IDS = new Set(['camouflage_mak', 'camouflage_scout_trooper']);

/**
 * Build the effective mapSpaces for LOS calculations: merge closed doors,
 * energy shields, smoke tokens, broken-wall edges. Shared by the picker
 * (buildAndSendAttackTargets) and the post-declare probe in handleCombatRoll.
 *
 * Exported as `_buildLosEffectiveMs` so the probe in combat.js calls the
 * exact same shape that the picker computes inline.
 */
export function _buildLosEffectiveMs(game, ctx) {
  const mapId = game?.selectedMap?.id;
  if (!mapId) return null;
  const { getMapData, getMapTokensData } = ctx || {};
  if (!getMapData) return null;
  const ms = getMapData(mapId);
  if (!ms) return null;
  const allDoors = (getMapTokensData ? (getMapTokensData()[mapId]?.doors || []) : []);
  const openedSet = new Set((game.openedDoors || []).map((k) => String(k).toLowerCase()));
  const closedEdges = allDoors.filter((e) => {
    const a = String(e[0]).toLowerCase(), b = String(e[1]).toLowerCase();
    return !openedSet.has(`${a}|${b}`) && !openedSet.has(`${b}|${a}`);
  });
  const shieldSpaces = (game.ancillaryTokens?.energyShield || []).map((s) => String(s).toLowerCase());
  const smokeSpaces = (game.ancillaryTokens?.smoke || []).map((s) => String(s).toLowerCase());
  const extraBlocking = [...shieldSpaces, ...smokeSpaces];
  const brokenWalls = getBrokenWallEdges ? getBrokenWallEdges(game, ms) : new Set();
  const baseImpassable = ms?.impassableEdges || [];
  const filteredImpassable = brokenWalls.size > 0
    ? baseImpassable.filter((e) => !brokenWalls.has(edgeKey(e[0], e[1])))
    : baseImpassable;
  const mergedImpassable = closedEdges.length > 0 ? [...filteredImpassable, ...closedEdges] : filteredImpassable;
  if (closedEdges.length === 0 && extraBlocking.length === 0 && brokenWalls.size === 0) return ms;
  return {
    ...ms,
    impassableEdges: mergedImpassable,
    blocking: extraBlocking.length > 0 ? [...(ms?.blocking || []), ...extraBlocking] : ms?.blocking,
  };
}

/**
 * @param {object} game
 * @param {number} attackerPlayerNum
 * @param {string} attackerFigureKey
 * @param {number} defenderPlayerNum
 * @param {string} targetFigureKey
 * @param {object} ctx - getMapData, getMapTokensData, getDcEffects, getFigureSize, getFootprintCells
 * @param {object} [opts]
 * @param {boolean} [opts.marksmanActive] - figures don't block this attack
 * @returns {boolean} true if LOS exists
 */
export function hasEffectiveLineOfSight(game, attackerPlayerNum, attackerFigureKey, defenderPlayerNum, targetFigureKey, ctx, opts = {}) {
  const mapId = game?.selectedMap?.id;
  if (!mapId) return false;
  const { getMapData, getMapTokensData, getDcEffects, getFigureSize, getFootprintCells } = ctx || {};
  if (!getMapData || !getDcEffects || !getFigureSize || !getFootprintCells) return false;
  const ms = getMapData(mapId);
  if (!ms) return false;
  const attackerPos = game.figurePositions?.[attackerPlayerNum]?.[attackerFigureKey];
  const targetPos = game.figurePositions?.[defenderPlayerNum]?.[targetFigureKey];
  if (!attackerPos || !targetPos) return false;
  const attackerSize = game.figureOrientations?.[attackerFigureKey] || getFigureSize(dcNameFromFigureKey(attackerFigureKey));
  const targetSize = game.figureOrientations?.[targetFigureKey] || getFigureSize(dcNameFromFigureKey(targetFigureKey));
  const attackerFp = getFootprintCells(attackerPos, attackerSize);
  const targetFp = getFootprintCells(targetPos, targetSize);

  // Build effective map spaces with closed doors + energy shields + smoke + broken walls.
  const allDoors = (getMapTokensData ? (getMapTokensData()[mapId]?.doors || []) : []);
  const openedSet = new Set((game.openedDoors || []).map((k) => String(k).toLowerCase()));
  const closedEdges = allDoors.filter((e) => {
    const a = String(e[0]).toLowerCase(), b = String(e[1]).toLowerCase();
    return !openedSet.has(`${a}|${b}`) && !openedSet.has(`${b}|${a}`);
  });
  const shieldSpaces = (game.ancillaryTokens?.energyShield || []).map((s) => String(s).toLowerCase());
  const smokeSpaces = (game.ancillaryTokens?.smoke || []).map((s) => String(s).toLowerCase());
  const extraBlocking = [...shieldSpaces, ...smokeSpaces];
  const brokenWalls = getBrokenWallEdges ? getBrokenWallEdges(game, ms) : new Set();
  const baseImpassable = ms?.impassableEdges || [];
  const filteredImpassable = brokenWalls.size > 0
    ? baseImpassable.filter((e) => !brokenWalls.has(edgeKey(e[0], e[1])))
    : baseImpassable;
  const mergedImpassable = closedEdges.length > 0 ? [...filteredImpassable, ...closedEdges] : filteredImpassable;
  let effectiveMs = ms;
  if (closedEdges.length > 0 || extraBlocking.length > 0 || brokenWalls.size > 0) {
    effectiveMs = {
      ...ms,
      impassableEdges: mergedImpassable,
      blocking: extraBlocking.length > 0 ? [...(ms?.blocking || []), ...extraBlocking] : ms?.blocking,
    };
  }

  // Attacker-side figure-blocking exemptions: Priority Target, Massive,
  // Clawdite Scout form, Marksman CC active.
  const atkDcName = dcNameFromFigureKey(attackerFigureKey);
  const atkEff = getDcEffects()?.[atkDcName] || getDcEffects()?.[atkDcName?.replace(/\s*\[.*\]\s*$/, '')];
  const atkKws = (atkEff?.keywords || []).map((k) => String(k).toUpperCase());
  const atkAbilityText = String(atkEff?.abilityText || '').toLowerCase();
  let attackerIgnoresFigureBlocking = (
    (atkAbilityText.includes('priority target') && atkAbilityText.includes('line of sight'))
    || atkKws.includes('MASSIVE')
  );
  if (!attackerIgnoresFigureBlocking) {
    try {
      const formName = getConfig?.(game, attackerFigureKey)?.form;
      if (formName === 'Scout') attackerIgnoresFigureBlocking = true;
    } catch { /* form helper optional */ }
  }
  const figuresDontBlock = !!opts.marksmanActive || attackerIgnoresFigureBlocking;

  // Build figure-blocking-coords (or null if figures don't block).
  let losCoords = null;
  if (!figuresDontBlock) {
    const blocking = new Set();
    const attackerFpSet = new Set(attackerFp.map((c) => String(c).toLowerCase()));
    const targetFpSet = new Set(targetFp.map((c) => String(c).toLowerCase()));
    const playerPoses = [
      [attackerPlayerNum, game.figurePositions?.[attackerPlayerNum] || {}],
      [defenderPlayerNum, game.figurePositions?.[defenderPlayerNum] || {}],
    ];
    for (const [thisPn, poses] of playerPoses) {
      for (const [fk, pos] of Object.entries(poses)) {
        if (!pos) continue;
        const posLow = String(pos).toLowerCase();
        if (attackerFpSet.has(posLow)) continue;
        const fkDcName = dcNameFromFigureKey(fk);
        const fkEff = getDcEffects()?.[fkDcName] || getDcEffects()?.[fkDcName?.replace(/\s*\[.*\]\s*$/, '')];
        if (fkEff?.companion === true) continue;
        if ((fkEff?.keywords || []).some((kw) => String(kw).toUpperCase() === 'MASSIVE')) continue;
        // Camouflage reciprocal: hostile Camo figures 4+ from attacker
        // do not block LOS. Mirrors buildFigureBlockingCoords in
        // dc-play-area.js — without this, the post-declare LoS probe
        // diverges from the target picker (the picker allows shots that
        // the probe then aborts).
        if (thisPn === defenderPlayerNum
            && (fkEff?.specialAbilityIds || []).some((id) => _CAMO_RECIPROCAL_IDS.has(id))) {
          const fkPosLc = posLow;
          const dist = Math.min(...attackerFp.map((ac) => countSpaces(effectiveMs, String(ac).toLowerCase(), fkPosLc)));
          if (dist >= 4) continue;
        }
        const fkSize = game.figureOrientations?.[fk] || getFigureSize(fkDcName);
        for (const cell of getFootprintCells(pos, fkSize)) blocking.add(String(cell).toLowerCase());
      }
    }
    // Target's own cells don't block its own LOS (you can see yourself).
    for (const c of targetFpSet) blocking.delete(c);
    losCoords = blocking;
  }
  // Massive target cannot be hidden behind other figures.
  const tgtDcName = dcNameFromFigureKey(targetFigureKey);
  const tgtEff = getDcEffects()?.[tgtDcName] || getDcEffects()?.[tgtDcName?.replace(/\s*\[.*\]\s*$/, '')];
  if ((tgtEff?.keywords || []).some((kw) => String(kw).toUpperCase() === 'MASSIVE')) {
    losCoords = null;
  }

  // Multi-cell footprint LOS — any attacker cell × any target cell.
  for (const ac of attackerFp) {
    for (const tc of targetFp) {
      if (hasLineOfSight(ac, tc, effectiveMs, losCoords)) return true;
    }
  }
  return false;
}
