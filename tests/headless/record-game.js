/**
 * Game recorder — captures snapshots + action log for replay viewer.
 * Run with: node tests/headless/record-game.js
 * Outputs: tests/headless/replay-data.json
 */
import { createTestGame } from '../fixtures/game-builder.js';
import { getAvailableActions } from '../../src/engine/available-actions.js';
import { getDcStats, getMapSpaces } from '../../src/data-loader.js';
import { getBoardStateForMovement, getMovementProfile, computeMovementCache } from '../../src/game/movement.js';
import { parseCoord } from '../../src/game/coords.js';
import { loadLearnings, saveLearnings, createGameTracer, pickSmartAction } from './learnings.js';
import { writeFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

function captureState(game, dcHealthState, dcMessageMeta) {
  const figures = { 1: {}, 2: {} };
  const hp = {};

  for (const playerNum of [1, 2]) {
    for (const [fk, coord] of Object.entries(game.figurePositions?.[playerNum] || {})) {
      figures[playerNum][fk] = coord;
    }
  }

  for (const [msgId, healthArr] of dcHealthState) {
    const meta = dcMessageMeta.get(msgId);
    if (!meta) continue;
    hp[msgId] = {
      dcName: meta.dcName,
      displayName: meta.displayName,
      playerNum: meta.playerNum,
      figures: healthArr.map(([cur, max]) => ({ current: cur, max })),
    };
  }

  return {
    round: game.currentRound || game.round || 1,
    phase: game.phase,
    roundPhase: game.roundPhase,
    currentActivationTurnPlayerId: game.currentActivationTurnPlayerId,
    p1VP: { ...game.player1VP },
    p2VP: { ...game.player2VP },
    p1ActivationsRemaining: game.p1ActivationsRemaining,
    p2ActivationsRemaining: game.p2ActivationsRemaining,
    figures,
    hp,
    ended: game.ended || false,
    winnerId: game.winnerId || null,
    activeDcMsgId: game.activeDcMsgId || null,
    pendingCombat: game.pendingCombat ? {
      attacker: game.pendingCombat.attacker,
      target: game.pendingCombat.target,
      phase: game.pendingCombat.phase,
    } : null,
  };
}

/**
 * Manhattan distance between two coordinate strings (e.g. "e5", "g7").
 */
function coordDistance(a, b) {
  const pa = parseCoord(a);
  const pb = parseCoord(b);
  return Math.abs(pa.col - pb.col) + Math.abs(pa.row - pb.row);
}

/**
 * Find the minimum distance from a coordinate to any enemy figure.
 */
function distToNearestEnemy(coord, game, playerNum) {
  const oppNum = playerNum === 1 ? 2 : 1;
  const oppFigs = game.figurePositions?.[oppNum] || {};
  let minDist = Infinity;
  for (const pos of Object.values(oppFigs)) {
    const d = coordDistance(coord, pos);
    if (d < minDist) minDist = d;
  }
  return minDist;
}

/**
 * Prioritized action picker — strict priority ordering.
 * Strategy: attack first, move toward enemies, abilities before attack
 * if they're damaging or positioning abilities.
 *
 * 1. Phase gates / round transitions (advance game flow)
 * 2. Combat flow (always resolve combat in progress)
 * 3. Attacks with specific targets (the main way to win)
 * 4. Movement toward enemies (get into attack range)
 * 5. End activation (only after movement + attacks exhausted)
 * 6. Activate a DC (start new activation)
 * 7. End turn / pass (fallback)
 */
function pickAction(allActions, game) {
  const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];

  // 1. Phase gates / round transitions
  const gates = allActions.filter(a => a.type === 'phase_gate_ready');
  if (gates.length > 0) return pick(gates);
  const transitions = allActions.filter(a =>
    a.type === 'end_end_of_round' || a.type === 'end_start_of_round' ||
    a.type === 'end_activation_phase'
  );
  if (transitions.length > 0) return pick(transitions);

  // 2. Combat flow
  const combat = allActions.filter(a => a.type?.startsWith('combat_'));
  if (combat.length > 0) return pick(combat);

  // 3. Attacks with targets
  const attacks = allActions.filter(a => a.type === 'attack_target' && a.params?.targetFigureKey);
  if (attacks.length > 0) return pick(attacks);

  // 4. Movement toward enemies — only when no attacks available
  // If move is in progress (pick_space available), move toward closest enemy
  const moveSpaces = allActions.filter(a => a.type === 'move_pick_space' && !a.params?.done);
  if (moveSpaces.length > 0 && game) {
    const scored = moveSpaces.map(a => ({
      action: a,
      dist: distToNearestEnemy(a.params?.coord || '', game, a.actingPlayer),
    }));
    scored.sort((a, b) => a.dist - b.dist);
    const bestDist = scored[0].dist;
    const tied = scored.filter(s => s.dist === bestDist);
    return pick(tied).action;
  }
  // If move in progress but no spaces (boxed in or no figure), finish it
  const moveFinish = allActions.filter(a => a.type === 'move_pick_space' && a.params?.done);
  if (moveFinish.length > 0) return pick(moveFinish);

  // Start a new move (failed moves already filtered at loop level)
  const endAct = allActions.filter(a => a.type === 'dc_end_activation');
  const moveStart = allActions.filter(a => a.type === 'move_figure');
  if (moveStart.length > 0) {
    return pick(moveStart);
  }

  // 5. End activation
  if (endAct.length > 0) return pick(endAct);

  // 6. Activate a DC
  const activate = allActions.filter(a => a.type === 'activate_dc');
  if (activate.length > 0) return pick(activate);

  // 7. End turn / pass
  const endTurn = allActions.filter(a => a.type === 'end_turn');
  if (endTurn.length > 0) return pick(endTurn);
  const pass = allActions.filter(a => a.type === 'pass_activation_turn');
  if (pass.length > 0) return pick(pass);

  // 8. Fallback
  return pick(allActions);
}

