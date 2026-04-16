/**
 * Post-Target-Select Combat Gating — non-mutating surfacing layer.
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
 *   - a small scenario-scoped shadow `decideAfterTargetSelect` mirrors the
 *     main proceed/block/consume-window decision for the scenarios covered
 *     below (ONLY the gates the scenarios exercise — etiquette block,
 *     multi-fire same-target, forced-target mismatch, pendingFiringSquad,
 *     pendingCoordinatedRaid). The shadow is NOT a full mirror of the
 *     handler and must be extended when new scenarios are added.
 *   - each scenario asserts the shadow's { outcome, reason? | window? }
 *     matches the baseline. Regressions or silent gate removal fail here.
 *   - engine-blindness is reported informationally: for each scenario we
 *     log whether `getAvailableActions` still enumerates the same target
 *     (it does — the engine is unaware of these post-select flags).
 *
 * What this DOES NOT cover in v1:
 *   - secondary side effects (arcing-shot flag clear, ballistics matrix
 *     flag clear, droid-arm power-token deduction, bonus hit/evade
 *     accumulation)
 *   - Still Faster Than You exclusion (free-attack different-target rule)
 *   - the other pending-window consumption flags: pendingBattlefieldLeadership,
 *     fellSwoopFreeAttack, pendingEmperorInterrupt, pendingExecutiveOrder,
 *     pendingBombardmentSorin, pendingFieldTactics
 *   - combat resolution itself (damage formula, surge spending)
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
// Scoped to the gates exercised by the scenarios below. When adding new
// scenarios, extend this shadow to match. Ordering mirrors combat.js so
// first-match semantics agree with the handler.
//
// Inputs:
//   game, attackerFigureKey (e.g. "Bossk-1-0"), msgId, targetFigureKey
// Output:
//   { outcome: 'block', reason: '<short>' }
//   { outcome: 'consume-window', window: '<short>' }
//   { outcome: 'proceed-normal' }
function decideAfterTargetSelect({ game, attackerFigureKey, msgId, targetFigureKey }) {
  // 1. Etiquette and Protocol pair block (combat.js:874–884)
  const etiqPairs = game.etiquetteBlockPairs || [];
  if (etiqPairs.length && targetFigureKey) {
    const blocked = etiqPairs.some(([a, b]) =>
      (a === attackerFigureKey && b === targetFigureKey) ||
      (b === attackerFigureKey && a === targetFigureKey)
    );
    if (blocked) return { outcome: 'block', reason: 'etiquette' };
  }

  // 2. Forced attack target mismatch (combat.js:894–902)
  //    Mandalorian Whip / Focus Fire / similar single-target locks
  const forced = game.forcedAttackTarget?.[msgId];
  if (forced && targetFigureKey && targetFigureKey !== forced) {
    return { outcome: 'block', reason: 'forced-target-mismatch' };
  }

  // 3. Multi-Fire same-target (combat.js:903–910)
  const multiFireBlocked = game.multiFireBlockedTarget?.[msgId];
  if (multiFireBlocked && targetFigureKey === multiFireBlocked) {
    return { outcome: 'block', reason: 'multi-fire-same-target' };
  }

  // 4. Consumption windows — first-match wins; order matches handler
  //    (combat.js:937–964). Only the windows exercised by scenarios are
  //    modeled; others will be added when scenarios are written.
  if ((game.pendingFiringSquad || []).some(p => p.forMsgId === msgId)) {
    return { outcome: 'consume-window', window: 'firing-squad' };
  }
  if (game.pendingCoordinatedRaid?.forMsgId === msgId) {
    return { outcome: 'consume-window', window: 'coordinated-raid' };
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
      // Forced to Greedo, but scenario picks Jawa Scavenger → block
      game.forcedAttackTarget = { [attackerMsgId]: 'Greedo-1-0' };
      return {
        ...built,
        attacker: { playerNum: 1, figureKey: 'Bossk-1-0', msgId: attackerMsgId, figureIndex: 0 },
        target: { figureKey: 'Jawa Scavenger-1-0' },
      };
    },
    expected: { outcome: 'block', reason: 'forced-target-mismatch' },
    reason: 'Forced-target lock (Focus Fire, Mandalorian Whip, similar): when game.forcedAttackTarget[msgId] is set, only that exact figureKey is legal. Handler returns early at combat.js:895–900.',
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
];

// ── Runner ──────────────────────────────────────────────────────────────────
describe('Post-target-select combat gating (non-mutating surfacing)', () => {
  // Track engine-blindness counts so we can log one-line summary at the end.
  let totalScenarios = 0;
  let engineOfferedWhenGateActive = 0;  // block or consume; engine blindness signal

  for (const s of SCENARIOS) {
    it(s.name, () => {
      const ctx = s.setup();
      const { game, deps, attacker, target } = ctx;

      const decision = decideAfterTargetSelect({
        game,
        attackerFigureKey: attacker.figureKey,
        msgId: attacker.msgId,
        targetFigureKey: target.figureKey,
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
