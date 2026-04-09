/**
 * Production-path diagnostic: runs a full game using strategy.js (the same
 * code path Discord self-play uses) with the game-builder in non-lightweight
 * mode, mission enabled, and full instrumentation.
 *
 * Validates: hybrid planner through production pickBestAction, mission VP,
 * full round/phase transitions, CC/reactive decisions.
 */

import { createTestGame } from '../fixtures/game-builder.js';
import { getAvailableActions } from '../../src/engine/available-actions.js';
import { pickBestAction, getRuntimeStats, resetRuntimeStats } from '../../src/ai/strategy.js';
import { getDcStats, getMapData, getDeploymentZones, getDcEffects, getCcEffect } from '../../src/data-loader.js';
import { getPlayableCcFromHand } from '../../src/game/cc-timing.js';
import { computeMovementCache, getBoardStateForMovement, getMovementProfile } from '../../src/game/movement.js';
import { playCommandCardHeadless, canResolveCcHeadless } from '../../src/headless/headless-cc-play.js';
import { abstractActionType, COMBAT_CC_TIMINGS } from './learnings.js';
import { getRange } from '../../src/game/spatial.js';
import { parseCoord } from '../../src/game/coords.js';
import { getMapTokensData, getMissionCardsData } from '../../src/data-loader.js';
import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const TEST_DECKS = JSON.parse(readFileSync(join(__dirname, '../../data/destruct-test-decks.json'), 'utf8'));

const MAX_ITERATIONS = 10000;
const MAX_ROUNDS = 10;

// CLI args: --map <id> --mission <mapId:variant|a|b> --games <n>
const cliArgs = process.argv.slice(2);
function cliArg(flag, defaultVal) {
  const idx = cliArgs.indexOf(flag);
  return idx >= 0 && cliArgs[idx + 1] ? cliArgs[idx + 1] : defaultVal;
}
// --mission accepts 'a', 'b', or 'mapId:variant' (e.g. 'hoth-battle-station:a').
// When mapId:variant format is used, the map portion overrides --map.
const MISSION_RAW = cliArg('--mission', 'a');
let MAP_ID, MISSION_VARIANT;
if (MISSION_RAW.includes(':')) {
  [MAP_ID, MISSION_VARIANT] = MISSION_RAW.split(':');
} else {
  MAP_ID = cliArg('--map', 'mos-eisley-outskirts');
  MISSION_VARIANT = MISSION_RAW;
}
const NUM_GAMES = parseInt(cliArg('--games', '10'), 10);