async function recordGame() {
  const p1Army = [
    { dcName: 'Luke Skywalker' },
    { dcName: 'Han Solo' },
  ];
  const p2Army = [
    { dcName: 'IG-88' },
    { dcName: 'Stormtrooper (Elite)' },
  ];

  const { game, harness, deps, dcMessageMeta, dcExhaustedState, dcHealthState } = createTestGame()
    .withMap('mos-eisley-outskirts')
    .withPlayer1Army(p1Army)
    .withPlayer2Army(p2Army)
    .inRound(1)
    .build();

  const mapSpaces = getMapSpaces('mos-eisley-outskirts');
  const actionDeps = {
    dcMessageMeta, dcExhaustedState, dcHealthState, getDcStats, getMapSpaces,
    computeMovementCache, getBoardStateForMovement, getMovementProfile,
  };

  const replay = {
    metadata: {
      mapId: 'mos-eisley-outskirts',
      p1Army: p1Army.map(a => a.dcName + (a.count > 1 ? ` x${a.count}` : '')),
      p2Army: p2Army.map(a => a.dcName + (a.count > 1 ? ` x${a.count}` : '')),
      player1Id: game.player1Id,
      player2Id: game.player2Id,
      spaces: mapSpaces?.spaces || [],
      adjacency: mapSpaces?.adjacency || {},
    },
    frames: [],
    log: [],
  };

  // Load learned strategy
  const learningsPath = join(__dirname, 'learnings-data.json');
  const learnings = loadLearnings(learningsPath);
  const useLearnings = learnings.meta.totalGames > 0;
  if (useLearnings) {
    console.log(`Using learned strategy (${learnings.meta.totalGames} games trained)`);
  }
  const tracer1 = createGameTracer(learnings, 1, dcHealthState, dcMessageMeta);
  const tracer2 = createGameTracer(learnings, 2, dcHealthState, dcMessageMeta);

  // Initial frame
  replay.frames.push(captureState(game, dcHealthState, dcMessageMeta));
  replay.log.push({ iteration: 0, action: 'Game Start', player: null, description: 'Game initialized' });

  const MAX_ITERATIONS = 1500;
  let consecutiveEmpty = 0;
  const failedMoves = new Set();
  let lastMoveId = null;

  for (let i = 0; i < MAX_ITERATIONS; i++) {
    const g = harness.getGame();
    if (g.ended) break;

    const p1Actions = getAvailableActions(g, 1, actionDeps);
    const p2Actions = getAvailableActions(g, 2, actionDeps);
    const allActions = [
      ...p1Actions.map(a => ({ ...a, actingPlayer: 1 })),
      ...p2Actions.map(a => ({ ...a, actingPlayer: 2 })),
    ].filter(a => {
      // Skip generic attack fallbacks (dc_attack_ without target info) — Discord-only
      if (a.type === 'attack_target' && !a.params?.targetFigureKey) return false;
      return true;
    });

    if (allActions.length === 0) {
      consecutiveEmpty++;
      if (consecutiveEmpty > 10) {
        // Deadlock — force damage
        const p2Figs = Object.keys(g.figurePositions?.[2] || {});
        const p1Figs = Object.keys(g.figurePositions?.[1] || {});
        if (p2Figs.length > 0) {
          await deps.applyNpcDamageToFigure(g, 2, p2Figs[0], 999, 'Deadlock breaker');
          replay.log.push({ iteration: i + 1, action: 'NPC Damage', player: null, description: `Deadlock breaker: killed P2 figure ${p2Figs[0]}` });
        } else if (p1Figs.length > 0) {
          await deps.applyNpcDamageToFigure(g, 1, p1Figs[0], 999, 'Deadlock breaker');
          replay.log.push({ iteration: i + 1, action: 'NPC Damage', player: null, description: `Deadlock breaker: killed P1 figure ${p1Figs[0]}` });
        } else {
          break;
        }
        replay.frames.push(captureState(g, dcHealthState, dcMessageMeta));
        consecutiveEmpty = 0;
      }
      continue;
    }
    consecutiveEmpty = 0;

    // Track failed move_figure attempts per DC to avoid infinite loops
    const hasMoveSpaces = allActions.some(a => a.type === 'move_pick_space');
    if (lastMoveId && !hasMoveSpaces) {
      failedMoves.add(lastMoveId);
    }
    if (hasMoveSpaces) {
      lastMoveId = null;
    }
    // Reset failed moves at start of each activation (new DC might move fine)
    if (allActions.some(a => a.type === 'activate_dc') && !allActions.some(a => a.type === 'dc_end_activation')) {
      failedMoves.clear();
    }

    // Filter out failed moves before action selection
    const filteredActions = allActions.filter(a => {
      if (a.type === 'move_figure' && failedMoves.has(a.customId)) return false;
      return true;
    });
    const actionsPool = filteredActions.length > 0 ? filteredActions : allActions;

    // Action selection — use learned strategy if available, otherwise heuristic
    let action;
    if (useLearnings) {
      const turnPlayer = g.currentActivationTurnPlayerId === g.player1Id ? 1 : 2;
      const turnActions = actionsPool.filter(a => a.actingPlayer === turnPlayer);
      const otherPlayer = turnPlayer === 1 ? 2 : 1;
      const otherActs = actionsPool.filter(a => a.actingPlayer === otherPlayer);
      let actingPN;
      if (turnActions.length > 0 && otherActs.length > 0) {
        const otherMandatory = otherActs.some(a => ['phase_gate_ready','combat_ready','combat_roll'].includes(a.type));
        const turnMandatory = turnActions.some(a => ['phase_gate_ready','combat_ready','combat_roll'].includes(a.type));
        actingPN = (otherMandatory && !turnMandatory) ? otherPlayer : turnPlayer;
      } else {
        actingPN = turnActions.length > 0 ? turnPlayer : otherPlayer;
      }
      const playerActions = actionsPool.filter(a => a.actingPlayer === actingPN);
      const tr = actingPN === 1 ? tracer1 : tracer2;
      tr.beforeAction(g);
      action = pickSmartAction(playerActions, g, learnings, actingPN, dcHealthState, dcMessageMeta);
    } else {
      action = pickAction(actionsPool, g);
    }

    // Track move_figure for failed move detection
    if (action.type === 'move_figure') lastMoveId = action.customId;

    const userId = action.actingPlayer === 1 ? g.player1Id : g.player2Id;
    const playerLabel = action.actingPlayer === 1 ? 'P1' : 'P2';
    const tracer = action.actingPlayer === 1 ? tracer1 : tracer2;

    try {
      const result = await harness.submitAction(action.customId, userId);
      if (useLearnings) tracer.afterAction(harness.getGame(), action);
      const desc = action.description || action.customId;
      const logEntry = {
        iteration: i + 1,
        action: action.type,
        customId: action.customId,
        player: playerLabel,
        description: `${playerLabel}: ${desc}`,
      };
      if (result?.error) {
        logEntry.error = result.error;
        logEntry.description += ` [ERROR: ${result.error}]`;
      }
      replay.log.push(logEntry);
    } catch (err) {
      if (useLearnings) tracer.afterAction(harness.getGame(), action);
      replay.log.push({
        iteration: i + 1,
        action: action.type,
        customId: action.customId,
        player: playerLabel,
        description: `${playerLabel}: ${action.description || action.customId} [CRASH: ${err.message}]`,
        error: err.message,
      });
    }

    // Capture state after each action
    replay.frames.push(captureState(harness.getGame(), dcHealthState, dcMessageMeta));
  }

  // Finalize learning tracers
  const finalGame = harness.getGame();
  if (useLearnings) {
    tracer1.finalize(finalGame, true);
    tracer2.finalize(finalGame, false);
    saveLearnings(learnings, learningsPath);
  }

  // Final summary
  replay.summary = {
    ended: finalGame.ended || false,
    winnerId: finalGame.winnerId || null,
    winnerLabel: finalGame.winnerId === finalGame.player1Id ? 'Player 1' : finalGame.winnerId === finalGame.player2Id ? 'Player 2' : null,
    totalIterations: replay.frames.length - 1,
    totalRounds: finalGame.currentRound || finalGame.round || 1,
    finalVP: {
      p1: finalGame.player1VP?.total || 0,
      p2: finalGame.player2VP?.total || 0,
    },
  };

  const outPath = join(__dirname, 'replay-data.json');
  writeFileSync(outPath, JSON.stringify(replay, null, 2));
  console.log(`Replay saved to ${outPath}`);
  console.log(`Frames: ${replay.frames.length}, Log entries: ${replay.log.length}`);
  console.log(`Result: ${replay.summary.ended ? `${replay.summary.winnerLabel} wins!` : 'Game did not end'}`);
  console.log(`Final VP — P1: ${replay.summary.finalVP.p1}, P2: ${replay.summary.finalVP.p2}`);
}

recordGame().catch(err => {
  console.error('Recording failed:', err);
  process.exit(1);
});
