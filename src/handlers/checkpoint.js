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
import { requireGame, requireParticipant } from '../utils/guards.js';
import { fetchGameChannel } from '../discord/channel-helpers.js';
import { parseCustomId } from '../discord/custom-id.js';
import {
  insertCheckpoint, listAllCheckpoints, getCheckpointById,
  countCheckpointsByUser,
} from '../db.js';
import { CURRENT_GAME_VERSION, repopulateDcMapsForGame } from '../game-state.js';
import { renderHandThread, renderHandVisual, renderHandPayload, renderRoundActivationMessage, renderDcCompanion } from '../engine/renderer.js';
import { getBlockingInterrupts, INTERRUPT_TYPES, clearAllInterrupts, getMidActionReason } from '../game/interrupts.js';
import { recoverPhaseGate } from './recover.js';

const MAX_CHECKPOINTS_PER_USER = 50;
const CHECKPOINT_NAME_MAX_LEN = 80;

/**
 * Human-readable gate messages, keyed by INTERRUPT_TYPES.* value.
 * Used by whyMidAction so users see "a negation prompt is open" rather
 * than the raw stack-type string. Anything not in this map falls back to
 * a generic "<type> prompt is open" message — adding a friendly message
 * is optional, never required.
 */
const INTERRUPT_GATE_MESSAGES = {
  [INTERRUPT_TYPES.CC_NEGATION]: 'a negation prompt is open',
  [INTERRUPT_TYPES.CC_CHOICE]: 'a CC-effect choice is open',
  [INTERRUPT_TYPES.CC_CONFIRMATION]: 'a CC confirmation is open',
  [INTERRUPT_TYPES.CC_SPACE_CHOICE]: 'a CC space pick is open',
  [INTERRUPT_TYPES.CC_ATTACHMENT]: 'a CC attachment prompt is open',
  [INTERRUPT_TYPES.CELEBRATION]: 'a Celebration prompt is open',
  [INTERRUPT_TYPES.CLEAVE]: 'a Cleave target prompt is open',
  [INTERRUPT_TYPES.COVER_FIRE]: 'a Cover Fire prompt is open',
  [INTERRUPT_TYPES.HEAVY_FIRE]: 'a Heavy Fire prompt is open',
  [INTERRUPT_TYPES.LAST_RESORT]: 'a Last Resort prompt is open',
  [INTERRUPT_TYPES.FALSE_ORDERS]: 'a False Orders prompt is open',
  [INTERRUPT_TYPES.STRAIN_CHOICE]: 'a Strain choice is open',
  [INTERRUPT_TYPES.ILLICIT_ARMS]: 'an Illicit Arms prompt is open',
  [INTERRUPT_TYPES.WANTON_DESTRUCTION]: 'a Wanton Destruction prompt is open',
  [INTERRUPT_TYPES.TOKEN_DISTRIBUTION]: 'a token distribution prompt is open',
  [INTERRUPT_TYPES.ILLEGAL_CC_PLAY]: 'an illegal CC play prompt is open',
  [INTERRUPT_TYPES.SHOULDER_RUSH]: 'a Shoulder Rush prompt is open',
  [INTERRUPT_TYPES.RUSH_PUSH]: 'a Rush Push prompt is open',
  [INTERRUPT_TYPES.BOLTSLINGER]: 'a Boltslinger prompt is open',
  [INTERRUPT_TYPES.MASSIVE_PUSH]: 'a Massive Push prompt is open',
  [INTERRUPT_TYPES.IT_WILL_BE_ALRIGHT]: "an It Will Be Alright prompt is open",
  [INTERRUPT_TYPES.HAVOC_SHOT]: 'a Havoc Shot prompt is open',
  [INTERRUPT_TYPES.GENERALS_ORDERS]: "a General's Orders prompt is open",
  [INTERRUPT_TYPES.COORDINATED_RAID]: 'a Coordinated Raid prompt is open',
  [INTERRUPT_TYPES.EXECUTIVE_ORDER]: 'an Executive Order prompt is open',
  [INTERRUPT_TYPES.FIGHTING_KNIFE]: 'a Fighting Knife prompt is open',
  [INTERRUPT_TYPES.FIELD_TACTICS]: 'a Field Tactics prompt is open',
  [INTERRUPT_TYPES.THERE_IS_NO_TRY]: 'a There Is No Try prompt is open',
  [INTERRUPT_TYPES.SPREAD_THE_PAIN]: 'a Spread the Pain prompt is open',
  [INTERRUPT_TYPES.PUNISHING_STRIKE]: 'a Punishing Strike prompt is open',
  [INTERRUPT_TYPES.POWER_CONVERTER]: 'a Power Converter prompt is open',
  [INTERRUPT_TYPES.DEFLECT]: 'a Deflect prompt is open',
  [INTERRUPT_TYPES.CONSPIRE]: 'a Conspire prompt is open',
  [INTERRUPT_TYPES.DIO_FOLLOW]: 'a Dio follow prompt is open',
  [INTERRUPT_TYPES.EXTRA_PROTECTION]: 'an Extra Protection prompt is open',
  [INTERRUPT_TYPES.DURASTEEL_FIST_PUSH]: 'a Durasteel Fist push prompt is open',
  [INTERRUPT_TYPES.ZILLO_DISCARD]: 'a Zillo discard prompt is open',
  [INTERRUPT_TYPES.SURGE_OVERFLOW]: 'a surge overflow prompt is open',
  [INTERRUPT_TYPES.WOOK_SLAM_PUSH]: 'a Wookiee slam push prompt is open',
  [INTERRUPT_TYPES.TOUGH_LUCK]: 'a Tough Luck prompt is open',
  [INTERRUPT_TYPES.ROGUE_ONE_TOKEN_PICK]: 'a Rogue One token pick is open',
  [INTERRUPT_TYPES.REACTION]: 'a reaction prompt is open',
  [INTERRUPT_TYPES.COMM_DISRUPTION_PROMPT]: 'a Comm Disruption prompt is open',
  [INTERRUPT_TYPES.INDISCRIMINATE_FIRE]: 'an Indiscriminate Fire prompt is open',
  [INTERRUPT_TYPES.CONCUSSIVE_BOLT]: 'a Concussive Bolt prompt is open',
  [INTERRUPT_TYPES.YHSIW]: 'a You Have Seen It Work prompt is open',
  [INTERRUPT_TYPES.TRUSTED_ALLY]: 'a Trusted Ally prompt is open',
  [INTERRUPT_TYPES.SUPPRESSIVE_FIRE_MP]: 'a Suppressive Fire MP prompt is open',
  [INTERRUPT_TYPES.STRIKE_ME_DOWN]: 'a Strike Me Down prompt is open',
  [INTERRUPT_TYPES.SLOW_ON_THE_DRAW]: 'a Slow on the Draw prompt is open',
  [INTERRUPT_TYPES.SCAVENGED_WEAPONRY_TRANSFER]: 'a Scavenged Weaponry transfer prompt is open',
  [INTERRUPT_TYPES.RIGHT_BACK_AT_YA]: "a Right Back At Ya prompt is open",
  [INTERRUPT_TYPES.ORBITAL_BOMBARDMENT]: 'an Orbital Bombardment prompt is open',
  [INTERRUPT_TYPES.MOTIVATION]: 'a Motivation prompt is open',
  [INTERRUPT_TYPES.LURE]: 'a Lure prompt is open',
  [INTERRUPT_TYPES.LOADOUT_SELECTION]: 'a loadout selection is open',
  [INTERRUPT_TYPES.LIE_IN_AMBUSH]: 'a Lie In Ambush prompt is open',
  [INTERRUPT_TYPES.I_KNOW_EVERYTHING]: 'an I Know Everything prompt is open',
  [INTERRUPT_TYPES.FORCE_EXHAUSTION]: 'a Force Exhaustion prompt is open',
  [INTERRUPT_TYPES.FIGUREHEAD]: 'a Figurehead prompt is open',
  [INTERRUPT_TYPES.EMPEROR_INTERRUPT]: 'an Emperor interrupt is open',
  [INTERRUPT_TYPES.CHANNEL_THE_FORCE_STRAIN]: 'a Channel the Force strain prompt is open',
  [INTERRUPT_TYPES.BOMBARDMENT_SORIN]: 'a Bombardment prompt is open',
  [INTERRUPT_TYPES.BATTLEFIELD_LEADERSHIP]: 'a Battlefield Leadership prompt is open',
  [INTERRUPT_TYPES.ASSASSINS_BLADE]: "an Assassin's Blade prompt is open",
  [INTERRUPT_TYPES.STILL_FASTER]: 'a Still Faster prompt is open',
  [INTERRUPT_TYPES.SELF_DESTRUCT]: 'a Self Destruct prompt is open',
  [INTERRUPT_TYPES.MASTERY]: 'a Mastery prompt is open',
  [INTERRUPT_TYPES.INTERROGATE]: 'an Interrogate prompt is open',
  [INTERRUPT_TYPES.HUNTER_PROTOCOL]: 'a Hunter Protocol prompt is open',
  [INTERRUPT_TYPES.EXECUTOR_INTERRUPT]: 'an Executor interrupt is open',
  [INTERRUPT_TYPES.BEL_REORDER]: 'a Battlefield Engineer reorder is open',
  [INTERRUPT_TYPES.UNHINGED_DIRECTOR]: 'an Unhinged Director +1/+2 choice is open',
  [INTERRUPT_TYPES.UNHINGED_STRAIN]: 'an Unhinged Director Strain absorb choice is open',
};

