/**
 * BATTERY: drive many real DC matchups through the full gate sequence
 * (combatSequenceMode ON) to completion, auto-passing every interactive gate
 * via the headless gate-driver. Asserts each attack walks to `after_resolve`
 * without throwing — flushing crashes across the whole step machine for a
 * representative spread of attacker/defender/range/large-figure cases.
 *
 * Widened coverage for the legacy→gate cutover (Destruct, Jun 16: "keep
 * widening ... replace the old code with the new gate machine").
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

async function runMatchup(p1, p2, opts = {}) {
  const built = createTestGame()
    .withMap('mos-eisley-outskirts')
    .withPlayer1Army([{ dcName: p1 }])
    .withPlayer2Army([{ dcName: p2 }])
    .inRound(1)
    .build();
  const { game, deps, dcMessageMeta } = built;
  game.combatSequenceMode = true;
  game.selfPlay = true;

  const a = firstFigKey(game, 1);
  const d = firstFigKey(game, 2);
  game.figurePositions[1] = { [a]: opts.atkSq || 'b1' };
  game.figurePositions[2] = { [d]: opts.defSq || 'c1' };
  const A = metaFor(dcMessageMeta, game.gameId, 1);
  const D = metaFor(dcMessageMeta, game.gameId, 2);
  const thread = createFakeChannel('battery-thread');

  const combat = {
    gameId: game.gameId,
    combatThreadId: 'battery-thread',
    attackerPlayerNum: 1,
    defenderPlayerNum: 2,
    attackerMsgId: A.msgId,
    attackerDcName: A.meta.dcName,
    attackerDisplayName: A.meta.displayName || A.meta.dcName,
    attackerFigureIndex: 0,
    attackerFigureKey: a,
    attackerConds: [],
    defenderConds: [],
    target: { msgId: D.msgId, figureKey: d, label: D.meta.displayName || D.meta.dcName },
    targetSquare: opts.defSq || 'c1',
    targetStats: { defense: opts.def || ['white'], cost: 5, figures: 1 },
    attackInfo: { dice: opts.dice || ['blue', 'green'], type: opts.type || 'melee' },
    isRanged: opts.type === 'range',
    distanceToTarget: opts.dist || 1,
    bonusSurgeAbilities: [],
    bonusHits: 0, bonusPierce: 0, bonusAccuracy: 0, bonusBlock: 0, bonusEvade: 0,
    surgeConditions: [], bonusConditions: [],
    surgeDamage: 0, surgePierce: 0, surgeAccuracy: 0,
  };
  return driveGateAttackToEnd(game, combat, deps, thread);
}

const MATCHUPS = [
  ['Stormtrooper', 'Rebel Trooper', {}],
  ['Rebel Trooper', 'Stormtrooper', { type: 'range', dist: 3, defSq: 'e1' }],
  ['IG-88', 'Rebel Trooper', {}],
  ['Stormtrooper', 'Nexu', {}],
  ['Boba Fett', 'Luke Skywalker', {}],
  ['Darth Vader', 'Han Solo', {}],
  ['Chewbacca', 'Stormtrooper', {}],
  ['Greedo', 'Rebel Trooper', { type: 'range', dist: 4, defSq: 'f1' }],
  ['Royal Guard', 'Rebel Trooper', {}],
  ['General Weiss', 'Luke Skywalker', {}],
  ['Bossk', 'Greedo', {}],
  ['Gideon Hask', 'Jyn Erso', {}],
];

describe('GATE-BATTERY: real matchups walk the gate to after_resolve', () => {
  for (const [p1, p2, opts] of MATCHUPS) {
    const label = `${p1} → ${p2}${opts.type === 'range' ? ' (ranged)' : ''}`;
    it(label, async () => {
      const r = await runMatchup(p1, p2, opts);
      assert.equal(r.threw, null, `${label} threw: ${r.threw && (r.threw.stack || r.threw.message)}`);
      assert.equal(r.hitGuard, false, `${label} hit the pass guard (stuck at ${r.finalStep})`);
      assert.equal(r.finalStep, 'after_resolve', `${label} ended at "${r.finalStep}", expected after_resolve`);
    });
  }
});
