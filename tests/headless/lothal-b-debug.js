/**
 * Targeted diagnostic: verify the fluctuation swap skip fix works on lothal-wastes:b.
 */
import { createTestGame } from '../fixtures/game-builder.js';
import { getAvailableActions } from '../../src/engine/available-actions.js';
import { getDcStats, getMapData } from '../../src/data-loader.js';
import { computeMovementCache, getBoardStateForMovement, getMovementProfile } from '../../src/game/movement.js';
import { getPlayableCcFromHand } from '../../src/game/cc-timing.js';
import { canResolveCcHeadless } from '../../src/headless/headless-cc-play.js';
import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const TEST_DECKS = JSON.parse(readFileSync(join(__dirname, '../../data/destruct-test-decks.json'), 'utf8'));

const p1Deck = TEST_DECKS[0];
let j = 17 % TEST_DECKS.length;
if (j === 0) j = 1;
const p2Deck = TEST_DECKS[j];

const builder = createTestGame()
  .withMap('lothal-wastes')
  .withMissionVariant('b')
  .withPlayer1Army(p1Deck.dcList.map(n => ({ dcName: n })))
  .withPlayer2Army(p2Deck.dcList.map(n => ({ dcName: n })));
if (p1Deck.ccList?.length > 0) builder.withPlayer1CcDeck(p1Deck.ccList);
if (p2Deck.ccList?.length > 0) builder.withPlayer2CcDeck(p2Deck.ccList);

const { game: g, harness, deps, dcMessageMeta, dcExhaustedState, dcHealthState } = builder.inRound(1).build();
const hDeps = harness.getDeps();
const actionDeps = {
  dcMessageMeta, dcExhaustedState, dcHealthState, getDcStats, getMapData,
  computeMovementCache, getBoardStateForMovement, getMovementProfile,
  getPlayableCcFromHand,
  getPlayableCcSpecialsForDc: hDeps.getPlayableCcSpecialsForDc,
  getPlayableCcDoubleActionsForDc: hDeps.getPlayableCcDoubleActionsForDc,
};

console.log('=== LOTHAL-WASTES:B FLUCTUATION SKIP FIX TEST ===');
console.log('Map:', g.selectedMap?.id, 'Mission:', g.selectedMission?.variant);
console.log('');

const failedMoves = new Set();
let lastMoveId = null;
let consecutiveEmpty = 0;
let fluctuationSkips = 0;

for (let iter = 0; iter < 5000; iter++) {
  // === FIX: Auto-skip fluctuation swap when pending ===
  if (g.pendingFluctuationSwapQueue?.length > 0) {
    const skipId = `fluctuation_skip_${g.gameId}`;
    const pn = g.pendingFluctuationSwapQueue[0];
    const userId = pn === 1 ? g.player1Id : g.player2Id;
    try {
      await harness.submitAction(skipId, userId);
      fluctuationSkips++;
      if (fluctuationSkips <= 10) console.log(`  SKIP fluctuation swap for P${pn} (iter=${iter})`);
    } catch (e) {
      console.log(`  SKIP ERROR for P${pn}: ${e.message?.substring(0, 100)}`);
    }
    continue;
  }

  const p1Raw = getAvailableActions(g, 1, actionDeps).map(a => ({ ...a, actingPlayer: 1 }));
  const p2Raw = getAvailableActions(g, 2, actionDeps).map(a => ({ ...a, actingPlayer: 2 }));

  const filterActions = (actions) => (actions || []).filter(a => {
    if (a.type === 'attack_target' && !a.params?.targetFigureKey) return false;
    if (a.type === 'play_cc' || a.type === 'play_cc_special' || a.type === 'play_cc_double') {
      if (!canResolveCcHeadless(g, a.actingPlayer, a.params?.cardName, hDeps)) return false;
    }
    if (a.type === 'move_figure' && failedMoves.has(a.customId)) return false;
    if (a.type === 'interact' && a.params?.optionId === 'use_terminal') return false;
    if (a.type === 'phase_gate_unready') return false;
    return true;
  });
  const p1 = filterActions(p1Raw);
  const p2 = filterActions(p2Raw);

  const hasMoveSpaces = [...p1, ...p2].some(a => a.type === 'move_pick_space');
  if (lastMoveId && !hasMoveSpaces) failedMoves.add(lastMoveId);
  if (hasMoveSpaces) lastMoveId = null;
  if ([...p1, ...p2].some(a => a.type === 'activate_dc') &&
      ![...p1, ...p2].some(a => a.type === 'dc_end_activation')) {
    failedMoves.clear();
  }

  const all = [...p1, ...p2];

  if (all.length === 0) {
    if (g.phaseGate) {
      const gateCustomId = `phase_gate_ready_${g.gameId}`;
      if (!g.phaseGate.p1Ready) try { await harness.submitAction(gateCustomId, g.player1Id); } catch {}
      if (!g.phaseGate.p2Ready) try { await harness.submitAction(gateCustomId, g.player2Id); } catch {}
      continue;
    }
    consecutiveEmpty++;
    if (consecutiveEmpty > 10) {
      console.log(`\nSTUCK at iter=${iter} (no_actions_10x)`);
      console.log('Phase:', g.phase, '/', g.roundPhase, 'Round:', g.currentRound);
      const pk = Object.keys(g).filter(k => k.startsWith('pending') && g[k] != null && g[k] !== false);
      console.log('Pending:', pk.length > 0 ? pk : 'NONE');
      break;
    }
    continue;
  }
  consecutiveEmpty = 0;

  // Use strategy-like picking: just use first action for acting player
  const acting = g.actingPlayer || 1;
  const myActions = all.filter(a => a.actingPlayer === acting);
  const picked = myActions[0] || all[0];
  if (picked.type === 'move_figure') lastMoveId = picked.customId;

  // Log round transitions
  if (picked.type === 'activate_dc' || picked.type === 'pass_activation_turn') {
    console.log(`  iter=${iter} pn=${picked.actingPlayer} type=${picked.type} round=${g.currentRound}`);
  }

  try {
    const userId = picked.actingPlayer === 1 ? g.player1Id : g.player2Id;
    await harness.submitAction(picked.customId, userId);
  } catch {}

  // Check for game end
  if (g.ended) {
    const totalVP = (g.player1VP?.total || 0) + (g.player2VP?.total || 0);
    console.log(`\n=== GAME COMPLETED ===`);
    console.log(`Rounds: ${g.currentRound}`);
    console.log(`Total VP: ${totalVP} (P1: ${g.player1VP?.total || 0}, P2: ${g.player2VP?.total || 0})`);
    console.log(`Kills VP: ${(g.player1VP?.kills || 0) + (g.player2VP?.kills || 0)}`);
    console.log(`Obj VP: ${(g.player1VP?.objectives || 0) + (g.player2VP?.objectives || 0)}`);
    console.log(`Fluctuation skips: ${fluctuationSkips}`);
    break;
  }

  // Max rounds check
  if ((g.currentRound || 1) > 10) {
    const totalVP = (g.player1VP?.total || 0) + (g.player2VP?.total || 0);
    console.log(`\n=== MAX ROUNDS (${g.currentRound}) ===`);
    console.log(`Total VP: ${totalVP}`);
    console.log(`Fluctuation skips: ${fluctuationSkips}`);
    break;
  }
}

console.log('\nDone.');
