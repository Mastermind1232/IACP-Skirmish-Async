/**
 * Interrupt stack — single source of truth for "the bot is mid-something."
 *
 * Replaces the 112 ad-hoc `pendingFooBar` fields scattered across game state.
 * Each interrupt is a structured entry on a single per-game array, with
 * consistent shape and semantics. Anyone who needs to know "is the bot
 * currently waiting on a player decision" reads one place.
 *
 * Entry shape:
 *   {
 *     id: string,           // unique per push, for reference
 *     type: string,          // INTERRUPT_TYPES.* — one of the registered kinds
 *     payload: object,        // type-specific data (msgId, choices, etc.)
 *     blocksSave: boolean,    // true means whyMidAction refuses checkpoint saves
 *     createdAt: number,     // Date.now() at push time
 *   }
 *
 * Migration plan (see project_pending_consolidation_plan.md):
 *   Phase 0 (this commit): foundation — module + types + helpers + tests.
 *   Phase 1: migrate one feature (renderHandPayload's CC-choice prompt) as proof.
 *   Phase 2-N: migrate remaining 111 pendingFooBar fields incrementally.
 *   Phase final: delete the old fields, replace whyMidAction's catch-all
 *     and clearPendingAndPerMsgIdState's sweep with one-line stack checks.
 */

/**
 * Catalog of interrupt types. New interrupts add to this catalog rather
 * than inventing a new pendingFooBar field. The string is the type tag
 * stored on the entry.
 *
 * Types are namespaced by feature category to keep the catalog browsable:
 *   COMBAT_*  — anything during a combat resolution
 *   MOVEMENT_* — movement / displacement / push prompts
 *   CC_*      — command-card-driven interrupts
 *   DC_*      — deployment-card ability prompts
 *   POST_DEPLOY_* — deployment-phase ability resolutions
 *   ROUND_*    — start/end of round effect prompts
 *   META_*    — non-gameplay flow (squad confirm, attachment phase, etc.)
 */
export const INTERRUPT_TYPES = Object.freeze({
  // Combat-related interrupts
  COMBAT_PENDING:        'combat-pending',
  COMBAT_RESUPPLY:       'combat-resupply',
  COVER_FIRE:            'cover-fire',
  GUIDANCE_SYSTEMS:      'guidance-systems',
  PRE_REROLL:            'pre-reroll',
  POWER_TOKEN_OVERFLOW:  'power-token-overflow',

  // CC-driven prompts
  CC_NEGATION:           'cc-negation',
  CC_CHOICE:             'cc-choice',
  CC_SPACE_CHOICE:       'cc-space-choice',
  CC_CONFIRMATION:       'cc-confirmation',
  CC_ATTACHMENT:         'cc-attachment',
  CELEBRATION:           'celebration',

  // DC abilities
  DC_ABILITY_CHOICE:     'dc-ability-choice',

  // Movement / displacement
  SPACE_PICK:            'space-pick',
  DEPLOY_ORIENTATION:    'deploy-orientation',
  BOMB_DROP:             'bomb-drop',
  CLEAVE:                'cleave',
  SHOULDER_RUSH:         'shoulder-rush',
  RUSH_PUSH:             'rush-push',

  // Combat reactions
  HEAVY_FIRE:            'heavy-fire',
  LAST_RESORT:           'last-resort',
  FALSE_ORDERS:          'false-orders',
  STRAIN_CHOICE:         'strain-choice',
  ILLICIT_ARMS:          'illicit-arms',
  WANTON_DESTRUCTION:    'wanton-destruction',
  TOKEN_DISTRIBUTION:    'token-distribution',
  ILLEGAL_CC_PLAY:       'illegal-cc-play',
  MASSIVE_PUSH:          'massive-push',
  IT_WILL_BE_ALRIGHT:    'it-will-be-alright',
  HAVOC_SHOT:            'havoc-shot',
  GENERALS_ORDERS:       'generals-orders',
  COORDINATED_RAID:      'coordinated-raid',
  EXECUTIVE_ORDER:       'executive-order',
  FIGHTING_KNIFE:        'fighting-knife',
  FIELD_TACTICS:         'field-tactics',
  THERE_IS_NO_TRY:       'there-is-no-try',
  SPREAD_THE_PAIN:       'spread-the-pain',
  PUNISHING_STRIKE:      'punishing-strike',
  POWER_CONVERTER:       'power-converter',
  DEFLECT:               'deflect',
  CONSPIRE:              'conspire',
  DIO_FOLLOW:            'dio-follow',
  EXTRA_PROTECTION:      'extra-protection',
  DURASTEEL_FIST_PUSH:   'durasteel-fist-push',
  ZILLO_DISCARD:         'zillo-discard',
  SURGE_OVERFLOW:        'surge-overflow',
  // ORDERED_MOVE removed 2026-05-09 — pipeline retired, all granted
  // moves now use pendingMoveX. Saves from older lobbies that still
  // have an 'ordered-move' interrupt frame are silently ignored.
  WOOK_SLAM_PUSH:        'wook-slam-push',
  TOUGH_LUCK:            'tough-luck',
  ROGUE_ONE_TOKEN_PICK:  'rogue-one-token-pick',
  REACTION:              'reaction',
  COMM_DISRUPTION_PROMPT:'comm-disruption-prompt',
  INDISCRIMINATE_FIRE:   'indiscriminate-fire',
  CONCUSSIVE_BOLT:       'concussive-bolt',
  YHSIW:                 'yhsiw',
  TRUSTED_ALLY:          'trusted-ally',
  SUPPRESSIVE_FIRE_MP:   'suppressive-fire-mp',
  STRIKE_ME_DOWN:        'strike-me-down',
  SLOW_ON_THE_DRAW:      'slow-on-the-draw',
  SCAVENGED_WEAPONRY_TRANSFER: 'scavenged-weaponry-transfer',
  RIGHT_BACK_AT_YA:      'right-back-at-ya',
  ORBITAL_BOMBARDMENT:   'orbital-bombardment',
  MOTIVATION:            'motivation',
  LURE:                  'lure',
  LOADOUT_SELECTION:     'loadout-selection',
  LIE_IN_AMBUSH:         'lie-in-ambush',
  I_KNOW_EVERYTHING:     'i-know-everything',
  FORCE_EXHAUSTION:      'force-exhaustion',
  FIGUREHEAD:            'figurehead',
  EMPEROR_INTERRUPT:     'emperor-interrupt',
  CHANNEL_THE_FORCE_STRAIN: 'channel-the-force-strain',
  BOMBARDMENT_SORIN:     'bombardment-sorin',
  BATTLEFIELD_LEADERSHIP:'battlefield-leadership',
  ASSASSINS_BLADE:       'assassins-blade',
  STILL_FASTER:          'still-faster',
  SELF_DESTRUCT:         'self-destruct',
  MASTERY:               'mastery',
  MILITARY_EFFICIENCY:   'military-efficiency',
  INTERROGATE:           'interrogate',
  HUNTER_PROTOCOL:       'hunter-protocol',
  EXECUTOR_INTERRUPT:    'executor-interrupt',
  DEFEAT_PICK:           'defeat-pick',
  PARTING_SHOT:          'parting-shot',
  FINAL_STAND:           'final-stand',
  DYING_LUNGE:           'dying-lunge',
  MIRACLE_WORKER:        'miracle-worker',
  PRESERVATION_PROTOCOL: 'preservation-protocol',
  BEL_REORDER:           'bel-reorder',
  UNHINGED_DIRECTOR:     'unhinged-director',
  UNHINGED_STRAIN:       'unhinged-strain',

  // Post-deploy abilities
  POST_DEPLOY_QUEUE:     'post-deploy-queue',

  // Round effects
  BLEEDING:              'bleeding',
  ROUND_EFFECT_RESOLVING: 'round-effect-resolving',
  MISSION_SOR_REVEAL:    'mission-sor-reveal',

  // Special-effect prompts
  BOLTSLINGER:           'boltslinger',

  // Meta
  ILLEGAL_SQUAD:         'illegal-squad',
  SQUAD_CONFIRM:         'squad-confirm',
  ATTACH_CONFIRM:        'attach-confirm',
});

