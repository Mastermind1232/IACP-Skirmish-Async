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
let mapRegistry = [];
let deploymentZones = {};
let mapSpacesData = {};
let dcEffects = {};
let diceData = { attack: {}, defense: {} };
let missionCardsData = {};
let mapTokensData = {};
let ccEffectsData = { cards: {} };
let abilityLibrary = { abilities: {} };
let tournamentRotation = { missionIds: [] };

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
  try {
    const rotData = JSON.parse(readFileSync(join(rootDir, 'data', 'tournament-rotation.json'), 'utf8'));
    tournamentRotation = Array.isArray(rotData?.missionIds) ? { missionIds: rotData.missionIds } : { missionIds: [] };
  } catch {}
  validateCriticalData();
}

/** D3: Validate critical JSON shape on load; log warnings and fail fast in dev. */
function validateCriticalData() {
  const warnings = [];
  if (!dcEffects || typeof dcEffects !== 'object') {
    warnings.push('dc-effects (dcEffects): expected object');
  }
  if (!mapSpacesData || typeof mapSpacesData !== 'object') {
    warnings.push('map-spaces (mapSpacesData): expected object');
  } else {
    const firstMapId = Object.keys(mapSpacesData)[0];
    const firstMap = firstMapId ? mapSpacesData[firstMapId] : null;
    if (firstMap && typeof firstMap === 'object' && firstMap.spaces == null && firstMap.adjacency == null) {
      warnings.push('map-spaces: each map should have "spaces" and/or "adjacency"');
    }
  }
  const ab = abilityLibrary?.abilities;
  if (!ab || typeof ab !== 'object') {
    warnings.push('ability-library (abilityLibrary.abilities): expected object');
  } else {
    const firstAbId = Object.keys(ab)[0];
    const firstAb = firstAbId ? ab[firstAbId] : null;
    if (firstAb && (typeof firstAb !== 'object' || firstAb === null || (firstAb.type == null && firstAb.surgeCost == null))) {
      warnings.push('ability-library: each entry should be object with type/surgeCost');
    }
  }
  if (!ccEffectsData?.cards || typeof ccEffectsData.cards !== 'object') {
    warnings.push('cc-effects (ccEffectsData.cards): expected object');
  }
  if (!Array.isArray(mapRegistry)) {
    warnings.push('map-registry (mapRegistry): expected array');
  } else if (mapRegistry.length && typeof mapRegistry[0] !== 'object') {
    warnings.push('map-registry: each entry should be an object (id, name, grid, imagePath)');
  }
  if (!deploymentZones || typeof deploymentZones !== 'object') {
    warnings.push('deployment-zones (deploymentZones): expected object');
  } else {
    const firstDz = Object.keys(deploymentZones)[0];
    const dz = firstDz ? deploymentZones[firstDz] : null;
    if (dz && typeof dz === 'object' && !Array.isArray(dz.red) && !Array.isArray(dz.blue)) {
      warnings.push('deployment-zones: each map should have "red" and/or "blue" arrays');
    }
  }
  if (!diceData || typeof diceData !== 'object') {
    warnings.push('dice (diceData): expected object');
  } else {
    if (typeof diceData.attack !== 'object' || diceData.attack === null) {
      warnings.push('dice: expected "attack" object (e.g. red, yellow, green, blue)');
    }
    if (typeof diceData.defense !== 'object' || diceData.defense === null) {
      warnings.push('dice: expected "defense" object (e.g. white, black)');
    }
  }
  if (warnings.length) {
    console.warn('[Data] Validation warnings:', warnings.join('; '));
    if (process.env.NODE_ENV === 'development') {
      throw new Error(`[Data] Critical data validation failed: ${warnings.join('; ')}`);
    }
  }
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

/** F9: True if the space is marked exterior in map data (for abilities/CC that care about exterior vs interior). */
export function isExteriorSpace(mapSpaces, coord) {
  if (!mapSpaces || coord == null) return false;
  const key = String(coord).toLowerCase();
  return !!mapSpaces.exterior?.[key];
}

export function getDcEffects() {
  return dcEffects;
}
/** Returns a map of dcName → keywords[], derived from dc-effects.json (single source of truth). */
export function getDcKeywords() {
  const out = {};
  for (const [name, card] of Object.entries(dcEffects)) {
    if (Array.isArray(card.keywords)) out[name] = card.keywords;
  }
  return out;
}
export function getDiceData() {
  return diceData;
}
export function getMissionCardsData() {
  return missionCardsData;
}

/** Mission rules (VP, effects) for a map variant. From mission-cards.json per-variant "rules" block. */
export function getMissionRules(mapId, variant) {
  const v = variant === 'b' ? 'b' : 'a';
  const rules = missionCardsData?.[mapId]?.[v]?.rules;
  return rules && typeof rules === 'object' ? rules : {};
}

/** D4: Tournament rotation mission IDs (mapId:variant). Empty if not configured. */
export function getTournamentRotation() {
  return tournamentRotation;
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

/** True if this Deployment Card is unique (from dc-effects.json unique field). */
export function isDcUnique(dcName) {
  if (!dcName || typeof dcName !== 'string') return false;
  const n = dcName.trim();
  const effects = getDcEffects();
  const card = effects[n] || effects[`[${n}]`] || (n.startsWith('[') ? effects[n] : null);
  return card?.unique === true;
}

export function getRootDir() {
  return rootDir;
}
