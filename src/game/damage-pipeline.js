/**
 * Centralized damage pipeline (destruct 2026-05-08).
 *
 * Every HP reduction in the codebase routes through `applyDamage` so
 * the same sequence of hooks fires regardless of the damage source —
 * main-target attack damage (step 7), Blast splash, Cleave, NPC
 * direct damage, and the damage branch of strain (when opponent
 * picks damage instead of discarding cards).
 *
 * Sequence:
 *   1. WHEN_DAMAGED hooks — fire BEFORE damage applies. Each may
 *      modify the amount (e.g. Sustained by Rage halves) or schedule
 *      side-effects (e.g. Fury of Kashyyyk grants Focus when ≥3 dmg).
 *      Hooks return the (possibly modified) amount.
 *   2. would-be-defeated check — compute newHp = max(0, currentHp − amount).
 *   3. BEFORE_DEFEATED hooks — fire ONLY if would-be-newHp === 0 AND
 *      figure is alive. May prevent defeat by setting result.preventDefeat
 *      or modifying amount. Examples: Final Stand, Dying Lunge,
 *      Second Chance, You Will Not Deny Me. Returns the resolved
 *      effect; caller may pause for player choice via pendingX flags.
 *   4. damage application — reduceHp(...) runs only if not prevented.
 *   5. WHEN_DEFEATED hooks — fire AFTER reduceHp confirms defeat.
 *      Examples: Heroic Effort, Apex Predator, Hunt Dissent,
 *      Celebration prompt, Debts Repaid (CC).
 *
 * Registries are exported so the slice-2b migration commits can
 * gradually move existing inline checks (Furious Charge,
 * Self-Preservation, Sustained by Rage, etc.) into the appropriate
 * category. The pipeline is correct from day-one even with empty
 * registries — it just delegates to reduceHp + processFigureDefeat
 * exactly as the call sites already do.
 *
 * Strain pipeline integration: applyStrain calls into applyDamage
 * with `viaStrain: true` for the damage branch (when opponent picks
 * damage). Some hooks may consult viaStrain to avoid double-firing
 * (e.g. Sustained by Rage modifies attack damage but not strain
 * damage — TBD per ability).
 */

import { reduceHp } from './damage-helpers.js';

/**
 * @typedef {Object} DamageOpts
 * @property {string} figureKey
 * @property {string} msgId
 * @property {number} figIndex
 * @property {number} amount             - HP to remove (≥0; 0 short-circuits)
 * @property {number} controllerPlayerNum - the figure's owning player
 * @property {string} [source='Damage']  - free-form label for logs
 * @property {number} [attackerPlayerNum]
 * @property {string} [attackerFigureKey]
 * @property {boolean} [viaStrain=false] - true when called from strain pipeline's damage branch
 * @property {Object} [combat]            - active combat object, if applicable
 */

/**
 * @typedef {Object} DamageResult
 * @property {number} amount       - final amount applied (after when-damaged hooks)
 * @property {number} prevHp
 * @property {number} newHp
 * @property {boolean} wasDefeated
 * @property {boolean} preventDefeat - true if a before-defeated hook prevented defeat
 */

/**
 * WHEN_DAMAGED registry. Each entry:
 *   { id: string,
 *     probe: (game, opts) => boolean,
 *     apply: async (game, opts, ctx) => { amount?: number, sideEffects?: ... } }
 *
 * `apply` returns an object whose `amount` (if defined) overrides the
 * pipeline's running amount. Side-effects (logs, condition application,
 * etc.) are the apply's responsibility.
 *
 * Empty for now; populated as inline checks migrate from combat-bridge.js.
 */
export const WHEN_DAMAGED_HOOKS = [];

/**
 * BEFORE_DEFEATED registry — fires when would-be-newHp === 0 AND
 * figure currently alive. Each entry:
 *   { id: string,
 *     probe: (game, opts) => boolean,
 *     apply: async (game, opts, ctx) =>
 *       { preventDefeat?: boolean, amount?: number, pendingPrompt?: any } }
 *
 * Some entries (Final Stand, Second Chance) may set pendingPrompt to
 * pause the pipeline for player choice — caller handles re-entry via
 * combat-bridge's existing pendingX patterns.
 */
export const BEFORE_DEFEATED_HOOKS = [];

