/**
 * Activation-entry attack diagnostic.
 * Focuses ONLY on states where both start_move AND attack are legal.
 * This is the true attack-vs-move decision point.
 */
import { createTestGame } from '../fixtures/game-builder.js';
import { getAvailableActions } from '../../src/engine/available-actions.js';
import { getDcStats, getMapSpaces, getDcEffects } from '../../src/data-loader.js';
import { getBoardStateForMovement, getMovementProfile, computeMovementCache } from '../../src/game/movement.js';
import { getPlayableCcFromHand } from '../../src/game/cc-timing.js';
import { playCommandCardHeadless, canResolveCcHeadless } from '../../src/headless/headless-cc-play.js';
import { getCcHand } from '../../src/game/player-helpers.js';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { readFileSync } from 'fs';
import {
  loadLearnings, createGameTracer,
  pickSmartAction, abstractActionType, extractFeatures,
  getQValues, captureSnapshot,
} from './learnings.js';
import { parseCoord } from '../../src/game/coords.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const LEARNINGS_PATH = join(__dirname, 'learnings-data.json');
const TEST_DECKS = JSON.parse(readFileSync(join(__dirname, '../../data/destruct-test-decks.json'), 'utf8'));

const ABSTRACT_TYPES = [
  'attack_close', 'attack_ranged', 'move_toward', 'move_away', 'move_lateral',
  'move_done', 'start_move', 'activate', 'end_activation', 'pass',
  'ability', 'spend_surge', 'skip_surges', 'reroll', 'other',
  'play_cc', 'react_use', 'react_skip', 'surge_damage', 'surge_special',
  'token_offense', 'token_defense', 'interact',
];

function coordDistance(a, b) {
  const pa = parseCoord(a);
  const pb = parseCoord(b);
  return Math.abs(pa.col - pb.col) + Math.abs(pa.row - pb.row);
}

function pickMatchup(n) {
  const i = n % TEST_DECKS.length;
  let j = (n + 17) % TEST_DECKS.length;
  if (j === i) j = (j + 1) % TEST_DECKS.length;
  return { p1Deck: TEST_DECKS[i], p2Deck: TEST_DECKS[j] };
}

