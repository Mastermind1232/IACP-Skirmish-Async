/**
 * Setup handlers: map_selection_, map_type_, draft_random_, determine_initiative_, deployment_zone_red_/blue_, deployment_fig_, deployment_orient_, deploy_pick_, deployment_done_
 * F17: map_type_ buttons (Competitive/Random/Select Draw/Selection), map_selection_draw_, map_selection_pick_
 */
import { ActionRowBuilder, AttachmentBuilder, ButtonBuilder, ButtonStyle, ModalBuilder, StringSelectMenuBuilder, TextInputBuilder, TextInputStyle } from 'discord.js';
import { existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { getLoadoutCards, getFormCards, getDcEffects, getDcStats, getMapSpaces, getDcKeywords } from '../data-loader.js';
import { getDcImagePath } from '../asset-paths.js';
import { setPhase, PHASES } from '../game/phase.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const rootDir = join(__dirname, '..', '..');
import { getConfig, setConfig } from '../game/figure-config.js';
import {
  getPlayerId, getSquad, getDcList, getDcMessageIds, getHandChannelId,
  dcAttachmentsKey, ccDeckKey, ccHandKey,
  deployLabelsKey as _deployLabelsKey, deployMetadataKey as _deployMetadataKey,
  getInitiativePlayerNum, opponentPlayerNum,
} from '../game/player-helpers.js';
import { dcNameFromFigureKey, isFigurelessDc } from '../game/index.js';
import { stripBrackets, cardNameEquals } from '../game/card-names.js';
import { discordCatch } from '../error-handling.js';
import { requireGame } from '../utils/guards.js';

/**
 * Returns a Set of form names already chosen by OTHER Clawdite Shapeshifters
 * on the same team.  Used to prevent two Clawdites from sharing a form.
 * @param {object} game
 * @param {number} playerNum  1 or 2
 * @param {string} excludeFigureKey  figureKey of the Clawdite currently picking
 * @returns {Set<string>}
 */
function getFormsChosenByTeamClawdites(game, playerNum, excludeFigureKey) {
  const taken = new Set();
  const positions = game.figurePositions?.[playerNum] || {};
  for (const fk of Object.keys(positions)) {
    if (fk === excludeFigureKey) continue;
    // figureKey format: dcName-dgIdx-figIdx  — dcName may contain spaces/hyphens
    if (!fk.startsWith('Clawdite Shapeshifter')) continue;
    const form = getConfig(game, fk)?.form;
    if (form) taken.add(form);
  }
  return taken;
}

/** Get blocking terrain info for deployment filtering.
 * When ignoreBlocking is true (Massive/Mobile), blocking cells are merged into
 * the zone so the footprint zone-membership check passes for cells that are
 * blocking terrain but geographically inside the deployment zone.
 */
function getDeployBlockingInfo(game, dcName) {
  const ms = getMapSpaces(game.selectedMap?.id);
  const blocking = ms?.blocking || [];
  const keywords = getDcKeywords(game)?.[dcName] || [];
  const kwUpper = keywords.map(k => String(k).toUpperCase());
  const ignoreBlocking = kwUpper.includes('MOBILE') || kwUpper.includes('MASSIVE');
  return { blocking, ignoreBlocking };
}

/**
 * @deprecated No longer used — Massive/Mobile figures must still deploy within
 * the deployment zone.  `filterValidTopLeftSpaces` already handles the
 * ignoreBlocking flag so blocking cells *inside* the zone are allowed.
 */
// function extendZoneForMassive() — removed

/** Keyword tokens recognized as trait/type restrictions (not DC names). */
const RESTRICTION_KEYWORDS = ['LEADER', 'HUNTER', 'DROID', 'CREATURE', 'TROOPER', 'VEHICLE',
  'SMUGGLER', 'WOOKIEE', 'WOOKIE', 'FORCE USER', 'HEAVY WEAPON', 'UNIQUE FIGURE',
  'NON-UNIQUE', 'NON-MASSIVE', 'BRAWLER', 'SPY', 'GUARDIAN', 'IMPERIAL', 'REBEL',
  'SCUM', 'FIGURE WITH', 'FIGURE COST', 'GROUP WITH', 'MASSIVE'];

/**
 * Parse the restriction line from an attachment card and return a filter function.
 * Returns { restrictionText, filter: (dcName) => bool } or null if no restriction.
 */
function getAttachmentRestriction(cardName) {
  const effects = getDcEffects();
  const card = effects[cardName] || effects[`[${cardName}]`];
  if (!card) return null;
  if (!card.abilityText && !(card.keywords?.length > 0)) return null;
  const firstLine = (card.abilityText || '').split('\n')[0].trim();
  const onlyMatch = firstLine.match(/^(.+?)\s+ONLY$/i);
  // Fallback: if no "X ONLY" line but card has keywords, use keywords as restriction
  if (!onlyMatch) {
    // No "X ONLY" restriction line — card can attach to any DC
    // Note: card.keywords are traits the card grants, NOT target restrictions
    return null;
  }
  const restrictionRaw = onlyMatch[1].replace(/"/g, '').trim();
  const restrictionUpper = restrictionRaw.toUpperCase();

  // Split into OR-alternatives. "4 OR MORE" is a phrase, not an alternative split.
  // "VEHICLE, DROID, OR HEAVY WEAPON" → ["VEHICLE", "DROID", "HEAVY WEAPON"]
  // "NON-MASSIVE, NON-UNIQUE" → treated as single conjunctive phrase (not split)
  const normalized = restrictionRaw.replace(/(\d+)\s+OR\s+MORE/gi, '$1_OR_MORE');
  const orParts = normalized.split(/\s+OR\s+/i).map(s => s.trim()).filter(Boolean);
  const alternatives = [];
  for (const part of orParts) {
    // If part has commas (e.g. "VEHICLE, DROID"), split further — unless all parts are NON- (conjunctive)
    if (part.includes(',') && !part.includes('NON-')) {
      const subs = part.split(/,\s*/).map(s => s.trim()).filter(Boolean);
      alternatives.push(...subs);
    } else {
      alternatives.push(part.replace(/_OR_MORE/g, 'OR MORE'));
    }
  }

  return {
    restrictionText: restrictionRaw,
    filter: (dcName) => {
      const dcStats = effects[dcName];
      if (!dcStats) return true; // unknown DC, allow
      const dcKw = (dcStats.keywords || []).map(k => String(k).toUpperCase());
      const dcNameUpper = (dcName || '').toUpperCase();
      const isUnique = !!dcStats.unique;
      const isElite = !!dcStats.elite;
      const figureCost = dcStats.cost ?? 0;
      const figures = dcStats.figures ?? 1;
      const affiliation = (dcStats.affiliation || '').toUpperCase();

      // Check if DC satisfies ANY alternative
      return alternatives.some(alt => {
        const altUpper = alt.toUpperCase().replace(/\([^)]*\)/g, '').trim();

        // Handle NON- prefix conditions (conjunctive — all must be met)
        if (altUpper.includes('NON-')) {
          if (altUpper.includes('NON-MASSIVE') && dcKw.includes('MASSIVE')) return false;
          if (altUpper.includes('NON-UNIQUE') && isUnique) return false;
          // Check remaining positive keywords after stripping NON- conditions and commas
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
        // Simple keyword match: "LEADER", "HUNTER", "DROID", "TROOPER", compound "IMPERIAL TROOPER"
        if (RESTRICTION_KEYWORDS.some(k => altUpper.includes(k))) {
          return _matchesKeywordPhrase(altUpper, dcKw, affiliation);
        }
        return false;
      });
    },
  };
}

/** Check if a DC's keywords + affiliation satisfy a keyword phrase like "IMPERIAL TROOPER" or "HUNTER". */
function _matchesKeywordPhrase(phrase, dcKw, affiliation) {
  const words = phrase.split(/\s+/).filter(Boolean);
  return words.every(w => dcKw.includes(w) || affiliation === w);
}

/**
 * Check if an attachment card can auto-attach to exactly 1 eligible DC.
 * Handles both name-based ("Zeb Orrelios ONLY") and keyword-based ("LEADER ONLY") restrictions.
 * Excludes DCs that already have an attachment (CRR p.56: one attachment per DC).
 * @param {string} cardName
 * @param {Array} dcList
 * @param {Array} dcMsgIds
 * @param {Set} [alreadyAttached] - Set of dcMsgIds that already have an attachment
 * @returns {string|null} dcMsgId if exactly 1 match, null otherwise
 */
export function findAutoAttachTarget(cardName, dcList, dcMsgIds, alreadyAttached) {
  const effects = getDcEffects();
  const card = effects[cardName] || effects[`[${cardName}]`];
  if (!card?.abilityText) return null;
  const firstLine = card.abilityText.split('\n')[0].trim();
  const onlyMatch = firstLine.match(/^(.+?)\s+ONLY$/i);
  if (!onlyMatch) return null;
  const restriction = onlyMatch[1];
  // Split on " OR " / " or " and strip quotes/parens
  const alternatives = restriction
    .replace(/"/g, '')
    .split(/\s+(?:OR|or)\s+/)
    .map((s) => s.trim().replace(/\([^)]*\)/g, '').trim())
    .filter(Boolean);
  // If any alternative is a keyword category, auto-attach if exactly 1 DC qualifies
  const KEYWORDS = ['LEADER', 'HUNTER', 'DROID', 'CREATURE', 'TROOPER', 'VEHICLE',
    'SMUGGLER', 'WOOKIEE', 'WOOKIE', 'FORCE USER', 'HEAVY WEAPON', 'UNIQUE FIGURE',
    'NON-UNIQUE', 'NON-MASSIVE', 'BRAWLER', 'SPY', 'GUARDIAN', 'IMPERIAL', 'REBEL',
    'SCUM', 'FIGURE WITH', 'FIGURE COST', 'GROUP WITH', 'MASSIVE'];
  const isKeyword = alternatives.some((a) =>
    KEYWORDS.some((k) => a.toUpperCase().includes(k)),
  );
  if (isKeyword) {
    const kwRestriction = getAttachmentRestriction(cardName);
    if (kwRestriction) {
      const kwMatches = [];
      for (let i = 0; i < dcList.length; i++) {
        if (alreadyAttached?.has(dcMsgIds[i])) continue;
        if (isFigurelessDc(dcList[i].dcName)) continue;
        if (kwRestriction.filter(dcList[i].dcName)) kwMatches.push(dcMsgIds[i]);
      }
      return kwMatches.length === 1 ? kwMatches[0] : null;
    }
    return null;
  }
  // Match alternatives against DC names (case-insensitive)
  const matches = [];
  for (let i = 0; i < dcList.length; i++) {
    if (alreadyAttached?.has(dcMsgIds[i])) continue;
    if (isFigurelessDc(dcList[i].dcName)) continue;
    const name = (dcList[i].dcName || '').toLowerCase();
    for (const alt of alternatives) {
      if (name.includes(alt.toLowerCase())) {
        matches.push(dcMsgIds[i]);
        break;
      }
    }
  }
  return matches.length === 1 ? matches[0] : null;
}

/**
 * Apply a setup attachment to a DC (shared by manual picker and auto-attach).
 * Handles special cards (Focused on the Kill health boost, Wookiee Avenger deck search).
 */
export async function applySetupAttachment(game, playerNum, card, dcMsgId, ctx) {
  const { dcHealthState, logGameAction, client, updateAttachmentMessageForDc } = ctx;
  const attachKey = dcAttachmentsKey(playerNum);
  game[attachKey] = game[attachKey] || {};
  if (!Array.isArray(game[attachKey][dcMsgId])) game[attachKey][dcMsgId] = [];
  game[attachKey][dcMsgId].push(stripBrackets(card));

  // Focused on the Kill (IG-88): +5 Health applied at setup when attached
  if (cardNameEquals(card, 'Focused on the Kill')) {
    const dcHS = dcHealthState;
    const hs = dcHS?.get(dcMsgId);
    if (hs) {
      for (let fi = 0; fi < hs.length; fi++) {
        if (hs[fi]) { hs[fi] = [hs[fi][0] + 5, hs[fi][1] + 5]; }
      }
      dcHS.set(dcMsgId, hs);
      const dcList = getDcList(game, playerNum) || [];
      const dcMsgIds = getDcMessageIds(game, playerNum) || [];
      const idx = dcMsgIds.indexOf(dcMsgId);
      if (idx >= 0 && dcList[idx]) dcList[idx].healthState = [...hs];
    }
  }
  // Wookiee Avenger: search deck for "Debts Repaid", put into hand, draw 1 fewer in starting hand
  if (cardNameEquals(card, 'Wookiee Avenger')) {
    const deckKey = ccDeckKey(playerNum);
    const handKey = ccHandKey(playerNum);
    const deck = game[deckKey] || [];
    const dIdx = deck.indexOf('Debts Repaid');
    if (dIdx >= 0) {
      deck.splice(dIdx, 1);
      game[deckKey] = deck;
      game[handKey] = [...(game[handKey] || []), 'Debts Repaid'];
      game.wookieeAvengerDrawPenalty = (game.wookieeAvengerDrawPenalty || 0) + 1;
      if (logGameAction) await logGameAction(game, client, '**Wookiee Avenger** — Searched deck for **Debts Repaid**, added to hand. Will draw 1 fewer starting card.', { phase: 'SETUP', icon: 'card' });
    }
  }

  // Lie in Ambush: set the attached group aside — it does NOT deploy during deployment phase
  if (cardNameEquals(card, 'Lie in Ambush')) {
    const dcList = getDcList(game, playerNum) || [];
    const dcMsgIds = getDcMessageIds(game, playerNum) || [];
    const dcIdx = dcMsgIds.indexOf(dcMsgId);
    if (dcIdx >= 0 && dcList[dcIdx]) {
      const dcName = dcList[dcIdx].dcName || dcList[dcIdx].displayName;
      // Compute dgIndex matching getDeployFigureLabels: count same-name figure DCs up to dcIdx
      let dgIndex = 0;
      for (let i = 0; i < dcList.length; i++) {
        const n = dcList[i]?.dcName || dcList[i]?.displayName;
        if (!n || isFigurelessDc(n)) continue;
        if (n === dcName) dgIndex++;
        if (i === dcIdx) break;
      }
      const figures = getDcStats(dcName)?.figures ?? 1;
      const figureKeys = [];
      for (let f = 0; f < figures; f++) figureKeys.push(`${dcName}-${dgIndex}-${f}`);
      game.lieInAmbushSetAside = game.lieInAmbushSetAside || {};
      game.lieInAmbushSetAside[playerNum] = figureKeys;
    }
    if (logGameAction) {
      const hostName = getDcList(game, playerNum)?.[getDcMessageIds(game, playerNum)?.indexOf(dcMsgId)]?.dcName || 'group';
      await logGameAction(game, client, `📦 **Lie in Ambush** — **${hostName}** set aside, out of play. Will deploy later.`, { phase: 'SETUP', icon: 'card' });
    }
  }

  // Squad Upgrade figures (Z-6 Trooper, Mortar Trooper, Riot Trooper): auto-set nickname for the SU figure
  const SU_FIGURE_CARDS = ['Z-6 Trooper', 'Mortar Trooper', 'Riot Trooper'];
  if (SU_FIGURE_CARDS.some(c => cardNameEquals(c, card))) {
    const dcList = getDcList(game, playerNum) || [];
    const dcMsgIds = getDcMessageIds(game, playerNum) || [];
    const dcIdx = dcMsgIds.indexOf(dcMsgId);
    if (dcIdx >= 0 && dcList[dcIdx]) {
      const dcName = dcList[dcIdx].dcName || dcList[dcIdx].displayName;
      const totals = {};
      for (let i = 0; i <= dcIdx; i++) {
        const n = dcList[i]?.dcName || dcList[i]?.displayName || '';
        totals[n] = (totals[n] || 0) + 1;
      }
      const dgIndex = totals[dcName] || 1;
      const baseFigCount = getDcStats(dcName)?.figures ?? 1;
      const suFigKey = `${dcName}-${dgIndex}-${baseFigCount}`;
      game.figureNicknames = game.figureNicknames || {};
      game.figureNicknames[suFigKey] = card;
    }
  }

  if (updateAttachmentMessageForDc) {
    try { await updateAttachmentMessageForDc(game, playerNum, dcMsgId, client); }
    catch (err) { console.error('Failed to update attachment message after setup attach:', err); }
  }
}

/**
 * Build options for mission select menus (Select Draw / Selection). Value format: "mapId:variant".
 * @param {() => { id: string, name: string, imagePath?: string }[]} getPlayReadyMaps
 * @param {() => Record<string, Record<string, { name: string }>>} getMissionCardsData
 * @returns {{ value: string, label: string }[]}
 */
export function buildPlayableMissionOptions(getPlayReadyMaps, getMissionCardsData) {
  const playReadyMaps = getPlayReadyMaps?.() ?? [];
  const missionCards = getMissionCardsData?.() ?? {};
  const options = [];
  for (const map of playReadyMaps) {
    const variants = missionCards[map.id];
    if (!variants) continue;
    for (const variant of ['a', 'b']) {
      const mission = variants[variant];
      if (!mission?.name) continue;
      const variantUpper = variant.toUpperCase();
      // Prefix variant letter if not already present in the mission name
      const missionDisplay = /^[AB][.:)]\s/i.test(mission.name) ? mission.name : `${variantUpper}: ${mission.name}`;
      const rawLabel = `${map.name} — ${missionDisplay}`;
      const label = rawLabel.length > 100 ? rawLabel.slice(0, 97) + '...' : rawLabel;
      const rawDesc = (mission.endOfRound || mission.setup || '').replace(/\n/g, ' ').trim();
      const description = rawDesc ? (rawDesc.length > 100 ? rawDesc.slice(0, 97) + '...' : rawDesc) : undefined;
      options.push({ value: `${map.id}:${variant}`, label, description });
    }
  }
  return options;
}

/**
 * F17: Show Map Selection type buttons (Competitive / Random / Select Draw / Selection).
 * @param {import('discord.js').ButtonInteraction} interaction
 * @param {object} ctx - getGame, getMapTypeButtons, ...
 */
export async function handleMapSelection(interaction, ctx) {
  const { getGame, getMapTypeButtons } = ctx;
  const gameId = interaction.customId.replace('map_selection_', '');
  const game = await requireGame(interaction, getGame, gameId);
  if (!game) return;
  if (interaction.user.id !== game.player1Id && interaction.user.id !== game.player2Id) {
    await interaction.followUp({ content: 'Only players in this game can select the map.', ephemeral: true }).catch(discordCatch);
    return;
  }
  if (game.mapSelected) {
    await interaction.followUp({ content: `Map already selected: **${game.selectedMap?.name ?? 'Unknown'}**.`, ephemeral: true }).catch(discordCatch);
    return;
  }
  const playReadyMaps = ctx.getPlayReadyMaps?.() ?? [];
  if (playReadyMaps.length === 0) {
    await interaction.followUp({
      content: 'No maps have deployment zones configured yet. Add zone data to `data/deployment-zones.json` for at least one map.',
      ephemeral: true,
    }).catch(discordCatch);
    return;
  }
  const tooltipEmbed = ctx.getMapSelectionTooltipEmbed?.();
  await interaction.followUp({
    content: 'Choose how to select the map:',
    embeds: tooltipEmbed ? [tooltipEmbed] : [],
    components: [getMapTypeButtons(gameId)],
    ephemeral: false,
  }).catch(discordCatch);
}

/**
 * F17: Handle map-type button click (Competitive / Random / Select Draw / Selection).
 * For Competitive/Random: rolls the map internally but does NOT reveal the name.
 * For Select Draw/Selection: shows the mission dropdown.
 * @param {import('discord.js').ButtonInteraction} interaction
 * @param {object} ctx - getGame, getPlayReadyMaps, getTournamentRotation, getMissionCardsData, getMapRegistry, getMapTypeButtons, getMapConfirmButton, getMissionSelectDrawMenu, getMissionSelectionPickMenu, saveGames
 */
export async function handleMapTypeChoice(interaction, ctx) {
  const {
    getGame,
    getPlayReadyMaps,
    getTournamentRotation,
    getMissionCardsData,
    getMapRegistry,
    getMapTypeButtons,
    getMapConfirmButton,
    getMissionSelectDrawMenu,
    getMissionSelectionPickMenu,
    saveGames,
  } = ctx;
  await interaction.deferUpdate().catch(discordCatch);
  // Parse type and gameId from customId: map_type_{type}_{gameId}
  const afterPrefix = interaction.customId.replace('map_type_', '');
  const types = ['competitive', 'random', 'select_draw', 'selection'];
  let type = null;
  let gameId = null;
  for (const t of types) {
    if (afterPrefix.startsWith(t + '_')) {
      type = t;
      gameId = afterPrefix.slice(t.length + 1);
      break;
    }
  }
  if (!type || !gameId) {
    await interaction.followUp({ content: 'Invalid selection.', ephemeral: true }).catch(discordCatch);
    return;
  }
  const game = await requireGame(interaction, getGame, gameId);
  if (!game) return;
  if (game.mapSelected) {
    await interaction.followUp({ content: 'Map already selected.', ephemeral: true }).catch(discordCatch);
    return;
  }

  // Clear any previous pending selection when switching types
  delete game.selectedMap;
  delete game.selectedMission;
  game.mapSelectionType = type;

  if (type === 'select_draw' || type === 'selection') {
    const options = buildPlayableMissionOptions(getPlayReadyMaps, getMissionCardsData);
    if (type === 'select_draw' && options.length < 2) {
      await interaction.followUp({ content: 'Need at least 2 playable missions for Select Draw. Use **Random** or **Selection**.', ephemeral: true }).catch(discordCatch);
      return;
    }
    if (options.length === 0) {
      await interaction.followUp({ content: 'No playable missions. Add mission data and deployment zones for at least one map.', ephemeral: true }).catch(discordCatch);
      return;
    }
    const content = type === 'select_draw'
      ? 'Choose at least 2 missions (we\'ll pick one at random):'
      : 'Choose one mission:';
    const missionMenu = type === 'select_draw'
      ? getMissionSelectDrawMenu(gameId, options)
      : getMissionSelectionPickMenu(gameId, options);
    saveGames();
    await interaction.editReply({ content, embeds: [], components: [getMapTypeButtons(gameId, type), missionMenu] }).catch(discordCatch);
    return;
  }

  // Competitive or Random — roll the map internally
  if (type === 'competitive') {
    const rotation = getTournamentRotation?.();
    const missionIds = rotation?.missionIds ?? [];
    if (missionIds.length === 0) {
      await interaction.followUp({ content: 'No tournament rotation configured. Use **Random** or add missions to `data/tournament-rotation.json`.', ephemeral: true }).catch(discordCatch);
      return;
    }
    const playReadyMapIds = new Set((getPlayReadyMaps?.() ?? []).map((m) => m.id));
    const playableFromRotation = missionIds.filter((id) => playReadyMapIds.has(String(id).split(':')[0]));
    if (playableFromRotation.length === 0) {
      await interaction.followUp({ content: 'No playable missions in tournament rotation (maps need deployment zones and map-spaces). Use **Random**.', ephemeral: true }).catch(discordCatch);
      return;
    }
    const missionId = playableFromRotation[Math.floor(Math.random() * playableFromRotation.length)];
    const [mapId, variant] = String(missionId).split(':');
    const mapDef = getMapRegistry?.().find((m) => m.id === mapId);
    const missionData = getMissionCardsData?.()[mapId]?.[variant || 'a'];
    if (!mapDef || !missionData) {
      console.error(`[Competitive] Invalid mission: missionId=${missionId} mapId=${mapId} variant=${variant} mapDef=${!!mapDef} missionData=${!!missionData}`);
      await interaction.followUp({ content: `Invalid mission in rotation (${mapId}:${variant || 'a'}). Use **Random**.`, ephemeral: true }).catch(discordCatch);
      return;
    }
    game.selectedMap = { id: mapDef.id, name: mapDef.name, imagePath: mapDef.imagePath };
    game.selectedMission = { variant: variant || 'a', name: missionData.name, fullName: `${mapDef.name} — ${missionData.name}`, tokenLabel: missionData.tokenLabel || '', interactLabel: missionData.interactLabel || '', mechanics: missionData.mechanics || {} };
  } else {
    // Random
    const playReadyMaps = getPlayReadyMaps();
    if (playReadyMaps.length === 0) {
      await interaction.followUp({ content: 'No play-ready maps.', ephemeral: true }).catch(discordCatch);
      return;
    }
    const map = playReadyMaps[Math.floor(Math.random() * playReadyMaps.length)];
    game.selectedMap = { id: map.id, name: map.name, imagePath: map.imagePath };
    const missionCards = getMissionCardsData?.()[map.id];
    const variants = missionCards ? Object.keys(missionCards) : ['a'];
    const variant = variants[Math.floor(Math.random() * variants.length)];
    const missionData = missionCards?.[variant];
    if (missionData) {
      game.selectedMission = { variant, name: missionData.name, fullName: `${map.name} — ${missionData.name}`, tokenLabel: missionData.tokenLabel || '', interactLabel: missionData.interactLabel || '', mechanics: missionData.mechanics || {} };
    }
  }

  // Show confirmation WITHOUT revealing the map name
  const typeLabel = type === 'competitive' ? 'Competitive — Random from tournament rotation' : 'Random — Random map and mission';
  saveGames();
  await interaction.editReply({
    content: `**${typeLabel}**\nMap selected. Click **Confirm Selection** to reveal and proceed, or pick a different method.`,
    embeds: [],
    components: [getMapTypeButtons(gameId, type), getMapConfirmButton(gameId)],
  }).catch(discordCatch);
}

/**
 * Shared post-map-selection: post to board, log, update setup message, create play areas + hand threads.
 * @param {object} game
 * @param {import('discord.js').Client} client
 * @param {object} ctx - buildBoardMapPayload, logGameAction, getGeneralSetupButtons, createPlayAreaChannels, createBoardChannel, createHandThreads, getHandTooltipEmbed, getSquadSelectEmbed, getHandSquadButtons, saveGames
 */
async function finishMapSelectionAfterChoice(game, client, ctx) {
  const {
    buildBoardMapPayload,
    logGameAction,
    getGeneralSetupButtons,
    createPlayAreaChannels,
    createBoardChannel,
    createHandThreads,
    getHandTooltipEmbed,
    saveGames,
  } = ctx;
  const map = game.selectedMap;
  const mapName = map?.name ?? 'Map';
  if (game.generalSetupMessageId) {
    try {
      const generalChannel = await client.channels.fetch(game.generalId);
      const setupMsg = await generalChannel.messages.fetch(game.generalSetupMessageId);
      await setupMsg.edit({ components: [getGeneralSetupButtons(game)] });
    } catch (err) {
      console.error('Failed to remove Map Selection button:', err);
    }
  }
  try {
    if (!game.p1PlayAreaId || !game.p2PlayAreaId) {
      const generalCh = await client.channels.fetch(game.generalId);
      const guild = generalCh.guild;
      const gameCategory = await guild.channels.fetch(game.gameCategoryId || generalCh.parentId);
      const prefix = `IA${game.gameId}`;
      const { p1PlayAreaChannel, p2PlayAreaChannel } = await createPlayAreaChannels(
        guild, gameCategory, prefix, game.player1Id, game.player2Id
      );
      game.p1PlayAreaId = p1PlayAreaChannel.id;
      game.p2PlayAreaId = p2PlayAreaChannel.id;
    }
    // Map Updates channel created AFTER play areas so it appears last in the category
    if (!game.boardId) {
      const generalCh = await client.channels.fetch(game.generalId);
      const guild = generalCh.guild;
      const gameCategory = await guild.channels.fetch(game.gameCategoryId || generalCh.parentId);
      const prefix = `IA${game.gameId}`;
      const boardChannel = await createBoardChannel(guild, gameCategory, prefix, game.player1Id, game.player2Id);
      game.boardId = boardChannel.id;
      if (map) {
        try {
          const payload = await buildBoardMapPayload(game.gameId, map, game);
          await boardChannel.send(payload);
        } catch (err) {
          console.error('Failed to post map to Map Updates channel:', err);
        }
      }
      // Ping Active Player button is already included in the map update standard row
    } else if (map) {
      // Board channel already exists (re-entry); post the map to it
      try {
        const boardChannel = await client.channels.fetch(game.boardId);
        const payload = await buildBoardMapPayload(game.gameId, map, game);
        await boardChannel.send(payload);
      } catch (err) {
        console.error('Failed to post map to Map Updates channel:', err);
      }
    }
    if (!game.p1HandId || !game.p2HandId) {
      await createHandThreads(client, game);
    }
    const p1Hand = await client.channels.fetch(game.p1HandId);
    const p2Hand = await client.channels.fetch(game.p2HandId);
    const p1Id = game.player1Id;
    const p2Id = game.player2Id;
    {
      await p1Hand.send({
        content: `<@${p1Id}>, this is your hand — submit your squad below!`,
        allowedMentions: { users: [p1Id] },
        embeds: [getHandTooltipEmbed(game, 1)],
      });
      await p2Hand.send({
        content: `<@${p2Id}>, this is your hand — submit your squad below!`,
        allowedMentions: { users: [p2Id] },
        embeds: [getHandTooltipEmbed(game, 2)],
      });
    }
  } catch (err) {
    console.error('Failed to create/populate Hand threads:', err);
  }
  saveGames();
}

/**
 * Resolve a missionId ("mapId:variant") to map + mission and set game.selectedMap / selectedMission.
 * @param {object} game
 * @param {string} missionId - e.g. "mos-eisley-outskirts:a"
 * @param {() => { id: string, name: string, imagePath?: string }[]} getMapRegistry
 * @param {() => Record<string, Record<string, { name: string }>>} getMissionCardsData
 * @returns {boolean} true if resolved
 */
function applyMissionToGame(game, missionId, getMapRegistry, getMissionCardsData) {
  const [mapId, variant] = String(missionId).split(':');
  const v = variant || 'a';
  const mapDef = getMapRegistry?.().find((m) => m.id === mapId);
  const missionData = getMissionCardsData?.()[mapId]?.[v];
  if (!mapDef || !missionData) return false;
  game.selectedMap = { id: mapDef.id, name: mapDef.name, imagePath: mapDef.imagePath };
  game.selectedMission = { variant: v, name: missionData.name, fullName: `${mapDef.name} — ${missionData.name}`, tokenLabel: missionData.tokenLabel || '', interactLabel: missionData.interactLabel || '', mechanics: missionData.mechanics || {} };
  return true;
}

/**
 * F17 Select Draw: user chose multiple missions; pick one at random and finish map selection.
 * @param {import('discord.js').StringSelectMenuInteraction} interaction
 * @param {object} ctx - same as handleMapTypeChoice
 */
export async function handleMapSelectionDraw(interaction, ctx) {
  const {
    getGame,
    getMapRegistry,
    getMissionCardsData,
    postPinnedMissionCardFromGameState,
    client,
  } = ctx;
  await interaction.deferUpdate().catch(discordCatch);
  const gameId = interaction.customId.replace('map_selection_draw_', '');
  const game = await requireGame(interaction, getGame, gameId);
  if (!game) return;
  if (game.mapSelected) {
    await interaction.followUp({ content: 'Map already selected.', ephemeral: true }).catch(discordCatch);
    return;
  }
  const values = interaction.values ?? [];
  const missionId = values[Math.floor(Math.random() * values.length)];
  if (!applyMissionToGame(game, missionId, getMapRegistry, getMissionCardsData)) {
    await interaction.followUp({ content: 'Invalid mission. Try again or use Random.', ephemeral: true }).catch(discordCatch);
    return;
  }
  // Show confirmation with type buttons highlighted
  const { getMapConfirmButton, getMapTypeButtons, getMissionSelectDrawMenu } = ctx;
  const options = buildPlayableMissionOptions(ctx.getPlayReadyMaps, getMissionCardsData);
  const confirmLabel = game.selectedMission?.fullName || game.selectedMap?.name || 'Map';
  const components = [getMapTypeButtons(gameId, 'select_draw'), getMissionSelectDrawMenu(gameId, options), getMapConfirmButton(gameId)];
  ctx.saveGames();
  await interaction.editReply({ content: `Drew: **${confirmLabel}**\nClick **Confirm Selection** to proceed, or re-draw above.`, components }).catch(discordCatch);
}

/**
 * F17 Selection: user chose one mission; apply and finish map selection.
 * @param {import('discord.js').StringSelectMenuInteraction} interaction
 * @param {object} ctx - same as handleMapTypeChoice
 */
export async function handleMapSelectionPick(interaction, ctx) {
  const {
    getGame,
    getMapRegistry,
    getMissionCardsData,
    postPinnedMissionCardFromGameState,
    client,
  } = ctx;
  await interaction.deferUpdate().catch(discordCatch);
  const gameId = interaction.customId.replace('map_selection_pick_', '');
  const game = await requireGame(interaction, getGame, gameId);
  if (!game) return;
  if (game.mapSelected) {
    await interaction.followUp({ content: 'Map already selected.', ephemeral: true }).catch(discordCatch);
    return;
  }
  const missionId = interaction.values?.[0];
  if (!missionId || !applyMissionToGame(game, missionId, getMapRegistry, getMissionCardsData)) {
    await interaction.followUp({ content: 'Invalid mission. Try again or use Random.', ephemeral: true }).catch(discordCatch);
    return;
  }
  // Show confirmation with type buttons highlighted and selected mission visible in dropdown
  const { getMapConfirmButton, getMapTypeButtons, getMissionSelectionPickMenu } = ctx;
  const options = buildPlayableMissionOptions(ctx.getPlayReadyMaps, getMissionCardsData);
  const confirmLabel = game.selectedMission?.fullName || game.selectedMap?.name || 'Map';
  const components = [getMapTypeButtons(gameId, 'selection'), getMissionSelectionPickMenu(gameId, options, missionId), getMapConfirmButton(gameId)];
  ctx.saveGames();
  await interaction.editReply({ content: `Selected: **${confirmLabel}**\nClick **Confirm Selection** to proceed, or change your pick above.`, components }).catch(discordCatch);
}

/**
 * F17 Map Confirm: finalize the pending map selection.
 * @param {import('discord.js').ButtonInteraction} interaction
 * @param {object} ctx - same as handleMapTypeChoice
 */
export async function handleMapConfirm(interaction, ctx) {
  const {
    getGame,
    postMissionCardAfterMapSelection,
    postPinnedMissionCardFromGameState,
    client,
  } = ctx;
  await interaction.deferUpdate().catch(discordCatch);
  const gameId = interaction.customId.replace('map_confirm_', '');
  const game = await requireGame(interaction, getGame, gameId);
  if (!game) return;
  if (game.mapSelected) {
    await interaction.followUp({ content: 'Map already confirmed.', ephemeral: true }).catch(discordCatch);
    return;
  }
  if (!game.selectedMap) {
    await interaction.followUp({ content: 'No map selected yet. Pick a selection type first.', ephemeral: true }).catch(discordCatch);
    return;
  }
  game.mapSelected = true;
  setPhase(game, PHASES.INITIATIVE);
  delete game.mapSelectionType;
  // Post mission card
  if (game.selectedMission) {
    await postPinnedMissionCardFromGameState(game, client);
  } else {
    await postMissionCardAfterMapSelection(game, client, game.selectedMap);
  }
  await finishMapSelectionAfterChoice(game, client, ctx);
  const confirmLabel = game.selectedMission?.fullName || game.selectedMap?.name || 'Map';
  await interaction.editReply({ content: `✅ **${confirmLabel}** confirmed!`, components: [] }).catch(discordCatch);
}

/**
 * F17 Go Back: clear pending map selection and return to the type buttons.
 * @param {import('discord.js').ButtonInteraction} interaction
 * @param {object} ctx - getGame, getMapTypeButtons, saveGames
 */
export async function handleMapGoBack(interaction, ctx) {
  const { getGame, getMapTypeButtons, getMapSelectionTooltipEmbed } = ctx;
  await interaction.deferUpdate().catch(discordCatch);
  const gameId = interaction.customId.replace('map_goback_', '');
  const game = await requireGame(interaction, getGame, gameId);
  if (!game) return;
  if (game.mapSelected) {
    await interaction.followUp({ content: 'Map already confirmed.', ephemeral: true }).catch(discordCatch);
    return;
  }
  // Clear pending selection
  delete game.selectedMap;
  delete game.selectedMission;
  delete game.mapSelectionType;
  ctx.saveGames();
  const tooltipEmbed = getMapSelectionTooltipEmbed?.();
  await interaction.editReply({
    content: 'Choose how to select the map:',
    embeds: tooltipEmbed ? [tooltipEmbed] : [],
    components: [getMapTypeButtons(gameId)],
  }).catch(discordCatch);
}

/**
 * @param {import('discord.js').ButtonInteraction} interaction
 * @param {object} ctx - getGame, runDraftRandom, getGeneralSetupButtons, logGameErrorToBotLogs, extractGameIdFromInteraction, client, saveGames
 */
export async function handleDraftRandom(interaction, ctx) {
  const {
    getGame,
    runDraftRandom,
    getGeneralSetupButtons,
    logGameErrorToBotLogs,
    extractGameIdFromInteraction,
    client,
    saveGames,
  } = ctx;
  const gameId = interaction.customId.replace('draft_random_', '');
  const game = await requireGame(interaction, getGame, gameId);
  if (!game) return;
  if (interaction.user.id !== game.player1Id && interaction.user.id !== game.player2Id) {
    await interaction.followUp({ content: 'Only players in this game can use Draft Random.', ephemeral: true }).catch(discordCatch);
    return;
  }
  if (game.draftRandomUsed || game.currentRound || game.initiativeDetermined || game.deploymentZoneChosen) {
    await interaction.followUp({ content: 'Draft Random is only available at game setup.', ephemeral: true }).catch(discordCatch);
    return;
  }
  try {
    await runDraftRandom(game, client);
    game.draftRandomUsed = true;
    if (game.generalSetupMessageId) {
      try {
        const generalChannel = await client.channels.fetch(game.generalId);
        const setupMsg = await generalChannel.messages.fetch(game.generalSetupMessageId);
        await setupMsg.edit({ components: [getGeneralSetupButtons(game)] });
      } catch (err) {
        console.error('Failed to update setup buttons after Draft Random:', err);
      }
    }
    saveGames();
  } catch (err) {
    console.error('Draft Random error:', err);
    await logGameErrorToBotLogs(interaction.client, interaction.guild, extractGameIdFromInteraction(interaction), err, 'draft_random');
    await interaction.followUp({ content: `Draft Random failed: ${err.message}`, ephemeral: true }).catch(discordCatch);
  }
}

/**
 * @param {import('discord.js').ButtonInteraction} interaction
 * @param {object} ctx - getGame, clearPreGameSetup, logGameAction, getDeploymentZoneButtons, client, saveGames
 */
export async function handleDetermineInitiative(interaction, ctx) {
  const { getGame, clearPreGameSetup, logGameAction, getDeploymentZoneButtons, client, saveGames } = ctx;
  const gameId = interaction.customId.replace('determine_initiative_', '');
  const game = await requireGame(interaction, getGame, gameId);
  if (!game) return;
  if (interaction.user.id !== game.player1Id && interaction.user.id !== game.player2Id) {
    await interaction.followUp({ content: 'Only players in this game can determine initiative.', ephemeral: true }).catch(discordCatch);
    return;
  }
  if (game.initiativeDetermined) {
    await interaction.followUp({ content: 'Initiative was already determined.', ephemeral: true }).catch(discordCatch);
    return;
  }
  const missing = [];
  if (!game.player1Squad) missing.push(`<@${game.player1Id}> (Player 1)`);
  if (!game.player2Squad) missing.push(`<@${game.player2Id}> (Player 2)`);
  if (missing.length > 0) {
    await interaction.followUp({ content: 'Both players must select their squads before initiative can be determined.', ephemeral: true }).catch(discordCatch);
    const generalChannel = await client.channels.fetch(game.generalId).catch(() => null);
    if (generalChannel) {
      await generalChannel.send({
        content: `⚠️ **Initiative blocked** — Squad selection required first.\n\nStill needed: ${missing.join(', ')}`,
        allowedMentions: { users: [...new Set([game.player1Id, game.player2Id])] },
      }).catch(discordCatch);
    }
    return;
  }
  // G82/M75: Devious Scheme — check before initiative
  const hasDcInSquad = (squad, dcName) => (squad?.dcList || []).some(n => {
    const resolved = typeof n === 'string' ? n.replace(/^\[|\]$/g, '') : n;
    return resolved === dcName || `[${resolved}]` === dcName || resolved === dcName.replace(/^\[|\]$/g, '');
  });
  const p1HasDS = hasDcInSquad(game.player1Squad, '[Devious Scheme]');
  const p2HasDS = hasDcInSquad(game.player2Squad, '[Devious Scheme]');

  let winner;
  let zoneChooser; // who picks deployment zone (normally = initiative winner)

  if (p1HasDS && p2HasDS) {
    // Both have Devious Scheme — cards cancel, normal initiative rules
  } else if (p1HasDS) {
    // P1 has DS: P2 gets initiative, P1 chooses zone
    winner = game.player2Id;
    zoneChooser = game.player1Id;
  } else if (p2HasDS) {
    // P2 has DS: P1 gets initiative, P2 chooses zone
    winner = game.player1Id;
    zoneChooser = game.player2Id;
  }

  // Initiative is always determined by random roll
  if (!winner) {
    winner = Math.random() < 0.5 ? game.player1Id : game.player2Id;
  }

  const playerNum = winner === game.player1Id ? 1 : 2;
  game.initiativePlayerId = winner;
  game.initiativeDetermined = true;
  setPhase(game, PHASES.ZONE_SELECTION);
  // Store zone chooser if different from initiative winner (Devious Scheme)
  if (zoneChooser && zoneChooser !== winner) {
    game.deviousSchemeZoneChooser = zoneChooser;
  }
  await clearPreGameSetup(game, client);

  if (zoneChooser && zoneChooser !== winner) {
    // Devious Scheme: split message — opponent gets initiative, DS player picks zone
    const dsPlayerNum = zoneChooser === game.player1Id ? 1 : 2;
    await logGameAction(game, client, `🃏 **Devious Scheme** — <@${zoneChooser}> (Player ${dsPlayerNum}) chooses deployment zone. <@${winner}> (Player ${playerNum}) has initiative and deploys first.`, { allowedMentions: { users: [zoneChooser, winner] }, phase: 'INITIATIVE', icon: 'initiative' });
    if (p1HasDS && p2HasDS) {
      await logGameAction(game, client, `Both players have **[Devious Scheme]** — cards cancel each other. Normal initiative rules apply.`, { phase: 'INITIATIVE', icon: 'initiative' });
    }
    const generalChannel = await client.channels.fetch(game.generalId);
    const zoneMsg = await generalChannel.send({
      content: `<@${zoneChooser}> (**Player ${dsPlayerNum}**) — Pick your deployment zone (Devious Scheme):`,
      allowedMentions: { users: [zoneChooser] },
      components: [getDeploymentZoneButtons(gameId)],
    });
    game.deploymentZoneMessageId = zoneMsg.id;
  } else {
    await logGameAction(game, client, `<@${winner}> (**Player ${playerNum}**) won initiative (random roll)! Choose your deployment zone.`, { allowedMentions: { users: [winner] }, phase: 'INITIATIVE', icon: 'initiative' });
    const generalChannel = await client.channels.fetch(game.generalId);
    const zoneMsg = await generalChannel.send({
      content: `<@${winner}> (**Player ${playerNum}**) — Pick your deployment zone:`,
      allowedMentions: { users: [winner] },
      components: [getDeploymentZoneButtons(gameId)],
    });
    game.deploymentZoneMessageId = zoneMsg.id;
  }
  saveGames();
}

/**
 * @param {import('discord.js').ButtonInteraction} interaction
 * @param {object} ctx - getGame, logGameAction, getDeployFigureLabels, getDeployButtonRows, getDeploymentMapAttachment, client, saveGames
 */
export async function handleDeploymentZone(interaction, ctx) {
  const { getGame, logGameAction, getDeployFigureLabels, getDeployButtonRows, getDeploymentMapAttachment, pushUndo, getDeploymentZoneButtons, client, saveGames } = ctx;
  const isRed = interaction.customId.startsWith('deployment_zone_red_');
  const gameId = interaction.customId.replace(isRed ? 'deployment_zone_red_' : 'deployment_zone_blue_', '');
  const game = await requireGame(interaction, getGame, gameId);
  if (!game) return;
  // Devious Scheme: zone chooser may differ from initiative player
  const zoneChooserId = game.deviousSchemeZoneChooser || game.initiativePlayerId;
  if (interaction.user.id !== zoneChooserId) {
    await interaction.followUp({ content: 'Only the designated player can choose the deployment zone.', ephemeral: true }).catch(discordCatch);
    return;
  }
  if (game.deploymentZoneChosen) {
    await interaction.followUp({ content: `Deployment zone already chosen: **${game.deploymentZoneChosen}**.`, ephemeral: true }).catch(discordCatch);
    return;
  }
  // Push undo snapshot before mutation
  pushUndo(game, { type: 'deployment_zone', label: 'Deployment zone selection', gameId });
  const zone = isRed ? 'red' : 'blue';
  const otherZone = zone === 'red' ? 'blue' : 'red';
  game.deploymentZoneChosen = zone;
  setPhase(game, PHASES.DEPLOYMENT);
  // Assign zones based on who chose (DS player or initiative player)
  const zoneChooserPlayerNum = zoneChooserId === game.player1Id ? 1 : 2;
  game[`player${zoneChooserPlayerNum}DeploymentZone`] = zone;
  game[`player${zoneChooserPlayerNum === 1 ? 2 : 1}DeploymentZone`] = otherZone;
  const zoneLabel = `[${zone.toUpperCase()}] `;
  await logGameAction(game, client, `<@${zoneChooserId}> (${zoneLabel}**Player ${zoneChooserPlayerNum}**) chose the **${zone}** deployment zone`, { allowedMentions: { users: [zoneChooserId] }, phase: 'INITIATIVE', icon: 'zone' });
  if (game.deploymentZoneMessageId) {
    try {
      const generalChannel = await client.channels.fetch(game.generalId);
      const zoneMsg = await generalChannel.messages.fetch(game.deploymentZoneMessageId);
      await zoneMsg.edit({ content: `~~Pick your deployment zone~~ — **${zone}** chosen.`, components: [] });
    } catch (err) {
      console.error('Failed to remove deployment zone buttons:', err);
    }
  }
  // Check for setup attachments BEFORE deployment (rules: attachments placed first)
  const { isDcAttachment, resolveDcName } = ctx;
  const p1DcListRaw = game.player1Squad?.dcList || [];
  const p2DcListRaw = game.player2Squad?.dcList || [];
  const p1SetupAttachments = isDcAttachment ? p1DcListRaw.filter((entry) => isDcAttachment(resolveDcName(entry))) : [];
  const p2SetupAttachments = isDcAttachment ? p2DcListRaw.filter((entry) => isDcAttachment(resolveDcName(entry))) : [];

  if (p1SetupAttachments.length > 0 || p2SetupAttachments.length > 0) {
    // Attachments exist — start attachment phase before deployment
    game.setupAttachmentPhase = true;
    setPhase(game, PHASES.ATTACHMENT);
    game.setupAttachmentPending = {
      1: p1SetupAttachments.map((e) => resolveDcName(e)),
      2: p2SetupAttachments.map((e) => resolveDcName(e)),
    };
    game.setupAttachmentOriginal = {
      1: [...game.setupAttachmentPending[1]],
      2: [...game.setupAttachmentPending[2]],
    };
    game.setupAttachmentApplied = { 1: [], 2: [] };
    const generalChannel = await client.channels.fetch(game.generalId);
    await generalChannel.send({
      content: '**Deployment zones chosen.** Place your Skirmish Upgrade card(s) on your Deployment cards (see the **Your Hand** thread in your Play Area). Deployment will begin after upgrades are placed.',
    });

    const { dcMessageMeta } = ctx;
    for (const pn of [1, 2]) {
      const pending = game.setupAttachmentPending[pn];
      if (pending.length === 0) {
        game.setupAttachmentConfirmed = game.setupAttachmentConfirmed || {};
        game.setupAttachmentConfirmed[pn] = true;
        continue;
      }
      // Auto-attach character-specific attachments
      const dcList = getDcList(game, pn) || [];
      const dcMsgIds = getDcMessageIds(game, pn) || [];
      const attached = new Set((game.setupAttachmentApplied?.[pn] || []).map(a => a.dcMsgId));
      while (pending.length > 0) {
        const autoTarget = findAutoAttachTarget(pending[0], dcList, dcMsgIds, attached);
        if (!autoTarget) break;
        const card = pending[0];
        await applySetupAttachment(game, pn, card, autoTarget, ctx);
        pending.shift();
        game.setupAttachmentApplied[pn].push({ card, dcMsgId: autoTarget });
        attached.add(autoTarget);
        await logGameAction(game, client, `**${card}** auto-attached to **${dcMessageMeta?.get(autoTarget)?.displayName || 'DC'}** (setup).`, { phase: 'SETUP', icon: 'card' });
      }
      if (pending.length === 0) {
        await _sendAttachDonePrompt(game, gameId, pn, client);
        continue;
      }
      await _sendAttachmentDropdown(game, gameId, pn, pending[0], client);
    }
    saveGames();
    return;
  }

  // No attachments — proceed directly to deployment
  await _sendInitiativeDeployButtons(game, gameId, ctx);
  // Store deploy message IDs in the undo entry so they can be cleaned up on undo
  const undoEntry = game.undoStack?.[game.undoStack.length - 1];
  if (undoEntry && undoEntry.type === 'deployment_zone') {
    undoEntry.deployMessageIds = game.initiativeDeployMessageIds || [];
    undoEntry.deployHandChannelId = game.initiativePlayerId === game.player1Id ? game.p1HandId : game.p2HandId;
  }
  saveGames();
}

/**
 * Send deploy buttons to the initiative player. Extracted so it can be called
 * from both zone selection (no attachments) and post-attachment completion.
 */
async function _sendInitiativeDeployButtons(game, gameId, ctx) {
  const { getDeployFigureLabels, getDeployButtonRows, getDeploymentMapAttachment, client, saveGames } = ctx;
  const zone = game.deploymentZoneChosen;
  setPhase(game, PHASES.DEPLOYMENT);
  const initiativePlayerNum = getInitiativePlayerNum(game);
  const initiativeHandId = game.initiativePlayerId === game.player1Id ? game.p1HandId : game.p2HandId;
  const initiativeSquad = getSquad(game, initiativePlayerNum);
  const initiativeDcList = initiativeSquad?.dcList || [];
  const { labels: initiativeLabels, metadata: initiativeMetadata } = getDeployFigureLabels(initiativeDcList, game);
  const deployLabelsKey = _deployLabelsKey(initiativePlayerNum);
  const deployMetadataKey = _deployMetadataKey(initiativePlayerNum);
  game[deployLabelsKey] = initiativeLabels;
  game[deployMetadataKey] = initiativeMetadata;
  if (!game.figurePositions) game.figurePositions = { 1: {}, 2: {} };
  try {
    const initiativeHandChannel = await client.channels.fetch(initiativeHandId);
    const { deployRows, doneRow } = getDeployButtonRows(gameId, initiativePlayerNum, initiativeDcList, zone, game.figurePositions, game);
    const DEPLOY_ROWS_PER_MSG = 4;
    game.initiativeDeployMessageIds = game.initiativeDeployMessageIds || [];
    const initiativePing = `<@${game.initiativePlayerId}>`;
    const initMapAttachment = await getDeploymentMapAttachment(game, zone);
    if (deployRows.length === 0) {
      const payload = {
        content: `${initiativePing} — You chose the **${zone}** zone. When finished, click **Deployment Completed** below.`,
        components: [doneRow],
        allowedMentions: { users: [game.initiativePlayerId] },
      };
      if (initMapAttachment) payload.files = [initMapAttachment];
      const msg = await initiativeHandChannel.send(payload);
      game.initiativeDeployMessageIds = [msg.id];
    } else {
      for (let i = 0; i < deployRows.length; i += DEPLOY_ROWS_PER_MSG) {
        const chunk = deployRows.slice(i, i + DEPLOY_ROWS_PER_MSG);
        const isLastChunk = i + DEPLOY_ROWS_PER_MSG >= deployRows.length;
        const components = isLastChunk ? [...chunk, doneRow] : chunk;
        const payload = {
          content: i === 0 ? `${initiativePing} — You chose the **${zone}** zone. Deploy each figure below (one per row), then click **Deployment Completed** when finished.\n-# *Auto-Deploy places all figures at your zone entrance(s).*` : null,
          components,
          allowedMentions: { users: [game.initiativePlayerId] },
        };
        if (i === 0 && initMapAttachment) payload.files = [initMapAttachment];
        const msg = await initiativeHandChannel.send(payload);
        game.initiativeDeployMessageIds.push(msg.id);
      }
    }
    game.initiativeDeployMessageId = game.initiativeDeployMessageIds[game.initiativeDeployMessageIds.length - 1];
  } catch (err) {
    console.error('Failed to send deploy prompt to initiative player:', err);
  }
}

/**
 * Start deployment phase after attachments are complete. Called from finishSetupAttachments.
 * Exported so it can be passed via ctx.
 */
export async function startDeploymentAfterAttachments(game, client, ctx) {
  const gameId = game.gameId;
  await _sendInitiativeDeployButtons(game, gameId, ctx);
  ctx.saveGames();
}

/**
 * @param {import('discord.js').ButtonInteraction} interaction
 * @param {object} ctx - getGame, getDeploymentZones, getFigureSize, getFootprintCells, filterValidTopLeftSpaces, getDeploySpaceGridRows, getDeploymentMapAttachment, client
 */
export async function handleDeploymentFig(interaction, ctx) {
  const {
    getGame,
    getDeploymentZones,
    getFigureSize,
    getFootprintCells,
    filterValidTopLeftSpaces,
    getDeploySpaceGridRows,
    getDeploymentMapAttachment,
    client,
  } = ctx;
  const parts = interaction.customId.split('_');
  if (parts.length < 5) {
    await interaction.followUp({ content: 'Invalid button.', ephemeral: true }).catch(discordCatch);
    return;
  }
  const gameId = parts[2];
  const playerNum = parseInt(parts[3], 10);
  const flatIndex = parseInt(parts[4], 10);
  const game = await requireGame(interaction, getGame, gameId);
  if (!game) return;
  const ownerId = getPlayerId(game, playerNum);
  if (interaction.user.id !== ownerId) {
    await interaction.followUp({ content: 'Only the owner of this deck can deploy.', ephemeral: true }).catch(discordCatch);
    return;
  }
  const labels = game[_deployLabelsKey(playerNum)];
  const label = labels?.[flatIndex];
  if (!label) {
    await interaction.followUp({ content: 'Figure not found.', ephemeral: true }).catch(discordCatch);
    return;
  }
  const mapId = game.selectedMap?.id;
  const zones = mapId ? getDeploymentZones()[mapId] : null;
  const initiativePlayerNum = getInitiativePlayerNum(game);
  const playerZone = playerNum === initiativePlayerNum ? game.deploymentZoneChosen : (game.deploymentZoneChosen === 'red' ? 'blue' : 'red');
  const deployMeta = game[_deployMetadataKey(playerNum)];
  const figMeta = deployMeta?.[flatIndex];
  const figureKey = figMeta ? `${figMeta.dcName}-${figMeta.dgIndex}-${figMeta.figureIndex}` : null;
  // Block deploying Lie in Ambush set-aside figures
  if (figureKey && game.lieInAmbushSetAside?.[playerNum]?.includes(figureKey)) {
    await interaction.followUp({ content: 'This group is set aside via **Lie in Ambush** and cannot deploy during the deployment phase.', ephemeral: true }).catch(discordCatch);
    return;
  }
  const occupied = [];
  if (game.figurePositions) {
    for (const p of [1, 2]) {
      for (const [k, s] of Object.entries(game.figurePositions[p] || {})) {
        if (p === playerNum && k === figureKey) continue;
        const dcName = dcNameFromFigureKey(k);
        const size = game.figureOrientations?.[k] || getFigureSize(dcName);
        occupied.push(...getFootprintCells(s, size));
      }
    }
  }
  const zoneSpaces = (zones?.[playerZone] || []).map((s) => String(s).toLowerCase());
  const dcName = figMeta?.dcName;
  const figureSize = dcName ? getFigureSize(dcName) : '1x1';
  const isLarge = figureSize !== '1x1';
  const needsOrientation = figureSize === '2x3' || figureSize === '1x2';
  if (zoneSpaces.length > 0 && needsOrientation) {
    const orientationButtons = figureSize === '2x3'
      ? [
          new ButtonBuilder()
            .setCustomId(`deployment_orient_${gameId}_${playerNum}_${flatIndex}_2x3`)
            .setLabel('2\u00d73 (2 wide, 3 tall)')
            .setStyle(ButtonStyle.Primary),
          new ButtonBuilder()
            .setCustomId(`deployment_orient_${gameId}_${playerNum}_${flatIndex}_3x2`)
            .setLabel('3\u00d72 (3 wide, 2 tall)')
            .setStyle(ButtonStyle.Primary),
        ]
      : [
          new ButtonBuilder()
            .setCustomId(`deployment_orient_${gameId}_${playerNum}_${flatIndex}_1x2`)
            .setLabel('1\u00d72 (1 wide, 2 tall)')
            .setStyle(ButtonStyle.Primary),
          new ButtonBuilder()
            .setCustomId(`deployment_orient_${gameId}_${playerNum}_${flatIndex}_2x1`)
            .setLabel('2\u00d71 (2 wide, 1 tall)')
            .setStyle(ButtonStyle.Primary),
        ];
    const orientationRow = new ActionRowBuilder().addComponents(...orientationButtons);
    await interaction.followUp({
      content: `Choose orientation for **${label.replace(/^Deploy /, '')}** (large unit):`,
      components: [orientationRow],
      ephemeral: false,
    }).catch(discordCatch);
    return;
  }
  const { blocking, ignoreBlocking } = getDeployBlockingInfo(game, dcName);
  // Zone is NOT extended for Massive — figures must deploy within the zone.
  // ignoreBlocking lets filterValidTopLeftSpaces allow blocking cells inside the zone.
  const validSpaces = filterValidTopLeftSpaces(zoneSpaces, occupied, figureSize, getFootprintCells, blocking, ignoreBlocking);
  if (zoneSpaces.length > 0) {
    const { rows, available } = getDeploySpaceGridRows(gameId, playerNum, flatIndex, validSpaces, [], playerZone);
    if (available.length === 0) {
      await interaction.followUp({ content: 'No spaces left in your deployment zone (all occupied or no valid spot for this size).', ephemeral: true }).catch(discordCatch);
      return;
    }
    const BTM_PER_MSG = 5;
    game.deploySpaceGridMessageIds = game.deploySpaceGridMessageIds || {};
    const gridKey = `${playerNum}_${flatIndex}`;
    const [fsCols, fsRows] = figureSize.split('x').map(Number);
    const promptText = isLarge
      ? `Pick the **top-left square** for **${label.replace(/^Deploy /, '')}** (${figureSize} unit — ${fsCols} wide, ${fsRows} tall):`
      : `Pick a space for **${label.replace(/^Deploy /, '')}**:`;
    const isInitiative = playerNum === initiativePlayerNum;
    const idsKey = isInitiative ? 'initiativeDeployMessageIds' : 'nonInitiativeDeployMessageIds';
    const deployMsgIds = game[idsKey] || [];
    const firstDeployMsgId = deployMsgIds[0];
    if (firstDeployMsgId) {
      try {
        const handId = getHandChannelId(game, playerNum);
        const handChannel = await client.channels.fetch(handId);
        const deployMsg = await handChannel.messages.fetch(firstDeployMsgId);
        await deployMsg.edit({ attachments: [] });
      } catch {}
    }
    const mapAttachment = await getDeploymentMapAttachment(game, playerZone);
    // If too many rows for one message, use two-tier row picker
    const useRowPicker = rows.length > BTM_PER_MSG;
    if (useRowPicker) {
      const { buildDeployRowButtons } = ctx;
      const { rows: rowBtns } = buildDeployRowButtons(gameId, playerNum, flatIndex, validSpaces, [], playerZone);
      const replyPayload = { content: `${promptText}\nChoose a row:`, components: rowBtns.slice(0, BTM_PER_MSG), ephemeral: false, fetchReply: true };
      if (mapAttachment) replyPayload.files = [mapAttachment];
      const replyMsg = await interaction.followUp(replyPayload).catch(() => null);
      const gridIds = [];
      if (replyMsg?.id) gridIds.push(replyMsg.id);
      game.deploySpaceGridMessageIds[gridKey] = gridIds;
    } else {
      const firstRows = rows.slice(0, BTM_PER_MSG);
      const replyPayload = { content: promptText, components: firstRows, ephemeral: false, fetchReply: true };
      if (mapAttachment) replyPayload.files = [mapAttachment];
      const replyMsg = await interaction.followUp(replyPayload).catch(() => null);
      const gridIds = [];
      if (replyMsg?.id) gridIds.push(replyMsg.id);
      game.deploySpaceGridMessageIds[gridKey] = gridIds;
    }
  } else {
    const modal = new ModalBuilder()
      .setCustomId(`deploy_modal_${gameId}_${playerNum}_${flatIndex}`)
      .setTitle('Deploy figure');
    modal.addComponents(
      new ActionRowBuilder().addComponents(
        new TextInputBuilder()
          .setCustomId('deploy_space')
          .setLabel('Space (e.g. A1)')
          .setStyle(TextInputStyle.Short)
          .setPlaceholder('e.g. A1')
          .setRequired(true)
      )
    );
    await interaction.showModal(modal).catch(discordCatch);
  }
}

/**
 * @param {import('discord.js').ButtonInteraction} interaction
 * @param {object} ctx - getGame, getDeploymentZones, getFigureSize, getFootprintCells, filterValidTopLeftSpaces, getDeploySpaceGridRows, getDeploymentMapAttachment, client
 */
export async function handleDeploymentOrient(interaction, ctx) {
  const {
    getGame,
    getDeploymentZones,
    getFigureSize,
    getFootprintCells,
    filterValidTopLeftSpaces,
    getDeploySpaceGridRows,
    getDeploymentMapAttachment,
    client,
  } = ctx;
  const parts = interaction.customId.split('_');
  if (parts.length < 6) {
    await interaction.followUp({ content: 'Invalid button.', ephemeral: true }).catch(discordCatch);
    return;
  }
  const gameId = parts[2];
  const playerNum = parseInt(parts[3], 10);
  const flatIndex = parseInt(parts[4], 10);
  const orientation = parts[5];
  const game = await requireGame(interaction, getGame, gameId);
  if (!game) return;
  const ownerId = getPlayerId(game, playerNum);
  if (interaction.user.id !== ownerId) {
    await interaction.followUp({ content: 'Only the owner of this deck can deploy.', ephemeral: true }).catch(discordCatch);
    return;
  }
  const labels = game[_deployLabelsKey(playerNum)];
  const deployMeta = game[_deployMetadataKey(playerNum)];
  const label = labels?.[flatIndex];
  const figMeta = deployMeta?.[flatIndex];
  if (!label || !figMeta) {
    await interaction.followUp({ content: 'Figure not found.', ephemeral: true }).catch(discordCatch);
    return;
  }
  const figureKey = `${figMeta.dcName}-${figMeta.dgIndex}-${figMeta.figureIndex}`;
  game.pendingDeployOrientation = game.pendingDeployOrientation || {};
  game.pendingDeployOrientation[`${playerNum}_${flatIndex}`] = orientation;
  const mapId = game.selectedMap?.id;
  const zones = mapId ? getDeploymentZones()[mapId] : null;
  const initiativePlayerNum = getInitiativePlayerNum(game);
  const playerZone = playerNum === initiativePlayerNum ? game.deploymentZoneChosen : (game.deploymentZoneChosen === 'red' ? 'blue' : 'red');
  const occupied = [];
  if (game.figurePositions) {
    for (const p of [1, 2]) {
      for (const [k, s] of Object.entries(game.figurePositions[p] || {})) {
        if (p === playerNum && k === figureKey) continue;
        const dcName = dcNameFromFigureKey(k);
        const size = game.figureOrientations?.[k] || getFigureSize(dcName);
        occupied.push(...getFootprintCells(s, size));
      }
    }
  }
  const zoneSpaces = (zones?.[playerZone] || []).map((s) => String(s).toLowerCase());
  const { blocking, ignoreBlocking } = getDeployBlockingInfo(game, figMeta.dcName);
  const validSpaces = filterValidTopLeftSpaces(zoneSpaces, occupied, orientation, getFootprintCells, blocking, ignoreBlocking);
  if (validSpaces.length === 0) {
    delete game.pendingDeployOrientation[`${playerNum}_${flatIndex}`];
    await interaction.followUp({ content: 'No valid spots for this orientation in your zone. Try the other orientation.', ephemeral: true }).catch(discordCatch);
    return;
  }
  const { rows } = getDeploySpaceGridRows(gameId, playerNum, flatIndex, validSpaces, [], playerZone);
  const BTM_PER_MSG = 5;
  game.deploySpaceGridMessageIds = game.deploySpaceGridMessageIds || {};
  const gridKey = `${playerNum}_${flatIndex}`;
  const gridIds = [];
  const useRowPicker = rows.length > BTM_PER_MSG;
  try {
    const isInitiative = playerNum === initiativePlayerNum;
    const idsKey = isInitiative ? 'initiativeDeployMessageIds' : 'nonInitiativeDeployMessageIds';
    const deployMsgIds = game[idsKey] || [];
    const firstDeployMsgId = deployMsgIds[0];
    if (firstDeployMsgId) {
      try {
        const handId = getHandChannelId(game, playerNum);
        const handChannel = await client.channels.fetch(handId);
        const deployMsg = await handChannel.messages.fetch(firstDeployMsgId);
        await deployMsg.edit({ attachments: [] });
      } catch {}
    }
    const mapAttachment = await getDeploymentMapAttachment(game, playerZone);
    const [oCols, oRows] = orientation.split('x').map(Number);
    const promptText = `Pick the **top-left square** for **${label.replace(/^Deploy /, '')}** (${orientation} unit — ${oCols} wide, ${oRows} tall):`;
    if (useRowPicker) {
      const { buildDeployRowButtons } = ctx;
      const { rows: rowBtns } = buildDeployRowButtons(gameId, playerNum, flatIndex, validSpaces, [], playerZone);
      const editPayload = { content: `${promptText}\nChoose a row:`, components: rowBtns.slice(0, BTM_PER_MSG) };
      if (mapAttachment) editPayload.files = [mapAttachment];
      await interaction.message.edit(editPayload);
      if (interaction.message?.id) gridIds.push(interaction.message.id);
    } else {
      const firstRows = rows.slice(0, BTM_PER_MSG);
      const editPayload = { content: promptText, components: firstRows };
      if (mapAttachment) editPayload.files = [mapAttachment];
      await interaction.message.edit(editPayload);
      if (interaction.message?.id) gridIds.push(interaction.message.id);
    }
  } catch (err) {
    console.error('Failed to show deploy grid after orientation:', err);
  }
  game.deploySpaceGridMessageIds[gridKey] = gridIds;
}

/**
 * Second tier of the deploy row picker: user clicked "Row X" → show spaces in that row.
 * @param {import('discord.js').ButtonInteraction} interaction
 * @param {object} ctx - getGame, getDeploymentZones, getFigureSize, getFootprintCells, filterValidTopLeftSpaces, getDeploySpaceGridRows, buildDeployRowButtons, client
 */
export async function handleDeployRow(interaction, ctx) {
  const match = interaction.customId.match(/^deploy_row_([^_]+)_(\d+)_(\d+)_(\d+)$/);
  if (!match) {
    await interaction.followUp({ content: 'Invalid button.', ephemeral: true }).catch(discordCatch);
    return;
  }
  const [, gameId, playerNumStr, flatIndexStr, rowNumStr] = match;
  const playerNum = parseInt(playerNumStr, 10);
  const flatIndex = parseInt(flatIndexStr, 10);
  const rowNum = parseInt(rowNumStr, 10);
  const { getGame, getDeploymentZones, getFigureSize, getFootprintCells, filterValidTopLeftSpaces, getDeploySpaceGridRows, buildDeployRowButtons, client } = ctx;
  const game = await requireGame(interaction, getGame, gameId);
  if (!game) return;
  const ownerId = getPlayerId(game, playerNum);
  if (interaction.user.id !== ownerId) {
    await interaction.followUp({ content: 'Only the owner of this deck can deploy.', ephemeral: true }).catch(discordCatch);
    return;
  }
  const mapId = game.selectedMap?.id;
  const zones = mapId ? getDeploymentZones()[mapId] : null;
  const initiativePlayerNum = getInitiativePlayerNum(game);
  const playerZone = playerNum === initiativePlayerNum ? game.deploymentZoneChosen : (game.deploymentZoneChosen === 'red' ? 'blue' : 'red');
  const deployMeta = game[_deployMetadataKey(playerNum)];
  const figMeta = deployMeta?.[flatIndex];
  const figureKey = figMeta ? `${figMeta.dcName}-${figMeta.dgIndex}-${figMeta.figureIndex}` : null;
  const occupied = [];
  if (game.figurePositions) {
    for (const p of [1, 2]) {
      for (const [k, s] of Object.entries(game.figurePositions[p] || {})) {
        if (p === playerNum && k === figureKey) continue;
        const dcName = dcNameFromFigureKey(k);
        const size = game.figureOrientations?.[k] || getFigureSize(dcName);
        occupied.push(...getFootprintCells(s, size));
      }
    }
  }
  const zoneSpaces = (zones?.[playerZone] || []).map((s) => String(s).toLowerCase());
  const dcName = figMeta?.dcName;
  const figureSize = game.pendingDeployOrientation?.[`${playerNum}_${flatIndex}`] || (dcName ? getFigureSize(dcName) : '1x1');
  const { blocking, ignoreBlocking } = getDeployBlockingInfo(game, dcName);
  const validSpaces = filterValidTopLeftSpaces(zoneSpaces, occupied, figureSize, getFootprintCells, blocking, ignoreBlocking);
  // Filter to only spaces in the chosen row
  const rowSpaces = validSpaces.filter((s) => {
    const m = s.match(/^[a-z]+(\d+)$/i);
    return m && parseInt(m[1], 10) === rowNum;
  });
  if (rowSpaces.length === 0) {
    await interaction.followUp({ content: `No available spaces in Row ${rowNum}.`, ephemeral: true }).catch(discordCatch);
    return;
  }
  const zoneStyle = playerZone === 'red' ? ButtonStyle.Danger : ButtonStyle.Primary;
  rowSpaces.sort((a, b) => (a || '').localeCompare(b || ''));
  const btns = rowSpaces.map((space) =>
    new ButtonBuilder()
      .setCustomId(`deploy_pick_${gameId}_${playerNum}_${flatIndex}_${space}`)
      .setLabel(space.toUpperCase())
      .setStyle(zoneStyle)
  );
  const spaceRows = [];
  for (let i = 0; i < btns.length; i += 5) {
    spaceRows.push(new ActionRowBuilder().addComponents(btns.slice(i, i + 5)));
  }
  // Add a "back to rows" button
  const backRow = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`deploy_row_back_${gameId}_${playerNum}_${flatIndex}`)
      .setLabel('Back to Rows')
      .setStyle(ButtonStyle.Secondary)
  );
  const components = [...spaceRows.slice(0, 4), backRow];
  // Clear previous grid messages
  const gridKey = `${playerNum}_${flatIndex}`;
  const oldGridIds = game.deploySpaceGridMessageIds?.[gridKey] || [];
  const currentMsgId = interaction.message.id;
  for (const id of oldGridIds) {
    if (id === currentMsgId) continue;
    try {
      const msg = await interaction.channel.messages.fetch(id);
      await msg.delete();
    } catch {}
  }
  try {
    await interaction.message.edit({ content: `**Row ${rowNum}** — pick a space:`, components });
  } catch {
    await interaction.followUp({ content: `**Row ${rowNum}** — pick a space:`, components, ephemeral: false }).catch(() => null);
  }
  game.deploySpaceGridMessageIds = game.deploySpaceGridMessageIds || {};
  game.deploySpaceGridMessageIds[gridKey] = [interaction.message.id];
}

