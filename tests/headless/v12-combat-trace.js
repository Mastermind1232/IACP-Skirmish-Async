/**
 * v12 Combat Trace — narrow diagnostic for 0-kill anomaly.
 *
 * Runs 3 oracle games with full combat lifecycle logging:
 *   - Every attack declaration (target, attacker, HP before)
 *   - Every combat resolution (dice, damage, HP after)
 *   - Every HP change across all figures
 *   - Every figure defeat
 *
 * Question: "Are attacks actually dealing damage and reducing HP,
 *            or is combat silently failing / being nullified?"
 *
 * Usage: node tests/headless/v12-combat-trace.js
 */
import { createTestGame } from '../fixtures/game-builder.js';
import { getAvailableActions } from '../../src/engine/available-actions.js';
import { getDcStats, getMapData, getDcEffects } from '../../src/data-loader.js';
import { getBoardStateForMovement, getMovementProfile, computeMovementCache } from '../../src/game/movement.js';
import { getPlayableCcFromHand } from '../../src/game/cc-timing.js';
import { playCommandCardHeadless, canResolveCcHeadless } from '../../src/headless/headless-cc-play.js';
import { parseCoord } from '../../src/game/coords.js';
import { getCcHand } from '../../src/game/player-helpers.js';
import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const TEST_DECKS = JSON.parse(readFileSync(join(__dirname, '../../data/destruct-test-decks.json'), 'utf8'));

// ── Config ───────────────────────────────────────────────────────────────────
const NUM_GAMES = 3;
const MAX_ITERATIONS = 10000;
const MAX_ROUNDS = 10;

// ── Helpers ──────────────────────────────────────────────────────────────────
function coordDistance(a, b) {
  const pa = parseCoord(a);
  const pb = parseCoord(b);
  return Math.abs(pa.col - pb.col) + Math.abs(pa.row - pb.row);
}

function pickMatchup(gameNum) {
  const i = gameNum % TEST_DECKS.length;
  let j = (gameNum + 17) % TEST_DECKS.length;
  if (j === i) j = (j + 1) % TEST_DECKS.length;
  return { p1Deck: TEST_DECKS[i], p2Deck: TEST_DECKS[j] };
}

/** Snapshot all HP from dcHealthState Map */
function snapshotHp(dcHealthState) {
  const snap = new Map();
  for (const [msgId, healthArr] of dcHealthState.entries()) {
    if (!Array.isArray(healthArr)) continue;
    snap.set(msgId, healthArr.map(h => Array.isArray(h) ? [...h] : h));
  }
  return snap;
}

/** Compare two HP snapshots, return list of changes */
function diffHp(before, after, dcMessageMeta) {
  const changes = [];
  for (const [msgId, afterHealth] of after.entries()) {
    const beforeHealth = before.get(msgId) || [];
    if (!Array.isArray(afterHealth)) continue;
    for (let i = 0; i < afterHealth.length; i++) {
      const bh = beforeHealth[i];
      const ah = afterHealth[i];
      if (!Array.isArray(bh) || !Array.isArray(ah)) continue;
      const [bCur, bMax] = bh;
      const [aCur, aMax] = ah;
      if (bCur !== aCur) {
        // Look up DC name from meta
        let dcName = '?';
        for (const [, meta] of dcMessageMeta.entries()) {
          if (meta.msgId === msgId) { dcName = meta.dcName || meta.displayName || '?'; break; }
        }
        changes.push({
          msgId, figIdx: i, dcName,
          hpBefore: bCur, hpAfter: aCur, maxHp: bMax,
          delta: aCur - bCur,
          defeated: aCur <= 0 && bCur > 0,
        });
      }
    }
  }
  return changes;
}

/** Count all living figures */
function countFigures(game) {
  const p1 = Object.keys(game.figurePositions?.[1] || {}).length;
  const p2 = Object.keys(game.figurePositions?.[2] || {}).length;
  return { p1, p2, total: p1 + p2 };
}

// ── Oracle (reused from v11) ────────────────────────────────────────────────

