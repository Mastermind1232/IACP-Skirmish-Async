// Condition-predicate layer (alexanbv 2026-06-16: "even generic rr have a
// condition — the figure with that ability has to be the one attacking ... check
// condition then show button then resolve in order of player choice ... should
// apply for ALL abilities acting at a given timing instance").
//
// Every gate ability carries a condition {type, ...params}. At a timing instance
// the gate evaluates it against the LIVE attack to decide whether to offer the
// button. Parameterized + reusable across every timing window (on_declare,
// rerolls, special, mods, zillo, after_resolve) — one condition engine, repeated
// per timing. Auras matter: an ability on Luke's card can apply to Baze's attack,
// so conditions are evaluated relative to the attacker, not the card holder.

import { dcNameFromFigureKey } from '../game/index.js';
import { getMapData, getDcEffects, getFigureSize } from '../data-loader.js';
import { isWithinSpaces, hasLineOfSightByCoord } from '../game/spatial.js';
import { opponentPlayerNum } from '../game/player-helpers.js';
import { getFootprintCells, shiftCoord } from '../game/coords.js';
import { getEffectiveFigureSize } from '../game/board-helpers.js';
import { loadAbilitySpec } from './combat-ability-db.js';

/** All board cells a figure occupies (footprint), lowercased. */
function figureCells(game, pn, figureKey) {
  const pos = game?.figurePositions?.[pn]?.[figureKey];
  if (!pos) return [];
  const dcName = dcNameFromFigureKey(figureKey);
  const size = getEffectiveFigureSize(game, figureKey, dcName) || getFigureSize(dcName);
  return getFootprintCells(pos, size).map((c) => String(c).toLowerCase());
}

/** Normalize a DC name for comparison (strip the [variant] suffix, lowercase). */
const norm = (s) => String(s || '').replace(/\s*\[.*\]\s*$/, '').trim().toLowerCase();

/** The attacking figure's DC name for this combat. */
export function attackerDcName(combat) {
  return norm(combat?.attackerDcName || dcNameFromFigureKey(combat?.attackerFigureKey || ''));
}

/**
 * The figure an ability AFFECTS / who can use it — the ATTACKER for attacker-side
 * abilities, the DEFENDER (target) for defender-side. Auras/self are evaluated
 * relative to THIS figure (alexanbv 2026-06-16: Get Down is defender-side, so its
 * "within 2" centers on the defender, not the attacker).
 */
function affectedFigure(game, combat, side) {
  if (side === 'defender') {
    const pn = combat?.defenderPlayerNum ?? (combat?.attackerPlayerNum ? opponentPlayerNum(combat.attackerPlayerNum) : null);
    return { pn, figureKey: combat?.target?.figureKey };
  }
  return { pn: combat?.attackerPlayerNum, figureKey: combat?.attackerFigureKey };
}
function affectedDcName(game, combat, side) {
  if (side === 'defender') return norm(combat?.defenderDcName || dcNameFromFigureKey(combat?.target?.figureKey || ''));
  return attackerDcName(combat);
}
/** Keywords (UPPERCASE) of the affected figure (attacker or defender per side). */
function affectedKeywords(game, combat, side) {
  const fk = affectedFigure(game, combat, side).figureKey;
  const raw = side === 'defender' ? (combat?.defenderDcName || dcNameFromFigureKey(fk || '')) : (combat?.attackerDcName || dcNameFromFigureKey(fk || ''));
  const all = getDcEffects() || {};
  const e = all[raw] || all[norm(raw)];
  return (e?.keywords || []).map((k) => String(k).toUpperCase());
}

