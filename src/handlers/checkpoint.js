/**
 * Checkpoint save / load handlers.
 *
 * Save: serializes full game state (minus undoStack + checkpoints field) to
 * the `checkpoints` DB table. Cross-game discoverable. Saves are GATED to
 * clean boundaries — no mid-combat / mid-move / mid-space-pick saves. See
 * whyMidAction() below for the exact predicate.
 *
 * Why the boundary gate: at a clean boundary, the engine's own cleanup
 * (cleanupActivation, cleanupRoundStart) has already wiped every transient
 * msgId-keyed field. Anything msgId-keyed that survives is persistent state
 * (DC attachments, depleted DCs, etc.) which the existing index-walking
 * translation in applyCheckpointToNewLobby handles correctly. Allowing
 * mid-action saves would require migrating ~75 transient fields per load —
 * a fragility tax we deliberately skip by forbidding the bad-input case.
 *
 * Load (in-game): replaces current game state with checkpoint state in
 * the SAME lobby. Channel + message IDs unchanged. Side-channel Maps
 * rebuilt via repopulateDcMapsForGame; UI rebuilt via Resync's refresh path.
 *
 * Load (cross-game / new lobby): the user creates a new lobby and selects
 * a checkpoint to load. State is restored with channel/player IDs remapped
 * to the new lobby; all message IDs cleared and re-rendered fresh.
 */
import {
  ActionRowBuilder, ButtonBuilder, ButtonStyle, ModalBuilder, TextInputBuilder,
  TextInputStyle, StringSelectMenuBuilder, EmbedBuilder,
} from 'discord.js';
import { discordCatch } from '../error-handling.js';
import { requireGame } from '../utils/guards.js';
import { fetchGameChannel } from '../discord/channel-helpers.js';
import { parseCustomId } from '../discord/custom-id.js';
import {
  insertCheckpoint, listAllCheckpoints, getCheckpointById,
  countCheckpointsByUser,
} from '../db.js';
import { CURRENT_GAME_VERSION, repopulateDcMapsForGame } from '../game-state.js';

const MAX_CHECKPOINTS_PER_USER = 50;
const CHECKPOINT_NAME_MAX_LEN = 80;

