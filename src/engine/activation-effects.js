/**
 * Deterministic end-of-activation effects — shared between Discord and headless.
 * No Discord dependency. Uses only game-state primitives.
 */
import { getDcEffects, getMapData } from '../data-loader.js';
import { applyCondition, isConditionImmune } from '../game/conditions.js';
import { grantPowerTokens } from '../game/game-helpers.js';
import { opponentPlayerNum, getActivatedDcIndices, setActivatedDcIndices } from '../game/player-helpers.js';
import { dcNameFromFigureKey } from '../game/dc-helpers.js';
import { hasLineOfSight, getAllFigureCoords } from '../game/spatial.js';

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
