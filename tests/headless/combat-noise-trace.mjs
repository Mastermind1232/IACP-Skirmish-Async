/**
 * Combat-window action-space noise diagnostic.
 * Mirrors production-path-diagnostic.js exactly, with stall-escape fix.
 * Logs action distributions during stalls to verify fix.
 */
import { createTestGame } from '../fixtures/game-builder.js';
import { getAvailableActions } from '../../src/engine/available-actions.js';
import { getDcStats, getMapData, getCcEffect } from '../../src/data-loader.js';
import { getPlayableCcFromHand } from '../../src/game/cc-timing.js';
import { computeMovementCache, getBoardStateForMovement, getMovementProfile } from '../../src/game/movement.js';
import { playCommandCardHeadless, canResolveCcHeadless } from '../../src/headless/headless-cc-play.js';
import { pickBestAction, resetRuntimeStats } from '../../src/ai/strategy.js';
import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const TEST_DECKS = JSON.parse(readFileSync(join(__dirname, '../../data/destruct-test-decks.json'), 'utf8'));

const MAP_ID = process.argv[2] || 'hoth-battle-station';
const MISSION = process.argv[3] || 'b';
const GAME_IDX = parseInt(process.argv[4] || '2', 10);
const CC_MAX_RETRIES = 3;
const STALL_ESCAPE_THRESHOLD = 15;

