/**
 * DC (deployment card) pure lookup helpers.
 * No Discord dependency.
 */
import { getDcEffects, getDcImages } from '../data-loader.js';

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