/**
 * Handle deploy_row_back_ button: return to the row picker.
 * @param {import('discord.js').ButtonInteraction} interaction
 * @param {object} ctx
 */
export async function handleDeployRowBack(interaction, ctx) {
  const match = interaction.customId.match(/^deploy_row_back_([^_]+)_(\d+)_(\d+)$/);
  if (!match) {
    await interaction.followUp({ content: 'Invalid button.', ephemeral: true }).catch(discordCatch);
    return;
  }
  const [, gameId, playerNumStr, flatIndexStr] = match;
  const playerNum = parseInt(playerNumStr, 10);
  const flatIndex = parseInt(flatIndexStr, 10);
  const { getGame, getDeploymentZones, getFigureSize, getFootprintCells, filterValidTopLeftSpaces, buildDeployRowButtons } = ctx;
  const game = await requireGame(interaction, getGame, gameId);
  if (!game) return;
  const ownerId = getPlayerId(game, playerNum);
  if (interaction.user.id !== ownerId) {
    await interaction.followUp({ content: 'Only the owner can deploy.', ephemeral: true }).catch(discordCatch);
    return;
  }
  const mapId = game.selectedMap?.id;
  const zones = mapId ? getDeploymentZones()[mapId] : null;
  const initiativePlayerNum = getInitiativePlayerNum(game);
  const playerZone = playerNum === initiativePlayerNum ? game.deploymentZoneChosen : (game.deploymentZoneChosen === 'red' ? 'blue' : 'red');
  const deployMeta = game[_deployMetadataKey(playerNum)];
  const figMeta = deployMeta?.[flatIndex];
  const figureKey = figMeta ? `${figMeta.dcName}-${figMeta.dgIndex}-${figMeta.figureIndex}` : null;
  const occupied = [];
  if (game.figurePositions) {
    for (const p of [1, 2]) {
      for (const [k, s] of Object.entries(game.figurePositions[p] || {})) {
        if (p === playerNum && k === figureKey) continue;
        const dcName = dcNameFromFigureKey(k);
        const size = game.figureOrientations?.[k] || getFigureSize(dcName);
        occupied.push(...getFootprintCells(s, size));
      }
    }
  }
  const zoneSpaces = (zones?.[playerZone] || []).map((s) => String(s).toLowerCase());
  const dcName = figMeta?.dcName;
  const figureSize = game.pendingDeployOrientation?.[`${playerNum}_${flatIndex}`] || (dcName ? getFigureSize(dcName) : '1x1');
  const { blocking, ignoreBlocking } = getDeployBlockingInfo(game, dcName);
  const validSpaces = filterValidTopLeftSpaces(zoneSpaces, occupied, figureSize, getFootprintCells, blocking, ignoreBlocking);
  const labels = game[_deployLabelsKey(playerNum)];
  const label = labels?.[flatIndex] || 'figure';
  const isLarge = figureSize !== '1x1';
  const promptText = isLarge
    ? `Pick the **top-left square** for **${label.replace(/^Deploy /, '')}** (${figureSize} unit):`
    : `Pick a space for **${label.replace(/^Deploy /, '')}**:`;
  const { rows: rowBtns } = buildDeployRowButtons(gameId, playerNum, flatIndex, validSpaces, [], playerZone);
  try {
    await interaction.message.edit({ content: `${promptText}\nChoose a row:`, components: rowBtns.slice(0, 5) });
  } catch {
    await interaction.followUp({ content: `${promptText}\nChoose a row:`, components: rowBtns.slice(0, 5), ephemeral: false }).catch(() => null);
  }
}