let _idCounter = 0;
function makeInterruptId() {
  return `int_${Date.now()}_${++_idCounter}`;
}

/**
 * Push a new interrupt onto the game's stack. Returns the created entry
 * (caller can grab `.id` if it needs to reference the entry later).
 */
export function pushInterrupt(game, type, payload = {}, opts = {}) {
  if (!game) return null;
  if (!Array.isArray(game.interrupts)) game.interrupts = [];
  const entry = {
    id: makeInterruptId(),
    type,
    payload,
    blocksSave: opts.blocksSave !== false,
    createdAt: Date.now(),
  };
  game.interrupts.push(entry);
  return entry;
}

/**
 * Find the first (oldest) interrupt of `type` without removing it.
 * Returns null if not found.
 */
export function peekInterrupt(game, type) {
  if (!game?.interrupts) return null;
  return game.interrupts.find((i) => i.type === type) || null;
}

/**
 * Find an interrupt by its id (for type-agnostic lookup).
 */
export function getInterruptById(game, id) {
  if (!game?.interrupts) return null;
  return game.interrupts.find((i) => i.id === id) || null;
}

/**
 * Remove an interrupt of `type` (the first match if multiple). Returns
 * the removed entry, or null if not found.
 */
export function popInterrupt(game, type) {
  if (!game?.interrupts) return null;
  const idx = game.interrupts.findIndex((i) => i.type === type);
  if (idx < 0) return null;
  return game.interrupts.splice(idx, 1)[0];
}

/**
 * Remove a specific interrupt by id. Returns the removed entry or null.
 */
export function popInterruptById(game, id) {
  if (!game?.interrupts) return null;
  const idx = game.interrupts.findIndex((i) => i.id === id);
  if (idx < 0) return null;
  return game.interrupts.splice(idx, 1)[0];
}

/**
 * True if the game has any interrupts at all (regardless of blocksSave).
 */
export function hasAnyInterrupts(game) {
  return (game?.interrupts || []).length > 0;
}

/**
 * Returns interrupts that should block checkpoint save. Used by whyMidAction
 * during the migration: instead of enumerating 112 fields, ask the stack.
 */
export function getBlockingInterrupts(game) {
  return (game?.interrupts || []).filter((i) => i.blocksSave);
}

/**
 * Wipe the stack. Called by clearPendingAndPerMsgIdState during checkpoint
 * load — the new lobby starts with no interrupts.
 */
export function clearAllInterrupts(game) {
  if (game) game.interrupts = [];
}

/**
 * True if the given type currently has at least one interrupt on the stack.
 */
export function hasInterrupt(game, type) {
  return peekInterrupt(game, type) !== null;
}