/** Generate a unique checkpoint ID. */
function makeCheckpointId() {
  return `cp_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

/**
 * Returns a human-readable reason if the game is mid-action, else ''.
 * Used by the save handler to refuse non-boundary saves.
 *
 * The save gate ONLY blocks states that need a real player decision —
 * combat, movement, space-pick, active activation, post-deploy ability
 * prompt, mid-CC-interrupt, mid-round-effects-resolving. Anywhere the
 * bot is just doing internal bookkeeping (e.g. deployment-just-finished
 * but the phase string hasn't flipped to cc_draw yet), the SAVE handler
 * runs that bookkeeping itself before snapshotting (see
 * `advanceTransitionalStateBeforeSnapshot`). This way the saver handles
 * more cases by *advancing* rather than *rejecting* — the bot never
 * makes a game decision on the user's behalf, but it doesn't refuse
 * a save just because a millisecond of internal plumbing is pending.
 */
export function whyMidAction(game) {
  if (!game) return '';
  // User-mid-action — actual decision-pending states.
  if (game.pendingCombat) return 'combat is in progress';
  if (game.moveInProgress && Object.keys(game.moveInProgress).length > 0) return 'a move is in progress';
  if (game.pendingSpacePick && Object.keys(game.pendingSpacePick).length > 0) return 'a space pick is open';
  if (game.dcActionsData && Object.keys(game.dcActionsData).length > 0) return 'an activation is in progress (use End Activation first)';
  // Post-deploy ability prompt active (Smooth Landing / Walker / Strike
  // Team / etc.) — user has to make a placement or movement choice.
  if (game.postDeployQueue) {
    const q = game.postDeployQueue;
    const hasPending = (Array.isArray(q.abilities) && q.abilities.length > 0)
      || (Array.isArray(q.nextPlayerAbilities) && q.nextPlayerAbilities.length > 0)
      || q.activeAbility
      || q.awaitingOrder;
    if (hasPending) return 'a post-deploy ability prompt is active (finish it before saving)';
  }
  // Specific user-input prompts that aren't covered above. These are the
  // pending* fields where loss-on-load would silently drop a player's
  // mid-flow decision (different from incidental pending* tracking).
  //
  // Source of truth (Phase 3 cutover, 2026-05-01 → completed 2026-05-11):
  // `getMidActionReason` consolidates BOTH the migrated stack (84
  // single-payload types) AND the legacy collection-shaped registry
  // (42 map/array/scalar pending fields) into one call. Adding a new
  // single-payload prompt is just a setPendingX helper; adding a new
  // collection-shaped pending field needs only a `LEGACY_COLLECTION_
  // INTERRUPTS` registry entry in interrupts.js — no edits here.
  const reason = getMidActionReason(game, INTERRUPT_GATE_MESSAGES);
  if (reason) return reason;
  // Round-phase transitions involve actual gameplay effects (damage from
  // Bleeding, VP awards, etc.) — not pure plumbing. Block; the user can
  // wait for the next round-activation message before saving.
  if (game.roundPhase === 'end_of_round') {
    return 'end-of-round effects are resolving — wait for the next round to start';
  }
  return '';
}

