// Mods-window combat abilities — slice C wiring (alexanbv 2026-06-14).
//
// Registers every ability that triggers in the `mods` timing window into the
// combat-timing-registry. The pipeline never names these — it just asks the
// registry "what's eligible at `mods` for this side?". Importing this module
// self-registers them (side-effect import, like mission-eor-effects-wiring).
//
// Detection mirrors src/handlers/combat.js#proceedAfterRerolls. As each step's
// resolution is migrated onto the registry, the inline detection in
// proceedAfterRerolls is deleted, leaving these as the single definition.

import { getMapData as _getMapData, getDcEffects as _getDcEffects, getFigureSize as _getFigureSize } from '../data-loader.js';
import { isWithinSpaces as _isWithinSpaces } from '../game/spatial.js';
import { dcNameFromFigureKey } from '../game/index.js';
import { hasSprayFireAbility } from '../game/spray-fire-helpers.js';
import { hasAgileAbility } from '../game/agile-jet-trooper-helpers.js';
import { hasSlipperyAbility } from '../game/slippery-smuggler-helpers.js';
import { hasTakeCoverAbility } from '../game/take-cover-jawa-helpers.js';
import { hasGamorreanHonorGuardAbility, gamorreanHonorGuardApplies } from '../game/gamorrean-honor-guard-helpers.js';
import { hasCompositePlatingAbility, compositePlatingApplies } from '../game/composite-plating-helpers.js';
import { hasDisposableAbility, hasConclusionAbility } from '../game/evade-debuff-helpers.js';
import { hasCortosisWeaveAbility } from '../game/cortosis-weave-helpers.js';
import { hasCunningAbility } from '../game/cunning-helpers.js';
import { hasFindWeaknessAbility } from '../game/find-weakness-helpers.js';
import { hasForestFightersAbility, forestFightersQualifies } from '../game/forest-fighters-helpers.js';
import { hasAcpScattergun, hasScattergun, scattergunInRange } from '../game/scattergun-helpers.js';
import { hasExploitWeaknessAbility, defenderHasHarmfulCondition } from '../game/exploit-weakness-helpers.js';
import { makeCondition } from './combat-conditions.js';
import { cardNameIncludes } from '../game/card-names.js';
import { getFootprintCells } from '../game/coords.js';
import { getEffectiveFigureSize } from '../game/board-helpers.js';
import { opponentPlayerNum, getDcList, getCcHand } from '../game/player-helpers.js';
import { registerCombatAbility } from './combat-timing-registry.js';
import { hasPendingModifiers } from './combat-pending-modifiers.js';
import { figureHasIllicitArms, playerArmyAffiliationIsScum } from '../game/illicit-arms-helpers.js';

// Two-timing model (alexanbv 2026-06-18): the GENERAL mods-window drain of
// PENDING MODIFIERS. Any ability played at an earlier window (on_declare,
// start_of_round, …) whose effect lands at `mods` stashes a structured modifier
// via stashPendingModifier(combat, 'mods', …). This passive drains and applies
// them when the mods window runs — alongside the abilities normally offered.
// It is NOT Hondo/HK-47-specific: it serves every stashed mods modifier. Fired
// first (attacker side) so the deltas land before the side's own mods. The
// resolver lives in combat.js#_fireModsPassive ('pending_modifiers_drain').
registerCombatAbility({
  id: 'pending_modifiers_drain', name: 'Pending Modifiers', windows: ['mods'], side: 'attacker', kind: 'passive',
  applies: (game, combat) => hasPendingModifiers(combat, 'mods'),
});

const D = (deps, name, fallback) => (deps && deps[name]) || fallback;
function eff(deps, dcName) {
  const all = (D(deps, 'getDcEffects', _getDcEffects))() || {};
  return all[dcName] || all[(dcName || '').replace(/\s*\[.*\]\s*$/, '')] || null;
}
const ids = (e) => e?.specialAbilityIds || [];
const defenderPN = (combat) => combat.defenderPlayerNum ?? (combat.attackerPlayerNum ? opponentPlayerNum(combat.attackerPlayerNum) : null);

/** Footprint cells (lowercased) a figure occupies, size-aware. */
function _figureCellsFor(game, pn, figureKey, deps) {
  const pos = game?.figurePositions?.[pn]?.[figureKey];
  if (!pos) return [];
  const dcName = dcNameFromFigureKey(figureKey);
  const size = getEffectiveFigureSize(game, figureKey, dcName) || D(deps, 'getFigureSize', _getFigureSize)(dcName);
  return getFootprintCells(pos, size).map((c) => String(c).toLowerCase());
}

// ── Attacker mods ────────────────────────────────────────────────────────────

registerCombatAbility({
  id: 'pulse_cannon', name: 'Pulse Cannon', windows: ['mods'], side: 'attacker', kind: 'passive',
  applies: (game, combat, side, deps) => {
    if (!combat.attackerFigureKey || !combat.attackerSpentPowerToken) return false;
    return ids(eff(deps, combat.attackerDcName || dcNameFromFigureKey(combat.attackerFigureKey))).includes('pulse_cannon_iden');
  },
});

registerCombatAbility({
  id: 'spray_fire', name: 'Spray Fire', windows: ['mods'], side: 'attacker', kind: 'interactive',
  applies: (game, combat, side, deps) => {
    if (!combat.attackerFigureKey) return false;
    return hasSprayFireAbility(ids(eff(deps, combat.attackerDcName || dcNameFromFigureKey(combat.attackerFigureKey))));
  },
});

// Negotiate (Hondo) + Query (HK-47) MOVED to the on_declare window
// (combat-abilities-ondeclare.js) per the two-timing model (alexanbv
// 2026-06-18): they are PLAYED/CHOSEN at on_declare — the opponent decides —
// and the chosen branch either resolves IMMEDIATELY (pay VP / Bleed token) or
// stashes a mods-window pending modifier (+Damage) drained by
// 'pending_modifiers_drain' above. They are no longer offered at `mods`.