// ──────────────────────────────────────────────────────────────────────────
// Per-feature dual-write wrappers (Phase 1.5 of the migration plan)
//
// Writers go through these helpers; they update BOTH the legacy
// `game.pendingFooBar` field (so existing 49+ readers keep working) AND
// the new `game.interrupts` stack. Once all readers migrate to the stack,
// the legacy field gets dropped and the dual-write becomes single-write.
//
// Each helper has the shape:
//   setPendingFoo(game, payload) — write
//   clearPendingFoo(game)        — clear
//
// Adding a new pending-style feature: add to INTERRUPT_TYPES + add a
// dual-write helper here. Don't write `game.pendingFoo = X` directly.
// ──────────────────────────────────────────────────────────────────────────

/**
 * Replace any existing CC_NEGATION interrupt with the given payload.
 * Sets BOTH `game.pendingNegation` (legacy) and the stack entry.
 */
export function setPendingNegation(game, payload) {
  if (!game) return;
  game.pendingNegation = payload;
  if (!Array.isArray(game.interrupts)) game.interrupts = [];
  game.interrupts = game.interrupts.filter((i) => i.type !== INTERRUPT_TYPES.CC_NEGATION);
  pushInterrupt(game, INTERRUPT_TYPES.CC_NEGATION, payload);
}

/**
 * Mutate the existing pendingNegation in place (e.g. after waitingMsgId is
 * known). Keeps the stack entry's payload reference in sync.
 */
export function updatePendingNegation(game, mutator) {
  if (!game?.pendingNegation) return;
  mutator(game.pendingNegation);
  // Stack entry's payload IS game.pendingNegation by reference (set above),
  // so the mutation propagates. But if someone constructed an entry with a
  // different object, refresh it explicitly.
  const entry = peekInterrupt(game, INTERRUPT_TYPES.CC_NEGATION);
  if (entry && entry.payload !== game.pendingNegation) {
    entry.payload = game.pendingNegation;
  }
}

/**
 * Clear the CC_NEGATION interrupt from BOTH the legacy field and the stack.
 */
export function clearPendingNegation(game) {
  if (!game) return;
  delete game.pendingNegation;
  if (Array.isArray(game.interrupts)) {
    game.interrupts = game.interrupts.filter((i) => i.type !== INTERRUPT_TYPES.CC_NEGATION);
  }
}

/** CC_CHOICE — dual-write helpers. */
export function setPendingCcChoice(game, payload) {
  if (!game) return;
  game.pendingCcChoice = payload;
  if (!Array.isArray(game.interrupts)) game.interrupts = [];
  game.interrupts = game.interrupts.filter((i) => i.type !== INTERRUPT_TYPES.CC_CHOICE);
  pushInterrupt(game, INTERRUPT_TYPES.CC_CHOICE, payload);
}
export function clearPendingCcChoice(game) {
  if (!game) return;
  delete game.pendingCcChoice;
  if (Array.isArray(game.interrupts)) {
    game.interrupts = game.interrupts.filter((i) => i.type !== INTERRUPT_TYPES.CC_CHOICE);
  }
}

/** CELEBRATION — dual-write helpers. */
export function setPendingCelebration(game, payload) {
  if (!game) return;
  game.pendingCelebration = payload;
  if (!Array.isArray(game.interrupts)) game.interrupts = [];
  game.interrupts = game.interrupts.filter((i) => i.type !== INTERRUPT_TYPES.CELEBRATION);
  pushInterrupt(game, INTERRUPT_TYPES.CELEBRATION, payload);
}
export function clearPendingCelebration(game) {
  if (!game) return;
  delete game.pendingCelebration;
  if (Array.isArray(game.interrupts)) {
    game.interrupts = game.interrupts.filter((i) => i.type !== INTERRUPT_TYPES.CELEBRATION);
  }
}

// ──────────────────────────────────────────────────────────────────────────
// Bulk dual-write helpers — same pattern as the three above, just generated.
// Each entry produces setPendingX(game, payload) + clearPendingX(game).
// Add to this list when migrating another single-payload pendingFooBar field.
// ──────────────────────────────────────────────────────────────────────────

function _setDual(game, fieldName, type, payload) {
  if (!game) return;
  game[fieldName] = payload;
  if (!Array.isArray(game.interrupts)) game.interrupts = [];
  game.interrupts = game.interrupts.filter((i) => i.type !== type);
  pushInterrupt(game, type, payload);
}
function _clearDual(game, fieldName, type) {
  if (!game) return;
  delete game[fieldName];
  if (Array.isArray(game.interrupts)) {
    game.interrupts = game.interrupts.filter((i) => i.type !== type);
  }
}

export function setPendingCcConfirmation(game, payload) { _setDual(game, 'pendingCcConfirmation', INTERRUPT_TYPES.CC_CONFIRMATION, payload); }
export function clearPendingCcConfirmation(game) { _clearDual(game, 'pendingCcConfirmation', INTERRUPT_TYPES.CC_CONFIRMATION); }

export function setPendingCcSpaceChoice(game, payload) { _setDual(game, 'pendingCcSpaceChoice', INTERRUPT_TYPES.CC_SPACE_CHOICE, payload); }
export function clearPendingCcSpaceChoice(game) { _clearDual(game, 'pendingCcSpaceChoice', INTERRUPT_TYPES.CC_SPACE_CHOICE); }

export function setPendingCcAttachment(game, payload) { _setDual(game, 'pendingCcAttachment', INTERRUPT_TYPES.CC_ATTACHMENT, payload); }
export function clearPendingCcAttachment(game) { _clearDual(game, 'pendingCcAttachment', INTERRUPT_TYPES.CC_ATTACHMENT); }

export function setPendingCleave(game, payload) { _setDual(game, 'pendingCleave', INTERRUPT_TYPES.CLEAVE, payload); }
export function clearPendingCleave(game) { _clearDual(game, 'pendingCleave', INTERRUPT_TYPES.CLEAVE); }