/** Generate a unique checkpoint ID. */
function makeCheckpointId() {
  return `cp_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

/**
 * Returns a human-readable reason if the game is mid-action, else ''.
 * Used by the save handler to refuse non-boundary saves.
 *
 * Boundary = no combat in flight, no open move grid, no open space-pick,
 * no started-but-unfinished activation actions. At those moments,
 * cleanupActivation has already wiped activation-scope state and (if we're
 * between rounds) cleanupRoundStart has wiped round-scope state, so the
 * saved snapshot has no transient msgId-keyed orphans to worry about.
 */
export function whyMidAction(game) {
  if (!game) return '';
  if (game.pendingCombat) return 'combat is in progress';
  if (game.moveInProgress && Object.keys(game.moveInProgress).length > 0) return 'a move is in progress';
  if (game.pendingSpacePick && Object.keys(game.pendingSpacePick).length > 0) return 'a space pick is open';
  if (game.dcActionsData && Object.keys(game.dcActionsData).length > 0) return 'an activation is in progress (use End Activation first)';
  return '';
}

/**
 * Fetch a checkpoint and validate it's loadable. On any failure, posts an
 * ephemeral followUp with the reason and returns null. Both load handlers
 * (in-game and new-lobby) share these exact pre-flight checks.
 */
async function loadCheckpointOrFollowUp(interaction, cpId) {
  const cp = await getCheckpointById(cpId);
  if (!cp) {
    await interaction.followUp({ content: 'Checkpoint not found (it may have been deleted).', ephemeral: true }).catch(discordCatch);
    return null;
  }
  if (cp.game_version !== CURRENT_GAME_VERSION) {
    await interaction.followUp({ content: `Checkpoint version mismatch (saved ${cp.game_version}, current ${CURRENT_GAME_VERSION}). Refusing to load.`, ephemeral: true }).catch(discordCatch);
    return null;
  }
  return cp;
}

/**
 * Restore a saved game state onto an existing game object IN PLACE. Used by
 * checkpoint loads (in-game and cross-lobby) and the universal undo restore.
 *
 *   1. Wipe every key on `game` except `undoStack` (which has its own
 *      lifecycle and is preserved in place).
 *   2. Object.assign `savedState` (the snapshot blob) onto `game`.
 *   3. Object.assign `identityOverlay` (channel/player IDs to keep from the
 *      live game) on top — this beats anything in `savedState`.
 *
 * Callers still handle their own undoStack semantics around this call
 * (push undo entry before; reassign savedStack after) since those rules
 * differ by caller.
 */
export function restoreGameStateInPlace(game, savedState, identityOverlay = {}) {
  for (const key of Object.keys(game)) {
    if (key !== 'undoStack') delete game[key];
  }
  Object.assign(game, savedState);
  Object.assign(game, identityOverlay);
}

/**
 * Strip non-serializable / runtime-only fields from a game object before save.
 * - undoStack: separately managed; not part of the immutable state we want to restore
 * - any function values: silently dropped by JSON.stringify but be explicit
 */
function snapshotGameState(game) {
  const { undoStack, ...rest } = game;
  return JSON.parse(JSON.stringify(rest));
}

/**
 * Identify the union of all `pending*` keys on a game object plus the
 * registered ACTIVATION_MSGID_FLAGS that hold per-msgId state. On load,
 * these get cleared (Tier 1 — between-actions fidelity).
 *
 * Done dynamically rather than from a hardcoded list so that any new
 * pending* field added in the future is also cleared without code change.
 */
function clearPendingAndPerMsgIdState(game) {
  // Clear all top-level pending* fields generically (covers ~120 fields).
  for (const key of Object.keys(game)) {
    if (key.startsWith('pending')) {
      const v = game[key];
      if (Array.isArray(v)) game[key] = [];
      else if (v && typeof v === 'object') game[key] = {};
      else game[key] = null;
    }
  }
  // Clear active-activation threads (they live in the OLD play areas).
  if (game.dcActionsData && typeof game.dcActionsData === 'object') {
    game.dcActionsData = {};
  }
  // Move grid / movement bank are tied to current activation; clear.
  game.moveInProgress = {};
  game.moveGridMessageIds = {};
  game.movementBank = {};
  // pendingCombat is covered by the pending* sweep but be explicit.
  delete game.pendingCombat;
  // Combat thread / pre-combat / roll messages live on dead channels.
  game.activeCombatThreadId = null;
  game.combatThreadId = null;
}

/**
 * Build a translation table from old DC message IDs (in checkpoint state) to
 * the freshly-posted new IDs, then walk every msgId-keyed field and remap.
 *
 * Used in cross-game load after re-rendering DC messages.
 */
function remapMsgIdKeyedFields(game, oldP1Ids, oldP2Ids) {
  const newP1Ids = game.p1DcMessageIds || [];
  const newP2Ids = game.p2DcMessageIds || [];
  const map = new Map();
  for (let i = 0; i < oldP1Ids.length && i < newP1Ids.length; i++) {
    if (oldP1Ids[i] && newP1Ids[i]) map.set(String(oldP1Ids[i]), String(newP1Ids[i]));
  }
  for (let i = 0; i < oldP2Ids.length && i < newP2Ids.length; i++) {
    if (oldP2Ids[i] && newP2Ids[i]) map.set(String(oldP2Ids[i]), String(newP2Ids[i]));
  }
  // Walk all msgId-keyed objects on game and translate keys.
  // We use the registered ACTIVATION_MSGID_FLAGS list as authoritative.
  // Anything we miss can be added without breaking — those entries simply
  // remain keyed by old (invalid) msgIds and silently no-op.
  const MSGID_FLAGS = [
    'dcActionsData', 'dcAttachments', 'dcExhausted',
    'p1DcAttachments', 'p2DcAttachments',
    'p1CcAttachments', 'p2CcAttachments',
    'exhaustedSkirmishUpgrades',
    'fellSwoopFreeAttack', 'pummelTwoAttacksThisActivation', 'pummelAttacksRemaining',
    // overdriveUsedThisActivation removed: keyed by figureKey (in
    // ACTIVATION_FIGKEY_FLAGS), not msgId. Survives cross-lobby intact;
    // would never match this remap.
    'roundFigureAbilityUsed', // keys may be msgId_<ability>
    'rushPending', 'shoulderRushPending',
    'mobileMovementActive', 'moveXBypassActive',
    'movementBank',
    // figurePowerTokens removed: keyed by figureKey (e.g. "Trooper-1-0"), not
    // msgId, so it survives cross-lobby intact and never matched here anyway.
    // moveCleaveActive + roundDcAbilityUsed removed: declared but never written
    // anywhere in the codebase.
    'overrunDamagedThisMove',
  ];
  for (const flagName of MSGID_FLAGS) {
    const obj = game[flagName];
    if (!obj || typeof obj !== 'object' || Array.isArray(obj)) continue;
    const remapped = {};
    for (const [oldKey, val] of Object.entries(obj)) {
      // Some keys are compound (msgId_suffix). Translate the prefix only.
      let newKey = oldKey;
      for (const [oldId, newId] of map) {
        if (oldKey === oldId) { newKey = newId; break; }
        if (oldKey.startsWith(`${oldId}_`)) { newKey = `${newId}${oldKey.slice(oldId.length)}`; break; }
      }
      remapped[newKey] = val;
    }
    game[flagName] = remapped;
  }
}

// ── Save Checkpoint ─────────────────────────────────────────────────────────

export async function handleCheckpointSavePrompt(interaction, ctx) {
  const { getGame: getGameDep } = ctx;
  const gameId = parseCustomId(interaction.customId, 'cp_save_');
  const game = await requireGame(interaction, getGameDep, gameId);
  if (!game) return;
  if (interaction.user.id !== game.player1Id && interaction.user.id !== game.player2Id) {
    await interaction.followUp({ content: 'Only players in this game can save checkpoints.', ephemeral: true }).catch(discordCatch);
    return;
  }
  const modal = new ModalBuilder()
    .setCustomId(`cp_save_modal_${gameId}`)
    .setTitle('Save Checkpoint');
  modal.addComponents(
    new ActionRowBuilder().addComponents(
      new TextInputBuilder()
        .setCustomId('checkpoint_name')
        .setLabel('Checkpoint name')
        .setStyle(TextInputStyle.Short)
        .setPlaceholder('e.g. After CC draw, round 2 status')
        .setMinLength(1)
        .setMaxLength(CHECKPOINT_NAME_MAX_LEN)
        .setRequired(true),
    ),
  );
  await interaction.showModal(modal).catch(discordCatch);
}

export async function handleCheckpointSaveModal(interaction, ctx) {
  const { getGame: getGameDep, saveGames, client } = ctx;
  const gameId = parseCustomId(interaction.customId, 'cp_save_modal_');
  const game = await requireGame(interaction, getGameDep, gameId);
  if (!game) return;
  await interaction.deferReply({ ephemeral: true }).catch(discordCatch);
  const userId = interaction.user.id;
  if (userId !== game.player1Id && userId !== game.player2Id) {
    await interaction.editReply({ content: 'Only players in this game can save checkpoints.' }).catch(discordCatch);
    return;
  }
  const name = (interaction.fields.getTextInputValue('checkpoint_name') || '').trim();
  if (!name) {
    await interaction.editReply({ content: 'Checkpoint name cannot be empty.' }).catch(discordCatch);
    return;
  }
  // Boundary gate: refuse mid-action saves. At a clean boundary the engine's
  // own cleanupActivation/cleanupRoundStart has wiped transient msgId-keyed
  // state, so the saved snapshot is restorable without per-field translation
  // gymnastics. Loaded state remains coherent because nothing was in flight.
  const reason = whyMidAction(game);
  if (reason) {
    await interaction.editReply({ content: `❌ Can't save mid-action — ${reason}. Finish your current action (or end the activation) and try again.` }).catch(discordCatch);
    return;
  }
  // Cap per user
  try {
    const count = await countCheckpointsByUser(userId);
    if (count >= MAX_CHECKPOINTS_PER_USER) {
      await interaction.editReply({ content: `Reached your checkpoint cap (${MAX_CHECKPOINTS_PER_USER}). Delete one before saving.` }).catch(discordCatch);
      return;
    }
  } catch {}
  // Sync side-channel Maps into game.dcList[*].healthState before snapshot
  // (saveGames calls syncHealthStateToGames internally; explicit safety).
  try { saveGames?.(gameId); } catch {}
  const state = snapshotGameState(game);
  const cpId = makeCheckpointId();
  const cp = {
    id: cpId,
    name,
    originGameId: gameId,
    createdBy: userId,
    createdAt: Date.now(),
    gameState: state,
    mapId: game.selectedMap?.id ?? null,
    variant: game.selectedMission?.variant ?? null,
    roundAtSave: game.currentRound ?? 0,
    p1Username: client?.users?.cache?.get(game.player1Id)?.username ?? null,
    p2Username: client?.users?.cache?.get(game.player2Id)?.username ?? null,
    gameVersion: CURRENT_GAME_VERSION,
    dataHash: null, // future: hash data/*.json for drift detection
  };
  try {
    await insertCheckpoint(cp);
  } catch (err) {
    console.error('insertCheckpoint failed:', err);
    await interaction.editReply({ content: `Save failed: ${err.message}` }).catch(discordCatch);
    return;
  }
  await interaction.editReply({ content: `💾 Saved checkpoint **"${name}"** (id \`${cpId}\`).` }).catch(discordCatch);
  if (game.generalId) {
    try {
      const ch = await fetchGameChannel(client, game.generalId);
      await ch.send(`💾 <@${userId}> saved checkpoint **"${name}"** at round ${game.currentRound ?? 0}.`).catch(discordCatch);
    } catch {}
  }
}

