/**
 * Game creation bridge functions extracted from index.js.
 * Each function takes an explicit `deps` parameter for closed-over dependencies.
 * Thin wrappers delegate to src/game-creation.js; pure-logic functions are inlined.
 */
import { readFileSync } from 'fs';
import { join } from 'path';

// ── Module-level cache for getDcByTrait ─────────────────────────────────────
let _dcByTraitCache = null;

// ── Pure-logic functions (inlined from index.js) ────────────────────────────

/** Pick a random scenario with status "testready" and implemented in runDraftRandom. Skips opponent-required scenarios when p2IsBot. */
export function getRandomTestreadyScenario(p2IsBot = true, deps) {
  try {
    const path = join(deps.rootDir, 'data', 'test-scenarios.json');
    const data = JSON.parse(readFileSync(path, 'utf8'));
    const scenarios = data.scenarios || {};
    const testready = Object.entries(scenarios).filter(
      ([id, s]) => s && s.status === 'testready' && deps.IMPLEMENTED_SCENARIOS.includes(id)
    ).filter(([id]) => {
      const v = validateTestreadyScenario(id, p2IsBot, deps);
      return v.valid;
    });
    if (testready.length === 0) return null;
    return testready[Math.floor(Math.random() * testready.length)][0];
  } catch {
    return null;
  }
}

/** Read primaryCard for a scenario from test-scenarios.json. Returns card name or null. */
export function getScenarioPrimaryCard(scenarioId, deps) {
  try {
    const path = join(deps.rootDir, 'data', 'test-scenarios.json');
    const data = JSON.parse(readFileSync(path, 'utf8'));
    const scenario = (data.scenarios || {})[scenarioId];
    return (scenario && scenario.primaryCard) || null;
  } catch {
    return null;
  }
}

/** Parse playableBy from cc-effects into traits (e.g. "TROOPER or TECHNICIAN" → ["trooper","technician"]). "Any Figure" → []. */
export function parsePlayableByToTraits(playableBy) {
  if (!playableBy || typeof playableBy !== 'string') return [];
  const s = playableBy.trim().toLowerCase();
  if (s === 'any figure') return [];
  return s.split(/\s+or\s+|\s+and\s+/i).map((t) => t.trim()).filter(Boolean);
}

/** Build DC_BY_TRAIT from dc-effects: affiliation → trait → [dcNames]. */
export function getDcByTrait(deps) {
  if (_dcByTraitCache) return _dcByTraitCache;
  const effects = deps.getDcEffects() || {};
  const byTrait = { rebel: {}, scum: {}, imperial: {} };
  for (const [dcName, card] of Object.entries(effects)) {
    if (!card || typeof card !== 'object') continue;
    const affil = (card.affiliation || '').toLowerCase();
    if (affil !== 'rebel' && affil !== 'scum' && affil !== 'imperial') continue;
    const keywords = card.keywords || [];
    for (const kw of keywords) {
      const t = String(kw).toLowerCase().trim();
      if (!t) continue;
      if (!byTrait[affil][t]) byTrait[affil][t] = [];
      byTrait[affil][t].push(dcName);
    }
    const nameKey = (dcName || '').toLowerCase().replace(/\s+/g, ' ').trim();
    if (nameKey && (!byTrait[affil][nameKey] || !byTrait[affil][nameKey].includes(dcName))) {
      if (!byTrait[affil][nameKey]) byTrait[affil][nameKey] = [];
      byTrait[affil][nameKey].push(dcName);
    }
  }
  _dcByTraitCache = byTrait;
  return byTrait;
}

