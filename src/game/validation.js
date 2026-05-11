/**
 * Game validation (deck legal, etc.). No Discord; uses data-loader for card data.
 */
import { getDcEffects, getDcKeywords, getCcEffect, getCcEffectsData, getAbilityLibrary } from '../data-loader.js';
import { modularDiscountDelta, modularDiscountedAttachments } from './modular-hse-helpers.js';
import { scavengedStockExcusals, SCAVENGED_STOCK_JAWA_NAME } from './scavenged-stock-helpers.js';

/**
 * Check whether any DC in `armyDcNames` has a passive whose library entry
 * declares `extendsAttachmentEligibility` covering `cardName`. Used by the
 * attachment-restriction filter to let e.g. Bo-Katan's "Last Wielder of the
 * Darksaber" grant her the Darksaber even though she doesn't match the
 * attachment's "MAUL OR SABINE WREN ONLY" line.
 *
 * Returns the DC name that extends eligibility, or null if none.
 */
export function findEligibilityExtender(cardName, armyDcNames, dcEffects) {
  if (!cardName || !Array.isArray(armyDcNames) || armyDcNames.length === 0) return null;
  const lib = getAbilityLibrary()?.abilities || {};
  const needles = new Set([cardName, `[${cardName}]`, cardName.replace(/^\[|\]$/g, '')].filter(Boolean));
  for (const dcName of armyDcNames) {
    const stats = dcEffects[dcName];
    const slugs = stats?.specialAbilityIds || [];
    for (const slug of slugs) {
      const entry = lib[slug];
      const list = entry?.extendsAttachmentEligibility;
      if (!Array.isArray(list) || list.length === 0) continue;
      for (const allowed of list) {
        if (needles.has(allowed)) return dcName;
      }
    }
  }
  return null;
}

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
  // Strip leading cost number (e.g. "7 The Grand Inquisitor IACP" → "The Grand Inquisitor IACP", "-1 Scavenged Walker" → "Scavenged Walker")
  s = s.replace(/^-?\d+\s+/, '');
  // Strip trailing IACP (case-insensitive)
  s = s.replace(/\s+IACP\s*$/i, '').trim();
  // Convert [E] to (Elite), [R] to (Regular)
  s = s.replace(/\s*\[E\]\s*/gi, ' (Elite)').replace(/\s*\[R\]\s*/gi, ' (Regular)').trim();
  return s;
}

