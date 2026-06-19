// Power-token spending as an on_declare gate option (alexanbv 2026-06-16: "tokens
// are spent interspersed with other on-declare abilities for their respective
// player. They are just another button among the on-declare options. THERE IS NO
// SEPARATE TOKEN WINDOW.").
//
// One interactive ability per side, offered in the on_declare window when the
// figure has an eligible power token (attacker: Damage/Surge; defender:
// Block/Evade). params.kind 'token' so the gate dispatch (_makeTokenResolver in
// combat.js) opens a token-type sub-choice and applies the spend in-place, then
// re-drives the gate so the player can spend another or pass. Side-effect import.

import { registerCombatAbility } from './combat-timing-registry.js';
import { getDcEffects } from '../data-loader.js';
import { dcNameFromFigureKey } from '../game/index.js';

const ALLOWED = { attacker: ['Damage', 'Surge'], defender: ['Block', 'Evade'] };

/**
 * Vague and Unconvincing (K-2SO) — DENIAL/lock-out: "While defending, your player
 * and your opponent cannot spend power tokens or play Command cards." Returns true
 * when there is a pending combat whose DEFENDER carries vague_and_unconvincing_k2s0
 * — i.e. BOTH players are locked out of token-spend + CC-play for the duration of
 * that attack. Derived (no stored flag) so it covers every window of the attack
 * (on_declare token spend through mods), and self-clears when the combat ends.
 * Consulted by the token-spend ability gate here and by isCcPlayableNow.
 */
export function vagueAndUnconvincingLockoutActive(game) {
  const combat = game?.pendingCombat;
  const defFk = combat?.target?.figureKey;
  if (!defFk) return false;
  const defName = combat.defenderDcName || dcNameFromFigureKey(defFk);
  const all = getDcEffects() || {};
  const e = all[defName] || all[String(defName || '').replace(/\s*\[.*\]\s*$/, '')];
  return (e?.specialAbilityIds || []).includes('vague_and_unconvincing_k2s0');
}

/** The figure whose tokens this side spends (attacker = attacking figure; defender = target). */
export function tokenSpenderFigureKey(combat, side) {
  return side === 'attacker' ? combat?.attackerFigureKey : combat?.target?.figureKey;
}

/** Eligible (spendable) token types this figure currently holds, for the side. */
export function eligibleTokenTypes(game, combat, side) {
  const fk = tokenSpenderFigureKey(combat, side);
  if (!fk) return [];
  const held = game?.figurePowerTokens?.[fk] || [];
  return ALLOWED[side].filter((t) => held.includes(t));
}

let _registered = false;
export function registerTokenAbilities() {
  if (_registered) return;
  _registered = true;
  for (const side of ['attacker', 'defender']) {
    registerCombatAbility({
      id: `spend_token:${side}`,
      name: 'Spend a Power Token',
      windows: ['on_declare'],
      side,
      kind: 'interactive',
      params: { kind: 'token', side },
      applies: (game, combat, _side, deps) => {
        // Vague and Unconvincing (K-2SO defending): NEITHER player may spend power
        // tokens during this attack — suppress the token-spend button for both sides.
        if (vagueAndUnconvincingLockoutActive(game)) return false;
        if (eligibleTokenTypes(game, combat, side).length > 0) return true;
        // Squad Cohesion donor-only case: the figure holds no spendable token of
        // its own, but a friendly within 3 (via Ko-Tun) has one (alexanbv 2026-06-16).
        // Squad Cohesion (Ko-Tun) is ATTACKER-only — the defender has no donor path.
        if (side !== 'attacker') return false;
        const allowed = ALLOWED[side];
        const sc = deps?.getSquadCohesionTokens?.(game, combat, side);
        return !!sc?.cohesionTokens?.some((t) => allowed.includes(t.type));
      },
    });
  }
}

registerTokenAbilities();