export function setPendingCoverFire(game, payload) { _setDual(game, 'pendingCoverFire', INTERRUPT_TYPES.COVER_FIRE, payload); }
export function clearPendingCoverFire(game) { _clearDual(game, 'pendingCoverFire', INTERRUPT_TYPES.COVER_FIRE); }

export function setPendingBoltslinger(game, payload) { _setDual(game, 'pendingBoltslinger', INTERRUPT_TYPES.BOLTSLINGER, payload); }
export function clearPendingBoltslinger(game) { _clearDual(game, 'pendingBoltslinger', INTERRUPT_TYPES.BOLTSLINGER); }

export function setPendingShoulderRush(game, payload) { _setDual(game, 'pendingShoulderRush', INTERRUPT_TYPES.SHOULDER_RUSH, payload); }
export function clearPendingShoulderRush(game) { _clearDual(game, 'pendingShoulderRush', INTERRUPT_TYPES.SHOULDER_RUSH); }

export function setPendingRushPush(game, payload) { _setDual(game, 'pendingRushPush', INTERRUPT_TYPES.RUSH_PUSH, payload); }
export function clearPendingRushPush(game) { _clearDual(game, 'pendingRushPush', INTERRUPT_TYPES.RUSH_PUSH); }

export function setPendingHeavyFire(game, payload) { _setDual(game, 'pendingHeavyFire', INTERRUPT_TYPES.HEAVY_FIRE, payload); }
export function clearPendingHeavyFire(game) { _clearDual(game, 'pendingHeavyFire', INTERRUPT_TYPES.HEAVY_FIRE); }

export function setPendingLastResort(game, payload) { _setDual(game, 'pendingLastResort', INTERRUPT_TYPES.LAST_RESORT, payload); }
export function clearPendingLastResort(game) { _clearDual(game, 'pendingLastResort', INTERRUPT_TYPES.LAST_RESORT); }

export function setPendingFalseOrders(game, payload) { _setDual(game, 'pendingFalseOrders', INTERRUPT_TYPES.FALSE_ORDERS, payload); }
export function clearPendingFalseOrders(game) { _clearDual(game, 'pendingFalseOrders', INTERRUPT_TYPES.FALSE_ORDERS); }

export function setPendingStrainChoice(game, payload) { _setDual(game, 'pendingStrainChoice', INTERRUPT_TYPES.STRAIN_CHOICE, payload); }
export function clearPendingStrainChoice(game) { _clearDual(game, 'pendingStrainChoice', INTERRUPT_TYPES.STRAIN_CHOICE); }

export function setPendingIllicitArms(game, payload) { _setDual(game, 'pendingIllicitArms', INTERRUPT_TYPES.ILLICIT_ARMS, payload); }
export function clearPendingIllicitArms(game) { _clearDual(game, 'pendingIllicitArms', INTERRUPT_TYPES.ILLICIT_ARMS); }

export function setPendingWantonDestruction(game, payload) { _setDual(game, 'pendingWantonDestruction', INTERRUPT_TYPES.WANTON_DESTRUCTION, payload); }
export function clearPendingWantonDestruction(game) { _clearDual(game, 'pendingWantonDestruction', INTERRUPT_TYPES.WANTON_DESTRUCTION); }

export function setPendingTokenDistribution(game, payload) { _setDual(game, 'pendingTokenDistribution', INTERRUPT_TYPES.TOKEN_DISTRIBUTION, payload); }
export function clearPendingTokenDistribution(game) { _clearDual(game, 'pendingTokenDistribution', INTERRUPT_TYPES.TOKEN_DISTRIBUTION); }

export function setPendingIllegalCcPlay(game, payload) { _setDual(game, 'pendingIllegalCcPlay', INTERRUPT_TYPES.ILLEGAL_CC_PLAY, payload); }
export function clearPendingIllegalCcPlay(game) { _clearDual(game, 'pendingIllegalCcPlay', INTERRUPT_TYPES.ILLEGAL_CC_PLAY); }

export function setPendingMassivePush(game, payload) { _setDual(game, 'pendingMassivePush', INTERRUPT_TYPES.MASSIVE_PUSH, payload); }
export function clearPendingMassivePush(game) { _clearDual(game, 'pendingMassivePush', INTERRUPT_TYPES.MASSIVE_PUSH); }

export function setPendingItWillBeAlright(game, payload) { _setDual(game, 'pendingItWillBeAlright', INTERRUPT_TYPES.IT_WILL_BE_ALRIGHT, payload); }
export function clearPendingItWillBeAlright(game) { _clearDual(game, 'pendingItWillBeAlright', INTERRUPT_TYPES.IT_WILL_BE_ALRIGHT); }

export function setPendingHavocShot(game, payload) { _setDual(game, 'pendingHavocShot', INTERRUPT_TYPES.HAVOC_SHOT, payload); }
export function clearPendingHavocShot(game) { _clearDual(game, 'pendingHavocShot', INTERRUPT_TYPES.HAVOC_SHOT); }

export function setPendingGeneralsOrders(game, payload) { _setDual(game, 'pendingGeneralsOrders', INTERRUPT_TYPES.GENERALS_ORDERS, payload); }
export function clearPendingGeneralsOrders(game) { _clearDual(game, 'pendingGeneralsOrders', INTERRUPT_TYPES.GENERALS_ORDERS); }