function lookupHp(figureKey, playerNum, dcHealthState, dcMessageMeta) {
  if (!figureKey || !dcHealthState || !dcMessageMeta) return null;
  const dcName = figureKey.replace(/-\d+-\d+$/, '');
  const parts = figureKey.split('-');
  const figIdx = parseInt(parts[parts.length - 1], 10) || 0;
  for (const [, meta] of dcMessageMeta.entries()) {
    if (meta.dcName === dcName && meta.playerNum === playerNum) {
      const health = dcHealthState.get(meta.msgId);
      if (health && Array.isArray(health[figIdx])) {
        return { current: health[figIdx][0], max: health[figIdx][1] };
      }
    }
  }
  return null;
}

function getAttackerPos(action, game, dcMessageMeta) {
  const fk = action.params?.attackerFigureKey;
  if (!fk) return null;
  const pn = action.actingPlayer;
  return game.figurePositions?.[pn]?.[fk] || null;
}

function findWeakestEnemy(oppNum, oppFigPositions, dcHealthState, dcMessageMeta) {
  const entries = Object.entries(oppFigPositions);
  if (entries.length === 0) return null;
  let best = null;
  for (const [fk, pos] of entries) {
    const hp = lookupHp(fk, oppNum, dcHealthState, dcMessageMeta);
    const cur = hp?.current ?? 99;
    const max = hp?.max ?? 99;
    if (!best || cur < best.current || (cur === best.current && max < best.max)) {
      best = { figureKey: fk, pos, current: cur, max };
    }
  }
  return best;
}

