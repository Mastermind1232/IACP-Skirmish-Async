/**
 * Asset path resolution utilities for CC/DC card images, figure tokens,
 * condition cards, and mission cards. No Discord dependency.
 */
import { existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { getDcImages, getFigureImages, getRootDir } from './data-loader.js';
import { isFigurelessDc } from './game/dc-helpers.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const rootDir = join(__dirname, '..');
const IMAGES_DIR = join(rootDir, 'vassal_extracted', 'images');
const CC_DIR = join(IMAGES_DIR, 'cc');
const CARDBACKS_DIR = join(IMAGES_DIR, 'cardbacks');

/**
 * Maps figure DC name → { upgradeName → upgraded card image path }.
 * When a figure has the named skirmish upgrade attached, the embed shows the upgraded art.
 */
export const UPGRADE_IMAGE_OVERRIDES = {
  'Darth Vader': { 'Driven by Hatred': 'vassal_extracted/images/dc-figures/Darth Vader Driven by Hatred.jpg' },
  'Han Solo':    { 'Rogue Smuggler':   'vassal_extracted/images/dc-figures/Han Solo Rogue Smuggler.jpg' },
  'Chewbacca':   { 'Wookiee Avenger':  'vassal_extracted/images/dc-figures/Chewbacca Wookiee Avenger.jpg' },
  'IG-88':       { 'Focused on the Kill': 'vassal_extracted/images/dc-figures/IG-88 Focused on the Kill.jpg' },
};

/** Resolve CC image path (cc/ subfolder first, IACP variants, cardback fallback). */
export function getCommandCardImagePath(cardName) {
  if (!cardName || typeof cardName !== 'string') return null;
  const stripped = cardName.replace(/\s+\((?:Mercenary|Imperial|Rebel)\)$/i, '').trim();
  const clean = stripped.replace(/[':]/g, '').replace(/\s+/g, ' ').trim();
  const iacp = `${stripped} (IACP)`;
  const cleanIacp = `${clean} (IACP)`;
  const candidates = [];
  if (stripped.trim().toLowerCase() === 'smoke grenade') {
    candidates.push('Smoke Grenade Final.png', '003 Smoke Grenade Final.png');
  }
  for (const base of [iacp, cleanIacp, stripped, clean]) {
    candidates.push(`${base}.jpg`, `${base}.png`);
  }
  for (const base of [stripped, clean]) {
    candidates.push(
      `C card--${base}.jpg`,
      `C card--${base}.png`,
      `IACP_C card--${base}.png`,
      `IACP_C card--${base}.jpg`,
      `IACP9_C card--${base}.png`,
      `IACP9_C card--${base}.jpg`,
      `IACP10_C card--${base}.png`,
      `IACP10_C card--${base}.jpg`,
      `IACP11_C card--${base}.png`,
      `IACP11_C card--${base}.jpg`,
    );
  }
  for (const c of candidates) {
    const inCc = join(CC_DIR, c);
    if (existsSync(inCc)) return inCc;
    const inRoot = join(IMAGES_DIR, c);
    if (existsSync(inRoot)) return inRoot;
  }
  const cardbackCandidates = [
    join(CARDBACKS_DIR, 'Command cardback.jpg'),
    join(CC_DIR, 'Command cardback.jpg'),
    join(IMAGES_DIR, 'Command cardback.jpg'),
  ];
  for (const p of cardbackCandidates) {
    if (existsSync(p)) return p;
  }
  return null;
}

/** Try subfolder first, then root. relPath is e.g. "vassal_extracted/images/X.gif". Prefers .png over .gif when both exist. */
export function resolveAssetPath(relPath, subfolder) {
  if (!relPath || typeof relPath !== 'string') return null;
  const filename = relPath.split(/[/\\]/).pop() || relPath;
  const baseName = filename.replace(/\.[^.]+$/, '');
  const candidates = [baseName + '.png', baseName + '.jpg', filename];
  for (const name of candidates) {
    const inSub = `vassal_extracted/images/${subfolder}/${name}`;
    if (existsSync(join(rootDir, inSub))) return inSub;
    if (subfolder === 'figures') {
      const inTokens = `vassal_extracted/images/figure-tokens/${name}`;
      if (existsSync(join(rootDir, inTokens))) return inTokens;
    }
  }
  if (existsSync(join(rootDir, relPath))) return relPath;
  return relPath;
}

/** Prefer IACP variant image when it exists. Then prefer dc-figures/ or DC Skirmish Upgrades/ subfolder. */
export function resolveDcImagePath(relPath, dcName) {
  if (!relPath || typeof relPath !== 'string') return null;
  const parts = relPath.split(/[/\\]/);
  const dirRel = parts.slice(0, -1).join('/');
  const baseWithExt = parts[parts.length - 1] || relPath;
  const baseName = baseWithExt.replace(/\.[^.]+$/, '');
  for (const ext of ['.jpg', '.png', '.gif']) {
    const iacpRel = dirRel + '/' + baseName + ' (IACP)' + ext;
    if (existsSync(join(rootDir, ...iacpRel.split('/')))) return iacpRel;
  }
  const filename = baseWithExt;
  const subfolder = dcName && isFigurelessDc(dcName) ? 'DC Skirmish Upgrades' : 'dc-figures';
  const inSub = `vassal_extracted/images/${subfolder}/${filename}`;
  if (existsSync(join(rootDir, inSub))) return inSub;
  const otherSub = subfolder === 'dc-figures' ? 'DC Skirmish Upgrades' : 'dc-figures';
  const inOther = `vassal_extracted/images/${otherSub}/${filename}`;
  if (existsSync(join(rootDir, inOther))) return inOther;
  if (existsSync(join(rootDir, relPath))) return relPath;
  return relPath;
}

/** Shared fuzzy image lookup: exact → lowercase → strip Elite/Regular → prefix match. */
function _lookupImageByName(registry, dcName, resolve) {
  if (!dcName || typeof dcName !== 'string') return null;
  const exact = registry[dcName];
  if (exact) return resolve(exact, dcName);
  const lower = dcName.toLowerCase();
  let key = Object.keys(registry).find((k) => k.toLowerCase() === lower);
  if (key) return resolve(registry[key], key);
  const base = dcName.replace(/\s*\((?:Elite|Regular)\)\s*$/i, '').trim();
  if (base !== dcName) {
    key = Object.keys(registry).find((k) => k.toLowerCase() === base.toLowerCase());
    if (key) return resolve(registry[key], key);
    key = Object.keys(registry).find((k) => k.toLowerCase().startsWith(base.toLowerCase()));
    if (key) return resolve(registry[key], key);
  }
  key = Object.keys(registry).find((k) => k.toLowerCase().startsWith(lower) || lower.startsWith(k.toLowerCase()));
  return key ? resolve(registry[key], key) : null;
}

/** Resolve DC name to DC card image path (for deployment card embeds). */
export function getDcImagePath(dcName) {
  if (!dcName || typeof dcName !== 'string') return null;
  const registry = getDcImages();
  // Bracket-wrapped DC names (e.g. "[Skirmish Upgrade]")
  const trimmed = dcName.trim();
  if (!/^\[.+\]$/.test(trimmed) && registry[`[${trimmed}]`]) {
    return resolveDcImagePath(registry[`[${trimmed}]`], `[${trimmed}]`);
  }
  return _lookupImageByName(registry, dcName, resolveDcImagePath);
}

/** Return absolute path to condition card image, or null if not found. */
// Game state stores short verbs (Focus, Stun, etc.); card files use participles (Focused, Stunned, etc.)
const COND_CARD_NAME = { Focus: 'Focused', Stun: 'Stunned', Bleed: 'Bleeding', Weaken: 'Weakened', Hide: 'Hidden' };
export function getConditionCardPath(conditionName) {
  if (!conditionName) return null;
  const fname = `Condition card--${COND_CARD_NAME[conditionName] || conditionName}.jpg`;
  const p = join(rootDir, 'vassal_extracted', 'images', 'conditions', fname);
  return existsSync(p) ? p : null;
}

/** Resolve DC name to circular figure image (for map tokens). */
export function getFigureImagePath(dcName) {
  return _lookupImageByName(getFigureImages(), dcName, (path) => resolveAssetPath(path, 'figures'));
}

/** Resolve mission card image path; tries .png, .jpg, .jpeg so data can say .png while files are .jpg. */
export function resolveMissionCardImagePath(relPath) {
  if (!relPath || typeof relPath !== 'string') return null;
  const subfolder = 'mission-cards';
  const filename = relPath.split(/[/\\]/).pop() || relPath;
  const base = filename.replace(/\.[^.]+$/i, '') || filename;
  const exts = ['.png', '.jpg', '.jpeg'];
  const tried = new Set();
  for (const ext of exts) {
    const name = base + ext;
    if (tried.has(name.toLowerCase())) continue;
    tried.add(name.toLowerCase());
    const inSub = `vassal_extracted/images/${subfolder}/${name}`;
    if (existsSync(join(rootDir, inSub))) return inSub;
  }
  return resolveAssetPath(relPath, subfolder);
}