registerCombatAbility({
  id: 'call_the_shots', name: 'Call the Shots', windows: ['mods'], side: 'attacker', kind: 'interactive',
  applies: (game, combat, side, deps) => {
    if (!combat.attackerFigureKey) return false;
    const friendly = game.figurePositions?.[combat.attackerPlayerNum] || {};
    const atkCoord = friendly[combat.attackerFigureKey];
    const mapSp = D(deps, 'getMapData', _getMapData)(game.selectedMap?.id);
    if (!atkCoord || !mapSp) return false;
    const within = D(deps, 'isWithinSpaces', _isWithinSpaces);
    for (const [fk, pos] of Object.entries(friendly)) {
      if (fk === combat.attackerFigureKey) continue;
      if (!ids(eff(deps, dcNameFromFigureKey(fk))).includes('call_the_shots_hera')) continue;
      if (game.roundFigureAbilityUsed?.[`${fk}_call_the_shots`]) continue;
      if (within(mapSp, String(pos).toLowerCase(), String(atkCoord).toLowerCase(), 3)) return true;
    }
    return false;
  },
});

registerCombatAbility({
  id: 'heavy_repeater', name: 'Heavy Repeater', windows: ['mods'], side: 'attacker', kind: 'interactive',
  applies: (game, combat, side, deps) => {
    if (!combat.attackerFigureKey) return false;
    const e = eff(deps, combat.attackerDcName || dcNameFromFigureKey(combat.attackerFigureKey));
    if (!ids(e).includes('heavy_repeater_paz')) return false;
    return e?.attack?.type === 'range' || combat.attackType === 'Ranged';
  },
});

// Charge Generators (AT-DP) — alexanbv 2026-06-18 FIX-1 (SPLIT). Card text:
// "While attacking, if you have suffered fewer than 9 Damage, apply +1 Damage to
// the attack results AND you may reroll 1 attack die." The two halves live in
// DIFFERENT windows: the +1 Damage is offered here in MODS; the reroll is a
// separate REROLLS-window button (combat-abilities-rerolls.js → 'charge_generators
// _reroll'), gated on the SAME suffered<9 condition. (Previously a single mods
// interactive did BOTH, which mis-timed the reroll.) This mods half applies ONLY
// +1 Damage. Conditional on the AT-DP figure having suffered <9 Damage
// (dcHealthState: suffered = maxHp - currentHp). Resolver:
// COMBAT_RESOLVERS.charge_generators. Uses a distinct limit key from the reroll
// half so resolving one does not block the other (independent once-per-attack).
export function chargeGeneratorsSuffered(game, combat, deps) {
  const hs = deps?.dcHealthState?.get?.(combat.attackerMsgId) || [];
  const pair = hs[combat.attackerFigureIndex ?? 0];
  return pair ? Math.max(0, (pair[1] ?? pair[0] ?? 0) - (pair[0] ?? 0)) : 0;
}
export function chargeGeneratorsActive(game, combat, deps) {
  if (!combat.attackerFigureKey) return false;
  if (!ids(eff(deps, combat.attackerDcName || dcNameFromFigureKey(combat.attackerFigureKey))).includes('charge_generators')) return false;
  return chargeGeneratorsSuffered(game, combat, deps) < 9;
}
registerCombatAbility({
  id: 'charge_generators', name: 'Charge Generators', windows: ['mods'], side: 'attacker', kind: 'interactive',
  params: { card: 'AT-DP', ability: 'Charge Generators (+1 Damage)', limit: 'once per attack' },
  applies: (game, combat, side, deps) => {
    if (!chargeGeneratorsActive(game, combat, deps)) return false;
    return !(combat._abilityUsedThisAttack?.['AT-DP:Charge Generators (+1 Damage)']);
  },
});

// Rogue One ([Rogue One] upgrade) [attacker] — FIX-2 spend-resource. Card text:
// "While a listed friendly figure is attacking, it may discard 1 Power Token of
// any type from another friendly figure to add +1 Damage to the attack results."
// A mods interactive: the resolver picks a donor ally + spends one of their Power
// Tokens for +1 Hit (COMBAT_RESOLVERS.rogue_one). `applies` requires the team to
// hold [Rogue One], the attacker to be a listed Rogue One figure, and at least
// one OTHER friendly figure to carry a Power Token (the resource to spend). Once
// per attack. (The legacy surge-window button path is retained for the non-gate
// flow; the gate offers this mods version.)
const ROGUE_ONE_FIGURES = ['Baze Malbus', 'Bodhi Rook', 'Cassian Andor', 'Chirrut Imwe', 'Jyn Erso', 'K-2SO'];
export function rogueOneDonorFigureKeys(game, combat) {
  const pn = combat.attackerPlayerNum;
  if (!pn || !combat.attackerFigureKey) return [];
  const atkName = combat.attackerDcName || dcNameFromFigureKey(combat.attackerFigureKey);
  if (!ROGUE_ONE_FIGURES.some((n) => String(atkName).includes(n))) return [];
  if (!((getDcList(game, pn) || []).some((dc) => (dc?.dcName || dc || '').includes('Rogue One')))) return [];
  const friendly = game.figurePositions?.[pn] || {};
  const donors = [];
  for (const fk of Object.keys(friendly)) {
    if (fk === combat.attackerFigureKey) continue;
    if ((game.figurePowerTokens?.[fk] || []).length > 0) donors.push(fk);
  }
  return donors;
}
registerCombatAbility({
  id: 'rogue_one', name: 'Rogue One', windows: ['mods'], side: 'attacker', kind: 'interactive',
  params: { card: '[Rogue One]', ability: 'Rogue One', limit: 'once per attack' },
  applies: (game, combat) => {
    if (combat._abilityUsedThisAttack?.['[Rogue One]:Rogue One']) return false;
    return rogueOneDonorFigureKeys(game, combat).length > 0;
  },
});