function pickOracleAction(allActions, game, actingPN, dcHealthState, dcMessageMeta) {
  if (allActions.length === 0) return null;
  if (allActions.length === 1) return allActions[0];
  const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];
  const oppNum = actingPN === 1 ? 2 : 1;
  const oppFigPositions = game.figurePositions?.[oppNum] || {};
  const myFigPositions = game.figurePositions?.[actingPN] || {};

  // 1. Mandatory
  const gates = allActions.filter(a => a.type === 'phase_gate_ready');
  if (gates.length > 0) return pick(gates);
  const transitions = allActions.filter(a =>
    a.type === 'end_end_of_round' || a.type === 'end_start_of_round' || a.type === 'end_activation_phase');
  if (transitions.length > 0) return pick(transitions);

  // 2. Reactive
  const reactiveTypes = [
    'negation_play','negation_let_resolve','celebration_play','celebration_pass',
    'cover_fire_block','cover_fire_skip','still_faster_use','still_faster_skip','still_faster_dc_pick',
    'hunter_protocol_trigger','hunter_protocol_skip','last_resort_use','last_resort_skip',
    'strike_me_down_yes','strike_me_down_no','slow_on_draw_yes','slow_on_draw_no',
    'force_exhaustion_yes','force_exhaustion_no','illicit_arms_pick','illicit_arms_skip','illicit_arms_use',
    'tough_luck_remove','tough_luck_skip','power_converter_approve','power_converter_skip',
    'power_converter_die','power_converter_color','there_is_no_try_die','there_is_no_try_face',
    'there_is_no_try_skip','strain_choice_alldmg','strain_choice_discard','force_vision_pick',
  ];
  const reactive = allActions.filter(a => reactiveTypes.includes(a.type));
  if (reactive.length > 0) {
    const proactive = reactive.filter(a =>
      a.type.includes('_play') || a.type.includes('_use') || a.type.includes('_trigger') ||
      a.type.includes('_yes') || a.type.includes('_block') || a.type.includes('_remove') ||
      a.type === 'strain_choice_alldmg');
    return proactive.length > 0 ? pick(proactive) : pick(reactive);
  }

  const pendingTypes = [
    'dc_ability_choice','pounce_space','missile_salvo_die','missile_salvo_done',
    'power_token_choice','spread_pain_cond',
  ];
  const pending = allActions.filter(a => pendingTypes.includes(a.type));
  if (pending.length > 0) return pick(pending);

  // 3. Combat sub-actions
  const combat = allActions.filter(a => a.type?.startsWith('combat_'));
  if (combat.length > 0) {
    const flow = combat.filter(a =>
      a.type === 'combat_gate' || a.type === 'combat_roll' ||
      a.type === 'combat_resolve' || a.type === 'combat_reroll_confirm');
    if (flow.length > 0) return pick(flow);
    const surgeDmg = combat.filter(a => a.type?.startsWith('combat_surge'));
    if (surgeDmg.length > 0) return pick(surgeDmg);
    return pick(combat);
  }
  const surgeSpend = allActions.filter(a => a.type === 'spend_surge' || a.type?.startsWith('combat_surge'));
  const surgeSkip = allActions.filter(a => a.type === 'skip_surges');
  if (surgeSpend.length > 0) return pick(surgeSpend);
  if (surgeSkip.length > 0) return pick(surgeSkip);

  // 4. Attack weakest
  const attacks = allActions.filter(a => a.type === 'attack_target' && a.params?.targetFigureKey);
  if (attacks.length > 0) {
    const scored = attacks.map(a => {
      const targetFk = a.params.targetFigureKey;
      const hp = lookupHp(targetFk, oppNum, dcHealthState, dcMessageMeta);
      const targetPos = oppFigPositions[targetFk];
      const attackerPos = getAttackerPos(a, game, dcMessageMeta);
      const dist = (targetPos && attackerPos) ? coordDistance(attackerPos, targetPos) : 99;
      return { action: a, currentHp: hp?.current ?? 99, maxHp: hp?.max ?? 99, dist };
    });
    scored.sort((a, b) => {
      if (a.currentHp !== b.currentHp) return a.currentHp - b.currentHp;
      if (a.maxHp !== b.maxHp) return a.maxHp - b.maxHp;
      return a.dist - b.dist;
    });
    return scored[0].action;
  }

  // 5. DC specials
  const specials = allActions.filter(a => a.type === 'dc_special');
  if (specials.length > 0) return pick(specials);

  // 6. CC
  const ccPlay = allActions.filter(a =>
    a.type === 'play_cc' || a.type === 'play_cc_special' || a.type === 'play_cc_double');
  if (ccPlay.length > 0) return pick(ccPlay);

  // 7. Move toward weakest
  const moveSpaces = allActions.filter(a => a.type === 'move_pick_space' && a.params?.coord && !a.params?.done);
  if (moveSpaces.length > 0) {
    const weakest = findWeakestEnemy(oppNum, oppFigPositions, dcHealthState, dcMessageMeta);
    if (weakest) {
      const scored = moveSpaces.map(a => ({ action: a, dist: coordDistance(a.params.coord, weakest.pos) }));
      scored.sort((a, b) => a.dist - b.dist);
      return scored[0].action;
    }
    return pick(moveSpaces);
  }
  const moveStart = allActions.filter(a => a.type === 'move_figure');
  if (moveStart.length > 0) return pick(moveStart);
  const moveDone = allActions.filter(a => a.type === 'move_pick_space' && a.params?.done);
  if (moveDone.length > 0) return pick(moveDone);

  // 8. End/activate/pass
  const endAct = allActions.filter(a => a.type === 'dc_end_activation');
  if (endAct.length > 0) return pick(endAct);
  const activateDc = allActions.filter(a => a.type === 'activate_dc');
  if (activateDc.length > 0) return pick(activateDc);
  const passAct = allActions.filter(a => a.type === 'pass_activation_turn');
  if (passAct.length > 0) return pick(passAct);

  return pick(allActions);
}

// ── Combat Trace Game Loop ──────────────────────────────────────────────────