// ── New-lobby checkpoint flow (lobby tagged "Load Checkpoint") ──────────────

/**
 * Button handler: cp_newgame_open_<gameId>
 * Posts an ephemeral select with all global checkpoints. Either player
 * in the lobby may press it.
 */
export async function handleCheckpointNewGameOpen(interaction, ctx) {
  const { getGame: getGameDep } = ctx;
  const gameId = parseCustomId(interaction.customId, 'cp_newgame_open_');
  const game = await requireGame(interaction, getGameDep, gameId);
  if (!game) return;
  if (interaction.user.id !== game.player1Id && interaction.user.id !== game.player2Id) {
    await interaction.followUp({ content: 'Only players in this lobby can pick a checkpoint.', ephemeral: true }).catch(discordCatch);
    return;
  }
  const checkpoints = await listAllCheckpoints({ limit: 25 });
  if (!checkpoints.length) {
    await interaction.followUp({ content: 'No checkpoints saved yet. Save one from any active game using **/botmenu → 💾 Save Checkpoint**.', ephemeral: true }).catch(discordCatch);
    return;
  }
  const select = new StringSelectMenuBuilder()
    .setCustomId(`cp_newgame_pick_${gameId}`)
    .setPlaceholder('Choose a checkpoint to load...')
    .addOptions(checkpoints.map((cp) => {
      const ts = new Date(parseInt(cp.created_at, 10)).toLocaleString();
      const players = [cp.p1_username, cp.p2_username].filter(Boolean).join(' vs ') || cp.origin_game_id || 'unknown';
      return {
        label: cp.name.slice(0, 100),
        description: `${players} · round ${cp.round_at_save ?? 0} · ${ts}`.slice(0, 100),
        value: cp.id,
      };
    }));
  await interaction.followUp({
    content: '🔀 **Pick a checkpoint** — the saved state will be loaded into this lobby.',
    components: [new ActionRowBuilder().addComponents(select)],
    ephemeral: true,
  }).catch(discordCatch);
}