/**
 * WHEN_DEFEATED registry — fires after reduceHp confirms defeat. Each
 * entry: { id, probe, apply }. apply is fire-and-forget (return value
 * ignored). Side-effects only — VP awards, prompt posts, etc.
 *
 * processFigureDefeat is invoked by the pipeline after these hooks
 * complete (or stays as the orchestrator if it's already capturing
 * everything — TBD as migrations land).
 */
export const WHEN_DEFEATED_HOOKS = [];

/**
 * Run the centralized damage pipeline for one figure.
 *
 * Day-one shape: with empty registries, this reduces to reduceHp() +
 * a defeat boolean. Migrations populate the registries; existing
 * inline checks at call sites get removed as they land.
 *
 * @param {object} game
 * @param {object} ctx          - dcHealthState, logGameAction, client, processFigureDefeat, ...
 * @param {DamageOpts} opts
 * @returns {Promise<DamageResult>}
 */
export async function applyDamage(game, ctx, opts) {
  if (!opts || !opts.figureKey || !opts.msgId) {
    throw new Error('applyDamage: figureKey + msgId required');
  }
  let amount = Math.max(0, parseInt(opts.amount || 0, 10));
  if (amount === 0) {
    return { amount: 0, prevHp: 0, newHp: 0, wasDefeated: false, preventDefeat: false };
  }

  // 1. WHEN_DAMAGED hooks — may modify amount.
  for (const hook of WHEN_DAMAGED_HOOKS) {
    if (!hook.probe || !hook.apply) continue;
    if (!hook.probe(game, { ...opts, amount })) continue;
    const out = await hook.apply(game, { ...opts, amount }, ctx);
    if (out && typeof out.amount === 'number') amount = Math.max(0, out.amount);
    if (amount === 0) {
      return { amount: 0, prevHp: 0, newHp: 0, wasDefeated: false, preventDefeat: false };
    }
  }

  // 2. would-be-defeated probe (HP read before reduceHp mutates).
  const dcHealth = ctx?.dcHealthState?.get?.(opts.msgId) || [];
  const figEntry = dcHealth[opts.figIndex] || [0, 0];
  const prevHp = figEntry[0] || 0;
  const wouldBeDefeated = prevHp > 0 && (prevHp - amount) <= 0;

  // 3. BEFORE_DEFEATED hooks — may prevent defeat or modify amount.
  let preventDefeat = false;
  if (wouldBeDefeated) {
    for (const hook of BEFORE_DEFEATED_HOOKS) {
      if (!hook.probe || !hook.apply) continue;
      if (!hook.probe(game, { ...opts, amount, prevHp })) continue;
      const out = await hook.apply(game, { ...opts, amount, prevHp }, ctx);
      if (out?.preventDefeat) preventDefeat = true;
      if (out && typeof out.amount === 'number') amount = Math.max(0, out.amount);
    }
  }

  if (preventDefeat || amount === 0) {
    // Defeat prevented (e.g. Second Chance set HP to 1); skip reduceHp.
    return {
      amount,
      prevHp,
      newHp: ctx?.dcHealthState?.get?.(opts.msgId)?.[opts.figIndex]?.[0] ?? prevHp,
      wasDefeated: false,
      preventDefeat: true,
    };
  }

  // 4. damage application.
  const result = reduceHp(
    ctx.dcHealthState, game, opts.msgId, opts.figIndex, amount, opts.controllerPlayerNum,
  );

  // 5. WHEN_DEFEATED hooks (only if defeated).
  if (result.wasDefeated) {
    for (const hook of WHEN_DEFEATED_HOOKS) {
      if (!hook.probe || !hook.apply) continue;
      if (!hook.probe(game, { ...opts, amount, prevHp: result.prevHp })) continue;
      try {
        await hook.apply(game, { ...opts, amount, prevHp: result.prevHp }, ctx);
      } catch (err) {
        // Hooks must not throw the pipeline; log and continue.
        console.error(`[damage-pipeline] WHEN_DEFEATED hook ${hook.id} threw:`, err?.message ?? err);
      }
    }
  }

  return {
    amount,
    prevHp: result.prevHp,
    newHp: result.newHp,
    wasDefeated: !!result.wasDefeated,
    preventDefeat: false,
  };
}

/**
 * Test-helper: clear all registries. Used by unit tests to isolate
 * pipeline behavior from migration drift.
 */
export function _clearRegistries() {
  WHEN_DAMAGED_HOOKS.length = 0;
  BEFORE_DEFEATED_HOOKS.length = 0;
  WHEN_DEFEATED_HOOKS.length = 0;
}
