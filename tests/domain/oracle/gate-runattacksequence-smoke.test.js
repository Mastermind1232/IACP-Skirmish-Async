/**
 * SMOKE: drive a full attack through the GATE outer orchestration
 * (runAttackSequence → on_declare → roll → rerolls → special → mods →
 * spend_surges → zillo → damage → after_resolve) with combatSequenceMode ON,
 * using REAL headless deps (no mocked resolveCombatAfterRolls / roll).
 *
 * This is the integration coverage the gate outer path lacked. It regression-
 * guards the missing `getInnateRerollAbilities` import in handlers/combat.js,
 * which crashed the roll step (ReferenceError) on every gate-mode attack and
 * was invisible to the suite because no test drove the real roll path. Proves
 * the gate can be the sole pipeline before legacy is removed.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createTestGame } from '../../fixtures/game-builder.js';
import { runAttackSequence } from '../../../src/handlers/combat.js';
import { createFakeChannel } from '../../../src/headless/fake-interaction.js';

function firstFigKey(game, pn) {
  return Object.keys(game.figurePositions[pn] || {})[0];
}
function metaFor(dcMessageMeta, gameId, pn) {
  for (const [msgId, meta] of dcMessageMeta) {
    if (meta.gameId === gameId && meta.playerNum === pn) return { msgId, meta };
  }
  return {};
}

describe('GATE-SMOKE: runAttackSequence end-to-end with real deps', () => {
  it('drives a melee attack through every gate step without throwing and reaches after_resolve', async () => {
    const built = createTestGame()
      .withMap('mos-eisley-outskirts')
      .withPlayer1Army([{ dcName: 'Stormtrooper' }])
      .withPlayer2Army([{ dcName: 'Rebel Trooper' }])
      .inRound(1)
      .build();

    const { game, deps, dcMessageMeta } = built;
    game.combatSequenceMode = true;
    game.selfPlay = true; // auto-drain gate Ready windows under headless

    const atkFk = firstFigKey(game, 1);
    const defFk = firstFigKey(game, 2);
    game.figurePositions[1] = { [atkFk]: 'b1' };
    game.figurePositions[2] = { [defFk]: 'c1' };

    const A = metaFor(dcMessageMeta, game.gameId, 1);
    const D = metaFor(dcMessageMeta, game.gameId, 2);

    const thread = createFakeChannel('gate-smoke-thread');

    // Note: do NOT pre-set attackRoll/defenseRoll — let the gate roll fresh so
    // the real roll → reroll-window setup path executes (where the import bug lived).
    const combat = {
      gameId: game.gameId,
      combatThreadId: 'gate-smoke-thread',
      attackerPlayerNum: 1,
      defenderPlayerNum: 2,
      attackerMsgId: A.msgId,
      attackerDcName: A.meta.dcName,
      attackerDisplayName: A.meta.displayName || A.meta.dcName,
      attackerFigureIndex: 0,
      attackerFigureKey: atkFk,
      attackerConds: [],
      defenderConds: [],
      target: { msgId: D.msgId, figureKey: defFk, label: D.meta.displayName || D.meta.dcName },
      targetSquare: 'c1',
      targetStats: { defense: ['white'], cost: 5, figures: 1 },
      attackInfo: { dice: ['blue', 'green'], type: 'melee' },
      isRanged: false,
      distanceToTarget: 1,
      bonusSurgeAbilities: [],
      bonusHits: 0, bonusPierce: 0, bonusAccuracy: 0, bonusBlock: 0, bonusEvade: 0,
      surgeConditions: [], bonusConditions: [],
      surgeDamage: 0, surgePierce: 0, surgeAccuracy: 0,
    };
    game.pendingCombat = combat;

    let threw = null;
    try {
      await runAttackSequence(thread, game, combat, deps);
    } catch (e) {
      threw = e;
    }

    assert.equal(threw, null, `runAttackSequence threw: ${threw && (threw.stack || threw.message)}`);
    assert.equal(combat._seqStep, 'after_resolve',
      `expected gate to walk through to after_resolve, parked at "${combat._seqStep}"`);
    // The attack rolled fresh dice through the real roll path (proves no
    // ReferenceError in the reroll-window setup).
    assert.ok(combat.attackRoll && typeof combat.attackRoll.dmg === 'number',
      'attack roll was computed through the gate roll step');
  });
});