/**
 * @param {import('discord.js').ButtonInteraction} interaction
 * @param {object} ctx - getGame, logGameAction, pushUndo, updateDeployPromptMessages, buildBoardMapPayload, client, saveGames
 */
export async function handleDeployPick(interaction, ctx) {
  const { getGame, logGameAction, pushUndo, updateDeployPromptMessages, buildBoardMapPayload, client, saveGames } = ctx;
  const match = interaction.customId.match(/^deploy_pick_([^_]+)_(\d+)_(\d+)_(.+)$/);
  if (!match) {
    await interaction.followUp({ content: 'Invalid button.', ephemeral: true }).catch(discordCatch);
    return;
  }
  const [, gameId, playerNumStr, flatIndexStr, space] = match;
  const playerNum = parseInt(playerNumStr, 10);
  const flatIndex = parseInt(flatIndexStr, 10);
  const game = await requireGame(interaction, getGame, gameId);
  if (!game) return;
  const ownerId = getPlayerId(game, playerNum);
  if (interaction.user.id !== ownerId) {
    await interaction.followUp({ content: 'Only the owner of this deck can deploy.', ephemeral: true }).catch(discordCatch);
    return;
  }
  const deployMeta = game[_deployMetadataKey(playerNum)];
  const deployLabels = game[_deployLabelsKey(playerNum)];
  const figMeta = deployMeta?.[flatIndex];
  const figLabel = deployLabels?.[flatIndex];
  if (!figMeta || !figLabel) {
    await interaction.followUp({ content: 'Figure not found.', ephemeral: true }).catch(discordCatch);
    return;
  }
  const figureKey = `${figMeta.dcName}-${figMeta.dgIndex}-${figMeta.figureIndex}`;
  if (!game.figurePositions) game.figurePositions = { 1: {}, 2: {} };
  if (!game.figurePositions[playerNum]) game.figurePositions[playerNum] = {};
  game.figurePositions[playerNum][figureKey] = space.toLowerCase();
  const pendingOrientation = game.pendingDeployOrientation?.[`${playerNum}_${flatIndex}`];
  if (pendingOrientation) {
    game.figureOrientations = game.figureOrientations || {};
    game.figureOrientations[figureKey] = pendingOrientation;
    delete game.pendingDeployOrientation[`${playerNum}_${flatIndex}`];
  }
  saveGames();
  const spaceUpper = space.toUpperCase();
  const gridKey = `${playerNum}_${flatIndex}`;
  const gridMsgIds = game.deploySpaceGridMessageIds?.[gridKey] || [];
  const clickedMsgId = interaction.message?.id;
  if (gridMsgIds.length > 0) {
    try {
      const handId = getHandChannelId(game, playerNum);
      const handChannel = await client.channels.fetch(handId);
      for (const msgId of gridMsgIds) {
        if (msgId === clickedMsgId) continue;
        try {
          const msg = await handChannel.messages.fetch(msgId);
          await msg.delete();
        } catch {}
      }
    } catch (err) {
      console.error('Failed to delete space grid messages:', err);
    }
    if (game.deploySpaceGridMessageIds) {
      delete game.deploySpaceGridMessageIds[gridKey];
    }
  }
  const initiativePlayerNum = getInitiativePlayerNum(game);
  const isInitiative = playerNum === initiativePlayerNum;
  const confirmIdsKey = isInitiative ? 'initiativeDeployedConfirmIds' : 'nonInitiativeDeployedConfirmIds';
  if (clickedMsgId) {
    game[confirmIdsKey] = game[confirmIdsKey] || [];
    game[confirmIdsKey].push(clickedMsgId);
  }
  const deployLogMsg = await logGameAction(game, client, `<@${interaction.user.id}> deployed **${figLabel.replace(/^Deploy /, '')}** at **${spaceUpper}**`, { allowedMentions: { users: [interaction.user.id] }, phase: 'DEPLOYMENT', icon: 'deploy' });
  pushUndo(game, {
    type: 'deploy_pick',
    playerNum,
    figureKey,
    space: spaceUpper,
    figLabel: figLabel.replace(/^Deploy /, ''),
    gameLogMessageId: deployLogMsg?.id,
  });
  await updateDeployPromptMessages(game, playerNum, client);
  if (game.boardId && game.selectedMap) {
    try {
      const boardChannel = await client.channels.fetch(game.boardId);
      const payload = await buildBoardMapPayload(game.gameId, game.selectedMap, game);
      await boardChannel.send(payload);
    } catch (err) {
      console.error('Failed to update map after deployment:', err);
    }
  }
  await interaction.editReply({
    content: `✓ Deployed **${figLabel.replace(/^Deploy /, '')}** at **${spaceUpper}**.`,
    components: [],
    attachments: [],
  }).catch(discordCatch);

  // Imperial Loadout: if Purge Trooper (Elite) was just deployed, show loadout picker
  const dcEff = getDcEffects()?.[figMeta.dcName];
  if (dcEff?.specialAbilityIds?.includes('imperial_loadout_purge_trooper')) {
    const loadoutCards = getLoadoutCards();
    const names = Object.keys(loadoutCards);
    if (names.length > 0) {
      const row = new ActionRowBuilder().addComponents(
        ...names.map((name) =>
          new ButtonBuilder()
            .setCustomId(`loadout_pick_${game.gameId}_${figureKey}_${name}`)
            .setLabel(name)
            .setStyle(ButtonStyle.Primary)
        )
      );
      try {
        const handId = getHandChannelId(game, playerNum);
        const handChannel = await client.channels.fetch(handId);
        await handChannel.send({
          content: `⚔️ **Imperial Loadout** — Choose a Loadout card for **${figMeta.dcName}**:`,
          components: [row],
        });
      } catch (err) {
        console.error('Failed to send loadout picker:', err);
      }
    }
  }

  // Shape (Clawdite Shapeshifter): show form picker after deployment
  const _shapeIds = ['shape_clawdite_elite', 'shape_clawdite_reg'];
  if (dcEff?.specialAbilityIds?.some(id => _shapeIds.includes(id))) {
    const formCards = getFormCards();
    const takenForms = getFormsChosenByTeamClawdites(game, playerNum, figureKey);
    const formNames = Object.keys(formCards).filter(n => !takenForms.has(n));
    if (formNames.length > 0) {
      const row = new ActionRowBuilder().addComponents(
        ...formNames.map((name) =>
          new ButtonBuilder()
            .setCustomId(`form_pick_${game.gameId}_${figureKey}_${name}`)
            .setLabel(name)
            .setStyle(ButtonStyle.Primary)
        )
      );
      try {
        const handId = getHandChannelId(game, playerNum);
        const handChannel = await client.channels.fetch(handId);
        await handChannel.send({
          content: `🔄 **Shape** — Choose a Form card for **${figMeta.dcName}**:`,
          components: [row],
        });
      } catch (err) {
        console.error('Failed to send form picker:', err);
      }
    }
  }
}

