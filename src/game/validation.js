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
  // Bare name without (Regular)/(Elite): defaults to Regular (Elite must be specified explicitly)
  const regMatch = keys.find((k) => k.toLowerCase() === `${lower} (regular)`);
  if (regMatch) return regMatch;
  const eliteMatch = keys.find((k) => k.toLowerCase() === `${lower} (elite)`);
  if (eliteMatch) return eliteMatch;
  // Partial parenthetical: "Luke Skywalker (Jedi)" matches "Luke Skywalker (Jedi Knight)"
  // Only applies when input already contains a '(' — bare names are handled above
  if (lower.includes('(')) {
    const lowerPrefix = lower.endsWith(')') ? lower.slice(0, -1) : lower;
    const match = keys.find((k) => k.toLowerCase().startsWith(lowerPrefix) && k.includes('('));
    if (match) return match;
  }
  // Quoted subname: 'C1-10P' matches 'C1-10P "Chopper"', 'IG-88' matches 'IG-88 "The Droid With No Name"'
  const quotedMatch = keys.find((k) => k.toLowerCase().startsWith(lower + ' "'));
  if (quotedMatch) return quotedMatch;
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
  const autoRegularWarnings = [];
  if (squad?.dcList) {
    squad.dcList = squad.dcList.map((raw) => {
      const resolved = resolveDcInput(raw, dcEffects);
      // Detect when a bare name defaulted to Regular and Elite also exists
      const inputNorm = normalizeInputName(raw);
      if (resolved !== inputNorm && resolved.endsWith('(Regular)') && dcEffects[resolved.replace('(Regular)', '(Elite)').trim()]) {
        const baseName = resolved.replace(/\s*\(Regular\)\s*$/, '');
        const regCost = dcEffects[resolved]?.cost;
        const eliteCost = dcEffects[resolved.replace('(Regular)', '(Elite)').trim()]?.cost;
        autoRegularWarnings.push(`"${baseName}" defaulted to Regular (${regCost} pts). Use "${baseName} [E]" for Elite (${eliteCost} pts).`);
      }
      return resolved;
    });
    squad.dcCount = squad.dcList.length;
  }
  if (squad?.ccList) {
    squad.ccList = squad.ccList.map((raw) => resolveCcInput(raw, ccCards));
    squad.ccCount = squad.ccList.length;
  }
  squad._autoRegularWarnings = autoRegularWarnings;
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
  const dcNameCounts = {};
  for (const entry of dcList) {
    const name = resolveDcName(entry);
    dcNameCounts[name] = (dcNameCounts[name] || 0) + 1;
    // Bracket fallback: "Black Market" → "[Black Market]" for attachment/upgrade cards
    // Regular/Elite fallback: "Imperial Officer" → "Imperial Officer (Regular)" or "(Elite)"
    const stats = dcEffects[name]
      || (!name.startsWith('[') ? dcEffects[`[${name}]`] : null)
      || dcEffects[`${name} (Regular)`]
      || dcEffects[`${name} (Elite)`];
    const cost = stats?.cost;
    if (cost == null) {
      errors.push(`Unknown Deployment Card: "${name}" (cost not found).`);
    } else {
      dcTotal += cost;
      // Unique card duplicate check
      if (stats.unique && dcNameCounts[name] > 1) {
        errors.push(`"${name}" is a Unique deployment card and cannot be included more than once.`);
      }
    }
  }
  if (dcTotal !== DC_POINTS_LEGAL) {
    errors.push(`Deployment total is ${dcTotal} points. Legal total is exactly ${DC_POINTS_LEGAL}.`);
  }
  // Surface auto-Regular warnings from normalizeSquadInput so user knows to use [E] for Elite
  if (squad._autoRegularWarnings?.length) {
    errors.push(...squad._autoRegularWarnings);
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
  // ── Attachment target validation ──
  const attachmentWarnings = validateAttachmentTargets(dcList);
  errors.push(...attachmentWarnings);

  return {
    legal: errors.length === 0,
    errors,
    dcTotal,
    ccCount: ccList.length,
    ccCost,
  };
}

// ── Attachment target validation helpers ──

const ATTACHMENT_RESTRICTION_KEYWORDS = ['LEADER', 'HUNTER', 'DROID', 'CREATURE', 'TROOPER', 'VEHICLE',
  'SMUGGLER', 'WOOKIEE', 'WOOKIE', 'FORCE USER', 'HEAVY WEAPON', 'UNIQUE FIGURE',
  'NON-UNIQUE', 'NON-MASSIVE', 'BRAWLER', 'SPY', 'GUARDIAN', 'IMPERIAL', 'REBEL',
  'SCUM', 'FIGURE WITH', 'FIGURE COST', 'GROUP WITH', 'MASSIVE'];

/** Check if a DC's keywords + affiliation satisfy a keyword phrase like "IMPERIAL TROOPER" or "HUNTER". */
function _matchesKeywordPhrase(phrase, dcKw, affiliation) {
  const words = phrase.split(/\s+/).filter(Boolean);
  return words.every(w => dcKw.includes(w) || affiliation === w);
}

/**
 * Parse the "X ONLY" restriction from an attachment card's abilityText.
 * Returns { restrictionText, filter: (dcName, dcEffects) => bool } or null if no restriction.
 */