async function runTracedGame(gameNum) {
  const { p1Deck, p2Deck } = pickMatchup(gameNum);
  const p1Army = p1Deck.dcList.map(n => ({ dcName: n }));
  const p2Army = p2Deck.dcList.map(n => ({ dcName: n }));

  const builder = createTestGame()
    .lightweight()
    .withMap('mos-eisley-outskirts')
    .withMissionVariant('a')
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

  console.log(`\n${'═'.repeat(70)}`);
  console.log(`GAME ${gameNum + 1}: ${p1Deck.dcList.join(', ')} vs ${p2Deck.dcList.join(', ')}`);
  console.log(`${'═'.repeat(70)}`);

  // Print initial HP for all figures
  console.log('\n  INITIAL HP STATE:');
  for (const [msgId, health] of dcHealthState.entries()) {
    if (!Array.isArray(health)) continue;
    let dcName = msgId;
    for (const [, meta] of dcMessageMeta.entries()) {
      if (meta.msgId === msgId) { dcName = meta.displayName || meta.dcName || msgId; break; }
    }
    const hpStr = health.map((h, i) => Array.isArray(h) ? `fig${i}:${h[0]}/${h[1]}` : '?').join(', ');
    console.log(`    ${dcName}: ${hpStr}`);
  }
  console.log(`  Total figures: P1=${Object.keys(game.figurePositions?.[1] || {}).length}, P2=${Object.keys(game.figurePositions?.[2] || {}).length}`);

  // Trace accumulators
  let attacksDeclared = 0;
  let combatsResolved = 0;
  let totalDamageDealt = 0;
  let combatsMissed = 0;     // accuracy too low
  let combatsZeroDmg = 0;    // hit but 0 net damage
  let combatsDealtDmg = 0;   // hit and dealt > 0 damage
  let figuresDefeated = 0;
  let pendingCombatSeen = false;
  let combatSteps = 0;       // total sub-actions within combat flows
  let consecutiveEmpty = 0;
  let lastActionType = null;
  let sameTypeCount = 0;
  const ccFailureCounts = new Map();
  const CC_MAX_RETRIES = 3;
  const failedMoves = new Set();
  let lastMoveId = null;
  const hpDamageLog = [];     // detailed per-attack log

  for (let i = 0; i < MAX_ITERATIONS; i++) {
    const g = harness.getGame();
    if (g.ended) break;
    if ((g.currentRound || 1) > MAX_ROUNDS) {
      g.ended = true;
      break;
    }

    // OOM prevention
    if (i > 0 && i % 500 === 0) {
      if (g.undoStack) g.undoStack = [];
      if (g.eventLog) g.eventLog = [];
      if (g.actionHistory) g.actionHistory = [];
      if (hDeps._actionLog) hDeps._actionLog.length = 0;
      if (hDeps._client?._sentMessages) hDeps._client._sentMessages.length = 0;
      if (hDeps._client?._channelCache) {
        for (const ch of hDeps._client._channelCache.values()) {
          if (ch._sentMessages) ch._sentMessages.length = 0;
          if (ch._messageStore) ch._messageStore.clear();
        }
      }
      const hMessages = harness.getMessages();
      if (hMessages) hMessages.length = 0;
    }

    const p1Actions = getAvailableActions(g, 1, actionDeps);
    const p2Actions = getAvailableActions(g, 2, actionDeps);
    let allActions = [
      ...p1Actions.map(a => ({ ...a, actingPlayer: 1 })),
      ...p2Actions.map(a => ({ ...a, actingPlayer: 2 })),
    ].filter(a => {
      if (a.type === 'attack_target' && !a.params?.targetFigureKey) return false;
      if (a.type === 'phase_gate_unready') return false;
      if (a.type === 'interact' && a.params?.optionId === 'use_terminal') return false;
      if (a.type === 'play_cc' || a.type === 'play_cc_special' || a.type === 'play_cc_double') {
        if (!canResolveCcHeadless(g, a.actingPlayer, a.params.cardName, hDeps)) return false;
        const ccKey = `P${a.actingPlayer}:${a.params.cardName}:R${g.currentRound || 1}`;
        if ((ccFailureCounts.get(ccKey) || 0) >= CC_MAX_RETRIES) return false;
      }
      return true;
    });

    if (allActions.length === 0) {
      consecutiveEmpty++;
      if (consecutiveEmpty > 10) {
        const p2Figs = Object.keys(g.figurePositions?.[2] || {});
        const p1Figs = Object.keys(g.figurePositions?.[1] || {});
        if (p2Figs.length > 0) await deps.applyNpcDamageToFigure(g, 2, p2Figs[0], 999, 'Deadlock breaker');
        else if (p1Figs.length > 0) await deps.applyNpcDamageToFigure(g, 1, p1Figs[0], 999, 'Deadlock breaker');
        else break;
        consecutiveEmpty = 0;
      }
      continue;
    }
    consecutiveEmpty = 0;

    // Stuck-state detection
    if (allActions.length > 0 && allActions.every(a => a.type === lastActionType)) {
      sameTypeCount++;
      if (sameTypeCount > 30) {
        for (const key of Object.keys(g)) {
          if (key.startsWith('pending') && g[key] != null && key !== 'pendingCombat') {
            g[key] = key.endsWith('Choice') ? {} : null;
          }
        }
        const p2Figs = Object.keys(g.figurePositions?.[2] || {});
        const p1Figs = Object.keys(g.figurePositions?.[1] || {});
        if (p2Figs.length > 0) await deps.applyNpcDamageToFigure(g, 2, p2Figs[0], 999, 'Stuck-state breaker');
        else if (p1Figs.length > 0) await deps.applyNpcDamageToFigure(g, 1, p1Figs[0], 999, 'Stuck-state breaker');
        sameTypeCount = 0; lastActionType = null;
        continue;
      }
    } else { sameTypeCount = 0; lastActionType = allActions[0]?.type; }

    // Failed move filtering
    const hasMoveSpaces = allActions.some(a => a.type === 'move_pick_space');
    if (lastMoveId && !hasMoveSpaces) failedMoves.add(lastMoveId);
    if (hasMoveSpaces) lastMoveId = null;
    if (allActions.some(a => a.type === 'activate_dc') && !allActions.some(a => a.type === 'dc_end_activation')) failedMoves.clear();
    const filteredActions = allActions.filter(a => !(a.type === 'move_figure' && failedMoves.has(a.customId)));
    const actionsToUse = filteredActions.length > 0 ? filteredActions : allActions;

    // Determine acting player
    const turnPlayer = g.currentActivationTurnPlayerId === g.player1Id ? 1 : 2;
    const turnActions = actionsToUse.filter(a => a.actingPlayer === turnPlayer);
    const otherPlayer = turnPlayer === 1 ? 2 : 1;
    const otherActions = actionsToUse.filter(a => a.actingPlayer === otherPlayer);
    let actingPN;
    if (turnActions.length > 0 && otherActions.length > 0) {
      const turnMandatory = turnActions.some(a => ['phase_gate_ready','combat_gate','combat_roll'].includes(a.type));
      const otherMandatory = otherActions.some(a => ['phase_gate_ready','combat_gate','combat_roll'].includes(a.type));
      actingPN = (otherMandatory && !turnMandatory) ? otherPlayer : turnPlayer;
    } else { actingPN = turnActions.length > 0 ? turnPlayer : otherPlayer; }

    const playerActions = actionsToUse.filter(a => a.actingPlayer === actingPN);
    const action = pickOracleAction(playerActions, g, actingPN, dcHealthState, dcMessageMeta);
    if (!action) continue;

    // ── TRACE: before-action state ──────────────────────────────────────────
    const hpBefore = snapshotHp(dcHealthState);
    const figsBefore = countFigures(g);
    const hadPendingCombat = !!g.pendingCombat;
    const combatBefore = g.pendingCombat ? {
      attackerFk: g.pendingCombat.attackerFigureKey,
      defenderFk: g.pendingCombat.target?.figureKey,
      currentStep: g.pendingCombat.currentStep,
      acked: g.pendingCombat.acked || {},
      hasAttackRoll: !!g.pendingCombat.attackRoll,
      hasDefenseRoll: !!g.pendingCombat.defenseRoll,
      surgeRemaining: g.pendingCombat.surgeRemaining ?? null,
      rerollPhase: g.pendingCombat.rerollPhase ?? null,
    } : null;

    // Track if this is an attack declaration
    const isAttackDecl = action.type === 'attack_target';
    const isCombatAction = action.type?.startsWith('combat_');
    if (isCombatAction) combatSteps++;

    if (isAttackDecl) {
      attacksDeclared++;
      const targetFk = action.params?.targetFigureKey;
      const oppPN = actingPN === 1 ? 2 : 1;
      const targetHp = lookupHp(targetFk, oppPN, dcHealthState, dcMessageMeta);
      // Only log first 20 attacks in detail, then summary
      if (attacksDeclared <= 20) {
        console.log(`\n  ► ATTACK #${attacksDeclared} (iter ${i}, round ${g.currentRound || 1})`);
        console.log(`    P${actingPN} attacks ${targetFk}`);
        console.log(`    Target HP: ${targetHp?.current ?? '?'}/${targetHp?.max ?? '?'}`);
      }
    }

    // ── Execute action ──────────────────────────────────────────────────────
    if (action.type === 'move_figure') lastMoveId = action.customId;
    if (action.type === 'interact') {
      const p = action.params;
      const actionsData = g.dcActionsData?.[p.msgId];
      if (actionsData && actionsData.remaining > 0) actionsData.remaining = Math.max(0, actionsData.remaining - 1);
      continue;
    }
    if (action.type === 'play_cc' || action.type === 'play_cc_special' || action.type === 'play_cc_double') {
      try {
        if (action.type === 'play_cc_special' || action.type === 'play_cc_double') {
          const actData = g.dcActionsData?.[action.params.msgId];
          if (actData && typeof actData.remaining === 'number') {
            if (action.type === 'play_cc_special') actData.remaining = Math.max(0, actData.remaining - 1);
            else actData.remaining = 0;
          }
        }
        await playCommandCardHeadless(g, action.actingPlayer, action.params.cardName, hDeps);
      } catch (err) {
        const ccKey = `P${action.actingPlayer}:${action.params.cardName}:R${g.currentRound || 1}`;
        ccFailureCounts.set(ccKey, (ccFailureCounts.get(ccKey) || 0) + 1);
      }
      continue;
    }
    if (action.type === 'strain_choice_discard') {
      const userId = action.actingPlayer === 1 ? g.player1Id : g.player2Id;
      try { await harness.submitAction(action.customId, userId); } catch {}
      let g2 = harness.getGame();
      let safetyLimit = 30;
      while (g2.pendingStrainChoice?.discardTarget > 0 &&
             (g2.pendingStrainChoice.discardedCount || 0) < g2.pendingStrainChoice.discardTarget &&
             safetyLimit-- > 0) {
        const hand = getCcHand(g2, g2.pendingStrainChoice.playerNum) || [];
        if (hand.length === 0) break;
        try { await harness.submitAction(`strain_cc_pick_${g2.gameId}_${encodeURIComponent(hand[0])}`, action.actingPlayer === 1 ? g2.player1Id : g2.player2Id); } catch { break; }
        g2 = harness.getGame();
      }
      if (g2.pendingStrainChoice) delete g2.pendingStrainChoice;
      continue;
    }

    const userId = action.actingPlayer === 1 ? g.player1Id : g.player2Id;
    let result;
    try { result = await harness.submitAction(action.customId, userId); } catch (err) {
      if (isAttackDecl && attacksDeclared <= 20) {
        console.log(`    ⚠ submitAction THROW: ${err.message}`);
      }
    }
    if (result?.error && (isAttackDecl || isCombatAction) && (attacksDeclared <= 20 || combatsResolved <= 20)) {
      console.log(`    ⚠ submitAction ERROR: ${result.error}`);
    }

    // ── TRACE: after-action state ───────────────────────────────────────────
    const gAfter = harness.getGame();
    const hpAfter = snapshotHp(dcHealthState);
    const figsAfter = countFigures(gAfter);
    const hasPendingCombat = !!gAfter.pendingCombat;

    // Detect HP changes
    const hpChanges = diffHp(hpBefore, hpAfter, dcMessageMeta);
    for (const ch of hpChanges) {
      totalDamageDealt += Math.abs(ch.delta);
      if (ch.defeated) figuresDefeated++;
      if (attacksDeclared <= 20 || ch.defeated) {
        console.log(`    💥 HP change: ${ch.dcName} fig${ch.figIdx}: ${ch.hpBefore} → ${ch.hpAfter}/${ch.maxHp} (${ch.delta > 0 ? '+' : ''}${ch.delta})${ch.defeated ? ' ☠ DEFEATED' : ''}`);
      }
    }

    // Detect combat resolution (pendingCombat was present, now gone)
    if (hadPendingCombat && !hasPendingCombat) {
      combatsResolved++;
      const dmgThisRound = hpChanges.reduce((s, ch) => s + Math.abs(ch.delta), 0);
      if (dmgThisRound === 0) combatsZeroDmg++;
      else combatsDealtDmg++;

      if (combatsResolved <= 20) {
        console.log(`    ✓ Combat #${combatsResolved} resolved: ${dmgThisRound} total damage dealt`);
      }
    }

    // Detect combat that started but check if attack dice resulted in miss
    if (isAttackDecl && hasPendingCombat) {
      pendingCombatSeen = true;
      if (attacksDeclared <= 20) {
        const pc = gAfter.pendingCombat;
        console.log(`    → pendingCombat created. Attacker: ${pc.attackerFigureKey}, Target: ${pc.target?.figureKey}`);
        if (pc.attackInfo) {
          console.log(`    → Dice pool: ${JSON.stringify(pc.attackInfo.dice)}, Range: ${JSON.stringify(pc.attackInfo.range)}`);
        }
      }
    }

    // Figure count change detection
    if (figsAfter.total < figsBefore.total) {
      const defeated = figsBefore.total - figsAfter.total;
      console.log(`  ☠ ${defeated} figure(s) removed from board at iter ${i}`);
    }
  }

  // ── Game Summary ──────────────────────────────────────────────────────────
  const finalGame = harness.getGame();
  const p1VP = finalGame.player1VP?.total || 0;
  const p2VP = finalGame.player2VP?.total || 0;
  const finalFigs = countFigures(finalGame);

  // Print final HP state
  console.log('\n  FINAL HP STATE:');
  for (const [msgId, health] of dcHealthState.entries()) {
    if (!Array.isArray(health)) continue;
    let dcName = msgId;
    for (const [, meta] of dcMessageMeta.entries()) {
      if (meta.msgId === msgId) { dcName = meta.displayName || meta.dcName || msgId; break; }
    }
    const hpStr = health.map((h, i) => Array.isArray(h) ? `fig${i}:${h[0]}/${h[1]}` : '?').join(', ');
    console.log(`    ${dcName}: ${hpStr}`);
  }

  console.log(`\n  ── GAME ${gameNum + 1} COMBAT SUMMARY ──`);
  console.log(`  Attacks declared:     ${attacksDeclared}`);
  console.log(`  Combats resolved:     ${combatsResolved}`);
  console.log(`  Combat sub-steps:     ${combatSteps}`);
  console.log(`  Damage dealt (total): ${totalDamageDealt}`);
  console.log(`  Combats with damage:  ${combatsDealtDmg}`);
  console.log(`  Combats with 0 dmg:   ${combatsZeroDmg}`);
  console.log(`  Figures defeated:     ${figuresDefeated}`);
  console.log(`  Figures remaining:    P1=${finalFigs.p1}, P2=${finalFigs.p2}`);
  console.log(`  VP: P1=${p1VP}, P2=${p2VP}`);

  if (attacksDeclared > 0 && combatsResolved === 0) {
    console.log(`\n  ⚠⚠⚠ CRITICAL: ${attacksDeclared} attacks declared but 0 resolved!`);
    console.log(`      → Combat pipeline is NOT completing.`);
    console.log(`      → pendingCombat was ${pendingCombatSeen ? 'created' : 'NEVER created'} after attack_target.`);
  }

  if (combatsResolved > 0 && totalDamageDealt === 0) {
    console.log(`\n  ⚠⚠⚠ CRITICAL: ${combatsResolved} combats resolved but 0 total damage!`);
    console.log(`      → Attacks are resolving but dealing no damage.`);
  }

  if (totalDamageDealt > 0 && figuresDefeated === 0) {
    console.log(`\n  ⚠ NOTABLE: ${totalDamageDealt} total damage dealt but 0 figures defeated.`);
    console.log(`      → Damage is being dealt but never enough to kill.`);
  }

  return {
    attacksDeclared, combatsResolved, totalDamageDealt,
    combatsDealtDmg, combatsZeroDmg, figuresDefeated,
    combatSteps, p1VP, p2VP,
  };
}