// Illicit Arms (Bib Fortuna) [attacker] — FIX-2 spend-resource, DC ability. Card
// text: "While a friendly figure is attacking, if your army's affiliation is
// SCUM, you may discard 1 Command card from your hand to apply +1 Damage to the
// attack results (once per attack)." Usable by ANY friendly attacking figure —
// the only restriction is the controlling player's ARMY affiliation = Scum (NOT
// the attacking figure, nor Bib himself, being SCUM). Gated on: (a) a friendly
// Bib Fortuna carrying Illicit Arms in play, (b) the attacker's army primary
// affiliation is Scum, (c) a Command card in the attacker's hand to spend.
// Resolver discards 1 CC → +1 Hit (COMBAT_RESOLVERS.illicit_arms). Clobbers the
// timing-only catalog entry (same id) per the per-id last-write rule.
export function illicitArmsEligible(game, combat, deps) {
  const pn = combat.attackerPlayerNum;
  if (!pn) return false;
  if ((getCcHand(game, pn) || []).length === 0) return false; // a CC to spend
  const friendly = game.figurePositions?.[pn] || {};
  let bibPresent = false;
  for (const fk of Object.keys(friendly)) {
    if (figureHasIllicitArms(eff(deps, dcNameFromFigureKey(fk)))) { bibPresent = true; break; }
  }
  if (!bibPresent) return false; // Bib Fortuna (Illicit Arms) must be in play
  const dcEffects = (D(deps, 'getDcEffects', _getDcEffects))() || {};
  return playerArmyAffiliationIsScum(getDcList(game, pn) || [], dcEffects);
}
registerCombatAbility({
  id: 'illicit_arms', name: 'Illicit Arms (Bib Fortuna)', windows: ['mods'], side: 'attacker', kind: 'interactive',
  params: { card: 'Bib Fortuna', ability: 'Illicit Arms', limit: 'once per attack' },
  applies: (game, combat, side, deps) => {
    if (combat._abilityUsedThisAttack?.['Bib Fortuna:Illicit Arms']) return false;
    return illicitArmsEligible(game, combat, deps);
  },
});

// Guidance Systems ([Mortar Trooper] attachment) [attacker] — FIX-3 repeatable
// mods choice. Card text: "While attacking, you may apply -1 Damage and +2
// Accuracy to the attack results. This ability may be used MULTIPLE TIMES per
// attack." A mods interactive with NO once-per limit — the gate's re-prompt loop
// re-offers it each pass, so it can be stacked. Detection: the attacking DC
// carries the [Mortar Trooper] attachment (Squad Upgrade). Gated to stop when the
// projected attack Damage would drop below 0 (a -1 Damage with 0 damage is a
// no-op / shouldn't underflow). Resolver: COMBAT_RESOLVERS.guidance_systems.
// Clobbers the timing-only catalog entry of the same id (per-id last-write).
export function guidanceSystemsAttached(game, combat) {
  const msgId = combat.attackerMsgId;
  if (!msgId) return false;
  const atts = game.p1DcAttachments?.[msgId] || game.p2DcAttachments?.[msgId] || [];
  return cardNameIncludes(atts, 'Mortar Trooper');
}
/** Projected attack Damage so far (dice + bonus), used to gate the -1 underflow. */
export function projectedAttackDamage(combat) {
  return (combat.attackRoll?.dmg || 0) + (combat.bonusHits || 0);
}
registerCombatAbility({
  id: 'guidance_systems', name: 'Guidance Systems', windows: ['mods'], side: 'attacker', kind: 'interactive',
  // No card/ability/limit params → no once-per mark; offered every pass (multiple/attack).
  applies: (game, combat) => {
    if (!guidanceSystemsAttached(game, combat)) return false;
    // -1 Damage must not push Damage below 0 — only offer while Damage > 0.
    return projectedAttackDamage(combat) > 0;
  },
});

// Set Your Sights (Loku Kanoloa) [attacker] — gate-rework 2026-06-18. "While a
// friendly figure is attacking a figure with a Recon token, apply Pierce 1 to the
// attack results." A mods passive (automatic +1 Pierce) gated on the TARGET
// carrying a Recon token (placed at mission start by Loku's setup effect). Owner
// (Loku) need only be in play — the board-wide recon-token model means any friendly
// attacker benefits. Clobbers the timing-only catalog entry of the same id
// (per-id last-write; the catalog entry is deleted in the catalog file). Effect:
// _fireModsPassive ('set_your_sights' → +1 Pierce).
const _setYourSightsReconTarget = makeCondition({ type: 'target_has_recon_token' });
registerCombatAbility({
  id: 'set_your_sights', name: 'Set Your Sights (Loku)', windows: ['mods'], side: 'attacker', kind: 'passive',
  applies: (game, combat, side, deps) => {
    if (combat.noFriendliesActive || !combat.attackerFigureKey || !combat.target?.figureKey) return false;
    if (!_setYourSightsReconTarget(game, combat)) return false;
    // A friendly Loku (set_your_sights_loku owner) must be in play — board-wide.
    const team = game.figurePositions?.[combat.attackerPlayerNum] || {};
    for (const fk of Object.keys(team)) {
      if (ids(eff(deps, dcNameFromFigureKey(fk))).includes('set_your_sights_loku')) return true;
    }
    return false;
  },
});

// ── Defender mods ────────────────────────────────────────────────────────────

// Hunker Down (Cara Dune) [defender] — gate-rework 2026-06-18. "While defending,
// if you share a corner or edge with a space containing blocking, impassable, or
// difficult terrain, apply +1 Evade to the defense results." A mods passive
// (automatic +1 Evade) gated on the reusable near_terrain_type primitive. Detection
// requires the defender to carry hunker_down. Clobbers the timing-only catalog
// entry of the same id (deleted in the catalog file). Replaces the eager
// declaration-time inline in handlers/combat.js (which mis-timed it + only worked
// when target.coord was set). Effect: _fireModsPassive ('hunker_down' → +1 Evade).
const _hunkerDownNearTerrain = makeCondition({ type: 'near_terrain_type', side: 'defender', types: ['blocking', 'impassable', 'difficult'] });
registerCombatAbility({
  id: 'hunker_down', name: 'Hunker Down (Cara Dune)', windows: ['mods'], side: 'defender', kind: 'passive',
  applies: (game, combat, side, deps) => {
    const fk = combat.target?.figureKey;
    if (!fk) return false;
    if (!ids(eff(deps, defenderDcNameOf(combat))).includes('hunker_down')) return false;
    return _hunkerDownNearTerrain(game, combat);
  },
});