/** The target SPACE (coord, lowercased) for this combat — explicit coord, else the target figure's head cell. */
function targetCoord(game, combat) {
  if (combat?.target?.coord) return String(combat.target.coord).toLowerCase();
  const dPn = combat?.defenderPlayerNum ?? (combat?.attackerPlayerNum ? opponentPlayerNum(combat.attackerPlayerNum) : null);
  const fk = combat?.target?.figureKey;
  const pos = (dPn != null && fk) ? game?.figurePositions?.[dPn]?.[fk] : null;
  return pos ? String(pos).toLowerCase() : null;
}
/** The attacker's CURRENT head cell (coord, lowercased). */
function attackerCoord(game, combat) {
  const pos = game?.figurePositions?.[combat?.attackerPlayerNum]?.[combat?.attackerFigureKey];
  return pos ? String(pos).toLowerCase() : null;
}
/** Keywords (UPPERCASE) of a figure by its figureKey. */
function figureKeywords(fk) {
  const e = (getDcEffects() || {})[dcNameFromFigureKey(fk)] || (getDcEffects() || {})[norm(dcNameFromFigureKey(fk))];
  return (e?.keywords || []).map((k) => String(k).toUpperCase());
}

/**
 * Build a condition predicate `(game, combat) => boolean` from a spec
 * `{ type, ...params }`. Unknown/empty types default to always-true so an
 * ability is at worst offered (never silently dropped); real predicates narrow
 * it. Known types:
 *  - always                  : no extra condition.
 *  - attacker_is_self {card} : the ability's figure is the one attacking (the
 *                              base condition for every "self" ability).
 *  - spent_power_token       : a Power Token was spent on this attack (Ko-Tun).
 */
