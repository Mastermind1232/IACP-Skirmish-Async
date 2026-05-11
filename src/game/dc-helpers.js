/**
 * DC (deployment card) pure lookup helpers.
 * No Discord dependency.
 */
import { getDcEffects, getDcImages } from '../data-loader.js';
import { truncateLabel } from '../discord/components.js';

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
