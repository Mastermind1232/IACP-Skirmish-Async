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
 * Fingerprint of every game-state input that affects LoS resolution.
 * Used by the post-declare probe in handleCombatRoll: if this fingerprint
 * is unchanged between declare time and the moment dice would roll, the
 * picker's LoS verdict still holds — there is no reason to re-validate
 * (and re-validation has produced false-positive aborts when the
 * replicated logic drifts from the picker).
 *
 * Inputs covered:
 *   - figurePositions[1] and figurePositions[2]
 *   - figureOrientations (multi-cell rotations)
 *   - npcThugs / npcKrykna positions (defeated flag included)
 *   - openedDoors
 *   - ancillaryTokens (energy shield, smoke)
 *   - game.figureForms (Clawdite Scout/Tough form changes)
 */
export function losStateFingerprint(game) {
  if (!game) return '';
  const parts = [];
  for (const pn of [1, 2]) {
    const poses = game.figurePositions?.[pn] || {};
    const keys = Object.keys(poses).sort();
    for (const k of keys) parts.push(`p${pn}:${k}@${poses[k] || 'gone'}`);
  }
  const orients = game.figureOrientations || {};
  for (const k of Object.keys(orients).sort()) parts.push(`o:${k}=${orients[k]}`);
  for (const arrName of ['npcThugs', 'npcKrykna']) {
    const arr = game[arrName] || [];
    for (const npc of arr) parts.push(`${arrName}:${npc?.id || '?'}@${npc?.defeated ? 'D' : (npc?.coord || 'gone')}`);
  }
  const doors = (game.openedDoors || []).slice().sort();
  parts.push(`doors:${doors.join('|')}`);
  const shields = (game.ancillaryTokens?.energyShield || []).slice().sort();
  parts.push(`shields:${shields.join('|')}`);
  const smoke = (game.ancillaryTokens?.smoke || []).slice().sort();
  parts.push(`smoke:${smoke.join('|')}`);
  const forms = game.figureForms || {};
  for (const k of Object.keys(forms).sort()) parts.push(`form:${k}=${forms[k]}`);
  return parts.join(';');
}

/**
 * Team-agnostic LOS check between any two figures on the board.
 *
 * Resolves each figure's position and footprint regardless of which
 * team owns it, then computes effective mapSpaces (closed doors,
 * shields, smoke, broken walls) and figure-blocking coords. Uses the
 * picker's canonical blocking rules (Camouflage reciprocal, Massive,
 * companion exemptions).
 *
 * Use cases:
 *   - Post-declare combat probe (handleCombatRoll)
 *   - Same-team LoS for friendly-targeted abilities (Gideon Argus,
 *     Force Deflection, Distracting Fire, etc.)
 *   - Any future surface that needs "can X see Y?"
 *
 * Deliberately does NOT consult combat state — pure geometry +
 * figure-blocking. Caller passes any per-attack overrides via opts.
 *
 * @param {object} game
 * @param {string} fromFigureKey - source figure
 * @param {string} toFigureKey - target figure
 * @param {object} ctx - getDcEffects, getFigureSize, getMapData,
 *   getMapTokensData (or any subset; falls back to module-level
 *   data-loader imports via the caller's bag)
 * @param {object} [opts]
 * @param {boolean} [opts.marksmanActive] - figures don't block this attack
 * @param {boolean} [opts.attackerIgnoresFigureBlocking] - Priority Target
 *   / Massive attacker / Clawdite Scout-form: figures don't block
 * @returns {boolean}
 */