/**
 * Handle loadout card selection: loadout_pick_{gameId}_{figureKey}_{loadoutName}
 * @param {import('discord.js').ButtonInteraction} interaction
 * @param {object} ctx - getGame, logGameAction, client, saveGames
 */
export async function handleLoadoutPick(interaction, ctx) {
  await interaction.deferUpdate().catch(discordCatch);
  const { getGame, logGameAction, client, saveGames } = ctx;
  // Parse: loadout_pick_{gameId}_{dcName}-{dgIdx}-{figIdx}_{loadoutName}
  const prefix = 'loadout_pick_';
  const rest = interaction.customId.slice(prefix.length);
  const gameIdEnd = rest.indexOf('_');
  if (gameIdEnd < 0) return;
  const gameId = rest.slice(0, gameIdEnd);
  const afterGameId = rest.slice(gameIdEnd + 1);
  // figureKey is dcName-dgIdx-figIdx, loadoutName follows after last _ that's part of loadout
  // Since DC names can contain spaces/hyphens, figure key ends at -\d+-\d+_
  const fkMatch = afterGameId.match(/^(.+-\d+-\d+)_(.+)$/);
  if (!fkMatch) return;
  const [, figureKey, loadoutName] = fkMatch;
  const game = await requireGame(interaction, getGame, gameId, { silent: true });
  if (!game) return;

  const loadoutCards = getLoadoutCards();
  const card = loadoutCards[loadoutName];
  if (!card) return;

  setConfig(game, figureKey, 'loadout', loadoutName);
  saveGames();

  // Show chosen card image and update the message
  const { join } = await import('path');
  const { getRootDir } = await import('../data-loader.js');
  const files = [];
  if (card.imagePath) {
    try {
      files.push(new AttachmentBuilder(join(getRootDir(), card.imagePath)));
    } catch {}
  }
  await interaction.message.edit({
    content: `✓ **Imperial Loadout** — **${dcNameFromFigureKey(figureKey)}** equipped **${loadoutName}**.\n${card.abilityText}`,
    components: [],
    files,
  }).catch(discordCatch);
  await logGameAction?.(game, client, `**Imperial Loadout** — **${dcNameFromFigureKey(figureKey)}** chose **${loadoutName}**.`, { phase: 'DEPLOYMENT', icon: 'deploy' });
}

