/**
 * DC (deployment card) pure lookup helpers.
 * No Discord dependency.
 */
import { getDcEffects, getDcImages } from '../data-loader.js';
import { truncateLabel } from '../discord/components.js';
import { squadUpgradeFigureCard } from './squad-upgrades.js';

/**
 * Extract the base DC name from a figure key like "Darth Vader-1-0" → "Darth Vader".
 * @param {string} figureKey
 * @returns {string}
 */
export function dcNameFromFigureKey(figureKey) {
  return (figureKey || '').replace(/-\d+-\d+$/, '');
}

/**
 * Parse a figure key like "Darth Vader-1-0" into its components.
 * @param {string} figureKey
 * @returns {{ dgIndex: number, figureIndex: number }}
 */
export function parseFigureKey(figureKey) {
  const m = (figureKey || '').match(/-(\d+)-(\d+)$/);
  return {
    dgIndex: m ? parseInt(m[1], 10) : 1,
    figureIndex: m ? parseInt(m[2], 10) : 0,
  };
}

/**
 * Look up a DC's effects, falling back to the name with bracket suffixes stripped.
 * e.g. "Luke Skywalker [Jedi]" → tries that first, then "Luke Skywalker".
 * @param {string} dcName
 * @returns {object|undefined}
 */
export function getDcEffect(dcName) {
  return getDcEffects()?.[dcName] || getDcEffects()?.[dcName?.replace(/\s*\[.*\]\s*$/, '')];
}

/**
 * The EFFECTIVE deployment-card name to read a figure's OWN stats/abilities/
 * keywords/surges/cost/health/speed/defense from (alexanbv 2026-06-22).
 *
 * A Squad Upgrade figure (Z-6 Trooper / Mortar Trooper / Flame Trooper) is its
 * own figure with its own deployment card: its stats are NEVER the host group's,
 * and it never inherits group-mates' abilities. For an SU figure this returns the
 * SU card's bracketed key (e.g. '[Flame Trooper]'); for any other figure it
 * returns the host DC name (dcNameFromFigureKey). Use this anywhere you would
 * otherwise call dcNameFromFigureKey(figureKey) to look up a figure's stats.
 *
 * @param {object} game
 * @param {string} figureKey
 * @returns {string}
 */
export function effectiveDcNameForFigure(game, figureKey) {
  const su = squadUpgradeFigureCard(game, figureKey);
  return su ? `[${su}]` : dcNameFromFigureKey(figureKey);
}

/**
 * True when `figureKey` currently has the In the Shadows (CC) effect active.
 * In the Shadows scopes to the single figure that played it (game.roundInTheShadows
 * = { playerNum, figureKey }). The effect is mechanically identical to
 * Camouflage: hostile figures 4+ spaces away lose LOS to this figure, and this
 * figure does not block LOS for those hostiles. Used by the LOS/targeting
 * sites that already special-case Camouflage so In the Shadows rides the same
 * reciprocal-LOS path. alexanbv 2026-06-20.
 *
 * @param {object} game
 * @param {string} figureKey
 * @returns {boolean}
 */
export function figureHasInTheShadows(game, figureKey) {
  const its = game?.roundInTheShadows;
  if (!its || !figureKey) return false;
  // figureKey present → scope to that figure. If figureKey couldn't be
  // resolved at play time (null), the effect doesn't apply to any figure
  // (rather than silently applying player-wide, which was the old bug).
  return its.figureKey === figureKey;
}

/**
 * True when a figure's deployment card grants Priority Target — "Figures do not
 * block line of sight for this figure's attacks" (CSV docs/combat-spec.csv
 * rows 347/407/901/961/985). Per alexanbv 2026-06-21, all Priority Target
 * abilities live in ONE normalized data structure: the `passives` keyword array
 * — identical whether the card just lists the keyword (e.g. [Flame Trooper]
 * attachment, HK Assassin Droid Elite, Mak Eshka'rey) or also spells it out in
 * abilityText prose (Loku Kanoloa / Mon Cala Special Forces, Rebel Saboteur
 * Elite / Overload — those two now carry "Priority Target" in `passives` too,
 * with the abilityText left as descriptive prose). So this predicate reads the
 * keyword from the normal keyword source only (passives), with the named
 * `abilities` bucket as a belt-and-braces fallback should a future card list it
 * there. It is the single shared predicate the three attacker-side
 * figure-LOS-bypass paths (handlers/dc-play-area.js, engine/available-actions.js,
 * game/effective-los.js) call so EVERY Priority Target figure is recognized.
 * Note this intentionally does NOT cover MASSIVE / Clawdite Scout form /
 * Marksman — those remain site-local bypasses OR-ed alongside this predicate.
 *
 * @param {object} game
 * @param {string} figureKey - e.g. "Loku Kanoloa-1-0"
 * @returns {boolean}
 */
