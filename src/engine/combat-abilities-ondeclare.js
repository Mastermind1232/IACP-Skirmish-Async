// On-declare-window combat abilities — slice C wiring (alexanbv 2026-06-14).
//
// Registers the INTERACTIVE on-declare DC abilities as executable gate entries
// (the on-declare window already lets players play CCs/tokens in any order via
// sendOnDeclareYn; this adds the DC abilities so they too can be resolved in
// the player's chosen order rather than firing inline in fixed source order).
//
// Passive on-declare effects (Focus, Aim, Cunning, attachments, …) keep
// auto-firing inline and stay timing-only in the catalog — they need no
// player decision. Command cards are played from hand (onCcPlayed), not gate
// buttons. So only the interactive DC abilities are registered executable here.
//
// applies = baseline "this side's figure has the ability". Finer preconditions
// (range/keyword gates) are applied at resolution time, as the inline handlers
// already do; the gate just needs to know the ability is available to offer.
// Imported after the catalog so these executable entries supersede the
// catalog's timing-only placeholders for the same ids.

import { getDcEffects as _getDcEffects } from '../data-loader.js';
import { dcNameFromFigureKey } from '../game/index.js';
import { registerCombatAbility } from './combat-timing-registry.js';

function atkEff(combat, deps) {
  const all = (deps?.getDcEffects || _getDcEffects)() || {};
  const n = combat.attackerDcName || dcNameFromFigureKey(combat.attackerFigureKey || '');
  return all[n] || all[(n || '').replace(/\s*\[.*\]\s*$/, '')] || null;
}
function defEff(combat, deps) {
  const all = (deps?.getDcEffects || _getDcEffects)() || {};
  const n = dcNameFromFigureKey(combat.target?.figureKey || '');
  return all[n] || all[(n || '').replace(/\s*\[.*\]\s*$/, '')] || null;
}
const hasAny = (eff, ...keys) => {
  const ids = [...(eff?.specialAbilityIds || []), ...(eff?.passives || [])].map((s) => String(s).toLowerCase());
  return keys.some((k) => ids.includes(String(k).toLowerCase()));
};

function atkAbility(id, name, keys, notResolvedFlag) {
  registerCombatAbility({
    id, name, side: 'attacker', kind: 'interactive', windows: ['on_declare'],
    applies: (game, combat, side, deps) => !!combat.attackerFigureKey && !(notResolvedFlag && combat[notResolvedFlag]) && hasAny(atkEff(combat, deps), ...keys),
  });
}
function defAbility(id, name, keys, notResolvedFlag) {
  registerCombatAbility({
    id, name, side: 'defender', kind: 'interactive', windows: ['on_declare'],
    applies: (game, combat, side, deps) => !!combat.target?.figureKey && !(notResolvedFlag && combat[notResolvedFlag]) && hasAny(defEff(combat, deps), ...keys),
  });
}

// ── Attacker interactive on-declare DC abilities ─────────────────────────────
atkAbility('merciless', 'Merciless', ['merciless'], 'mercilessResolved');
atkAbility('flawless_execution', 'Flawless Execution', ['flawless_execution'], 'flawlessResolved');
atkAbility('vanguard', 'Vanguard', ['vanguard'], 'vanguardResolved');
atkAbility('ee3_carbine', 'EE-3 Carbine', ['ee3_carbine'], 'ee3Resolved');
atkAbility('front_line', 'Front Line', ['front_line'], 'frontLineResolved');
atkAbility('much_to_learn', 'Much to Learn', ['much_to_learn'], 'muchToLearnResolved');

// ── Defender interactive on-declare DC abilities ─────────────────────────────
defAbility('the_force_is_with_me', 'The Force is With Me', ['the_force_is_with_me_chirrut'], 'forceIsWithMeResolved');
defAbility('strike_me_down', 'Strike Me Down', ['strike_me_down_obiwan'], 'strikeMeDownResolved');
defAbility('force_exhaustion', 'Force Exhaustion', ['force_exhaustion'], 'forceExhaustionResolved');