// ── Main ────────────────────────────────────────────────────────────────────

async function main() {
  console.log('╔══════════════════════════════════════════════════════════╗');
  console.log('║  v12 Combat Trace — 0-kill diagnostic                  ║');
  console.log('║  3 oracle games with full combat lifecycle logging      ║');
  console.log('╚══════════════════════════════════════════════════════════╝');

  const results = [];
  for (let g = 0; g < NUM_GAMES; g++) {
    const result = await runTracedGame(g);
    results.push(result);
  }

  // ── Aggregate Summary ──────────────────────────────────────────────────
  console.log(`\n${'═'.repeat(70)}`);
  console.log('AGGREGATE COMBAT TRACE — ALL GAMES');
  console.log(`${'═'.repeat(70)}`);

  const totals = results.reduce((acc, r) => {
    acc.attacks += r.attacksDeclared;
    acc.resolved += r.combatsResolved;
    acc.damage += r.totalDamageDealt;
    acc.withDmg += r.combatsDealtDmg;
    acc.zeroDmg += r.combatsZeroDmg;
    acc.defeated += r.figuresDefeated;
    acc.steps += r.combatSteps;
    return acc;
  }, { attacks: 0, resolved: 0, damage: 0, withDmg: 0, zeroDmg: 0, defeated: 0, steps: 0 });

  console.log(`  Total attacks declared:    ${totals.attacks}`);
  console.log(`  Total combats resolved:    ${totals.resolved}`);
  console.log(`  Resolution rate:           ${totals.attacks > 0 ? ((totals.resolved / totals.attacks) * 100).toFixed(1) : 'N/A'}%`);
  console.log(`  Avg combat sub-steps:      ${totals.resolved > 0 ? (totals.steps / totals.resolved).toFixed(1) : 'N/A'}`);
  console.log(`  Total damage dealt:        ${totals.damage}`);
  console.log(`  Avg damage/resolved:       ${totals.resolved > 0 ? (totals.damage / totals.resolved).toFixed(2) : 'N/A'}`);
  console.log(`  Combats dealing damage:    ${totals.withDmg} (${totals.resolved > 0 ? ((totals.withDmg / totals.resolved) * 100).toFixed(1) : 'N/A'}%)`);
  console.log(`  Combats dealing 0 damage:  ${totals.zeroDmg} (${totals.resolved > 0 ? ((totals.zeroDmg / totals.resolved) * 100).toFixed(1) : 'N/A'}%)`);
  console.log(`  Total figures defeated:    ${totals.defeated}`);

  console.log(`\n${'═'.repeat(70)}`);
  console.log('DIAGNOSIS');
  console.log(`${'═'.repeat(70)}`);

  if (totals.attacks > 0 && totals.resolved === 0) {
    console.log('  ❌ FINDING A: Attacks are declared but NEVER RESOLVE.');
    console.log('     The combat pipeline (combat_ready → roll → surge → resolve)');
    console.log('     is not being navigated to completion. The "250 attacks/game"');
    console.log('     metric is counting attack_target declarations, not completed combats.');
    console.log('     ROOT CAUSE: Game loop submits attack_target but combat sub-actions');
    console.log('     (combat_ready, combat_roll, combat_resolve) are not being processed.');
  } else if (totals.resolved > 0 && totals.damage === 0) {
    console.log('  ❌ FINDING B: Combats resolve but deal ZERO damage.');
    console.log('     Every attack lands 0 net damage (block/evade cancels all hits).');
  } else if (totals.damage > 0 && totals.defeated === 0) {
    console.log('  ❌ FINDING C: Damage is dealt but never enough to defeat a figure.');
    console.log(`     ${totals.damage} total damage across ${totals.resolved} combats = ${(totals.damage / totals.resolved).toFixed(1)} avg.`);
    console.log('     Damage is too low or too spread out to reduce any figure to 0 HP.');
  } else if (totals.defeated > 0) {
    console.log(`  ✓ FINDING D: Combat IS working — ${totals.defeated} figures defeated.`);
    console.log('     The 0-kill report in v11 may be a counting bug in the experiment.');
  } else {
    console.log('  ❓ Inconclusive. Need more data.');
  }

  console.log(`\n${'═'.repeat(70)}`);
  console.log('EXPERIMENT COMPLETE');
  console.log(`${'═'.repeat(70)}`);
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
