/**
 * Rules Invariants: runtime rules-correctness checks for headless training.
 *
 * Two entry points:
 *   1. assertPreActionInvariants(game, actions, context)  — after getAvailableActions, before selection
 *   2. assertPostActionInvariants(game, preSnapshot, action, context) — after handler execution
 *
 * Each returns an array of structured violation records. Empty = all pass.
 *
 * Design:
 *   - Observe-only: never mutates game state, never halts training
 *   - Reuses flow-invariant GS-2/GS-5/GS-6/GS-7 logic where appropriate
 *   - Excludes Discord-surface checks (DS-*) — not relevant to training
 *   - Each violation includes domain, severity, context for debugging
 */

import { isConditionImmune, HARMFUL_CONDITIONS } from '../../src/game/conditions.js';
import { parseCoord } from '../../src/game/coords.js';

// ── Severity levels ────────────────────────────────────────────────────────
// critical: engine is provably in an illegal state (HP<=0 on board, VP math wrong)
// high:     surfaced action references nonexistent entity (ghost target, invalid coord)
// medium:   state inconsistency that may or may not affect play (stale flags, count mismatch)
// low:      suspicious but possibly benign (immune figure with condition, etc.)
const SEVERITY = { CRITICAL: 'critical', HIGH: 'high', MEDIUM: 'medium', LOW: 'low' };

// ── Domains ────────────────────────────────────────────────────────────────
const DOMAIN = {
  ACTION_SURFACING: 'D1:action_surfacing',
  MOVEMENT:         'D2:movement',
  COMBAT:           'D3:combat',
  CONDITIONS:       'D4:conditions',
  DEFEAT:           'D5:defeat_cleanup',
  LIFECYCLE:        'D7:round_lifecycle',
  VP:               'D8:vp_mission',
};

// ── Helpers ────────────────────────────────────────────────────────────────

function violation(id, severity, domain, message, game, extra = {}) {
  return {
    id,
    severity,
    domain,
    message,
    phase: game?.phase || '?',
    roundPhase: game?.roundPhase || '?',
    round: game?.currentRound || 0,
    ...extra,
  };
}

/** Check if a figure key is present in figurePositions for any player. */
function figureExistsOnBoard(game, figureKey) {
  for (const pn of [1, 2]) {
    if (game.figurePositions?.[pn]?.[figureKey]) return true;
  }
  return false;
}

/** Get all alive figure keys across both players. */
function getAllAliveFigureKeys(game) {
  const keys = [];
  for (const pn of [1, 2]) {
    const pos = game.figurePositions?.[pn];
    if (!pos) continue;
    for (const fk of Object.keys(pos)) {
      if (pos[fk]) keys.push({ figureKey: fk, playerNum: pn });
    }
  }
  return keys;
}

/**
 * Look up current HP for a figure via dcHealthState + dcMessageMeta.
 *
 * Figure key format: "DcName-dgIndex-figureIndex" (dgIndex = dcList position).
 * msgId format: "hl{playerNum}dc{dcListIndex}".
 * dcHealthState: Map<msgId, [[hp, maxHp], ...]>.
 * dcMessageMeta: Map<msgId, { dcName, playerNum, ... }>.
 *
 * Returns hp number, or null if unavailable.
 */
function getFigureHp(figureKey, playerNum, dcHealthState, dcMessageMeta) {
  if (!dcHealthState || !dcMessageMeta) return null;
  // Parse figureKey: last two segments are "-dgIndex-figureIndex"
  const parts = figureKey.split('-');
  if (parts.length < 3) return null;
  const figureIndex = parseInt(parts[parts.length - 1], 10);
  const dgIndex = parseInt(parts[parts.length - 2], 10);
  if (isNaN(figureIndex) || isNaN(dgIndex)) return null;

  // msgId is deterministic: "hl{playerNum}dc{dgIndex}"
  const msgId = `hl${playerNum}dc${dgIndex}`;
  const healthArr = dcHealthState.get(msgId);
  if (!healthArr || !Array.isArray(healthArr[figureIndex])) return null;
  return healthArr[figureIndex][0]; // currentHp
}

