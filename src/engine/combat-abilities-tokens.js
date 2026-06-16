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

const ALLOWED = { attacker: ['Damage', 'Surge'], defender: ['Block', 'Evade'] };

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
      applies: (game, combat) => eligibleTokenTypes(game, combat, side).length > 0,
    });
  }
}

registerTokenAbilities();
