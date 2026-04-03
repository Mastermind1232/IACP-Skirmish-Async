/**
 * DC (deployment card) pure lookup helpers.
 * No Discord dependency.
 */
import { getDcEffects, getDcImages } from '../data-loader.js';

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
  // Discord button labels max 80 chars
  return label.length > 80 ? label.slice(0, 77) + '...' : label;
}