async function main() {
  const numGames = parseInt(process.argv[2] || '20', 10);
  const learnings = loadLearnings(LEARNINGS_PATH);
  console.log(`Activation-Entry Attack Diagnostic — ${numGames} games, model at ${learnings.meta.totalGames}\n`);

  const dcEffects = getDcEffects();

  // Collect activation-entry rows where BOTH start_move AND attack are legal
  const rows = [];

  for (let gi = 0; gi < numGames; gi++) {
    const { p1Deck, p2Deck } = pickMatchup(gi);
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
    const g = harness.getGame();
    const actionDeps = {
      dcMessageMeta, dcExhaustedState, dcHealthState, getDcStats, getMapSpaces,
      computeMovementCache, getBoardStateForMovement, getMovementProfile, getPlayableCcFromHand,
      getPlayableCcSpecialsForDc: hDeps.getPlayableCcSpecialsForDc,
      getPlayableCcDoubleActionsForDc: hDeps.getPlayableCcDoubleActionsForDc,
    };

    const tracer1 = createGameTracer(learnings, 1, dcHealthState, dcMessageMeta);
    const tracer2 = createGameTracer(learnings, 2, dcHealthState, dcMessageMeta);
    let iterations = 0, emptyCount = 0;

    while (!g.ended && iterations < 10000 && (g.currentRound || 1) <= 10) {
      iterations++;
      const p1A = getAvailableActions(g, 1, actionDeps).map(a => ({ ...a, actingPlayer: 1 }));
      const p2A = getAvailableActions(g, 2, actionDeps).map(a => ({ ...a, actingPlayer: 2 }));
      const allActions = [...p1A, ...p2A].filter(a => {
        if (a.type === 'attack_target' && !a.params?.targetFigureKey) return false;
        if (a.type === 'phase_gate_unready') return false;
        if (a.type === 'interact' && a.params?.optionId === 'use_terminal') return false;
        if (a.type === 'play_cc' || a.type === 'play_cc_special' || a.type === 'play_cc_double') {
          if (!canResolveCcHeadless(g, a.actingPlayer, a.params.cardName, hDeps)) return false;
        }
        return true;
      });
      if (allActions.length === 0) { if (++emptyCount > 10) break; continue; }
      emptyCount = 0;

      const turnPlayer = g.turnPlayer || 1;
      const otherPlayer = turnPlayer === 1 ? 2 : 1;
      const turnActions = allActions.filter(a => a.actingPlayer === turnPlayer);
      const otherActions = allActions.filter(a => a.actingPlayer === otherPlayer);
      let actingPN;
      if (turnActions.length > 0 && otherActions.length > 0) {
        const tm = turnActions.some(a => ['phase_gate_ready','combat_ready','combat_roll'].includes(a.type));
        const om = otherActions.some(a => ['phase_gate_ready','combat_ready','combat_roll'].includes(a.type));
        actingPN = (om && !tm) ? otherPlayer : turnPlayer;
      } else {
        actingPN = turnActions.length > 0 ? turnPlayer : otherPlayer;
      }

      const playerActions = allActions.filter(a => a.actingPlayer === actingPN);
      const tracer = actingPN === 1 ? tracer1 : tracer2;
      tracer.beforeAction(g, playerActions);

      // Group by abstract type
      const groups = {};
      for (const a of playerActions) {
        const abs = abstractActionType(a, g);
        if (!groups[abs]) groups[abs] = [];
        groups[abs].push(a);
      }
      const mandatoryTypes = ['gate', 'combat_flow'];
      const hasMandatory = playerActions.some(a => mandatoryTypes.includes(abstractActionType(a, g)));
      const strategicTypes = Object.keys(groups).filter(t => !mandatoryTypes.includes(t));

      // ── Activation-entry detection ────────────────────────────────
      const hasStartMove = strategicTypes.includes('start_move');
      const hasAtkClose = strategicTypes.includes('attack_close');
      const hasAtkRanged = strategicTypes.includes('attack_ranged');
      const isActivationEntry = !hasMandatory && hasStartMove && (hasAtkClose || hasAtkRanged);

      let features = null, Q = null;
      if (isActivationEntry) {
        try {
          features = extractFeatures(g, actingPN, dcHealthState, dcMessageMeta);
          Q = getQValues(learnings, features);
        } catch {}
      }

      // Pick action
      const action = pickSmartAction(playerActions, g, learnings, actingPN, dcHealthState, dcMessageMeta);
      if (!action) break;
      const chosenAbs = abstractActionType(action, g);

      // Record activation-entry row
      if (isActivationEntry && Q) {
        const isAtkChoice = chosenAbs === 'attack_close' || chosenAbs === 'attack_ranged';
        const isMoveChoice = chosenAbs === 'start_move';

        // Extract game-state context for slicing
        // Find the active DC to determine melee/ranged and target info
        const oppNum = actingPN === 1 ? 2 : 1;
        let attackRange = 1;
        let activeDcName = null;
        let activeFigPos = null;
        let activeFigKey = null;

        // Find active DC from dcActionsData
        for (const [msgId, meta] of Object.entries(dcMessageMeta)) {
          if (meta.player !== actingPN) continue;
          const actData = g.dcActionsData?.[msgId];
          if (!actData) continue;
          activeDcName = meta.dcName;
          const eff = dcEffects?.[activeDcName];
          const isRangedDiag = eff?.attack?.type === 'range';
          attackRange = isRangedDiag ? 20 : 1;
          const dgMatch = (meta.displayName || '').match(/\[(?:DG|Group) (\d+)\]/);
          const dgIndex = dgMatch ? dgMatch[1] : '1';
          const figIdx = actData.selectedFigure ?? 0;
          activeFigKey = `${activeDcName}-${dgIndex}-${figIdx}`;
          activeFigPos = g.figurePositions?.[actingPN]?.[activeFigKey];
          break;
        }

        // Count targets in range and assess kill potential
        let targetsInRange = 0;
        let lowestTargetHp = Infinity;
        let highestTargetHp = 0;
        let anyDamagedTarget = false;
        if (activeFigPos) {
          const oppFigs = g.figurePositions?.[oppNum] || {};
          for (const [fk, fPos] of Object.entries(oppFigs)) {
            const dist = coordDistance(activeFigPos, fPos);
            if (dist <= attackRange) {
              targetsInRange++;
              // Try to get target HP
              const hpKey = Object.keys(dcHealthState).find(k => k.includes(fk));
              if (hpKey && dcHealthState[hpKey]) {
                const hp = dcHealthState[hpKey].hp;
                const maxHp = dcHealthState[hpKey].maxHp;
                if (hp < lowestTargetHp) lowestTargetHp = hp;
                if (hp > highestTargetHp) highestTargetHp = hp;
                if (hp < maxHp) anyDamagedTarget = true;
              }
            }
          }
        }

        // Get attack dice expected damage for kill potential estimation
        const dcStats = activeDcName ? getDcStats(activeDcName) : null;
        const expectedDmg = dcStats?.attack?.dice
          ? dcStats.attack.dice.reduce((s, d) => {
              const avg = { red: 2.17, blue: 1.17, green: 1.33, yellow: 0.67 }[d] || 1;
              return s + avg;
            }, 0)
          : 2;
        const killPotential = lowestTargetHp <= expectedDmg ? 'HIGH' : 'LOW';

        // Check if near objective
        const objectives = g.objectiveSpaces || [];
        let nearObjective = false;
        if (activeFigPos && objectives.length > 0) {
          for (const obj of objectives) {
            if (coordDistance(activeFigPos, obj) <= 2) { nearObjective = true; break; }
          }
        }

        // Snapshot for reward analysis
        const snap = captureSnapshot(g, actingPN, dcHealthState, dcMessageMeta);

        const qStartMove = Q[ABSTRACT_TYPES.indexOf('start_move')];
        const qAtkClose = hasAtkClose ? Q[ABSTRACT_TYPES.indexOf('attack_close')] : null;
        const qAtkRanged = hasAtkRanged ? Q[ABSTRACT_TYPES.indexOf('attack_ranged')] : null;
        const qEndAct = strategicTypes.includes('end_activation') ? Q[ABSTRACT_TYPES.indexOf('end_activation')] : null;
        const qPlayCc = strategicTypes.includes('play_cc') ? Q[ABSTRACT_TYPES.indexOf('play_cc')] : null;
        const bestAtkQ = Math.max(qAtkClose ?? -Infinity, qAtkRanged ?? -Infinity);

        rows.push({
          game: gi + 1, iter: iterations,
          chosenAbs, isAtkChoice, isMoveChoice,
          // Q values
          qStartMove: +qStartMove.toFixed(3),
          qAtkClose: qAtkClose != null ? +qAtkClose.toFixed(3) : null,
          qAtkRanged: qAtkRanged != null ? +qAtkRanged.toFixed(3) : null,
          qEndAct: qEndAct != null ? +qEndAct.toFixed(3) : null,
          qPlayCc: qPlayCc != null ? +qPlayCc.toFixed(3) : null,
          bestAtkQ: +bestAtkQ.toFixed(3),
          qGap: +(qStartMove - bestAtkQ).toFixed(3),
          // Slicing fields
          attackRange,
          isMelee: attackRange <= 1,
          atkCloseOnly: hasAtkClose && !hasAtkRanged,
          atkRangedOnly: !hasAtkClose && hasAtkRanged,
          atkBothLegal: hasAtkClose && hasAtkRanged,
          targetsInRange,
          killPotential,
          lowestTargetHp: isFinite(lowestTargetHp) ? lowestTargetHp : null,
          anyDamagedTarget,
          nearObjective,
          expectedDmg: +expectedDmg.toFixed(1),
          activeDcName,
          // Snapshot for reward audit
          snapActiveFigHasTargets: snap.activeFigHasTargets,
          snapActiveFigDist: snap.activeFigDist,
          // Features
          featHasTargets: features[42],
          featAttackRange: features[39],
          featActionsLeft: features[45],
          featAttackPower: features[38],
          featDistToNearest: features[40],
          legalTypes: strategicTypes.sort(),
        });
      }

      // Dispatch (simplified from train.js)
      if (action.type === 'interact') {
        const actData = g.dcActionsData?.[action.params?.msgId];
        if (actData && actData.remaining > 0) actData.remaining--;
        tracer.afterAction(harness.getGame(), action);
        continue;
      }
      if (action.type === 'play_cc' || action.type === 'play_cc_special' || action.type === 'play_cc_double') {
        try {
          if (action.type === 'play_cc_special' || action.type === 'play_cc_double') {
            const actData = g.dcActionsData?.[action.params.msgId];
            if (actData && typeof actData.remaining === 'number') {
              if (action.type === 'play_cc_special') actData.remaining--;
              else actData.remaining = 0;
            }
          }
          await playCommandCardHeadless(g, action.actingPlayer, action.params.cardName, hDeps);
        } catch {}
        tracer.afterAction(harness.getGame(), action);
        continue;
      }
      if (action.type === 'strain_choice_discard') {
        const userId = action.actingPlayer === 1 ? g.player1Id : g.player2Id;
        try { await harness.submitAction(action.customId, userId); } catch {}
        let g2 = harness.getGame();
        let safety = 30;
        while (g2.pendingStrainChoice?.discardTarget > 0 && (g2.pendingStrainChoice.discardedCount || 0) < g2.pendingStrainChoice.discardTarget && safety-- > 0) {
          const hand = getCcHand(g2, g2.pendingStrainChoice.playerNum) || [];
          if (hand.length === 0) break;
          try { await harness.submitAction(`strain_cc_pick_${g2.gameId}_${encodeURIComponent(hand[0])}`, g2.pendingStrainChoice.playerNum === 1 ? g.player1Id : g.player2Id); } catch { break; }
          g2 = harness.getGame();
        }
        if (g2.pendingStrainChoice) delete g2.pendingStrainChoice;
        tracer.afterAction(harness.getGame(), action);
        continue;
      }
      const userId = action.actingPlayer === 1 ? g.player1Id : g.player2Id;
      try { await harness.submitAction(action.customId, userId); } catch {}
      tracer.afterAction(harness.getGame(), action);
    }
  }

  // ═══════════════════════════════════════════════════════════════
  //  OUTPUT
  // ═══════════════════════════════════════════════════════════════
  console.log('\n═══════════════════════════════════════════════════════════');
  console.log('  ACTIVATION-ENTRY DIAGNOSTIC (attack + start_move both legal)');
  console.log('═══════════════════════════════════════════════════════════\n');

  console.log(`Total activation-entry decisions: ${rows.length}\n`);

  // --- Overall ---
  const atkChosen = rows.filter(r => r.isAtkChoice);
  const moveChosen = rows.filter(r => r.isMoveChoice);
  const otherChosen = rows.filter(r => !r.isAtkChoice && !r.isMoveChoice);
  console.log(`  Attack chosen: ${atkChosen.length} (${(atkChosen.length/rows.length*100).toFixed(1)}%)`);
  console.log(`  Start_move chosen: ${moveChosen.length} (${(moveChosen.length/rows.length*100).toFixed(1)}%)`);
  console.log(`  Other: ${otherChosen.length} (${(otherChosen.length/rows.length*100).toFixed(1)}%)\n`);

  const avg = (arr, fn) => arr.length > 0 ? arr.reduce((s, r) => s + fn(r), 0) / arr.length : NaN;

  console.log('  Avg Q(start_move):    ', avg(rows, r => r.qStartMove).toFixed(3));
  console.log('  Avg Q(best_attack):   ', avg(rows, r => r.bestAtkQ).toFixed(3));
  console.log('  Avg Q gap (move-atk): ', avg(rows, r => r.qGap).toFixed(3));
  if (rows.some(r => r.qAtkClose != null))
    console.log('  Avg Q(attack_close):  ', avg(rows.filter(r => r.qAtkClose != null), r => r.qAtkClose).toFixed(3));
  if (rows.some(r => r.qAtkRanged != null))
    console.log('  Avg Q(attack_ranged): ', avg(rows.filter(r => r.qAtkRanged != null), r => r.qAtkRanged).toFixed(3));
  if (rows.some(r => r.qEndAct != null))
    console.log('  Avg Q(end_activation):', avg(rows.filter(r => r.qEndAct != null), r => r.qEndAct).toFixed(3));

  // --- Slices ---
  function slice(label, filterFn) {
    const s = rows.filter(filterFn);
    if (s.length < 3) return; // too few to be meaningful
    const atk = s.filter(r => r.isAtkChoice).length;
    const mv = s.filter(r => r.isMoveChoice).length;
    console.log(`\n  ${label} (n=${s.length}):`);
    console.log(`    Attack: ${atk} (${(atk/s.length*100).toFixed(1)}%) | Move: ${mv} (${(mv/s.length*100).toFixed(1)}%)`);
    console.log(`    Q(move)=${avg(s, r => r.qStartMove).toFixed(3)} Q(bestAtk)=${avg(s, r => r.bestAtkQ).toFixed(3)} gap=${avg(s, r => r.qGap).toFixed(3)}`);
  }

  console.log('\n── Slices ──');
  slice('Melee figures (range=1)', r => r.isMelee);
  slice('Ranged figures (range>1)', r => !r.isMelee);
  slice('attack_close ONLY legal', r => r.atkCloseOnly);
  slice('attack_ranged ONLY legal', r => r.atkRangedOnly);
  slice('BOTH attack types legal', r => r.atkBothLegal);
  slice('1 target in range', r => r.targetsInRange === 1);
  slice('2+ targets in range', r => r.targetsInRange >= 2);
  slice('Kill potential HIGH', r => r.killPotential === 'HIGH');
  slice('Kill potential LOW', r => r.killPotential === 'LOW');
  slice('Damaged target available', r => r.anyDamagedTarget);
  slice('All targets full HP', r => !r.anyDamagedTarget);
  slice('Near objective', r => r.nearObjective);
  slice('Not near objective', r => !r.nearObjective);

  // --- Reward audit helper ---
  console.log('\n── Snapshot audit ──');
  const snapHasTargets = rows.filter(r => r.snapActiveFigHasTargets);
  const snapNoTargets = rows.filter(r => !r.snapActiveFigHasTargets);
  console.log(`  Snapshot activeFigHasTargets=true:  ${snapHasTargets.length}`);
  console.log(`  Snapshot activeFigHasTargets=false: ${snapNoTargets.length}`);
  console.log(`  (If false count > 0, move_decision_bonus fires incorrectly at activation entry)`);
  if (snapNoTargets.length > 0) {
    console.log(`  ⚠ MOVE_DECISION_BONUS FIRES in ${snapNoTargets.length}/${rows.length} activation entries where attack is legal!`);
    const mvInFalse = snapNoTargets.filter(r => r.isMoveChoice).length;
    console.log(`    Of those, start_move was chosen: ${mvInFalse} (${(mvInFalse/snapNoTargets.length*100).toFixed(1)}%)`);
    console.log(`    Avg Q gap in these states: ${avg(snapNoTargets, r => r.qGap).toFixed(3)}`);
  }

  // Feature availability
  console.log('\n── Feature audit ──');
  console.log(`  Avg featHasTargets (should be 1.0): ${avg(rows, r => r.featHasTargets).toFixed(3)}`);
  console.log(`  Avg featAttackRange (ranged should be 1.0): ${avg(rows, r => r.featAttackRange).toFixed(3)}`);
  const rangedRows = rows.filter(r => !r.isMelee);
  const meleeRows = rows.filter(r => r.isMelee);
  if (rangedRows.length > 0) console.log(`    Ranged figures (n=${rangedRows.length}): ${avg(rangedRows, r => r.featAttackRange).toFixed(3)}`);
  if (meleeRows.length > 0) console.log(`    Melee figures (n=${meleeRows.length}): ${avg(meleeRows, r => r.featAttackRange).toFixed(3)}`);
  console.log(`  Avg featAttackPower: ${avg(rows, r => r.featAttackPower).toFixed(3)}`);
  console.log(`  Avg featDistToNearest: ${avg(rows, r => r.featDistToNearest).toFixed(3)}`);
  console.log(`  Avg featActionsLeft: ${avg(rows, r => r.featActionsLeft).toFixed(3)}`);
  console.log(`  Avg expectedDmg: ${avg(rows, r => r.expectedDmg).toFixed(1)}`);

  // Q gap when attack IS chosen vs NOT
  if (atkChosen.length > 0 && moveChosen.length > 0) {
    console.log('\n── Q gap: attack chosen vs move chosen ──');
    console.log(`  When attack chosen (n=${atkChosen.length}): avgQ(atk)=${avg(atkChosen, r => r.bestAtkQ).toFixed(3)}, avgQ(move)=${avg(atkChosen, r => r.qStartMove).toFixed(3)}, gap=${avg(atkChosen, r => r.qGap).toFixed(3)}`);
    console.log(`  When move chosen   (n=${moveChosen.length}): avgQ(atk)=${avg(moveChosen, r => r.bestAtkQ).toFixed(3)}, avgQ(move)=${avg(moveChosen, r => r.qStartMove).toFixed(3)}, gap=${avg(moveChosen, r => r.qGap).toFixed(3)}`);
  }

  // Sample rows
  console.log('\n── Sample rows (first 25) ──');
  console.log('gm | iter | chosen          | qMove | qAtkCl | qAtkRa | gap   | range | tgts | kill | dc');
  console.log('─'.repeat(110));
  for (const r of rows.slice(0, 25)) {
    console.log(
      `${String(r.game).padStart(2)} | ${String(r.iter).padStart(4)} | ${r.chosenAbs.padEnd(16)} | ${String(r.qStartMove).padStart(5)} | ` +
      `${(r.qAtkClose != null ? String(r.qAtkClose) : ' N/A').padStart(6)} | ` +
      `${(r.qAtkRanged != null ? String(r.qAtkRanged) : ' N/A').padStart(6)} | ` +
      `${String(r.qGap).padStart(5)} | ${String(r.attackRange).padStart(5)} | ${String(r.targetsInRange).padStart(4)} | ` +
      `${r.killPotential.padEnd(4)} | ${(r.activeDcName || '?').substring(0, 20)}`
    );
  }
}

main().catch(err => { console.error('Diagnostic failed:', err); process.exit(1); });