/**
 * Run any pure-bookkeeping transitions the bot was about to do anyway,
 * then return — leaves the game in a snapshot-clean state.
 *
 * This is NOT a place for resolving rules or mutating gameplay state.
 * It only flips the internal flags + phase strings that have no game-
 * decision content and would have been set by the bot in the next tick
 * regardless. Letting the saver run them inline keeps users from getting
 * stuck saves in the millisecond-windows between deployment finishing
 * and the cc_draw phase actually flipping over (the bug we just hit).
 *
 * Strict invariant: this function NEVER calls handlers, NEVER posts to
 * Discord, NEVER applies rules effects. Pure flag/phase manipulation.
 *
 * Returns true if any advancement happened (caller can log it), false
 * otherwise.
 */
export function advanceTransitionalStateBeforeSnapshot(game) {
  if (!game) return false;
  let advanced = false;
  // Deploy → cc_draw plumbing. If both squads are deployed, post-deploy
  // queue is empty (no ability prompts active — those would be blocked
  // by whyMidAction), but `postDeployEffectsFired` is still false and
  // `phase` is still 'deployment', the bot was about to flip these any
  // moment now. Do it ourselves so the snapshot captures cc_draw.
  const queueEmpty = !game.postDeployQueue
    || (
      (!game.postDeployQueue.abilities || game.postDeployQueue.abilities.length === 0)
      && (!game.postDeployQueue.nextPlayerAbilities || game.postDeployQueue.nextPlayerAbilities.length === 0)
      && !game.postDeployQueue.activeAbility
      && !game.postDeployQueue.awaitingOrder
    );
  if (
    game.phase === 'deployment'
    && game.player1Squad && game.player2Squad
    && game.initiativePlayerDeployed
    && game.nonInitiativePlayerDeployed
    && !game.postDeployEffectsFired
    && queueEmpty
  ) {
    game.postDeployEffectsFired = true;
    game.phase = 'cc_draw';
    delete game.postDeployQueue;
    advanced = true;
  }
  // Already at cc_draw but the flag's still false — same plumbing fix,
  // just a different starting point.
  if (game.phase === 'cc_draw' && !game.postDeployEffectsFired) {
    game.postDeployEffectsFired = true;
    advanced = true;
  }
  // Round_active + start_of_round + activation message not posted →
  // the bot was about to flip roundPhase to ACTIVATION. Pure plumbing
  // (no rules effects fire here — those run BEFORE this transition).
  // The activation message itself gets posted by the loader's safety
  // net, so we just flip the state.
  if (
    game.phase === 'round_active'
    && game.roundPhase === 'start_of_round'
    && !game.activationPhaseMessagePosted
  ) {
    game.roundPhase = 'activation';
    advanced = true;
  }
  return advanced;
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
 *   4. (Defensive) Run repopulateDcMapsForGame to set [[null, null]] defaults
 *      for any dcList[i] that's missing a healthState field. Post-Phase-4
 *      the side-channel Maps are derived views, so there's nothing to
 *      "rebuild" — but the defensive default-init protects against legacy
 *      save formats with sparse healthState fields.
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
  if (game.gameId) repopulateDcMapsForGame(game.gameId);
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
  // Idempotency flags for "did I post X in this session?" — these survive
  // the JSON snapshot but their semantics don't carry across a load. The
  // new lobby has different msgIds and a fresh UI surface; if these stay
  // true, the safety nets in refreshAllGameComponents silently skip
  // reposting (audit confirmed-bug 3 + gap 8). Clearing on load forces
  // the renderer / safety nets to repost from scratch.
  game.ccShuffleDrawPromptsPosted = false;
  game.activationPhaseMessagePosted = false;
  // Clear the interrupt stack — on load, no prompts are "active" because
  // the new lobby has fresh UI. The pending* sweep above handles legacy
  // field clears; this handles the new stack-based ones.
  clearAllInterrupts(game);
  // pendingCombat is covered by the pending* sweep but be explicit.
  // Slice 7.3: also clear any stacked nested-combat frames — the
  // checkpoint-load substitutes a fresh UI so paused outer attacks
  // don't survive the load.
  delete game.pendingCombat;
  delete game.combatStack;
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
    // fellSwoopFreeAttack, pummelTwoAttacksThisActivation, pummelAttacksRemaining
    // MIGRATED 2026-05-13 → per-figureKey (alexanbv). Each is keyed
    // by figureKey now and survives cross-lobby intact without remap.
    // dcFinishedPinged — msgId-keyed boolean tracking the end-of-activation
    // ping for each DC. Save gate refuses mid-activation so this is usually
    // empty at load, but a stale entry would otherwise survive cross-lobby
    // remap as an orphan. Including it keeps the field clean.
    'dcFinishedPinged',
    // overdriveUsedThisActivation removed: keyed by figureKey (in
    // ACTIVATION_FIGKEY_FLAGS), not msgId. Survives cross-lobby intact;
    // would never match this remap.
    'roundFigureAbilityUsed', // keys may be msgId_<ability>
    'rushPending', 'shoulderRushPending',
    // mobileMovementActive + attackDicePenaltyForMsgId MIGRATED 2026-05-13
    // → ACTIVATION_FIGKEY_FLAGS (alexanbv: per-figure).
    'pendingMoveX', 'pendingOnAMissionPush',
    'movementBank',
    // figurePowerTokens removed: keyed by figureKey (e.g. "Trooper-1-0"), not
    // msgId, so it survives cross-lobby intact and never matched here anyway.
    // moveCleaveActive + roundDcAbilityUsed removed: declared but never written
    // anywhere in the codebase.
    // overrunDamagedThisMove MIGRATED 2026-05-13 → figureKey-keyed (alexanbv).
    // Audit 2026-05-05: persistent / round-scoped msgId-keyed fields surfaced by
    // tests/certification/msgid-flags-completeness.test.js. These survive
    // mid-round (or longer) and would silently no-op on cross-lobby load
    // without remap — the same failure shape that bit dcFinishedPinged.
    'bloodFeudTargets',          // CC effect, persists across attacks
    'orbitalBombardmentTokens',  // accumulating tokens, consumed when bombardment fires
    'overwatchTokenPosition',    // persists until movement triggers it
    'secondChanceDcMsgId',       // round-scoped reset, but populated mid-round
    'selfAugmentationMsgId',     // persists once applied
    // Companion HP storage (added 2026-05-05). Canonical state for The
    // Child / Junk Droid / etc. — DerivedDcHealthState reads/writes
    // through to it for companion msgIds. Persists across activations
    // and rounds; needs cross-lobby key remap.
    'companionHealthState',
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
  if (!await requireParticipant(interaction, game, 'save checkpoints')) return;
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
  // Run any pure-bookkeeping transitions the bot was about to do anyway
  // (deploy → cc_draw plumbing, start_of_round → activation, etc.). This
  // eliminates the millisecond-windows where a snapshot would otherwise
  // capture a transitional half-state the loader can't recover from.
  // Strict invariant: this is flag/phase manipulation only — never a
  // gameplay decision on the user's behalf.
  advanceTransitionalStateBeforeSnapshot(game);
  // Boundary gate: refuse genuinely mid-action saves (combat / movement /
  // space-pick / activation / post-deploy ability prompt / mid-CC-interrupt
  // / end-of-round effects resolving). The advancement above already
  // unstuck pure plumbing transitions, so anything left is real player
  // input pending.
  const reason = whyMidAction(game);
  if (reason) {
    await interaction.editReply({ content: `❌ Can't save right now — ${reason}. Finish that action and try again.` }).catch(discordCatch);
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
  // Persist before snapshot (saveGames is post-Phase-4 a no-op for sync
  // but kept for any future hooks).
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
  if (!await requireParticipant(interaction, game, 'pick a checkpoint', { scope: 'lobby' })) return;
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
  const { getGame: getGameDep } = ctx;
  const gameId = parseCustomId(interaction.customId, 'cp_newgame_pick_');
  const cpId = interaction.values?.[0];
  await interaction.deferUpdate().catch(discordCatch);
  const game = await requireGame(interaction, getGameDep, gameId);
  if (!game) return;
  if (!await requireParticipant(interaction, game, 'pick', { scope: 'lobby' })) return;
  const cp = await loadCheckpointOrFollowUp(interaction, cpId);
  if (!cp) return;
  const ts = new Date(parseInt(cp.created_at, 10)).toLocaleString();
  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`cp_newgame_confirm_${gameId}_${cpId}`)
      .setLabel('Load checkpoint')
      .setStyle(ButtonStyle.Success),
    new ButtonBuilder()
      .setCustomId(`cp_newgame_back_${gameId}`)
      .setLabel('Choose different checkpoint')
      .setStyle(ButtonStyle.Danger),
  );
  await interaction.editReply({
    content: `📂 Load **"${cp.name}"** (round ${cp.round_at_save ?? 0}, saved ${ts}) into this lobby?`,
    components: [row],
  }).catch(discordCatch);
}

