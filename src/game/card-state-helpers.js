/**
 * Card-state helpers — canonical exhaust + deplete writes.
 *
 * Per alexanbv 2026-05-13: every site that previously mutated
 * `game.exhaustedSkirmishUpgrades[msgId]` or the
 * `p[12]DepletedDcMessageIds` arrays inline now calls one of the
 * helpers below. The helpers are:
 *
 * - Idempotent — calling exhaust/deplete twice with the same arguments
 *   is a no-op.
 * - Additive only — never splice / pop / shift / reassign the array
 *   (CRR-DPL-002 invariant; depletion has no end-of-mission reset in
 *   skirmish).
 * - Aware of the "fires only after the effect fully resolved" rule —
 *   callers MUST call the helper at the END of the effect chain, not
 *   at the click/registration site. For the reroll bucket, the call
 *   site is `_fireExhaustOnConsume` after `_spEntry.remaining` drops
 *   to 0. For non-reroll abilities (Overwatch / Cross Training swap /
 *   Beast Tamer / Unshakable / Suppressive Fire / etc.), the call
 *   site is the final state-update line of the corresponding handler
 *   after all damage/condition/movement/draw side effects have run.
 *
 * Pure functions — no Discord side effects. Logging is the caller's
 * responsibility.
 */
import { getClosedDoorEdges } from './board-helpers.js';

/**
 * Mark a skirmish-upgrade attachment as exhausted on a DC.
 *
 * @param {object} game
 * @param {string} msgId - DC message id the attachment is on
 * @param {string} name - attachment card name (e.g. 'Trusted Ally')
 * @returns {boolean} true if newly exhausted, false if already exhausted
 */
export function exhaustAttachment(game, msgId, name) {
  if (!game || !msgId || !name) return false;
  game.exhaustedSkirmishUpgrades = game.exhaustedSkirmishUpgrades || {};
  const existing = game.exhaustedSkirmishUpgrades[msgId] || [];
  if (existing.includes(name)) return false;
  game.exhaustedSkirmishUpgrades[msgId] = [...existing, name];
  return true;
}

/**
 * Read helper: is the named attachment currently exhausted on this DC?
 *
 * @param {object} game
 * @param {string} msgId
 * @param {string} name
 * @returns {boolean}
 */
export function isAttachmentExhausted(game, msgId, name) {
  if (!game || !msgId || !name) return false;
  const list = game.exhaustedSkirmishUpgrades?.[msgId];
  return Array.isArray(list) && list.includes(name);
}

/**
 * The DC message id carrying a combat side's OWN attachment: attacker → the
 * attacking DC (combat.attackerMsgId), defender → the target DC
 * (combat.target.msgId). AURA attachments worn by a third figure (e.g. Trusted
 * Ally on a friendly within 3) are NOT resolvable here — they need
 * dcMessageMeta to locate the bearer. Returns null when unknown.
 *
 * @param {object} combat
 * @param {'attacker'|'defender'} side
 * @returns {string|null}
 */
export function combatSelfAttachmentMsgId(combat, side) {
  if (!combat) return null;
  return side === 'defender'
    ? (combat.target?.msgId ?? combat.defenderMsgId ?? null)
    : (combat.attackerMsgId ?? null);
}

/**
 * Locate the DC message id of the figure WEARING an AURA exhaust attachment for
 * the attacker's side: a friendly figure within `n` spaces of the attacking
 * figure whose DC carries `attachmentName`, READY (not exhausted) by default.
 * Mirrors the legacy Trusted Ally detection (alexanbv 2026-06-18 FIX-4) so the
 * gate can both OFFER the aura reroll (ready bearer exists) and EXHAUST the
 * correct bearer on use. Returns the bearer's msgId, or null.
 *
 * Pure (no Discord). Spatial + DC-list accessors are INJECTED so this stays
 * import-light: { getMapData, isWithinSpaces, getDcList, getDcMessageIds }.
 *
 * @param {object} game
 * @param {object} combat        game.pendingCombat
 * @param {string} attachmentName  e.g. 'Trusted Ally'
 * @param {number} n             aura range (Trusted Ally = 3)
 * @param {object} deps          { getMapData, isWithinSpaces, getDcList, getDcMessageIds }
 * @param {boolean} [requireReady=true]  skip bearers whose attachment is exhausted
 * @returns {string|null}
 */
export function auraAttachmentBearerMsgId(game, combat, attachmentName, n, deps, requireReady = true) {
  if (!game || !combat || !attachmentName || !deps) return null;
  const { getMapData, isWithinSpaces, getDcList, getDcMessageIds } = deps;
  const pn = combat.attackerPlayerNum;
  const atkFk = combat.attackerFigureKey;
  if (pn == null || !atkFk) return null;
  const figs = game.figurePositions?.[pn] || {};
  const atkPos = figs[atkFk];
  const mapSp = game.selectedMap?.id ? getMapData(game.selectedMap.id) : null;
  if (!atkPos || !mapSp) return null;
  const dcList = getDcList(game, pn) || [];
  const dcMsgIds = getDcMessageIds(game, pn) || [];
  const wantLc = String(attachmentName).toLowerCase();
  for (const [fk, pos] of Object.entries(figs)) {
    if (fk === atkFk || !pos) continue;
    if (!isWithinSpaces(mapSp, String(pos).toLowerCase(), String(atkPos).toLowerCase(), n, getClosedDoorEdges(game), game)) continue;
    const fn = fk.replace(/-\d+-\d+$/, '');
    for (let i = 0; i < dcList.length; i++) {
      const dn = dcList[i]?.dcName || dcList[i];
      if (dn !== fn) continue;
      const mid = dcMsgIds[i];
      if (!mid) continue;
      const atts = game.p1DcAttachments?.[mid] || game.p2DcAttachments?.[mid] || [];
      const hasAtt = (atts || []).some((a) => String(a?.name || a?.cardName || a).toLowerCase() === wantLc);
      if (!hasAtt) continue;
      if (requireReady && isAttachmentExhausted(game, mid, attachmentName)) continue;
      return mid;
    }
  }
  return null;
}