// Improvised Cover (Verena Talos) [defender] — gate-rework 2026-06-18. "While
// defending, if adjacent to an object or non-friendly figure other than the
// attacker, apply +1 Block to the defense results." A mods passive (automatic +1
// Block) gated on the reusable affected_adjacent_to_object_or_enemy primitive.
// Detection requires the defender to carry improvised_cover_verena. Clobbers the
// timing-only catalog entry of the same id (deleted in the catalog file). Effect:
// _fireModsPassive ('improvised_cover_verena' → +1 Block).
const _improvisedCoverAdjacency = makeCondition({ type: 'affected_adjacent_to_object_or_enemy', side: 'defender' });
registerCombatAbility({
  id: 'improvised_cover_verena', name: 'Improvised Cover (Verena Talos)', windows: ['mods'], side: 'defender', kind: 'passive',
  applies: (game, combat, side, deps) => {
    const fk = combat.target?.figureKey;
    if (!fk) return false;
    if (!ids(eff(deps, defenderDcNameOf(combat))).includes('improvised_cover_verena')) return false;
    return _improvisedCoverAdjacency(game, combat);
  },
});


registerCombatAbility({
  id: 'agile', name: 'Agile', windows: ['mods'], side: 'defender', kind: 'interactive',
  applies: (game, combat, side, deps) => {
    if (!combat.target?.figureKey) return false;
    if (!hasAgileAbility(ids(eff(deps, dcNameFromFigureKey(combat.target.figureKey))))) return false;
    return ((combat.defenseRoll?.block || 0) + (combat.bonusBlock || 0)) > 0;
  },
});

registerCombatAbility({
  id: 'crate_block_sink', name: 'Line of Fire (crate block)', windows: ['mods'], side: 'defender', kind: 'interactive',
  applies: (game, combat, side, deps) => {
    const fk = combat.target?.figureKey;
    if (!fk) return false;
    if (!game?.selectedMission?.rules?.persistent?.crateBlockSink || !game.figureContraband?.[fk]) return false;
    const rawSize = D(deps, 'getFigureSize', _getFigureSize)?.(dcNameFromFigureKey(fk));
    const size = game.figureOrientations?.[fk] || rawSize;
    return Array.isArray(size) ? (size[0] === 1 && size[1] === 1) : true;
  },
});

registerCombatAbility({
  id: 'defensible', name: 'Defensible', windows: ['mods'], side: 'defender', kind: 'interactive',
  applies: (game, combat, side, deps) => {
    if (!combat.target?.figureKey) return false;
    return ids(eff(deps, dcNameFromFigureKey(combat.target.figureKey))).includes('defensible_sc2m');
  },
});

registerCombatAbility({
  id: 'get_down', name: 'Get Down', windows: ['mods'], side: 'defender', kind: 'interactive',
  applies: (game, combat, side, deps) => {
    const fk = combat.target?.figureKey;
    if (!fk || !combat.attackerPlayerNum) return false;
    const defEff = eff(deps, dcNameFromFigureKey(fk));
    const kws = (defEff?.keywords || []).map((k) => String(k).toUpperCase());
    if (kws.includes('LARGE') || kws.includes('MASSIVE')) return false;
    const friendly = game.figurePositions?.[opponentPlayerNum(combat.attackerPlayerNum)] || {};
    const defCoord = friendly[fk];
    const mapSp = D(deps, 'getMapData', _getMapData)(game.selectedMap?.id);
    if (!defCoord || !mapSp) return false;
    const within = D(deps, 'isWithinSpaces', _isWithinSpaces);
    for (const [ofk, pos] of Object.entries(friendly)) {
      if (!ids(eff(deps, dcNameFromFigureKey(ofk))).includes('get_down_onar')) continue;
      if (game.roundFigureAbilityUsed?.[`${ofk}_get_down`]) continue;
      if (within(mapSp, String(pos).toLowerCase(), String(defCoord).toLowerCase(), 2)) return true;
    }
    return false;
  },
});

registerCombatAbility({
  id: 'elusive', name: 'Elusive', windows: ['mods'], side: 'defender', kind: 'interactive',
  applies: (game, combat) => !!combat.elusiveActive && (combat.attackDiceResults?.length || 0) > 0,
});

// Zillo Technique — Block Boost ([Zillo Technique] upgrade) [defender] — FIX-2
// spend-resource. Card text: "While a friendly figure is defending, discard 1
// Command card to apply +1 Block to the defense results (once per attack)." This
// is DISTINCT from the pierce-cancel exhaust (combat-abilities-zillo.js, 'zillo'
// window) — it's a mods-window CC discard. `applies` requires the defender's team
// to hold [Zillo Technique] AND a Command card in hand. Resolver discards 1 CC →
// +1 Block (COMBAT_RESOLVERS.zillo_technique_discard). Clobbers the timing-only
// catalog entry of the same id (per-id last-write).
export function zilloBlockBoostEligible(game, combat) {
  const defPn = defenderPN(combat);
  if (defPn == null) return false;
  if ((getCcHand(game, defPn) || []).length === 0) return false; // a CC to spend
  return (getDcList(game, defPn) || []).some((dc) => (dc?.dcName || dc || '') === '[Zillo Technique]');
}
registerCombatAbility({
  id: 'zillo_technique_discard', name: 'Zillo Technique (Block Boost)', windows: ['mods'], side: 'defender', kind: 'interactive',
  params: { card: '[Zillo Technique]', ability: 'Block Boost', limit: 'once per attack' },
  applies: (game, combat) => {
    if (combat._abilityUsedThisAttack?.['[Zillo Technique]:Block Boost']) return false;
    return zilloBlockBoostEligible(game, combat);
  },
});