/**
 * Button handler: cp_newgame_back_<gameId>
 * Re-shows the checkpoint picker so the user can choose a different one.
 */
export async function handleCheckpointNewGameBack(interaction, ctx) {
  const { getGame: getGameDep } = ctx;
  const gameId = parseCustomId(interaction.customId, 'cp_newgame_back_');
  const game = await requireGame(interaction, getGameDep, gameId);
  if (!game) return;
  if (!await requireParticipant(interaction, game, 'pick a checkpoint', { scope: 'lobby' })) return;
  const checkpoints = await listAllCheckpoints({ limit: 25 });
  if (!checkpoints.length) {
    await interaction.editReply({ content: 'No checkpoints saved yet.', components: [] }).catch(discordCatch);
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
  await interaction.editReply({
    content: '🔀 **Pick a checkpoint** — the saved state will be loaded into this lobby.',
    components: [new ActionRowBuilder().addComponents(select)],
  }).catch(discordCatch);
}

/**
 * Button handler: cp_newgame_confirm_<gameId>_<cpId>
 * Executes the cross-lobby load. Creates board + play-area channels using
 * the saved map/squads, then runs applyCheckpointToNewLobby to post DCs
 * with their saved state.
 */
export async function handleCheckpointNewGameConfirm(interaction, ctx) {
  const {
    getGame: getGameDep, saveGames, client,
    createBoardChannel, createPlayAreaChannels, populatePlayAreas,
    buildBoardMapPayload, sendRoundActivationPhaseMessage,
    refreshAllGameComponents, updateAttachmentMessageForDc,
    createCompanionDcEmbed, buildDcEmbedAndFiles,
    dcMessageMeta, dcExhaustedState, dcHealthState,
    getDcPlayAreaComponents, getNicknamesForDcMessage,
    reorderPlayAreaAfterCheckpointLoad,
  } = ctx;
  // customId format: cp_newgame_confirm_<gameId>_<cpId>
  // Split on the FIRST underscore: gameId is always a numeric 5-digit
  // string (no underscores); cpId is `cp_<ms>_<rand>` (DOES contain
  // underscores). Using lastIndexOf would split inside the cpId and
  // leave gameId mangled → "Game not found".
  const rest = interaction.customId.slice('cp_newgame_confirm_'.length);
  const firstUnderscore = rest.indexOf('_');
  const gameId = rest.slice(0, firstUnderscore);
  const cpId = rest.slice(firstUnderscore + 1);
  const game = await requireGame(interaction, getGameDep, gameId);
  if (!game) return;
  if (!await requireParticipant(interaction, game, 'load', { scope: 'lobby' })) return;
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
    await renderHandThread(game, 1, client, ctx);
    await renderHandThread(game, 2, client, ctx);

    // Capture the lobby's "🔀 Load Checkpoint" prompt id so we can clean
    // it up after the load — restoreGameStateInPlace wipes state and the
    // lobbyIdentity overlay doesn't preserve generalSetupMessageId.
    const oldSetupPromptId = game.generalSetupMessageId;

    await applyCheckpointToNewLobby(game, cp, client, {
      populatePlayAreas, buildBoardMapPayload, sendRoundActivationPhaseMessage, saveGames,
      refreshAllGameComponents, updateAttachmentMessageForDc,
      createCompanionDcEmbed, buildDcEmbedAndFiles,
      dcMessageMeta, dcExhaustedState, dcHealthState,
      getDcPlayAreaComponents, getNicknamesForDcMessage,
      reorderPlayAreaAfterCheckpointLoad,
    });

    if (oldSetupPromptId) {
      await _bestEffortDeleteMsg(client, game.generalId, oldSetupPromptId);
    }

    if (settingUpMsg) settingUpMsg.delete().catch(() => {});
    // Dismiss the confirm-prompt ephemeral. No #general announcement —
    // the new round header + activation message make the load visible.
    await interaction.deleteReply().catch(discordCatch);
    saveGames?.(game.gameId);
  } catch (err) {
    console.error('checkpoint new-lobby load failed:', err);
    if (settingUpMsg) settingUpMsg.delete().catch(() => {});
    await general.send({ content: `❌ Checkpoint load failed: ${err.message}` }).catch(discordCatch);
  }
}