/**
 * Mark a Deployment card as depleted. Additive only — the CRR-DPL-002
 * invariant requires skirmish to never reset, splice, or flip-faceup
 * depleted-card state.
 *
 * @param {object} game
 * @param {string} msgId - DC message id
 * @param {number} playerNum - 1 or 2 (the card's owner)
 * @returns {boolean} true if newly depleted, false if already depleted
 */
export function depleteDc(game, msgId, playerNum) {
  if (!game || !msgId || (playerNum !== 1 && playerNum !== 2)) return false;
  const key = playerNum === 1 ? 'p1DepletedDcMessageIds' : 'p2DepletedDcMessageIds';
  game[key] = game[key] || [];
  if (game[key].includes(msgId)) return false;
  game[key].push(msgId);
  return true;
}

/**
 * Read helper: is the DC depleted? Checks BOTH player arrays so callers
 * don't need to know the owning player.
 *
 * @param {object} game
 * @param {string} msgId
 * @returns {boolean}
 */
export function isDcDepleted(game, msgId) {
  if (!game || !msgId) return false;
  return (game.p1DepletedDcMessageIds || []).includes(msgId)
      || (game.p2DepletedDcMessageIds || []).includes(msgId);
}

/**
 * Ready a Deployment card — THE single way to do it.
 *
 * alexanbv 2026-08-11: "SoS Blaze Furious charge etc should ready cards in the
 * same way. It sounds like they are different." They were: five call sites,
 * five different subsets of the necessary work, and three of them incomplete.
 *
 *   Son of Skywalker  removed the activation index but NEVER un-exhausted the
 *                     card, so Luke stayed rendered exhausted
 *   Blaze of Glory    un-exhausted but never removed the activation index, so
 *                     the activation was not actually given back
 *   Furious Charge    did both but wrote pXActivatedDcIndices raw and never
 *                     recomputed the activation counts
 *   un-activate/toggle  the only complete implementations
 *
 * Readying is FOUR pieces of state, and all of them have to move together:
 *   1. dcExhaustedState (the derived render/interaction store)
 *   2. dcList[idx].exhausted (the persisted blob — survives a reload)
 *   3. pXActivatedDcIndices (what actually grants the extra activation)
 *   4. activation counts (what the player is shown)
 *
 * SYNC and Discord-free, so resolveAbility (which is sync) can call it. The
 * caller still owns the async UI refresh — updateActivationsMessage and the DC
 * embed — and should use the returned dcIndex/changed to decide whether to.
 *
 * @param {object} game
 * @param {number} playerNum      owner of the card
 * @param {string} msgId          the DC's play-area message id
 * @param {object} [deps]
 * @param {Map}    [deps.dcExhaustedState]        derived exhaust store
 * @param {Function} [deps.recomputeActivationCounts] (game, playerNum) => void
 * @returns {{ changed: boolean, dcIndex: number }}
 */
export function readyDeploymentCard(game, playerNum, msgId, deps = {}) {
  if (!game || !msgId || (playerNum !== 1 && playerNum !== 2)) {
    return { changed: false, dcIndex: -1 };
  }
  const dcIdsKey = playerNum === 1 ? 'p1DcMessageIds' : 'p2DcMessageIds';
  const dcListKey = playerNum === 1 ? 'p1DcList' : 'p2DcList';
  const activatedKey = playerNum === 1 ? 'p1ActivatedDcIndices' : 'p2ActivatedDcIndices';

  const dcIndex = (game[dcIdsKey] || []).indexOf(msgId);

  // 1. Derived exhaust store (drives rendering + the activate button).
  deps.dcExhaustedState?.set?.(msgId, false);

  // 2. Persisted blob, so the ready survives a reload / checkpoint restore.
  const dcList = game[dcListKey];
  if (dcIndex >= 0 && Array.isArray(dcList) && dcList[dcIndex]) {
    const dc = dcList[dcIndex];
    dcList[dcIndex] = typeof dc === 'object'
      ? { ...dc, exhausted: false }
      : { dcName: dc, displayName: dc, exhausted: false };
  }

  // 3. The activation itself. Without this the card looks ready but the player
  //    gets no extra activation — Blaze of Glory's exact failure.
  let changed = false;
  const activated = game[activatedKey];
  if (dcIndex >= 0 && Array.isArray(activated) && activated.includes(dcIndex)) {
    game[activatedKey] = activated.filter((i) => i !== dcIndex);
    changed = true;
  }

  // 4. Counts the player is shown. Derived from the above, so it must follow.
  if (changed && typeof deps.recomputeActivationCounts === 'function') {
    deps.recomputeActivationCounts(game, playerNum);
  }

  return { changed, dcIndex };
}
