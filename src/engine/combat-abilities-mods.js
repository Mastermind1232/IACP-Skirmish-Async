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
import { opponentPlayerNum } from '../game/player-helpers.js';
import { registerCombatAbility } from './combat-timing-registry.js';

const D = (deps, name, fallback) => (deps && deps[name]) || fallback;
function eff(deps, dcName) {
  const all = (D(deps, 'getDcEffects', _getDcEffects))() || {};
  return all[dcName] || all[(dcName || '').replace(/\s*\[.*\]\s*$/, '')] || null;
}
const ids = (e) => e?.specialAbilityIds || [];
const defenderPN = (combat) => combat.defenderPlayerNum ?? (combat.attackerPlayerNum ? opponentPlayerNum(combat.attackerPlayerNum) : null);

// ── Attacker mods ────────────────────────────────────────────────────────────

registerCombatAbility({
  id: 'pulse_cannon', name: 'Pulse Cannon', windows: ['mods'], side: 'attacker', kind: 'passive',
  applies: (game, combat, side, deps) => {
    if (!combat.attackerFigureKey || combat.pulseCannonResolved || !combat.attackerSpentPowerToken) return false;
    return ids(eff(deps, combat.attackerDcName || dcNameFromFigureKey(combat.attackerFigureKey))).includes('pulse_cannon_iden');
  },
});

registerCombatAbility({
  id: 'spray_fire', name: 'Spray Fire', windows: ['mods'], side: 'attacker', kind: 'interactive',
  applies: (game, combat, side, deps) => {
    if (!combat.attackerFigureKey || combat.sprayFireResolved) return false;
    return hasSprayFireAbility(ids(eff(deps, combat.attackerDcName || dcNameFromFigureKey(combat.attackerFigureKey))));
  },
});

registerCombatAbility({
  id: 'negotiate', name: 'Negotiate', windows: ['mods'], side: 'attacker',
  // <2 VP on defender → auto +2 (passive); defender can pay → they choose (interactive).
  kind: (game, combat) => {
    const pn = defenderPN(combat);
    const vp = (pn === 1 ? game.player1VP?.total : game.player2VP?.total) ?? 0;
    return vp < 2 ? 'passive' : 'interactive';
  },
  applies: (game, combat, side, deps) => {
    if (!combat.attackerFigureKey || combat.negotiateResolved) return false;
    return ids(eff(deps, combat.attackerDcName || dcNameFromFigureKey(combat.attackerFigureKey))).includes('negotiate_hondo');
  },
});

registerCombatAbility({
  id: 'call_the_shots', name: 'Call the Shots', windows: ['mods'], side: 'attacker', kind: 'interactive',
  applies: (game, combat, side, deps) => {
    if (combat.callTheShotsResolved || !combat.attackerFigureKey) return false;
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
    if (combat.heavyRepeaterResolved || !combat.attackerFigureKey) return false;
    const e = eff(deps, combat.attackerDcName || dcNameFromFigureKey(combat.attackerFigureKey));
    if (!ids(e).includes('heavy_repeater_paz')) return false;
    return e?.attack?.type === 'range' || combat.attackType === 'Ranged';
  },
});

// ── Defender mods ────────────────────────────────────────────────────────────

registerCombatAbility({
  id: 'agile', name: 'Agile', windows: ['mods'], side: 'defender', kind: 'interactive',
  applies: (game, combat, side, deps) => {
    if (combat.agileJetTrooperApplied || !combat.target?.figureKey) return false;
    if (!hasAgileAbility(ids(eff(deps, dcNameFromFigureKey(combat.target.figureKey))))) return false;
    return ((combat.defenseRoll?.block || 0) + (combat.bonusBlock || 0)) > 0;
  },
});

registerCombatAbility({
  id: 'query', name: 'Query', windows: ['mods'], side: 'defender', kind: 'interactive',
  applies: (game, combat) => !!combat.queryNeedsPrompt && !combat.queryResolved,
});

registerCombatAbility({
  id: 'crate_block_sink', name: 'Line of Fire (crate block)', windows: ['mods'], side: 'defender', kind: 'interactive',
  applies: (game, combat, side, deps) => {
    const fk = combat.target?.figureKey;
    if (combat.crateBlockSinkResolved || !fk) return false;
    if (!game?.selectedMission?.rules?.persistent?.crateBlockSink || !game.figureContraband?.[fk]) return false;
    const rawSize = D(deps, 'getFigureSize', _getFigureSize)?.(dcNameFromFigureKey(fk));
    const size = game.figureOrientations?.[fk] || rawSize;
    return Array.isArray(size) ? (size[0] === 1 && size[1] === 1) : true;
  },
});

registerCombatAbility({
  id: 'defensible', name: 'Defensible', windows: ['mods'], side: 'defender', kind: 'interactive',
  applies: (game, combat, side, deps) => {
    if (combat.defensibleResolved || !combat.target?.figureKey) return false;
    return ids(eff(deps, dcNameFromFigureKey(combat.target.figureKey))).includes('defensible_sc2m');
  },
});

registerCombatAbility({
  id: 'get_down', name: 'Get Down', windows: ['mods'], side: 'defender', kind: 'interactive',
  applies: (game, combat, side, deps) => {
    const fk = combat.target?.figureKey;
    if (combat.getDownResolved || !fk || !combat.attackerPlayerNum) return false;
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
  applies: (game, combat) => !!combat.elusiveActive && !combat.elusiveResolved && (combat.attackDiceResults?.length || 0) > 0,
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
