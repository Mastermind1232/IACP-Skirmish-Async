// Third-party-figure Command Cards (alexanbv 2026-06-16): CCs played by a friendly
// figure that is NOT the attacker or defender of the current attack. Unlike normal
// CCs (handled by playCC against the attacker/defender figure), these need an
// ARMY-WIDE legality check — is there an eligible friendly figure of the right
// trait, in the required spatial relationship to the combat? — and a figure-picker
// on play (which figure plays it → who gets Stunned / takes the redirected hit).
//
// They slot into the combat pipeline (on_declare / rerolls) or the damage pipeline
// at the indicated timing, offered in any order with the other abilities there.
// Onar/Baze/MHD reaction cards already live in the damage/defeat pipeline; this
// module covers the combat-window third-party CCs + Opportunistic.

import { dcNameFromFigureKey } from '../game/index.js';
import { opponentPlayerNum } from '../game/player-helpers.js';
import { figureMatchesCcRestriction } from '../game/cc-timing.js';
import { isWithinN } from './utils.js';
import { getMapData as _getMapData, getDcEffects as _getDcEffects } from '../data-loader.js';

/**
 * Descriptor per third-party CC:
 *  - side: whose team plays it ('attacker' | 'defender').
 *  - playableBy: the trait/faction the playing figure must have (matched via
 *    figureMatchesCcRestriction, so "GUARDIAN or FORCE USER" etc. work).
 *  - from: the combat reference figure the spatial check measures from
 *    ('attacker' = the attacking figure, 'target' = the defending figure).
 *  - n: max spaces from the reference (1 = adjacent); null = no range limit.
 *  - los: requires line of sight from the playing figure to the reference.
 *  - window: the pipeline timing instance it is offered at.
 *  - excludeActive: never offer the attacker/defender themselves as the player.
 */
export const THIRD_PARTY_CC_SPECS = {
  'Concentrated Fire':     { side: 'attacker', playableBy: 'TROOPER',            from: 'target',  los: true, window: 'on_declare', excludeActive: true },
  'Guardian Stance':       { side: 'defender', playableBy: 'GUARDIAN',           from: 'target',  n: 1,      window: 'rerolls',    excludeActive: true },
  'Bodyguard':             { side: 'defender', playableBy: 'GUARDIAN',           from: 'target',  n: 1,      window: 'on_declare', excludeActive: true },
  'Get Behind Me!':        { side: 'defender', playableBy: 'GUARDIAN or FORCE USER', from: 'target', n: 3,   window: 'on_declare', excludeActive: true },
  'Battlefield Awareness': { side: 'attacker', playableBy: 'LEADER',             from: 'attacker', n: null,  window: 'rerolls',    excludeActive: false },
  // Yoda (There Is No Try) can be played while attacking OR defending — two specs.
  'There Is No Try (attacker)': { side: 'attacker', playableBy: 'Yoda', from: 'attacker', n: 4, window: 'rerolls', excludeActive: false, cardName: 'There Is No Try' },
  'There Is No Try (defender)': { side: 'defender', playableBy: 'Yoda', from: 'target',   n: 4, window: 'rerolls', excludeActive: false, cardName: 'There Is No Try' },
  // Opportunistic reacts to a hostile suffering damage — damage-pipeline timing.
  'Opportunistic':         { side: 'attacker', playableBy: 'Any Figure',         from: 'target',  n: null,   window: 'damage_pipeline', excludeActive: false },
};

/** Is this card a third-party-figure CC (handled by this module, not plain playCC)? */
export function isThirdPartyCc(cardName) {
  return Object.prototype.hasOwnProperty.call(THIRD_PARTY_CC_SPECS, cardName);
}

/** Board position of a figure on either team, or null. */
function _posOf(game, figureKey) {
  if (!figureKey) return null;
  for (const pn of [1, 2]) {
    const p = game?.figurePositions?.[pn]?.[figureKey];
    if (p) return p;
  }
  return null;
}

/**
 * The friendly figures that could LEGALLY play a third-party CC for the current
 * attack: on the spec's side, matching its playableBy, in range / LOS of the
 * reference figure, excluding the attacker/defender themselves when specified.
 * LOS is checked via deps.hasLineOfSight(game, fromKey, toKey) when provided
 * (permissive if absent — the exact LOS is re-checked at play). Returns figureKeys.
 */
export function eligibleThirdPartyCcFigures(game, specKey, combat, deps = {}) {
  const spec = THIRD_PARTY_CC_SPECS[specKey];
  if (!spec || !combat) return [];
  const pn = spec.side === 'attacker'
    ? combat.attackerPlayerNum
    : (combat.defenderPlayerNum ?? (combat.attackerPlayerNum ? opponentPlayerNum(combat.attackerPlayerNum) : null));
  if (pn == null) return [];
  const team = game?.figurePositions?.[pn] || {};
  const refKey = spec.from === 'attacker' ? combat.attackerFigureKey : combat.target?.figureKey;
  const refPos = _posOf(game, refKey);
  const out = [];
  for (const [fk, pos] of Object.entries(team)) {
    if (spec.excludeActive && (fk === combat.attackerFigureKey || fk === combat.target?.figureKey)) continue;
    const dcName = dcNameFromFigureKey(fk);
    if (!figureMatchesCcRestriction(game, dcName, dcName, spec.playableBy)) continue;
    if (spec.n != null) {
      if (!refPos || !isWithinN(pos, refPos, spec.n, game?.selectedMap?.id, deps.getMapData || _getMapData)) continue;
    }
    if (spec.los && typeof deps.hasLineOfSight === 'function') {
      if (!deps.hasLineOfSight(game, fk, refKey)) continue;
    }
    out.push(fk);
  }
  return out;
}

