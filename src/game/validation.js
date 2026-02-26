/**
 * Game validation (deck legal, etc.). No Discord; uses data-loader for card data.
 */
import { getDcEffects, getCcEffect, getCcEffectsData } from '../data-loader.js';

export const DC_POINTS_LEGAL = 40;
export const CC_CARDS_LEGAL = 15;
export const CC_COST_LEGAL = 15;

/** Resolve DC list entry to card name (object or string). */
export function resolveDcName(entry) {
  return typeof entry === 'object' ? (entry.dcName || entry.displayName) : entry;
}

/** Strip leading cost number, trailing IACP, convert [E]/[R] to (Elite)/(Regular). */
function normalizeInputName(raw) {
  let s = raw.trim();
  // Strip leading cost number (e.g. "7 The Grand Inquisitor IACP" → "The Grand Inquisitor IACP")
  s = s.replace(/^\d+\s+/, '');
  // Strip trailing IACP (case-insensitive)
  s = s.replace(/\s+IACP\s*$/i, '').trim();
  // Convert [E] to (Elite), [R] to (Regular)
  s = s.replace(/\s*\[E\]\s*/gi, ' (Elite)').replace(/\s*\[R\]\s*/gi, ' (Regular)').trim();
  return s;
}

/** Normalize string for fuzzy comparison: lowercase, strip apostrophes/special chars. */
function fuzzyKey(s) {
  return s.toLowerCase().replace(/[''`]/g, '').replace(/\s+/g, ' ').trim();
}

/**
 * Resolve a raw DC input name to a canonical dc-effects.json key.
 * Tries: exact → bracket-wrapped → case-insensitive → fuzzy (no apostrophe) → partial parenthetical.
 */
function resolveDcInput(raw, dcEffects) {
  const name = normalizeInputName(raw);
  // Exact match
  if (dcEffects[name]) return name;
  // Bracket-wrapped (skirmish upgrades)
  const bracketed = `[${name}]`;
  if (dcEffects[bracketed]) return bracketed;
  // Build lookup caches
  const keys = Object.keys(dcEffects);
  const lowerMap = {};
  const fuzzyMap = {};
  for (const k of keys) {
    lowerMap[k.toLowerCase()] = k;
    fuzzyMap[fuzzyKey(k)] = k;
  }
  // Case-insensitive exact
  const lower = name.toLowerCase();
  if (lowerMap[lower]) return lowerMap[lower];
  if (lowerMap[bracketed.toLowerCase()]) return lowerMap[bracketed.toLowerCase()];
  // Fuzzy (strip apostrophes)
  const fk = fuzzyKey(name);
  if (fuzzyMap[fk]) return fuzzyMap[fk];
  if (fuzzyMap[fuzzyKey(bracketed)]) return fuzzyMap[fuzzyKey(bracketed)];
  // Partial parenthetical: "Luke Skywalker (Jedi)" matches "Luke Skywalker (Jedi Knight)"
  // Strip trailing ) so "Luke Skywalker (Jedi)" becomes "Luke Skywalker (Jedi" for prefix matching
  const lowerPrefix = lower.endsWith(')') ? lower.slice(0, -1) : lower;
  const match = keys.find((k) => k.toLowerCase().startsWith(lowerPrefix) && k.includes('('));
  if (match) return match;
  // Bare name: "Wookiee Warrior" → prefer Elite, fallback Regular
  const eliteMatch = keys.find((k) => k.toLowerCase() === `${lower} (elite)`);
  if (eliteMatch) return eliteMatch;
  const regMatch = keys.find((k) => k.toLowerCase() === `${lower} (regular)`);
  if (regMatch) return regMatch;
  return name; // unresolved — will produce error in validation
}

/**
 * Resolve a raw CC input name to a canonical cc-effects key.
 * Tries: exact → case-insensitive → fuzzy (no apostrophe) → punctuation suffix → partial.
 */
function resolveCcInput(raw, ccCards) {
  const name = normalizeInputName(raw);
  // Exact match
  if (ccCards[name]) return name;
  // Build lookup caches
  const keys = Object.keys(ccCards);
  const lowerMap = {};
  const fuzzyMap = {};
  for (const k of keys) {
    lowerMap[k.toLowerCase()] = k;
    fuzzyMap[fuzzyKey(k)] = k;
  }
  // Case-insensitive exact
  const lower = name.toLowerCase();
  if (lowerMap[lower]) return lowerMap[lower];
  // Fuzzy (strip apostrophes/special chars)
  const fk = fuzzyKey(name);
  if (fuzzyMap[fk]) return fuzzyMap[fk];
  // Punctuation suffix: "Get Behind Me" → "Get Behind Me!"
  if (lowerMap[lower + '!']) return lowerMap[lower + '!'];
  if (lowerMap[lower + '?']) return lowerMap[lower + '?'];
  // Partial match (e.g. shortened names)
  const partialMatch = keys.find((k) => k.toLowerCase().startsWith(lower));
  if (partialMatch) return partialMatch;
  return name; // unresolved — will produce error in validation
}

/**
 * Normalize a raw squad from user input: resolve DC and CC names to canonical forms.
 * Mutates dcList/ccList in place and returns the squad.
 */
export function normalizeSquadInput(squad) {
  const dcEffects = getDcEffects();
  const ccCards = getCcEffectsData()?.cards || {};
  if (squad?.dcList) {
    squad.dcList = squad.dcList.map((raw) => resolveDcInput(raw, dcEffects));
    squad.dcCount = squad.dcList.length;
  }
  if (squad?.ccList) {
    squad.ccList = squad.ccList.map((raw) => resolveCcInput(raw, ccCards));
    squad.ccCount = squad.ccList.length;
  }
  return squad;
}

/**
 * Validate squad for legal build: DC total cost === 40, CC exactly 15 cards and total cost === 15.
 * @param {{ dcList: string[], ccList: string[] }} squad
 * @returns {{ legal: boolean, errors: string[], dcTotal: number, ccCount: number, ccCost: number }}
 */
export function validateDeckLegal(squad) {
  const errors = [];
  let dcTotal = 0;
  const dcList = squad?.dcList || [];
  const dcEffects = getDcEffects();
  for (const entry of dcList) {
    const name = resolveDcName(entry);
    // Bracket fallback: "Black Market" → "[Black Market]" for attachment/upgrade cards
    const stats = dcEffects[name] || (!name.startsWith('[') ? dcEffects[`[${name}]`] : null);
    const cost = stats?.cost;
    if (cost == null) {
      errors.push(`Unknown Deployment Card: "${name}" (cost not found).`);
    } else {
      dcTotal += cost;
    }
  }
  if (dcTotal !== DC_POINTS_LEGAL) {
    errors.push(`Deployment total is ${dcTotal} points. Legal total is exactly ${DC_POINTS_LEGAL}.`);
  }
  // Nemik's Manifesto: "Your command deck may include up to 3 additional Command cards."
  const hasNemiksManifesto = dcList.some((entry) => {
    const n = resolveDcName(entry);
    return n === "[Nemik's Manifesto]" || n === "Nemik's Manifesto";
  });
  const ccCardsLegal = hasNemiksManifesto ? CC_CARDS_LEGAL + 3 : CC_CARDS_LEGAL;
  const ccList = squad?.ccList || [];
  let ccCost = 0;
  const unknownCc = [];
  for (const name of ccList) {
    // Punctuation fallback: "Get Behind Me" → "Get Behind Me!" for cards with trailing punctuation in data
    const effect = getCcEffect(name) || getCcEffect(name + '!');
    if (!effect) {
      unknownCc.push(name);
    } else {
      ccCost += (effect.cost ?? 0);
    }
  }
  if (unknownCc.length) {
    errors.push(`Unknown Command Card(s): ${unknownCc.slice(0, 5).join(', ')}${unknownCc.length > 5 ? '…' : ''}.`);
  }
  if (ccList.length !== ccCardsLegal) {
    errors.push(`Command deck has ${ccList.length} cards. Legal deck is exactly ${ccCardsLegal} cards${hasNemiksManifesto ? ' (Nemik\'s Manifesto: +3)' : ''}.`);
  }
  if (ccCost !== CC_COST_LEGAL) {
    errors.push(`Command deck total cost is ${ccCost}. Legal total cost is exactly ${CC_COST_LEGAL}.`);
  }
  return {
    legal: errors.length === 0,
    errors,
    dcTotal,
    ccCount: ccList.length,
    ccCost,
  };
}
