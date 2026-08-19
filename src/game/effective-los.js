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
 *       * Massive ATTACKER — figures don't block its trace
 *       * Priority Target — attacker ignores figure blocking
 *       * Clawdite Scout form — Priority Target while in Scout form
 *       * Marksman CC played for this attack (`marksmanActive`)
 *       * Massive TARGET — seen through other figures (target-side)
 *     A massive figure in the MIDDLE blocks like any other figure.
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
import { dcNameFromFigureKey, figureHasInTheShadows, figureHasPriorityTarget } from './dc-helpers.js';
import { edgeKey } from './coords.js';
import { getClosedDoorEdges } from './board-helpers.js';

import { getDcEffect } from './dc-helpers.js';
// Camouflage reciprocal: figures with these abilities do not block LOS for
// hostile figures 4+ spaces away (per card text: "You do not block line of
// sight for those figures"). Mirror buildFigureBlockingCoords in
// dc-play-area.js so the post-declare probe matches the target picker.
const _CAMO_RECIPROCAL_IDS = new Set(['camouflage_mak', 'camouflage_scout_trooper']);

// REMOVED 2026-05-11: `losStateFingerprint(game)` was a short-circuit
// for the post-declare LoS probe — return early if state hadn't
// changed since declare. Removed after `hasLosFromFigureToFigure`
// became drift-proof (single source of truth, no parallel
// implementation to disagree with the picker), so the probe always
// re-validates now. The helper is dead code; do not re-introduce.

/**
 * Directional LOS check: can `fromFigureKey` see `toFigureKey`?
 *
 * LOS is directional. `hasLosFromFigureToFigure(game, A, B)` does NOT
 * imply `hasLosFromFigureToFigure(game, B, A)`. Example: Camouflage
 * says hostile figures 4+ spaces away cannot draw LoS TO the camo
 * figure, but the camo figure can still draw LoS to them. So A→B and
 * B→A can disagree when one side has Camo.
 *
 * The function resolves each figure's position by searching both
 * teams (no "attacker/defender" labels — pure source/destination).
 * It computes effective mapSpaces (closed doors, shields, smoke,
 * broken walls) and figure-blocking coords using the picker's
 * canonical rules:
 *   - Companion exemption
 *   - MASSIVE exemption, as attacker and as target ONLY. A massive
 *     figure interposed between two non-massive figures blocks.
 *   - Camouflage reciprocal (only excludes blockers on the OPPOSITE
 *     team from the source — the camo figure isn't a "hostile figure"
 *     to a same-team source)
 *   - Multi-cell target footprint stripped from blocking
 *   - opts.marksmanActive: figures don't block this trace
 *   - opts.attackerIgnoresFigureBlocking: Priority Target / Scout form
 *
 * Use cases:
 *   - Post-declare combat probe (handleCombatRoll)
 *   - Friendly-targeted abilities: Gideon Argus, Force Deflection,
 *     Distracting Fire, Squad Cohesion, etc.
 *   - Any future surface that needs "can X see Y?"
 *
 * @param {object} game
 * @param {string} fromFigureKey - LoS source (the one drawing the line)
 * @param {string} toFigureKey - LoS destination
 * @param {object} ctx - { getDcEffects, getFigureSize, getMapData,
 *   getMapTokensData, getFootprintCells }
 * @param {object} [opts]
 * @param {boolean} [opts.marksmanActive] - figures don't block this attack
 * @param {boolean} [opts.attackerIgnoresFigureBlocking] - Priority Target
 *   / Massive attacker / Clawdite Scout-form: figures don't block
 * @returns {boolean}
 */
