/**
 * Scenario Templates for targeted CC coverage testing.
 *
 * Each builder returns a config object suitable for createFlowHarness().
 * Scenarios position figures and advance game state to the right phase
 * for a specific CC timing window.
 */

import { getDcEffects, getDcStats, getCcEffectsData } from '../../src/data-loader.js';

/**
 * Build a melee combat scenario with two figures placed adjacent.
 * Useful for CCs with timing: duringAttack, afterAttackDice, beforeYouDeclareAttack, etc.
 */
export function buildMeleeCombatScenario(attackerDc, defenderDc, ccsInHand = []) {
  return {
    mapId: 'mos-eisley-outskirts',
    p1Army: [{ dcName: attackerDc }],
    p2Army: [{ dcName: defenderDc }],
    p1CcHand: ccsInHand,
    p2CcHand: [],
    diceOverrides: {
      attackRolls: [{ damage: 3, surge: 1, range: 2, miss: false }],
      defenseRolls: [{ block: 1, evade: 0 }],
    },
  };
}

/**
 * Build a ranged combat scenario with figures at specified range.
 * Useful for ranged-only CCs.
 */
export function buildRangedCombatScenario(attackerDc, defenderDc, range = 4, ccsInHand = []) {
  return {
    mapId: 'mos-eisley-outskirts',
    p1Army: [{ dcName: attackerDc }],
    p2Army: [{ dcName: defenderDc }],
    p1CcHand: ccsInHand,
    p2CcHand: [],
    diceOverrides: {
      attackRolls: [{ damage: 2, surge: 1, range: range + 2, miss: false }],
      defenseRolls: [{ block: 0, evade: 0 }],
    },
  };
}

/**
 * Build an activation scenario — game at start of activation for a DC.
 * Useful for CCs with timing: duringActivation, afterSpecialOrInteract, etc.
 */
export function buildActivationScenario(dc, ccsInHand = []) {
  return {
    mapId: 'mos-eisley-outskirts',
    p1Army: [{ dcName: dc }],
    p2Army: [{ dcName: 'Stormtrooper (Elite)' }],
    p1CcHand: ccsInHand,
    p2CcHand: [],
  };
}

/**
 * Build an end-of-round scenario — game advanced to EoR phase.
 * Useful for CCs with timing: endOfRound.
 */
export function buildEndOfRoundScenario(ccsInHand = []) {
  return {
    mapId: 'mos-eisley-outskirts',
    p1Army: [{ dcName: 'Luke Skywalker' }],
    p2Army: [{ dcName: 'Darth Vader' }],
    p1CcHand: ccsInHand,
    p2CcHand: [],
  };
}

/**
 * Build a start-of-round scenario — game at SoR phase.
 * Useful for CCs with timing: startOfRound.
 */
export function buildStartOfRoundScenario(ccsInHand = []) {
  return {
    mapId: 'mos-eisley-outskirts',
    p1Army: [{ dcName: 'Luke Skywalker' }],
    p2Army: [{ dcName: 'Darth Vader' }],
    p1CcHand: ccsInHand,
    p2CcHand: [],
  };
}

/**
 * Map CC timing to the appropriate scenario builder.
 */
const TIMING_TO_BUILDER = {
  startOfRound: 'sor',
  endOfRound: 'eor',
  duringActivation: 'activation',
  afterSpecialOrInteract: 'activation',
  beforeYouDeclareAttack: 'combat',
  duringAttack: 'combat',
  afterAttackDice: 'combat',
  afterDefenseDice: 'combat',
  afterAttackResolves: 'combat',
  whenAttackDeclaredOnYou: 'combat',
  whenDefending: 'combat',
  whenAttacking: 'combat',
  whenYouDefeat: 'combat',
  whenDefeated: 'combat',
};

// Hardcoded fallbacks for playableBy patterns that don't match keywords
const PLAYABLE_BY_FALLBACKS = {
  'K-2SO': 'K-2SO',
  'C-3PO': 'C-3PO',
  'Saw Gerrera': 'Saw Gerrera',
  'Zeb Orellios': 'Zeb Orellios',
  'C1-10P': 'C1-10P',
  'Cara Dune': 'Cara Dune',
  'Drokkatta': 'Drokkatta',
  'BT-1': 'BT-1',
};

// Faction keyword → affiliation value in dc-effects.json
const FACTION_MAP = {
  REBEL: 'Rebel',
  IMPERIAL: 'Imperial',
  SCUM: 'Scum',
};

/**
 * Pick a DC that matches the CC's playableBy requirement.
 * @param {string} playableBy - e.g. "REBEL FORCE USER", "HUNTER", "Luke Skywalker", "Any Figure"
 * @returns {string|null} DC name, or null if none found
 */