/**
 * Select handler: cp_newgame_pick_<gameId>
 * Loads the chosen checkpoint into this fresh lobby. Creates board +
 * play-area channels using the saved map/squads, then runs
 * applyCheckpointToNewLobby to post DCs with their saved state.
 */
export async function handleCheckpointNewGamePick(interaction, ctx) {
  const {
    getGame: getGameDep, saveGames, client,
    createBoardChannel, createPlayAreaChannels, populatePlayAreas,
    buildBoardMapPayload, sendRoundActivationPhaseMessage,
    refreshAllGameComponents,
  } = ctx;
  const gameId = parseCustomId(interaction.customId, 'cp_newgame_pick_');
  const cpId = interaction.values?.[0];
  await interaction.deferUpdate().catch(discordCatch);
  const game = await requireGame(interaction, getGameDep, gameId);
  if (!game) return;
  if (interaction.user.id !== game.player1Id && interaction.user.id !== game.player2Id) {
    await interaction.followUp({ content: 'Only players in this lobby can pick.', ephemeral: true }).catch(discordCatch);
    return;
  }
  const cp = await loadCheckpointOrFollowUp(interaction, cpId);
  if (!cp) return;

  // Tell players the load is starting
  const general = await fetchGameChannel(client, game.generalId);
  const settingUpMsg = await general.send({ content: '⏳ Loading checkpoint and creating channels...' }).catch(() => null);

  try {
    // Create board + play-area channels using the new lobby's player IDs.
    const guild = general.guild;
    const gameCategory = await guild.channels.fetch(game.gameCategoryId || general.parentId);
    const prefix = `IA${game.gameId}`;
    if (!game.p1PlayAreaId || !game.p2PlayAreaId) {
      const { p1PlayAreaChannel, p2PlayAreaChannel } = await createPlayAreaChannels(
        guild, gameCategory, prefix, game.player1Id, game.player2Id,
      );
      game.p1PlayAreaId = p1PlayAreaChannel.id;
      game.p2PlayAreaId = p2PlayAreaChannel.id;
    }
    if (!game.boardId) {
      const boardChannel = await createBoardChannel(
        guild, gameCategory, prefix, game.player1Id, game.player2Id,
      );
      game.boardId = boardChannel.id;
    }

    // Apply checkpoint state on top of the now-prepared lobby.
    await applyCheckpointToNewLobby(game, cp, client, {
      populatePlayAreas, buildBoardMapPayload, sendRoundActivationPhaseMessage, saveGames,
      refreshAllGameComponents,
    });

    if (settingUpMsg) settingUpMsg.delete().catch(() => {});
    await general.send({
      content: `<@${game.player1Id}> <@${game.player2Id}> — 📂 Loaded checkpoint **"${cp.name}"** (round ${cp.round_at_save ?? 0}). Resume play in <#${game.p1PlayAreaId}> / <#${game.p2PlayAreaId}>.`,
    }).catch(discordCatch);
    saveGames?.(game.gameId);
  } catch (err) {
    console.error('checkpoint new-lobby load failed:', err);
    if (settingUpMsg) settingUpMsg.delete().catch(() => {});
    await general.send({ content: `❌ Checkpoint load failed: ${err.message}` }).catch(discordCatch);
  }
}