// Vague and Unconvincing (K-2SO) [defender] — gate-rework 2026-06-18. "While
// defending, your player and your opponent cannot spend power tokens or play
// Command cards." This is a DENIAL/lock-out, not a result-counter delta. The
// actual enforcement is the derived lock-out consulted by the token-spend gate
// (combat-abilities-tokens.js) and isCcPlayableNow (cc-timing.js), which span the
// WHOLE attack (on_declare onward). This mods passive is informational only — it
// reports the lock-out in the modifiers window + completes registry coverage for
// the ability (it sets no counter). Clobbers the timing-only catalog entry of the
// same id (deleted in the catalog). Effect: _fireModsPassive ('vague_and_unconvincing').
registerCombatAbility({
  id: 'vague_and_unconvincing', name: 'Vague and Unconvincing (K-2SO)', windows: ['mods'], side: 'defender', kind: 'passive',
  applies: (game, combat, side, deps) => {
    const fk = combat.target?.figureKey;
    if (!fk) return false;
    return ids(eff(deps, defenderDcNameOf(combat))).includes('vague_and_unconvincing_k2s0');
  },
});

// Dodge auto-conversions (no decision) → passive.
registerCombatAbility({
  id: 'defensive_stance', name: 'Defensive Stance', windows: ['mods'], side: 'defender', kind: 'passive',
  applies: (game, combat, side, deps) => {
    if (!combat.defenseRoll?.dodge || !combat.target?.figureKey) return false;
    return ids(eff(deps, dcNameFromFigureKey(combat.target.figureKey))).includes('defensive_stance');
  },
});

registerCombatAbility({
  id: 'soresu', name: 'Soresu Form', windows: ['mods'], side: 'defender', kind: 'passive',
  applies: (game, combat) => !!combat.defenseRoll?.dodge && !!combat.soresuFormFigKey && !!combat.target?.figureKey,
});

registerCombatAbility({
  id: 'lucky', name: 'Lucky', windows: ['mods'], side: 'defender', kind: 'passive',
  applies: (game, combat, side, deps) => {
    if (!combat.defenseRoll?.dodge || !combat.target?.figureKey) return false;
    return ids(eff(deps, dcNameFromFigureKey(combat.target.figureKey))).includes('lucky_r2d2');
  },
});

// Defender result-modifier passives moved from declaration (handleAttackTarget)
// into the mods window per alexanbv 2026-06-16 "they must be implemented at the
// right timing". Detection keyed off combat.defenderDcName (variant-qualified —
// the figureKey base name misses the "(Regular)"/"(Elite)" dc-effects entry).
const defenderDcNameOf = (combat) => combat.defenderDcName
  || (combat.target?.figureKey ? dcNameFromFigureKey(combat.target.figureKey) : null);
const attackerDcNameOf = (combat) => combat.attackerDcName
  || (combat.attackerFigureKey ? dcNameFromFigureKey(combat.attackerFigureKey) : null);

// Slippery (Alliance Smuggler) — while defending, -2 Accuracy to the attack.
registerCombatAbility({
  id: 'slippery', name: 'Slippery', windows: ['mods'], side: 'defender', kind: 'passive',
  applies: (game, combat, side, deps) => {
    const dcName = defenderDcNameOf(combat);
    return !!dcName && hasSlipperyAbility(ids(eff(deps, dcName)));
  },
});

// Take Cover (Jawa Scavenger) — while defending, +1 Block and -1 Evade.
registerCombatAbility({
  id: 'take_cover', name: 'Take Cover', windows: ['mods'], side: 'defender', kind: 'passive',
  applies: (game, combat, side, deps) => {
    const dcName = defenderDcNameOf(combat);
    return !!dcName && hasTakeCoverAbility(ids(eff(deps, dcName)));
  },
});

// Gamorrean Honor Guard — +1 Block while defending during a Ranged attack.
registerCombatAbility({
  id: 'gamorrean_honor_guard', name: 'Gamorrean Honor Guard', windows: ['mods'], side: 'defender', kind: 'passive',
  applies: (game, combat, side, deps) => {
    const dcName = defenderDcNameOf(combat);
    return !!dcName && hasGamorreanHonorGuardAbility(ids(eff(deps, dcName)))
      && gamorreanHonorGuardApplies(combat.isRanged);
  },
});

// Composite Plating (Heavy Stormtrooper Regular) — +1 Block if attacker 4+ away.
registerCombatAbility({
  id: 'composite_plating', name: 'Composite Plating', windows: ['mods'], side: 'defender', kind: 'passive',
  applies: (game, combat, side, deps) => {
    const dcName = defenderDcNameOf(combat);
    return !!dcName && hasCompositePlatingAbility(ids(eff(deps, dcName)))
      && compositePlatingApplies(combat.distanceToTarget);
  },
});

// Disposable (Hired Gun Regular) — -1 Evade to own defense results.
registerCombatAbility({
  id: 'disposable', name: 'Disposable', windows: ['mods'], side: 'defender', kind: 'passive',
  applies: (game, combat, side, deps) => {
    const dcName = defenderDcNameOf(combat);
    return !!dcName && hasDisposableAbility(ids(eff(deps, dcName)));
  },
});

// Cortosis Weave (Echo Base Trooper Elite) — reduce attack Pierce by 2.
registerCombatAbility({
  id: 'cortosis_weave', name: 'Cortosis Weave', windows: ['mods'], side: 'defender', kind: 'passive',
  applies: (game, combat, side, deps) => {
    const dcName = defenderDcNameOf(combat);
    return !!dcName && hasCortosisWeaveAbility(ids(eff(deps, dcName)));
  },
});