export function makeCondition(spec) {
  if (!spec || !spec.type) return () => true;
  switch (spec.type) {
    case 'always':
      return () => true;
    case 'attacker_is_self': {
      // The AFFECTED figure (attacker for attacker-side, defender for
      // defender-side) is a figure of the ability's card.
      const card = norm(spec.card);
      const side = spec.side || 'attacker';
      return (game, combat) => affectedDcName(game, combat, side) === card;
    }
    case 'spent_power_token':
      return (game, combat) => !!combat?.attackerSpentPowerToken;
    // Aura: emanates from the OWNER figure (the card's figure on the board), NOT
    // the attacker/defender (alexanbv 2026-06-16). Usable iff ANY SQUARE of the
    // affected figure (attacker for attacker-side abilities, defender for
    // defender-side) is within N of ANY SQUARE of an owner figure — i.e. the
    // affected figure is inside the owner's aura.
    case 'within_n_of_source': {
      const card = norm(spec.card);
      const n = spec.n ?? 3;
      const side = spec.side || 'attacker';
      return (game, combat) => {
        const aff = affectedFigure(game, combat, side);
        const mapId = game?.selectedMap?.id;
        if (!aff.figureKey || aff.pn == null || !mapId) return false;
        const mapSp = getMapData(mapId);
        if (!mapSp) return false;
        const affCells = figureCells(game, aff.pn, aff.figureKey);
        if (!affCells.length) return false;
        // Owner figures of the card on the affected figure's team (beneficial
        // auras are friendly — owner and affected share a team).
        const team = game.figurePositions?.[aff.pn] || {};
        for (const fk of Object.keys(team)) {
          if (norm(dcNameFromFigureKey(fk)) !== card) continue;
          for (const oc of figureCells(game, aff.pn, fk)) {
            for (const ac of affCells) if (isWithinSpaces(mapSp, oc, ac, n)) return true;
          }
        }
        return false;
      };
    }
    // Group: the affected figure is a figure of the owner's group (same card).
    case 'in_group_of_source': {
      const card = norm(spec.card);
      const side = spec.side || 'attacker';
      return (game, combat) => affectedDcName(game, combat, side) === card;
    }
    // Adjacent = within 1 of an owner figure (special-case of the range aura).
    case 'adjacent_to_source':
      return makeCondition({ type: 'within_n_of_source', card: spec.card, n: 1, side: spec.side });
    // The attacking figure has a given keyword (e.g. "friendly TROOPER" abilities).
    case 'attacker_has_keyword': {
      const kw = String(spec.keyword || '').toUpperCase();
      return (game, combat) => {
        const e = (getDcEffects() || {})[combat?.attackerDcName] || (getDcEffects() || {})[norm(combat?.attackerDcName)];
        return (e?.keywords || []).map((k) => String(k).toUpperCase()).includes(kw);
      };
    }
    // The attacking figure carries a Device token (Saska's Power Converter is
    // usable by ANY friendly token-bearer, not just Saska). Tokens live in
    // game.deviceTokens[figureKey] and persist even if Saska is defeated.
    case 'attacker_has_device_token':
      return (game, combat) => (game?.deviceTokens?.[combat?.attackerFigureKey] || 0) > 0;
    // A token was spent on this attack (any), or a specific type.
    case 'spent_any_token':
      return (game, combat) => !!(combat?.attackerSpentPowerToken || combat?.attackerSpentToken || combat?.spentTokenThisAttack);
    // The AFFECTED figure has a given keyword ("friendly TROOPER within N", etc.).
    case 'affected_has_keyword': {
      const kw = String(spec.keyword || '').toUpperCase();
      const side = spec.side || 'attacker';
      return (game, combat) => affectedKeywords(game, combat, side).includes(kw);
    }
    // The AFFECTED figure is SMALL — i.e. not LARGE/MASSIVE ("a small figure within N").
    case 'affected_is_small': {
      const side = spec.side || 'attacker';
      return (game, combat) => {
        const kws = affectedKeywords(game, combat, side);
        return !kws.includes('LARGE') && !kws.includes('MASSIVE');
      };
    }
    // The AFFECTED figure (attacker or defender per side) is ADJACENT to ANOTHER
    // friendly figure (a teammate other than itself) — "while adjacent to a
    // friendly figure" (Cower). Optionally the friendly must carry a KEYWORD
    // ("another friendly TROOPER", Squad Training) and/or an AFFILIATION (Bespin
    // Security's "SCUM TROOPER"). Adjacency = within 1 of any cell, footprint-aware.
    case 'affected_adjacent_to_friendly': {
      const side = spec.side || 'attacker';
      const kw = spec.keyword ? String(spec.keyword).toUpperCase() : null;
      const affil = spec.affiliation ? norm(spec.affiliation) : null;
      return (game, combat) => {
        const aff = affectedFigure(game, combat, side);
        const mapId = game?.selectedMap?.id;
        if (!aff.figureKey || aff.pn == null || !mapId) return false;
        const mapSp = getMapData(mapId);
        if (!mapSp) return false;
        const affCells = figureCells(game, aff.pn, aff.figureKey);
        if (!affCells.length) return false;
        const team = game.figurePositions?.[aff.pn] || {};
        const all = getDcEffects() || {};
        for (const fk of Object.keys(team)) {
          if (fk === aff.figureKey) continue; // "another" — exclude self
          if (kw || affil) {
            const dc = dcNameFromFigureKey(fk);
            const e = all[dc] || all[norm(dc)];
            if (kw && !((e?.keywords || []).map((k) => String(k).toUpperCase()).includes(kw))) continue;
            if (affil && norm(e?.affiliation) !== affil) continue;
          }
          for (const oc of figureCells(game, aff.pn, fk)) {
            for (const ac of affCells) if (isWithinSpaces(mapSp, oc, ac, 1)) return true;
          }
        }
        return false;
      };
    }
    // The ATTACKER and the TARGET (defender) are ADJACENT — "attacking or
    // defending against an adjacent figure" (Precision). Footprint-aware,
    // side-independent (both attacker & defender rows want attacker↔target ≤1).
    case 'attacker_target_adjacent': {
      return (game, combat) => {
        const mapId = game?.selectedMap?.id;
        if (!mapId) return false;
        const mapSp = getMapData(mapId);
        if (!mapSp) return false;
        const aPn = combat?.attackerPlayerNum;
        const dPn = combat?.defenderPlayerNum ?? (aPn ? opponentPlayerNum(aPn) : null);
        const aFk = combat?.attackerFigureKey;
        const dFk = combat?.target?.figureKey;
        if (aPn == null || dPn == null || !aFk || !dFk) return false;
        const aCells = figureCells(game, aPn, aFk);
        const dCells = figureCells(game, dPn, dFk);
        if (!aCells.length || !dCells.length) return false;
        for (const ac of aCells) for (const dc of dCells) if (isWithinSpaces(mapSp, ac, dc, 1)) return true;
        return false;
      };
    }
    // The DEFENDER spent a Block (symbol/token) during this attack (Survival is
    // Strength). The pipeline sets combat.defenderSpentBlock when a Block is spent.
    case 'defender_spent_block':
      return (game, combat) => !!combat?.defenderSpentBlock;
    // The AFFECTED figure carries a keyword AND (optionally) an affiliation —
    // "SCUM TROOPER" = TROOPER keyword + Scum affiliation (Bespin Security).
    case 'affected_has_keyword_affiliation': {
      const side = spec.side || 'attacker';
      const kw = String(spec.keyword || '').toUpperCase();
      const affil = norm(spec.affiliation);
      return (game, combat) => {
        if (!affectedKeywords(game, combat, side).includes(kw)) return false;
        const dc = affectedFigure(game, combat, side).figureKey;
        const raw = side === 'defender' ? (combat?.defenderDcName || dcNameFromFigureKey(dc || '')) : (combat?.attackerDcName || dcNameFromFigureKey(dc || ''));
        const e = (getDcEffects() || {})[raw] || (getDcEffects() || {})[norm(raw)];
        return norm(e?.affiliation) === affil;
      };
    }
    // Disjunction of affected-figure filters — "a friendly LEADER or SCUM TROOPER"
    // (Bespin Security). spec.preds is an array of {type,...} sub-specs; usable iff
    // ANY holds.
    case 'affected_keyword_any': {
      const preds = (spec.preds || []).map((p) => makeCondition(p));
      return (game, combat) => preds.some((p) => p(game, combat));
    }
    // ── LINE-OF-SIGHT auras (gate-rework 2026-06-18) — reusable LOS-gated
    // conditions modeled with hasLineOfSightByCoord (footprint-aware, blocked by
    // figures/terrain). Each scans the attacker's friendly team for an owner
    // figure that satisfies a keyword + an LOS relation. ────────────────────────
    //
    // A friendly figure (optionally with KEYWORD) has LOS to the ATTACKER —
    // "a friendly HUNTER in your line of sight" (Coordinated Hunt). When
    // includeSelf is true the attacking figure itself counts (its own ability).
    case 'friendly_with_los_to_attacker': {
      const kw = spec.keyword ? String(spec.keyword).toUpperCase() : null;
      const includeSelf = spec.includeSelf !== false;
      return (game, combat) => {
        const mapId = game?.selectedMap?.id;
        if (!mapId) return false;
        const mapSp = getMapData(mapId);
        const atkPos = attackerCoord(game, combat);
        if (!mapSp || !atkPos) return false;
        const team = game.figurePositions?.[combat?.attackerPlayerNum] || {};
        for (const [fk, pos] of Object.entries(team)) {
          if (!pos) continue;
          const isSelf = fk === combat?.attackerFigureKey;
          if (isSelf && !includeSelf) continue;
          if (kw && !figureKeywords(fk).includes(kw)) continue;
          if (isSelf) return true; // the attacker trivially "has LOS" to itself
          if (hasLineOfSightByCoord(game, String(pos).toLowerCase(), atkPos, mapSp, getFigureSize)) return true;
        }
        return false;
      };
    }
    // A friendly figure (optionally with KEYWORD) within N of the attacker AND
    // with LOS to the TARGET SPACE — "a friendly DROID within 3 has LOS to the
    // target space" (Shared Calculations, Shared Intuition). `excludeSelf`
    // (default true) excludes the attacking figure ("another friendly …").
    case 'friendly_within_n_with_los_to_target': {
      const kw = spec.keyword ? String(spec.keyword).toUpperCase() : null;
      const n = spec.n ?? 3;
      const excludeSelf = spec.excludeSelf !== false;
      return (game, combat) => {
        const mapId = game?.selectedMap?.id;
        if (!mapId) return false;
        const mapSp = getMapData(mapId);
        const atkPos = attackerCoord(game, combat);
        const tgt = targetCoord(game, combat);
        if (!mapSp || !atkPos || !tgt) return false;
        const team = game.figurePositions?.[combat?.attackerPlayerNum] || {};
        for (const [fk, pos] of Object.entries(team)) {
          if (!pos) continue;
          if (excludeSelf && fk === combat?.attackerFigureKey) continue;
          if (kw && !figureKeywords(fk).includes(kw)) continue;
          if (!isWithinSpaces(mapSp, String(pos).toLowerCase(), atkPos, n)) continue;
          if (hasLineOfSightByCoord(game, String(pos).toLowerCase(), tgt, mapSp, getFigureSize)) return true;
        }
        return false;
      };
    }
    // The TARGET did NOT have LOS to the attacker at the START of the attacker's
    // activation — "if the target did not have LOS to you at the start of your
    // activation" (Light It Up). Snapshot = the attacker's stashed
    // activationStartPositions cell. CRITICAL: the LOS must use the TARGET'S
    // position AT THE ATTACKER'S ACTIVATION START, not its current cell (the
    // target may have moved between then and the attack). We read the target's
    // start position from game.activationStartAllPositions (a board-wide snapshot
    // refreshed at each activation start; see activation-setup.js B11). Falls back
    // to the target's current cell only when no snapshot exists (legacy games).
    case 'target_no_los_to_attacker_start': {
      return (game, combat) => {
        const mapId = game?.selectedMap?.id;
        if (!mapId) return false;
        const mapSp = getMapData(mapId);
        const startPos = game?.activationStartPositions?.[combat?.attackerFigureKey];
        const tgtFk = combat?.target?.figureKey;
        const tgtStart = (tgtFk && game?.activationStartAllPositions?.[tgtFk])
          ? String(game.activationStartAllPositions[tgtFk]).toLowerCase()
          : targetCoord(game, combat);
        if (!mapSp || !startPos || !tgtStart) return false;
        return !hasLineOfSightByCoord(game, tgtStart, String(startPos).toLowerCase(), mapSp, getFigureSize);
      };
    }
    // The AFFECTED figure (defender side) SHARES A CORNER OR EDGE with a space
    // whose terrain is one of `types` — "while you share a corner or edge with a
    // space containing blocking / impassable / difficult terrain" (Hunker Down).
    // NB: uses GEOMETRIC 8-neighbours (corner + edge), NOT the movement-adjacency
    // map — the map's `adjacency` deliberately EXCLUDES blocking/impassable cells
    // (you can't move into them), so it would never see the terrain the card asks
    // about. Reusable terrain-proximity primitive; `types` lowercased.
    case 'near_terrain_type': {
      const side = spec.side || 'defender';
      const types = (spec.types || []).map((t) => String(t).toLowerCase());
      return (game, combat) => {
        const aff = affectedFigure(game, combat, side);
        const mapId = game?.selectedMap?.id;
        if (!aff.figureKey || aff.pn == null || !mapId) return false;
        const mapSp = getMapData(mapId);
        if (!mapSp) return false;
        const terrain = mapSp.terrain || {};
        const affCells = figureCells(game, aff.pn, aff.figureKey);
        if (!affCells.length) return false;
        const affSet = new Set(affCells);
        for (const c of affCells) {
          for (let dx = -1; dx <= 1; dx++) {
            for (let dy = -1; dy <= 1; dy++) {
              if (dx === 0 && dy === 0) continue;
              const n = String(shiftCoord(c, dx, dy)).toLowerCase();
              if (affSet.has(n)) continue; // a cell the figure itself occupies
              if (types.includes(String(terrain[n] || '').toLowerCase())) return true;
            }
          }
        }
        return false;
      };
    }
    // The AFFECTED figure (defender side) is ADJACENT to a map OBJECT (crate, door,
    // …) OR to a NON-FRIENDLY figure OTHER THAN THE ATTACKER — "while adjacent to
    // an object or non-friendly figure other than the attacker" (Improvised Cover).
    // Objects live in game.objectPositions (keyed objId → coord). Non-friendly =
    // any figure not on the affected figure's team. Adjacency = within 1, footprint-
    // aware.
    case 'affected_adjacent_to_object_or_enemy': {
      const side = spec.side || 'defender';
      return (game, combat) => {
        const aff = affectedFigure(game, combat, side);
        const mapId = game?.selectedMap?.id;
        if (!aff.figureKey || aff.pn == null || !mapId) return false;
        const mapSp = getMapData(mapId);
        if (!mapSp) return false;
        const affCells = figureCells(game, aff.pn, aff.figureKey);
        if (!affCells.length) return false;
        // Objects (crates/doors/etc.) from the unified objectPositions state.
        for (const pos of Object.values(game.objectPositions || {})) {
          if (!pos) continue;
          const oc = String(pos).toLowerCase();
          for (const ac of affCells) if (isWithinSpaces(mapSp, oc, ac, 1)) return true;
        }
        // Non-friendly figures (the attacker is excluded by figureKey).
        const attackerFk = combat?.attackerFigureKey;
        for (const [pn, team] of Object.entries(game.figurePositions || {})) {
          if (Number(pn) === Number(aff.pn)) continue; // friendly team — skip
          for (const fk of Object.keys(team)) {
            if (fk === attackerFk) continue; // "other than the attacker"
            for (const ec of figureCells(game, Number(pn), fk)) {
              for (const ac of affCells) if (isWithinSpaces(mapSp, ec, ac, 1)) return true;
            }
          }
        }
        return false;
      };
    }
    // The TARGET (defender) carries the attacker's Recon token — "attacking a
    // figure with a Recon token" (Set Your Sights / Loku). Recon tokens are
    // OWNER-keyed: post-deploy placement writes game.reconTokens[playerNum] =
    // { figureKey } (handlers/post-deploy.js handleSetYourSightsPick), so each
    // player keeps a separate token (mirror matches). The condition fires only
    // when the attacking player's own token sits on the target figure — matching
    // the live inline path (handlers/combat.js handleAttackTarget).
    case 'target_has_recon_token': {
      return (game, combat) => {
        const pn = combat?.attackerPlayerNum;
        const tfk = combat?.target?.figureKey;
        if (!pn || !tfk) return false;
        return game?.reconTokens?.[pn]?.figureKey === tfk;
      };
    }
    default:
      return () => true;
  }
}

