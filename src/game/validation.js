/**
 * Game validation (deck legal, etc.). No Discord; uses data-loader for card data.
 */
import { getDcEffects, getDcKeywords, getCcEffect, getCcEffectsData } from '../data-loader.js';

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

/**
 * Validate army affiliation consistency.
 * Determines the primary affiliation from non-"Any" DCs and warns about mismatches,
 * accounting for special DC abilities that allow cross-faction inclusions.
 *
 * @param {{ dcList: string[] }} squad
 * @returns {{ warnings: string[], primaryAffiliation: string|null }}
 */
export function validateArmyAffiliation(squad) {
  const warnings = [];
  const dcList = squad?.dcList || [];
  if (!dcList.length) return { warnings, primaryAffiliation: null };

  const dcEffects = getDcEffects();
  const dcKeywords = getDcKeywords();

  // ── Resolve each DC to its canonical name, affiliation, and keywords ──
  const resolved = dcList.map((entry) => {
    const name = resolveDcName(entry);
    const stats = dcEffects[name] || (!name.startsWith('[') ? dcEffects[`[${name}]`] : null);
    const affiliation = stats?.affiliation || 'Any';
    const keywords = dcKeywords[name] || dcKeywords[`[${name}]`] || stats?.keywords || [];
    const isAttachment = stats?.attachment === true;
    return { name, affiliation, keywords, isAttachment };
  });

  // ── Determine primary affiliation (most common non-"Any" affiliation) ──
  const affCounts = {};
  for (const dc of resolved) {
    if (dc.affiliation !== 'Any') {
      affCounts[dc.affiliation] = (affCounts[dc.affiliation] || 0) + 1;
    }
  }
  const sorted = Object.entries(affCounts).sort((a, b) => b[1] - a[1]);
  const primaryAffiliation = sorted.length ? sorted[0][0] : null;
  if (!primaryAffiliation) return { warnings, primaryAffiliation: null };

  // ── Detect special DC abilities in the army ──
  const nameSet = new Set(resolved.map((d) => d.name));

  const hasBibFortuna = nameSet.has('Bib Fortuna');
  const hasSaskaTeft = nameSet.has('Saska Teft');
  const hasDoctorAphra = nameSet.has('Doctor Aphra') || nameSet.has('Dr. Aphra');
  const hasEliteJawaScavenger = nameSet.has('Jawa Scavenger (Elite)');
  const hasHeavyStormtrooperElite = nameSet.has('Heavy Stormtrooper (Elite)');

  // ── Bib Fortuna — Dirty Dealing: army CANNOT include Rebel DCs ──
  if (hasBibFortuna) {
    const rebelDcs = resolved.filter((d) => d.affiliation === 'Rebel');
    if (rebelDcs.length) {
      warnings.push(
        `Bib Fortuna (Dirty Dealing): army cannot include Rebel DCs, but found: ${rebelDcs.map((d) => d.name).join(', ')}.`
      );
    }
  }

  // ── Heavy Stormtrooper (Elite) — Modular: note if attachment exists ──
  if (hasHeavyStormtrooperElite) {
    const attachments = resolved.filter((d) => d.isAttachment);
    if (attachments.length) {
      warnings.push(
        `Heavy Stormtrooper (Elite) (Modular): attachment "${attachments[0].name}" present — may include at -1 cost (cost validation unchanged).`
      );
    }
  }

  // ── Build set of DCs that are excused from affiliation warnings ──
  const excused = new Set();

  // Saska Teft — Shady Contacts: up to 1 non-upgrade Scum DC allowed
  if (hasSaskaTeft && primaryAffiliation !== 'Scum') {
    let scumExcusedCount = 0;
    for (const dc of resolved) {
      if (dc.affiliation === 'Scum' && dc.name !== 'Saska Teft' && !dc.isAttachment) {
        if (scumExcusedCount < 1) {
          excused.add(dc.name);
          scumExcusedCount++;
        }
      }
    }
    // Saska herself is Rebel, so she's fine in a Rebel army; excuse her from Scum checks
  }

  // Doctor Aphra — Dubious Counterparts: Scum DROID DCs are allowed
  if (hasDoctorAphra) {
    for (const dc of resolved) {
      if (dc.affiliation === 'Scum' && dc.keywords.some((k) => String(k).toUpperCase() === 'DROID')) {
        excused.add(dc.name);
      }
    }
  }

  // Jawa Scavenger (Elite) — Scavenged Stock: up to 3 cross-affiliation DROID DCs allowed
  if (hasEliteJawaScavenger) {
    let droidExcusedCount = 0;
    for (const dc of resolved) {
      if (dc.affiliation !== primaryAffiliation && dc.affiliation !== 'Any' && !excused.has(dc.name)) {
        if (dc.keywords.some((k) => String(k).toUpperCase() === 'DROID')) {
          if (droidExcusedCount < 3) {
            excused.add(dc.name);
            droidExcusedCount++;
          }
        }
      }
    }
  }

  // ── Warn about any non-primary, non-"Any", non-excused DCs ──
  for (const dc of resolved) {
    if (dc.affiliation !== primaryAffiliation && dc.affiliation !== 'Any' && !excused.has(dc.name)) {
      warnings.push(
        `"${dc.name}" is ${dc.affiliation} but army primary affiliation is ${primaryAffiliation}.`
      );
    }
  }

  return { warnings, primaryAffiliation };
}