export function findMatchingDc(playableBy) {
  if (!playableBy) return 'Luke Skywalker';
  if (playableBy === 'Any Figure') return 'Luke Skywalker';

  const dcEffects = getDcEffects();

  // Try exact name match first (unique CCs like "Cara Dune")
  if (dcEffects[playableBy]) return playableBy;

  // Try hardcoded fallbacks
  if (PLAYABLE_BY_FALLBACKS[playableBy] && dcEffects[PLAYABLE_BY_FALLBACKS[playableBy]]) {
    return PLAYABLE_BY_FALLBACKS[playableBy];
  }

  // Handle "X or Y" patterns (e.g., '"Iden Versio" or "Dio"')
  const orMatch = playableBy.match(/"([^"]+)"\s+or\s+"([^"]+)"/);
  if (orMatch) {
    if (dcEffects[orMatch[1]]) return orMatch[1];
    if (dcEffects[orMatch[2]]) return orMatch[2];
  }

  // Handle "Any Unique Figure" or just "Unique"
  if (/unique/i.test(playableBy) && !/non.?unique/i.test(playableBy)) {
    for (const [dcName, dc] of Object.entries(dcEffects)) {
      if (dcName.startsWith('[')) continue;
      const stats = getDcStats(dcName);
      if (!stats || !stats.health || !stats.attack) continue;
      if (dc.unique) return dcName;
    }
  }

  // Handle "Any Small Figure" / "SMALL"
  if (/small/i.test(playableBy)) {
    for (const [dcName, dc] of Object.entries(dcEffects)) {
      if (dcName.startsWith('[')) continue;
      const stats = getDcStats(dcName);
      if (!stats || !stats.health || !stats.attack) continue;
      if (!stats.figures || stats.figures === 1) return dcName; // Single-figure = small
    }
  }

  // Handle "LARGE"
  if (/large/i.test(playableBy)) {
    for (const [dcName, dc] of Object.entries(dcEffects)) {
      if (dcName.startsWith('[')) continue;
      const stats = getDcStats(dcName);
      if (!stats || !stats.health || !stats.attack) continue;
      const keywords = (dc.keywords || []).map(k => k.toUpperCase());
      if (keywords.includes('MASSIVE') || keywords.includes('LARGE CREATURE')) return dcName;
    }
  }

  const keyword = playableBy.toUpperCase();

  // Handle faction-based playableBy (e.g., "REBEL", "IMPERIAL", "SCUM")
  for (const [factionKey, affiliationVal] of Object.entries(FACTION_MAP)) {
    if (keyword === factionKey || keyword.startsWith(factionKey + ' ')) {
      // Find a DC with this affiliation
      const remainingKeywords = keyword.replace(factionKey, '').trim();
      for (const [dcName, dc] of Object.entries(dcEffects)) {
        if (dcName.startsWith('[')) continue;
        const stats = getDcStats(dcName);
        if (!stats || !stats.health || !stats.attack) continue;
        if (dc.affiliation !== affiliationVal) continue;
        if (!remainingKeywords) return dcName; // Just faction match
        // Also check remaining keywords
        const dcKeywords = (dc.keywords || []).map(k => k.toUpperCase());
        if (dcKeywords.some(k => k.includes(remainingKeywords) || remainingKeywords.includes(k))) {
          return dcName;
        }
      }
      // Faction matched but no keyword match — return any DC of that faction
      for (const [dcName, dc] of Object.entries(dcEffects)) {
        if (dcName.startsWith('[')) continue;
        const stats = getDcStats(dcName);
        if (!stats || !stats.health || !stats.attack) continue;
        if (dc.affiliation === affiliationVal) return dcName;
      }
    }
  }

  // Try keyword match against dc keywords
  for (const [dcName, dc] of Object.entries(dcEffects)) {
    if (dcName.startsWith('[')) continue;
    const stats = getDcStats(dcName);
    if (!stats || !stats.health || !stats.attack) continue;
    const keywords = (dc.keywords || []).map(k => k.toUpperCase());
    // Check if any keyword matches
    if (keywords.some(k => keyword.includes(k) || k.includes(keyword))) {
      return dcName;
    }
    // Check all tokens match
    const tokens = keyword.split(/\s+/);
    if (tokens.every(t => keywords.some(k => k.includes(t)))) {
      return dcName;
    }
  }
  return null;
}

/**
 * Build a scenario config for a given CC.
 * @param {string} ccName
 * @param {object} ccData - The CC's data from cc-effects.json
 * @returns {{ ccName, scenarioType, config, timing }|null}
 */
export function buildScenarioForCc(ccName, ccData) {
  const timing = ccData.timing;
  const playableBy = ccData.playableBy;
  const scenarioType = TIMING_TO_BUILDER[timing] || 'activation';

  const dc = findMatchingDc(playableBy);
  if (!dc) return null;

  let config;
  switch (scenarioType) {
    case 'sor':
      config = buildStartOfRoundScenario([ccName]);
      config.p1Army = [{ dcName: dc }];
      break;
    case 'eor':
      config = buildEndOfRoundScenario([ccName]);
      config.p1Army = [{ dcName: dc }];
      break;
    case 'combat':
      config = buildMeleeCombatScenario(dc, 'Stormtrooper (Elite)', [ccName]);
      break;
    case 'activation':
    default:
      config = buildActivationScenario(dc, [ccName]);
      break;
  }

  return { ccName, scenarioType, config, timing, requiredDc: dc };
}
