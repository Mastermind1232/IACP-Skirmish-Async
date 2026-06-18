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
import { sharpshooterInRange } from '../game/sharpshooter-helpers.js';
import { hasFullOfRageAbility, fullOfRageDamageTriggered } from '../game/full-of-rage-helpers.js';

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

// Attacker PASSIVE on-declare abilities (auto-fire before the roll via the
// on_declare gate's firePassive → _fireOnDeclarePassive). alexanbv 2026-06-16:
// moved out of the inline declaration block into the on_declare window.
function atkPassive(id, name, keys) {
  registerCombatAbility({
    id, name, side: 'attacker', kind: 'passive', windows: ['on_declare'],
    applies: (game, combat, side, deps) => !!combat.attackerFigureKey && hasAny(atkEff(combat, deps), ...keys),
  });
}

// Battle Meditation — auto-Focus (+1 green die) before attacking.
atkPassive('battle_meditation', 'Battle Meditation', ['battle_meditation']);

// Sharpshooter (Fennec Shand) — auto-Focus when the target is 5+ spaces away.
registerCombatAbility({
  id: 'sharpshooter', name: 'Sharpshooter', windows: ['on_declare'], side: 'attacker', kind: 'passive',
  applies: (game, combat, side, deps) => !!combat.attackerFigureKey
    && hasAny(atkEff(combat, deps), 'sharpshooter')
    && sharpshooterInRange(combat.distanceToTarget),
});

// Mystic Hunter (Zuckuss) — auto-Focus on every attack declaration.
atkPassive('mystic_hunter', 'Mystic Hunter', ['mystic hunter']);

// Fly-By (Jet Trooper Elite) — +1 blue die when the target is within 2 spaces.
registerCombatAbility({
  id: 'fly_by', name: 'Fly-By', windows: ['on_declare'], side: 'attacker', kind: 'passive',
  applies: (game, combat, side, deps) => !!combat.attackerFigureKey
    && hasAny(atkEff(combat, deps), 'fly-by')
    && combat.distanceToTarget != null && combat.distanceToTarget <= 2,
});

// Full of Rage (Krrsantan) — auto-Focus if the attacker has suffered 3+ damage.
registerCombatAbility({
  id: 'full_of_rage', name: 'Full of Rage', windows: ['on_declare'], side: 'attacker', kind: 'passive',
  applies: (game, combat, side, deps) => {
    if (!combat.attackerFigureKey) return false;
    const eff = atkEff(combat, deps);
    if (!hasFullOfRageAbility(eff?.specialAbilityIds || [])) return false;
    // suffered = maxHp - currentHp for the attacking figure (dcHealthState).
    const hs = deps?.dcHealthState?.get?.(combat.attackerMsgId) || [];
    const pair = hs[combat.attackerFigureIndex ?? 0];
    const suffered = pair ? Math.max(0, (pair[1] ?? pair[0] ?? 0) - (pair[0] ?? 0)) : 0;
    return fullOfRageDamageTriggered(suffered);
  },
});

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

// ── Two-timing split-effect abilities (alexanbv 2026-06-18) ───────────────────
// Negotiate (Hondo) + Query (HK-47): PLAY timing = on_declare — the OPPONENT
// makes the choice when the attack is declared. The chosen branch resolves PART
// immediately and PART as a mods-window modifier:
//   Negotiate: opponent pays 2 VP NOW (immediate), OR +2 Damage stashed for mods.
//   Query:     defender becomes Bleeding NOW (immediate), OR +1 Damage for mods.
// The choice prompt + branch routing live in the resolvers (combat.js
// COMBAT_RESOLVERS 'negotiate'/'query'); here we just OFFER them at on_declare.
// Negotiate is Hondo's attacker ability (the defender decides via the prompt);
// Query is the defender's ability. Both are interactive (a choice is made).
registerCombatAbility({
  id: 'negotiate', name: 'Negotiate', windows: ['on_declare'], side: 'attacker', kind: 'interactive',
  applies: (game, combat, side, deps) => !!combat.attackerFigureKey
    && !combat.negotiateResolved
    && hasAny(atkEff(combat, deps), 'negotiate_hondo'),
});
registerCombatAbility({
  id: 'query', name: 'Query', windows: ['on_declare'], side: 'attacker', kind: 'interactive',
  applies: (game, combat, side, deps) => !!combat.attackerFigureKey
    && !combat.queryResolved
    && hasAny(atkEff(combat, deps), 'query_hk47'),
});