/**
 * Guard predicate from the CSV `conditional` column (ANDed with the affects-based
 * usability). Data-derived per type; unknown prose → no extra restriction (the
 * affects-based check already scoped usage). One sub-method per recognised guard.
 * `row` (optional) carries the CSV row so side-sensitive guards (adjacency to the
 * AFFECTED figure) know which figure to center on; falls back to attacker side.
 */
export function conditionalGuard(conditional, card, row) {
  const s = String(conditional || '').toLowerCase();
  if (!s || s === 'none') return () => true;
  const side = (row?.attack_side === 'defender') ? 'defender' : 'attacker';
  if (/spend (a|any|1).*token|after you spend|spent a.*token|power token/.test(s)) return makeCondition({ type: 'spent_any_token' });
  // target space is N or more / fewer spaces away (ranged sniper conditions).
  const dm = s.match(/target space is (\d+) or more/);
  if (dm) {
    const n = parseInt(dm[1], 10) || 0;
    return (game, combat) => (combat?.distanceToTarget ?? 0) >= n;
  }
  if (/did not (perform|make) an attack this activation/.test(s)) {
    return (game, combat) => !(game?.attackPerformedThisActivation?.[combat?.attackerFigureKey]);
  }
  if (/device token/.test(s)) return makeCondition({ type: 'attacker_has_device_token' });
  // "spent a Block symbol during this attack" (Survival is Strength).
  if (/spent a block/.test(s)) return makeCondition({ type: 'defender_spent_block' });
  // "attacking or defending against an adjacent figure" (Precision) — the attacker
  // and the target must be adjacent.
  if (/against an adjacent figure/.test(s)) return makeCondition({ type: 'attacker_target_adjacent' });
  // "adjacent to another friendly TROOPER" (Squad Training) — the affected figure
  // adjacent to another friendly figure with the named keyword. Check BEFORE the
  // generic "adjacent to a friendly figure" so the keyword filter is applied.
  const adjKw = s.match(/adjacent to (?:another |a )?friendly (trooper|droid|leader|hunter|wookiee|spy|brawler|guardian|creature|smuggler|vehicle|mobile)/);
  if (adjKw) return makeCondition({ type: 'affected_adjacent_to_friendly', keyword: adjKw[1].toUpperCase(), side });
  // "adjacent to a friendly figure" (Cower).
  if (/adjacent to (?:a )?friendly figure/.test(s)) return makeCondition({ type: 'affected_adjacent_to_friendly', side });
  return () => true; // unmodeled prose → no extra restriction yet (TODO: graduate)
}