// Dead Precise (Ko-Tun Feralo) — the −1 Dodge RIDER, separated from the reroll
// per alexanbv 2026-06-16 ("Ko-Tun's −dodge is independent of whether the reroll
// was used — separate it as a mod ability with the same conditions"). Fires when
// a friendly Ko-Tun is within 3 of the attacker AND the attacker spent a Power
// Token. The reroll itself stays in the rerolls window (CSV Dead Precise row).
const _deadPreciseKoTunAura = makeCondition({ type: 'within_n_of_source', card: 'Ko-Tun Feralo', n: 3, side: 'attacker' });
registerCombatAbility({
  id: 'dead_precise_dodge', name: 'Dead Precise (−1 Dodge)', windows: ['mods'], side: 'attacker', kind: 'passive',
  applies: (game, combat) => !!combat.attackerSpentPowerToken && _deadPreciseKoTunAura(game, combat),
});

// Shared Intuition (4-LOM) [attacker] — gate-rework 2026-06-18. "While attacking,
// if another friendly HUNTER within 3 has line of sight to the target space, apply
// +1 Damage." A mods passive (automatic +1 Damage) gated on the reusable LOS aura
// primitive (friendly_within_n_with_los_to_target). Detection requires 4-LOM to be
// the attacker (the owner) AND the HUNTER-within-3-with-LOS-to-target condition.
// Preservation Protocol can strip the ability (sid removed from the dc entry), so
// the sid check covers that. Effect: COMBAT_RESOLVERS via _fireModsPassive.
const _sharedIntuitionLosAura = makeCondition({ type: 'friendly_within_n_with_los_to_target', keyword: 'HUNTER', n: 3, includeSelf: false });
registerCombatAbility({
  id: 'shared_intuition', name: 'Shared Intuition', windows: ['mods'], side: 'attacker', kind: 'passive',
  applies: (game, combat, side, deps) => {
    if (combat.noFriendliesActive || !combat.attackerFigureKey) return false;
    const atkName = attackerDcNameOf(combat);
    if (!ids(eff(deps, atkName)).includes('shared_intuition')) return false;
    return _sharedIntuitionLosAura(game, combat);
  },
});

// Deadly Precision (CC) — this round, the playing player's attacks apply -1
// Dodge. Round-scoped per-player flag set by the CC; cleared at round start.
// alexanbv 2026-06-17.
registerCombatAbility({
  id: 'deadly_precision', name: 'Deadly Precision (−1 Dodge)', windows: ['mods'], side: 'attacker', kind: 'passive',
  applies: (game, combat) => !!game?.deadlyPrecisionActive?.[combat?.attackerPlayerNum],
});

// Conclusion (HK-47) — cancel any Dodge the defender rolls (attacker-side flag).
registerCombatAbility({
  id: 'conclusion', name: 'Conclusion', windows: ['mods'], side: 'attacker', kind: 'passive',
  applies: (game, combat, side, deps) => {
    const dcName = attackerDcNameOf(combat);
    return !!dcName && hasConclusionAbility(ids(eff(deps, dcName)));
  },
});

// Cunning (defender) — sets the hasCunning flag (read at resolution).
registerCombatAbility({
  id: 'cunning', name: 'Cunning', windows: ['mods'], side: 'defender', kind: 'passive',
  applies: (game, combat, side, deps) => {
    const dcName = defenderDcNameOf(combat);
    return !!dcName && hasCunningAbility(ids(eff(deps, dcName)));
  },
});

// Find Weakness (Scout Trooper Elite) — -1 Evade to the defender's results.
registerCombatAbility({
  id: 'find_weakness', name: 'Find Weakness', windows: ['mods'], side: 'attacker', kind: 'passive',
  applies: (game, combat, side, deps) => {
    const dcName = attackerDcNameOf(combat);
    return !!dcName && hasFindWeaknessAbility(ids(eff(deps, dcName)));
  },
});

// Scattergun / ACP Scattergun (Trandoshan Hunter) — +Hits when adjacent.
registerCombatAbility({
  id: 'scattergun', name: 'Scattergun', windows: ['mods'], side: 'attacker', kind: 'passive',
  applies: (game, combat, side, deps) => {
    const dcName = attackerDcNameOf(combat);
    if (!dcName || !scattergunInRange(combat.distanceToTarget)) return false;
    const sids = ids(eff(deps, dcName));
    return hasAcpScattergun(sids) || hasScattergun(sids);
  },
});

// Forest Fighters (Ewok Warrior Elite) — +1 Hit on a Melee attack while Hidden.
registerCombatAbility({
  id: 'forest_fighters', name: 'Forest Fighters', windows: ['mods'], side: 'attacker', kind: 'passive',
  applies: (game, combat, side, deps) => {
    const dcName = attackerDcNameOf(combat);
    if (!dcName || !hasForestFightersAbility(ids(eff(deps, dcName)))) return false;
    const atkConds = game.figureConditions?.[combat.attackerFigureKey] || [];
    return forestFightersQualifies({ isRanged: combat.isRanged, attackerConditions: atkConds });
  },
});

// Aim (Rebel Trooper Regular AND Elite) — FINALIZED in the IACP 2026-06-21
// update. Both variants share the same per-FIGURE mechanic, applied inline in
// handlers/combat.js via aim-rebel-trooper-helpers.js (hasAimAbility /
// aimBonusApplies / applyAimBonus), keyed on game.figureMoved[attackerFigureKey].
// Not a CSV-graduated combat-window mod here.

// Exploit Weakness (Scout Trooper Elite) — +1 Surge if the defender has a
// harmful condition.
registerCombatAbility({
  id: 'exploit_weakness', name: 'Exploit Weakness', windows: ['mods'], side: 'attacker', kind: 'passive',
  applies: (game, combat, side, deps) => {
    const dcName = attackerDcNameOf(combat);
    if (!dcName || !hasExploitWeaknessAbility(ids(eff(deps, dcName)))) return false;
    const defConds = game.figureConditions?.[combat.target?.figureKey] || [];
    return defenderHasHarmfulCondition(defConds);
  },
});

