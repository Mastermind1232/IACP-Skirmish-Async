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