/**
 * Usage-LIMIT guard from the CSV `limit` column (alexanbv 2026-06-16: "also check
 * the column that marks if it is an exhaust, once per activation, once per round
 * ... AFTER the check of self and others. An ability could have both a range
 * restriction AND a once per round restriction"). Checks the not-yet-used state;
 * the resolver marks usage with the same key when the ability fires.
 *  - "… per attack"      → combat._abilityUsedThisAttack[key]
 *  - "… per round" / "this round" → game.roundAbilityUsed[fig:key]
 *  - "… per activation"  → game.activationAbilityUsed[fig:key]
 * Durations ("until end of round") are not usage limits → no restriction.
 */
export function limitGuard(limit, abilityKey) {
  const s = String(limit || '').toLowerCase();
  if (!s || s === 'none') return () => true;
  // Keyed by the OWNER (the ability's card+ability identity), per alexanbv
  // 2026-06-16 — the pipeline marks game.roundAbilityUsed[abilityKey] after the
  // ability resolves; the same key is checked here.
  if (s.includes('per attack')) {
    return (game, combat) => !(combat?._abilityUsedThisAttack?.[abilityKey]);
  }
  if (s.includes('per round') || s.includes('this round')) {
    return (game) => !(game?.roundAbilityUsed?.[abilityKey]);
  }
  if (s.includes('per activation') || s.includes('your activation')) {
    return (game) => !(game?.activationAbilityUsed?.[abilityKey]);
  }
  return () => true; // "until end of round" etc. are durations, not usage limits
}