// ── In-game (same-lobby) checkpoint flow ────────────────────────────────────
// Loads a checkpoint INTO the current lobby instead of a fresh one. Reuses
// applyCheckpointToNewLobby — its lobbyIdentity overlay already preserves
// every Discord ID currentGame holds, so the saved state can land cleanly
// on top. The wrinkle vs. cross-lobby load: the lobby's channels already
// contain UI from the in-progress game (DCs, hand visuals, round message)
// that the load will re-post. We snapshot those msg IDs before the load
// and best-effort delete them after, to avoid duplicates piling up.

/** Best-effort delete of one message by channel + msgId. Silent on miss. */
async function _bestEffortDeleteMsg(client, channelId, msgId) {
  if (!channelId || !msgId) return;
  try {
    const ch = await fetchGameChannel(client, channelId);
    const msg = await ch.messages.fetch(msgId).catch(() => null);
    if (msg) await msg.delete().catch(() => {});
  } catch {}
}

/**
 * Snapshot every UI msgId tracked on `game` so we can delete the messages
 * after the in-place restore. Returns a list of {channelId, msgId} pairs.
 * Channels: DC cards/attachments/companions live in the play-area channel
 * for that player; hand-visual + discard pile + hand payload live in the
 * hand thread; activations msg lives in the play area; round activation
 * lives in general.
 */