/**
 * Cross-game restore: applies a checkpoint's state to a freshly-created
 * game lobby, remapping IDs and re-rendering all play-area messages.
 *
 * Caller pre-conditions:
 *   - newGame already exists with: gameId, player1Id, player2Id, generalId,
 *     boardId, p1HandId, p2HandId, p1PlayAreaId, p2PlayAreaId
 *   - Channels are empty (no DC messages, no hand visuals, etc. yet)
 *
 * Used by game-creation.js's "Load from Checkpoint" path.
 */
export async function applyCheckpointToNewLobby(newGame, checkpoint, client, deps) {
  // 1. Snapshot current channel/player/game IDs (the "new lobby" identity).
  const lobbyIdentity = {
    gameId: newGame.gameId,
    player1Id: newGame.player1Id,
    player2Id: newGame.player2Id,
    generalId: newGame.generalId,
    boardId: newGame.boardId,
    p1HandId: newGame.p1HandId,
    p2HandId: newGame.p2HandId,
    p1PlayAreaId: newGame.p1PlayAreaId,
    p2PlayAreaId: newGame.p2PlayAreaId,
    achievementsChannelId: newGame.achievementsChannelId,
  };
  // 2. Wipe newGame fields, apply checkpoint state, overlay lobby identity.
  restoreGameStateInPlace(newGame, checkpoint.game_state, lobbyIdentity);
  // 4. Capture the OLD msgIds for later remap.
  const oldP1DcIds = [...(newGame.p1DcMessageIds || [])];
  const oldP2DcIds = [...(newGame.p2DcMessageIds || [])];
  // 5. Clear all message-ID arrays / fields (will be re-populated by re-render).
  newGame.p1DcMessageIds = [];
  newGame.p2DcMessageIds = [];
  newGame.p1DcAttachmentMessageIds = [];
  newGame.p2DcAttachmentMessageIds = [];
  newGame.p1DcCompanionMessageIds = [];
  newGame.p2DcCompanionMessageIds = [];
  newGame.p1HandMessageId = null;
  newGame.p2HandMessageId = null;
  newGame.p1HandVisualMessageId = null;
  newGame.p2HandVisualMessageId = null;
  newGame.p1DiscardPileMessageId = null;
  newGame.p2DiscardPileMessageId = null;
  newGame.p1ActivationsMessageId = null;
  newGame.p2ActivationsMessageId = null;
  newGame.roundActivationMessageId = null;
  // 6. Clear pending state (Tier 1 fidelity).
  clearPendingAndPerMsgIdState(newGame);
  // 7. Run the state-aware play-area populator (posts DCs with their saved
  //    healthState, registers side-channel Maps with new msgIds).
  if (deps.populatePlayAreas) {
    await deps.populatePlayAreas(newGame, client, { loadFromState: true });
  }
  // 8. Remap all msgId-keyed game-state fields from old → new.
  remapMsgIdKeyedFields(newGame, oldP1DcIds, oldP2DcIds);
  // 9. Repopulate side-channel Maps from the freshly-rendered DC messages.
  try { repopulateDcMapsForGame(newGame.gameId); } catch (err) {
    console.error('repopulateDcMapsForGame (cross-game load) failed:', err);
  }
  // 10. Render board + round message (if mid-game).
  if (deps.buildBoardMapPayload && newGame.boardId) {
    try {
      const boardCh = await fetchGameChannel(client, newGame.boardId);
      const payload = await deps.buildBoardMapPayload(newGame.gameId, newGame.selectedMap, newGame);
      await boardCh.send(payload);
    } catch (err) {
      console.error('Board render (cross-game load) failed:', err);
    }
  }
  if (deps.sendRoundActivationPhaseMessage && newGame.currentRound > 0) {
    try { await deps.sendRoundActivationPhaseMessage(newGame, client); } catch {}
  }
  // Phase-specific UI safety nets — refreshAllGameComponents posts the
  // CC shuffle/draw prompts (cc_draw phase), the activation message
  // (round_active stuck-state recovery), and other phase-stuck rescues.
  // Without this, loading a checkpoint into mid-cc_draw leaves players
  // with no Shuffle/Draw button to click and the game stalls.
  if (deps.refreshAllGameComponents) {
    try { await deps.refreshAllGameComponents(newGame, client); }
    catch (err) { console.error('refreshAllGameComponents (cross-game load) failed:', err); }
  }
  if (deps.saveGames) deps.saveGames(newGame.gameId);
}

// ── Helpers ─────────────────────────────────────────────────────────────────

export {
  snapshotGameState,
  clearPendingAndPerMsgIdState,
  remapMsgIdKeyedFields,
};