// Spectre Cell — NOT a combat mod. The errata version grants tokens at the
// start of the round + a once-per-round exhaust (alexanbv 2026-06-16). The
// "+1 Damage/+1 Block passive" was the pre-errata version (still in the DB —
// flagged for a data fix); it does not belong in any combat window.

// Fury of Kashyyyk — Pierce 1 (conditional attacker modifier, IACP card part 3;
// alexanbv 2026-06-16 "implement fury to spec with both restrictions"). Auto-
// applies Pierce 1 when: the attacker's team has the [Fury of Kashyyyk] upgrade,
// the attacker is an ELITE WOOKIEE, the target is within 2 of the attacker, AND
// another friendly WOOKIEE is within 2 of the defender. (The Focus-on-damage part
// is the separate WHEN_DAMAGED hook.) Effect applied in _fireModsPassive.
registerCombatAbility({
  id: 'fury_kashyyyk_pierce', name: 'Fury of Kashyyyk (Pierce 1)', windows: ['mods'], side: 'attacker', kind: 'passive',
  applies: (game, combat, side, deps) => {
    if (!combat.attackerFigureKey || !combat.target?.figureKey) return false;
    // Lure of the Dark Side / False Orders: no figures are friendly to the
    // controlled attacker, so the "another friendly WOOKIEE" trigger can't fire
    // (alexanbv 2026-05-07). Mirrors the retired inline's noFriendliesActive guard.
    if (combat.noFriendliesActive) return false;
    const atkPn = combat.attackerPlayerNum;
    const team = (D(deps, 'getDcList', getDcList))(game, atkPn) || [];
    if (!team.some((dc) => (dc?.dcName || dc) === '[Fury of Kashyyyk]')) return false;
    const atkName = combat.attackerDcName || dcNameFromFigureKey(combat.attackerFigureKey);
    const atkKws = (eff(deps, atkName)?.keywords || []).map((k) => String(k).toUpperCase());
    if (!atkKws.includes('WOOKIEE') || !/\(elite\)/i.test(String(atkName))) return false;
    if ((combat.distanceToTarget ?? 99) > 2) return false; // target within 2 of attacker
    const mapSp = D(deps, 'getMapData', _getMapData)(game.selectedMap?.id);
    const defPn = defenderPN(combat);
    const targetPos = game.figurePositions?.[defPn]?.[combat.target.figureKey];
    if (!mapSp || !targetPos) return false;
    const within = D(deps, 'isWithinSpaces', _isWithinSpaces);
    const friendly = game.figurePositions?.[atkPn] || {};
    for (const [fk, pos] of Object.entries(friendly)) {
      if (fk === combat.attackerFigureKey) continue;
      const kws = (eff(deps, dcNameFromFigureKey(fk))?.keywords || []).map((k) => String(k).toUpperCase());
      if (!kws.includes('WOOKIEE')) continue;
      if (within(mapSp, String(pos).toLowerCase(), String(targetPos).toLowerCase(), 2)) return true;
    }
    return false;
  },
});

// ── Third-party / automatic mods passives (migrated off the eager declaration
// path in handlers/combat.js per the slice-migration pattern; the inline blocks
// are deleted so the effect lands ONCE, in the modifiers window). ─────────────

const _normName = (s) => String(s || '').replace(/\s*\[.*\]\s*$/, '').trim().toLowerCase();

// Protector (Chewbacca) [defender] — +1 Block for an adjacent friendly figure
// being targeted. Owner = the figure with `protector`; fires when that owner is
// adjacent to the targeted space (the defender). Combined "1 Sentinel or
// Protector per attack" cap enforced in _fireModsPassive via a shared flag.
// Wookiee Avenger replaces Protector — a Chewbacca whose DC has the [Wookiee
// Avenger] attachment loses Protector, so it is skipped here (mirrors the retired
// inline's _protReplaced guard). Owner scanned manually for that attachment.
registerCombatAbility({
  id: 'protector', name: 'Protector', windows: ['mods'], side: 'defender', kind: 'passive',
  applies: (game, combat, side, deps) => {
    if (combat.noFriendliesActive || !combat.target?.figureKey || combat.target?.isNpc) return false;
    const defPn = defenderPN(combat);
    const targetFk = combat.target.figureKey;
    const mapSp = D(deps, 'getMapData', _getMapData)(game.selectedMap?.id);
    if (defPn == null || !mapSp) return false;
    const within = D(deps, 'isWithinSpaces', _isWithinSpaces);
    const targetCells = _figureCellsFor(game, defPn, targetFk, deps);
    if (!targetCells.length) return false;
    const team = game.figurePositions?.[defPn] || {};
    const findMid = deps?.findDcMessageIdForFigure;
    for (const fk of Object.keys(team)) {
      if (fk === targetFk) continue;
      if (!ids(eff(deps, dcNameFromFigureKey(fk))).includes('protector')) continue;
      // Wookiee Avenger attached → this Chewbacca lost Protector.
      const msgId = findMid ? findMid(game.gameId, defPn, fk) : null;
      const atts = msgId ? (game.p1DcAttachments?.[msgId] || game.p2DcAttachments?.[msgId] || []) : [];
      if (cardNameIncludes(atts, 'Wookiee Avenger')) continue;
      for (const oc of _figureCellsFor(game, defPn, fk, deps)) {
        for (const tc of targetCells) if (within(mapSp, oc, tc, 1)) return true;
      }
    }
    return false;
  },
});

