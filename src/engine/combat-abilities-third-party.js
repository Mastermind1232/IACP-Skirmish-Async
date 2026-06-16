// Registration of the third-party-figure Command Cards into their combat-gate
// windows (alexanbv 2026-06-16). Unlike normal CCs (offered against the
// attacker/defender figure by combat-abilities-windows.js), these are offered
// when ANY eligible friendly figure can play them — `applies` is the card in hand
// for the side's player AND eligibleThirdPartyCcFigures() non-empty. params.kind
// 'third_party_cc' so the gate dispatch posts a figure-picker before playing.
// The damage_pipeline ones (Opportunistic) are NOT registered here — they slot
// into the damage pipeline, not a combat gate window.
//
// Imported (side-effect) by combat-mods-gate.js after the other ability files.

import { registerCombatAbility, getCombatAbility } from './combat-timing-registry.js';
import { getCcHand, opponentPlayerNum } from '../game/player-helpers.js';
import { THIRD_PARTY_CC_SPECS, eligibleThirdPartyCcFigures, thirdPartyCardName } from './third-party-ccs.js';

const slug = (s) => String(s).toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');

/** Side's controlling player number for a third-party CC. */
function _sidePlayer(spec, combat) {
  return spec.side === 'attacker'
    ? combat?.attackerPlayerNum
    : (combat?.defenderPlayerNum ?? (combat?.attackerPlayerNum ? opponentPlayerNum(combat.attackerPlayerNum) : null));
}

/** `applies`: the card is in the side player's hand AND ≥1 friendly figure is eligible. */
function thirdPartyCcApplies(specKey) {
  const spec = THIRD_PARTY_CC_SPECS[specKey];
  const card = thirdPartyCardName(specKey);
  return (game, combat, side, deps) => {
    const pn = _sidePlayer(spec, combat);
    if (pn == null) return false;
    if (!(getCcHand(game, pn) || []).includes(card)) return false;
    return eligibleThirdPartyCcFigures(game, specKey, combat, deps).length > 0;
  };
}

let _registered = false;
export function registerThirdPartyCcAbilities() {
  if (_registered) return;
  _registered = true;
  for (const [specKey, spec] of Object.entries(THIRD_PARTY_CC_SPECS)) {
    if (spec.window !== 'on_declare' && spec.window !== 'rerolls') continue; // damage_pipeline handled elsewhere
    const id = `tpcc:${slug(specKey)}:${spec.window}:${spec.side}`;
    if (getCombatAbility(id)) continue;
    registerCombatAbility({
      id,
      name: thirdPartyCardName(specKey),
      windows: [spec.window],
      side: spec.side,
      kind: 'interactive',
      params: { kind: 'third_party_cc', specKey, card: thirdPartyCardName(specKey) },
      applies: thirdPartyCcApplies(specKey),
    });
  }
}

registerThirdPartyCcAbilities();