export function setPendingCoordinatedRaid(game, payload) { _setDual(game, 'pendingCoordinatedRaid', INTERRUPT_TYPES.COORDINATED_RAID, payload); }
export function clearPendingCoordinatedRaid(game) { _clearDual(game, 'pendingCoordinatedRaid', INTERRUPT_TYPES.COORDINATED_RAID); }

export function setPendingExecutiveOrder(game, payload) { _setDual(game, 'pendingExecutiveOrder', INTERRUPT_TYPES.EXECUTIVE_ORDER, payload); }
export function clearPendingExecutiveOrder(game) { _clearDual(game, 'pendingExecutiveOrder', INTERRUPT_TYPES.EXECUTIVE_ORDER); }

export function setPendingFightingKnife(game, payload) { _setDual(game, 'pendingFightingKnife', INTERRUPT_TYPES.FIGHTING_KNIFE, payload); }
export function clearPendingFightingKnife(game) { _clearDual(game, 'pendingFightingKnife', INTERRUPT_TYPES.FIGHTING_KNIFE); }

export function setPendingFieldTactics(game, payload) { _setDual(game, 'pendingFieldTactics', INTERRUPT_TYPES.FIELD_TACTICS, payload); }
export function clearPendingFieldTactics(game) { _clearDual(game, 'pendingFieldTactics', INTERRUPT_TYPES.FIELD_TACTICS); }

export function setPendingThereIsNoTry(game, payload) { _setDual(game, 'pendingThereIsNoTry', INTERRUPT_TYPES.THERE_IS_NO_TRY, payload); }
export function clearPendingThereIsNoTry(game) { _clearDual(game, 'pendingThereIsNoTry', INTERRUPT_TYPES.THERE_IS_NO_TRY); }

export function setPendingSpreadThePain(game, payload) { _setDual(game, 'pendingSpreadThePain', INTERRUPT_TYPES.SPREAD_THE_PAIN, payload); }
export function clearPendingSpreadThePain(game) { _clearDual(game, 'pendingSpreadThePain', INTERRUPT_TYPES.SPREAD_THE_PAIN); }

export function setPendingPunishingStrike(game, payload) { _setDual(game, 'pendingPunishingStrike', INTERRUPT_TYPES.PUNISHING_STRIKE, payload); }
export function clearPendingPunishingStrike(game) { _clearDual(game, 'pendingPunishingStrike', INTERRUPT_TYPES.PUNISHING_STRIKE); }

export function setPendingPowerConverter(game, payload) { _setDual(game, 'pendingPowerConverter', INTERRUPT_TYPES.POWER_CONVERTER, payload); }
export function clearPendingPowerConverter(game) { _clearDual(game, 'pendingPowerConverter', INTERRUPT_TYPES.POWER_CONVERTER); }

export function setPendingDeflect(game, payload) { _setDual(game, 'pendingDeflect', INTERRUPT_TYPES.DEFLECT, payload); }
export function clearPendingDeflect(game) { _clearDual(game, 'pendingDeflect', INTERRUPT_TYPES.DEFLECT); }

export function setPendingConspire(game, payload) { _setDual(game, 'pendingConspire', INTERRUPT_TYPES.CONSPIRE, payload); }
export function clearPendingConspire(game) { _clearDual(game, 'pendingConspire', INTERRUPT_TYPES.CONSPIRE); }

export function setPendingDioFollow(game, payload) { _setDual(game, 'pendingDioFollow', INTERRUPT_TYPES.DIO_FOLLOW, payload); }
export function clearPendingDioFollow(game) { _clearDual(game, 'pendingDioFollow', INTERRUPT_TYPES.DIO_FOLLOW); }

export function setPendingExtraProtection(game, payload) { _setDual(game, 'pendingExtraProtection', INTERRUPT_TYPES.EXTRA_PROTECTION, payload); }
export function clearPendingExtraProtection(game) { _clearDual(game, 'pendingExtraProtection', INTERRUPT_TYPES.EXTRA_PROTECTION); }

export function setPendingDurasteelFistPush(game, payload) { _setDual(game, 'pendingDurasteelFistPush', INTERRUPT_TYPES.DURASTEEL_FIST_PUSH, payload); }
export function clearPendingDurasteelFistPush(game) { _clearDual(game, 'pendingDurasteelFistPush', INTERRUPT_TYPES.DURASTEEL_FIST_PUSH); }

export function setPendingZilloDiscard(game, payload) { _setDual(game, 'pendingZilloDiscard', INTERRUPT_TYPES.ZILLO_DISCARD, payload); }
export function clearPendingZilloDiscard(game) { _clearDual(game, 'pendingZilloDiscard', INTERRUPT_TYPES.ZILLO_DISCARD); }

export function setPendingSurgeOverflow(game, payload) { _setDual(game, 'pendingSurgeOverflow', INTERRUPT_TYPES.SURGE_OVERFLOW, payload); }
export function clearPendingSurgeOverflow(game) { _clearDual(game, 'pendingSurgeOverflow', INTERRUPT_TYPES.SURGE_OVERFLOW); }

export function setPendingWookSlamPush(game, payload) { _setDual(game, 'pendingWookSlamPush', INTERRUPT_TYPES.WOOK_SLAM_PUSH, payload); }
export function clearPendingWookSlamPush(game) { _clearDual(game, 'pendingWookSlamPush', INTERRUPT_TYPES.WOOK_SLAM_PUSH); }

export function setPendingToughLuck(game, payload) { _setDual(game, 'pendingToughLuck', INTERRUPT_TYPES.TOUGH_LUCK, payload); }
export function clearPendingToughLuck(game) { _clearDual(game, 'pendingToughLuck', INTERRUPT_TYPES.TOUGH_LUCK); }

