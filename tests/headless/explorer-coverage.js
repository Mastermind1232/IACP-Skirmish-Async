/**
 * Explorer Coverage: transition identity, in-memory coverage map, DB persistence.
 *
 * The flow harness stays pure — all DB and coverage logic lives here.
 * Transition key = roundPhase | frozenPendingSet | actionType
 */

import {
  PENDING_STATE_KEYS, snapshotPendingStates,
  computeTransitionKey, parseTransitionKey,
} from '../../src/exploration/transition-key.js';
import {
  upsertExplorationTransition,
  insertExplorationEpisode,
  loadExplorationTransitions,
} from '../../src/db.js';

// Re-export transition key utilities so explorer.js and explorer-policy.js
// can continue importing from this file.
export { computeTransitionKey, parseTransitionKey };

// ── Context Tags (best-effort enrichment) ───────────────────────────────────

/**
 * Build best-effort context tags for a transition.
 * @param {object} game - Current game state
 * @param {object} action - The action being taken
 * @returns {object} context tags
 */
export function buildContextTags(game, action) {
  const tags = {};

  // CC name if this is a CC play action
  if (action.type === 'play_cc' && action.cardName) {
    tags.cc_name = action.cardName;
  }

  // Combat sub-phase
  if (game.pendingCombat) {
    const c = game.pendingCombat;
    if (!c.attackRoll) tags.combat_sub_phase = 'pre-roll';
    else if (!c.defenseRoll) tags.combat_sub_phase = 'roll';
    else if (c.rerollPhase) tags.combat_sub_phase = 'reroll';
    else if (c.surgeRemaining > 0) tags.combat_sub_phase = 'surge';
    else tags.combat_sub_phase = 'resolve';
  }

  return tags;
}

// ── Coverage Map ────────────────────────────────────────────────────────────

/**
 * In-memory coverage bookkeeping. Tracks transition keys, counts, and tags.
 * Can be persisted to and loaded from Postgres.
 */
export class CoverageMap {
  constructor() {
    /** @type {Map<string, { batch_count: number, db_count: number, invariant_fails: number, surface_fails: number, context_tags: object, scenarios: Set<string> }>} */
    this._map = new Map();
    /** @type {Set<string>} Keys seen before this batch (from DB load) */
    this._preExisting = new Set();
    /** @type {Set<string>} Keys first discovered in this batch (for accurate batch novelty) */
    this._batchNovel = new Set();
  }

  /**
   * Record a transition hit.
   * @param {string} key - transition key
   * @param {object} [tags] - context tags
   * @param {{ scenarioId?: string, invariantFail?: boolean, surfaceFail?: boolean }} [opts]
   */
  recordTransition(key, tags = {}, opts = {}) {
    let entry = this._map.get(key);
    if (!entry) {
      entry = { batch_count: 0, db_count: 0, invariant_fails: 0, surface_fails: 0, context_tags: {}, scenarios: new Set() };
      this._map.set(key, entry);
    }
    entry.batch_count++;
    if (opts.invariantFail) entry.invariant_fails++;
    if (opts.surfaceFail) entry.surface_fails++;
    if (opts.scenarioId) entry.scenarios.add(opts.scenarioId);
    // Track batch-level novelty (first time seen in this batch AND not pre-existing)
    if (!this._preExisting.has(key)) {
      this._batchNovel.add(key);
    }
    // Merge tags (last write wins per field)
    Object.assign(entry.context_tags, tags);
  }

  /**
   * Check if a transition is novel (not seen before this batch).
   * @param {string} key
   * @returns {boolean}
   */
  isNovel(key) {
    return !this._preExisting.has(key);
  }

  /**
   * Get the true unique novel count for this batch.
   * @returns {number}
   */
  getBatchNovelCount() {
    return this._batchNovel.size;
  }

  /**
   * Get summary statistics.
   * @returns {{ total: number, novel: number, withFailures: number, withSurfaceFailures: number, byActionType: object }}
   */
  getSummary() {
    let novel = 0;
    let withFailures = 0;
    let withSurfaceFailures = 0;
    const byActionType = {};

    for (const [key, entry] of this._map) {
      if (this.isNovel(key)) novel++;
      if (entry.invariant_fails > 0) withFailures++;
      if (entry.surface_fails > 0) withSurfaceFailures++;

      const { actionType } = parseTransitionKey(key);
      byActionType[actionType] = (byActionType[actionType] || 0) + entry.batch_count;
    }

    return {
      total: this._map.size,
      novel,
      withFailures,
      withSurfaceFailures,
      byActionType,
    };
  }

  /**
   * Persist all in-memory transitions to DB via upsert.
   * Only persists batch_count (new hits this batch), not db_count.
   */
  async persistToDb() {
    for (const [key, entry] of this._map) {
      if (entry.batch_count === 0) continue; // Skip DB-only entries with no new hits
      const { roundPhase, pendingSet, actionType } = parseTransitionKey(key);
      await upsertExplorationTransition({
        transition_key: key,
        round_phase: roundPhase,
        pending_set: pendingSet,
        action_type: actionType,
        headless_count: entry.batch_count,
        invariant_fails: entry.invariant_fails,
        context_tags: entry.context_tags,
        scenarios_reaching: [...entry.scenarios],
      });
    }
  }

  /**
   * Populate pre-existing set and DB counts from DB (call before running episodes).
   */
  async loadFromDb() {
    const dbMap = await loadExplorationTransitions();
    for (const [key, row] of dbMap) {
      this._preExisting.add(key);
      if (!this._map.has(key)) {
        this._map.set(key, {
          batch_count: 0,
          db_count: row.headless_count || 0,
          invariant_fails: 0,
          surface_fails: 0,
          context_tags: row.context_tags || {},
          scenarios: new Set(row.scenarios_reaching || []),
        });
      }
    }
  }

  /**
   * Get the true accumulated count for a key (DB history + current batch).
   * Used by explorer-policy for coverage-driven action selection.
   * @param {string} key
   * @returns {number}
   */
  getCount(key) {
    const entry = this._map.get(key);
    if (!entry) return 0;
    return entry.db_count + entry.batch_count;
  }
}

/**
 * Record an episode to DB.
 * @param {object} episode
 */
export async function recordEpisode(episode) {
  await insertExplorationEpisode(episode);
}
