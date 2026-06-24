/**
 * Pure HP math helpers + dcHealthState/dcList sync.
 * No Discord dependency. Used by combat, abilities, handlers.
 */
import { getDcMessageIds, getDcList } from './player-helpers.js';
import { isCannotBeDefeated } from './conditions.js';

/**
 * Sync healthState from dcHealthState Map to the redundant copy in game.p1/p2DcList.
 * @param {object} game
 * @param {string} msgId
 * @param {number} playerNum - 1 or 2
 * @param {Array} healthState - the full healthState array for this DC
 */
function syncDcList(game, msgId, playerNum, healthState) {
  const dcIds = getDcMessageIds(game, playerNum);
  const dcList = getDcList(game, playerNum);
  const idx = (dcIds || []).indexOf(msgId);
  if (idx >= 0 && dcList?.[idx]) dcList[idx].healthState = [...healthState];
}

/**
 * Reduce HP for a figure. Clamps to 0. Syncs dcHealthState + dcList.
 * @param {Map} dcHealthState - external health state Map
 * @param {object} game
 * @param {string} msgId - DC message ID
 * @param {number} figureIndex - 0-based figure index within healthState
 * @param {number} damage - amount to reduce (non-negative)
 * @param {number} playerNum - 1 or 2
 * @returns {{ newHp: number, maxHp: number, prevHp: number, wasDefeated: boolean }}
 */
export function reduceHp(dcHealthState, game, msgId, figureIndex, damage, playerNum) {
  const healthState = dcHealthState.get(msgId);
  if (!healthState || !Array.isArray(healthState[figureIndex])) {
    return { newHp: 0, maxHp: 0, prevHp: 0, wasDefeated: false };
  }
  const [cur, max] = healthState[figureIndex];
  const prevHp = cur ?? max ?? 0;
  const maxHp = max ?? cur ?? 0;
  const newHp = Math.max(0, prevHp - damage);
  healthState[figureIndex] = [newHp, maxHp];
  dcHealthState.set(msgId, healthState);
  syncDcList(game, msgId, playerNum, healthState);

  // Track actual damage received for tiebreaker scoring
  const actualDamage = prevHp - newHp;
  if (actualDamage > 0 && game.totalDamageReceived) {
    game.totalDamageReceived[playerNum] = (game.totalDamageReceived[playerNum] || 0) + actualDamage;
  }

  return { newHp, maxHp, prevHp, wasDefeated: newHp <= 0 };
}

/**
 * Heal HP for a figure. Clamps to max. Syncs dcHealthState + dcList.
 * @param {Map} dcHealthState - external health state Map
 * @param {object} game
 * @param {string} msgId - DC message ID
 * @param {number} figureIndex - 0-based figure index within healthState
 * @param {number} amount - amount to heal (non-negative)
 * @param {number} playerNum - 1 or 2
 * @returns {{ newHp: number, maxHp: number, healed: number }}
 */
export function healHp(dcHealthState, game, msgId, figureIndex, amount, playerNum) {
  const healthState = dcHealthState.get(msgId);
  if (!healthState || !Array.isArray(healthState[figureIndex])) {
    return { newHp: 0, maxHp: 0, healed: 0 };
  }
  const [cur, max] = healthState[figureIndex];
  const prevHp = cur ?? max ?? 0;
  const maxHp = max ?? cur ?? 0;
  const newHp = Math.min(prevHp + amount, maxHp);
  const healed = newHp - prevHp;
  healthState[figureIndex] = [newHp, maxHp];
  dcHealthState.set(msgId, healthState);
  syncDcList(game, msgId, playerNum, healthState);
  return { newHp, maxHp, healed };
}

/**
 * Heal HP across all figures in a DC, distributing up to totalAmount.
 * Heals figures in order (index 0 first). Syncs dcHealthState + dcList.
 * @param {Map} dcHealthState
 * @param {object} game
 * @param {string} msgId
 * @param {number} totalAmount - total HP to distribute
 * @param {number} playerNum
 * @returns {{ totalRecovered: number, perFigure: Array<{index: number, healed: number, newHp: number}> }}
 */