/** The actual CC name to play (specKey may be a side-qualified alias, e.g. Yoda). */
export function thirdPartyCardName(specKey) {
  return THIRD_PARTY_CC_SPECS[specKey]?.cardName || specKey;
}

/**
 * Apply a third-party CC's bespoke combat effect for the figure that played it
 * (alexanbv 2026-06-16). Each card acts on the CHOSEN figure / the combat, not the
 * attacker/defender. `deps.applyCondition(game, figureKey, cond)` is injected to
 * avoid a cycle with game/conditions.js. Returns { applied, log }.
 *   - Concentrated Fire: if the playing figure has the Ranged attack type, add 1
 *     red die to the attack pool; the playing figure becomes Stunned.
 * Target-switch / reroll cards (Bodyguard, Get Behind Me, Guardian Stance, …) are
 * stubbed with a diagnostic log until each is wired.
 */
export function applyThirdPartyCcEffect(specKey, game, combat, figureKey, deps = {}) {
  const getDcEffects = deps.getDcEffects || _getDcEffects;
  const applyCondition = deps.applyCondition;
  const log = [];
  if (specKey === 'Concentrated Fire') {
    const dcName = dcNameFromFigureKey(figureKey);
    const all = getDcEffects?.() || {};
    const eff = all[dcName] || all[String(dcName || '').replace(/\s*\(.*\)\s*$/, '').trim()];
    const isRanged = String(eff?.attack?.type || '').toLowerCase() === 'range';
    if (isRanged && Array.isArray(combat?.attackInfo?.dice)) {
      combat.attackInfo.dice.push('red');
      log.push('+1 red die (Ranged)');
    }
    if (typeof applyCondition === 'function' && figureKey) {
      applyCondition(game, figureKey, 'Stun');
      log.push('playing figure Stunned');
    }
    return { applied: true, log };
  }
  if (specKey === 'Bodyguard' || specKey === 'Get Behind Me!') {
    // TARGET SWITCH: the playing figure becomes the new target. alexanbv 2026-06-16:
    // switching the target CANCELS any effects already applied "to the defender" or
    // "to the defense pool" — Merciless damage doesn't carry to the new target (it
    // already landed on the old target and stays there); Element of Surprise's
    // die-removal is dropped (the new target's defense pool is its own, full).
    // Attacker-side effects (Tools for the Job's red attack die, bonus hits) PERSIST.
    const all = getDcEffects?.() || {};
    const newDcName = dcNameFromFigureKey(figureKey);
    const newEff = all[newDcName]
      || all[String(newDcName || '').replace(/\s*\(.*\)\s*$/, '').trim()]
      || all[`${newDcName} (Elite)`] || all[`${newDcName} (Regular)`];
    combat.target = { ...(combat.target || {}), figureKey, dcName: newDcName };
    combat.defenderDcName = newDcName;
    if (combat.targetStats) {
      combat.targetStats.defense = Array.isArray(newEff?.defense)
        ? newEff.defense
        : (newEff?.defense ? [newEff.defense] : ['white']);
      combat.targetStats.cost = newEff?.cost ?? combat.targetStats.cost;
      combat.targetStats.subCost = newEff?.subCost;
    }
    // Cancel defender-side / defense-pool modifications applied to the old target.
    // At on_declare, bonus blocks/evades come only from defensive TOKENS the old
    // target spent (modifier-step bonuses don't exist yet) — those disappear on the
    // switch (alexanbv 2026-06-16). Element of Surprise's die-removal is dropped.
    combat.bonusBlock = undefined;
    combat.bonusEvade = undefined;
    combat.defensePoolRemoveMax = 0;
    combat.defensePoolRemoveAll = false;
    combat.defenseRoll = null; // not yet rolled at on_declare; recomputed for the new pool
    log.push(`target switched to ${newDcName}; defender-side effects cancelled (attacker-side kept)`);
    // The new target gets a FRESH defender on_declare window — its eligibility for
    // defensive cards/abilities is rechecked (different traits → e.g. Knowledge and
    // Defense for a Force User; different square → different auras like Onar's). The
    // resolver re-opens it by rebuilding the on_declare gate against the new target.
    // TODO(next): recompute distanceToTarget / isRanged / LOS for the new target's
    // board position (affects ranged accuracy).
    return { applied: true, log, reopenDefenderOnDeclare: true };
  }
  return { applied: false, log: [`${specKey} effect not yet wired`] };
}