/** The owner-keyed usage key for an ability ({card}:{ability}). */
export function abilityLimitKey(card, ability) {
  return `${card}:${ability}`;
}

/**
 * Mark an ability used for its limit scope (called by the pipeline AFTER the
 * ability's button resolves), keyed by owner. alexanbv 2026-06-16: "once a button
 * corresponding to a once/round ability is clicked, after that resolution is
 * complete, the ability should be added to the used list."
 */
export function markAbilityUsed(game, combat, { card, ability, limit }) {
  const s = String(limit || '').toLowerCase();
  if (!s || s === 'none') return;
  const key = abilityLimitKey(card, ability);
  if (s.includes('per attack')) { combat._abilityUsedThisAttack = combat._abilityUsedThisAttack || {}; combat._abilityUsedThisAttack[key] = true; }
  else if (s.includes('per round') || s.includes('this round')) { game.roundAbilityUsed = game.roundAbilityUsed || {}; game.roundAbilityUsed[key] = true; }
  else if (s.includes('per activation') || s.includes('your activation')) { game.activationAbilityUsed = game.activationAbilityUsed || {}; game.activationAbilityUsed[key] = true; }
}

/**
 * Sub-method for the "others" axis: a predicate for whether the ATTACKER is in an
 * ability's affects_others set, derived (owner-centric) from the CSV
 * affects_others prose. Returns null when the others-set can't grant the attacker
 * usage (e.g. it targets enemies). One small sub-method per condition type.
 */
