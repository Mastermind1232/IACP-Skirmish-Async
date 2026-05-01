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

  // Post-deploy abilities
  POST_DEPLOY_QUEUE:     'post-deploy-queue',

  // Round effects
  BLEEDING:              'bleeding',
  ROUND_EFFECT_RESOLVING: 'round-effect-resolving',

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
