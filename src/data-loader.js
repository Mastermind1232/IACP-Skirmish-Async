/**
 * Load and expose all game reference data from data/*.json.
 * Export getters only; reloadGameData() refreshes in place.
 */
import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { resolveAdaptiveSkills } from './game/adaptive-skills-helpers.js';

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
let loadoutCardsData = {};
let formCardsData = {};

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
  // Merge Nick Hansen LOS data (kept separate from map-spaces.json so the
  // in-browser map tool can never strip it during a save round-trip).
  try {
    const nlData = JSON.parse(readFileSync(join(rootDir, 'data', 'nick-los.json'), 'utf8'));
    for (const [mapId, nl] of Object.entries(nlData.maps || {})) {
      if (mapSpacesData[mapId]) mapSpacesData[mapId].nickLos = nl;
    }
  } catch {}
  try {
    const effData = JSON.parse(readFileSync(join(rootDir, 'data', 'dc-effects.json'), 'utf8'));
    dcEffects = effData.cards || {};
    // Refactor (alexanbv 2026-06-15): the data file splits always-on rule
    // keywords (`passives`: Massive, Mobile, Reach, Priority Target, Efficient
    // Travel, Thrusters, stat mods) from named windowed abilities (`abilities`:
    // Fly-By, Merciless, Hold the Line, Mounted, Regenerate, …). Engine sites
    // still read named ability flags off `passives`; merge `abilities` into the
    // runtime `passives` view so nothing breaks during the per-window migration.
    // parseInnatePassives only matches stat patterns, so it ignores named
    // entries. The clean split remains in the file + the `abilities` field.
    for (const card of Object.values(dcEffects)) {
      if (card && Array.isArray(card.abilities) && card.abilities.length) {
        card.passives = [...(card.passives || []), ...card.abilities];
      }
    }
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
  try {
    const lcData = JSON.parse(readFileSync(join(rootDir, 'data', 'loadout-cards.json'), 'utf8'));
    loadoutCardsData = lcData?.cards || {};
  } catch {}
  try {
    const fcData = JSON.parse(readFileSync(join(rootDir, 'data', 'form-cards.json'), 'utf8'));
    formCardsData = fcData?.cards || {};
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
/** Returns the full map-data record (spaces, adjacency, terrain, blocking, edges, exterior). */
export function getMapData(mapId) {
  return mapSpacesData[mapId] || null;
}
/** Returns the raw array of coordinate strings for a map (e.g. ['a1','b2',...]). */
export function getMapSpaceList(mapId) {
  return getMapData(mapId)?.spaces || [];
}
/** Returns a lowercase Set of coordinate strings — ready for membership checks. */
export function getMapSpaceSet(mapId) {
  return new Set(getMapSpaceList(mapId).map(s => s.toLowerCase()));
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

/**
 * Merged ability-flag view for a DC effect entry: always-on rule keywords +
 * stat passives (the `passives` field) UNION the named, windowed abilities (the
 * `abilities` field). Per alexanbv 2026-06-15 the data splits these — `passives`
 * holds only always-on rules (Massive, Mobile, Reach, Priority Target, stat
 * mods), while named timing abilities (Fly-By, Merciless, Hold the Line,
 * Mounted, Regenerate, …) live in `abilities`. Engine sites that test for a
 * named ability by string should read THIS (so they find it regardless of which
 * bucket it's in); parseInnatePassives keeps reading raw `passives` (stat mods
 * only). @returns {string[]}
 */
export function dcAbilityFlags(eff) {
  if (!eff) return [];
  const p = eff.passives || [];
  return eff.abilities && eff.abilities.length ? [...p, ...eff.abilities] : p;
}
/** Returns a map of dcName → keywords[], derived from dc-effects.json (single source of truth).
 *  Movement/combat-relevant passive traits (Mobile, Massive, Efficient Travel, Reach) are
 *  promoted to keywords so movement.js and combat handlers see them uniformly.
 *  When `game` is provided, dynamically adds keywords granted by attachments
 *  (e.g. Self-Augmentation adds DROID, Cross Training adds SPY). */
export function getDcKeywords(game) {
  const PASSIVE_AS_KEYWORD = new Set(['mobile', 'massive', 'efficient travel', 'reach']);
  const out = {};
  for (const [name, card] of Object.entries(dcEffects)) {
    const kws = Array.isArray(card.keywords) ? [...card.keywords] : [];
    for (const p of (card.passives || [])) {
      if (PASSIVE_AS_KEYWORD.has(String(p).toLowerCase())) kws.push(p);
    }
    if (kws.length) out[name] = kws;
  }

  // ── Overlay dynamic keywords from CC attachments ──
  if (game) {
    for (const pn of [1, 2]) {
      const ccAtts = pn === 1 ? game.p1CcAttachments : game.p2CcAttachments;
      if (!ccAtts) continue;
      const dcList = pn === 1 ? game.p1DcList : game.p2DcList;
      const msgIds = pn === 1 ? game.p1DcMessageIds : game.p2DcMessageIds;
      if (!dcList || !msgIds) continue;
      for (const [msgId, cards] of Object.entries(ccAtts)) {
        if (!Array.isArray(cards)) continue;
        if (cards.includes('Self-Augmentation')) {
          const idx = msgIds.indexOf(msgId);
          if (idx < 0) continue;
          const dc = dcList[idx];
          const dcName = typeof dc === 'object' ? (dc.dcName || dc.displayName) : dc;
          if (!dcName) continue;
          if (!out[dcName]) out[dcName] = [];
          if (!out[dcName].some(k => String(k).toUpperCase() === 'DROID')) {
            out[dcName].push('Droid');
          }
        }
      }
    }

    // ── Programming Override (4-LOM): grants a chosen TRAIT to 4-LOM until end
    // of round (CSV row113). The granted trait is stored at
    // game.roundProgrammingOverrideTrait[playerNum]; without injecting it here the
    // central keyword resolver never sees it, so combat passives / trait-conditional
    // auras (HUNTER/SMUGGLER etc.) don't recognize 4-LOM as having the trait.
    // alexanbv 2026-06-20. The flag clears at EOR-phase start (round.js timing fix).
    const _poTraits = game.roundProgrammingOverrideTrait;
    if (_poTraits) {
      for (const pn of [1, 2]) {
        const trait = _poTraits[pn];
        if (trait == null || trait === '') continue;
        const dcList = pn === 1 ? game.p1DcList : game.p2DcList;
        const has4Lom = Array.isArray(dcList) && dcList.some((e) => {
          const n = typeof e === 'object' ? (e.dcName || e.displayName) : e;
          return n === '4-LOM';
        });
        if (!has4Lom) continue;
        if (!out['4-LOM']) out['4-LOM'] = Array.isArray(dcEffects['4-LOM']?.keywords) ? [...dcEffects['4-LOM'].keywords] : [];
        if (!out['4-LOM'].some((k) => String(k).toUpperCase() === String(trait).toUpperCase())) {
          out['4-LOM'].push(trait);
        }
      }
    }

    // ── Cross Training (DC attachment): grants SPY trait to attached DC ──
    for (const pn of [1, 2]) {
      const dcAtts = pn === 1 ? game.p1DcAttachments : game.p2DcAttachments;
      if (!dcAtts) continue;
      const dcList = pn === 1 ? game.p1DcList : game.p2DcList;
      const msgIds = pn === 1 ? game.p1DcMessageIds : game.p2DcMessageIds;
      if (!dcList || !msgIds) continue;
      for (const [msgId, cards] of Object.entries(dcAtts)) {
        if (!Array.isArray(cards)) continue;
        if (cards.some(c => String(c).toLowerCase() === 'cross training')) {
          const idx = msgIds.indexOf(msgId);
          if (idx < 0) continue;
          const dc = dcList[idx];
          const dcName = typeof dc === 'object' ? (dc.dcName || dc.displayName) : dc;
          if (!dcName) continue;
          if (!out[dcName]) out[dcName] = [];
          if (!out[dcName].some(k => String(k).toUpperCase() === 'SPY')) {
            out[dcName].push('Spy');
          }
        }
      }
    }

    // ── Technician Training (Upgrade): grants the TECHNICIAN trait to the named
    // figures in ALL armies whenever EITHER player includes it (CSV row 88,
    // alexanbv 2026-06-19). It is an army-wide upgrade, so it appears in a
    // player's dcList like Balance of the Force / Temporary Alliance. ──
    const _ttInPlay = [1, 2].some((pn) => {
      const dcList = pn === 1 ? game.p1DcList : game.p2DcList;
      return Array.isArray(dcList) && dcList.some((e) => {
        const n = typeof e === 'object' ? (e.dcName || e.displayName) : e;
        return n === '[Technician Training]' || n === 'Technician Training';
      });
    });
    if (_ttInPlay) {
      const TT_NAMES = new Set([
        'C1-10P', 'Jarrod Kelvin', "Mak Eshka'rey", 'R2-D2', 'Chewbacca',
        'Jawa Scavenger', 'Ugnaught Tinkerer', 'Doctor Aphra', 'Zuckuss',
        'E-Web Engineer', 'General Sorin',
      ]);
      for (const name of Object.keys(dcEffects)) {
        const base = name.replace(/\s*\((?:Elite|Regular)\)\s*$/, '');
        if (!TT_NAMES.has(name) && !TT_NAMES.has(base)) continue;
        if (!out[name]) out[name] = Array.isArray(dcEffects[name].keywords) ? [...dcEffects[name].keywords] : [];
        if (!out[name].some((k) => String(k).toUpperCase() === 'TECHNICIAN')) out[name].push('TECHNICIAN');
      }
    }

    // ── Adaptive Skills (Mara Jade): inject trait based on army affiliation ──
    for (const pn of [1, 2]) {
      const dcList = pn === 1 ? game.p1DcList : game.p2DcList;
      if (!dcList) continue;
      const { dcName: maraName, trait } = resolveAdaptiveSkills(dcList, dcEffects);
      if (maraName && trait) {
        if (!out[maraName]) out[maraName] = [];
        if (!out[maraName].some(k => String(k).toUpperCase() === trait.toUpperCase())) {
          out[maraName].push(trait);
        }
      }
    }
  }

  return out;
}

/**
 * Choose a Side (IMPERIAL) grant check. Returns true when the given friendly
 * figure currently has the round-scoped "Gar Saxon's Flamethrower" Special
 * Action granted by Choose a Side: i.e. the round flag is set for `playerNum`,
 * the figure has the Mobile keyword, and the figure is NOT the excluded
 * (card-playing) figure. Used by BOTH the render path (components.js, to inject
 * the extra Special Action button) and the dispatch path (dc-play-area.js, to
 * route it to the gar_saxon_flamethrower resolver) so the two cannot drift.
 *
 * Assumptions (designer not yet ruled — flagged): "Mobile" = the Mobile
 * keyword; "other" excludes the Choose-a-Side figure (excludeFigureKey).
 *
 * @param {object} game
 * @param {number} playerNum 1 | 2 (controller of the figure)
 * @param {string} figureKey e.g. "Mando-1-0"
 * @returns {boolean}
 */
export function hasChooseASideFlamethrower(game, playerNum, figureKey) {
  if (!game || !playerNum || !figureKey) return false;
  const flag = game.roundMobileGarSaxonFlamethrower?.[playerNum];
  if (!flag) return false;
  if (flag.excludeFigureKey && figureKey === flag.excludeFigureKey) return false;
  const dcName = (figureKey || '').replace(/-\d+-\d+$/, '');
  const kws = (getDcKeywords(game)?.[dcName] || []).map((k) => String(k).toUpperCase());
  return kws.includes('MOBILE');
}

export function getDiceData() {
  return diceData;
}

/**
 * Distinct selectable faces of a die, derived from the canonical dice data
 * (data/dice.json) — the single source for every die-face picker (There Is No
 * Try, etc.; alexanbv 2026-06-21). Physical duplicate faces are collapsed.
 * @param {'attack'|'defense'} type
 * @param {string} color e.g. 'white' | 'black' | 'red' | 'blue' | 'green' | 'yellow'
 * @returns {Array<object>} attack faces {acc,dmg,surge}; defense faces {block,evade,dodge?}
 */
export function getDistinctDieFaces(type, color) {
  const faces = getDiceData()?.[type]?.[color] || [];
  const seen = new Set();
  const out = [];
  for (const f of faces) {
    let key, face;
    if (type === 'defense') {
      const block = f.block ?? 0, evade = f.evade ?? 0, dodge = !!f.dodge;
      key = `${block}|${evade}|${dodge ? 1 : 0}`;
      face = dodge ? { block, evade, dodge: true } : { block, evade };
    } else {
      const acc = f.acc ?? 0, dmg = f.dmg ?? 0, surge = f.surge ?? 0;
      key = `${acc}|${dmg}|${surge}`;
      face = { acc, dmg, surge };
    }
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(face);
  }
  return out;
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

/**
 * Look up a mission-rules flag across all timing buckets (top-level,
 * persistent, startOfRound, endOfRound, immediate). Returns the value if
 * found, else null. Use this to drive mechanics off data instead of
 * hardcoded `mapId === 'X' && variant === 'Y'` checks.
 */
export function getMissionFlag(mapId, variant, flagName) {
  const rules = getMissionRules(mapId, variant);
  if (!rules) return null;
  if (rules[flagName] !== undefined) return rules[flagName];
  for (const bucket of ['persistent', 'startOfRound', 'endOfRound', 'immediate']) {
    if (rules[bucket] && rules[bucket][flagName] !== undefined) return rules[bucket][flagName];
  }
  return null;
}

/** Truthy check for a mission-rules flag — convenience over getMissionFlag. */
export function hasMissionFlag(mapId, variant, flagName) {
  const v = getMissionFlag(mapId, variant, flagName);
  return v !== null && v !== false && v !== undefined;
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
  const result = ccEffectsData.cards?.[cardName];
  if (result) return result;
  // Fallback: strip trailing faction suffix like " (Mercenary)" from pasted list names
  const stripped = typeof cardName === 'string' ? cardName.replace(/\s+\((?:Mercenary|Imperial|Rebel)\)$/i, '').trim() : null;
  return (stripped && stripped !== cardName) ? (ccEffectsData.cards?.[stripped] || null) : null;
}

/**
 * Two-timing model (alexanbv 2026-06-18): a Command Card's TAKE-EFFECT timing.
 * Every CC has a PLAY (use) `timing` (when it is offered + played + any choice is
 * made) and a TAKE-EFFECT timing (when its effect actually applies). They are the
 * SAME for the vast majority of cards, so `effectTiming` is OPTIONAL and DEFAULTS
 * to `timing` — the hundreds of same-timing cards need no data change. A card
 * whose effect lands in a different window sets `effectTiming` explicitly. Returns
 * null when the card is unknown.
 * @param {string} cardName
 * @returns {string|null}
 */
export function getCcEffectTiming(cardName) {
  const data = getCcEffect(cardName);
  if (!data) return null;
  return data.effectTiming || data.timing || null;
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

/** True if this Deployment Card is a companion figure (e.g. BD-1, Junk Droid, Dio, The Child). */
export function isDcCompanion(dcName) {
  if (!dcName || typeof dcName !== 'string') return false;
  const n = dcName.trim();
  const effects = getDcEffects();
  const card = effects[n] || effects[`[${n}]`] || (n.startsWith('[') ? effects[n] : null);
  return !!card?.companion;
}

/** True if this Deployment Card is unique (from dc-effects.json unique field). */
export function isDcUnique(dcName) {
  if (!dcName || typeof dcName !== 'string') return false;
  const n = dcName.trim();
  const effects = getDcEffects();
  const card = effects[n] || effects[`[${n}]`] || (n.startsWith('[') ? effects[n] : null);
  return card?.unique === true;
}

export function getLoadoutCards() {
  return loadoutCardsData;
}

export function getFormCards() {
  return formCardsData;
}

export function getRootDir() {
  return rootDir;
}

/** Local figureless check using getDcImages (avoids circular dep with dc-helpers). */
function _isFigurelessDc(dcName) {
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
 * Get normalized stats for a deployment card by name.
 * @param {string} dcName
 * @returns {{ health, figures, speed, cost, attack, defense, specials, specialCosts, passives, abilityText }}
 */
export function getDcStats(dcName) {
  const effects = getDcEffects();
  const lower = dcName?.toLowerCase?.() || '';
  const ciKey = Object.keys(effects).find((k) => k.toLowerCase() === lower);
  const eff =
    effects[dcName] ||
    (ciKey ? effects[ciKey] : null) ||
    (typeof dcName === 'string' && !dcName.startsWith('[') ? effects[`[${dcName}]`] : null);
  if (eff) {
    const PASSIVE_ONLY_IDS = new Set(['battle_meditation','cunning_han','cunning_jyn','cunning_nexu_elite','cunning_nexu_reg',
      'distracting_han','distracting_c3po','hunker_down','full_of_rage','fury_wookiee_elite','fury_wookiee_reg',
      'relentless_trandoshan_elite','relentless_trandoshan_reg','relentless_ig88','fifth_brother_relentless',
      'lasat_honor_guard','shock_and_awe','flawless_execution','expertise','regenerate_bossk',
      'sidestep_nexu_elite','sidestep_nexu_reg','ee3_carbine',
      'guerrilla_alliance_ranger_elite','guerrilla_alliance_ranger_reg',
      // Heroic surfaces as a sibling Attack button (Primary/blue, no action cost)
      // alongside the regular Attack button, NOT as a separate Special Action.
      // (destruct 2026-05-06.) Filtered out here so it doesn't double up.
      'heroic']);
    let specials = eff.specials;
    let specialIds = [];
    if (!specials && eff.specialAbilityIds?.length) {
      const lib = getAbilityLibrary() || {};
      const filtered = eff.specialAbilityIds.filter((id) => {
        if (PASSIVE_ONLY_IDS.has(id)) return false;
        const entry = lib.abilities?.[id];
        if (entry?.category === 'passive') return false;
        // Round-boundary abilities (start-of-round / end-of-round triggers)
        // are driven by the SoR/EoR round flow, NOT by an activation-time
        // Special Action button. Without this, e.g. AT-RT's Mortar Launcher
        // (category 'passive-reactive', trigger 'end-of-round') wrongly
        // surfaced as a mid-activation Special Action. (alexanbv 2026-06-18.)
        if (entry?.trigger === 'end-of-round' || entry?.trigger === 'start-of-round') return false;
        return true;
      });
      specialIds = filtered;
      specials = filtered.map((id) => {
        const entry = lib.abilities?.[id];
        return entry?.label || id.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
      });
      // Build specialMpCosts and specialCosts from ability library
      if (!eff.specialCosts?.length) {
        const mpCosts = filtered.map((id) => {
          const entry = lib.abilities?.[id];
          return entry?.mpCost ?? entry?.mpCostToActivate ?? 0;
        });
        const actionCosts = filtered.map((id) => lib.abilities?.[id]?.actionCost);
        const hasActionCost = actionCosts.some(c => typeof c === 'number');
        if (mpCosts.some(c => c > 0) || hasActionCost) {
          eff._specialMpCosts = mpCosts;
          // Precedence: explicit library `actionCost` > MP-based 0-cost > default 1
          eff._specialActionCosts = filtered.map((id, i) => {
            const ac = actionCosts[i];
            if (typeof ac === 'number') return ac;
            return mpCosts[i] > 0 ? 0 : 1;
          });
        }
      }
    }
    return {
      health: eff.health ?? null,
      figures: _isFigurelessDc(dcName) ? 0 : (eff.figures ?? 1),
      speed: eff.speed ?? null,
      cost: eff.cost ?? null,
      attack: eff.attack ?? null,
      defense: eff.defense ?? null,
      specials: specials || [],
      specialIds,
      // Unfiltered specialAbilityIds — useful for renderers that need to know
      // about passive-auto / filtered-out slugs (e.g. Heroic surfaces as a
      // sibling Attack button, not a Special Action button, but the renderer
      // still needs to detect 'heroic' to add the second button).
      rawSpecialIds: eff.specialAbilityIds || [],
      specialCosts: eff.specialCosts?.length ? eff.specialCosts : (eff._specialActionCosts || []),
      specialMpCosts: eff._specialMpCosts || [],
      passives: eff.passives || [],
      abilityText: eff.abilityText || '',
    };
  }
  return { health: null, figures: _isFigurelessDc(dcName) ? 0 : 1, specials: [], specialCosts: [], passives: [], abilityText: '' };
}