/** Keyword/size constraint on the AFFECTED figure from affects_others prose, or null. */
function affectedFilter(s, side) {
  if (/\bsmall\b/.test(s)) return makeCondition({ type: 'affected_is_small', side });
  // "LEADER or SCUM TROOPER" (Bespin Security) — a disjunction where the second
  // branch is keyword TROOPER + Scum affiliation. Match before the single-keyword
  // loop so the "or" isn't collapsed to just LEADER.
  if (/leader or scum trooper/.test(s)) {
    return makeCondition({ type: 'affected_keyword_any', preds: [
      { type: 'affected_has_keyword', keyword: 'LEADER', side },
      { type: 'affected_has_keyword_affiliation', keyword: 'TROOPER', affiliation: 'Scum', side },
    ] });
  }
  for (const kw of ['trooper', 'droid', 'vehicle', 'mobile', 'wookiee', 'hunter', 'leader', 'spy', 'brawler', 'guardian', 'creature', 'smuggler']) {
    if (new RegExp(`\\b${kw}\\b`).test(s)) return makeCondition({ type: 'affected_has_keyword', keyword: kw.toUpperCase(), side });
  }
  return null;
}

function othersPredicate(affectsOthers, ownerCard, side) {
  const s = String(affectsOthers || '').toLowerCase();
  if (!s || s === 'none') return null;
  const wm = s.match(/within\s+(\d+)/);
  const range = wm
    ? makeCondition({ type: 'within_n_of_source', card: ownerCard, n: parseInt(wm[1], 10) || 3, side })
    : (s.includes('adjacent') ? makeCondition({ type: 'adjacent_to_source', card: ownerCard, side }) : null);
  if (range) {
    // AND the affected-figure keyword/size filter ("a small figure within 2",
    // "friendly TROOPER within N") so the aura only grants to matching figures.
    const filter = affectedFilter(s, side);
    return filter ? (game, combat) => range(game, combat) && filter(game, combat) : range;
  }
  if (s.includes('group')) return makeCondition({ type: 'in_group_of_source', card: ownerCard, side });
  return null; // enemy-/unmodeled-targeting others → no usability grant
}

