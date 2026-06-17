// Squad Upgrade figures (alexanbv 2026-06-17): attachments that add ONE FULL
// figure to the base group they're attached to (own HP, attack dice, cost,
// traits, abilities), activating as part of the group like any group member.
// Centralizes the membership list (previously duplicated + wrong in 4 places)
// and the effective-figure-count helper. See project-squad-upgrade-figures memory.
//
// RIOT TROOPER IS NOT A SQUAD UPGRADE. Flame Trooper IS.

import { stripBrackets } from './card-names.js';

/** The Squad Upgrade cards that add a figure to their attached group. */
export const SQUAD_UPGRADE_FIGURE_CARDS = ['Z-6 Trooper', 'Mortar Trooper', 'Flame Trooper'];

/** Is this card a figure-adding Squad Upgrade? (bracket-tolerant) */
export function isSquadUpgradeCard(name) {
  return SQUAD_UPGRADE_FIGURE_CARDS.includes(stripBrackets(String(name || '')));
}

/**
 * The Squad Upgrade card on a group (from its attachment list), or null. A group
 * can have only ONE attachment, so there is at most one. Returns the bare name.
 */
export function squadUpgradeOnGroup(attachments) {
  if (!Array.isArray(attachments)) return null;
  for (const a of attachments) {
    if (isSquadUpgradeCard(a)) return stripBrackets(String(a));
  }
  return null;
}

/** base figure count + 1 when the group carries a Squad Upgrade figure. */
export function effectiveFigureCount(baseFigures, attachments) {
  return (baseFigures || 0) + (squadUpgradeOnGroup(attachments) ? 1 : 0);
}

/** A deployed group's attachment list, by its DC message id. */
export function attachmentsForMsgId(game, msgId) {
  return game?.p1DcAttachments?.[msgId] || game?.p2DcAttachments?.[msgId] || [];
}

/** Effective figure count for a deployed group identified by its msgId. */
export function groupEffectiveFigures(game, msgId, baseFigures) {
  return effectiveFigureCount(baseFigures, attachmentsForMsgId(game, msgId));
}

/**
 * The SU figure's OWN health for a group (from the SU card), or null when the
 * group has no Squad Upgrade. getDcStats resolves the SU card's stats.
 */
export function groupSuFigureHealth(game, msgId, getDcStats) {
  const su = squadUpgradeOnGroup(attachmentsForMsgId(game, msgId));
  return su ? (getDcStats?.(su)?.health ?? null) : null;
}