/**
 * Handle form card selection (deployment or round-start shift): form_pick_{gameId}_{figureKey}_{formName}
 */
export async function handleFormPick(interaction, ctx) {
  await interaction.deferUpdate().catch(discordCatch);
  const { getGame, logGameAction, client, saveGames } = ctx;
  const prefix = 'form_pick_';
  const rest = interaction.customId.slice(prefix.length);
  const gameIdEnd = rest.indexOf('_');
  if (gameIdEnd < 0) return;
  const gameId = rest.slice(0, gameIdEnd);
  const afterGameId = rest.slice(gameIdEnd + 1);
  const fkMatch = afterGameId.match(/^(.+-\d+-\d+)_(.+)$/);
  if (!fkMatch) return;
  const [, figureKey, formName] = fkMatch;
  const game = await requireGame(interaction, getGame, gameId, { silent: true });
  if (!game) return;
  const formCards = getFormCards();
  const card = formCards[formName];
  if (!card) return;

  // Determine which player owns this figure
  const ownerPlayerNum = game.figurePositions?.[1]?.[figureKey] != null ? 1
    : game.figurePositions?.[2]?.[figureKey] != null ? 2 : null;

  // Reject if another Clawdite on the same team already has this form
  if (ownerPlayerNum) {
    const takenForms = getFormsChosenByTeamClawdites(game, ownerPlayerNum, figureKey);
    if (takenForms.has(formName)) {
      await interaction.message.edit({
        content: `❌ **${formName}** is already chosen by another Clawdite on your team. Pick a different form.`,
        components: interaction.message.components,
      }).catch(discordCatch);
      return;
    }
  }

  setConfig(game, figureKey, 'form', formName);
  saveGames();
  const { join } = await import('path');
  const { getRootDir } = await import('../data-loader.js');
  const files = [];
  if (card.imagePath) {
    try { files.push(new AttachmentBuilder(join(getRootDir(), card.imagePath))); } catch {}
  }
  const dcName = dcNameFromFigureKey(figureKey);
  await interaction.message.edit({
    content: `✓ **Form: ${formName}** — **${dcName}** gains ${formName} abilities.\n${card.abilityText}`,
    components: [],
    files,
  }).catch(discordCatch);
  const isRoundShift = (game.currentRound || 0) >= 1 && game.p1ActivationsRemaining != null;
  await logGameAction?.(game, client, `🔄 **${isRoundShift ? 'Shift' : 'Shape'}** — **${dcName}** chose **${formName}** form.`, { phase: isRoundShift ? 'ROUND' : 'DEPLOYMENT', icon: isRoundShift ? 'round' : 'deploy' });
}