function _snapshotInGameMsgs(game) {
  const out = [];
  const push = (channelId, msgId) => { if (channelId && msgId) out.push({ channelId, msgId }); };
  for (const id of game.p1DcMessageIds || []) push(game.p1PlayAreaId, id);
  for (const id of game.p2DcMessageIds || []) push(game.p2PlayAreaId, id);
  for (const id of game.p1DcAttachmentMessageIds || []) push(game.p1PlayAreaId, id);
  for (const id of game.p2DcAttachmentMessageIds || []) push(game.p2PlayAreaId, id);
  for (const id of game.p1DcCompanionMessageIds || []) push(game.p1PlayAreaId, id);
  for (const id of game.p2DcCompanionMessageIds || []) push(game.p2PlayAreaId, id);
  push(game.p1HandId, game.p1HandMessageId);
  push(game.p2HandId, game.p2HandMessageId);
  push(game.p1HandId, game.p1HandVisualMessageId);
  push(game.p2HandId, game.p2HandVisualMessageId);
  push(game.p1HandId, game.p1DiscardPileMessageId);
  push(game.p2HandId, game.p2DiscardPileMessageId);
  push(game.p1PlayAreaId, game.p1ActivationsMessageId);
  push(game.p2PlayAreaId, game.p2ActivationsMessageId);
  push(game.generalId, game.roundActivationMessageId);
  return out;
}

/**
 * Button handler: cp_load_ingame_open_<gameId>
 * Posts an ephemeral select with all global checkpoints — same picker as
 * the new-lobby flow but routes the choice to the in-game pick handler.
 */
export async function handleCheckpointInGameOpen(interaction, ctx) {
  const { getGame: getGameDep } = ctx;
  const gameId = parseCustomId(interaction.customId, 'cp_load_ingame_open_');
  const game = await requireGame(interaction, getGameDep, gameId);
  if (!game) return;
  if (!await requireParticipant(interaction, game, 'load a checkpoint')) return;
  const checkpoints = await listAllCheckpoints({ limit: 25 });
  if (!checkpoints.length) {
    await interaction.followUp({ content: 'No checkpoints saved yet. Save one with **/botmenu → 💾 Save Checkpoint** first.', ephemeral: true }).catch(discordCatch);
    return;
  }
  const select = new StringSelectMenuBuilder()
    .setCustomId(`cp_load_ingame_pick_${gameId}`)
    .setPlaceholder('Choose a checkpoint to load into this lobby...')
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
    content: '🔀 **Pick a checkpoint** — it will replace this lobby\'s current game state. You\'ll see a confirm prompt next.',
    components: [new ActionRowBuilder().addComponents(select)],
    ephemeral: true,
  }).catch(discordCatch);
}

/**
 * Select handler: cp_load_ingame_pick_<gameId>
 * Shows a confirmation prompt before doing the destructive load. The cp
 * id is encoded in the confirm button's customId.
 */
export async function handleCheckpointInGamePick(interaction, ctx) {
  const { getGame: getGameDep } = ctx;
  const gameId = parseCustomId(interaction.customId, 'cp_load_ingame_pick_');
  const cpId = interaction.values?.[0];
  await interaction.deferUpdate().catch(discordCatch);
  const game = await requireGame(interaction, getGameDep, gameId);
  if (!game) return;
  if (!await requireParticipant(interaction, game, 'load', { scope: 'lobby' })) return;
  const cp = await loadCheckpointOrFollowUp(interaction, cpId);
  if (!cp) return;
  const ts = new Date(parseInt(cp.created_at, 10)).toLocaleString();
  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`cp_load_ingame_confirm_${gameId}_${cpId}`)
      .setLabel('Load checkpoint')
      .setStyle(ButtonStyle.Success),
    new ButtonBuilder()
      .setCustomId(`cp_load_ingame_back_${gameId}`)
      .setLabel('Choose different checkpoint')
      .setStyle(ButtonStyle.Danger),
  );
  await interaction.editReply({
    content: `⚠️ Replace this lobby's game state with **"${cp.name}"** (round ${cp.round_at_save ?? 0}, saved ${ts})?\n\n**Any progress made since this checkpoint will be lost.** Old DC cards, hand visuals, and the round message in this lobby will be deleted and re-posted from the saved state.`,
    components: [row],
  }).catch(discordCatch);
}

/**
 * Button handler: cp_load_ingame_back_<gameId>
 * Re-shows the checkpoint picker so the user can choose a different one.
 */
export async function handleCheckpointInGameBack(interaction, ctx) {
  const { getGame: getGameDep } = ctx;
  const gameId = parseCustomId(interaction.customId, 'cp_load_ingame_back_');
  const game = await requireGame(interaction, getGameDep, gameId);
  if (!game) return;
  if (!await requireParticipant(interaction, game, 'load a checkpoint')) return;
  const checkpoints = await listAllCheckpoints({ limit: 25 });
  if (!checkpoints.length) {
    await interaction.editReply({ content: 'No checkpoints saved yet.', components: [] }).catch(discordCatch);
    return;
  }
  const select = new StringSelectMenuBuilder()
    .setCustomId(`cp_load_ingame_pick_${gameId}`)
    .setPlaceholder('Choose a checkpoint to load into this lobby...')
    .addOptions(checkpoints.map((cp) => {
      const ts = new Date(parseInt(cp.created_at, 10)).toLocaleString();
      const players = [cp.p1_username, cp.p2_username].filter(Boolean).join(' vs ') || cp.origin_game_id || 'unknown';
      return {
        label: cp.name.slice(0, 100),
        description: `${players} · round ${cp.round_at_save ?? 0} · ${ts}`.slice(0, 100),
        value: cp.id,
      };
    }));
  await interaction.editReply({
    content: '🔀 **Pick a checkpoint** — it will replace this lobby\'s current game state.',
    components: [new ActionRowBuilder().addComponents(select)],
  }).catch(discordCatch);
}