export function setPendingRogueOneTokenPick(game, payload) { _setDual(game, 'pendingRogueOneTokenPick', INTERRUPT_TYPES.ROGUE_ONE_TOKEN_PICK, payload); }
export function clearPendingRogueOneTokenPick(game) { _clearDual(game, 'pendingRogueOneTokenPick', INTERRUPT_TYPES.ROGUE_ONE_TOKEN_PICK); }

export function setPendingReaction(game, payload) { _setDual(game, 'pendingReaction', INTERRUPT_TYPES.REACTION, payload); }
export function clearPendingReaction(game) { _clearDual(game, 'pendingReaction', INTERRUPT_TYPES.REACTION); }

export function setPendingCommDisruptionPrompt(game, payload) { _setDual(game, 'pendingCommDisruptionPrompt', INTERRUPT_TYPES.COMM_DISRUPTION_PROMPT, payload); }
export function clearPendingCommDisruptionPrompt(game) { _clearDual(game, 'pendingCommDisruptionPrompt', INTERRUPT_TYPES.COMM_DISRUPTION_PROMPT); }

export function setPendingIndiscriminateFire(game, payload) { _setDual(game, 'pendingIndiscriminateFire', INTERRUPT_TYPES.INDISCRIMINATE_FIRE, payload); }
export function clearPendingIndiscriminateFire(game) { _clearDual(game, 'pendingIndiscriminateFire', INTERRUPT_TYPES.INDISCRIMINATE_FIRE); }

export function setPendingConcussiveBolt(game, payload) { _setDual(game, 'pendingConcussiveBolt', INTERRUPT_TYPES.CONCUSSIVE_BOLT, payload); }
export function clearPendingConcussiveBolt(game) { _clearDual(game, 'pendingConcussiveBolt', INTERRUPT_TYPES.CONCUSSIVE_BOLT); }

export function setPendingYHSIW(game, payload) { _setDual(game, 'pendingYHSIW', INTERRUPT_TYPES.YHSIW, payload); }
export function clearPendingYHSIW(game) { _clearDual(game, 'pendingYHSIW', INTERRUPT_TYPES.YHSIW); }

export function setPendingTrustedAlly(game, payload) { _setDual(game, 'pendingTrustedAlly', INTERRUPT_TYPES.TRUSTED_ALLY, payload); }
export function clearPendingTrustedAlly(game) { _clearDual(game, 'pendingTrustedAlly', INTERRUPT_TYPES.TRUSTED_ALLY); }

export function setPendingSuppressiveFireMp(game, payload) { _setDual(game, 'pendingSuppressiveFireMp', INTERRUPT_TYPES.SUPPRESSIVE_FIRE_MP, payload); }
export function clearPendingSuppressiveFireMp(game) { _clearDual(game, 'pendingSuppressiveFireMp', INTERRUPT_TYPES.SUPPRESSIVE_FIRE_MP); }

export function setPendingStrikeMeDown(game, payload) { _setDual(game, 'pendingStrikeMeDown', INTERRUPT_TYPES.STRIKE_ME_DOWN, payload); }
export function clearPendingStrikeMeDown(game) { _clearDual(game, 'pendingStrikeMeDown', INTERRUPT_TYPES.STRIKE_ME_DOWN); }

export function setPendingSlowOnTheDraw(game, payload) { _setDual(game, 'pendingSlowOnTheDraw', INTERRUPT_TYPES.SLOW_ON_THE_DRAW, payload); }
export function clearPendingSlowOnTheDraw(game) { _clearDual(game, 'pendingSlowOnTheDraw', INTERRUPT_TYPES.SLOW_ON_THE_DRAW); }

export function setPendingScavengedWeaponryTransfer(game, payload) { _setDual(game, 'pendingScavengedWeaponryTransfer', INTERRUPT_TYPES.SCAVENGED_WEAPONRY_TRANSFER, payload); }
export function clearPendingScavengedWeaponryTransfer(game) { _clearDual(game, 'pendingScavengedWeaponryTransfer', INTERRUPT_TYPES.SCAVENGED_WEAPONRY_TRANSFER); }

export function setPendingRightBackAtYa(game, payload) { _setDual(game, 'pendingRightBackAtYa', INTERRUPT_TYPES.RIGHT_BACK_AT_YA, payload); }
export function clearPendingRightBackAtYa(game) { _clearDual(game, 'pendingRightBackAtYa', INTERRUPT_TYPES.RIGHT_BACK_AT_YA); }

export function setPendingOrbitalBombardment(game, payload) { _setDual(game, 'pendingOrbitalBombardment', INTERRUPT_TYPES.ORBITAL_BOMBARDMENT, payload); }
export function clearPendingOrbitalBombardment(game) { _clearDual(game, 'pendingOrbitalBombardment', INTERRUPT_TYPES.ORBITAL_BOMBARDMENT); }

export function setPendingMotivation(game, payload) { _setDual(game, 'pendingMotivation', INTERRUPT_TYPES.MOTIVATION, payload); }
export function clearPendingMotivation(game) { _clearDual(game, 'pendingMotivation', INTERRUPT_TYPES.MOTIVATION); }

export function setPendingLure(game, payload) { _setDual(game, 'pendingLure', INTERRUPT_TYPES.LURE, payload); }
export function clearPendingLure(game) { _clearDual(game, 'pendingLure', INTERRUPT_TYPES.LURE); }

export function setPendingLoadoutSelection(game, payload) { _setDual(game, 'pendingLoadoutSelection', INTERRUPT_TYPES.LOADOUT_SELECTION, payload); }
export function clearPendingLoadoutSelection(game) { _clearDual(game, 'pendingLoadoutSelection', INTERRUPT_TYPES.LOADOUT_SELECTION); }

