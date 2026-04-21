/**
 * Pure helpers for Death Trooper's **Field Tactics** (Elite + Regular).
 *
 * Card text: "After your activation, you may immediately activate a
 *  friendly TROOPER or LEADER group with cost 6 or less. That group
 *  loses Field Tactics this round."
 *
 * The bot's implementation grants a free interrupt attack (via the
 * target's Attack button) rather than a full activation — that
 * deviation from card text is pre-existing and out of scope for this
 * probe, which documents the current rule enforcement for target
 * eligibility and round-guard.
 *
 * Extracted from src/handlers/activation.js so the eligibility logic is
 * testable without discord.js.
 */

import { countGameSpaces } from './board-helpers.js';
import { dcNameFromFigureKey } from './index.js';

export const FIELD_TACTICS_DC_NAMES = Object.freeze([
  'Death Trooper (Elite)',
  'Death Trooper (Regular)',
]);

export const FIELD_TACTICS_RANGE = 2;
export const FIELD_TACTICS_MAX_COST = 6;
export const FIELD_TACTICS_REQUIRED_KEYWORDS = Object.freeze(['TROOPER', 'LEADER']);

/** @returns {boolean} true iff dcName is a Death Trooper group that owns Field Tactics. */
export function isFieldTacticsDc(dcName) {
  return FIELD_TACTICS_DC_NAMES.includes(dcName);
}

/**
 * Round-once-per-group key. `fieldTactics_${dcMsgId}`. Uses dcMsgId
 * (not dcName) so two groups of Death Trooper (Regular) each get their
 * own trigger window.
 */
export function fieldTacticsRoundKey(dcMsgId) {
  return `fieldTactics_${dcMsgId}`;
}

/**
 * Given a meta and game, find any live figure from this group to use
 * as the origin-of-range anchor. Returns `null` if no figures remain.
 */
export function fieldTacticsOrigin(game, meta) {
  const dgIndex = (meta.displayName || '').match(/\[(?:DG|Group) (\d+)\]/)?.[1] ?? '1';
  const prefix = `${meta.dcName}-${dgIndex}-`;
  const positions = game?.figurePositions?.[meta.playerNum] || {};
  const myFigKeys = Object.keys(positions).filter((k) => k.startsWith(prefix));
  if (myFigKeys.length === 0) return null;
  const pos = positions[myFigKeys[0]];
  if (!pos) return null;
  return { prefix, originPos: pos };
}

/**
 * Enumerate friendly figures eligible to receive Field Tactics.
 *
 * Eligibility:
 *  - Same player
 *  - NOT in the activating DG (skip same prefix)
 *  - Owner DC has TROOPER or LEADER keyword (case-insensitive)
 *  - Owner DC cost ≤ 6
 *  - Within FIELD_TACTICS_RANGE spaces of the origin
 *
 * @returns {string[]} ordered list of figure keys
 */
export function enumerateFieldTacticsTargets(game, meta, dcEffects) {
  const origin = fieldTacticsOrigin(game, meta);
  if (!origin) return [];
  const { prefix, originPos } = origin;
  const out = [];
  for (const [fk, pos] of Object.entries(game?.figurePositions?.[meta.playerNum] || {})) {
    if (!pos) continue;
    if (fk.startsWith(prefix)) continue;
    const fkDcName = dcNameFromFigureKey(fk);
    const fkEff = dcEffects?.[fkDcName];
    if (!fkEff) continue;
    const kws = (fkEff.keywords || []).map((k) => String(k).toUpperCase());
    if (!FIELD_TACTICS_REQUIRED_KEYWORDS.some((req) => kws.includes(req))) continue;
    if ((fkEff.cost ?? 99) > FIELD_TACTICS_MAX_COST) continue;
    if (countGameSpaces(game, originPos, pos) > FIELD_TACTICS_RANGE) continue;
    out.push(fk);
  }
  return out;
}