async function runOneGame(gameNum) {
  const i = gameNum % TEST_DECKS.length;
  let j = (gameNum + 17) % TEST_DECKS.length;
  if (j === i) j = (j + 1) % TEST_DECKS.length;
  const p1Deck = TEST_DECKS[i];
  const p2Deck = TEST_DECKS[j];

  const p1Army = p1Deck.dcList.map(n => ({ dcName: n }));
  const p2Army = p2Deck.dcList.map(n => ({ dcName: n }));

  const builder = createTestGame()
    .withMap(MAP_ID)
    .withMissionVariant(MISSION_VARIANT)
    .withPlayer1Army(p1Army)
    .withPlayer2Army(p2Army);
  if (p1Deck.ccList?.length > 0) builder.withPlayer1CcDeck(p1Deck.ccList);
  if (p2Deck.ccList?.length > 0) builder.withPlayer2CcDeck(p2Deck.ccList);

  const { game, harness, deps, dcMessageMeta, dcExhaustedState, dcHealthState } = builder
    .inRound(1).build();
  const hDeps = harness.getDeps();

  const actionDeps = {
    dcMessageMeta, dcExhaustedState, dcHealthState, getDcStats, getMapData,
    computeMovementCache, getBoardStateForMovement, getMovementProfile,
    getPlayableCcFromHand,
    getPlayableCcSpecialsForDc: hDeps.getPlayableCcSpecialsForDc,
    getPlayableCcDoubleActionsForDc: hDeps.getPlayableCcDoubleActionsForDc,
  };

  // Engine adapter matching what strategy.js expects
  const engine = {
    getState: () => harness.getGame(),
  };

  // Telemetry
  const actionLog = { planner: 0, dqn: 0, attacks: 0, moves: 0, endActs: 0, cc: 0, ccPlayed: 0, ccFiltered: 0, combatCcPlayed: 0, surges: 0, interacts: 0, interactsOffered: 0, reactive: 0 };
  // Activation divergence tracking
  const actDiv = { total: 0, diverged: 0, chosenCloserToObj: 0, chosenCloserToEnemy: 0, chosenCloserToBoth: 0, gatedByCombat: 0 };
  let consecutiveEmpty = 0;
  let lastActionType = null;
  let sameTypeCount = 0;
  const failedMoves = new Set();
  let lastMoveId = null;
  let lastChosenMoveKey = null; // for fingerprint-based move failure detection
  const ccFailureCounts = new Map();
  const CC_MAX_RETRIES = 3;
  let stuckReason = null;
  let lastRound = 1;
  const carryTelemetry = []; // per-round carry state for Hoth B

  // No-progress fingerprint (matches train.js safety net)
  let lastFingerprint = '';
  let noProgressCount = 0;
  const NO_PROGRESS_LIMIT = 80;

  function boardFingerprint(g) {
    const p1hp = dcHealthState ? [...dcHealthState.values()].reduce((s, arr) => {
      for (const fig of arr) if (fig) s += fig[0]; return s;
    }, 0) : 0;
    const p1figs = Object.keys(g.figurePositions?.[1] || {}).length;
    const p2figs = Object.keys(g.figurePositions?.[2] || {}).length;
    const p1vp = g.player1VP?.total || 0;
    const p2vp = g.player2VP?.total || 0;
    const round = g.currentRound || 1;
    const phase = g.roundPhase || '?';
    // Combat sub-state: track phase progression so reroll→surge→resolve changes fingerprint
    let pending = '';
    if (g.pendingCombat) {
      const c = g.pendingCombat;
      pending = `C:${c.rerollPhase || '-'}:${c.surgeRemaining ?? '-'}:${c.p1Ready ? 1 : 0}${c.p2Ready ? 1 : 0}`;
    } else if (g.moveInProgress) {
      pending = 'M';
    } else if (g.phaseGate) {
      pending = 'G';
    }
    // Activation progression: remaining activations + actions within current activation
    const p1rem = g.p1ActivationsRemaining ?? 0;
    const p2rem = g.p2ActivationsRemaining ?? 0;
    const actIdx = (g.p1ActivatedDcIndices?.length ?? 0) + (g.p2ActivatedDcIndices?.length ?? 0);
    let actionsRem = 0;
    for (const v of Object.values(g.dcActionsData || {})) actionsRem += (v?.remaining ?? 0);
    // Include figure positions so movement changes the fingerprint
    const posHash = [1, 2].map(pn =>
      Object.entries(g.figurePositions?.[pn] || {}).sort().map(([k, v]) => `${k}@${v}`).join(',')
    ).join('|');
    return `${round}:${phase}:${p1vp}:${p2vp}:${p1figs}:${p2figs}:${p1hp}:${p1rem}+${p2rem}:${actIdx}:${actionsRem}:${pending}:${posHash}`;
  }

  resetRuntimeStats();

  for (let iter = 0; iter < MAX_ITERATIONS; iter++) {
    const g = harness.getGame();
    if (g.ended) break;
    if (g.currentRound > MAX_ROUNDS) { stuckReason = 'max_rounds'; break; }

    // Carry telemetry: log state when round changes
    const curRound = g.currentRound || 1;
    if (curRound !== lastRound && gameNum <= 2) {
      const carriers = Object.entries(g.figureContraband || {}).filter(([, v]) => v);
      if (carriers.length > 0) {
        for (const [fk] of carriers) {
          const p1Pos = g.figurePositions?.[1]?.[fk];
          const p2Pos = g.figurePositions?.[2]?.[fk];
          const pos = p1Pos || p2Pos;
          const pn = p1Pos ? 1 : (p2Pos ? 2 : '?');
          console.log(`  [CARRY] G${gameNum} R${lastRound}→R${curRound}: P${pn} ${fk} at ${pos} carrying`);
        }
      } else {
        console.log(`  [CARRY] G${gameNum} R${lastRound}→R${curRound}: no carriers`);
      }
      carryTelemetry.push({ round: lastRound, carriers: carriers.length });
      // Per-round VP trace for first 2 games
      if (gameNum <= 1) {
        const p1v = g.player1VP?.total || 0;
        const p2v = g.player2VP?.total || 0;
        const p1o = g.player1VP?.objectives || 0;
        const p2o = g.player2VP?.objectives || 0;
        const p1k = g.player1VP?.kills || 0;
        const p2k = g.player2VP?.kills || 0;
        // Count figures in each zone for zone-control missions
        const zones = getDeploymentZones()?.[g.selectedMap?.id];
        let zoneStr = '';
        if (zones) {
          for (const color of ['red', 'blue']) {
            const cells = new Set((zones[color] || []).map(s => String(s).toLowerCase()));
            let p1c = 0, p2c = 0;
            for (const [, pos] of Object.entries(g.figurePositions?.[1] || {})) { if (pos && cells.has(String(pos).toLowerCase())) p1c++; }
            for (const [, pos] of Object.entries(g.figurePositions?.[2] || {})) { if (pos && cells.has(String(pos).toLowerCase())) p2c++; }
            zoneStr += ` ${color}:${p1c}v${p2c}`;
          }
        }
        // Command Center figure count
        const mapTokens = getMapTokensData()?.[g.selectedMap?.id];
        const ccArea = mapTokens?.namedAreas?.find(a => a.name === 'Command Center');
        let ccStr = '';
        if (ccArea?.cells?.length) {
          const ccCells = new Set(ccArea.cells.map(c => String(c).toLowerCase()));
          let p1cc = 0, p2cc = 0;
          for (const [, pos] of Object.entries(g.figurePositions?.[1] || {})) { if (pos && ccCells.has(String(pos).toLowerCase())) p1cc++; }
          for (const [, pos] of Object.entries(g.figurePositions?.[2] || {})) { if (pos && ccCells.has(String(pos).toLowerCase())) p2cc++; }
          ccStr = ` CC:${p1cc}v${p2cc}`;
        }
        console.log(`  [VP] G${gameNum} R${lastRound}→R${curRound}: P1=${p1v}(obj:${p1o},k:${p1k}) P2=${p2v}(obj:${p2o},k:${p2k})${zoneStr}${ccStr}`);
      }
      lastRound = curRound;
    }

    // No-progress detection (general safety net)
    const fp = boardFingerprint(g);
    if (fp === lastFingerprint) {
      noProgressCount++;
      if (noProgressCount >= NO_PROGRESS_LIMIT) {
        const p1FigCount = Object.keys(g.figurePositions?.[1] || {}).filter(k => g.figurePositions[1][k]).length;
        const p2FigCount = Object.keys(g.figurePositions?.[2] || {}).filter(k => g.figurePositions[2][k]).length;
        const pending = g.pendingCombat ? 'combat' : g.moveInProgress ? 'move' : g.phaseGate ? 'gate' : 'none';
        const p1Pos = Object.entries(g.figurePositions?.[1] || {}).filter(([,v]) => v).map(([k,v]) => `${k}@${v}`).join(', ');
        const p2Pos = Object.entries(g.figurePositions?.[2] || {}).filter(([,v]) => v).map(([k,v]) => `${k}@${v}`).join(', ');
        const combatSnap = g.pendingCombat ? JSON.stringify({
          p1Rdy: g.pendingCombat.p1Ready, p2Rdy: g.pendingCombat.p2Ready,
          atkRoll: !!g.pendingCombat.attackRoll, defRoll: !!g.pendingCombat.defenseRoll,
          rerollPhase: g.pendingCombat.rerollPhase || null,
          surgeRem: g.pendingCombat.surgeRemaining, pendingSurges: !!g.pendingCombat.pendingSurges,
          atkPn: g.pendingCombat.attackerPlayerNum,
        }) : 'none';
        // Snapshot available actions at break point
        const breakP1Acts = getAvailableActions(g, 1, actionDeps).map(a => a.type);
        const breakP2Acts = getAvailableActions(g, 2, actionDeps).map(a => a.type);
        const breakTypeCounts = {};
        for (const t of [...breakP1Acts, ...breakP2Acts]) breakTypeCounts[t] = (breakTypeCounts[t] || 0) + 1;
        const breakActStr = Object.entries(breakTypeCounts).map(([k,v]) => `${k}:${v}`).join(' ');
        console.log(`  [NP-BREAK] G${gameNum} R${g.currentRound} iter=${iter} pending=${pending} figs=${p1FigCount}+${p2FigCount} combat=${combatSnap}`);
        console.log(`    actions=[${breakActStr || 'EMPTY'}]`);
        console.log(`    fp=${fp.slice(0,100)}`);
        console.log(`    failedMoves=${failedMoves.size} consecutiveEmpty=${consecutiveEmpty}`);
        g.ended = true;
        stuckReason = 'no_progress';
        const p1vp = g.player1VP?.total || 0;
        const p2vp = g.player2VP?.total || 0;
        if (p1vp > p2vp) g.winnerId = g.player1Id;
        else if (p2vp > p1vp) g.winnerId = g.player2Id;
        break;
      }
    } else {
      noProgressCount = 0;
      lastFingerprint = fp;
    }

    // Fingerprint-based move failure detection: if fingerprint unchanged and last
    // action was move_pick_space, mark that coord as failed (catches silent failures
    // where the submission doesn't throw but the figure doesn't actually move)
    if (noProgressCount > 0 && lastChosenMoveKey) {
      failedMoves.add(lastChosenMoveKey);
      lastChosenMoveKey = null;
    }

    // Auto-resolve pending interactive states BEFORE action generation
    if (g.pendingMissionSorReveal) {
      try { await harness.submitAction(`sor_mission_reveal_${g.gameId}`, g.player1Id); } catch {}
      continue;
    }
    // Auto-push Krykna toward figures (Chopper Base A end-of-round)
    // Must be checked BEFORE getAvailableActions — the phase gate fires first
    // and would short-circuit the push check if it were inside actions.length===0.
    if (g.pendingKryknaPushQueue?.length > 0 && Array.isArray(g.npcKrykna)) {
      if (gameNum <= 1) console.log(`  [KPUSH] R${g.currentRound} queue=${g.pendingKryknaPushQueue.length} krykna=${g.npcKrykna.filter(k=>!k.defeated).length}`);
      const allFigPos = [];
      for (const pn of [1, 2]) {
        for (const [fk, pos] of Object.entries(g.figurePositions?.[pn] || {})) {
          if (pos) allFigPos.push({ fk, pn, pos: String(pos).toLowerCase() });
        }
      }
      for (const k of g.npcKrykna) {
        if (k.defeated) continue;
        // Greedy 3-step push toward nearest figure
        let cur = String(k.coord).toLowerCase();
        for (let step = 0; step < 3; step++) {
          let bestDist = Infinity;
          for (const fp of allFigPos) {
            const d = getRange(cur, fp.pos);
            if (d < bestDist) bestDist = d;
          }
          if (bestDist <= 1) break; // already adjacent
          // Try 4 cardinal neighbors
          const cp = parseCoord(cur);
          const neighbors = [
            [cp.col - 1, cp.row], [cp.col + 1, cp.row],
            [cp.col, cp.row - 1], [cp.col, cp.row + 1],
          ].map(([c, r]) => (c >= 0 && r >= 0) ? String.fromCharCode(97 + c) + String(r + 1) : null).filter(Boolean);
          let bestNeighbor = null, bestNeighborDist = Infinity;
          for (const n of neighbors) {
            let minD = Infinity;
            for (const fp of allFigPos) {
              const d = getRange(n, fp.pos);
              if (d < minD) minD = d;
            }
            if (minD < bestNeighborDist) { bestNeighborDist = minD; bestNeighbor = n; }
          }
          if (bestNeighbor && bestNeighborDist < bestDist) {
            cur = bestNeighbor;
          } else break;
        }
        k.coord = cur;
      }
      // Apply 2 damage to non-Krykna figures adjacent to any Krykna
      for (const fp of allFigPos) {
        const adjToKrykna = g.npcKrykna.some(k => !k.defeated && getRange(String(k.coord).toLowerCase(), fp.pos) <= 1);
        if (adjToKrykna) {
          for (const [msgId, meta] of dcMessageMeta) {
            if (meta.gameId !== g.gameId || meta.playerNum !== fp.pn) continue;
            const figs = meta.figures || [];
            const figIdx = figs.findIndex(f => f.figureKey === fp.fk);
            if (figIdx < 0) continue;
            const hs = dcHealthState.get(msgId);
            if (hs?.[figIdx]) {
              hs[figIdx][0] = Math.max(0, hs[figIdx][0] - 2);
            }
          }
        }
      }
      g.pendingKryknaPushQueue = null;
      g.kryknaPushedIds = null;
      continue;
    }

    // Auto-skip claimed Krykna placement (Chopper Base A post-push interactive phase)
    if (g.pendingClaimedKryknaQueue?.length > 0) {
      g.pendingClaimedKryknaQueue = null;
      continue;
    }

    // Combat ready-gate: both players must confirm — submit before action generation
    // (matches train.js pattern; without this, getAvailableActions may return empty
    // during combat-ready phase, causing false NO_PROGRESS)
    if (g.pendingCombat && (!g.pendingCombat.p1Ready || !g.pendingCombat.p2Ready)) {
      const combatReadyId = `combat_ready_${g.gameId}`;
      if (!g.pendingCombat.p1Ready) {
        try { await harness.submitAction(combatReadyId, g.player1Id); } catch {}
      }
      if (g.pendingCombat && !g.pendingCombat.p2Ready) {
        try { await harness.submitAction(combatReadyId, g.player2Id); } catch {}
      }
      continue;
    }

    // Get actions for both players (mirror train.js logic — tag with actingPlayer)
    const p1ActionsRaw = getAvailableActions(g, 1, actionDeps).map(a => ({ ...a, actingPlayer: 1 }));
    const p2ActionsRaw = getAvailableActions(g, 2, actionDeps).map(a => ({ ...a, actingPlayer: 2 }));

    // Pre-filter: CC, headless-incompatible, attack_target without targets, failed moves
    const filterActions = (actions) => (actions || []).filter(a => {
      // Fix 1: Filter attack_target without targetFigureKey (matches train.js)
      if (a.type === 'attack_target' && !a.params?.targetFigureKey) return false;
      // CC filter: canResolveCcHeadless check + retry guard
      if (a.type === 'play_cc' || a.type === 'play_cc_special' || a.type === 'play_cc_double') {
        if (!canResolveCcHeadless(g, a.actingPlayer, a.params.cardName, hDeps)) {
          actionLog.ccFiltered++;
          return false;
        }
        const ccKey = `P${a.actingPlayer}:${a.params.cardName}:R${g.currentRound || 1}`;
        if ((ccFailureCounts.get(ccKey) || 0) >= CC_MAX_RETRIES) {
          actionLog.ccFiltered++;
          return false;
        }
      }
      // Fix 2: Filter failed move_figure customIds (matches train.js)
      if (a.type === 'move_figure' && failedMoves.has(a.customId)) return false;
      // Terminal interact not supported headless
      if (a.type === 'interact' && a.params?.optionId === 'use_terminal') return false;
      if (a.type === 'phase_gate_unready') return false;
      return true;
    });
    const p1Actions = filterActions(p1ActionsRaw);
    const p2Actions = filterActions(p2ActionsRaw);

    // Fix 2: Track failed move_figure (if we submitted move_figure last iter but
    // no move_pick_space appeared, mark that move_figure as failed)
    const hasMoveSpaces = [...p1Actions, ...p2Actions].some(a => a.type === 'move_pick_space');
    if (lastMoveId && !hasMoveSpaces) failedMoves.add(lastMoveId);
    if (hasMoveSpaces) lastMoveId = null;
    if ([...p1Actions, ...p2Actions].some(a => a.type === 'activate_dc') &&
        ![...p1Actions, ...p2Actions].some(a => a.type === 'dc_end_activation')) {
      failedMoves.clear();
    }

    const allActions = [...p1Actions, ...p2Actions];

    // Track interact actions offered (pre-selection)
    const interactsAvail = allActions.filter(a => a.type === 'interact');
    if (interactsAvail.length > 0) {
      actionLog.interactsOffered += interactsAvail.length;
      if (gameNum === 0) {
        for (const ia of interactsAvail) {
          console.log(`    INTERACT OFFERED iter=${iter} pn=${ia.actingPlayer || '?'} opt=${ia.params?.optionId} fig=${ia.params?.figureKey} desc=${ia.description}`);
        }
      }
    }

    if (allActions.length === 0) {
      // Check if the game has a phase gate needing both players to ready
      if (g.phaseGate) {
        const gateCustomId = `phase_gate_ready_${g.gameId}`;
        if (!g.phaseGate.p1Ready) {
          try { await harness.submitAction(gateCustomId, g.player1Id); } catch {}
        }
        if (!g.phaseGate.p2Ready) {
          try { await harness.submitAction(gateCustomId, g.player2Id); } catch {}
        }
        continue;
      }
      // Auto-skip fluctuation swap (Lothal Wastes B end-of-round interactive phase)
      if (g.pendingFluctuationSwapQueue?.length > 0) {
        const pn = g.pendingFluctuationSwapQueue[0];
        const userId = pn === 1 ? g.player1Id : g.player2Id;
        try { await harness.submitAction(`fluctuation_skip_${g.gameId}`, userId); } catch {}
        continue;
      }
      consecutiveEmpty++;
      if (consecutiveEmpty > 10) { stuckReason = 'no_actions_10x'; break; }
      continue;
    }
    consecutiveEmpty = 0;

    // ── Mandatory two-player coordination actions ──────────────────────────
    // Combat flow and phase gates need both players. Submit one per iteration
    // to maintain proper ordering. Prefer the turn player's mandatory actions.
    const MANDATORY_TYPES = new Set([
      'phase_gate_ready', 'combat_ready', 'combat_roll', 'combat_gate',
      'combat_resolve', 'combat_resolve_ready',
    ]);
    const p1Mandatory = p1Actions.filter(a => MANDATORY_TYPES.has(a.type));
    const p2Mandatory = p2Actions.filter(a => MANDATORY_TYPES.has(a.type));
    if (p1Mandatory.length > 0 || p2Mandatory.length > 0) {
      for (const a of p1Mandatory) {
        try { await harness.submitAction(a.customId, g.player1Id); } catch {}
      }
      for (const a of p2Mandatory) {
        try { await harness.submitAction(a.customId, g.player2Id); } catch {}
      }
      continue;
    }

    // end_activation_phase — two-player coordination
    const p1EndPhase = p1Actions.find(a => a.type === 'end_activation_phase');
    const p2EndPhase = p2Actions.find(a => a.type === 'end_activation_phase');
    if (p1EndPhase || p2EndPhase) {
      const p1Productive = p1Actions.some(a => a.type !== 'end_activation_phase');
      const p2Productive = p2Actions.some(a => a.type !== 'end_activation_phase');
      if (!p1Productive && !p2Productive) {
        if (p1EndPhase) { try { await harness.submitAction(p1EndPhase.customId, g.player1Id); } catch {} }
        if (p2EndPhase) { try { await harness.submitAction(p2EndPhase.customId, g.player2Id); } catch {} }
        continue;
      }
    }

    // Pick action via production path — use turn player, prefer productive player
    const turnPlayer = g.currentActivationTurnPlayerId === g.player1Id ? 1 : 2;
    const otherPlayer = turnPlayer === 1 ? 2 : 1;
    const turnActions = turnPlayer === 1 ? p1Actions : p2Actions;
    const otherActions = turnPlayer === 1 ? p2Actions : p1Actions;
    const pn = turnActions.length > 0 ? turnPlayer : otherPlayer;
    const actions = pn === 1 ? p1Actions : p2Actions;
    const result = pickBestAction(engine, actions, pn, actionDeps);
    let chosen = result?.action || actions[0];

    if (!chosen) { stuckReason = 'no_chosen_action'; break; }

    // R1 stall trace: log every action while fingerprint is stuck
    if (noProgressCount > 0 && noProgressCount <= 25 && g.currentRound <= 2) {
      const types = actions.map(a => a.type);
      const typeCounts = {};
      for (const t of types) typeCounts[t] = (typeCounts[t] || 0) + 1;
      const typeStr = Object.entries(typeCounts).map(([k,v]) => `${k}:${v}`).join(' ');
      console.log(`  [STALL] iter=${iter} npc=${noProgressCount} R${g.currentRound} pn=${pn} chosen=${chosen.type}/${chosen.params?.dcName || chosen.params?.cardName || chosen.customId?.slice(0,30) || ''} fp=${lastFingerprint.slice(0,60)} avail=[${typeStr}]`);
    }

    // Stall-escape: after 15 consecutive unchanged fingerprints, override DQN
    // to pick progression actions instead of stalling on movement/CC
    const STALL_ESCAPE_THRESHOLD = 15;
    if (noProgressCount >= STALL_ESCAPE_THRESHOLD) {
      const escape =
        actions.find(a => a.type === 'move_pick_space' && a.params?.done) ||
        actions.find(a => a.type === 'dc_end_activation') ||
        actions.find(a => a.type === 'end_activation') ||
        actions.find(a => a.type === 'pass_activation_turn') ||
        actions.find(a => a.type === 'end_round_phase') ||
        actions.find(a => a.type === 'combat_gate' || a.type === 'combat_ready') ||
        actions.find(a => a.type === 'combat_roll') ||
        actions.find(a => !a.type.startsWith('play_cc') && !a.type.startsWith('move_'));
      if (escape) chosen = escape;
    }

    // Track move_pick_space coord for fingerprint-based failure detection
    lastChosenMoveKey = (chosen.type === 'move_pick_space' && chosen.params?.coord)
      ? `${chosen.params.moveKey}_${chosen.params.coord}` : null;

    // Track move_figure submissions for failure detection
    if (chosen.type === 'move_figure') lastMoveId = chosen.customId;

    // Classify
    const absType = abstractActionType(chosen, g);
    const withinAct = ['attack_close', 'attack_ranged', 'start_move', 'move_toward', 'move_away', 'move_lateral', 'move_done', 'end_activation'].includes(absType);
    if (withinAct) actionLog.planner++;
    else actionLog.dqn++;

    if (absType === 'attack_close' || absType === 'attack_ranged') actionLog.attacks++;
    if (absType === 'move_toward' || absType === 'move_away' || absType === 'move_lateral' || absType === 'start_move') actionLog.moves++;
    if (absType === 'end_activation') actionLog.endActs++;
    if (absType === 'play_cc') actionLog.cc++;
    if (absType === 'surge_damage' || absType === 'surge_special' || absType === 'spend_surge') actionLog.surges++;
    if (absType === 'interact') actionLog.interacts++;
    if (absType === 'react_use' || absType === 'react_skip') actionLog.reactive++;

    // Activation divergence: compare enemy-only vs obj-aware ordering
    if (chosen.type === 'activate_dc' && actions.filter(a => a.type === 'activate_dc').length > 1) {
      const activateActions = actions.filter(a => a.type === 'activate_dc');
      const oppNum = pn === 1 ? 2 : 1;
      const oppFigs = Object.values(g.figurePositions?.[oppNum] || {}).filter(Boolean);
      // Get objective coords (matching learnings.js getObjectiveCoords)
      let objCoords = [];
      try {
        const mapId = g.selectedMap?.id;
        const mapData = mapId ? getMapTokensData()?.[mapId] : null;
        if (mapData) {
          const variant = g.selectedMission?.variant;
          const ms = variant === 'a' ? 'missionA' : variant === 'b' ? 'missionB' : null;
          if (ms && mapData[ms]?.positions) {
            for (const posArr of Object.values(mapData[ms].positions)) {
              for (const c of posArr) objCoords.push(String(c).toLowerCase());
            }
          }
          for (const area of mapData.namedAreas || []) {
            for (const c of area.cells || []) objCoords.push(String(c).toLowerCase());
          }
          // Deployment zone centroids for zone-control missions
          const mRules = getMissionCardsData()?.[mapId]?.[variant]?.rules?.endOfRound;
          if (mRules?.vpPerControlledDeploymentZone) {
            const zones = getDeploymentZones()?.[mapId];
            if (zones) {
              for (const color of ['red', 'blue']) {
                const cells = zones[color];
                if (!cells?.length) continue;
                let sumCol = 0, sumRow = 0;
                for (const c of cells) {
                  const p = parseCoord(c);
                  sumCol += p.col;
                  sumRow += p.row;
                }
                const avgCol = Math.round(sumCol / cells.length);
                const avgRow = Math.round(sumRow / cells.length);
                objCoords.push(String.fromCharCode(97 + avgCol) + String(avgRow + 1));
              }
            }
          }
        }
      } catch {}
      if (oppFigs.length > 0 && objCoords.length > 0) {
        let dcEffects;
        try { dcEffects = getDcEffects(); } catch { dcEffects = null; }
        // Score each DC with enemy dist, obj dist, and combat-ready flag
        const scored = activateActions.map(a => {
          const dcName = a.params?.dcName;
          const myFigs = Object.entries(g.figurePositions?.[pn] || {})
            .filter(([fk]) => fk.startsWith(dcName + '-'));
          let atkRange = 1;
          if (dcEffects && dcName) {
            const lower = dcName.toLowerCase();
            const ciKey = Object.keys(dcEffects).find(k => k.toLowerCase() === lower);
            const eff = dcEffects[dcName] || (ciKey ? dcEffects[ciKey] : null);
            atkRange = eff?.attack?.range || 1;
          }
          let minEnemy = 99, minObj = 99, combatReady = false;
          for (const [, myPos] of myFigs) {
            for (const ePos of oppFigs) {
              const d = getRange(String(myPos).toLowerCase(), String(ePos).toLowerCase());
              if (d < minEnemy) minEnemy = d;
              if (d <= atkRange) combatReady = true;
            }
            for (const oc of objCoords) {
              const d = getRange(String(myPos).toLowerCase(), oc);
              if (d < minObj) minObj = d;
            }
          }
          return { dcName, minEnemy, minObj, minCombined: Math.min(minEnemy, minObj), combatReady };
        });
        // What would pure obj-aware ordering pick?
        const objAwareBest = [...scored].sort((a, b) => a.minCombined - b.minCombined)[0].dcName;
        // What does the actual gated heuristic pick?
        const ready = scored.filter(s => s.combatReady);
        const actualBest = ready.length > 0
          ? [...ready].sort((a, b) => a.minEnemy - b.minEnemy)[0].dcName
          : objAwareBest;
        actDiv.total++;
        if (ready.length > 0 && actualBest !== objAwareBest) {
          actDiv.gatedByCombat++;
        }
        const enemyOnlyBest = [...scored].sort((a, b) => a.minEnemy - b.minEnemy)[0].dcName;
        if (enemyOnlyBest !== objAwareBest) {
          actDiv.diverged++;
          const winner = scored.find(s => s.dcName === objAwareBest);
          if (winner.minObj < winner.minEnemy) actDiv.chosenCloserToObj++;
          else if (winner.minEnemy < winner.minObj) actDiv.chosenCloserToEnemy++;
          else actDiv.chosenCloserToBoth++;
        }
      }
    }

    // Verbose logging for first 30 actions of first game
    if (gameNum === 0 && iter < 30) {
      const absT = abstractActionType(chosen, g);
      console.log(`    iter=${iter} pn=${pn} type=${chosen.type} abs=${absT} cId=${chosen.customId?.slice(0, 40)} phase=${g.phase}/${g.roundPhase} round=${g.currentRound}`);
    }

    // Stuck detection — secondary safety, fingerprint is primary
    if (chosen.type === lastActionType) sameTypeCount++;
    else { sameTypeCount = 0; lastActionType = chosen.type; }

    // Failed move_pick_space detection
    if (chosen.type === 'move_pick_space' && chosen.params?.coord) {
      const moveKey = `${chosen.params.moveKey}_${chosen.params.coord}`;
      if (failedMoves.has(moveKey)) {
        const doneAction = actions.find(a => a.type === 'move_pick_space' && a.params?.done);
        if (doneAction) {
          const uid = pn === 1 ? g.player1Id : g.player2Id;
          try { await harness.submitAction(doneAction.customId, uid); } catch {}
          continue;
        }
      }
    }

    // Intercept interact actions — resolve directly (matching train.js)
    if (chosen.type === 'interact') {
      const p = chosen.params;
      const actionsData = g.dcActionsData?.[p.msgId];
      if (actionsData && actionsData.remaining > 0) {
        actionsData.remaining = Math.max(0, actionsData.remaining - 1);
        const optionId = p.optionId;
        if (optionId === 'retrieve_contraband') {
          g.figureContraband = g.figureContraband || {};
          g.figureContraband[p.figureKey] = true;
          if (gameNum <= 2) {
            const pos = g.figurePositions?.[chosen.actingPlayer]?.[p.figureKey];
            console.log(`  [PICKUP] G${gameNum} R${g.currentRound} P${chosen.actingPlayer} ${p.figureKey} at ${pos}`);
          }
        } else if (optionId?.startsWith('launch_panel_')) {
          const parts = optionId.replace('launch_panel_', '').split('_');
          const coord = parts[0];
          const side = parts[1];
          g.launchPanelState = g.launchPanelState || {};
          g.launchPanelState[coord.toLowerCase()] = side;
          if (chosen.actingPlayer === 1) g.p1LaunchPanelFlippedThisRound = true;
          else g.p2LaunchPanelFlippedThisRound = true;
        } else if (optionId?.startsWith('open_door_')) {
          const edgeKeys = optionId.replace('open_door_', '').split(',');
          g.openedDoors = g.openedDoors || [];
          for (const ek of edgeKeys) {
            if (!g.openedDoors.includes(ek)) g.openedDoors.push(ek);
          }
        }
      }
      continue;
    }

    // Execute CC plays via headless CC handler (not submitAction)
    if (chosen.type === 'play_cc' || chosen.type === 'play_cc_special' || chosen.type === 'play_cc_double') {
      try {
        // Deduct activation actions for special-action CCs (matching train.js)
        if (chosen.type === 'play_cc_special' || chosen.type === 'play_cc_double') {
          const actData = g.dcActionsData?.[chosen.params.msgId];
          if (actData && typeof actData.remaining === 'number') {
            if (chosen.type === 'play_cc_special') actData.remaining = Math.max(0, actData.remaining - 1);
            else actData.remaining = 0;
          }
        }
        const ccResult = await playCommandCardHeadless(g, chosen.actingPlayer, chosen.params.cardName, hDeps);
        if (ccResult?.played === false) {
          // Card stayed in hand (cost>0 resolve failed) — count as failure for retry guard
          const ccKey = `P${chosen.actingPlayer}:${chosen.params.cardName}:R${g.currentRound || 1}`;
          const count = (ccFailureCounts.get(ccKey) || 0) + 1;
          ccFailureCounts.set(ccKey, count);
          if (gameNum === 0 && iter < 30) console.log(`    CC SKIP: "${chosen.params.cardName}" attempt=${count} reason=${ccResult.reason || 'resolve-failed'}`);
        } else {
          actionLog.ccPlayed++;
          // Track combat CC plays
          const ccTiming = (getCcEffect(chosen.params.cardName)?.timing || '').toLowerCase();
          if (COMBAT_CC_TIMINGS.has(ccTiming)) actionLog.combatCcPlayed++;
        }
      } catch (err) {
        const ccKey = `P${chosen.actingPlayer}:${chosen.params.cardName}:R${g.currentRound || 1}`;
        const count = (ccFailureCounts.get(ccKey) || 0) + 1;
        ccFailureCounts.set(ccKey, count);
        if (gameNum === 0 && iter < 30) console.log(`    CC FAIL: "${chosen.params.cardName}" attempt=${count} err=${err.message}`);
      }
      continue;
    }

    const userId = pn === 1 ? g.player1Id : g.player2Id;
    try {
      await harness.submitAction(chosen.customId, userId);
      // Track carrier move lifecycle
      if (gameNum <= 1 && chosen.type === 'move_figure') {
        const mip = g.moveInProgress || {};
        const mKeys = Object.keys(mip);
        const fk = mKeys.length > 0 ? mip[mKeys[0]]?.figureKey : null;
        console.log(`  [MF] ${chosen.params?.dcName} → mip=${mKeys.length} fk=${fk} cargo=${!!g.figureContraband?.[fk]}`);
      }
      if (gameNum <= 1 && chosen.type === 'move_pick_space') {
        const fk = Object.values(g.moveInProgress || {})[0]?.figureKey;
        console.log(`  [MS] ${fk || '?'} coord=${chosen.params?.coord || 'done'} cargo=${!!g.figureContraband?.[fk]}`);
      }
    } catch (err) {
      if ((gameNum === 0 && iter < 30) || (gameNum <= 2 && noProgressCount > 0 && noProgressCount <= 10)) console.log(`    ERROR: type=${chosen.type} err=${err.message}`);
      if (chosen.type === 'move_pick_space' && chosen.params?.coord) {
        failedMoves.add(`${chosen.params.moveKey}_${chosen.params.coord}`);
      }
    }
  }

  const g = harness.getGame();
  const stats = getRuntimeStats();
  return {
    gameNum,
    completed: !!g.ended,
    rounds: g.currentRound,
    stuckReason,
    p1VP: g.player1VP,
    p2VP: g.player2VP,
    actionLog,
    actDiv: { ...actDiv },
    runtimeStats: stats,
    p1Army: p1Army.map(a => a.dcName).join(', '),
    p2Army: p2Army.map(a => a.dcName).join(', '),
  };
}

