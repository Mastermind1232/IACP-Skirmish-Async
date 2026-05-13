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
