/**
 * Deterministic activation effects — shared between Discord and headless.
 * No Discord dependency. Uses only game-state primitives.
 */
import { getDcEffects, getDcStats, getMapData } from '../data-loader.js';
import { applyCondition, isConditionImmune, filterCondition } from '../game/conditions.js';
import { grantPowerTokens, grantMovementBank } from '../game/game-helpers.js';
import { opponentPlayerNum, getActivatedDcIndices, setActivatedDcIndices, getCcHand, getDcList, getDcMessageIds } from '../game/player-helpers.js';
import { dcNameFromFigureKey, parseFigureKey } from '../game/dc-helpers.js';
import { reduceHp } from '../game/damage-helpers.js';
import { hasFigureLineOfSight, getFigureFootprint, getAllFigureFootprints } from '../game/spatial.js';
import { getFigureSize } from '../data-loader.js';
import { cardNameIncludes } from '../game/card-names.js';
import { countGameSpaces } from '../game/board-helpers.js';

/**
 * Apply deterministic start-of-activation passives for a DC that is beginning activation.
 * Returns a list of applied effects for the caller to log/display.
 *
 * Scope: Mounted, Hunger Regular, Madness, Into the Fray, Comms Jammer,
 *         Focused on the Kill, Beast Tamer.
 *
 * @param {object} game
 * @param {object} opts
 * @param {string} opts.dcName - The DC name (e.g. 'Captain Terro')
 * @param {number} opts.playerNum - 1 or 2
 * @param {string} opts.displayName - Display name with DG tag
 * @param {string} opts.msgId - DC message ID
 * @param {Map} [opts.dcHealthState] - DC health state Map (needed for Madness strain)
 * @returns {{ applied: Array<{ effect: string, message: string }> }}
 */
export function applyStartOfActivationEffects(game, { dcName, playerNum, displayName, msgId, dcHealthState }) {
  const applied = [];
  const dcEff = getDcEffects()?.[dcName];
  const abilityIds = dcEff?.specialAbilityIds || [];

  // Scrap Battalion (Ugnaught Tinkerer Reg + Elite): auto-readies the
  // Junk Droid at the start of each Ugnaught's activation. Per destruct
  // 2026-05-07: this is one of the few SoA effects that fires
  // automatically — the Junk-Droid ready/exhaust state is the gate that
  // enables effective multiple Junk Droid activations per round when
  // combined with Spot Weld's place-and-ready mechanic.
  if (abilityIds.includes('scrap_battalion_ugnaught') ||
      abilityIds.includes('scrap_battalion_ugnaught_elite') ||
      (dcEff?.abilityText || '').includes('Scrap Battalion')) {
    const _sbDcList = getDcList(game, playerNum) || [];
    const _sbDcMsgIds = getDcMessageIds(game, playerNum) || [];
    for (let _sbI = 0; _sbI < _sbDcList.length; _sbI++) {
      if ((_sbDcList[_sbI]?.dcName || _sbDcList[_sbI]) === 'Junk Droid') {
        const _sbJdMsgId = _sbDcMsgIds[_sbI];
        if (_sbJdMsgId) {
          // Record the ready intent. The actual dcExhaustedState Map
          // lives in ctx — applyStartOfActivationEffects is shared with
          // headless and doesn't have direct access; the Discord caller
          // flips the Map after this returns. Idempotent if JD is
          // already ready (set(false) is a no-op).
          game._scrapBattalionReadyJd = game._scrapBattalionReadyJd || [];
          if (!game._scrapBattalionReadyJd.includes(_sbJdMsgId)) {
            game._scrapBattalionReadyJd.push(_sbJdMsgId);
          }
          applied.push({ effect: 'Scrap Battalion', message: `\u{1F527} **Scrap Battalion** — **Junk Droid** is readied at the start of **${displayName}**'s activation.` });
        }
        break;
      }
    }
  }

  // Mounted / Hunger Regular: migrated to SoA orchestrator (slice 3 —
  // destruct 2026-05-07 "do not make any effects auto, let players pick to
  // trigger each one"). See src/game/soa-orchestrator.js
  // enumerateActivatorSoaDescriptors. Auto-fire branches removed; the
  // chooser at activation start covers both.

  // Madness / Into the Fray: migrated to SoA orchestrator (slice 4 —
  // destruct 2026-05-07 "even auto effects matter for timing"). See
  // src/game/soa-orchestrator.js. Madness re-checks hand size at fire
  // time so the player can play another SoR CC first to change the
  // count. Into the Fray's surge count recomputes at fire time.

  // Comms Jammer / Focused on the Kill: migrated to SoA orchestrator
  // (slice 3 — destruct 2026-05-07). See enumerateActivatorSoaDescriptors.
  // attachments still needed downstream for Beast Tamer (which remains
  // inline pending slice 4).
  const attachments = game.p1DcAttachments?.[msgId] || game.p2DcAttachments?.[msgId] || [];

  // Beast Tamer / I Make the Rules Now: migrated to SoA orchestrator
  // (slice 4 — destruct 2026-05-07 "even auto effects matter for timing,
  // and BT can be exhausted for either MP or interact override").
  // IMTRN now triggers on EITHER team's HUNTER activation per destruct.

  return { applied };
}