export function figureHasPriorityTarget(game, figureKey) {
  // Squad Upgrade figure (e.g. Flame Trooper): its keyword abilities — including
  // Priority Target — come from the SU card and are scoped to the SU FIGURE only,
  // NOT the host group's base figures (alexanbv 2026-06-22). When this figureKey
  // is the SU figure, read the SU card's effect; otherwise the host DC's effect.
  const suCard = squadUpgradeFigureCard(game, figureKey);
  const eff = suCard
    ? (getDcEffect(`[${suCard}]`) || getDcEffect(suCard))
    : getDcEffect(dcNameFromFigureKey(figureKey));
  if (!eff) return false;
  // passives: the normalized keyword home — exact "Priority Target" (case-insensitive)
  if ((eff.passives || []).some((p) => String(p).toLowerCase() === 'priority target')) return true;
  // named abilities bucket (belt-and-braces, in case a future card lists it there)
  if ((eff.abilities || []).some((a) => String(a).toLowerCase() === 'priority target')) return true;
  return false;
}

/**
 * Strip deployment-group and Elite/Regular variant suffixes from a DC
 * name. Used by CC-playable-by matching, hand display, etc.
 *   "Rebel Trooper [DG 2] (Elite)" → "Rebel Trooper"
 *   "Luke Skywalker [Group 1]"     → "Luke Skywalker"
 *   "ISB Agent (Regular)"          → "ISB Agent"
 * @param {string} dcName
 * @returns {string}
 */
export function getDcBaseName(dcName) {
  return (dcName || '')
    .replace(/\s*\[(?:DG|Group) \d+\]$/i, '')
    .replace(/\s*\((?:Elite|Regular)\)\s*$/i, '')
    .trim();
}

/**
 * Fold the LETTER O to a DIGIT ZERO for name comparison only.
 *
 * Droid designations are spelled inconsistently across the two card files: the
 * Deployment Cards are keyed "C-3P0" and "K-2S0" with a DIGIT ZERO, while the
 * Command Cards restricted to them say "C-3PO" and "K-2SO" with the LETTER O.
 * The two glyphs are near-identical in the card font, so the data picked up
 * both spellings and neither side is wrong to read.
 *
 * The consequence is silent: nothing throws, the card simply matches no
 * Deployment Card and is never offered. Found 2026-08-31 in the CC legality
 * gate; the SAME mismatch was still live in the figure PICKER and in Blend In's
 * own resolver, which is what this shared helper is for. A fold that lives in
 * one comparison site and not the others is how the second half survived.
 *
 * Deliberately narrow: it resolves a glyph ambiguity, NOT misspellings. The
 * comparable Saw Gerrera case is handled the right way instead: his DC key is
 * spelled correctly and only the ART FILENAME carries the typo, so
 * data/dc-images.json maps the good name to the bad file. Display strings are
 * never touched here.
 *
 * @param {string} s
 * @returns {string}
 */
export function foldDroidDigits(s) {
  return String(s ?? '').replace(/o/gi, '0');
}

/**
 * True if two DC names are the same card, tolerating the O/0 droid ambiguity.
 * Case-insensitive, and compares base names so "[DG 2]" / "(Elite)" suffixes
 * do not defeat it.
 *
 * @param {string} a
 * @param {string} b
 * @returns {boolean}
 */
export function isSameDcName(a, b) {
  if (!a || !b) return false;
  return foldDroidDigits(getDcBaseName(a).toLowerCase())
      === foldDroidDigits(getDcBaseName(b).toLowerCase());
}

/**
 * True if this DC is a "figureless" card (Skirmish Upgrade, attachment, etc.) — no physical figure on the map.
 * @param {string} dcName
 * @returns {boolean}
 */
export function isFigurelessDc(dcName) {
  if (!dcName || typeof dcName !== 'string') return false;
  const n = dcName.trim();
  if (!n) return false;
  const images = getDcImages();
  const path = images[n] || images[`[${n}]`] || (() => {
    const k = Object.keys(images).find((key) => key === n || (key.startsWith('[') && key.slice(1, -1) === n));
    return k ? images[k] : '';
  })();
  if (path && path.includes('dc-figures')) return false;
  if (path && path.includes('DC Skirmish Upgrades')) return true;
  if (/^\[.+\]$/.test(n)) return true;
  if (images[`[${n}]`]) return true;
  return Object.keys(images).some((k) => /^\[.+\]$/.test(k) && (k.slice(1, -1) === n || k === n));
}

/**
 * True if this Skirmish Upgrade has a Deplete effect.
 * @param {string} dcName
 * @returns {boolean}
 */
export function hasDepleteEffect(dcName) {
  if (!dcName || !isFigurelessDc(dcName)) return false;
  const card = getDcEffects()[dcName] || (typeof dcName === 'string' && !dcName.startsWith('[') ? getDcEffects()[`[${dcName}]`] : null);
  const text = card?.abilityText || '';
  return /deplete/i.test(text);
}

/**
 * True if this Skirmish Upgrade has an Exhaust effect (but NOT deplete-only).
 * @param {string} dcName
 * @returns {boolean}
 */
