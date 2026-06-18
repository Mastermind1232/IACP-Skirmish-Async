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
import { opponentPlayerNum, getDcList } from '../game/player-helpers.js';
import { registerCombatAbility } from './combat-timing-registry.js';
import { hasPendingModifiers } from './combat-pending-modifiers.js';

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

// ── Defender mods ────────────────────────────────────────────────────────────

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

// Aim (Rebel Trooper) — CARD PENDING IACP CHANGE (alexanbv 2026-06-16: "rebel
// trooper E card has been changed. Ignore that ability for now"). Not wired
// until the new text lands. See cards-pending-change.js.

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
