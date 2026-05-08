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
  WHEN_DEFEATED_HOOKS,
} from './damage-pipeline.js';
import { getDcList, opponentPlayerNum, vpKey } from './player-helpers.js';
import { dcNameFromFigureKey } from './dc-helpers.js';
import { getDcEffects, getDcKeywords } from '../data-loader.js';
import { applyCondition } from './conditions.js';
import { awardObjectiveVp } from './vp-helpers.js';

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

// ── WHEN_DEFEATED ──────────────────────────────────────────────────────────

/**
 * Bounty (Fennec Shand passive): when this figure is defeated, the
 * opponent gains 2 VP. Source-agnostic: triggers from attack, Bleed,
 * Blast splash, etc. Inline path in combat-bridge.js was removed in
 * the same commit to prevent double-award.
 */
WHEN_DEFEATED_HOOKS.push({
  id: 'bounty',
  sync: true,
  probe: (game, opts) => {
    if (!opts.figureKey) return false;
    const dcName = dcNameFromFigureKey(opts.figureKey);
    const eff = getDcEffects()?.[dcName];
    return (eff?.passives || []).includes('Bounty');
  },
  apply: (game, opts, ctx) => {
    if (!opts.figureKey) return;
    const oppPn = opts.attackerPlayerNum
      ?? (opts.controllerPlayerNum ? opponentPlayerNum(opts.controllerPlayerNum) : null);
    if (!oppPn) return;
    awardObjectiveVp(game, oppPn, 2);
    const total = game[vpKey(oppPn)]?.total ?? '?';
    const dcName = dcNameFromFigureKey(opts.figureKey);
    if (typeof ctx?.logGameAction === 'function' && ctx?.client) {
      ctx.logGameAction(
        game,
        ctx.client,
        `\u{1F4B0} **Bounty** — **${dcName}** was defeated. Opponent (P${oppPn}) gains **2 VP** (${total} total).`,
        { phase: 'ROUND', icon: 'card' },
      ).catch(() => {});
    }
  },
});

/**
 * Last Stand (Stormtrooper Elite passive): when this figure is
 * defeated, another figure in the same group becomes Focused.
 * Idempotent (`applyCondition` returns false if already present), so
 * inline path in combat-bridge.js is left alone for now — hook fires
 * orthogonally on non-combat defeats (Bleed, Blast splash, etc.).
 */
WHEN_DEFEATED_HOOKS.push({
  id: 'last_stand',
  sync: true,
  probe: (game, opts) => {
    if (!opts.figureKey) return false;
    const dcName = dcNameFromFigureKey(opts.figureKey);
    const eff = getDcEffects()?.[dcName];
    return (eff?.passives || []).includes('Last Stand');
  },
  apply: (game, opts, ctx) => {
    if (!opts.figureKey || !opts.controllerPlayerNum) return;
    const dcName = dcNameFromFigureKey(opts.figureKey);
    const dgMatch = (opts.figureKey || '').match(/-(\d+)-\d+$/);
    const dgIdx = dgMatch ? dgMatch[1] : '1';
    const prefix = `${dcName}-${dgIdx}-`;
    const alive = Object.keys(game.figurePositions?.[opts.controllerPlayerNum] || {})
      .filter(k => k.startsWith(prefix) && k !== opts.figureKey);
    if (alive.length === 0) return;
    const target = alive[0];
    if (applyCondition(game, target, 'Focus')) {
      const targetName = dcNameFromFigureKey(target);
      if (typeof ctx?.logGameAction === 'function' && ctx?.client) {
        ctx.logGameAction(
          game,
          ctx.client,
          `⚡ **Last Stand** — **${targetName}** becomes **Focused** (another figure in the group was defeated).`,
          { phase: 'ROUND', icon: 'card' },
        ).catch(() => {});
      }
    }
  },
});

/**
 * Into the Force (Obi-Wan Kenobi): when defeated, choose another
 * friendly figure — that figure becomes Focused. Auto-picks the
 * first surviving friendly today; player-pick UI is a future
 * enhancement (CC-style picker prompt).
 */
WHEN_DEFEATED_HOOKS.push({
  id: 'into_the_force_obiwan',
  sync: true,
  probe: (game, opts) => {
    if (!opts.figureKey) return false;
    const dcName = dcNameFromFigureKey(opts.figureKey);
    if (dcName !== 'Obi-Wan Kenobi') return false;
    const eff = getDcEffects()?.[dcName];
    return (eff?.specialAbilityIds || []).includes('into_the_force_obiwan');
  },
  apply: (game, opts, ctx) => {
    if (!opts.controllerPlayerNum) return;
    const alive = Object.keys(game.figurePositions?.[opts.controllerPlayerNum] || {})
      .filter(k => !k.startsWith('Obi-Wan Kenobi-'));
    if (alive.length === 0) return;
    const target = alive[0];
    if (applyCondition(game, target, 'Focus')) {
      const targetName = dcNameFromFigureKey(target);
      if (typeof ctx?.logGameAction === 'function' && ctx?.client) {
        ctx.logGameAction(
          game,
          ctx.client,
          `✨ **Into the Force** — **${targetName}** becomes **Focused** (Obi-Wan was defeated).`,
          { phase: 'ROUND', icon: 'card' },
        ).catch(() => {});
      }
    }
  },
});
