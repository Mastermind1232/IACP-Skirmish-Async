/**
 * Checkpoint save / load handlers.
 *
 * Save: serializes full game state (minus undoStack + checkpoints field) to
 * the `checkpoints` DB table. Cross-game discoverable.
 *
 * Load (in-game): replaces current game state with checkpoint state in
 * the SAME lobby. Channel + message IDs unchanged. Side-channel Maps
 * rebuilt via repopulateDcMapsForGame; UI rebuilt via Resync's refresh path.
 *
 * Load (cross-game / new lobby): the user creates a new lobby and selects
 * a checkpoint to load. State is restored with channel/player IDs remapped
 * to the new lobby; all message IDs cleared and re-rendered fresh.
 *
 * Tier 1 fidelity: pending* state (combat, modals, queues, active activation
 * threads) is cleared on load. Game resumes between actions. Mid-action
 * resumption is intentionally not supported — testing patterns benefit
 * from saving at clean boundaries.
 */
import {
  ActionRowBuilder, ButtonBuilder, ButtonStyle, ModalBuilder, TextInputBuilder,
  TextInputStyle, StringSelectMenuBuilder, EmbedBuilder,
} from 'discord.js';
import { discordCatch } from '../error-handling.js';
import { logGameAction } from '../discord/messages.js';
import { requireGame } from '../utils/guards.js';
import { fetchGameChannel } from '../discord/channel-helpers.js';
import { parseCustomId, splitCustomId } from '../discord/custom-id.js';
import { getPlayerId, opponentPlayerNum } from '../game/player-helpers.js';
import {
  insertCheckpoint, listCheckpointsForUser, listCheckpointsForGame,
  getCheckpointById, deleteCheckpoint, countCheckpointsByUser,
} from '../db.js';
import { CURRENT_GAME_VERSION, repopulateDcMapsForGame, getGame } from '../game-state.js';

const MAX_CHECKPOINTS_PER_USER = 50;
const CHECKPOINT_NAME_MAX_LEN = 80;

