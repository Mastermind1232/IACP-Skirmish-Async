/**
 * Damage pipeline hook registrations.
 *
 * Each hook is a small object pushed onto one of three registries:
 *   - WHEN_DAMAGED_HOOKS  (after damage applies, figure alive)
 *   - BEFORE_DEFEATED_HOOKS (would-be HP=0, before reduceHp)
 *   - WHEN_DEFEATED_HOOKS  (after defeat confirmed)
 *
 * Hooks fire from EVERY call site that reduces HP — main attack
 * damage, Blast/Cleave splash, NPC direct, strain → damage,
 * crate explosion, Bleeding, Stun Batons, etc.
 *
 * To register a new ability:
 *   1. Decide which registry (when-damaged / before-defeated / when-defeated).
 *   2. Write a `probe(game, opts)` returning true when this ability
 *      should fire for the current damage event.
 *   3. Write an `apply(game, opts, ctx)` that performs the side-effect
 *      (and optionally returns `{ amount, preventDefeat }` to influence
 *      the pipeline).
 *   4. Tag with `sync: true` if the apply is synchronous AND should
 *      fire from sync call sites (resolveAbility's tempt, etc.).
 *
 * Many existing inline checks in combat-bridge.js can be moved here
 * incrementally; each migration removes one inline if-block and
 * pushes one registry entry.
 *
 * THIS COMMIT: registers Fury of Kashyyyk + Self-Preservation as the
 * proof-of-pattern. Remaining audited abilities (Sustained by Rage,
 * YWNDM, Bounty, Apex Predator, Hunt Dissent, Forward Vengeance,
 * Vengeance, Executor, Brutal Tactics, Nefarious Gains, Heroic
 * Effort, Into the Force, Last Stand, Useful Hide, Parting Shot,
 * Self-Destruct Protocol, Devastator) land in follow-up commits.
 */
import {
  WHEN_DAMAGED_HOOKS,
  BEFORE_DEFEATED_HOOKS, // eslint-disable-line no-unused-vars -- registered in follow-up commits
  WHEN_DEFEATED_HOOKS,   // eslint-disable-line no-unused-vars -- registered in follow-up commits
} from './damage-pipeline.js';
import { getDcList } from './player-helpers.js';
import { dcNameFromFigureKey } from './dc-helpers.js';
import { getDcEffects, getDcKeywords } from '../data-loader.js';
import { applyCondition } from './conditions.js';

// ── WHEN_DAMAGED ────────────────────────────────────────────────────────────

/**
 * Fury of Kashyyyk (army-wide CC attachment): when a friendly WOOKIEE
 * suffers ≥3 damage, that WOOKIEE becomes Focused. Fires after damage
 * applies, only if the figure survived (otherwise defeat supersedes).
 *
 * destruct 2026-05-08: this is a generic when-damaged trigger, not
 * specific to Blast/Cleave. Pulled from combat-bridge.js inline path
 * (still inline there for now; remove in cleanup pass once verified).
 */
WHEN_DAMAGED_HOOKS.push({
  id: 'fury_of_kashyyyk',
  sync: true,
  probe: (game, opts) => {
    if ((opts.amount || 0) < 3) return false;
    if (!opts.figureKey) return false;
    // Player owning the figure must have [Fury of Kashyyyk] attachment in army.
    const dcList = getDcList(game, opts.controllerPlayerNum) || [];
    if (!dcList.some(dc => dc.dcName === '[Fury of Kashyyyk]')) return false;
    // Figure itself must be a WOOKIEE.
    const dcName = dcNameFromFigureKey(opts.figureKey);
    const kws = (getDcKeywords(game)?.[dcName] || []).map(k => String(k).toUpperCase());
    return kws.includes('WOOKIEE');
  },
  apply: (game, opts, _ctx) => {
    if (!opts.figureKey) return;
    applyCondition(game, opts.figureKey, 'Focus');
    // Note: log message is emitted by the inline path in combat-bridge.js
    // until that inline check is removed in the cleanup pass.
  },
});

/**
 * Self-Preservation (Hired Gun Elite): when this figure suffers
 * Damage, become Focused. Fires after damage applies, only if the
 * figure survived. Auto-applied; no player choice.
 */
WHEN_DAMAGED_HOOKS.push({
  id: 'self_preservation_hired_gun_elite',
  sync: true,
  probe: (game, opts) => {
    if (!opts.figureKey) return false;
    if ((opts.amount || 0) <= 0) return false;
    const dcName = dcNameFromFigureKey(opts.figureKey);
    const eff = getDcEffects()?.[dcName] || getDcEffects()?.[dcName?.replace(/\s*\[.*\]\s*$/, '')];
    return (eff?.specialAbilityIds || []).includes('self_preservation_hired_gun_elite');
  },
  apply: (game, opts, _ctx) => {
    if (!opts.figureKey) return;
    applyCondition(game, opts.figureKey, 'Focus');
  },
});
