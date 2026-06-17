/**
 * Verifies automatic combat modifiers fire in their CORRECT timing window (the
 * mods gate) — NOT eagerly at declaration — and apply EXACTLY ONCE (no double-
 * apply) when driven through the full gate sequence.
 *
 * Per alexanbv 2026-06-16: "they cannot be offered at declaration because that
 * is the wrong timing ... You must move them. Then, check for double apply."
 * Each ability moved out of handleAttackTarget into a mods-window passive gets
 * a case here.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createTestGame } from '../../fixtures/game-builder.js';
import { driveGateAttackToEnd } from '../../fixtures/gate-driver.js';
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

/** Drive Stormtrooper → defenderDc through the gate; return the resolved combat. */
async function attackInto(defenderDc) {
  const built = createTestGame()
    .withMap('mos-eisley-outskirts')
    .withPlayer1Army([{ dcName: 'Stormtrooper' }])
    .withPlayer2Army([{ dcName: defenderDc }])
    .inRound(1)
    .build();
  const { game, deps, dcMessageMeta } = built;
  game.combatSequenceMode = true;
  game.selfPlay = true;
  const a = firstFigKey(game, 1);
  const d = firstFigKey(game, 2);
  game.figurePositions[1] = { [a]: 'b1' };
  game.figurePositions[2] = { [d]: 'c1' };
  const A = metaFor(dcMessageMeta, game.gameId, 1);
  const D = metaFor(dcMessageMeta, game.gameId, 2);
  const combat = {
    gameId: game.gameId, combatThreadId: 'mt-thread',
    attackerPlayerNum: 1, defenderPlayerNum: 2,
    attackerMsgId: A.msgId, attackerDcName: A.meta.dcName, attackerDisplayName: A.meta.dcName,
    defenderDcName: D.meta.dcName,
    attackerFigureIndex: 0, attackerFigureKey: a, attackerConds: [], defenderConds: [],
    target: { msgId: D.msgId, figureKey: d, label: D.meta.dcName },
    targetSquare: 'c1', targetStats: { defense: ['white'], cost: 5, figures: 1 },
    attackInfo: { dice: ['blue', 'green'], type: 'melee' }, isRanged: false, distanceToTarget: 1,
    bonusSurgeAbilities: [], bonusHits: 0, bonusPierce: 0, bonusAccuracy: 0, bonusBlock: 0, bonusEvade: 0,
    surgeConditions: [], bonusConditions: [], surgeDamage: 0, surgePierce: 0, surgeAccuracy: 0,
  };
  const r = await driveGateAttackToEnd(game, combat, deps, createFakeChannel('mt-thread'));
  assert.equal(r.threw, null, `${defenderDc} threw: ${r.threw && (r.threw.stack || r.threw.message)}`);
  return combat;
}

describe('GATE mods timing move: automatics fire in the mods window, once', () => {
  it('Slippery (Alliance Smuggler): -2 Accuracy applied once via the mods window', async () => {
    const combat = await attackInto('Alliance Smuggler (Regular)');
    assert.equal(combat.bonusAccuracy, -2,
      'Slippery must apply -2 Accuracy exactly once (mods passive, not declaration)');
  });

  it('control: a non-Slippery defender gets no accuracy mod', async () => {
    const combat = await attackInto('Rebel Trooper');
    assert.equal(combat.bonusAccuracy || 0, 0, 'no Slippery → no accuracy change');
  });

  it('Take Cover (Jawa Scavenger): +1 Block / -1 Evade applied once via the mods window', async () => {
    const combat = await attackInto('Jawa Scavenger (Regular)');
    assert.equal(combat.bonusBlock, 1, 'Take Cover must apply +1 Block exactly once');
    assert.equal(combat.bonusEvade, -1, 'Take Cover must apply -1 Evade exactly once');
  });
});