/**
 * Button handler: cp_load_ingame_confirm_<gameId>_<cpId>
 * Performs the in-place load:
 *   1. Snapshot every UI msgId currently tracked on the live game.
 *   2. Call applyCheckpointToNewLobby — its lobbyIdentity overlay keeps
 *      our channel/player IDs, so the saved state lands in this lobby.
 *      It also re-renders all surfaces with NEW msgIds.
 *   3. Best-effort delete the snapshotted old messages so the player
 *      doesn't see two copies of every DC / hand visual / round message.
 */
export async function handleCheckpointInGameConfirm(interaction, ctx) {
  const {
    getGame: getGameDep, saveGames, client,
    populatePlayAreas, buildBoardMapPayload, sendRoundActivationPhaseMessage,
    refreshAllGameComponents, updateAttachmentMessageForDc,
    createCompanionDcEmbed, buildDcEmbedAndFiles,
    dcMessageMeta, dcExhaustedState, dcHealthState,
    getDcPlayAreaComponents, getNicknamesForDcMessage,
    reorderPlayAreaAfterCheckpointLoad,
  } = ctx;
  // customId format: cp_load_ingame_confirm_<gameId>_<cpId>
  // Split on FIRST underscore: gameId has none, cpId has two
  // (`cp_<ms>_<rand>`). lastIndexOf would split inside cpId.
  const rest = interaction.customId.slice('cp_load_ingame_confirm_'.length);
  const firstUnderscore = rest.indexOf('_');
  const gameId = rest.slice(0, firstUnderscore);
  const cpId = rest.slice(firstUnderscore + 1);
  await interaction.deferUpdate().catch(discordCatch);
  const game = await requireGame(interaction, getGameDep, gameId);
  if (!game) return;
  if (!await requireParticipant(interaction, game, 'load', { scope: 'lobby' })) return;
  const cp = await loadCheckpointOrFollowUp(interaction, cpId);
  if (!cp) return;

  const general = game.generalId ? await fetchGameChannel(client, game.generalId).catch(() => null) : null;
  const settingUpMsg = general ? await general.send({ content: '⏳ Loading checkpoint into this lobby...' }).catch(() => null) : null;

  // Snapshot old UI msgs BEFORE the restore wipes the IDs.
  const oldMsgs = _snapshotInGameMsgs(game);

  try {
    await applyCheckpointToNewLobby(game, cp, client, {
      populatePlayAreas, buildBoardMapPayload, sendRoundActivationPhaseMessage, saveGames,
      refreshAllGameComponents, updateAttachmentMessageForDc,
      createCompanionDcEmbed, buildDcEmbedAndFiles,
      dcMessageMeta, dcExhaustedState, dcHealthState,
      getDcPlayAreaComponents, getNicknamesForDcMessage,
      reorderPlayAreaAfterCheckpointLoad,
    });

    // Delete old UI messages now that fresh ones are posted.
    for (const { channelId, msgId } of oldMsgs) {
      await _bestEffortDeleteMsg(client, channelId, msgId);
    }

    if (settingUpMsg) settingUpMsg.delete().catch(() => {});
    // Dismiss the confirm-prompt ephemeral entirely. No #general
    // announcement — the new round header + activation message make
    // the load visible.
    await interaction.deleteReply().catch(discordCatch);
    saveGames?.(game.gameId);
  } catch (err) {
    console.error('checkpoint in-game load failed:', err);
    if (settingUpMsg) settingUpMsg.delete().catch(() => {});
    await interaction.editReply({ content: `❌ Checkpoint load failed: ${err.message}`, components: [] }).catch(discordCatch);
    if (general) {
      await general.send({ content: `❌ Checkpoint load failed: ${err.message}` }).catch(discordCatch);
    }
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
  //    EVERY field that holds a Discord ID for THIS lobby has to be in here —
  //    anything missing gets stomped by the saved checkpoint's value, which
  //    points at the ORIGINAL lobby's resources (which probably no longer
  //    exist). gameCategoryId being missing here was the root cause of the
  //    killgame silent-fail in checkpoint-loaded games — kill walks the
  //    stale category and finds nothing.
  const lobbyIdentity = {
    gameId: newGame.gameId,
    guildId: newGame.guildId,
    player1Id: newGame.player1Id,
    player2Id: newGame.player2Id,
    gameCategoryId: newGame.gameCategoryId,
    generalId: newGame.generalId,
    chatId: newGame.chatId,
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
  // 7b. Renderer "ensure correctness" pass — each surface migrated to the
  //     renderer (see project_renderer_consolidation_plan.md) gets verified
  //     here. populatePlayAreas already posted these in the common case;
  //     the renderer is idempotent for the existing-and-correct case and
  //     plugs the gap when populatePlayAreas missed (e.g. cross-lobby load
  //     where a surface's setup path didn't run).
  await renderHandThread(newGame, 1, client);
  await renderHandThread(newGame, 2, client);
  await renderHandVisual(newGame, 1, client);
  await renderHandVisual(newGame, 2, client);
  // renderHandPayload depends on the hand thread existing — that's why it
  // runs after renderHandThread above. Without this, cross-lobby loads
  // came up with empty hand threads (audit bug 1).
  await renderHandPayload(newGame, 1, client);
  await renderHandPayload(newGame, 2, client);
  await renderRoundActivationMessage(newGame, client, deps);
  // 7b'. Remap msgId-keyed game-state fields from old→new BEFORE any
  //      recreation loops below read them. Attachment + companion loops
  //      look up game.p1/p2DcAttachments and game.p1/p2CcAttachments by
  //      the NEW DC msgId; if remap hasn't run yet, those objects are
  //      still keyed by the OLD checkpoint-saved msgIds and the lookups
  //      return empty → silent no-op → no embeds posted. (Was the bug
  //      that left cross-lobby-loaded games with all attachments and
  //      attachment-derived companions like Baze's Child invisible.)
  remapMsgIdKeyedFields(newGame, oldP1DcIds, oldP2DcIds);
  // 7c. Re-create DC attachment messages (audit gap 5). populatePlayAreas
  //     posts the DC card itself but doesn't recreate attachment embeds —
  //     those are created on-demand during normal play. Iterate every DC
  //     and let updateAttachmentMessageForDc decide (it's already a
  //     post-or-edit-or-delete reconciler internally — no-ops when the
  //     DC has no attachments).
  if (deps.updateAttachmentMessageForDc) {
    for (const playerNum of [1, 2]) {
      const dcMsgIds = playerNum === 1 ? newGame.p1DcMessageIds : newGame.p2DcMessageIds;
      for (const dcMsgId of dcMsgIds || []) {
        if (dcMsgId) {
          await deps.updateAttachmentMessageForDc(newGame, playerNum, dcMsgId, client)
            .catch(err => console.error(`[loader] updateAttachmentMessageForDc failed for ${dcMsgId}:`, err));
        }
      }
    }
  }
  // 7d. Re-create DC companion messages (audit gap 6). Iterate every DC
  //     and let renderDcCompanion decide — no-ops for DCs without
  //     companions, posts new companion embeds for DCs that have them
  //     but lost their companion msg id during cross-lobby restore.
  for (const playerNum of [1, 2]) {
    const dcList = playerNum === 1 ? (newGame.p1DcList || []) : (newGame.p2DcList || []);
    for (let i = 0; i < dcList.length; i++) {
      try {
        await renderDcCompanion(newGame, playerNum, i, client, deps);
      } catch (err) {
        console.error(`[loader] renderDcCompanion failed for player ${playerNum} index ${i}:`, err.message);
      }
    }
  }
  // 7e. Cosmetic post-pass: the three render phases above each post a
  //     batch at the bottom of the channel ([all DCs] [all attachments]
  //     [all companions]) because Discord can't insert at arbitrary
  //     positions. Delete + repost interleaved so each DC sits next to
  //     its own attachment + companion. Best-effort; failure leaves the
  //     ugly-but-functional original ordering. Re-posting changes DC
  //     msgIds again, so the helper calls remapMsgIdKeyedFields itself.
  if (deps.reorderPlayAreaAfterCheckpointLoad) {
    try {
      await deps.reorderPlayAreaAfterCheckpointLoad(newGame, client, {
        ...deps,
        remapMsgIdKeyedFields,
      });
    } catch (err) {
      console.error('reorderPlayAreaAfterCheckpointLoad failed:', err);
    }
  }
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
  // (Round-activation message handled in the renderer pass above —
  // renderRoundActivationMessage gates on phase === 'round_active', closing
  // audit bug 2 where the old `currentRound > 0` gate fired during deployment.)
  // Phase-specific UI safety nets — refreshAllGameComponents posts the
  // CC shuffle/draw prompts (cc_draw phase), the activation message
  // (round_active stuck-state recovery), and other phase-stuck rescues.
  // Without this, loading a checkpoint into mid-cc_draw leaves players
  // with no Shuffle/Draw button to click and the game stalls.
  if (deps.refreshAllGameComponents) {
    try { await deps.refreshAllGameComponents(newGame, client); }
    catch (err) { console.error('refreshAllGameComponents (cross-game load) failed:', err); }
  }
  // 11. Phase-gate recovery — if the saved game was mid phase-gate window
  //     (start_of_round / pre_activation / pre_end_of_round / post_end_of_round),
  //     game.phaseGate is restored from snapshot but its Ready buttons live in
  //     the OLD lobby's hand channels (deleted). Without this, both players
  //     are stuck — no buttons to click, can't advance the phase. /resync's
  //     runRecovery handles this manually; here we run it as part of the
  //     load so the gate is usable immediately.
  try {
    if (newGame.phaseGate) {
      await recoverPhaseGate(newGame, newGame.gameId, { client });
    }
  } catch (err) {
    console.error('phase-gate recovery (cross-game load) failed:', err);
  }
  if (deps.saveGames) deps.saveGames(newGame.gameId);
}

// ── Helpers ─────────────────────────────────────────────────────────────────

export {
  snapshotGameState,
  clearPendingAndPerMsgIdState,
  remapMsgIdKeyedFields,
};