/** Check and retool decks so the scenario is viable. Dynamically infers requirements from scenario cards + cc-effects playableBy. Runs before every testready launch. */
export function retoolDecksForScenario(p1Deck, p2Deck, scenarioId, deps) {
  const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];
  const hasTrait = (dc, traits) => traits.some((t) => new RegExp(t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i').test(dc));

  let primaryCard = null;
  let scenarioCards = [];
  try {
    const path = join(deps.rootDir, 'data', 'test-scenarios.json');
    const data = JSON.parse(readFileSync(path, 'utf8'));
    const scenario = (data.scenarios || {})[scenarioId];
    if (scenario && Array.isArray(scenario.cards) && scenario.cards.length > 0) {
      scenarioCards = scenario.cards;
      primaryCard = scenario.primaryCard || scenario.cards[0];
    }
  } catch {}

  const ccEffect = primaryCard ? deps.getCcEffect(primaryCard) : null;
  const traits = ccEffect ? parsePlayableByToTraits(ccEffect.playableBy) : [];
  const byTrait = getDcByTrait(deps);

  if (traits.length > 0) {
    const p1DcList = p1Deck.dcList || [];
    if (!p1DcList.some((dc) => hasTrait(dc, traits))) {
      // Search all affiliations — required DC may be Imperial or Scum
      const eligibles = traits.flatMap((t) => [
        ...(byTrait.rebel?.[t] || []),
        ...(byTrait.imperial?.[t] || []),
        ...(byTrait.scum?.[t] || []),
      ]).filter(Boolean);
      if (eligibles.length > 0) p1Deck.dcList[0] = pick(eligibles);
    }
  }

  if (primaryCard && !(p1Deck.ccList || []).includes(primaryCard)) {
    const swapTarget = scenarioCards.find((c) => c !== primaryCard && (p1Deck.ccList || []).includes(c)) || (p1Deck.ccList || [])[0];
    if (swapTarget) {
      const idx = (p1Deck.ccList || []).indexOf(swapTarget);
      if (idx >= 0) p1Deck.ccList[idx] = primaryCard;
      else p1Deck.ccList[0] = primaryCard;
    } else if ((p1Deck.ccList || []).length > 0) {
      p1Deck.ccList[0] = primaryCard;
    }
  }

  return { p1Deck, p2Deck };
}

/** Validate whether a testready scenario can actually be tested. Returns { valid, reason, needsOpponent }. */
export function validateTestreadyScenario(scenarioId, p2IsBot = true, deps) {
  try {
    const path = join(deps.rootDir, 'data', 'test-scenarios.json');
    const data = JSON.parse(readFileSync(path, 'utf8'));
    const scenario = (data.scenarios || {})[scenarioId];
    if (!scenario) return { valid: false, reason: 'Scenario not found.' };
    const primaryCard = scenario.primaryCard;
    if (!primaryCard) return { valid: false, reason: 'No primaryCard defined.' };
    const info = deps.getTimingTestInfo(primaryCard);
    if (info.needsOpponent && p2IsBot) {
      return { valid: false, reason: `"${primaryCard}" has timing that requires an opponent (${info.category}). Use \`testready @player2\` to test with a real P2.`, needsOpponent: true };
    }
    return { valid: true, reason: null, needsOpponent: info.needsOpponent };
  } catch {
    return { valid: false, reason: 'Failed to read scenario data.' };
  }
}

// ── Thin wrappers delegating to src/game-creation.js ────────────────────────

/**
 * Create hand threads for both players.
 * @param {object} client - Discord client
 * @param {object} game
 * @param {object} deps
 * @returns {Promise}
 */
export function createHandThreads(client, game, deps) {
  return deps._createHandThreads(client, game, { discordCatch: deps.discordCatch });
}

/**
 * Create game channels (category + general channel).
 * @param {object} guild - Discord guild
 * @param {string} player1Id
 * @param {string} player2Id
 * @param {object} deps
 * @returns {Promise}
 */
export function createGameChannels(guild, player1Id, player2Id, deps) {
  return deps._createGameChannels(guild, player1Id, player2Id, {
    CATEGORIES: deps.CATEGORIES,
    getGameIdCounter: deps.getGameIdCounter,
    setGameIdCounter: deps.setGameIdCounter,
  });
}

/**
 * Create a test game (shared by #lfg message handler and HTTP POST /testgame).
 * @param {import('discord.js').Client} client
 * @param {import('discord.js').Guild} guild
 * @param {string} userId - Discord user ID (P1)
 * @param {string|null} scenarioId - e.g. 'smoke_grenade'
 * @param {import('discord.js').TextChannel} feedbackChannel - where to send "Test game #X created"
 * @param {{ editMessageInstead?: import('discord.js').Message, player2Id?: string }} [options]
 * @param {object} deps
 * @returns {Promise<{ gameId: string }>}
 */
export function createTestGame(client, guild, userId, scenarioId, feedbackChannel, options, deps) {
  return deps._createTestGame(client, guild, userId, scenarioId, feedbackChannel, options, {
    testGameCreationInProgress: deps.testGameCreationInProgress,
    countActiveGamesForPlayer: deps.countActiveGamesForPlayer,
    MAX_ACTIVE_GAMES_PER_PLAYER: deps.MAX_ACTIVE_GAMES_PER_PLAYER,
    createGameChannelsFn: deps.createGameChannels,
    CURRENT_GAME_VERSION: deps.CURRENT_GAME_VERSION,
    setGame: deps.setGame,
    getScenarioPrimaryCard: deps.getScenarioPrimaryCard,
    IMPLEMENTED_SCENARIOS: deps.IMPLEMENTED_SCENARIOS,
    runDraftRandom: deps.runDraftRandom,
    getCcEffect: deps.getCcEffect,
    getTimingTestInfo: deps.getTimingTestInfo,
    discordCatch: deps.discordCatch,
    COLORS: deps.COLORS,
    getGeneralSetupButtons: deps.getGeneralSetupButtons,
    saveGames: deps.saveGames,
  });
}

/**
 * Apply a squad submission (P1 or P2).
 * @param {object} game
 * @param {boolean} isP1
 * @param {object} squad
 * @param {object} client - Discord client
 * @param {object} deps
 * @returns {Promise}
 */
export function applySquadSubmission(game, isP1, squad, client, deps) {
  return deps._applySquadSubmission(game, isP1, squad, client, {
    logGameAction: deps.logGameAction,
    getHandTooltipEmbed: deps.getHandTooltipEmbed,
    createPlayAreaChannelsFn: deps.createPlayAreaChannels,
    createBoardChannelFn: deps.createBoardChannel,
    buildBoardMapPayload: deps.buildBoardMapPayload,
    discordCatch: deps.discordCatch,
    populatePlayAreas: deps.populatePlayAreas,
    COLORS: deps.COLORS,
    getDetermineInitiativeButtons: deps.getDetermineInitiativeButtons,
    saveGames: deps.saveGames,
  });
}

/**
 * Setup server categories and channels.
 * @param {object} guild - Discord guild
 * @param {object} deps
 * @returns {Promise}
 */
export function setupServer(guild, deps) {
  return deps._setupServer(guild, { CATEGORIES: deps.CATEGORIES, CHANNELS: deps.CHANNELS, GAME_TAGS: deps.GAME_TAGS });
}