export function hasLosBetweenFigures(game, fromFigureKey, toFigureKey, ctx, opts = {}) {
  if (!game || !fromFigureKey || !toFigureKey) return false;
  const mapId = game.selectedMap?.id;
  if (!mapId) return false;
  const { getDcEffects, getFigureSize, getFootprintCells: _getFp } = ctx || {};
  if (!getDcEffects || !getFigureSize || !_getFp) return false;
  // Resolve figure positions across both teams.
  let fromPos = null, fromPN = null;
  let toPos = null, toPN = null;
  for (const pn of [1, 2]) {
    const fp = game.figurePositions?.[pn] || {};
    if (!fromPos && fp[fromFigureKey]) { fromPos = fp[fromFigureKey]; fromPN = pn; }
    if (!toPos && fp[toFigureKey]) { toPos = fp[toFigureKey]; toPN = pn; }
  }
  if (!fromPos || !toPos) return false;
  const fromDcName = dcNameFromFigureKey(fromFigureKey);
  const toDcName = dcNameFromFigureKey(toFigureKey);
  const fromSize = game.figureOrientations?.[fromFigureKey] || getFigureSize(fromDcName);
  const toSize = game.figureOrientations?.[toFigureKey] || getFigureSize(toDcName);
  const fromFp = _getFp(fromPos, fromSize);
  const toFp = _getFp(toPos, toSize);
  const effMs = _buildLosEffectiveMs(game, ctx);
  if (!effMs) return false;
  // Build figure-blocking-coords using the picker's canonical helper
  // (Camo reciprocal, MASSIVE, companion exemptions, marksman, ignore-blocking).
  // Imported lazily to avoid circular handler→game import.
  // Note: buildFigureBlockingCoords lives in handlers/dc-play-area.js;
  // we replicate the inline logic here to keep this game-layer module
  // free of handler imports.
  const fromKws = (getDcEffects()?.[fromDcName]?.keywords || []).map((k) => String(k).toUpperCase());
  const fromAbilityText = String(getDcEffects()?.[fromDcName]?.abilityText || '').toLowerCase();
  let ignoreBlocking = !!opts.attackerIgnoresFigureBlocking
    || !!opts.marksmanActive
    || (fromAbilityText.includes('priority target') && fromAbilityText.includes('line of sight'))
    || fromKws.includes('MASSIVE');
  let blocking = null;
  if (!ignoreBlocking) {
    const fromFpSet = new Set(fromFp.map((c) => String(c).toLowerCase()));
    const blockSet = new Set();
    for (const pn of [1, 2]) {
      const poses = game.figurePositions?.[pn] || {};
      for (const [fk, pos] of Object.entries(poses)) {
        if (!pos || fromFpSet.has(String(pos).toLowerCase())) continue;
        const fkDcName = dcNameFromFigureKey(fk);
        const fkEff = getDcEffects()?.[fkDcName] || getDcEffects()?.[(fkDcName || '').replace(/\s*\[.*\]\s*$/, '')];
        if (fkEff?.companion === true) continue;
        if ((fkEff?.keywords || []).some((kw) => String(kw).toUpperCase() === 'MASSIVE')) continue;
        // Camo reciprocal: only excludes figures on the OPPOSITE team
        // from the source. For same-team source/destination (friendly
        // LoS), Camo doesn't apply since the source isn't a "hostile
        // figure" per the card text.
        if (pn !== fromPN && (fkEff?.specialAbilityIds || []).some((id) => _CAMO_RECIPROCAL_IDS.has(id))) {
          const dist = Math.min(...fromFp.map((ac) => countSpaces(effMs, String(ac).toLowerCase(), String(pos).toLowerCase())));
          if (dist >= 4) continue;
        }
        const fkSize = game.figureOrientations?.[fk] || getFigureSize(fkDcName);
        for (const cell of _getFp(pos, fkSize)) blockSet.add(String(cell).toLowerCase());
      }
    }
    // Strip target's full footprint.
    const toEff = getDcEffects()?.[toDcName] || getDcEffects()?.[(toDcName || '').replace(/\s*\[.*\]\s*$/, '')];
    const toMassive = (toEff?.keywords || []).some((kw) => String(kw).toUpperCase() === 'MASSIVE');
    if (toMassive) {
      blocking = null;
    } else {
      const toFpSet = new Set(toFp.map((c) => String(c).toLowerCase()));
      for (const c of toFpSet) blockSet.delete(c);
      blocking = blockSet;
    }
  }
  for (const ac of fromFp) {
    for (const tc of toFp) {
      if (hasLineOfSight(ac, tc, effMs, blocking)) return true;
    }
  }
  return false;
}

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
