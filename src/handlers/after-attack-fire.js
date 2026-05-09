/**
 * Fire handlers for step-8 / after-attack-resolves effects.
 *
 * Each handler implements the actual application logic for one effect
 * type. Called from after-attack-resolve.js when the attacker (or
 * defender) clicks an effect's button in the post-resolve window.
 *
 * Effect types map to handlers via the `fireEffect` dispatcher:
 *   - 'recover'    → fireRecover    (heal attacker by N)
 *   - 'blast'      → fireBlast      (CRR step 8 splash; TODO follow-up)
 *   - 'cleave'     → fireCleave     (target picker; TODO follow-up)
 *   - 'condition'  → fireCondition  (apply 1 condition; TODO follow-up)
 *   - per-DC      → followup commits per ability
 *
 * Slice 2b first cut (this commit): only `recover` is wired live.
 * Other types throw a not-yet-wired error — they continue to fire via
 * the legacy inline-apply path inside applyDamageAndFinishCombat until
 * their follow-up commit migrates them.
 */
import { discordCatch } from '../error-handling.js';
import { healHp } from '../game/damage-helpers.js';
import { grantMovementBank, grantPowerTokens, opponentPlayerNum } from '../game/index.js';
import { applyStrain } from './strain-handler.js';
import { setupPendingMoveX } from './move-x-handler.js';

/**
 * Recover N — heals the attacker by N HP. Applies even on a miss
 * (CRR Recover keyword). Sustained by Rage blocks own Recover; that
 * gate is enforced upstream when the entry is enqueued.
 */
async function fireRecover(thread, game, combat, effect, ctx) {
  const { dcHealthState, logGameAction, client } = ctx;
  if (!dcHealthState || combat.attackerMsgId == null) return;
  const amount = Number(effect.payload?.amount ?? combat.surgeRecover ?? 0);
  if (amount <= 0) return;
  healHp(dcHealthState, game, combat.attackerMsgId, combat.attackerFigureIndex ?? 0, amount, combat.attackerPlayerNum);
  // Clear surgeRecover so it doesn't get re-applied if the inline
  // path runs (e.g. self-play double-fire safety).
  combat.surgeRecover = 0;
  if (logGameAction && thread) {
    await logGameAction(game, client, `\u{1F49A} **Recover ${amount}** — **${combat.attackerDcName}** healed ${amount} HP.`, { phase: 'ROUND', icon: 'attack' }).catch(discordCatch);
  }
}

/**
 * Leg Hydraulics (Tress Hacnua) — attacker after-resolve: "After you
 * resolve an attack, move up to 1 space."
 *
 * Move-X effect: per-effect 1-space budget, no MP banked. Routes
 * through pendingMoveX so the bypass (MOVE-017 + MOVE-020) is scoped
 * to the budget being consumed and discarded when complete or stopped.
 */
async function fireLegHydraulics(thread, game, combat, effect, ctx) {
  if (combat.attackerMsgId == null || !combat.attackerFigureKey) return;
  await setupPendingMoveX(game, ctx, {
    msgId: combat.attackerMsgId,
    figureKey: combat.attackerFigureKey,
    playerNum: combat.attackerPlayerNum,
    spaces: 1,
    source: 'Leg Hydraulics',
    threadId: combat.combatThreadId,
  });
}

/**
 * Stun Batons (Riot Trooper E/R) — attacker after-resolve: target
 * suffers 1 Strain on damage. Routes through the strain pipeline
 * (applyStrain), which handles Fireproof, Headhunter, opponent's
 * strain-prevention CCs, and the underlying damage application —
 * which fires when-damaged hooks + defeat checks correctly.
 * destruct 2026-05-08.
 */
async function fireStunBatons(thread, game, combat, effect, ctx) {
  if (!combat?.target?.figureKey) return;
  const defenderPN = combat.defenderPlayerNum ?? opponentPlayerNum(combat.attackerPlayerNum);
  await applyStrain(game, ctx, {
    figureKey: combat.target.figureKey,
    controllerPlayerNum: defenderPN,
    amount: 1,
    source: 'Stun Batons',
  });
}

/**
 * Stalk Prey (Bossk CC) — attacker after-resolve: +2 MP + 1 Damage
 * Token. Triggered by combat.surgeStalkPrey flag set when the CC
 * was played; this fire handler clears the flag.
 */
async function fireStalkPrey(thread, game, combat, effect, ctx) {
  const { logGameAction, client, ensureMovementBankMessage } = ctx;
  if (!combat.attackerMsgId || !combat.attackerFigureKey) return;
  game.movementBank = game.movementBank || {};
  const bank = game.movementBank[combat.attackerMsgId] || { total: 0, remaining: 0 };
  bank.total = (bank.total ?? 0) + 2;
  bank.remaining = (bank.remaining ?? 0) + 2;
  game.movementBank[combat.attackerMsgId] = bank;
  grantPowerTokens(game, combat.attackerFigureKey, 'Damage', 1);
  delete combat.surgeStalkPrey;
  if (logGameAction && thread) {
    await logGameAction(game, client,
      `**Stalk Prey** — **${combat.attackerDcName}** gained +2 MP and +1 Damage Token`,
      { phase: 'ROUND', icon: 'card' }).catch(discordCatch);
  }
  if (ensureMovementBankMessage) {
    await ensureMovementBankMessage(game, combat.attackerMsgId, client).catch(() => {});
  }
}

/**
 * Slippery (Alliance Smuggler E/R) — defender after-resolve: grant
 * 2 MP to the defender's figure. Inline auto-apply removed; the
 * defender clicks a button in their post-resolve window to fire it.
 */
async function fireSlippery(thread, game, combat, effect, ctx) {
  const { logGameAction, client } = ctx;
  const msgId = effect.payload?.msgId;
  if (!msgId) return;
  grantMovementBank(game, msgId, 2);
  if (logGameAction && thread) {
    await logGameAction(game, client,
      `\u{1F3C3} **Slippery** — **${effect.payload?.defenderDcName || combat.target?.label}** gains 2 MP after being attacked.`,
      { phase: 'ROUND', icon: 'attack' }).catch(discordCatch);
  }
}

/**
 * Effect dispatcher. Adds an entry here as each effect type's fire
 * handler lands.
 */
export async function fireEffect(thread, game, combat, effect, ctx) {
  switch (effect.type) {
    case 'recover':
      await fireRecover(thread, game, combat, effect, ctx);
      return;
    case 'slippery':
      await fireSlippery(thread, game, combat, effect, ctx);
      return;
    case 'leg_hydraulics':
      await fireLegHydraulics(thread, game, combat, effect, ctx);
      return;
    case 'stalk_prey':
      await fireStalkPrey(thread, game, combat, effect, ctx);
      return;
    case 'stun_batons':
      await fireStunBatons(thread, game, combat, effect, ctx);
      return;
    // 'blast', 'cleave', 'condition', and per-DC types land in
    // follow-up commits. For now they fall through; the inline
    // applicator in combat-bridge.js still handles them.
    default:
      // Unknown / not-yet-wired type — log and drop. The effect was
      // already consumed from the queue by the caller.
      console.warn(`[after-attack-fire] effect type "${effect.type}" not yet wired; skipping`);
      return;
  }
}
