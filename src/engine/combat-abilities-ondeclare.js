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

import { getDcEffects as _getDcEffects, getMapData } from '../data-loader.js';
import { dcNameFromFigureKey } from '../game/index.js';
import { registerCombatAbility } from './combat-timing-registry.js';
import { sharpshooterInRange } from '../game/sharpshooter-helpers.js';
import { hasFullOfRageAbility, fullOfRageDamageTriggered } from '../game/full-of-rage-helpers.js';
import { hasShockAndAweAbility } from '../game/shock-and-awe-helpers.js';
import { dcAbilityFlags } from '../data-loader.js';
import { limitGuard, abilityLimitKey } from './combat-conditions.js';
import { opponentPlayerNum } from '../game/player-helpers.js';
import { hasSlowOnTheDrawAbility } from '../game/slow-on-the-draw-helpers.js';
import { hasKtpRegularAbility } from '../game/keep-the-peace-helpers.js';
import { canOfferForceExhaustion } from '../game/force-exhaustion-helpers.js';

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
// "Mystic Hunter" is a display-name flag (no specialAbilityId), so it lives in
// passives AND/OR abilities depending on the data split. Match via dcAbilityFlags
// (passives ∪ abilities) so detection survives flags moving between the two
// arrays — hasAny() alone reads only specialAbilityIds + passives.
registerCombatAbility({
  id: 'mystic_hunter', name: 'Mystic Hunter', side: 'attacker', kind: 'passive', windows: ['on_declare'],
  applies: (game, combat, side, deps) => !!combat.attackerFigureKey
    && dcAbilityFlags(atkEff(combat, deps)).map((s) => String(s).toLowerCase()).includes('mystic hunter'),
});

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