function parseAttachmentRestriction(cardName, dcEffects) {
  const card = dcEffects[cardName] || dcEffects[`[${cardName}]`];
  if (!card?.abilityText || !card.attachment) return null;
  const firstLine = card.abilityText.split('\n')[0].trim();
  const onlyMatch = firstLine.match(/^(.+?)\s+ONLY$/i);
  if (!onlyMatch) return null;
  const restrictionRaw = onlyMatch[1].replace(/"/g, '').trim();

  // Split into OR-alternatives. "4 OR MORE" is a phrase, not an alternative split.
  const normalized = restrictionRaw.replace(/(\d+)\s+OR\s+MORE/gi, '$1_OR_MORE');
  const orParts = normalized.split(/\s+OR\s+/i).map(s => s.trim()).filter(Boolean);
  const alternatives = [];
  for (const part of orParts) {
    if (part.includes(',') && !part.includes('NON-')) {
      const subs = part.split(/,\s*/).map(s => s.trim()).filter(Boolean);
      alternatives.push(...subs);
    } else {
      alternatives.push(part.replace(/_OR_MORE/g, ' OR MORE'));
    }
  }

  return {
    restrictionText: restrictionRaw,
    filter: (dcName) => {
      const dcStats = dcEffects[dcName];
      if (!dcStats) return false;
      const dcKw = (dcStats.keywords || []).map(k => String(k).toUpperCase());
      const dcNameUpper = (dcName || '').toUpperCase();
      const isUnique = !!dcStats.unique;
      const figureCost = dcStats.cost ?? 0;
      const figures = dcStats.figures ?? 1;
      const affiliation = (dcStats.affiliation || '').toUpperCase();

      return alternatives.some(alt => {
        const altUpper = alt.toUpperCase().replace(/\([^)]*\)/g, '').trim();

        // Handle NON- prefix conditions (conjunctive — all must be met)
        if (altUpper.includes('NON-')) {
          if (altUpper.includes('NON-MASSIVE') && dcKw.includes('MASSIVE')) return false;
          if (altUpper.includes('NON-UNIQUE') && isUnique) return false;
          const remaining = altUpper.replace(/NON-MASSIVE/g, '').replace(/NON-UNIQUE/g, '').replace(/,/g, '').trim();
          if (remaining && !_matchesKeywordPhrase(remaining, dcKw, affiliation)) return false;
          return true;
        }
        // "UNIQUE FIGURE" check (optionally "WITH FIGURE COST N OR MORE")
        if (altUpper.includes('UNIQUE FIGURE')) {
          if (!isUnique) return false;
          const costMatch = altUpper.match(/FIGURE COST (\d+) OR MORE/);
          if (costMatch && figureCost < parseInt(costMatch[1], 10)) return false;
          return true;
        }
        // "GROUP WITH N FIGURES" check
        const groupMatch = altUpper.match(/(.+?)\s+GROUP WITH (\d+) FIGURES/);
        if (groupMatch) {
          const kwPart = groupMatch[1].trim();
          const reqFigs = parseInt(groupMatch[2], 10);
          if (figures !== reqFigs) return false;
          if (!_matchesKeywordPhrase(kwPart, dcKw, affiliation)) return false;
          return true;
        }
        // Simple keyword match
        if (ATTACHMENT_RESTRICTION_KEYWORDS.some(k => altUpper.includes(k))) {
          return _matchesKeywordPhrase(altUpper, dcKw, affiliation);
        }
        // Name-based match (e.g. "DARTH VADER", "LUKE SKYWALKER", "MAUL", "AT-ST")
        if (dcNameUpper.includes(altUpper) || altUpper.includes(dcNameUpper.replace(/\s*\(.*\)$/, ''))) return true;
        return false;
      });
    },
  };
}

/**
 * Validate that each attachment card in the army has at least one valid non-attachment target.
 * @param {string[]} dcList
 * @returns {string[]} array of error messages for attachments with no valid targets
 */
function validateAttachmentTargets(dcList) {
  const warnings = [];
  const dcEffects = getDcEffects();

  // Resolve each DC name to its canonical key in dcEffects (reuse resolveDcInput for fuzzy matching)
  const resolvedNames = dcList.map(entry => {
    const name = resolveDcName(entry);
    return resolveDcInput(name, dcEffects);
  });

  // Separate attachment and non-attachment DCs
  const nonAttachmentNames = resolvedNames.filter(name => {
    const stats = dcEffects[name];
    return stats && !stats.attachment;
  });

  for (const name of resolvedNames) {
    const stats = dcEffects[name];
    if (!stats?.attachment) continue;

    const restriction = parseAttachmentRestriction(name, dcEffects);
    if (!restriction) continue; // No "X ONLY" restriction line — skip

    const hasValidTarget = nonAttachmentNames.some(targetName => restriction.filter(targetName));
    if (!hasValidTarget) {
      // Use display name without brackets for readability
      const displayName = name.startsWith('[') && name.endsWith(']') ? name.slice(1, -1) : name;
      warnings.push(`"${displayName}" requires a ${restriction.restrictionText} figure, but none found in army.`);
    }
  }

  return warnings;
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
    const stats = dcEffects[name] || (!name.startsWith('[') ? dcEffects[`[${name}]`] : null)
      || dcEffects[`${name} (Regular)`] || dcEffects[`${name} (Elite)`];
    const resolvedName = stats ? (Object.keys(dcEffects).find((k) => dcEffects[k] === stats) || name) : name;
    const affiliation = stats?.affiliation || 'Any';
    const keywords = dcKeywords[resolvedName] || dcKeywords[name] || dcKeywords[`[${name}]`] || stats?.keywords || [];
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