/**
 * @param {import('discord.js').ButtonInteraction} interaction
 * @param {object} ctx - getGame, logGameAction, getDeployFigureLabels, getDeployButtonRows, getDeploymentMapAttachment, getInitiativePlayerZoneLabel, clearPreGameSetup, getCcShuffleDrawButton, buildBoardMapPayload, client, saveGames, isDcAttachment, resolveDcName, isFigurelessDc
 */
export async function handleDeploymentDone(interaction, ctx) {
  const {
    getGame,
    logGameAction,
    getDeployFigureLabels,
    getDeployButtonRows,
    getDeploymentMapAttachment,
    getInitiativePlayerZoneLabel,
    clearPreGameSetup,
    getCcShuffleDrawButton,
    buildBoardMapPayload,
    client,
    saveGames,
    isDcAttachment,
    resolveDcName,
    isFigurelessDc,
    finishSetupAttachments,
  } = ctx;
  const gameId = interaction.customId.replace('deployment_done_', '');
  const game = await requireGame(interaction, getGame, gameId);
  if (!game) return;
  if (interaction.user.id !== game.player1Id && interaction.user.id !== game.player2Id) {
    await interaction.followUp({ content: 'Only players in this game can use this.', ephemeral: true }).catch(discordCatch);
    return;
  }
  const channelId = interaction.channel?.id;
  const isP1Hand = channelId === game.p1HandId;
  const isP2Hand = channelId === game.p2HandId;
  if (!isP1Hand && !isP2Hand) {
    await interaction.followUp({ content: 'Use the Deployment Completed button in your **Your Hand** thread (inside your Play Area).', ephemeral: true }).catch(discordCatch);
    return;
  }
  const initiativePlayerNum = getInitiativePlayerNum(game);
  const isInitiativeSide = (isP1Hand && initiativePlayerNum === 1) || (isP2Hand && initiativePlayerNum === 2);
  const otherZone = game.deploymentZoneChosen === 'red' ? 'blue' : 'red';

  if (isInitiativeSide) {
    if (game.initiativePlayerDeployed) {
      await interaction.followUp({ content: "You've already marked deployed.", ephemeral: true }).catch(discordCatch);
      return;
    }
    game.initiativePlayerDeployed = true;
    await logGameAction(game, client, `<@${interaction.user.id}> finished deploying`, { allowedMentions: { users: [interaction.user.id] }, phase: 'DEPLOYMENT', icon: 'deployed' });
    const initiativeHandId = game.initiativePlayerId === game.player1Id ? game.p1HandId : game.p2HandId;
    try {
      const handChannel = await client.channels.fetch(initiativeHandId);
      const toDelete = [...(game.initiativeDeployMessageIds || []), ...(game.initiativeDeployedConfirmIds || [])];
      for (const msgId of toDelete) {
        try { await (await handChannel.messages.fetch(msgId)).delete(); } catch {}
      }
      game.initiativeDeployMessageIds = [];
      game.initiativeDeployedConfirmIds = [];
      await handChannel.send({ content: '✓ **Deployed.**' });
    } catch (err) {
      console.error('Failed to update initiative deploy message:', err);
    }
    if (game.boardId && game.selectedMap) {
      try {
        const boardChannel = await client.channels.fetch(game.boardId);
        const payload = await buildBoardMapPayload(game.gameId, game.selectedMap, game);
        await boardChannel.send(payload);
      } catch (err) {
        console.error('Failed to update map after initiative deployment:', err);
      }
    }
    const nonInitiativeHandId = game.initiativePlayerId === game.player1Id ? game.p2HandId : game.p1HandId;
    const nonInitiativePlayerNum = opponentPlayerNum(getInitiativePlayerNum(game));
    const nonInitiativeSquad = getSquad(game, nonInitiativePlayerNum);
    const nonInitiativeDcList = nonInitiativeSquad?.dcList || [];
    const { labels: nonInitiativeLabels, metadata: nonInitiativeMetadata } = getDeployFigureLabels(nonInitiativeDcList, game);
    const deployLabelsKey = _deployLabelsKey(nonInitiativePlayerNum);
    const deployMetadataKey = _deployMetadataKey(nonInitiativePlayerNum);
    game[deployLabelsKey] = nonInitiativeLabels;
    game[deployMetadataKey] = nonInitiativeMetadata;
    if (!game.figurePositions) game.figurePositions = { 1: {}, 2: {} };
    try {
      const nonInitiativePlayerId = getPlayerId(game, nonInitiativePlayerNum);
      const nonInitiativeHandChannel = await client.channels.fetch(nonInitiativeHandId);
      const { deployRows, doneRow } = getDeployButtonRows(gameId, nonInitiativePlayerNum, nonInitiativeDcList, otherZone, game.figurePositions, game);
      const DEPLOY_ROWS_PER_MSG = 4;
      game.nonInitiativeDeployMessageIds = game.nonInitiativeDeployMessageIds || [];
      game.nonInitiativeDeployedConfirmIds = game.nonInitiativeDeployedConfirmIds || [];
      const nonInitiativePing = `<@${nonInitiativePlayerId}>`;
      const nonInitMapAttachment = await getDeploymentMapAttachment(game, otherZone);
      if (deployRows.length === 0) {
        const payload = {
          content: `${nonInitiativePing} — Your opponent has deployed. Deploy in the **${otherZone}** zone. When finished, click **Deployment Completed** below.`,
          components: [doneRow],
          allowedMentions: { users: [nonInitiativePlayerId] },
        };
        if (nonInitMapAttachment) payload.files = [nonInitMapAttachment];
        const msg = await nonInitiativeHandChannel.send(payload);
        game.nonInitiativeDeployMessageIds = [msg.id];
      } else {
        for (let i = 0; i < deployRows.length; i += DEPLOY_ROWS_PER_MSG) {
          const chunk = deployRows.slice(i, i + DEPLOY_ROWS_PER_MSG);
          const isLastChunk = i + DEPLOY_ROWS_PER_MSG >= deployRows.length;
          const components = isLastChunk ? [...chunk, doneRow] : chunk;
          const payload = {
            content: i === 0 ? `${nonInitiativePing} — Your opponent has deployed. Deploy each figure in the **${otherZone}** zone below (one per row), then click **Deployment Completed** when finished.\n-# *Auto-Deploy places all figures at your zone entrance(s).*` : null,
            components,
            allowedMentions: { users: [nonInitiativePlayerId] },
          };
          if (i === 0 && nonInitMapAttachment) payload.files = [nonInitMapAttachment];
          const msg = await nonInitiativeHandChannel.send(payload);
          game.nonInitiativeDeployMessageIds.push(msg.id);
        }
      }
      game.nonInitiativeDeployMessageId = game.nonInitiativeDeployMessageIds[game.nonInitiativeDeployMessageIds.length - 1];
    } catch (err) {
      console.error('Failed to send deploy prompt to non-initiative player:', err);
    }
    saveGames();
    return;
  }

  if (!game.initiativePlayerDeployed) {
    await interaction.followUp({ content: 'Wait for the initiative player to deploy first.', ephemeral: true }).catch(discordCatch);
    return;
  }
  if (game.nonInitiativePlayerDeployed) {
    await interaction.followUp({ content: "You've already marked deployed.", ephemeral: true }).catch(discordCatch);
    return;
  }
  game.nonInitiativePlayerDeployed = true;
  const nonInitiativeHandId = game.initiativePlayerId === game.player1Id ? game.p2HandId : game.p1HandId;
  try {
    const handChannel = await client.channels.fetch(nonInitiativeHandId);
    const toDelete = [...(game.nonInitiativeDeployMessageIds || []), ...(game.nonInitiativeDeployedConfirmIds || [])];
    for (const msgId of toDelete) {
      try { await (await handChannel.messages.fetch(msgId)).delete(); } catch {}
    }
    game.nonInitiativeDeployMessageIds = [];
    game.nonInitiativeDeployedConfirmIds = [];
    await handChannel.send({ content: '✓ **Deployed.**' });
  } catch (err) {
    console.error('Failed to update non-initiative deploy message:', err);
  }

  // Phase gate: both players deployed — wait for both to confirm before advancing
  const { sendPhaseGateMessages } = ctx;
  await sendPhaseGateMessages(game, 'deploy_done', ctx);
  saveGames();
}

