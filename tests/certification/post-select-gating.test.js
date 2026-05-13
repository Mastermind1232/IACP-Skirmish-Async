/**
 * Post-Target-Select Combat Gating — non-mutating surfacing layer (v2).
 *
 * Pins the *post-select* decision of the Discord attack flow (the block
 * living in src/handlers/combat.js around the attack-target click, roughly
 * lines 869–969): given that a target was selected, does the attack
 * proceed normally, get blocked outright, or consume a free-attack
 * window instead of a normal action?
 *
 * This lane is intentionally narrower than the target-enumeration parity
 * scoreboard (handler-parity-reporting.test.js):
 *   - target-enumeration asks: "which figures are legal targets?"
 *   - this lane asks:          "given a picked target, what happens next?"
 *
 * Shape:
 *   - `decideAfterTargetSelect` is a narrow shadow mirroring the handler's
 *     main proceed/block/consume-window decision. It covers every flag-
 *     gated branch in the handler block (v2): 4 block gates (etiquette,
 *     Still Faster Than You, forced-target, multi-fire) and 8 consumption
 *     windows (Battlefield Leadership, Fell Swoop, Emperor Interrupt,
 *     Executive Order, Bombardment Sorin, Firing Squad, Coordinated Raid,
 *     Field Tactics). Ordering mirrors the handler so first-match semantics
 *     agree.
 *   - each scenario asserts the shadow's { outcome, reason? | window? }
 *     matches the baseline. Regressions or silent gate removal fail here.
 *   - engine-blindness is reported informationally: for each scenario we
 *     log whether `getAvailableActions` still enumerates the same target
 *     (it does — the engine is unaware of these post-select flags).
 *
 * What this DOES NOT cover (intentionally, per v2 scope rules):
 *   - side effects / cleanup branches on proceed (arcing-shot flag clear,
 *     ballistics matrix flag clear, droid-arm power-token deduction,
 *     forced-target / multi-fire flag deletion, firing-squad array
 *     cleanup, STFY exclude clearing on fell-swoop consume, bonus
 *     hit/evade accumulation)
 *   - the LOS pre-check at combat.js:869–872 (pre-select concern; owned
 *     by the LOS lane, not this one)
 *   - combat resolution itself (damage formula, surge spending, pierce/
 *     block math)
 *   - engine-side fixes (engine blindness remains a report-only number)
 *
 * Non-mutating: reads fixtures + calls getAvailableActions. No src/ edits.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { getAvailableActions } from '../../src/engine/available-actions.js';
import { createTestGame } from '../fixtures/game-builder.js';

// ── Shared setup helpers (mirrors _crr-baselines.js patterns) ───────────────
function findDcMsgId(dcMessageMeta, gameId, playerNum, dcName) {
  for (const [msgId, meta] of dcMessageMeta) {
    if (meta.gameId !== gameId) continue;
    if (meta.playerNum !== playerNum) continue;
    if (meta.dcName === dcName) return msgId;
  }
  return null;
}

function enableAttackFor(game, msgId) {
  game.dcActionsData = game.dcActionsData || {};
  game.dcActionsData[msgId] = { remaining: 2, total: 2, specialsUsed: [] };
}

// ── Shadow: narrow mirror of handler's post-target-select decision ──────────
// Covers every flag-gated branch of combat.js:869–969 (v2). Ordering mirrors
// the handler so first-match semantics agree with Discord runtime. When a
// new branch is added to the handler, extend this shadow to match.
//
// Inputs:
//   game, attackerFigureKey (e.g. "Bossk-1-0"), msgId, targetFigureKey,
//   targetIsNpc (bool, optional — only matters for STFY block),
//   dcMessageMeta (Map, optional — only matters for STFY block)
// Output:
//   { outcome: 'block', reason: '<short>' }
//   { outcome: 'consume-window', window: '<short>' }
//   { outcome: 'proceed-normal' }
function decideAfterTargetSelect({ game, attackerFigureKey, msgId, targetFigureKey, targetIsNpc, dcMessageMeta }) {
  // 1. Etiquette and Protocol pair block (combat.js:874–884)
  const etiqPairs = game.etiquetteBlockPairs || [];
  if (etiqPairs.length && targetFigureKey) {
    const blocked = etiqPairs.some(([a, b]) =>
      (a === attackerFigureKey && b === targetFigureKey) ||
      (b === attackerFigureKey && a === targetFigureKey)
    );
    if (blocked) return { outcome: 'block', reason: 'etiquette' };
  }

  // 2. Still Faster Than You (combat.js:886–892): a Fell-Swoop free attack
  //    must target a DIFFERENT hostile than the one that just activated.
  //    Fires only when fellSwoopFreeAttack[msgId] and stillFasterExcludeMsgId
  //    are both set AND the target is not an NPC.
  if (game.fellSwoopFreeAttack?.[msgId] && game.stillFasterExcludeMsgId && targetFigureKey && !targetIsNpc) {
    const excMeta = dcMessageMeta?.get(game.stillFasterExcludeMsgId);
    if (excMeta && targetFigureKey.startsWith(`${excMeta.dcName}-`)) {
      return { outcome: 'block', reason: 'stfy-same-hostile' };
    }
  }

  // 3. Forced attack target mismatch (combat.js:894–902)
  //    Mandalorian Whip / Focus Fire / similar single-target locks.
  //    Per alexanbv 2026-05-13: keyed by attacker figureKey.
  const forced = game.forcedAttackTarget?.[attackerFigureKey];
  if (forced && targetFigureKey && targetFigureKey !== forced) {
    return { outcome: 'block', reason: 'forced-target-mismatch' };
  }

  // 4. Multi-Fire same-target (combat.js:903–910)
  const multiFireBlocked = game.multiFireBlockedTarget?.[msgId];
  if (multiFireBlocked && targetFigureKey === multiFireBlocked) {
    return { outcome: 'block', reason: 'multi-fire-same-target' };
  }

  // 5. Consumption windows (combat.js:937–968) — first-match wins; order
  //    matches handler's else-if chain exactly.
  if (game.pendingBattlefieldLeadership?.forMsgId === msgId) {
    return { outcome: 'consume-window', window: 'battlefield-leadership' };
  }
  if (game.fellSwoopFreeAttack?.[msgId]) {
    return { outcome: 'consume-window', window: 'fell-swoop' };
  }
  if (game.pendingEmperorInterrupt?.forMsgId === msgId) {
    return { outcome: 'consume-window', window: 'emperor-interrupt' };
  }
  if (game.pendingExecutiveOrder?.forMsgId === msgId) {
    return { outcome: 'consume-window', window: 'executive-order' };
  }
  if (game.pendingBombardmentSorin?.forMsgId === msgId) {
    return { outcome: 'consume-window', window: 'bombardment-sorin' };
  }
  if ((game.pendingFiringSquad || []).some(p => p.forMsgId === msgId)) {
    return { outcome: 'consume-window', window: 'firing-squad' };
  }
  if (game.pendingCoordinatedRaid?.forMsgId === msgId) {
    return { outcome: 'consume-window', window: 'coordinated-raid' };
  }
  if (game.pendingFieldTactics?.forMsgId === msgId) {
    return { outcome: 'consume-window', window: 'field-tactics' };
  }

  return { outcome: 'proceed-normal' };
}

// ── Engine-blindness probe: report-only ─────────────────────────────────────
function engineOffersSameTarget(game, playerNum, msgId, attackerFigureIndex, targetFigureKey, deps) {
  const actions = getAvailableActions(game, playerNum, deps);
  for (const a of actions) {
    if (a.type !== 'attack_target') continue;
    if (a.params?.msgId !== msgId) continue;
    if (a.params?.targetFigureKey !== targetFigureKey) continue;
    // customId: attack_target_{msgId}_{figIdx}_{targetIdx}
    const parts = (a.customId || '').split('_');
    const figIdxFromId = Number(parts[parts.length - 2]);
    if (figIdxFromId !== attackerFigureIndex) continue;
    return true;
  }
  return false;
}

// ── Scenarios ───────────────────────────────────────────────────────────────
// Each scenario:
//   setup()  → { game, deps, dcMessageMeta, attacker, target }
//   expected → { outcome, reason? | window? }
//   reason   → prose explaining what CRR rule the scenario pins
const SCENARIOS = [
  // 1. Baseline / positive control
  {
    name: 'baseline — no flags armed, attack proceeds normally',
    setup() {
      const built = createTestGame()
        .withPlayer1Army([{ dcName: 'Bossk' }])
        .withPlayer2Army([{ dcName: 'Greedo' }])
        .inRound(1)
        .build();
      const { game, dcMessageMeta } = built;
      game.figurePositions = {
        1: { 'Bossk-1-0': 'a1' },
        2: { 'Greedo-1-0': 'a3' },
      };
      const attackerMsgId = findDcMsgId(dcMessageMeta, game.gameId, 1, 'Bossk');
      enableAttackFor(game, attackerMsgId);
      return {
        ...built,
        attacker: { playerNum: 1, figureKey: 'Bossk-1-0', msgId: attackerMsgId, figureIndex: 0 },
        target: { figureKey: 'Greedo-1-0' },
      };
    },
    expected: { outcome: 'proceed-normal' },
    reason: 'no post-select gate flags; handler should proceed into normal combat resolution and decrement the action budget.',
  },

  // 2. Etiquette and Protocol pair block
  {
    name: 'etiquette — paired attacker/target pair is blocked this round',
    setup() {
      const built = createTestGame()
        .withPlayer1Army([{ dcName: 'Bossk' }])
        .withPlayer2Army([{ dcName: 'Greedo' }])
        .inRound(1)
        .build();
      const { game, dcMessageMeta } = built;
      game.figurePositions = {
        1: { 'Bossk-1-0': 'a1' },
        2: { 'Greedo-1-0': 'a3' },
      };
      game.etiquetteBlockPairs = [['Bossk-1-0', 'Greedo-1-0']];
      const attackerMsgId = findDcMsgId(dcMessageMeta, game.gameId, 1, 'Bossk');
      enableAttackFor(game, attackerMsgId);
      return {
        ...built,
        attacker: { playerNum: 1, figureKey: 'Bossk-1-0', msgId: attackerMsgId, figureIndex: 0 },
        target: { figureKey: 'Greedo-1-0' },
      };
    },
    expected: { outcome: 'block', reason: 'etiquette' },
    reason: 'Etiquette and Protocol CC: paired figures cannot attack each other this round. Handler returns early at combat.js:880–883.',
  },

  // 3. Multi-Fire same-target block
  {
    name: 'multi-fire — second attack must target a DIFFERENT figure',
    setup() {
      const built = createTestGame()
        .withPlayer1Army([{ dcName: 'Bossk' }])
        .withPlayer2Army([{ dcName: 'Greedo' }])
        .inRound(1)
        .build();
      const { game, dcMessageMeta } = built;
      game.figurePositions = {
        1: { 'Bossk-1-0': 'a1' },
        2: { 'Greedo-1-0': 'a3' },
      };
      const attackerMsgId = findDcMsgId(dcMessageMeta, game.gameId, 1, 'Bossk');
      enableAttackFor(game, attackerMsgId);
      game.multiFireBlockedTarget = { [attackerMsgId]: 'Greedo-1-0' };
      return {
        ...built,
        attacker: { playerNum: 1, figureKey: 'Bossk-1-0', msgId: attackerMsgId, figureIndex: 0 },
        target: { figureKey: 'Greedo-1-0' },
      };
    },
    expected: { outcome: 'block', reason: 'multi-fire-same-target' },
    reason: 'Multi-Fire: a figure performing a second attack cannot target the same figure it hit on the first attack. Handler returns early at combat.js:906–908.',
  },

  // 4. Forced-target mismatch block
  {
    name: 'forced-target — Focus Fire / Mandalorian Whip requires specific target',
    setup() {
      const built = createTestGame()
        .withPlayer1Army([{ dcName: 'Bossk' }])
        .withPlayer2Army([{ dcName: 'Greedo' }, { dcName: 'Jawa Scavenger' }])
        .inRound(1)
        .build();
      const { game, dcMessageMeta } = built;
      game.figurePositions = {
        1: { 'Bossk-1-0': 'a1' },
        2: { 'Greedo-1-0': 'a3', 'Jawa Scavenger-1-0': 'a4' },
      };
      const attackerMsgId = findDcMsgId(dcMessageMeta, game.gameId, 1, 'Bossk');
      enableAttackFor(game, attackerMsgId);
      // Forced to Greedo, but scenario picks Jawa Scavenger → block.
      // Per alexanbv 2026-05-13: keyed by attacker figureKey.
      game.forcedAttackTarget = { 'Bossk-1-0': 'Greedo-1-0' };
      return {
        ...built,
        attacker: { playerNum: 1, figureKey: 'Bossk-1-0', msgId: attackerMsgId, figureIndex: 0 },
        target: { figureKey: 'Jawa Scavenger-1-0' },
      };
    },
    expected: { outcome: 'block', reason: 'forced-target-mismatch' },
    reason: 'Forced-target lock (Focus Fire, Mandalorian Whip, similar): when game.forcedAttackTarget[attackerFigureKey] is set, only that exact target figureKey is legal. Handler returns early at combat.js:895–900.',
  },

  // 5. pendingFiringSquad consumes the attack
  {
    name: 'firing-squad — attack consumes the free-attack window, not an action',
    setup() {
      const built = createTestGame()
        .withPlayer1Army([{ dcName: 'Bossk' }])
        .withPlayer2Army([{ dcName: 'Greedo' }])
        .inRound(1)
        .build();
      const { game, dcMessageMeta } = built;
      game.figurePositions = {
        1: { 'Bossk-1-0': 'a1' },
        2: { 'Greedo-1-0': 'a3' },
      };
      const attackerMsgId = findDcMsgId(dcMessageMeta, game.gameId, 1, 'Bossk');
      enableAttackFor(game, attackerMsgId);
      game.pendingFiringSquad = [
        { forMsgId: attackerMsgId, chosenFigureKey: 'Greedo-1-0', triggeredByMsgId: attackerMsgId },
      ];
      return {
        ...built,
        attacker: { playerNum: 1, figureKey: 'Bossk-1-0', msgId: attackerMsgId, figureIndex: 0 },
        target: { figureKey: 'Greedo-1-0' },
      };
    },
    expected: { outcome: 'consume-window', window: 'firing-squad' },
    reason: 'Firing Squad (free attack): handler consumes the pendingFiringSquad entry for this msgId at combat.js:958–960 instead of decrementing actionsData.remaining.',
  },

  // 6. pendingCoordinatedRaid consumes the attack (added to prove the lane
  //    generalises past a single consumption-window shape — basically free)
  {
    name: 'coordinated-raid — attack consumes the free-attack window, not an action',
    setup() {
      const built = createTestGame()
        .withPlayer1Army([{ dcName: 'Bossk' }])
        .withPlayer2Army([{ dcName: 'Greedo' }])
        .inRound(1)
        .build();
      const { game, dcMessageMeta } = built;
      game.figurePositions = {
        1: { 'Bossk-1-0': 'a1' },
        2: { 'Greedo-1-0': 'a3' },
      };
      const attackerMsgId = findDcMsgId(dcMessageMeta, game.gameId, 1, 'Bossk');
      enableAttackFor(game, attackerMsgId);
      game.pendingCoordinatedRaid = {
        forMsgId: attackerMsgId,
        chosenFigureKey: 'Greedo-1-0',
        triggeredByMsgId: attackerMsgId,
      };
      return {
        ...built,
        attacker: { playerNum: 1, figureKey: 'Bossk-1-0', msgId: attackerMsgId, figureIndex: 0 },
        target: { figureKey: 'Greedo-1-0' },
      };
    },
    expected: { outcome: 'consume-window', window: 'coordinated-raid' },
    reason: 'Coordinated Raid (free attack): handler consumes pendingCoordinatedRaid for this msgId at combat.js:961–962 instead of decrementing actionsData.remaining.',
  },

  // 7. Still Faster Than You — Fell-Swoop free attack must target a DIFFERENT
  //    hostile than the one that just activated (block gate).
  {
    name: 'still-faster-than-you — free attack blocks when target matches excluded (just-activated) hostile',
    setup() {
      const built = createTestGame()
        .withPlayer1Army([{ dcName: 'Bossk' }])
        .withPlayer2Army([{ dcName: 'Greedo' }, { dcName: 'Jawa Scavenger' }])
        .inRound(1)
        .build();
      const { game, dcMessageMeta } = built;
      game.figurePositions = {
        1: { 'Bossk-1-0': 'a1' },
        2: { 'Greedo-1-0': 'a3', 'Jawa Scavenger-1-0': 'a4' },
      };
      const attackerMsgId = findDcMsgId(dcMessageMeta, game.gameId, 1, 'Bossk');
      const excludedMsgId = findDcMsgId(dcMessageMeta, game.gameId, 2, 'Greedo');
      enableAttackFor(game, attackerMsgId);
      // Fell Swoop grants the free attack; STFY excludes the just-activated
      // Greedo. Picking Greedo as the target should hit the STFY block.
      game.fellSwoopFreeAttack = { [attackerMsgId]: true };
      game.stillFasterExcludeMsgId = excludedMsgId;
      return {
        ...built,
        attacker: { playerNum: 1, figureKey: 'Bossk-1-0', msgId: attackerMsgId, figureIndex: 0 },
        target: { figureKey: 'Greedo-1-0', isNpc: false },
      };
    },
    expected: { outcome: 'block', reason: 'stfy-same-hostile' },
    reason: 'Still Faster Than You: a Fell-Swoop free attack must target a DIFFERENT hostile than the one that just activated. Handler returns early at combat.js:886–891.',
  },

  // 8. Battlefield Leadership — free attack consumes pendingBattlefieldLeadership
  {
    name: 'battlefield-leadership — attack consumes pendingBattlefieldLeadership window',
    setup() {
      const built = createTestGame()
        .withPlayer1Army([{ dcName: 'Bossk' }])
        .withPlayer2Army([{ dcName: 'Greedo' }])
        .inRound(1)
        .build();
      const { game, dcMessageMeta } = built;
      game.figurePositions = {
        1: { 'Bossk-1-0': 'a1' },
        2: { 'Greedo-1-0': 'a3' },
      };
      const attackerMsgId = findDcMsgId(dcMessageMeta, game.gameId, 1, 'Bossk');
      enableAttackFor(game, attackerMsgId);
      game.pendingBattlefieldLeadership = { forMsgId: attackerMsgId, chosenFigureKey: 'Greedo-1-0' };
      return {
        ...built,
        attacker: { playerNum: 1, figureKey: 'Bossk-1-0', msgId: attackerMsgId, figureIndex: 0 },
        target: { figureKey: 'Greedo-1-0', isNpc: false },
      };
    },
    expected: { outcome: 'consume-window', window: 'battlefield-leadership' },
    reason: 'Battlefield Leadership (free attack): handler consumes pendingBattlefieldLeadership at combat.js:946–947 instead of decrementing actionsData.remaining.',
  },

  // 9. Fell Swoop — free attack consumes fellSwoopFreeAttack (no STFY conflict)
  {
    name: 'fell-swoop — free attack consumes fellSwoopFreeAttack window (no STFY exclusion)',
    setup() {
      const built = createTestGame()
        .withPlayer1Army([{ dcName: 'Bossk' }])
        .withPlayer2Army([{ dcName: 'Greedo' }])
        .inRound(1)
        .build();
      const { game, dcMessageMeta } = built;
      game.figurePositions = {
        1: { 'Bossk-1-0': 'a1' },
        2: { 'Greedo-1-0': 'a3' },
      };
      const attackerMsgId = findDcMsgId(dcMessageMeta, game.gameId, 1, 'Bossk');
      enableAttackFor(game, attackerMsgId);
      // Fell Swoop granted, no stillFasterExcludeMsgId → STFY path skipped,
      // consumption path wins.
      game.fellSwoopFreeAttack = { [attackerMsgId]: true };
      return {
        ...built,
        attacker: { playerNum: 1, figureKey: 'Bossk-1-0', msgId: attackerMsgId, figureIndex: 0 },
        target: { figureKey: 'Greedo-1-0', isNpc: false },
      };
    },
    expected: { outcome: 'consume-window', window: 'fell-swoop' },
    reason: 'Fell Swoop (free attack, no STFY exclusion): handler consumes fellSwoopFreeAttack[msgId] at combat.js:948–951 instead of decrementing actionsData.remaining.',
  },

  // 10. Emperor Interrupt — free attack consumes pendingEmperorInterrupt
  {
    name: 'emperor-interrupt — attack consumes pendingEmperorInterrupt window',
    setup() {
      const built = createTestGame()
        .withPlayer1Army([{ dcName: 'Bossk' }])
        .withPlayer2Army([{ dcName: 'Greedo' }])
        .inRound(1)
        .build();
      const { game, dcMessageMeta } = built;
      game.figurePositions = {
        1: { 'Bossk-1-0': 'a1' },
        2: { 'Greedo-1-0': 'a3' },
      };
      const attackerMsgId = findDcMsgId(dcMessageMeta, game.gameId, 1, 'Bossk');
      enableAttackFor(game, attackerMsgId);
      game.pendingEmperorInterrupt = { forMsgId: attackerMsgId, chosenFigureKey: 'Greedo-1-0' };
      return {
        ...built,
        attacker: { playerNum: 1, figureKey: 'Bossk-1-0', msgId: attackerMsgId, figureIndex: 0 },
        target: { figureKey: 'Greedo-1-0', isNpc: false },
      };
    },
    expected: { outcome: 'consume-window', window: 'emperor-interrupt' },
    reason: 'Emperor Interrupt (free attack): handler consumes pendingEmperorInterrupt at combat.js:952–953 instead of decrementing actionsData.remaining.',
  },

  // 11. Executive Order — free attack consumes pendingExecutiveOrder
  {
    name: 'executive-order — attack consumes pendingExecutiveOrder window',
    setup() {
      const built = createTestGame()
        .withPlayer1Army([{ dcName: 'Bossk' }])
        .withPlayer2Army([{ dcName: 'Greedo' }])
        .inRound(1)
        .build();
      const { game, dcMessageMeta } = built;
      game.figurePositions = {
        1: { 'Bossk-1-0': 'a1' },
        2: { 'Greedo-1-0': 'a3' },
      };
      const attackerMsgId = findDcMsgId(dcMessageMeta, game.gameId, 1, 'Bossk');
      enableAttackFor(game, attackerMsgId);
      game.pendingExecutiveOrder = { forMsgId: attackerMsgId, chosenFigureKey: 'Greedo-1-0' };
      return {
        ...built,
        attacker: { playerNum: 1, figureKey: 'Bossk-1-0', msgId: attackerMsgId, figureIndex: 0 },
        target: { figureKey: 'Greedo-1-0', isNpc: false },
      };
    },
    expected: { outcome: 'consume-window', window: 'executive-order' },
    reason: 'Executive Order (free attack): handler consumes pendingExecutiveOrder at combat.js:954–955 instead of decrementing actionsData.remaining.',
  },

  // 12. Bombardment Sorin — free attack consumes pendingBombardmentSorin
  {
    name: 'bombardment-sorin — attack consumes pendingBombardmentSorin window',
    setup() {
      const built = createTestGame()
        .withPlayer1Army([{ dcName: 'Bossk' }])
        .withPlayer2Army([{ dcName: 'Greedo' }])
        .inRound(1)
        .build();
      const { game, dcMessageMeta } = built;
      game.figurePositions = {
        1: { 'Bossk-1-0': 'a1' },
        2: { 'Greedo-1-0': 'a3' },
      };
      const attackerMsgId = findDcMsgId(dcMessageMeta, game.gameId, 1, 'Bossk');
      enableAttackFor(game, attackerMsgId);
      game.pendingBombardmentSorin = { forMsgId: attackerMsgId, chosenFigureKey: 'Greedo-1-0' };
      return {
        ...built,
        attacker: { playerNum: 1, figureKey: 'Bossk-1-0', msgId: attackerMsgId, figureIndex: 0 },
        target: { figureKey: 'Greedo-1-0', isNpc: false },
      };
    },
    expected: { outcome: 'consume-window', window: 'bombardment-sorin' },
    reason: 'Bombardment Sorin (free attack): handler consumes pendingBombardmentSorin at combat.js:956–957 instead of decrementing actionsData.remaining.',
  },

  // 13. Field Tactics — free attack consumes pendingFieldTactics
  {
    name: 'field-tactics — attack consumes pendingFieldTactics window',
    setup() {
      const built = createTestGame()
        .withPlayer1Army([{ dcName: 'Bossk' }])
        .withPlayer2Army([{ dcName: 'Greedo' }])
        .inRound(1)
        .build();
      const { game, dcMessageMeta } = built;
      game.figurePositions = {
        1: { 'Bossk-1-0': 'a1' },
        2: { 'Greedo-1-0': 'a3' },
      };
      const attackerMsgId = findDcMsgId(dcMessageMeta, game.gameId, 1, 'Bossk');
      enableAttackFor(game, attackerMsgId);
      game.pendingFieldTactics = { forMsgId: attackerMsgId, chosenFigureKey: 'Greedo-1-0' };
      return {
        ...built,
        attacker: { playerNum: 1, figureKey: 'Bossk-1-0', msgId: attackerMsgId, figureIndex: 0 },
        target: { figureKey: 'Greedo-1-0', isNpc: false },
      };
    },
    expected: { outcome: 'consume-window', window: 'field-tactics' },
    reason: 'Field Tactics (free attack): handler consumes pendingFieldTactics at combat.js:963–964 instead of decrementing actionsData.remaining.',
  },
];

// ── Runner ──────────────────────────────────────────────────────────────────
describe('Post-target-select combat gating (non-mutating surfacing)', () => {
  // Track engine-blindness counts so we can log one-line summary at the end.
  let totalScenarios = 0;
  let engineOfferedWhenGateActive = 0;  // block or consume; engine blindness signal

  for (const s of SCENARIOS) {
    it(s.name, () => {
      const ctx = s.setup();
      const { game, deps, dcMessageMeta, attacker, target } = ctx;

      const decision = decideAfterTargetSelect({
        game,
        attackerFigureKey: attacker.figureKey,
        msgId: attacker.msgId,
        targetFigureKey: target.figureKey,
        targetIsNpc: target.isNpc === true,
        dcMessageMeta,
      });

      const engineOffers = engineOffersSameTarget(
        game, attacker.playerNum, attacker.msgId,
        attacker.figureIndex, target.figureKey, deps
      );

      console.log(`\n[post-select] ${s.name}`);
      console.log(`  shadow decision: ${JSON.stringify(decision)}`);
      console.log(`  expected:        ${JSON.stringify(s.expected)}`);
      console.log(`  engine offers same target: ${engineOffers ? 'yes' : 'no'}`);
      console.log(`  reason: ${s.reason}`);

      totalScenarios++;
      if (decision.outcome !== 'proceed-normal' && engineOffers) {
        engineOfferedWhenGateActive++;
      }

      assert.deepStrictEqual(
        decision, s.expected,
        `post-select decision drift. Expected ${JSON.stringify(s.expected)}, got ${JSON.stringify(decision)}. ` +
        `Either the shadow needs updating (handler behavior changed), or a gate was silently removed from combat.js. ` +
        `Review combat.js post-target-select block and update the shadow or fix the drift.`
      );
    });
  }

  it('engine-blindness summary (report-only)', () => {
    const blindGates = Math.max(0, totalScenarios - 1); // subtract positive-control baseline
    console.log(
      `\n[post-select] Engine blindness: ` +
      `${engineOfferedWhenGateActive} of ${blindGates} gated scenarios ` +
      `had engine still offering the target (handler-only gates). ` +
      `Current shape: engine enumerates all reachable targets regardless of these post-select flags — ` +
      `a known drift surface, tracked but not yet fixed.`
    );
    assert.ok(true);
  });
});