/** Generate a unique checkpoint ID. */
function makeCheckpointId() {
  return `cp_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
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
    'overdriveUsedThisActivation',
    'roundFigureAbilityUsed', // keys may be msgId_<ability>
    'rushPending', 'shoulderRushPending',
    'mobileMovementActive', 'moveXBypassActive', 'moveCleaveActive',
    'movementBank',
    'figurePowerTokens',
    'roundDcAbilityUsed',
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

// ── Load Checkpoint (in-game / same lobby) ──────────────────────────────────

export async function handleCheckpointLoadIngamePrompt(interaction, ctx) {
  const { getGame: getGameDep } = ctx;
  const gameId = parseCustomId(interaction.customId, 'cp_load_ingame_');
  const game = await requireGame(interaction, getGameDep, gameId);
  if (!game) return;
  if (interaction.user.id !== game.player1Id && interaction.user.id !== game.player2Id) {
    await interaction.followUp({ content: 'Only players in this game can load checkpoints.', ephemeral: true }).catch(discordCatch);
    return;
  }
  const checkpoints = await listCheckpointsForGame(gameId);
  if (!checkpoints.length) {
    await interaction.followUp({ content: 'No checkpoints saved for this game yet.', ephemeral: true }).catch(discordCatch);
    return;
  }
  const select = new StringSelectMenuBuilder()
    .setCustomId(`cp_load_ingame_pick_${gameId}`)
    .setPlaceholder('Choose a checkpoint to restore...')
    .addOptions(checkpoints.slice(0, 25).map((cp) => ({
      label: cp.name.slice(0, 100),
      description: `round ${cp.round_at_save ?? 0} · ${new Date(parseInt(cp.created_at, 10)).toLocaleString()}`.slice(0, 100),
      value: cp.id,
    })));
  await interaction.reply({
    content: '📂 **Load Checkpoint (this game)** — pick one. *Loads wipe current state; an undo entry is pushed first.*',
    components: [new ActionRowBuilder().addComponents(select)],
    ephemeral: true,
  }).catch(discordCatch);
}

export async function handleCheckpointLoadIngamePick(interaction, ctx) {
  const { getGame: getGameDep, saveGames, client, refreshAllGameComponents } = ctx;
  const gameId = parseCustomId(interaction.customId, 'cp_load_ingame_pick_');
  const cpId = interaction.values?.[0];
  await interaction.deferUpdate().catch(discordCatch);
  const game = await requireGame(interaction, getGameDep, gameId);
  if (!game) return;
  const cp = await getCheckpointById(cpId);
  if (!cp) {
    await interaction.followUp({ content: 'Checkpoint not found (it may have been deleted).', ephemeral: true }).catch(discordCatch);
    return;
  }
  if (cp.game_version !== CURRENT_GAME_VERSION) {
    await interaction.followUp({ content: `Checkpoint version mismatch (saved ${cp.game_version}, current ${CURRENT_GAME_VERSION}). Refusing to load.`, ephemeral: true }).catch(discordCatch);
    return;
  }
  // Push current state to undo so the load is recoverable
  game.undoStack = game.undoStack || [];
  game.undoStack.push({
    type: 'checkpoint_load',
    label: `Load checkpoint "${cp.name}"`,
    snapshot: snapshotGameState(game),
    ts: Date.now(),
  });
  // Restore state in place — preserve undoStack + same channel/player IDs
  // (in-game = same lobby, so we keep all Discord refs).
  const savedStack = game.undoStack;
  const savedChannelIds = {
    generalId: game.generalId,
    boardId: game.boardId,
    p1HandId: game.p1HandId,
    p2HandId: game.p2HandId,
    p1PlayAreaId: game.p1PlayAreaId,
    p2PlayAreaId: game.p2PlayAreaId,
    player1Id: game.player1Id,
    player2Id: game.player2Id,
    gameId: game.gameId,
  };
  for (const key of Object.keys(game)) {
    if (key !== 'undoStack') delete game[key];
  }
  Object.assign(game, cp.game_state);
  game.undoStack = savedStack;
  // Preserve current lobby's channel/player IDs over the saved state's
  // (identical for in-game but defensive — and required if the same checkpoint
  // is later loaded into a different lobby via in-game flow).
  Object.assign(game, savedChannelIds);
  clearPendingAndPerMsgIdState(game);
  // Side-channel Map rebuild
  try { repopulateDcMapsForGame(gameId); } catch (err) {
    console.error('repopulateDcMapsForGame failed during checkpoint load:', err);
  }
  // UI rebuild — same as Resync
  if (refreshAllGameComponents) {
    try { await refreshAllGameComponents(game, client); }
    catch (err) { console.error('refreshAllGameComponents failed:', err); }
  }
  saveGames?.(gameId);
  if (game.generalId) {
    try {
      const ch = await fetchGameChannel(client, game.generalId);
      await ch.send(`📂 <@${interaction.user.id}> loaded checkpoint **"${cp.name}"** (round ${cp.round_at_save ?? 0}).`).catch(discordCatch);
    } catch {}
  }
}

// ── Load Checkpoint into NEW Lobby (cross-game) ─────────────────────────────

export async function handleCheckpointLoadNewLobbyPrompt(interaction, ctx) {
  // For now, stub: list saved checkpoints visible to this user. Full new-lobby
  // creation flow is wired through game-creation; this handler is currently
  // posted in-game and would normally trigger lobby creation. The simplest
  // first-cut is to instruct the user to use the new-lobby creation menu.
  const { getGame: getGameDep } = ctx;
  const gameId = parseCustomId(interaction.customId, 'cp_load_newlobby_');
  const game = await requireGame(interaction, getGameDep, gameId);
  if (!game) return;
  const checkpoints = await listCheckpointsForUser(interaction.user.id, { limit: 25 });
  if (!checkpoints.length) {
    await interaction.followUp({ content: 'You have no saved checkpoints yet. Use **💾 Save Checkpoint** first.', ephemeral: true }).catch(discordCatch);
    return;
  }
  await interaction.reply({
    content: '🔀 **Load into New Lobby** — to spawn a fresh lobby with a saved state, create a new game with the **/new-game** command and pick the **Load from Checkpoint** option there. Your saved checkpoints will appear in the dropdown.\n\nFor in-place restoration of this game, use **📂 Load Checkpoint (this game)** instead.',
    ephemeral: true,
  }).catch(discordCatch);
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
  // 2. Wipe newGame fields and apply checkpoint state.
  for (const key of Object.keys(newGame)) {
    if (key !== 'undoStack') delete newGame[key];
  }
  Object.assign(newGame, checkpoint.game_state);
  // 3. Override lobby identity (channels + players from the new lobby).
  Object.assign(newGame, lobbyIdentity);
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
  if (deps.populatePlayAreasFromState) {
    await deps.populatePlayAreasFromState(newGame, client);
  } else if (deps.populatePlayAreas) {
    // Fallback: vanilla populatePlayAreas re-derives from squad → fresh HP.
    // Acceptable when no state-aware variant is wired yet.
    await deps.populatePlayAreas(newGame, client);
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
  if (deps.saveGames) deps.saveGames(newGame.gameId);
}

// ── Helpers ─────────────────────────────────────────────────────────────────

export {
  snapshotGameState,
  clearPendingAndPerMsgIdState,
  remapMsgIdKeyedFields,
};