/**
 * Auto-deploy: place all undeployed figures at entrance spaces (closest to opponent zone centroid).
 * @param {import('discord.js').ButtonInteraction} interaction
 * @param {object} ctx - getGame, getDeploymentZones, getDeployFigureLabels, getFigureSize, getFootprintCells, filterValidTopLeftSpaces, parseCoord, getDeployButtonRows, buildBoardMapPayload, logGameAction, client, saveGames
 */
export async function handleAutoDeploy(interaction, ctx) {
  const {
    getGame,
    getDeploymentZones,
    getDeployFigureLabels,
    getFigureSize,
    getFootprintCells,
    filterValidTopLeftSpaces,
    parseCoord,
    getDeployButtonRows,
    buildBoardMapPayload,
    logGameAction,
    client,
    saveGames,
  } = ctx;
  const parts = interaction.customId.split('_');
  const gameId = parts[2];
  const playerNum = parseInt(parts[3], 10);
  const game = await requireGame(interaction, getGame, gameId);
  if (!game) return;
  const ownerId = getPlayerId(game, playerNum);
  if (interaction.user.id !== ownerId) {
    await interaction.followUp({ content: 'Only the owner of this deck can deploy.', ephemeral: true }).catch(discordCatch);
    return;
  }
  const mapId = game.selectedMap?.id;
  const zones = mapId ? getDeploymentZones()[mapId] : null;
  if (!zones) {
    await interaction.followUp({ content: 'Deployment zones not found.', ephemeral: true }).catch(discordCatch);
    return;
  }
  const initiativePlayerNum = getInitiativePlayerNum(game);
  const playerZone = playerNum === initiativePlayerNum ? game.deploymentZoneChosen : (game.deploymentZoneChosen === 'red' ? 'blue' : 'red');
  const opponentZone = playerZone === 'red' ? 'blue' : 'red';
  if (!game.figurePositions) game.figurePositions = { 1: {}, 2: {} };
  if (!game.figurePositions[playerNum]) game.figurePositions[playerNum] = {};
  game.figureOrientations = game.figureOrientations || {};

  const squad = getSquad(game, playerNum);
  const dcList = squad?.dcList || [];
  const { metadata } = getDeployFigureLabels(dcList, game);

  // Compute centroid of opponent zone to rank spaces by proximity to "entrance"
  const oppZoneCoords = (zones?.[opponentZone] || []).map((s) => parseCoord(String(s).toLowerCase()));
  const oppCx = oppZoneCoords.length ? oppZoneCoords.reduce((s, c) => s + c.col, 0) / oppZoneCoords.length : 0;
  const oppCy = oppZoneCoords.length ? oppZoneCoords.reduce((s, c) => s + c.row, 0) / oppZoneCoords.length : 0;

  // Skip Lie in Ambush set-aside figures
  const setAsideKeys = new Set(game.lieInAmbushSetAside?.[playerNum] || []);

  let placed = 0;
  for (const meta of metadata) {
    const figureKey = `${meta.dcName}-${meta.dgIndex}-${meta.figureIndex}`;
    if (setAsideKeys.has(figureKey)) continue; // Lie in Ambush — deploys later
    if (game.figurePositions[playerNum][figureKey]) continue; // already deployed
    const occupied = [];
    for (const p of [1, 2]) {
      for (const [k, s] of Object.entries(game.figurePositions[p] || {})) {
        const dcName = dcNameFromFigureKey(k);
        const size = game.figureOrientations?.[k] || getFigureSize(dcName);
        occupied.push(...getFootprintCells(s, size));
      }
    }
    const baseSize = getFigureSize(meta.dcName);
    const size = baseSize === '2x3' ? '2x3' : baseSize;
    const zoneSpaces = (zones?.[playerZone] || []).map((s) => String(s).toLowerCase());
    const { blocking, ignoreBlocking } = getDeployBlockingInfo(game, meta.dcName);
    const validSpaces = filterValidTopLeftSpaces(zoneSpaces, occupied, size, getFootprintCells, blocking, ignoreBlocking);
    if (!validSpaces.length) continue;
    validSpaces.sort((a, b) => {
      const pa = parseCoord(a), pb = parseCoord(b);
      const da = Math.abs(pa.col - oppCx) + Math.abs(pa.row - oppCy);
      const db = Math.abs(pb.col - oppCx) + Math.abs(pb.row - oppCy);
      return da - db;
    });
    game.figurePositions[playerNum][figureKey] = validSpaces[0];
    if (baseSize === '2x3') game.figureOrientations[figureKey] = size;
    placed++;
  }

  // Refresh the deploy buttons to show updated positions
  const isInitiative = playerNum === initiativePlayerNum;
  const idsKey = isInitiative ? 'initiativeDeployMessageIds' : 'nonInitiativeDeployMessageIds';
  const handId = getHandChannelId(game, playerNum);
  try {
    const handChannel = await client.channels.fetch(handId);
    // Delete old deploy messages
    const toDelete = game[idsKey] || [];
    for (const msgId of toDelete) {
      try { await (await handChannel.messages.fetch(msgId)).delete(); } catch {}
    }
    game[idsKey] = [];
    // Re-post deploy buttons with updated positions
    const { deployRows, doneRow } = getDeployButtonRows(gameId, playerNum, dcList, playerZone, game.figurePositions, game);
    const DEPLOY_ROWS_PER_MSG = 4;
    const playerId = getPlayerId(game, playerNum);
    for (let i = 0; i < deployRows.length; i += DEPLOY_ROWS_PER_MSG) {
      const chunk = deployRows.slice(i, i + DEPLOY_ROWS_PER_MSG);
      const isLastChunk = i + DEPLOY_ROWS_PER_MSG >= deployRows.length;
      const components = isLastChunk ? [...chunk, doneRow] : chunk;
      const msg = await handChannel.send({
        content: i === 0 ? `Auto-deployed ${placed} figure(s) to the **${playerZone}** zone entrance. You can re-place any figure, then click **Deployment Completed**.` : null,
        components,
      });
      game[idsKey].push(msg.id);
    }
  } catch (err) {
    console.error('Failed to update deploy UI after auto-deploy:', err);
  }

  // Post board update
  if (game.boardId && game.selectedMap) {
    try {
      const boardChannel = await client.channels.fetch(game.boardId);
      const payload = await buildBoardMapPayload(game.gameId, game.selectedMap, game);
      await boardChannel.send(payload);
    } catch (err) {
      console.error('Failed to post board map after auto-deploy:', err?.message ?? err);
    }
  }

  await logGameAction(game, client, `<@${interaction.user.id}> auto-deployed ${placed} figure(s) in the ${playerZone} zone`, { phase: 'DEPLOYMENT', icon: 'deploy' });
  saveGames();
  await interaction.followUp({ content: `Auto-deployed ${placed} figure(s) at the ${playerZone} zone entrance.`, ephemeral: true }).catch(discordCatch);
}

/**
 * Handle setup attachment select: place one attachment CC on chosen DC. When all attachments placed, call finishSetupAttachments.
 * @param {import('discord.js').StringSelectMenuInteraction} interaction
 * @param {object} ctx - getGame, updateAttachmentMessageForDc, StringSelectMenuBuilder, ActionRowBuilder, getCcShuffleDrawButton, clearPreGameSetup, getInitiativePlayerZoneLabel, logGameAction, client, saveGames, finishSetupAttachments
 */
export async function handleSetupAttachTo(interaction, ctx) {
  const { getGame, logGameAction, client, saveGames } = ctx;
  const match = interaction.customId.match(/^setup_attach_to_([^_]+)_([12])$/);
  if (!match) return;
  const [, gameId, playerNumStr] = match;
  const playerNum = parseInt(playerNumStr, 10);
  const game = getGame(gameId);
  if (!game || !game.setupAttachmentPhase || !game.setupAttachmentPending) {
    await interaction.followUp({ content: 'Game or setup phase not found.', ephemeral: true }).catch(discordCatch);
    return;
  }
  const ownerId = getPlayerId(game, playerNum);
  if (interaction.user.id !== ownerId) {
    await interaction.followUp({ content: 'Only the owner of this hand can place setup attachments.', ephemeral: true }).catch(discordCatch);
    return;
  }
  const pending = game.setupAttachmentPending[playerNum];
  if (!pending || pending.length === 0) return;
  const card = pending[0];
  const dcMsgId = interaction.values[0];
  if (!dcMsgId) return;

  // Store choice and show confirmation instead of applying immediately
  game.pendingAttachConfirm = game.pendingAttachConfirm || {};
  game.pendingAttachConfirm[playerNum] = { card, dcMsgId };

  // Remove the dropdown from the original message
  try { await interaction.message.edit({ components: [] }).catch(discordCatch); } catch {}

  const dcDisplayName = ctx.dcMessageMeta?.get(dcMsgId)?.displayName || dcMsgId;
  const confirmRow = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`attach_confirm_${gameId}_${playerNum}`)
      .setLabel('Confirm')
      .setStyle(ButtonStyle.Success),
    new ButtonBuilder()
      .setCustomId(`attach_reselect_${gameId}_${playerNum}`)
      .setLabel('Choose Different Card')
      .setStyle(ButtonStyle.Secondary),
  );
  const handId = getHandChannelId(game, playerNum);
  const handChannel = await client.channels.fetch(handId);
  await handChannel.send({
    content: `Attach **${card}** to **${dcDisplayName}**?`,
    components: [confirmRow],
  });
  saveGames();
}

/**
 * Confirm a pending attachment selection — apply it and proceed.
 */
export async function handleAttachConfirm(interaction, ctx) {
  const { getGame, logGameAction, client, saveGames, finishSetupAttachments } = ctx;
  const match = interaction.customId.match(/^attach_confirm_([^_]+)_([12])$/);
  if (!match) return;
  const [, gameId, playerNumStr] = match;
  const playerNum = parseInt(playerNumStr, 10);
  const game = getGame(gameId);
  if (!game || !game.setupAttachmentPhase || !game.setupAttachmentPending) return;
  const ownerId = getPlayerId(game, playerNum);
  if (interaction.user.id !== ownerId) {
    await interaction.followUp({ content: 'Only the owner of this hand can confirm.', ephemeral: true }).catch(discordCatch);
    return;
  }
  const confirm = game.pendingAttachConfirm?.[playerNum];
  if (!confirm) {
    await interaction.followUp({ content: 'No pending attachment to confirm.', ephemeral: true }).catch(discordCatch);
    return;
  }
  const { card, dcMsgId } = confirm;
  delete game.pendingAttachConfirm[playerNum];

  const pending = game.setupAttachmentPending[playerNum];
  if (!pending || pending.length === 0 || pending[0] !== card) return;

  await applySetupAttachment(game, playerNum, card, dcMsgId, ctx);
  pending.shift();

  // Track applied attachments for potential redo
  game.setupAttachmentApplied = game.setupAttachmentApplied || {};
  game.setupAttachmentApplied[playerNum] = game.setupAttachmentApplied[playerNum] || [];
  game.setupAttachmentApplied[playerNum].push({ card, dcMsgId });

  // Remove confirm buttons
  try { await interaction.message.edit({ content: interaction.message.content, components: [] }).catch(discordCatch); } catch {}

  const dcDisplayName = ctx.dcMessageMeta?.get(dcMsgId)?.displayName || 'DC';
  await logGameAction(game, client, `<@${interaction.user.id}> placed **${card}** on **${dcDisplayName}** (setup).`, { phase: 'SETUP', icon: 'card', allowedMentions: { users: [interaction.user.id] } });

  // Auto-attach any subsequent attachments (skip DCs that already have one)
  const dcList = getDcList(game, playerNum) || [];
  const dcMsgIds = getDcMessageIds(game, playerNum) || [];
  const attached = new Set((game.setupAttachmentApplied?.[playerNum] || []).map(a => a.dcMsgId));
  while (pending.length > 0) {
    const autoTarget = findAutoAttachTarget(pending[0], dcList, dcMsgIds, attached);
    if (!autoTarget) break;
    const autoCard = pending[0];
    await applySetupAttachment(game, playerNum, autoCard, autoTarget, ctx);
    pending.shift();
    game.setupAttachmentApplied[playerNum].push({ card: autoCard, dcMsgId: autoTarget });
    attached.add(autoTarget);
    const autoDisplayName = ctx.dcMessageMeta?.get(autoTarget)?.displayName || 'DC';
    await logGameAction(game, client, `**${autoCard}** auto-attached to **${autoDisplayName}** (setup).`, { phase: 'SETUP', icon: 'card' });
  }

  await _proceedAttachmentPhase(game, gameId, playerNum, interaction, ctx);
}

