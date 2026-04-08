/**
 * Deterministic activation effects — shared between Discord and headless.
 * No Discord dependency. Uses only game-state primitives.
 */
import { getDcEffects, getMapData } from '../data-loader.js';
import { applyCondition, isConditionImmune } from '../game/conditions.js';
import { grantPowerTokens, grantMovementBank } from '../game/game-helpers.js';
import { opponentPlayerNum, getActivatedDcIndices, setActivatedDcIndices, getCcHand } from '../game/player-helpers.js';
import { dcNameFromFigureKey, parseFigureKey } from '../game/dc-helpers.js';
import { reduceHp } from '../game/damage-helpers.js';
import { hasLineOfSight, getAllFigureCoords } from '../game/spatial.js';
import { cardNameIncludes } from '../game/card-names.js';

/**
 * Apply deterministic start-of-activation passives for a DC that is beginning activation.
 * Returns a list of applied effects for the caller to log/display.
 *
 * Scope: Mounted, Comms Jammer, Focused on the Kill, Madness, Into the Fray.
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

  // Mounted (Captain Terro, Kuiil, Dewback): gain 3 MP
  if (abilityIds.includes('mounted_terro') || abilityIds.includes('mounted_kuiil') || abilityIds.includes('mounted_dewback') || (dcEff?.passives || []).includes('Mounted')) {
    grantMovementBank(game, msgId, 3);
    applied.push({ effect: 'Mounted', message: `**Mounted** — **${displayName}** gains **3 movement points** at the start of activation.` });
  }

  // Madness (Taron Malicos): if ≤2 CC in hand, suffer 1 Strain and become Focused
  if (dcName === 'Taron Malicos') {
    const hand = getCcHand(game, playerNum) || [];
    if (hand.length <= 2) {
      const figureKeys = Object.keys(game.figurePositions?.[playerNum] || {}).filter(fk => fk.startsWith('Taron Malicos-'));
      for (const fk of figureKeys) {
        applyCondition(game, fk, 'Focus');
        if (dcHealthState) {
          const fkIdx = parseFigureKey(fk).figureIndex;
          reduceHp(dcHealthState, game, msgId, fkIdx, 1, playerNum);
        }
      }
      applied.push({ effect: 'Madness', message: `**Madness** — **${displayName}** has ${hand.length} CC card${hand.length !== 1 ? 's' : ''} in hand (≤2). Suffered **1 Strain** and became **Focused**.` });
    }
  }

  // Into the Fray (Baze Malbus): gain 1 MP and 1 Surge Token per hostile with LOS
  if (dcName === 'Baze Malbus') {
    grantMovementBank(game, msgId, 1);
    const ms = getMapData(game.selectedMap?.id);
    const dgIndex = (displayName || '').match(/\[(?:DG|Group) (\d+)\]/)?.[1] ?? '1';
    const selfFk = `Baze Malbus-${dgIndex}-0`;
    const selfPos = game.figurePositions?.[playerNum]?.[selfFk];
    let surgeCount = 0;
    if (selfPos && ms) {
      const enemyNum = opponentPlayerNum(playerNum);
      const allFigCoords = getAllFigureCoords(game);
      for (const [, ePos] of Object.entries(game.figurePositions?.[enemyNum] || {})) {
        if (!ePos) continue;
        if (hasLineOfSight(String(selfPos).toLowerCase(), String(ePos).toLowerCase(), ms, allFigCoords)) surgeCount++;
      }
    }
    if (surgeCount > 0) {
      grantPowerTokens(game, selfFk, 'Surge', surgeCount);
    }
    applied.push({ effect: 'Into the Fray', message: `**Into the Fray** — **${displayName}** gains **1 MP** and **${surgeCount} Surge Token${surgeCount !== 1 ? 's' : ''}** (${surgeCount} hostile${surgeCount !== 1 ? 's' : ''} with LOS).` });
  }

  // Comms Jammer (ISB Infiltrator Elite): opponent cannot play CC during this activation
  if (abilityIds.includes('comms_jammer_isb')) {
    game.commsJammerActivePlayerNum = playerNum;
    applied.push({ effect: 'Comms Jammer', message: `**Comms Jammer** — Opponent (P${opponentPlayerNum(playerNum)}) cannot play Command Cards during this activation.` });
  }

  // Focused on the Kill (Skirmish Upgrade attachment): +2 MP
  const attachments = game.p1DcAttachments?.[msgId] || game.p2DcAttachments?.[msgId] || [];
  if (attachments.length && cardNameIncludes(attachments, 'Focused on the Kill')) {
    grantMovementBank(game, msgId, 2);
    applied.push({ effect: 'Focused on the Kill', message: `**Focused on the Kill** — **${dcName}** gains **2 MP** at start of activation.` });
  }

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
export function applyEndOfActivationEffects(game, { dcName, playerNum, displayName, msgId }) {
  const applied = [];
  const dcEff = getDcEffects()?.[dcName];
  const dgIndex = (displayName || '').match(/\[(?:DG|Group) (\d+)\]/)?.[1] ?? '1';
  const prefix = `${dcName}-${dgIndex}-`;
  const figureKeys = Object.keys(game.figurePositions?.[playerNum] || {}).filter(k => k.startsWith(prefix));

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
      const allFigCoords = getAllFigureCoords(game);
      for (const [, ePos] of Object.entries(game.figurePositions?.[enemyNum] || {})) {
        if (!ePos) continue;
        if (hasLineOfSight(String(htlPos).toLowerCase(), String(ePos).toLowerCase(), ms, allFigCoords)) blockCount++;
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