/** Get the map spaces set for the current game. Returns null if unavailable. */
function getMapSpaceSet(game) {
  const spaces = game?.selectedMap?.spaces;
  if (!spaces) return null;
  if (spaces instanceof Set) return spaces;
  if (Array.isArray(spaces)) return new Set(spaces.map(s => String(s).toLowerCase()));
  // Object with keys
  if (typeof spaces === 'object') return new Set(Object.keys(spaces).map(s => s.toLowerCase()));
  return null;
}

// ── Snapshot for post-action comparison ────────────────────────────────────

/**
 * Capture a lightweight snapshot of game state before handler execution.
 * Used by post-action invariants to detect handler-introduced corruption.
 */
export function snapshotPreAction(game) {
  const figureKeys = {};
  for (const pn of [1, 2]) {
    figureKeys[pn] = new Set(Object.keys(game.figurePositions?.[pn] || {}));
  }
  return {
    round: game.currentRound || 0,
    p1VpTotal: game.player1VP?.total ?? 0,
    p1VpKills: game.player1VP?.kills ?? 0,
    p1VpObjectives: game.player1VP?.objectives ?? 0,
    p2VpTotal: game.player2VP?.total ?? 0,
    p2VpKills: game.player2VP?.kills ?? 0,
    p2VpObjectives: game.player2VP?.objectives ?? 0,
    figureKeys,
    p1ActivationsRemaining: game.p1ActivationsRemaining ?? 0,
    p2ActivationsRemaining: game.p2ActivationsRemaining ?? 0,
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// PRE-ACTION INVARIANTS
// Called after getAvailableActions, before action selection.
// ═══════════════════════════════════════════════════════════════════════════

export function assertPreActionInvariants(game, actions, context = {}) {
  if (!game || game.ended) return [];
  const errors = [];
  const { dcHealthState, dcMessageMeta } = context;

  // RT-1: No alive figure on board has HP <= 0
  // Domain: D5 (defeat/cleanup). Severity: critical.
  // If a figure is on the board with 0 HP, processFigureDefeat was skipped.
  for (const { figureKey, playerNum } of getAllAliveFigureKeys(game)) {
    const hp = getFigureHp(figureKey, playerNum, dcHealthState, dcMessageMeta);
    if (hp !== null && hp <= 0) {
      errors.push(violation('RT-1', SEVERITY.CRITICAL, DOMAIN.DEFEAT,
        `Figure ${figureKey} (P${playerNum}) on board with HP=${hp}`,
        game, { contextType: 'pre_action', figureKey, playerNum, hp }));
    }
  }

  // RT-2: Every attack_target action references a target figure that exists on the board
  // Domain: D1 (action surfacing). Severity: high.
  for (const a of actions) {
    if (a.type !== 'attack_target') continue;
    const targetFk = a.params?.targetFigureKey;
    if (!targetFk) continue; // already filtered by train.js
    // NPC targets (npc_krykna, npc_thug) don't use figurePositions
    if (targetFk.startsWith('npc_')) continue;
    if (!figureExistsOnBoard(game, targetFk)) {
      errors.push(violation('RT-2', SEVERITY.HIGH, DOMAIN.ACTION_SURFACING,
        `attack_target references ghost figure ${targetFk}`,
        game, { contextType: 'pre_action', targetFigureKey: targetFk }));
    }
  }

  // RT-3: move_pick_space actions reference valid map coordinates
  // Domain: D2 (movement). Severity: high.
  // Only check if map space data is available.
  const mapSpaces = getMapSpaceSet(game);
  if (mapSpaces && mapSpaces.size > 0) {
    for (const a of actions) {
      if (a.type !== 'move_pick_space') continue;
      const coord = a.params?.coord;
      if (!coord || a.params?.done) continue; // "finish movement" has no coord or done=true
      const normalized = String(coord).toLowerCase();
      const parsed = parseCoord(normalized);
      if (parsed.col < 0 || parsed.row < 0) {
        errors.push(violation('RT-3', SEVERITY.HIGH, DOMAIN.MOVEMENT,
          `move_pick_space has unparseable coord "${coord}"`,
          game, { contextType: 'pre_action', coord }));
      } else if (!mapSpaces.has(normalized)) {
        errors.push(violation('RT-3', SEVERITY.HIGH, DOMAIN.MOVEMENT,
          `move_pick_space coord "${coord}" not in map space set (${mapSpaces.size} spaces)`,
          game, { contextType: 'pre_action', coord }));
      }
    }
  }

  // RT-4: pendingCombat attacker/defender are valid and different
  // Domain: D3 (combat). Severity: critical.
  if (game.pendingCombat) {
    const aPn = game.pendingCombat.attackerPlayerNum;
    const dPn = game.pendingCombat.defenderPlayerNum;
    if (aPn == null || dPn == null) {
      errors.push(violation('RT-4', SEVERITY.CRITICAL, DOMAIN.COMBAT,
        `pendingCombat has null attacker(${aPn}) or defender(${dPn}) playerNum`,
        game, { contextType: 'pre_action', attackerPN: aPn, defenderPN: dPn }));
    } else if (aPn === dPn) {
      errors.push(violation('RT-4', SEVERITY.CRITICAL, DOMAIN.COMBAT,
        `pendingCombat attacker and defender are same player (P${aPn})`,
        game, { contextType: 'pre_action', attackerPN: aPn, defenderPN: dPn }));
    } else if (![1, 2].includes(aPn) || ![1, 2].includes(dPn)) {
      errors.push(violation('RT-4', SEVERITY.CRITICAL, DOMAIN.COMBAT,
        `pendingCombat playerNums out of range: attacker=${aPn}, defender=${dPn}`,
        game, { contextType: 'pre_action', attackerPN: aPn, defenderPN: dPn }));
    }
  }

  // RT-5: currentRound is sane (1-20) and monotonically non-decreasing
  // Domain: D7 (lifecycle). Severity: medium.
  const round = game.currentRound;
  if (round != null && (round < 1 || round > 20)) {
    errors.push(violation('RT-5', SEVERITY.MEDIUM, DOMAIN.LIFECYCLE,
      `currentRound=${round} outside sane range [1,20]`,
      game, { contextType: 'pre_action' }));
  }

  // RT-6: No immune figure carries a harmful condition
  // Domain: D4 (conditions). Severity: low.
  // This can legitimately happen briefly during handler execution (condition applied
  // then immunity checked), but should not persist between actions.
  const figureConditions = game.figureConditions || {};
  for (const [figureKey, conditions] of Object.entries(figureConditions)) {
    if (!Array.isArray(conditions) || conditions.length === 0) continue;
    // Only check figures still on the board
    if (!figureExistsOnBoard(game, figureKey)) continue;
    try {
      if (isConditionImmune(game, figureKey)) {
        const harmful = conditions.filter(c => HARMFUL_CONDITIONS.includes(c));
        if (harmful.length > 0) {
          errors.push(violation('RT-6', SEVERITY.LOW, DOMAIN.CONDITIONS,
            `Immune figure ${figureKey} carries harmful conditions: [${harmful.join(', ')}]`,
            game, { contextType: 'pre_action', figureKey, conditions: harmful }));
        }
      }
    } catch {
      // isConditionImmune may fail if DC data is unavailable — skip silently
    }
  }

  // RT-7: VP totals are internally consistent (kills + objectives === total)
  // Domain: D8 (VP). Severity: critical.
  for (const pn of [1, 2]) {
    const vp = pn === 1 ? game.player1VP : game.player2VP;
    if (!vp) continue;
    const kills = vp.kills ?? 0;
    const objectives = vp.objectives ?? 0;
    const total = vp.total ?? 0;
    if (total !== kills + objectives) {
      errors.push(violation('RT-7', SEVERITY.CRITICAL, DOMAIN.VP,
        `P${pn} VP inconsistent: total=${total} !== kills(${kills}) + objectives(${objectives}) = ${kills + objectives}`,
        game, { contextType: 'pre_action', playerNum: pn, total, kills, objectives }));
    }
  }

  // RT-8: VP never negative (reuse GS-7 logic)
  // Domain: D8 (VP). Severity: critical.
  for (const pn of [1, 2]) {
    const total = (pn === 1 ? game.player1VP : game.player2VP)?.total ?? 0;
    if (total < 0) {
      errors.push(violation('RT-8', SEVERITY.CRITICAL, DOMAIN.VP,
        `P${pn} VP is negative: ${total}`,
        game, { contextType: 'pre_action', playerNum: pn, total }));
    }
  }

  return errors;
}

// ═══════════════════════════════════════════════════════════════════════════
// POST-ACTION INVARIANTS
// Called immediately after handler execution.
// ═══════════════════════════════════════════════════════════════════════════

export function assertPostActionInvariants(game, preSnapshot, action, context = {}) {
  if (!game) return [];
  const errors = [];
  const actionType = action?.type || '?';
  const { dcHealthState, dcMessageMeta } = context;

  // RT-9: Defeated figures must not remain in figurePositions
  // Domain: D5 (defeat/cleanup). Severity: critical.
  // Check: any figure on board with HP <= 0 should have been removed by processFigureDefeat.
  for (const pn of [1, 2]) {
    const positions = game.figurePositions?.[pn] || {};
    for (const fk of Object.keys(positions)) {
      if (!positions[fk]) continue;
      const hp = getFigureHp(fk, pn, dcHealthState, dcMessageMeta);
      if (hp !== null && hp <= 0) {
        errors.push(violation('RT-9', SEVERITY.CRITICAL, DOMAIN.DEFEAT,
          `Post-action: figure ${fk} (P${pn}) still on board with HP=${hp} after ${actionType}`,
          game, { contextType: 'post_action', actionType, figureKey: fk, playerNum: pn, hp }));
      }
    }
  }

  // RT-10: VP totals remain internally consistent after handler
  // Domain: D8 (VP). Severity: critical.
  for (const pn of [1, 2]) {
    const vp = pn === 1 ? game.player1VP : game.player2VP;
    if (!vp) continue;
    const kills = vp.kills ?? 0;
    const objectives = vp.objectives ?? 0;
    const total = vp.total ?? 0;
    if (total !== kills + objectives) {
      errors.push(violation('RT-10', SEVERITY.CRITICAL, DOMAIN.VP,
        `Post-action: P${pn} VP inconsistent after ${actionType}: total=${total} !== kills(${kills}) + objectives(${objectives})`,
        game, { contextType: 'post_action', actionType, playerNum: pn, total, kills, objectives }));
    }
  }

  // RT-11: VP never went negative after handler
  // Domain: D8 (VP). Severity: critical.
  for (const pn of [1, 2]) {
    const total = (pn === 1 ? game.player1VP : game.player2VP)?.total ?? 0;
    if (total < 0) {
      errors.push(violation('RT-11', SEVERITY.CRITICAL, DOMAIN.VP,
        `Post-action: P${pn} VP negative (${total}) after ${actionType}`,
        game, { contextType: 'post_action', actionType, playerNum: pn, total }));
    }
  }

  // RT-12: Round did not go backward
  // Domain: D7 (lifecycle). Severity: critical.
  if (preSnapshot && game.currentRound != null && preSnapshot.round != null) {
    if (game.currentRound < preSnapshot.round) {
      errors.push(violation('RT-12', SEVERITY.CRITICAL, DOMAIN.LIFECYCLE,
        `Round went backward: ${preSnapshot.round} → ${game.currentRound} after ${actionType}`,
        game, { contextType: 'post_action', actionType, prevRound: preSnapshot.round, curRound: game.currentRound }));
    }
  }

  return errors;
}
