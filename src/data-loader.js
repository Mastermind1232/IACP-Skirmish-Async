/**
 * Load and expose all game reference data from data/*.json.
 * Export getters only; reloadGameData() refreshes in place.
 */
import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const rootDir = join(__dirname, '..');

let dcImages = {};
let figureImages = {};
let figureSizes = {};
let dcStats = {};
let mapRegistry = [];
let deploymentZones = {};
let mapSpacesData = {};
let dcEffects = {};
let dcKeywords = {};
let diceData = { attack: {}, defense: {} };
let missionCardsData = {};
let mapTokensData = {};
let ccEffectsData = { cards: {} };
let abilityLibrary = { abilities: {} };

function loadAll() {
  try {
    const dcData = JSON.parse(readFileSync(join(rootDir, 'data', 'dc-images.json'), 'utf8'));
    dcImages = dcData.dcImages || {};
  } catch {}
  try {
    const figData = JSON.parse(readFileSync(join(rootDir, 'data', 'figure-images.json'), 'utf8'));
    figureImages = figData.figureImages || {};
  } catch {}
  try {
    const szData = JSON.parse(readFileSync(join(rootDir, 'data', 'figure-sizes.json'), 'utf8'));
    figureSizes = szData.figureSizes || {};
  } catch {}
  try {
    const statsData = JSON.parse(readFileSync(join(rootDir, 'data', 'dc-stats.json'), 'utf8'));
    dcStats = statsData.dcStats || {};
  } catch {}
  try {
    const mapData = JSON.parse(readFileSync(join(rootDir, 'data', 'map-registry.json'), 'utf8'));
    mapRegistry = mapData.maps || [];
  } catch {}
  try {
    const dzData = JSON.parse(readFileSync(join(rootDir, 'data', 'deployment-zones.json'), 'utf8'));
    deploymentZones = dzData.maps || {};
  } catch {}
  try {
    const msData = JSON.parse(readFileSync(join(rootDir, 'data', 'map-spaces.json'), 'utf8'));
    mapSpacesData = msData.maps || {};
  } catch {}
  try {
    const effData = JSON.parse(readFileSync(join(rootDir, 'data', 'dc-effects.json'), 'utf8'));
    dcEffects = effData.cards || {};
  } catch {}
  try {
    const kwData = JSON.parse(readFileSync(join(rootDir, 'data', 'dc-keywords.json'), 'utf8'));
    dcKeywords = kwData.keywords || {};
  } catch {}
  try {
    const dData = JSON.parse(readFileSync(join(rootDir, 'data', 'dice.json'), 'utf8'));
    diceData = dData || { attack: {}, defense: {} };
  } catch {}
  try {
    const mcData = JSON.parse(readFileSync(join(rootDir, 'data', 'mission-cards.json'), 'utf8'));
    missionCardsData = mcData.maps || {};
  } catch {}
  try {
    const mtData = JSON.parse(readFileSync(join(rootDir, 'data', 'map-tokens.json'), 'utf8'));
    mapTokensData = mtData.maps || {};
  } catch {}
  try {
    const ccData = JSON.parse(readFileSync(join(rootDir, 'data', 'cc-effects.json'), 'utf8'));
    if (ccData?.cards) ccEffectsData = ccData;
  } catch {}
  try {
    const abData = JSON.parse(readFileSync(join(rootDir, 'data', 'ability-library.json'), 'utf8'));
    abilityLibrary = abData?.abilities ? { abilities: abData.abilities } : { abilities: {} };
  } catch {}
}

loadAll();

/** Reload all game data from JSON files. Call before Refresh All so git-pulled changes apply. */
export async function reloadGameData() {
  const { clearMapRendererCache } = await import('./map-renderer.js');
  clearMapRendererCache();
  loadAll();
}

export function getDcImages() {
  return dcImages;
}
export function getFigureImages() {
  return figureImages;
}
export function getFigureSizes() {
  return figureSizes;
}

/** Get figure base size (1x1, 1x2, 2x2, 2x3) for movement/rendering. Default 1x1. */
export function getFigureSize(dcName) {
  const sizes = getFigureSizes();
  const exact = sizes[dcName];
  if (exact) return exact;
  const lower = dcName?.toLowerCase?.() || '';
  const key = Object.keys(sizes).find((k) => k.toLowerCase() === lower);
  if (key) return sizes[key];
  const base = (dcName || '').replace(/\s*\((?:Elite|Regular)\)\s*$/i, '').trim();
  const key2 = Object.keys(sizes).find((k) => k.toLowerCase().startsWith(base.toLowerCase()));
  return key2 ? sizes[key2] : '1x1';
}

export function getDcStats() {
  return dcStats;
}
export function getMapRegistry() {
  return mapRegistry;
}
export function getDeploymentZones() {
  return deploymentZones;
}
export function getMapSpacesData() {
  return mapSpacesData;
}
export function getMapSpaces(mapId) {
  return mapSpacesData[mapId] || null;
}
export function getDcEffects() {
  return dcEffects;
}
export function getDcKeywords() {
  return dcKeywords;
}
export function getDiceData() {
  return diceData;
}
export function getMissionCardsData() {
  return missionCardsData;
}
export function getMapTokensData() {
  return mapTokensData;
}
export function getCcEffectsData() {
  return ccEffectsData;
}

export function getCcEffect(cardName) {
  return ccEffectsData.cards?.[cardName] || null;
}

/** Ability library (F1): id → { type, surgeCost?, label?, ... }. Used by game/abilities.js. */
export function getAbilityLibrary() {
  return abilityLibrary;
}

/** True if this command card becomes an Attachment (placed on a Deployment card) when played. */
export function isCcAttachment(cardName) {
  const data = getCcEffect(cardName);
  const effect = (data?.effect || '').toLowerCase();
  return /attachment|on your deployment card as an attachment|place this card on your deployment card/i.test(effect);
}

/** True if this Deployment Card is a Skirmish Upgrade that attaches to a host DC (e.g. [Focused on the Kill]). */
export function isDcAttachment(dcName) {
  if (!dcName || typeof dcName !== 'string') return false;
  const n = dcName.trim();
  const effects = getDcEffects();
  const card = effects[n] || effects[`[${n}]`] || (n.startsWith('[') ? effects[n] : null);
  return card?.attachment === true;
}

export function getRootDir() {
  return rootDir;
}