/**
 * Build an ability's usability condition from a CSV row in the recommended order:
 * check "self" FIRST (affects_self → the attacker is the owner) THEN "others"
 * (affects_others → the attacker is in the owner-centric affected set). Usable iff
 * either holds — so one self-method + a few others-sub-methods covers self-only /
 * others-only / both, instead of N×M combined functions (alexanbv 2026-06-16).
 * Reusable at EVERY timing instance, not just combat.
 */
/**
 * Build the usability condition for a card's ability at a spec timing, looked up
 * from the CSV — so a previously hand-wired ability can use the SAME generic
 * conditionForRow detection (alexanbv "all abilities should use this generic
 * logic"). Falls back to always-true when no matching row exists.
 */
export function conditionForCard(card, timing) {
  const rows = loadAbilitySpec().get(String(card || '').toLowerCase()) || [];
  const row = rows.find((r) => r.timing === timing);
  return row ? conditionForRow(row) : () => true;
}

export function conditionForRow(row) {
  const side = (row?.attack_side === 'defender') ? 'defender' : 'attacker';
  const affectsSelf = String(row?.affects_self).toUpperCase() === 'TRUE';
  const selfPred = affectsSelf ? makeCondition({ type: 'attacker_is_self', card: row.card, side }) : null;
  const othersPred = othersPredicate(row?.affects_others, row?.card, side);
  const guard = conditionalGuard(row?.conditional, row?.card, row);
  const limit = limitGuard(row?.limit, `${row?.card}:${row?.ability}`);
  return (game, combat) => {
    // self FIRST, then others — usable iff the attacker is in the affected set …
    const usable = (selfPred && selfPred(game, combat)) || (othersPred && othersPred(game, combat));
    if (!usable) return false;
    // … then (AFTER self/others) the conditional-column guard AND the usage-LIMIT
    // guard (exhaust / once per round / activation / attack). An ability can carry
    // both a range restriction and a once-per-round restriction.
    if (!guard(game, combat)) return false;
    return limit(game, combat);
  };
}