export function hasExhaustEffect(dcName) {
  if (!dcName || !isFigurelessDc(dcName)) return false;
  const card = getDcEffects()[dcName] || (typeof dcName === 'string' && !dcName.startsWith('[') ? getDcEffects()[`[${dcName}]`] : null);
  const text = card?.abilityText || '';
  return /exhaust/i.test(text);
}

/**
 * Description text for a DC's companion (from dc-effects.companion field).
 * @param {string} dcName
 * @returns {string}
 */
export function getCompanionDescriptionForDc(dcName) {
  const card = getDcEffects()[dcName] || (typeof dcName === 'string' && !dcName.startsWith('[') ? getDcEffects()[`[${dcName}]`] : null);
  const c = card?.companion;
  if (!c) return '*None*';
  if (typeof c === 'string' && c.trim()) return c.trim();
  return 'Companion (see ability text)';
}

/**
 * Return the maximum number of Power Tokens a figure can hold.
 * Normally 2; Migs Mayfeld's "Locked and Loaded" raises it to 3.
 * @param {string} figureKey - e.g. "Migs Mayfeld-1-0"
 * @returns {number}
 */
export function getMaxPowerTokens(figureKey) {
  if (!figureKey) return 2;
  const dcName = dcNameFromFigureKey(figureKey);
  const eff = getDcEffect(dcName);
  if (eff?.specialAbilityIds?.includes('locked_and_loaded')) return 3;
  return 2;
}

/**
 * True if this DC is a companion whose associated host group has left play
 * (all host figures defeated). Rules: COMPANIONS L919-920.
 * @param {object} game
 * @param {string} dcName - the companion's DC name (e.g. "J4X-7")
 * @param {number} playerNum - 1 or 2
 * @returns {boolean}
 */
export function isCompanionHostDefeated(game, dcName, playerNum) {
  const eff = getDcEffects()?.[dcName];
  if (eff?.companion !== true) return false;
  const hostMap = game.companionHostMap;
  if (!hostMap) return false;
  for (const [companionKey, entry] of Object.entries(hostMap)) {
    if (entry.playerNum !== playerNum) continue;
    if (!companionKey.startsWith(dcName + '-')) continue;
    const hostDcName = dcNameFromFigureKey(entry.hostFigureKey);
    const figs = game.figurePositions?.[playerNum] || {};
    const hostAlive = Object.keys(figs).some(fk => fk.startsWith(hostDcName + '-') && figs[fk]);
    if (!hostAlive) return true;
  }
  return false;
}

const FIGURE_LETTERS = 'abcdefghij';

/**
 * Build choice labels for a list of figure keys, adding (1a)/(1b) designators
 * when multiple figures from the same DC appear in the list OR the DC itself
 * is a multi-figure deployment card.
 * @param {string[]} figureKeys
 * @returns {string[]}
 */
export function figureChoiceLabels(figureKeys) {
  const dcCounts = {};
  for (const fk of figureKeys) {
    if (typeof fk === 'string' && /^npc_(?:thug|krykna)_\d+$/.test(fk)) continue;
    const dc = dcNameFromFigureKey(fk);
    dcCounts[dc] = (dcCounts[dc] || 0) + 1;
  }
  return figureKeys.map((fk) => {
    if (typeof fk === 'string' && /^npc_(?:thug|krykna)_\d+$/.test(fk)) {
      const p = fk.match(/^npc_(thug|krykna)_(\d+)$/);
      return `${p[1] === 'thug' ? 'Thug' : 'Krykna'} ${parseInt(p[2], 10) + 1}`;
    }
    const dc = dcNameFromFigureKey(fk);
    const dcEffect = getDcEffect(dc);
    if (dcCounts[dc] > 1 || (dcEffect && dcEffect.figures > 1)) {
      const { dgIndex, figureIndex } = parseFigureKey(fk);
      const letter = FIGURE_LETTERS[figureIndex] || 'a';
      return `${dc} (${dgIndex}${letter})`;
    }
    return dc;
  });
}

/**
 * Build a display label for a figure button, including group label (e.g. "1a")
 * and current token count when relevant.
 * @param {string} figureKey - e.g. "Stormtrooper-1-2"
 * @param {object} [game] - game state for token info
 * @returns {string} e.g. "Stormtrooper (1c) [1/2 tokens]"
 */
export function buildFigureButtonLabel(figureKey, game) {
  const dcName = dcNameFromFigureKey(figureKey);
  const { dgIndex, figureIndex } = parseFigureKey(figureKey);
  const letter = FIGURE_LETTERS[figureIndex] || 'a';
  let label = `${dcName} (${dgIndex}${letter})`;
  if (game?.figurePowerTokens) {
    const tokens = game.figurePowerTokens[figureKey] || [];
    const max = getMaxPowerTokens(figureKey);
    if (tokens.length > 0) {
      label += ` [${tokens.length}/${max}]`;
    }
  }
  return truncateLabel(label);
}