/** Normalize string for fuzzy comparison: lowercase, strip apostrophes/special chars, normalize hyphens to spaces. */
function fuzzyKey(s) {
  return s.toLowerCase().replace(/[''`]/g, '').replace(/-/g, ' ').replace(/\s+/g, ' ').trim();
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
  // Strip (Elite)/(Regular) suffix for skirmish upgrade bracket lookup
  // e.g. "Cross-Training (Elite)" → "[Cross-Training]", "Extra Armor (Elite)" → "[Extra Armor]"
  const strippedName = name.replace(/\s*\((Elite|Regular)\)\s*$/i, '').trim();
  if (strippedName !== name) {
    if (dcEffects[strippedName]) return strippedName;
    const strippedBracketed = `[${strippedName}]`;
    if (dcEffects[strippedBracketed]) return strippedBracketed;
  }
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
  // Case-insensitive with stripped suffix (handles "Dewback Rider (Elite)" → "Dewback Rider")
  const strippedLower = strippedName.toLowerCase();
  if (strippedName !== name) {
    if (lowerMap[strippedLower]) return lowerMap[strippedLower];
    if (lowerMap[`[${strippedLower}]`]) return lowerMap[`[${strippedLower}]`];
  }
  // Fuzzy (strip apostrophes)
  const fk = fuzzyKey(name);
  if (fuzzyMap[fk]) return fuzzyMap[fk];
  if (fuzzyMap[fuzzyKey(bracketed)]) return fuzzyMap[fuzzyKey(bracketed)];
  // Fuzzy with stripped suffix + bracket (handles hyphens: "cross-training" → "cross training")
  if (strippedName !== name) {
    const strippedFk = fuzzyKey(strippedName);
    if (fuzzyMap[strippedFk]) return fuzzyMap[strippedFk];
    if (fuzzyMap[fuzzyKey(`[${strippedName}]`)]) return fuzzyMap[fuzzyKey(`[${strippedName}]`)];
  }
  // Bare name without (Regular)/(Elite): prefer non-hidden variant; skip hidden cards
  const regMatch = keys.find((k) => k.toLowerCase() === `${lower} (regular)`);
  const eliteMatch = keys.find((k) => k.toLowerCase() === `${lower} (elite)`);
  // If Regular is hidden, skip to Elite (and vice versa)
  if (regMatch && !dcEffects[regMatch]?.hidden) return regMatch;
  if (eliteMatch && !dcEffects[eliteMatch]?.hidden) return eliteMatch;
  // Fall through to hidden if it's the only option
  if (regMatch) return regMatch;
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
  // Abbreviated name with (Elite)/(Regular): "KX (Elite)" → "KX-Series Security Droid (Elite)"
  // Extract base name (before parenthetical) and match any key containing it with same suffix
  const parenIdx = lower.indexOf('(');
  if (parenIdx > 0) {
    const baseName = lower.slice(0, parenIdx).trim();
    const suffix = lower.slice(parenIdx).trim();
    if (baseName.length >= 2) {
      const abbrMatch = keys.find((k) => {
        const kl = k.toLowerCase();
        return kl.includes(baseName) && kl.endsWith(suffix);
      });
      if (abbrMatch) return abbrMatch;
    }
  }
  // Hyphen/space normalization: "Cross-Training" → "Cross Training" (and vice versa)
  const dehyphenated = lower.replace(/-/g, ' ');
  if (dehyphenated !== lower) {
    if (lowerMap[dehyphenated]) return lowerMap[dehyphenated];
    if (lowerMap[`[${dehyphenated}]`]) return lowerMap[`[${dehyphenated}]`];
  }
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
  // Resolve unclassified vsav piece entries (new IACP image format) into DC or CC lists
  if (squad?.unclassified?.length) {
    for (const name of squad.unclassified) {
      const resolved = resolveDcInput(name, dcEffects);
      const dcStats = dcEffects[resolved] || dcEffects[`[${resolved}]`]
        || dcEffects[resolved + ' (Regular)'] || dcEffects[resolved + ' (Elite)'];
      if (dcStats) {
        squad.dcList.push(name);
      } else {
        // Try CC lookup
        const ccResolved = resolveCcInput(name, ccCards);
        if (ccCards[ccResolved] || ccCards[ccResolved + '!'] || ccCards[ccResolved + '?']) {
          squad.ccList.push(name);
        } else {
          // Unknown — add to DC list so validation surfaces the error
          squad.dcList.push(name);
        }
      }
    }
    delete squad.unclassified;
  }
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
  // Heavy Stormtrooper (Elite) — Modular: one attachment costs 1 less
  dcTotal -= modularDiscountDelta(dcList, dcEffects);
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
  // ── Attachment target validation ──
  // Returns { errors, warnings }: errors are hard legality violations (an
  // attachment whose restriction is unsatisfiable in this army); warnings are
  // advisory (an attachment that is legal only because of an eligibility-
  // extending passive like Bo-Katan's "Last Wielder of the Darksaber").
  const attachment = validateAttachmentTargets(dcList);
  errors.push(...attachment.errors);
  const warnings = [...attachment.warnings];

  return {
    legal: errors.length === 0,
    errors,
    warnings,
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
export function _matchesKeywordPhrase(phrase, dcKw, affiliation) {
  const words = phrase.split(/\s+/).filter(Boolean);
  return words.every(w => dcKw.includes(w) || affiliation === w);
}

/**
 * Parse the "X ONLY" restriction from an attachment card's abilityText.
 * Returns { restrictionText, filter: (dcName, dcEffects) => bool } or null if no restriction.
 *
 * `armyDcNames` (optional) is the full army DC list. When provided, the filter
 * also returns true for any DC that extends eligibility via a library entry
 * flagged with `extendsAttachmentEligibility` (e.g. Bo-Katan's "Last Wielder
 * of the Darksaber" grants Darksaber eligibility to her group).
 */
function parseAttachmentRestriction(cardName, dcEffects, armyDcNames = null) {
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

  // Pre-compute the eligibility-extender (if any DC in the army has a passive
  // that names this attachment via `extendsAttachmentEligibility`).
  const extenderDcName = armyDcNames
    ? findEligibilityExtender(cardName.replace(/^\[|\]$/g, ''), armyDcNames, dcEffects)
    : null;

  return {
    restrictionText: restrictionRaw,
    extenderDcName,
    filter: (dcName) => {
      // Eligibility extension short-circuit: if this DC's passive grants access
      // (e.g. Bo-Katan + Darksaber), bypass the printed "X ONLY" restriction.
      if (extenderDcName && dcName === extenderDcName) return true;

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
          let remaining = altUpper.replace(/NON-MASSIVE/g, '').replace(/NON-UNIQUE/g, '').replace(/,/g, '').trim();
          if (remaining) {
            // Extract "GROUP WITH N FIGURES" suffix before keyword matching
            const grpMatch = remaining.match(/^(.+?)\s+GROUP\s+WITH\s+(\d+)\s+FIGURES?$/);
            if (grpMatch) {
              const reqFigs = parseInt(grpMatch[2], 10);
              if (figures !== reqFigs) return false;
              remaining = grpMatch[1].trim();
            }
            if (remaining && !_matchesKeywordPhrase(remaining, dcKw, affiliation)) return false;
          }
          return true;
        }
        // "UNIQUE ..." check (e.g. "UNIQUE FIGURE", "UNIQUE GUARDIAN", "UNIQUE FIGURE WITH FIGURE COST N OR MORE")
        if (altUpper.startsWith('UNIQUE ')) {
          if (!isUnique) return false;
          if (altUpper === 'UNIQUE FIGURE') return true;
          const costMatch = altUpper.match(/FIGURE COST (\d+) OR MORE/);
          if (costMatch && figureCost < parseInt(costMatch[1], 10)) return false;
          if (altUpper.includes('UNIQUE FIGURE')) return true;
          // "UNIQUE GUARDIAN", "UNIQUE TROOPER", etc. — check keyword after UNIQUE
          const kwPart = altUpper.replace(/^UNIQUE\s+/, '').trim();
          if (kwPart && !_matchesKeywordPhrase(kwPart, dcKw, affiliation)) return false;
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
        // Name-based match first (e.g. "DARTH VADER", "SHORETROOPER", "AT-ST")
        // Checked before keyword match so names containing keywords (e.g. "SHORETROOPER" contains "TROOPER") resolve correctly.
        if (dcNameUpper.includes(altUpper) || altUpper.includes(dcNameUpper.replace(/\s*\(.*\)$/, ''))) return true;
        // Simple keyword match
        if (ATTACHMENT_RESTRICTION_KEYWORDS.some(k => altUpper.includes(k))) {
          return _matchesKeywordPhrase(altUpper, dcKw, affiliation);
        }
        return false;
      });
    },
  };
}

/**
 * Validate that each attachment card in the army has at least one valid
 * non-attachment target. Returns two lists:
 *   - errors:   attachments whose restriction cannot be satisfied by any DC
 *               in the army (hard legality violation).
 *   - warnings: attachments that are legal only because of an
 *               eligibility-extending passive (e.g. Bo-Katan's "Last Wielder
 *               of the Darksaber" grants Darksaber access to her group).
 *               The deck is legal; the note just makes the non-obvious
 *               dependency visible in the UI.
 * @param {string[]} dcList
 * @returns {{ errors: string[], warnings: string[] }}
 */
function validateAttachmentTargets(dcList) {
  const errors = [];
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

    const restriction = parseAttachmentRestriction(name, dcEffects, nonAttachmentNames);
    if (!restriction) continue; // No "X ONLY" restriction line — skip

    const hasValidTarget = nonAttachmentNames.some(targetName => restriction.filter(targetName));
    const displayName = name.startsWith('[') && name.endsWith(']') ? name.slice(1, -1) : name;
    if (!hasValidTarget) {
      errors.push(`"${displayName}" requires a ${restriction.restrictionText} figure, but none found in army.`);
      continue;
    }
    // If the only way this attachment is legal is via an eligibility-extending
    // passive, surface a soft warning so the player sees the dependency.
    if (restriction.extenderDcName) {
      const printedOk = nonAttachmentNames.some(n => n !== restriction.extenderDcName && restriction.filter(n));
      if (!printedOk) {
        warnings.push(`"${displayName}" is legal only because **${restriction.extenderDcName}** extends its eligibility. Printed restriction: ${restriction.restrictionText}.`);
      }
    }
  }

  return { errors, warnings };
}

// ── Unique upgrade warnings (test cases R5, R11, R41, I2, M3) ──

/**
 * Figure-to-upgrade mapping for figures that are typically expected to bring
 * their unique skirmish upgrade. Deploying without the upgrade is legal but
 * unusual, so we surface warnings (not errors).
 *
 * Keys are canonical DC figure names; values are { upgrade, label } where
 * `upgrade` is the bracketed dc-effects key and `label` is a human-readable
 * upgrade name.
 */
const EXPECTED_UPGRADES = [
  { figure: 'Chewbacca',                  upgrade: '[Wookiee Avenger]',     label: 'Wookiee Avenger' },      // R5
  { figure: 'Han Solo',                   upgrade: '[Rogue Smuggler]',      label: 'Rogue Smuggler' },       // R11
  { figure: 'Luke Skywalker',             upgrade: '[Heir to the Jedi]',    label: 'Heir to the Jedi' },     // R41
  { figure: 'Darth Vader',                upgrade: '[Driven by Hatred]',    label: 'Driven by Hatred' },     // I2
  { figure: 'IG-88',                      upgrade: '[Focused on the Kill]', label: 'Focused on the Kill' },  // M3
];

/**
 * Check whether figures with strongly-expected unique upgrades are deployed
 * without those upgrades. Returns an array of warning strings (empty if all
 * expected upgrades are present or the figures are absent).
 *
 * @param {{ dcList: string[] }} squad
 * @returns {string[]} warning messages
 */
export function validateUpgradeWarnings(squad) {
  const warnings = [];
  const dcList = squad?.dcList || [];
  if (!dcList.length) return warnings;

  const dcEffects = getDcEffects();

  // Resolve each DC entry to its canonical name
  const resolvedNames = dcList.map((entry) => {
    const name = resolveDcName(entry);
    return resolveDcInput(name, dcEffects);
  });

  const nameSet = new Set(resolvedNames);

  for (const { figure, upgrade, label } of EXPECTED_UPGRADES) {
    // Check if the figure is in the army
    if (!nameSet.has(figure)) continue;
    // Check if the upgrade is in the army
    if (nameSet.has(upgrade)) continue;
    warnings.push(`"${figure}" is deployed without "${label}". This is legal but uncommon — did you forget to include it?`);
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
    const cost = stats?.cost ?? 0;
    return { name, affiliation, keywords, isAttachment, cost };
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
  const hasEliteJawaScavenger = nameSet.has(SCAVENGED_STOCK_JAWA_NAME);
  const hasHeavyStormtrooperElite = nameSet.has('Heavy Stormtrooper (Elite)');
  // Temporary Alliance: auto-resolve unqualified "[Temporary Alliance]" based on primary affiliation
  const hasUnqualifiedTA = nameSet.has('[Temporary Alliance]') || nameSet.has('Temporary Alliance');
  const hasExplicitTAE = nameSet.has('[Temporary Alliance (E)]') || nameSet.has('Temporary Alliance (E)');
  const hasExplicitTAM = nameSet.has('[Temporary Alliance (M)]') || nameSet.has('Temporary Alliance (M)');
  let hasTempAllianceImperial = hasExplicitTAE;
  let hasTempAllianceScum = hasExplicitTAM;
  if (hasUnqualifiedTA && !hasExplicitTAE && !hasExplicitTAM) {
    // Auto-detect: Imperial armies get TA(E), Scum armies get TA(M)
    if (primaryAffiliation === 'Imperial') {
      hasTempAllianceImperial = true;
      warnings.push('Temporary Alliance detected in Imperial army → resolved as TA (Imperial): allows up to 2 Scum DCs.');
    } else if (primaryAffiliation === 'Scum') {
      hasTempAllianceScum = true;
      warnings.push('Temporary Alliance detected in Scum army → resolved as TA (Mercenary): allows up to 2 Rebel DCs.');
    } else {
      warnings.push('Temporary Alliance detected but army affiliation is ambiguous. Specify "[Temporary Alliance (E)]" or "[Temporary Alliance (M)]" for correct validation.');
    }
  }

  // ── Bib Fortuna — Dirty Dealing: army CANNOT include Rebel DCs ──
  if (hasBibFortuna) {
    const rebelDcs = resolved.filter((d) => d.affiliation === 'Rebel');
    if (rebelDcs.length) {
      warnings.push(
        `Bib Fortuna (Dirty Dealing): army cannot include Rebel DCs, but found: ${rebelDcs.map((d) => d.name).join(', ')}.`
      );
    }
  }

  // ── Heavy Stormtrooper (Elite) — Modular: note attachment discount ──
  // Per alexanbv 2026-05-10: one discount per HSE group, applied to one
  // legal-for-HSE attachment each. Must-attach enforcement is player-side.
  if (hasHeavyStormtrooperElite) {
    const discounted = modularDiscountedAttachments(dcList, dcEffects);
    for (const attName of discounted) {
      const stripped = String(attName).replace(/^\[|\]$/g, '');
      const stats = dcEffects[attName] || dcEffects[`[${stripped}]`];
      const baseCost = stats?.cost ?? '?';
      const newCost = typeof baseCost === 'number' ? Math.max(0, baseCost - 1) : '?';
      warnings.push(
        `Heavy Stormtrooper (Elite) — Modular: "${stripped}" included at -1 cost discount (${baseCost} → ${newCost} points).`
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
    for (const name of scavengedStockExcusals(resolved, primaryAffiliation, excused)) {
      excused.add(name);
    }
  }

  // Temporary Alliance (Imperial) — up to 2 Scum DCs allowed
  if (hasTempAllianceImperial && primaryAffiliation !== 'Scum') {
    let taScumCount = 0;
    for (const dc of resolved) {
      if (dc.affiliation === 'Scum' && !excused.has(dc.name) && !dc.isAttachment) {
        if (taScumCount < 2) {
          excused.add(dc.name);
          taScumCount++;
        }
      }
    }
  }

  // Temporary Alliance (Mercenary) — up to 2 Rebel DCs allowed
  if (hasTempAllianceScum && primaryAffiliation !== 'Rebel') {
    let taRebelCount = 0;
    for (const dc of resolved) {
      if (dc.affiliation === 'Rebel' && !excused.has(dc.name) && !dc.isAttachment) {
        if (taRebelCount < 2) {
          excused.add(dc.name);
          taRebelCount++;
        }
      }
    }
  }

  // Temporary Alliance cards themselves should be excused from affiliation warnings
  if (hasTempAllianceImperial || hasUnqualifiedTA) excused.add('[Temporary Alliance]');
  if (hasTempAllianceScum) excused.add('[Temporary Alliance (M)]');
  excused.add('Temporary Alliance');
  excused.add('[Temporary Alliance (E)]');
  excused.add('Temporary Alliance (E)');
  excused.add('Temporary Alliance (M)');

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