export function healHpDistributed(dcHealthState, game, msgId, totalAmount, playerNum) {
  const healthState = dcHealthState.get(msgId);
  if (!healthState) return { totalRecovered: 0, perFigure: [] };
  let remaining = totalAmount;
  const perFigure = [];
  for (let i = 0; i < healthState.length; i++) {
    if (remaining <= 0) break;
    if (!Array.isArray(healthState[i])) continue;
    const [cur, max] = healthState[i];
    const prevHp = cur ?? max ?? 0;
    const maxHp = max ?? cur ?? 0;
    const damage = maxHp - prevHp;
    if (damage <= 0) continue;
    const heal = Math.min(remaining, damage);
    healthState[i] = [prevHp + heal, maxHp];
    remaining -= heal;
    perFigure.push({ index: i, healed: heal, newHp: prevHp + heal });
  }
  if (perFigure.length > 0) {
    dcHealthState.set(msgId, healthState);
    syncDcList(game, msgId, playerNum, healthState);
  }
  return { totalRecovered: totalAmount - remaining, perFigure };
}

/**
 * Apply damage to a figure and surface a defeat record if lethal.
 *
 * Per destruct's 2026-05-06 audit: "any time a figure suffers damage you
 * should check for defeat." Wraps reduceHp with a defeatedFigures-shaped
 * record output so the caller can append it to result.defeatedFigures and
 * the apply-ability-result.js consumer routes through processFigureDefeat
 * — firing VP, position cleanup, when-defeated reaction prompts, passive
 * redraws, etc.
 *
 * Use this helper for ANY direct damage application (AOEs, mission rules,
 * CC effects, ability self-damage, conditional damage). Standard combat
 * damage already routes through computeCombatResult → applyDamageAndFinishCombat
 * which calls processFigureDefeat itself.
 *
 * @param {Map} dcHealthState
 * @param {object} game
 * @param {string} msgId
 * @param {number} figureIndex
 * @param {number} damage
 * @param {number} playerNum - the figure's owning player
 * @param {object} opts
 * @param {string} [opts.sourceLabel='']        - e.g. "Wrist Flamethrower", "Bleed"
 * @param {number|null} [opts.attackerPlayerNum=null] - player who caused damage (for VP); null = neutral / self-inflicted
 * @returns {{ newHp: number, prevHp: number, wasDefeated: boolean, defeatRecord: object | null }}
 */