async function main() {
  console.log('╔══════════════════════════════════════════════════════════╗');
  console.log('║  Production-Path Diagnostic — Hybrid Architecture      ║');
  console.log('║  Uses strategy.js pickBestAction (same as Discord)     ║');
  console.log('╚══════════════════════════════════════════════════════════╝');
  console.log(`  Map: ${MAP_ID} | Mission: ${MISSION_VARIANT} | Games: ${NUM_GAMES}\n`);

  const results = [];
  for (let i = 0; i < NUM_GAMES; i++) {
    const result = await runOneGame(i);
    const status = result.stuckReason === 'no_progress' ? 'NO_PROGRESS'
      : result.stuckReason === 'max_rounds' ? 'MAX_ROUNDS'
      : result.completed ? 'COMPLETE' : `STUCK(${result.stuckReason})`;
    const totalVP = (result.p1VP?.total || 0) + (result.p2VP?.total || 0);
    const killVP = (result.p1VP?.kills || 0) + (result.p2VP?.kills || 0);
    const objVP = (result.p1VP?.objectives || 0) + (result.p2VP?.objectives || 0);
    console.log(`  [${i + 1}/${NUM_GAMES}] ${status} | R${result.rounds} | VP: ${totalVP} (kill: ${killVP}, obj: ${objVP}) | atk: ${result.actionLog.attacks} | mv: ${result.actionLog.moves} | cc: ${result.actionLog.cc}(${result.actionLog.ccPlayed}ok/${result.actionLog.combatCcPlayed}cbt/${result.actionLog.ccFiltered}filt) | interact: ${result.actionLog.interacts}`);
    results.push(result);
  }

  // Summary
  const naturalEnd = results.filter(r => r.completed && !r.stuckReason);
  const noProgress = results.filter(r => r.stuckReason === 'no_progress');
  const maxRounds = results.filter(r => r.stuckReason === 'max_rounds');
  const completed = [...naturalEnd, ...noProgress, ...maxRounds];
  const stuck = results.filter(r => !r.completed && r.stuckReason && r.stuckReason !== 'no_progress' && r.stuckReason !== 'max_rounds');
  const totalVP = completed.reduce((s, r) => s + (r.p1VP?.total || 0) + (r.p2VP?.total || 0), 0);
  const killVP = completed.reduce((s, r) => s + (r.p1VP?.kills || 0) + (r.p2VP?.kills || 0), 0);
  const objVP = completed.reduce((s, r) => s + (r.p1VP?.objectives || 0) + (r.p2VP?.objectives || 0), 0);
  const avgRounds = completed.reduce((s, r) => s + r.rounds, 0) / (completed.length || 1);
  const totalAttacks = results.reduce((s, r) => s + r.actionLog.attacks, 0);
  const totalMoves = results.reduce((s, r) => s + r.actionLog.moves, 0);
  const totalCC = results.reduce((s, r) => s + r.actionLog.cc, 0);
  const totalInteracts = results.reduce((s, r) => s + r.actionLog.interacts, 0);
  const totalSurges = results.reduce((s, r) => s + r.actionLog.surges, 0);
  const totalReactive = results.reduce((s, r) => s + r.actionLog.reactive, 0);
  const totalPlanner = results.reduce((s, r) => s + r.actionLog.planner, 0);
  const totalDqn = results.reduce((s, r) => s + r.actionLog.dqn, 0);

  console.log(`\n${'='.repeat(60)}`);
  console.log('PRODUCTION-PATH DIAGNOSTIC SUMMARY');
  console.log(`${'='.repeat(60)}`);
  console.log(`  Natural completion:  ${naturalEnd.length}/${NUM_GAMES}`);
  console.log(`  Max rounds (R${MAX_ROUNDS}):   ${maxRounds.length}/${NUM_GAMES}`);
  console.log(`  No-progress ended:  ${noProgress.length}/${NUM_GAMES}`);
  console.log(`  Hard stuck:          ${stuck.length}/${NUM_GAMES}`);
  if (stuck.length > 0) {
    const reasons = {};
    for (const s of stuck) { reasons[s.stuckReason] = (reasons[s.stuckReason] || 0) + 1; }
    console.log(`  Stuck reasons:       ${JSON.stringify(reasons)}`);
  }
  console.log(`  Avg rounds:          ${avgRounds.toFixed(1)}`);
  console.log(`  Total VP:            ${totalVP} (kill: ${killVP}, objectives: ${objVP})`);
  console.log(`  Avg VP/game:         ${(totalVP / (completed.length || 1)).toFixed(1)}`);
  console.log(`  Objective VP rate:   ${totalVP > 0 ? ((objVP / totalVP) * 100).toFixed(1) : 0}%`);
  console.log('');
  console.log('  ── Action Split ──');
  console.log(`  Planner actions:     ${totalPlanner} (${((totalPlanner / (totalPlanner + totalDqn)) * 100).toFixed(1)}%)`);
  console.log(`  DQN actions:         ${totalDqn} (${((totalDqn / (totalPlanner + totalDqn)) * 100).toFixed(1)}%)`);
  console.log(`  Attacks:             ${totalAttacks} (${(totalAttacks / NUM_GAMES).toFixed(1)}/game)`);
  console.log(`  Moves:               ${totalMoves} (${(totalMoves / NUM_GAMES).toFixed(1)}/game)`);
  const totalCcPlayed = results.reduce((s, r) => s + r.actionLog.ccPlayed, 0);
  const totalCcFiltered = results.reduce((s, r) => s + r.actionLog.ccFiltered, 0);
  const totalCombatCc = results.reduce((s, r) => s + r.actionLog.combatCcPlayed, 0);
  console.log(`  CC plays:            ${totalCC} chosen, ${totalCcPlayed} executed (${totalCombatCc} combat), ${totalCcFiltered} filtered`);
  console.log(`  Surges:              ${totalSurges} (${(totalSurges / NUM_GAMES).toFixed(1)}/game)`);
  const totalInteractsOffered = results.reduce((s, r) => s + r.actionLog.interactsOffered, 0);
  console.log(`  Interacts:           ${totalInteracts} chosen / ${totalInteractsOffered} offered (${(totalInteracts / NUM_GAMES).toFixed(1)}/game)`);
  console.log(`  Reactive:            ${totalReactive} (${(totalReactive / NUM_GAMES).toFixed(1)}/game)`);

  // Activation divergence summary
  const totalActDiv = results.reduce((s, r) => s + r.actDiv.total, 0);
  const totalDiverged = results.reduce((s, r) => s + r.actDiv.diverged, 0);
  const totalCloserObj = results.reduce((s, r) => s + r.actDiv.chosenCloserToObj, 0);
  const totalCloserEnemy = results.reduce((s, r) => s + r.actDiv.chosenCloserToEnemy, 0);
  const totalCloserBoth = results.reduce((s, r) => s + r.actDiv.chosenCloserToBoth, 0);
  const totalGated = results.reduce((s, r) => s + r.actDiv.gatedByCombat, 0);
  console.log('');
  console.log('  ── Activation Ordering Divergence ──');
  console.log(`  Activate decisions:  ${totalActDiv}`);
  console.log(`  Diverged (obj≠enemy):${totalDiverged} (${totalActDiv > 0 ? ((totalDiverged / totalActDiv) * 100).toFixed(1) : 0}%)`);
  console.log(`  Gated by combat:     ${totalGated} (${totalActDiv > 0 ? ((totalGated / totalActDiv) * 100).toFixed(1) : 0}%)`);
  console.log(`  Chose closer-to-obj: ${totalCloserObj}`);
  console.log(`  Chose closer-to-enemy:${totalCloserEnemy}`);
  console.log(`  Chose closer-to-both:${totalCloserBoth}`);

  // Runtime stats from last game
  const lastStats = results[results.length - 1]?.runtimeStats;
  if (lastStats) {
    console.log('');
    console.log('  ── Strategy.js Runtime (last game) ──');
    console.log(`  Idle suppressed:     ${lastStats.endActSuppressed}`);
    console.log(`  Heuristic overrides: ${lastStats.heuristicOverrides}`);
    console.log(`  Move greedy used:    ${lastStats.moveGreedyUsed}`);
    console.log(`  Move learned used:   ${lastStats.moveLearnedUsed}`);
    console.log(`  Encoder:             ${lastStats.encoder}`);
    if (lastStats.endgameActivations || lastStats.endgameObjOnlyMoves || lastStats.endgameAttacksSuppressed) {
      console.log('');
      console.log('  ── Endgame Closeout (last game) ──');
      console.log(`  Endgame activations: ${lastStats.endgameActivations}`);
      console.log(`  Obj-only moves:      ${lastStats.endgameObjOnlyMoves}`);
      console.log(`  Attacks suppressed:  ${lastStats.endgameAttacksSuppressed}`);
    }
  }

  console.log(`\n${'='.repeat(60)}`);
  console.log('DIAGNOSTIC COMPLETE');
  console.log(`${'='.repeat(60)}\n`);
}

main().catch(err => { console.error(err); process.exit(1); });