/**
 * Re-show the attachment dropdown for the current pending card.
 */
export async function handleAttachReselect(interaction, ctx) {
  const { getGame, saveGames, client } = ctx;
  const match = interaction.customId.match(/^attach_reselect_([^_]+)_([12])$/);
  if (!match) return;
  const [, gameId, playerNumStr] = match;
  const playerNum = parseInt(playerNumStr, 10);
  const game = getGame(gameId);
  if (!game || !game.setupAttachmentPhase || !game.setupAttachmentPending) return;
  const ownerId = getPlayerId(game, playerNum);
  if (interaction.user.id !== ownerId) {
    await interaction.followUp({ content: 'Only the owner of this hand can do this.', ephemeral: true }).catch(discordCatch);
    return;
  }
  // Clear pending confirm
  if (game.pendingAttachConfirm?.[playerNum]) delete game.pendingAttachConfirm[playerNum];

  // Remove buttons from confirm message
  try { await interaction.message.edit({ content: interaction.message.content, components: [] }).catch(discordCatch); } catch {}

  const pending = game.setupAttachmentPending[playerNum];
  if (!pending || pending.length === 0) return;

  await _sendAttachmentDropdown(game, gameId, playerNum, pending[0], client);
  saveGames();
}

/**
 * Confirm all attachments are final — proceed to game start.
 */
export async function handleAttachDoneConfirm(interaction, ctx) {
  const { getGame, saveGames, finishSetupAttachments, client } = ctx;
  const match = interaction.customId.match(/^attach_done_confirm_([^_]+)_([12])$/);
  if (!match) return;
  const [, gameId, playerNumStr] = match;
  const playerNum = parseInt(playerNumStr, 10);
  const game = getGame(gameId);
  if (!game || !game.setupAttachmentPhase) return;
  const ownerId = getPlayerId(game, playerNum);
  if (interaction.user.id !== ownerId) {
    await interaction.followUp({ content: 'Only the owner of this hand can confirm.', ephemeral: true }).catch(discordCatch);
    return;
  }

  // Remove buttons
  try { await interaction.message.edit({ content: interaction.message.content, components: [] }).catch(discordCatch); } catch {}

  // Mark this player as confirmed
  game.setupAttachmentConfirmed = game.setupAttachmentConfirmed || {};
  game.setupAttachmentConfirmed[playerNum] = true;

  const oppNum = opponentPlayerNum(playerNum);
  const oppPending = (game.setupAttachmentPending?.[oppNum] || []).length;
  const oppConfirmed = game.setupAttachmentConfirmed?.[oppNum];

  if (oppPending === 0 && oppConfirmed) {
    // Both done and confirmed — clean up redo notices
    if (game.attachRedoNoticeIds?.length) {
      const generalChannel = await client.channels.fetch(game.generalId).catch(() => null);
      if (generalChannel) {
        for (const nId of game.attachRedoNoticeIds) {
          await generalChannel.messages.delete(nId).catch(discordCatch);
        }
      }
    }
    game.setupAttachmentPhase = false;
    game.setupAttachmentPending = null;
    game.setupAttachmentApplied = null;
    game.setupAttachmentOriginal = null;
    game.setupAttachmentConfirmed = null;
    game.pendingAttachConfirm = null;
    game.attachRedoNoticeIds = null;
    // Phase gate: attachments confirmed — wait for both to confirm before drawing CCs
    const { sendPhaseGateMessages } = ctx;
    await sendPhaseGateMessages(game, 'attach_done', ctx);
  } else {
    const handId = getHandChannelId(game, playerNum);
    const handChannel = await client.channels.fetch(handId);
    await handChannel.send({ content: 'Attachments confirmed. Waiting for your opponent to finish placing theirs.' });
  }
  saveGames();
}

/**
 * Redo all attachments — remove applied attachments, restore original pending list.
 */
export async function handleAttachDoneRedo(interaction, ctx) {
  const { getGame, updateAttachmentMessageForDc, logGameAction, saveGames, client } = ctx;
  const match = interaction.customId.match(/^attach_done_redo_([^_]+)_([12])$/);
  if (!match) return;
  const [, gameId, playerNumStr] = match;
  const playerNum = parseInt(playerNumStr, 10);
  const game = getGame(gameId);
  if (!game || !game.setupAttachmentPhase) return;
  const ownerId = getPlayerId(game, playerNum);
  if (interaction.user.id !== ownerId) {
    await interaction.followUp({ content: 'Only the owner of this hand can redo.', ephemeral: true }).catch(discordCatch);
    return;
  }

  // Remove buttons
  try { await interaction.message.edit({ content: interaction.message.content, components: [] }).catch(discordCatch); } catch {}

  // Reverse all applied attachments
  const applied = game.setupAttachmentApplied?.[playerNum] || [];
  const attachKey = dcAttachmentsKey(playerNum);
  for (const { card, dcMsgId } of applied) {
    const arr = game[attachKey]?.[dcMsgId];
    if (Array.isArray(arr)) {
      const idx = arr.findIndex(c => cardNameEquals(c, card));
      if (idx >= 0) arr.splice(idx, 1);
    }
    // Reverse Focused on the Kill HP bonus
    if (cardNameEquals(card, 'Focused on the Kill') && ctx.dcHealthState) {
      const hs = ctx.dcHealthState.get(dcMsgId);
      if (hs) {
        for (let fi = 0; fi < hs.length; fi++) {
          if (hs[fi]) { hs[fi] = [Math.max(0, hs[fi][0] - 5), Math.max(1, hs[fi][1] - 5)]; }
        }
        ctx.dcHealthState.set(dcMsgId, hs);
        const dcList = getDcList(game, playerNum) || [];
        const dcMsgIds = getDcMessageIds(game, playerNum) || [];
        const didx = dcMsgIds.indexOf(dcMsgId);
        if (didx >= 0 && dcList[didx]) dcList[didx].healthState = [...hs];
      }
    }
    // Reverse Wookiee Avenger — put Debts Repaid back in deck from hand
    if (cardNameEquals(card, 'Wookiee Avenger')) {
      const handKey = ccHandKey(playerNum);
      const deckKey = ccDeckKey(playerNum);
      const hand = game[handKey] || [];
      const drIdx = hand.indexOf('Debts Repaid');
      if (drIdx >= 0) {
        hand.splice(drIdx, 1);
        game[handKey] = hand;
        game[deckKey] = [...(game[deckKey] || []), 'Debts Repaid'];
        game.wookieeAvengerDrawPenalty = Math.max(0, (game.wookieeAvengerDrawPenalty || 0) - 1);
      }
    }
    // Update DC embed to remove attachment display
    if (updateAttachmentMessageForDc) {
      try { await updateAttachmentMessageForDc(game, playerNum, dcMsgId, client); } catch {}
    }
  }

  // Restore original pending list
  game.setupAttachmentPending = game.setupAttachmentPending || {};
  game.setupAttachmentApplied = game.setupAttachmentApplied || {};
  const original = game.setupAttachmentOriginal?.[playerNum];
  if (original) {
    game.setupAttachmentPending[playerNum] = [...original];
  }
  game.setupAttachmentApplied[playerNum] = [];
  if (game.setupAttachmentConfirmed?.[playerNum]) delete game.setupAttachmentConfirmed[playerNum];

  // Notify both players in general channel
  const p1Id = getPlayerId(game, 1);
  const p2Id = getPlayerId(game, 2);
  const generalChannel = await client.channels.fetch(game.generalId).catch(() => null);
  if (generalChannel) {
    const redoNoticeMsg = await generalChannel.send({
      content: `<@${p1Id}> <@${p2Id}> — Attachment placements are being redone. Your play areas will reassemble with the correct attachments once complete.`,
      allowedMentions: { users: [p1Id, p2Id].filter(Boolean) },
    }).catch(() => null);
    if (redoNoticeMsg) {
      game.attachRedoNoticeIds = game.attachRedoNoticeIds || [];
      game.attachRedoNoticeIds.push(redoNoticeMsg.id);
    }
  }
  await logGameAction(game, client, `Player ${playerNum} is redoing attachment placements.`, { phase: 'SETUP', icon: 'card' });

  // Start auto-attach + dropdown flow for the restored list
  const pending = game.setupAttachmentPending[playerNum];
  const dcList = getDcList(game, playerNum) || [];
  const dcMsgIds = getDcMessageIds(game, playerNum) || [];
  const attached = new Set((game.setupAttachmentApplied?.[playerNum] || []).map(a => a.dcMsgId));
  while (pending.length > 0) {
    const autoTarget = findAutoAttachTarget(pending[0], dcList, dcMsgIds, attached);
    if (!autoTarget) break;
    const autoCard = pending[0];
    await applySetupAttachment(game, playerNum, autoCard, autoTarget, ctx);
    pending.shift();
    game.setupAttachmentApplied[playerNum].push({ card: autoCard, dcMsgId: autoTarget });
    attached.add(autoTarget);
    const autoDisplayName = ctx.dcMessageMeta?.get(autoTarget)?.displayName || 'DC';
    await logGameAction(game, client, `**${autoCard}** auto-attached to **${autoDisplayName}** (setup).`, { phase: 'SETUP', icon: 'card' });
  }

  if (pending.length > 0) {
    await _sendAttachmentDropdown(game, gameId, playerNum, pending[0], client);
  } else {
    // All auto-attached again — show done confirmation
    await _sendAttachDonePrompt(game, gameId, playerNum, client);
  }
  saveGames();
}

/**
 * Recovery helper: re-send the attachment dropdown for a player who has pending attachments.
 * Exported for use by recover.js.
 */
export async function recoverSetupAttachments(game, gameId, playerNum, client) {
  const pending = game.setupAttachmentPending?.[playerNum] || [];
  if (pending.length > 0) {
    await _sendAttachmentDropdown(game, gameId, playerNum, pending[0], client);
  }
}

/** Helper: send the attachment dropdown for a card. Exported for phase-gate.js. */
export async function _sendAttachmentDropdown(game, gameId, playerNum, card, client) {
  const handId = getHandChannelId(game, playerNum);
  const handChannel = await client.channels.fetch(handId);
  const dcList = getDcList(game, playerNum) || [];
  const dcMsgIds = getDcMessageIds(game, playerNum) || [];
  const restriction = getAttachmentRestriction(card);
  // DCs that already have an attachment cannot receive another (CRR p.56: "Each Deployment card can have only one Attachment")
  const alreadyAttached = new Set(
    (game.setupAttachmentApplied?.[playerNum] || []).map(a => a.dcMsgId),
  );
  const options = dcList.slice(0, 25).map((dc, i) => {
    const dcName = dc.displayName || dc.dcName || `DC ${i + 1}`;
    if (alreadyAttached.has(dcMsgIds[i])) return null;
    // Skirmish upgrades cannot be attachment targets
    if (isFigurelessDc(dc.dcName)) return null;
    if (restriction && !restriction.filter(dc.dcName)) return null;
    return { label: dcName.slice(0, 100), value: (dcMsgIds[i] || String(i)).toString() };
  }).filter(Boolean);
  if (options.length === 0) {
    // No valid targets — skip this attachment and move on
    const pending = game.setupAttachmentPending?.[playerNum] || [];
    if (pending.length > 0) pending.shift();
    const restrictionNote = restriction ? ` (${restriction.restrictionText} only)` : '';
    await handChannel.send({ content: `⚠️ **${card}** has no valid Deployment Card targets${restrictionNote}. Skipping.` });
    return;
  }
  const select = new StringSelectMenuBuilder()
    .setCustomId(`setup_attach_to_${gameId}_${playerNum}`)
    .setPlaceholder('Attach to which Deployment Card?')
    .addOptions(options);
  const restrictionNote = restriction ? ` *(${restriction.restrictionText} only)*` : '';
  const pending = game.setupAttachmentPending[playerNum] || [];
  const payload = {
    content: `**Setup — place Skirmish Upgrade${pending.length > 1 ? ` (${pending.length} remaining)` : ''}:** **${card}**${restrictionNote}. Choose which Deployment Card to attach it to:`,
    components: [new ActionRowBuilder().addComponents(select)],
  };
  const imgRel = getDcImagePath(card);
  if (imgRel) {
    const imgPath = join(rootDir, imgRel);
    if (existsSync(imgPath)) {
      payload.files = [new AttachmentBuilder(imgPath)];
    }
  }
  await handChannel.send(payload);
}

/** Helper: send the "all done" prompt with confirm/redo. Exported for phase-gate.js. */
export async function _sendAttachDonePrompt(game, gameId, playerNum, client) {
  const handId = getHandChannelId(game, playerNum);
  const handChannel = await client.channels.fetch(handId);
  const oppNum = opponentPlayerNum(playerNum);
  const oppPending = (game.setupAttachmentPending?.[oppNum] || []).length;
  const oppConfirmed = game.setupAttachmentConfirmed?.[oppNum];
  const waitNote = (oppPending > 0 || !oppConfirmed) ? '\nWaiting for your opponent to finish placing theirs.' : '';
  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`attach_done_confirm_${gameId}_${playerNum}`)
      .setLabel('Confirm')
      .setStyle(ButtonStyle.Success),
    new ButtonBuilder()
      .setCustomId(`attach_done_redo_${gameId}_${playerNum}`)
      .setLabel('Redo Attachments')
      .setStyle(ButtonStyle.Secondary),
  );
  await handChannel.send({
    content: `All attachments placed!${waitNote}`,
    components: [row],
  });
}

/** Helper: after confirming/applying an attachment, proceed to next or show done prompt. */
async function _proceedAttachmentPhase(game, gameId, playerNum, interaction, ctx) {
  const { saveGames, finishSetupAttachments, client } = ctx;
  const pending = game.setupAttachmentPending[playerNum];

  if (pending.length > 0) {
    await _sendAttachmentDropdown(game, gameId, playerNum, pending[0], client);
    saveGames();
    return;
  }

  // This player's attachments are all placed — show done prompt
  const oppNum = opponentPlayerNum(playerNum);
  const oppPending = (game.setupAttachmentPending?.[oppNum] || []).length;
  const oppConfirmed = game.setupAttachmentConfirmed?.[oppNum];

  if (oppPending === 0 && oppConfirmed) {
    // Both done — just need this player's confirm
    // Show confirm/redo prompt
    await _sendAttachDonePrompt(game, gameId, playerNum, client);
  } else {
    // Opponent not done yet — show prompt with waiting note
    await _sendAttachDonePrompt(game, gameId, playerNum, client);
  }
  saveGames();
}