export function applyDamageWithDefeatCheck(dcHealthState, game, msgId, figureIndex, damage, playerNum, opts = {}) {
  const { sourceLabel = '', attackerPlayerNum = null } = opts;
  // alexanbv 2026-06-23: ALL damage must go through the ONE applyDamage pipeline
  // (the same one combat uses) so it fires every WHEN_DAMAGED / BEFORE_DEFEATED /
  // WHEN_DEFEATED hook + Vanish / Clan-of-Two. resolveAbility() is sync and can't
  // await, so we QUEUE the damage onto game._pendingDamage; apply-ability-result.js
  // drains it through applyDamage. We do NOT mutate HP here; the return values are
  // a best-effort estimate (current HP minus amount) for inline log strings only.
  if (game && opts.__deferToPipeline !== false) {
    const _hsNow = dcHealthState?.get(msgId);
    const _entry = Array.isArray(_hsNow?.[figureIndex]) ? _hsNow[figureIndex] : null;
    const _amt = Math.max(0, parseInt(damage || 0, 10));
    const _prev = _entry ? (_entry[0] ?? _entry[1] ?? 0) : 0;
    const _max = _entry ? (_entry[1] ?? _entry[0] ?? 0) : 0;
    const _new = Math.max(0, _prev - _amt);
    // Prefer the explicit figureKey the caller already has — reverse-engineering
    // it from game.p{N}DcMessageIds fails when that list isn't populated (some
    // unit fixtures, NPC-adjacent splash, etc.) and would silently DROP the damage.
    const _fk = opts.figureKey || _figureKeyFromMsgIdAndIndex(game, msgId, figureIndex, playerNum);
    if (_entry && _amt > 0 && _fk && msgId) {
      game._pendingDamage = game._pendingDamage || [];
      game._pendingDamage.push({
        figureKey: _fk, msgId, figIndex: figureIndex, amount: _amt,
        controllerPlayerNum: playerNum,
        attackerPlayerNum: attackerPlayerNum ?? undefined,
        source: sourceLabel || 'ability',
      });
    }
    return { newHp: _new, prevHp: _prev, maxHp: _max, wasDefeated: !!_entry && _amt > 0 && _new <= 0 && _prev > 0, defeatRecord: null, _queued: true };
  }
  const result = reduceHp(dcHealthState, game, msgId, figureIndex, damage, playerNum);
  let defeatRecord = null;
  if (result.wasDefeated) {
    // Slice 5 (damage/health flip): per destruct 2026-05-06 "damage tokens
    // capped at health. Pierce does NOT overflow." Check cannot-be-defeated
    // before queueing a defeat. If the figure has a "cannot be defeated"
    // protection active (YWNDM, Second Chance, Sustained by Rage), suppress
    // the defeat — the figure's HP stays at 0 (damage capped at health) and
    // future damage with the flag still active stays at 0 with no defeat.
    // This replaces the legacy "heal to 1 on defeat" workaround which
    // incorrectly left the figure vulnerable to a single-damage follow-up.
    const figureKey = _figureKeyFromMsgIdAndIndex(game, msgId, figureIndex, playerNum);
    if (game && isCannotBeDefeated(game, figureKey, msgId)) {
      // Suppress defeat. Mutate the result so downstream callers see
      // wasDefeated:false; the defeat record is NOT queued.
      return { ...result, wasDefeated: false, defeatRecord: null, defeatSuppressed: true };
    }
    if (result.prevHp > 0) {
      defeatRecord = {
        figureKey,
        defeatedPlayerNum: playerNum,
        attackerPlayerNum: attackerPlayerNum ?? (playerNum === 1 ? 2 : 1),
        source: sourceLabel,
      };
      // Slice 6.13 ext (destruct 2026-05-06): centralize defeat queueing so
      // any damage caller that uses this helper automatically surfaces
      // defeats — no per-site defeatedFigures plumbing required.
      // apply-ability-result.js drains game._pendingFigureDefeats after every
      // ability resolution and routes through processFigureDefeat. Callers
      // that DO populate result.defeatedFigures keep working — the consumer
      // dedupes.
      if (game) {
        game._pendingFigureDefeats = game._pendingFigureDefeats || [];
        game._pendingFigureDefeats.push(defeatRecord);
      }
    }
  }
  return { ...result, defeatRecord };
}

// suffersStrain (sync helper) deleted 2026-05-09. Strain now routes
// exclusively through src/handlers/strain-handler.js → applyStrain,
// which handles Fireproof / Headhunter / Under Duress / Paz / top-of-
// deck-discard prompts. Ability dispatches that need to deal strain
// return a `pendingStrainCost` (single payload) or `pendingStrain`
// (array) on their result; applyAbilityResult fires applyStrain on
// each, with cost-strain firing BEFORE other side effects per the
// IACP "if an ability costs strain, the strain is dealt before
// resolving the ability" rule.

/**
 * Resolve a figureKey from (msgId, figureIndex). Internal helper for
 * applyDamageWithDefeatCheck.
 */
function _figureKeyFromMsgIdAndIndex(game, msgId, figureIndex, playerNum) {
  const ids = playerNum === 1 ? (game.p1DcMessageIds || []) : (game.p2DcMessageIds || []);
  const list = playerNum === 1 ? (game.p1DcList || []) : (game.p2DcList || []);
  const idx = ids.indexOf(msgId);
  if (idx < 0) return null;
  const dc = list[idx];
  if (!dc) return null;
  const dcName = typeof dc === 'object' ? (dc.dcName || dc.displayName) : dc;
  // Try to find the matching figure key. Look up via figurePositions; if not
  // found (rare), fall back to the constructed shape "{dcName}-{dgIndex}-{figureIndex}".
  const positions = game.figurePositions?.[playerNum] || {};
  for (const fk of Object.keys(positions)) {
    const m = fk.match(/^(.+)-(\d+)-(\d+)$/);
    if (!m) continue;
    if (m[1] === dcName && parseInt(m[3], 10) === figureIndex) return fk;
  }
  return `${dcName}-1-${figureIndex}`;
}