export function setPendingLieInAmbush(game, payload) { _setDual(game, 'pendingLieInAmbush', INTERRUPT_TYPES.LIE_IN_AMBUSH, payload); }
export function clearPendingLieInAmbush(game) { _clearDual(game, 'pendingLieInAmbush', INTERRUPT_TYPES.LIE_IN_AMBUSH); }

export function setPendingIKnowEverything(game, payload) { _setDual(game, 'pendingIKnowEverything', INTERRUPT_TYPES.I_KNOW_EVERYTHING, payload); }
export function clearPendingIKnowEverything(game) { _clearDual(game, 'pendingIKnowEverything', INTERRUPT_TYPES.I_KNOW_EVERYTHING); }

export function setPendingForceExhaustion(game, payload) { _setDual(game, 'pendingForceExhaustion', INTERRUPT_TYPES.FORCE_EXHAUSTION, payload); }
export function clearPendingForceExhaustion(game) { _clearDual(game, 'pendingForceExhaustion', INTERRUPT_TYPES.FORCE_EXHAUSTION); }

export function setPendingFigurehead(game, payload) { _setDual(game, 'pendingFigurehead', INTERRUPT_TYPES.FIGUREHEAD, payload); }
export function clearPendingFigurehead(game) { _clearDual(game, 'pendingFigurehead', INTERRUPT_TYPES.FIGUREHEAD); }

export function setPendingEmperorInterrupt(game, payload) { _setDual(game, 'pendingEmperorInterrupt', INTERRUPT_TYPES.EMPEROR_INTERRUPT, payload); }
export function clearPendingEmperorInterrupt(game) { _clearDual(game, 'pendingEmperorInterrupt', INTERRUPT_TYPES.EMPEROR_INTERRUPT); }

export function setPendingChannelTheForceStrain(game, payload) { _setDual(game, 'pendingChannelTheForceStrain', INTERRUPT_TYPES.CHANNEL_THE_FORCE_STRAIN, payload); }
export function clearPendingChannelTheForceStrain(game) { _clearDual(game, 'pendingChannelTheForceStrain', INTERRUPT_TYPES.CHANNEL_THE_FORCE_STRAIN); }

export function setPendingBombardmentSorin(game, payload) { _setDual(game, 'pendingBombardmentSorin', INTERRUPT_TYPES.BOMBARDMENT_SORIN, payload); }
export function clearPendingBombardmentSorin(game) { _clearDual(game, 'pendingBombardmentSorin', INTERRUPT_TYPES.BOMBARDMENT_SORIN); }

export function setPendingBattlefieldLeadership(game, payload) { _setDual(game, 'pendingBattlefieldLeadership', INTERRUPT_TYPES.BATTLEFIELD_LEADERSHIP, payload); }
export function clearPendingBattlefieldLeadership(game) { _clearDual(game, 'pendingBattlefieldLeadership', INTERRUPT_TYPES.BATTLEFIELD_LEADERSHIP); }

export function setPendingAssassinsBlade(game, payload) { _setDual(game, 'pendingAssassinsBlade', INTERRUPT_TYPES.ASSASSINS_BLADE, payload); }
export function clearPendingAssassinsBlade(game) { _clearDual(game, 'pendingAssassinsBlade', INTERRUPT_TYPES.ASSASSINS_BLADE); }

export function setPendingStillFaster(game, payload) { _setDual(game, 'pendingStillFaster', INTERRUPT_TYPES.STILL_FASTER, payload); }
export function clearPendingStillFaster(game) { _clearDual(game, 'pendingStillFaster', INTERRUPT_TYPES.STILL_FASTER); }

export function setPendingSelfDestruct(game, payload) { _setDual(game, 'pendingSelfDestruct', INTERRUPT_TYPES.SELF_DESTRUCT, payload); }
export function clearPendingSelfDestruct(game) { _clearDual(game, 'pendingSelfDestruct', INTERRUPT_TYPES.SELF_DESTRUCT); }

export function setPendingMastery(game, payload) { _setDual(game, 'pendingMastery', INTERRUPT_TYPES.MASTERY, payload); }
export function clearPendingMastery(game) { _clearDual(game, 'pendingMastery', INTERRUPT_TYPES.MASTERY); }

export function setPendingMilitaryEfficiency(game, payload) { _setDual(game, 'pendingMilitaryEfficiency', INTERRUPT_TYPES.MILITARY_EFFICIENCY, payload); }
export function clearPendingMilitaryEfficiency(game) { _clearDual(game, 'pendingMilitaryEfficiency', INTERRUPT_TYPES.MILITARY_EFFICIENCY); }

export function setPendingInterrogate(game, payload) { _setDual(game, 'pendingInterrogate', INTERRUPT_TYPES.INTERROGATE, payload); }
export function clearPendingInterrogate(game) { _clearDual(game, 'pendingInterrogate', INTERRUPT_TYPES.INTERROGATE); }

export function setPendingHunterProtocol(game, payload) { _setDual(game, 'pendingHunterProtocol', INTERRUPT_TYPES.HUNTER_PROTOCOL, payload); }
export function clearPendingHunterProtocol(game) { _clearDual(game, 'pendingHunterProtocol', INTERRUPT_TYPES.HUNTER_PROTOCOL); }