// Shared scan: a FRIENDLY figure carrying `ability` (on the team owning side `pn`,
// resolved via injected deps so it is testable) is within 1 of the TARGET space.
// `excludeSelfKey` skips a specific owner figureKey ("another friendly figure").
function _friendlyWithAbilityNearTarget(game, combat, deps, { ability, ownerPn, excludeFigureKey }) {
  const defPn = defenderPN(combat);
  const targetFk = combat.target?.figureKey;
  const mapSp = D(deps, 'getMapData', _getMapData)(game.selectedMap?.id);
  if (defPn == null || ownerPn == null || !targetFk || !mapSp) return false;
  const within = D(deps, 'isWithinSpaces', _isWithinSpaces);
  const targetCells = _figureCellsFor(game, defPn, targetFk, deps);
  if (!targetCells.length) return false;
  const team = game.figurePositions?.[ownerPn] || {};
  for (const fk of Object.keys(team)) {
    if (excludeFigureKey && fk === excludeFigureKey) continue;
    if (!ids(eff(deps, dcNameFromFigureKey(fk))).includes(ability)) continue;
    for (const oc of _figureCellsFor(game, ownerPn, fk, deps)) {
      for (const tc of targetCells) if (within(mapSp, oc, tc, 1)) return true;
    }
  }
  return false;
}

// Sentinel (Royal Guard Elite + Regular) [defender] — same shape as Protector,
// but the DEFENDER must be a NON-GUARDIAN figure.
registerCombatAbility({
  id: 'sentinel', name: 'Sentinel', windows: ['mods'], side: 'defender', kind: 'passive',
  applies: (game, combat, side, deps) => {
    if (combat.noFriendliesActive || !combat.target?.figureKey || combat.target?.isNpc) return false;
    const defName = combat.defenderDcName || dcNameFromFigureKey(combat.target.figureKey);
    const defKws = (eff(deps, defName)?.keywords || []).map((k) => String(k).toUpperCase());
    if (defKws.includes('GUARDIAN')) return false; // Sentinel only shields NON-GUARDIANs
    return _friendlyWithAbilityNearTarget(game, combat, deps, { ability: 'sentinel', ownerPn: defenderPN(combat) });
  },
});

// Supporting Fire (J4X-7) [attacker] — Pierce 1 when ANOTHER friendly attacks a
// figure adjacent to J4X-7 (owner). Once per activation (J4X-7:Supporting Fire).
registerCombatAbility({
  id: 'supporting_fire', name: 'Supporting Fire', windows: ['mods'], side: 'attacker', kind: 'passive',
  applies: (game, combat, side, deps) => {
    if (combat.noFriendliesActive || !combat.target?.figureKey || combat.target?.isNpc) return false;
    if (game.activationAbilityUsed?.['J4X-7:Supporting Fire']) return false;
    // "another friendly figure is attacking" — the attacker is NOT the J4X-7 owner.
    const atkName = combat.attackerDcName || dcNameFromFigureKey(combat.attackerFigureKey || '');
    if (_normName(atkName) === 'j4x-7') return false;
    return _friendlyWithAbilityNearTarget(game, combat, deps, {
      ability: 'supporting_fire', ownerPn: combat.attackerPlayerNum, excludeFigureKey: combat.attackerFigureKey,
    });
  },
});

// Air Support (Bodhi Rook) [attacker] — +2 Accuracy when a friendly figure
// spends a Power Token while attacking and the attacker is NOT Focused. Owner
// (Bodhi) need only be in play (board-wide). alexanbv 2026-05-13: the unfocused
// gate is the canonical card text.
registerCombatAbility({
  id: 'air_support', name: 'Air Support', windows: ['mods'], side: 'attacker', kind: 'passive',
  applies: (game, combat, side, deps) => {
    if (!combat.attackerFigureKey || !combat.attackerSpentPowerToken) return false;
    const atkConds = game.figureConditions?.[combat.attackerFigureKey] || [];
    if (atkConds.includes('Focus')) return false;
    // Bodhi (air_support_bodhi owner) need only be in play — board-wide, no range.
    const team = game.figurePositions?.[combat.attackerPlayerNum] || {};
    for (const fk of Object.keys(team)) {
      if (ids(eff(deps, dcNameFromFigureKey(fk))).includes('air_support_bodhi')) return true;
    }
    return false;
  },
});

// The General's Ranks (attachment) [attacker] — +1 Damage if it is NOT the
// owner's activation. "Not your activation" = the attacker's DC has no active
// activation thread (the inline detection: game.dcActionsData[msgId].threadId).
function _generalsRanksAttached(game, combat) {
  const msgId = combat.attackerMsgId;
  if (!msgId) return false;
  const atts = game.p1DcAttachments?.[msgId] || game.p2DcAttachments?.[msgId] || [];
  return cardNameIncludes(atts, "The General's Ranks");
}
registerCombatAbility({
  id: 'the_generals_ranks', name: "The General's Ranks", windows: ['mods'], side: 'attacker', kind: 'passive',
  applies: (game, combat) => {
    if (!_generalsRanksAttached(game, combat)) return false;
    return !(game.dcActionsData?.[combat.attackerMsgId]?.threadId); // not my activation
  },
});

// Fury (Wookiee Warrior Elite/Regular) [attacker] — +1 Surge if the attacker has
// suffered 5+ Damage. Suffered-damage derived from dcHealthState (deps) at the
// attacker's footprint, mirroring the retired inline computation.
function _attackerDamageSuffered(game, combat, deps) {
  const hs = deps?.dcHealthState;
  const msgId = combat.attackerMsgId;
  if (!hs || !msgId) return 0;
  const arr = hs.get(msgId) || [];
  const fi = game.dcActionsData?.[msgId]?.selectedFigure ?? combat.attackerFigureIndex ?? 0;
  const entry = arr[fi];
  if (!entry) return 0;
  // entry = [currentHp, maxHp] → suffered = max - current.
  return Math.max(0, (entry[1] ?? entry[0] ?? 0) - (entry[0] ?? 0));
}
registerCombatAbility({
  id: 'fury_wookiee', name: 'Fury', windows: ['mods'], side: 'attacker', kind: 'passive',
  applies: (game, combat, side, deps) => {
    const atkName = combat.attackerDcName || dcNameFromFigureKey(combat.attackerFigureKey || '');
    const sids = ids(eff(deps, atkName));
    if (!sids.includes('fury_wookiee_elite') && !sids.includes('fury_wookiee_reg')) return false;
    return _attackerDamageSuffered(game, combat, deps) >= 5;
  },
});