// Shock and Awe (Cara Dune) — PLAYER CHOICE, once per round (alexanbv 2026-06-18
// FIX-1). Card text: "Once per round, during a Declare Attack step, you may
// replace 1 Yellow die in your attack pool with 1 Red die." Previously
// auto-applied inline as an AI default at declaration; now offered as an
// interactive on_declare gate button so the player decides. The once-per-round
// limit rides in params (Cara Dune:Shock and Awe) — the gate's
// _markGateAbilityUsed marks game.roundAbilityUsed on resolve, and limitGuard
// re-checks it. Resolver: COMBAT_RESOLVERS.shock_and_awe (yellow→red swap).
const _shockAndAweLimit = limitGuard('once per round', abilityLimitKey('Cara Dune', 'Shock and Awe'));
registerCombatAbility({
  id: 'shock_and_awe', name: 'Shock and Awe', windows: ['on_declare'], side: 'attacker', kind: 'interactive',
  params: { card: 'Cara Dune', ability: 'Shock and Awe', limit: 'once per round' },
  applies: (game, combat, side, deps) => {
    if (!combat.attackerFigureKey) return false;
    if (!hasShockAndAweAbility(atkEff(combat, deps)?.specialAbilityIds || [])) return false;
    // Only offer while a Yellow die is in the pool to swap, and not yet used this round.
    if (!(combat.attackInfo?.dice || []).includes('yellow')) return false;
    return _shockAndAweLimit(game, combat);
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

// The Force is With Me (Chirrut Imwe) — defender gate button offered only on
// Ranged attacks where at least one attacker figure is adjacent to Chirrut.
// If there are no adjacent hostiles, prompt returns null → gate auto-skips it.
registerCombatAbility({
  id: 'the_force_is_with_me', name: 'The Force is With Me', windows: ['on_declare'], side: 'defender', kind: 'interactive',
  applies: (game, combat, _side, deps) => {
    if (!combat.target?.figureKey) return false;
    if (!hasAny(defEff(combat, deps), 'the_force_is_with_me_chirrut')) return false;
    if (!combat.isRanged) return false;
    const mapSpaces = (deps?.getMapData || getMapData)(game.selectedMap?.id);
    if (!mapSpaces) return false;
    const defPN = combat.defenderPlayerNum ?? opponentPlayerNum(combat.attackerPlayerNum);
    const targetCoord = game.figurePositions?.[defPN]?.[combat.target.figureKey];
    if (!targetCoord) return false;
    const adj = (mapSpaces.adjacency?.[String(targetCoord).toLowerCase()] || []).map((s) => String(s).toLowerCase());
    return Object.values(game.figurePositions?.[combat.attackerPlayerNum] || {}).some(
      (pos) => adj.includes(String(pos).toLowerCase()),
    );
  },
});

defAbility('strike_me_down', 'Strike Me Down', ['strike_me_down_obiwan'], 'strikeMeDownResolved');

// Force Exhaustion (The Child / Clan of Two) — gate button offered when The
// Child is alive and the target qualifies (is The Child or has Clan of Two).
// Previously hardcoded as standalone Yes/No buttons outside the gate; now a
// standard on_declare defender interactive. The die-pick sub-step that follows
// (pendingForceExhaustionDiePick + fe_die_pick_* buttons) is still handled by
// handleForceExhaustionDiePick in combat-reactions.js.
registerCombatAbility({
  id: 'force_exhaustion', name: 'Force Exhaustion', windows: ['on_declare'], side: 'defender', kind: 'interactive',
  applies: (game, combat, _side, deps) => {
    if (!combat.target?.figureKey || combat.target?.isNpc) return false;
    const defPN = combat.defenderPlayerNum ?? opponentPlayerNum(combat.attackerPlayerNum);
    const targetDcName = dcNameFromFigureKey(combat.target.figureKey);
    const msgId = deps?.findDcMessageIdForFigure?.(game.gameId, defPN, combat.target.figureKey) || null;
    const upgrades = msgId ? (game.p1DcAttachments?.[msgId] || game.p2DcAttachments?.[msgId] || []) : [];
    return canOfferForceExhaustion(game, defPN, targetDcName, upgrades).eligible;
  },
});

// Slow on the Draw (Greedo) — defender gate button offered when the ATTACKER
// has Greedo's ability. The DEFENDER decides to interrupt.
registerCombatAbility({
  id: 'slow_on_the_draw', name: 'Slow on the Draw', windows: ['on_declare'], side: 'defender', kind: 'interactive',
  applies: (game, combat, _side, deps) => {
    if (!combat.attackerFigureKey) return false;
    return hasSlowOnTheDrawAbility(atkEff(combat, deps)?.specialAbilityIds || []);
  },
});

// Keep the Peace (Wing Guard Regular) — defender gate button offered when a
// friendly figure with KTP-Regular is adjacent to the target space (and the
// target is not a GUARDIAN figure).
registerCombatAbility({
  id: 'keep_the_peace_regular', name: 'Keep the Peace', windows: ['on_declare'], side: 'defender', kind: 'interactive',
  applies: (game, combat, _side, deps) => {
    if (!combat.target?.figureKey || combat.target?.isNpc) return false;
    if (combat._ktpRegularUsed) return false;
    const mapSpaces = (deps?.getMapData || getMapData)(game.selectedMap?.id);
    if (!mapSpaces) return false;
    const defPN = combat.defenderPlayerNum ?? opponentPlayerNum(combat.attackerPlayerNum);
    const targetCoord = game.figurePositions?.[defPN]?.[combat.target.figureKey];
    if (!targetCoord) return false;
    const all = (deps?.getDcEffects || _getDcEffects)() || {};
    const adjToTarget = new Set((mapSpaces.adjacency?.[String(targetCoord).toLowerCase()] || []).map((s) => String(s).toLowerCase()));
    const targetEff = all[dcNameFromFigureKey(combat.target.figureKey)] || all[(dcNameFromFigureKey(combat.target.figureKey) || '').replace(/\s*\[.*\]\s*$/, '')];
    if ((targetEff?.keywords || []).map((k) => String(k).toUpperCase()).includes('GUARDIAN')) return false;
    const defFigPos = game.figurePositions?.[defPN] || {};
    for (const [fk, pos] of Object.entries(defFigPos)) {
      if (!adjToTarget.has(String(pos).toLowerCase())) continue;
      const fkName = dcNameFromFigureKey(fk);
      const fkEff = all[fkName] || all[(fkName || '').replace(/\s*\[.*\]\s*$/, '')];
      if (hasKtpRegularAbility(fkEff?.specialAbilityIds || [])) return true;
    }
    return false;
  },
});

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