export function setPendingExecutorInterrupt(game, payload) { _setDual(game, 'pendingExecutorInterrupt', INTERRUPT_TYPES.EXECUTOR_INTERRUPT, payload); }
export function clearPendingExecutorInterrupt(game) { _clearDual(game, 'pendingExecutorInterrupt', INTERRUPT_TYPES.EXECUTOR_INTERRUPT); }
/**
 * pendingDefeatPick: player-pick prompt for "when defeated" abilities
 * with player-choose semantics (Into the Force focus target, Useful
 * Hide evade-token recipient, Brutal Tactics weaken target).
 *
 * Payload shape: {
 *   gameId, kind: 'itf'|'uh'|'bt',
 *   choosingPlayerNum: int,             // who clicks the buttons
 *   defeatedFigureKey: string,
 *   options: [{ figureKey, label }],    // eligible targets
 *   remaining?: int,                    // for "distribute N" (Useful Hide)
 *   alreadyPicked?: string[],           // already-chosen figureKeys
 * }
 */
export function setPendingDefeatPick(game, payload) { _setDual(game, 'pendingDefeatPick', INTERRUPT_TYPES.DEFEAT_PICK, payload); }
export function clearPendingDefeatPick(game) { _clearDual(game, 'pendingDefeatPick', INTERRUPT_TYPES.DEFEAT_PICK); }
/**
 * pendingPartingShot: deferred-defeat marker for Parting Shot interrupt.
 * Set by BEFORE_DEFEATED hook when defender has parting_shot ability.
 *
 * Payload shape: {
 *   figureKey, msgId, figIndex,
 *   controllerPlayerNum, attackerPlayerNum,
 *   source,                              // damage source label (e.g. 'Damage', 'Blast')
 *   active: boolean,                     // 'Fire Parting Shot' clicked → next attack completes defeat
 * }
 *
 * Defeat is RESUMED by `completeDeferredDefeat` (handlers/parting-shot.js)
 * which re-calls applyDamage with `_skipBeforeDefeatedHooks: true` so the
 * BEFORE_DEFEATED hook doesn't re-fire on the same defeat event.
 */
export function setPendingPartingShot(game, payload) { _setDual(game, 'pendingPartingShot', INTERRUPT_TYPES.PARTING_SHOT, payload); }
export function clearPendingPartingShot(game) { _clearDual(game, 'pendingPartingShot', INTERRUPT_TYPES.PARTING_SHOT); }

export function setPendingFinalStand(game, payload) { _setDual(game, 'pendingFinalStand', INTERRUPT_TYPES.FINAL_STAND, payload); }
export function clearPendingFinalStand(game) { _clearDual(game, 'pendingFinalStand', INTERRUPT_TYPES.FINAL_STAND); }

export function setPendingDyingLunge(game, payload) { _setDual(game, 'pendingDyingLunge', INTERRUPT_TYPES.DYING_LUNGE, payload); }
export function clearPendingDyingLunge(game) { _clearDual(game, 'pendingDyingLunge', INTERRUPT_TYPES.DYING_LUNGE); }

export function setPendingMiracleWorker(game, payload) { _setDual(game, 'pendingMiracleWorker', INTERRUPT_TYPES.MIRACLE_WORKER, payload); }
export function clearPendingMiracleWorker(game) { _clearDual(game, 'pendingMiracleWorker', INTERRUPT_TYPES.MIRACLE_WORKER); }

export function setPendingPreservationProtocol(game, payload) { _setDual(game, 'pendingPreservationProtocol', INTERRUPT_TYPES.PRESERVATION_PROTOCOL, payload); }
export function clearPendingPreservationProtocol(game) { _clearDual(game, 'pendingPreservationProtocol', INTERRUPT_TYPES.PRESERVATION_PROTOCOL); }

export function setPendingBELReorder(game, payload) { _setDual(game, 'pendingBELReorder', INTERRUPT_TYPES.BEL_REORDER, payload); }
export function clearPendingBELReorder(game) { _clearDual(game, 'pendingBELReorder', INTERRUPT_TYPES.BEL_REORDER); }

export function setPendingUnhingedDirector(game, payload) { _setDual(game, 'pendingUnhingedDirector', INTERRUPT_TYPES.UNHINGED_DIRECTOR, payload); }
export function clearPendingUnhingedDirector(game) { _clearDual(game, 'pendingUnhingedDirector', INTERRUPT_TYPES.UNHINGED_DIRECTOR); }

export function setPendingUnhingedStrain(game, payload) { _setDual(game, 'pendingUnhingedStrain', INTERRUPT_TYPES.UNHINGED_STRAIN, payload); }
export function clearPendingUnhingedStrain(game) { _clearDual(game, 'pendingUnhingedStrain', INTERRUPT_TYPES.UNHINGED_STRAIN); }

/**
 * MISSION_SOR_REVEAL — boolean flag, not a payload. Set/clear toggle.
 * Stack entry has empty payload; legacy field is true/false.
 */
export function setPendingMissionSorReveal(game) {
  if (!game) return;
  game.pendingMissionSorReveal = true;
  if (!Array.isArray(game.interrupts)) game.interrupts = [];
  game.interrupts = game.interrupts.filter((i) => i.type !== INTERRUPT_TYPES.MISSION_SOR_REVEAL);
  pushInterrupt(game, INTERRUPT_TYPES.MISSION_SOR_REVEAL, {}, { blocksSave: false });
}
export function clearPendingMissionSorReveal(game) {
  if (!game) return;
  game.pendingMissionSorReveal = false;
  if (Array.isArray(game.interrupts)) {
    game.interrupts = game.interrupts.filter((i) => i.type !== INTERRUPT_TYPES.MISSION_SOR_REVEAL);
  }
}