async function trace() {
  const i = GAME_IDX % TEST_DECKS.length;
  let j = (GAME_IDX + 17) % TEST_DECKS.length;
  if (j === i) j = (j + 1) % TEST_DECKS.length;
  const p1Deck = TEST_DECKS[i];
  const p2Deck = TEST_DECKS[j];

  console.log(`Map: ${MAP_ID} Mission: ${MISSION} DeckIdx: ${GAME_IDX}`);
  console.log(`P1 army: ${p1Deck.dcList.join(', ')}`);
  console.log(`P2 army: ${p2Deck.dcList.join(', ')}`);

  const builder = createTestGame()
    .withMap(MAP_ID)
    .withMissionVariant(MISSION)
    .withPlayer1Army(p1Deck.dcList.map(n => ({ dcName: n })))
    .withPlayer2Army(p2Deck.dcList.map(n => ({ dcName: n })));
  if (p1Deck.ccList?.length > 0) builder.withPlayer1CcDeck(p1Deck.ccList);
  if (p2Deck.ccList?.length > 0) builder.withPlayer2CcDeck(p2Deck.ccList);

  const { game: g, harness, dcMessageMeta, dcExhaustedState, dcHealthState } = builder.inRound(1).build();
  const hDeps = harness.getDeps();
  const actionDeps = {
    dcMessageMeta, dcExhaustedState, dcHealthState, getDcStats, getMapData,
    computeMovementCache, getBoardStateForMovement, getMovementProfile,
    getPlayableCcFromHand,
    getPlayableCcSpecialsForDc: hDeps.getPlayableCcSpecialsForDc,
    getPlayableCcDoubleActionsForDc: hDeps.getPlayableCcDoubleActionsForDc,
  };
  const engine = { getState: () => harness.getGame() };

  function boardFingerprint(game) {
    const p1hp = dcHealthState ? [...dcHealthState.values()].reduce((s, arr) => {
      for (const fig of arr) if (fig) s += fig[0]; return s;
    }, 0) : 0;
    const p1figs = Object.keys(game.figurePositions?.[1] || {}).length;
    const p2figs = Object.keys(game.figurePositions?.[2] || {}).length;
    const p1vp = game.player1VP?.total || 0;
    const p2vp = game.player2VP?.total || 0;
    const round = game.currentRound || 1;
    const phase = game.roundPhase || '?';
    const pending = game.pendingCombat ? 'C' : game.moveInProgress ? 'M' : game.phaseGate ? 'G' : '';
    const p1rem = game.p1ActivationsRemaining ?? 0;
    const p2rem = game.p2ActivationsRemaining ?? 0;
    const actIdx = (game.p1ActivatedDcIndices?.length ?? 0) + (game.p2ActivatedDcIndices?.length ?? 0);
    let actionsRem = 0;
    for (const v of Object.values(game.dcActionsData || {})) actionsRem += (v?.remaining ?? 0);
    const posHash = [1, 2].map(pn =>
      Object.entries(game.figurePositions?.[pn] || {}).sort().map(([k, v]) => `${k}@${v}`).join(',')
    ).join('|');
    return `${round}:${phase}:${p1vp}:${p2vp}:${p1figs}:${p2figs}:${p1hp}:${p1rem}+${p2rem}:${actIdx}:${actionsRem}:${pending}:${posHash}`;
  }

  let lastFp = '';
  let noProgressCount = 0;
  const failedMoves = new Set();
  let lastMoveId = null;
  let lastChosenMoveKey = null;
  const ccFailureCounts = new Map();
  let ccFiltered = 0;
  let stallEscapes = 0;
  let maxStall = 0;

  resetRuntimeStats();

  for (let iter = 0; iter < 5000; iter++) {
    const round = g.currentRound || 1;
    const fp = boardFingerprint(g);

    if (fp === lastFp) {
      noProgressCount++;
      if (noProgressCount > maxStall) maxStall = noProgressCount;
      if (noProgressCount >= 80) {
        console.log(`\nNO_PROGRESS at iter=${iter} round=${round} phase=${g.roundPhase}`);
        break;
      }
    } else {
      noProgressCount = 0;
      lastFp = fp;
    }

    // Fingerprint-based move failure detection
    if (noProgressCount > 0 && lastChosenMoveKey) {
      failedMoves.add(lastChosenMoveKey);
      lastChosenMoveKey = null;
    }

    if (g.ended) { console.log(`GAME ENDED at iter=${iter} R${round}`); break; }
    if (round > 11) { console.log(`MAX_ROUNDS at iter=${iter}`); break; }

    if (g.pendingMissionSorReveal) {
      try { await harness.submitAction(`sor_mission_reveal_${g.gameId}`, g.player1Id); } catch {}
      continue;
    }

    // Get raw actions, then filter (mirroring production-path-diagnostic.js)
    const p1ActionsRaw = getAvailableActions(g, 1, actionDeps).map(a => ({ ...a, actingPlayer: 1 }));
    const p2ActionsRaw = getAvailableActions(g, 2, actionDeps).map(a => ({ ...a, actingPlayer: 2 }));

    const filterActions = (actions) => (actions || []).filter(a => {
      if (a.type === 'attack_target' && !a.params?.targetFigureKey) return false;
      if (a.type === 'play_cc' || a.type === 'play_cc_special' || a.type === 'play_cc_double') {
        if (!canResolveCcHeadless(g, a.actingPlayer, a.params.cardName, hDeps)) { ccFiltered++; return false; }
        const ccKey = `P${a.actingPlayer}:${a.params.cardName}:R${g.currentRound || 1}`;
        if ((ccFailureCounts.get(ccKey) || 0) >= CC_MAX_RETRIES) { ccFiltered++; return false; }
      }
      if (a.type === 'move_figure' && failedMoves.has(a.customId)) return false;
      if (a.type === 'interact' && a.params?.optionId === 'use_terminal') return false;
      if (a.type === 'phase_gate_unready') return false;
      return true;
    });

    const p1Actions = filterActions(p1ActionsRaw);
    const p2Actions = filterActions(p2ActionsRaw);

    // Track failed move_figure
    const hasMoveSpaces = [...p1Actions, ...p2Actions].some(a => a.type === 'move_pick_space');
    if (lastMoveId && !hasMoveSpaces) failedMoves.add(lastMoveId);
    if (hasMoveSpaces) lastMoveId = null;
    if ([...p1Actions, ...p2Actions].some(a => a.type === 'activate_dc') &&
        ![...p1Actions, ...p2Actions].some(a => a.type === 'dc_end_activation')) {
      failedMoves.clear();
    }

    if (p1Actions.length === 0 && p2Actions.length === 0) { console.log(`NO ACTIONS at iter=${iter}`); break; }

    const turnPlayer = g.currentActivationTurnPlayerId === g.player1Id ? 1 : 2;
    const pn = (turnPlayer === 1 ? p1Actions : p2Actions).length > 0 ? turnPlayer : (turnPlayer === 1 ? 2 : 1);
    const actions = pn === 1 ? p1Actions : p2Actions;
    const result = pickBestAction(engine, actions, pn, actionDeps);
    let chosen = result?.action || actions[0];
    if (!chosen) break;

    // Stall-escape: after threshold, override DQN
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
      if (escape && escape !== chosen) {
        stallEscapes++;
        if (stallEscapes <= 5) console.log(`  STALL-ESCAPE[${noProgressCount}] P${pn} ${chosen.type} → ${escape.type} R${round}`);
        chosen = escape;
      }
    }

    chosen.actingPlayer = pn;
    lastChosenMoveKey = (chosen.type === 'move_pick_space' && chosen.params?.coord)
      ? `${chosen.params.moveKey}_${chosen.params.coord}` : null;
    if (chosen.type === 'move_figure') lastMoveId = chosen.customId;

    // Failed move_pick_space detection (existing production logic)
    if (chosen.type === 'move_pick_space' && chosen.params?.coord) {
      const moveKey = `${chosen.params.moveKey}_${chosen.params.coord}`;
      if (failedMoves.has(moveKey)) {
        const doneAction = actions.find(a => a.type === 'move_pick_space' && a.params?.done);
        if (doneAction) {
          try { await harness.submitAction(doneAction.customId, pn === 1 ? g.player1Id : g.player2Id); } catch {}
          continue;
        }
      }
    }

    // Execute
    try {
      if (chosen.type === 'play_cc' || chosen.type === 'play_cc_special' || chosen.type === 'play_cc_double') {
        if (chosen.type === 'play_cc_special' || chosen.type === 'play_cc_double') {
          const actData = g.dcActionsData?.[chosen.params.msgId];
          if (actData && typeof actData.remaining === 'number') {
            if (chosen.type === 'play_cc_special') actData.remaining = Math.max(0, actData.remaining - 1);
            else actData.remaining = 0;
          }
        }
        const ccResult = await playCommandCardHeadless(g, chosen.actingPlayer, chosen.params.cardName, hDeps);
        if (ccResult?.played === false) {
          const ccKey = `P${chosen.actingPlayer}:${chosen.params.cardName}:R${g.currentRound || 1}`;
          ccFailureCounts.set(ccKey, (ccFailureCounts.get(ccKey) || 0) + 1);
        }
      } else {
        const res = await harness.submitAction(chosen.customId, chosen.actingPlayer === 1 ? g.player1Id : g.player2Id);
        if (chosen.type === 'move_figure' && res?.error) failedMoves.add(chosen.customId);
        if (chosen.type === 'move_pick_space' && chosen.params?.coord) {
          // Also mark coord as failed if submitAction threw
        }
      }
    } catch (err) {
      if (chosen.type === 'move_pick_space' && chosen.params?.coord) {
        failedMoves.add(`${chosen.params.moveKey}_${chosen.params.coord}`);
      }
    }
  }

  console.log(`\n=== SUMMARY ===`);
  console.log(`Stall escapes: ${stallEscapes}`);
  console.log(`Max consecutive stall: ${maxStall}`);
  console.log(`CC filtered: ${ccFiltered}`);
  console.log(`Final round: ${g.currentRound || 1}`);
  console.log(`VP: P1=${g.player1VP?.total || 0} P2=${g.player2VP?.total || 0}`);
}
trace().catch(e => console.error(e.stack));