export function hasLosFromFigureToFigure(game, fromFigureKey, toFigureKey, ctx, opts = {}) {
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
  // In the Shadows (CC): a HOSTILE source 4+ spaces from an In-the-Shadows
  // destination has NO LOS to it (does not apply to same-team LOS — the
  // source must be a "hostile figure" per the card). alexanbv 2026-06-20.
  if (fromPN && toPN && fromPN !== toPN && figureHasInTheShadows(game, toFigureKey)) {
    const _itsBlockedEdges = getClosedDoorEdges(game);
    const itsDist = Math.min(...fromFp.map((ac) => Math.min(...toFp.map((tc) =>
      countSpaces(effMs, String(ac).toLowerCase(), String(tc).toLowerCase(), _itsBlockedEdges, 50, game)))));
    if (itsDist >= 4) return false;
  }
  // Build figure-blocking-coords using the picker's canonical helper
  // (Camo reciprocal, MASSIVE, companion exemptions, marksman, ignore-blocking).
  // Imported lazily to avoid circular handler→game import.
  // Note: buildFigureBlockingCoords lives in handlers/dc-play-area.js;
  // we replicate the inline logic here to keep this game-layer module
  // free of handler imports.
  const fromKws = (getDcEffects()?.[fromDcName]?.keywords || []).map((k) => String(k).toUpperCase());
  // Priority Target detection delegated to the single shared predicate
  // figureHasPriorityTarget() — recognizes the keyword in passives, abilityText,
  // or the named-abilities bucket (all 5 PT figures), parity with dc-play-area.js.
  let ignoreBlocking = !!opts.attackerIgnoresFigureBlocking
    || !!opts.marksmanActive
    || figureHasPriorityTarget(game, fromFigureKey)
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
        const fkEff = getDcEffect(fkDcName);
        if (fkEff?.companion === true) continue;
        // NO blocker-side MASSIVE skip. alexanbv 2026-08-18: "massive figures do
        // block LoS just as any other figure, except when the attacker or target
        // is a massive figure, in which case no figures, including other massive
        // figures, block LoS". The exemption is keyed on the two ENDS of the
        // trace (handled above via fromKws and below via toMassive), never on the
        // figure standing in the middle. Skipping massive blockers here let every
        // shot pass straight through an AT-ST.
        // Camo reciprocal: only excludes figures on the OPPOSITE team
        // from the source. For same-team source/destination (friendly
        // LoS), Camo doesn't apply since the source isn't a "hostile
        // figure" per the card text.
        // In the Shadows (CC) rides the same reciprocal blocking exclusion.
        if (pn !== fromPN
            && ((fkEff?.specialAbilityIds || []).some((id) => _CAMO_RECIPROCAL_IDS.has(id)) || figureHasInTheShadows(game, fk))) {
          const _camoBlockedEdges = getClosedDoorEdges(game);
          const dist = Math.min(...fromFp.map((ac) => countSpaces(effMs, String(ac).toLowerCase(), String(pos).toLowerCase(), _camoBlockedEdges, 50, game)));
          if (dist >= 4) continue;
        }
        const fkSize = game.figureOrientations?.[fk] || getFigureSize(fkDcName);
        for (const cell of _getFp(pos, fkSize)) blockSet.add(String(cell).toLowerCase());
      }
    }
    // Strip target's full footprint.
    const toEff = getDcEffect(toDcName);
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
    // cornerBlockingTiles feeds the energy-shield corner-blocking rule in hasLineOfSight:
    // a corner shared by a shield/smoke cell AND a wall endpoint blocks LOS (CRR p.28).
    cornerBlockingTiles: extraBlocking.length > 0 ? [...(ms?.cornerBlockingTiles || []), ...extraBlocking] : ms?.cornerBlockingTiles,
  };
}

// REMOVED 2026-05-11 (commit follows): `hasEffectiveLineOfSight(game,
// attackerPlayerNum, attackerFigureKey, defenderPlayerNum,
// targetFigureKey, ctx, opts)`. Its only caller (the post-declare LoS
// probe in handleCombatRoll) was migrated to the directional, team-
// agnostic `hasLosFromFigureToFigure(game, fromFigureKey, toFigureKey,
// ctx, opts)` exported above. New callers should use that helper —
// it covers all the same picker rules (closed doors / shields / smoke
// / broken walls / Camouflage reciprocal / MASSIVE / Clawdite Scout /
// Marksman / multi-cell footprints) plus correct handling of
// same-team LoS (Gideon Argus, Force Deflection, etc.).