/**
 * Apply deterministic end-of-activation effects for a DC that just finished activating.
 * Returns a list of applied effects for the caller to log/display.
 *
 * @param {object} game
 * @param {object} opts
 * @param {string} opts.dcName - The DC name (e.g. 'Riot Trooper (Elite)')
 * @param {number} opts.playerNum - 1 or 2
 * @param {string} opts.displayName - Display name with DG tag
 * @param {string} opts.msgId - DC message ID
 * @returns {{ applied: Array<{ effect: string, message: string }> }}
 */
export function applyEndOfActivationEffects(game, { dcName, playerNum, displayName, msgId, figureIndex }) {
  const applied = [];
  const dcEff = getDcEffects()?.[dcName];
  const dgIndex = (displayName || '').match(/\[(?:DG|Group) (\d+)\]/)?.[1] ?? '1';
  const prefix = `${dcName}-${dgIndex}-`;
  let figureKeys = Object.keys(game.figurePositions?.[playerNum] || {}).filter(k => k.startsWith(prefix));
  // Per destruct 2026-05-07: each figure of a multi-figure group has
  // individual EoA. When figureIndex is supplied, narrow the figureKeys
  // loop to the single locking figure. When omitted (single-figure
  // group end-of-activation), the loop runs over all figures (legacy
  // behavior).
  if (typeof figureIndex === 'number' && figureIndex >= 0) {
    figureKeys = figureKeys.filter(k => k === `${dcName}-${dgIndex}-${figureIndex}`);
  }

  // Weakened auto-discards at end of activation (CRR-WKN-002: WEAKENED L2772-2775).
  // Disarm permanent Weakened lock (filterCondition) keeps the condition through the filter.
  for (const fk of figureKeys) {
    if (!game.figureConditions?.[fk]?.includes('Weaken')) continue;
    if (game.disarmPermanentWeakened?.[fk]) continue;
    filterCondition(game, fk, 'Weaken');
    applied.push({ effect: 'Weaken discard', message: `**Weakened** — **${dcNameFromFigureKey(fk)}** discarded Weaken at end of activation.` });
  }

  // Shield (Riot Trooper E/R): if no Block tokens, gain 1 Block Token
  if ((dcEff?.passives || []).includes('Shield')) {
    for (const fk of figureKeys) {
      const tokens = game.figurePowerTokens?.[fk] || [];
      if (!tokens.includes('Block')) {
        grantPowerTokens(game, fk, 'Block', 1);
        const fkName = dcNameFromFigureKey(fk);
        applied.push({ effect: 'Shield', message: `**Shield** — **${fkName}** gained 1 **Block Token** at end of activation.` });
      }
    }
  }

  // In The Shadows (ISB Infiltrator Elite): become Hidden
  if (dcName === 'ISB Infiltrator (Elite)') {
    let anyHidden = false;
    for (const fk of figureKeys) {
      applyCondition(game, fk, 'Hide');
      anyHidden = true;
    }
    if (anyHidden) {
      applied.push({ effect: 'In The Shadows', message: `**In The Shadows** — **ISB Infiltrator (Elite)** figures became **Hidden** at end of activation.` });
    }
  }

  // Unnerving (0-0-0): each adjacent hostile becomes Weakened
  if (dcName === '0-0-0') {
    const enemyNum = opponentPlayerNum(playerNum);
    const ms = getMapData(game.selectedMap?.id);
    const weakened = [];
    for (const fk of figureKeys) {
      const pos = game.figurePositions?.[playerNum]?.[fk];
      if (!pos) continue;
      const posNorm = String(pos).toLowerCase();
      const adj = (ms?.adjacency?.[posNorm] || []).map(a => String(a).toLowerCase());
      for (const [eFk, ePos] of Object.entries(game.figurePositions?.[enemyNum] || {})) {
        if (!ePos) continue;
        if (!adj.includes(String(ePos).toLowerCase())) continue;
        if (isConditionImmune(game, eFk)) continue;
        if (applyCondition(game, eFk, 'Weaken')) {
          weakened.push(dcNameFromFigureKey(eFk));
        }
      }
    }
    if (weakened.length > 0) {
      applied.push({ effect: 'Unnerving', message: `**Unnerving** — **0-0-0** Weakened adjacent hostiles: ${weakened.join(', ')}.` });
    }
  }

  // Hold the Line (Baze Malbus): gain 1 Block Token per hostile with LOS
  if (dcName === 'Baze Malbus') {
    const htlFk = `Baze Malbus-${dgIndex}-0`;
    const htlPos = game.figurePositions?.[playerNum]?.[htlFk];
    let blockCount = 0;
    if (htlPos) {
      const enemyNum = opponentPlayerNum(playerNum);
      const ms = getMapData(game.selectedMap?.id);
      const allFootprints = getAllFigureFootprints(game, getFigureSize);
      const htlFp = getFigureFootprint(game, playerNum, htlFk, getFigureSize);
      for (const [eFk] of Object.entries(game.figurePositions?.[enemyNum] || {})) {
        const eFp = getFigureFootprint(game, enemyNum, eFk, getFigureSize);
        if (!eFp.length) continue;
        if (hasFigureLineOfSight(htlFp, eFp, ms, allFootprints)) blockCount++;
      }
    }
    if (blockCount > 0) {
      grantPowerTokens(game, htlFk, 'Block', blockCount);
    }
    applied.push({
      effect: 'Hold the Line',
      message: `**Hold the Line** — **${displayName || 'Baze Malbus'}** gained **${blockCount} Block Token${blockCount !== 1 ? 's' : ''}** (${blockCount} hostile${blockCount !== 1 ? 's' : ''} with LOS).`,
    });
  }

  // Son of Skywalker: auto-ready Luke's DC after any activation ends (not Luke's own)
  if (game.sonOfSkywalkerActive) {
    const sos = game.sonOfSkywalkerActive;
    const sosDcMsgId = sos.dcMsgId;
    const sosPlayerNum = sos.playerNum;
    if (sosDcMsgId !== msgId) {
      const sosActivated = getActivatedDcIndices(game, sosPlayerNum);
      const sosDcIds = sosPlayerNum === 1 ? game.p1DcMessageIds : game.p2DcMessageIds;
      const sosIdx = (sosDcIds || []).indexOf(sosDcMsgId);
      if (sosIdx >= 0 && Array.isArray(sosActivated) && sosActivated.includes(sosIdx)) {
        setActivatedDcIndices(game, sosPlayerNum, sosActivated.filter((i) => i !== sosIdx));
        applied.push({ effect: 'Son of Skywalker', message: `**Son of Skywalker** — **Luke Skywalker** is automatically **Readied**.` });
      }
    }
  }

  return { applied };
}
