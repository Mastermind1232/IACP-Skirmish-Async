/**
 * Mission EoR effects registration (alexanbv 2026-05-10).
 *
 * Each mission rule flag inside `rules.endOfRound` that needs an async
 * player-picker handler is registered here. Module side-effects run on
 * first import, so importing this file once at bot startup populates
 * the registry.
 */
import { registerMissionEorEffect } from './mission-eor-effects.js';
import { hasMissionFlag, getMapTokensData } from '../data-loader.js';
import { fetchGameChannel } from '../discord/channel-helpers.js';
import { getInitiativePlayerNum, opponentPlayerNum } from './player-helpers.js';
import { initThugMovementQueue } from './thug-movement.js';
import { postThugPickerPrompt } from '../handlers/thug-movement.js';
import { postKryknaPushButtons } from '../engine/misc-helpers.js';

/**
 * Corellian Underground A: thug end-of-round push picker.
 * Initiative player moves all thugs 1 at a time.
 */
registerMissionEorEffect('npcThugs', async (game, ctx, opts) => {
  const mapId = game.selectedMap?.id;
  const variant = game.selectedMission?.variant;
  if (!hasMissionFlag(mapId, variant, 'npcThugs')) return { pending: false };

  // Lazy-init npcThugs from missionA token positions if needed.
  if (!game.npcThugs) {
    const missionData = getMapTokensData?.()[mapId]?.missionA;
    const positions = Object.values(missionData?.positions || {}).flat().filter(Boolean);
    if (positions.length > 0) {
      game.npcThugs = positions.map((coord, i) => ({
        id: `thug-${i + 1}`,
        coord: String(coord).toLowerCase(),
        hp: 4, maxHp: 4, defeated: false,
        hostility: 'hostile',
      }));
    }
  }
  const activeIndexes = (game.npcThugs || [])
    .map((t, i) => (t && !t.defeated ? i : -1))
    .filter((i) => i >= 0);
  if (activeIndexes.length === 0) return { pending: false };

  const initPN = getInitiativePlayerNum(game);
  initThugMovementQueue(game, initPN, mapId);
  await postThugPickerPrompt(game, ctx.client, opts?.interaction?.channel);
  return { pending: true };
});

/**
 * Chopper Base Atollon A: Krykna end-of-round push picker.
 * Players alternate (init first) until every Krykna has been pushed.
 */
registerMissionEorEffect('npcKryknaActivation', async (game, ctx, opts) => {
  const mapId = game.selectedMap?.id;
  const variant = game.selectedMission?.variant;
  if (!hasMissionFlag(mapId, variant, 'npcKryknaActivation')) return { pending: false };
  if (!postKryknaPushButtons) return { pending: false };

  // Lazy-init npcKrykna from missionA token positions if needed.
  if (!game.npcKrykna) {
    const missionData = getMapTokensData()['chopper-base-atollon']?.missionA;
    const positions = Object.values(missionData?.positions || {}).flat().filter(Boolean);
    if (positions.length > 0) {
      game.npcKrykna = positions.map((coord, i) => ({
        id: `krykna-${i + 1}`,
        coord: String(coord).toLowerCase().trim(),
        hp: 8, maxHp: 8, defeated: false,
        hostility: 'treatedAsHostile',
      }));
    }
  }
  const activeKrykna = (game.npcKrykna || []).filter((k) => !k.defeated);
  if (activeKrykna.length === 0) return { pending: false };

  const initNum = getInitiativePlayerNum(game);
  const otherNum = opponentPlayerNum(initNum);
  const queue = [];
  for (let i = 0; i < activeKrykna.length; i++) {
    queue.push(i % 2 === 0 ? initNum : otherNum);
  }
  game.pendingKryknaPushQueue = queue;
  game.kryknaPushedIds = [];
  // Stash logVars under the krykna-specific key as well so the existing
  // krykna_push_modal drain handler (index.js) keeps working unchanged.
  game._kryknaResumeLogVars = opts?.logVars || null;

  const channel = await fetchGameChannel(ctx.client, game.generalId);
  if (channel) await postKryknaPushButtons(game, channel, game.gameId);
  return { pending: true };
});
