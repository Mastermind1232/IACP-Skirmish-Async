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
async function attackInto(defenderDc, opts = {}) {
  const built = createTestGame()
    .withMap('mos-eisley-outskirts')
    .withPlayer1Army([{ dcName: opts.attackerDc || 'Stormtrooper' }])
    .withPlayer2Army([{ dcName: defenderDc }])
    .inRound(1)
    .build();
  const { game, deps, dcMessageMeta } = built;
  game.combatSequenceMode = true;
  game.selfPlay = true;
  const a = firstFigKey(game, 1);
  const d = firstFigKey(game, 2);
  const atkSq = opts.atkSq || 'b1';
  const defSq = opts.defSq || 'c1';
  game.figurePositions[1] = { [a]: atkSq };
  game.figurePositions[2] = { [d]: defSq };
  if (opts.attackerConditions) {
    game.figureConditions = game.figureConditions || {};
    game.figureConditions[a] = opts.attackerConditions;
  }
  const A = metaFor(dcMessageMeta, game.gameId, 1);
  const D = metaFor(dcMessageMeta, game.gameId, 2);
  const combat = {
    gameId: game.gameId, combatThreadId: 'mt-thread',
    attackerPlayerNum: 1, defenderPlayerNum: 2,
    attackerMsgId: A.msgId, attackerDcName: A.meta.dcName, attackerDisplayName: A.meta.dcName,
    defenderDcName: D.meta.dcName,
    attackerFigureIndex: 0, attackerFigureKey: a, attackerConds: [], defenderConds: [],
    target: { msgId: D.msgId, figureKey: d, label: D.meta.dcName },
    targetSquare: defSq, targetStats: { defense: ['white'], cost: 5, figures: 1 },
    attackInfo: { dice: ['blue', 'green'], type: opts.type || 'melee' },
    isRanged: opts.type === 'range', distanceToTarget: opts.dist || 1,
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

  it('Gamorrean Honor Guard: +1 Block on a ranged attack, once', async () => {
    const combat = await attackInto('Gamorrean Guard (Elite)', { type: 'range', dist: 3, defSq: 'e1' });
    assert.equal(combat.bonusBlock, 1, 'Gamorrean Honor Guard must apply +1 Block once (ranged)');
  });

  it('Gamorrean Honor Guard: no Block on a melee attack', async () => {
    const combat = await attackInto('Gamorrean Guard (Elite)', { type: 'melee', dist: 1 });
    assert.equal(combat.bonusBlock || 0, 0, 'Gamorrean Honor Guard must NOT apply on a melee attack');
  });

  it('Composite Plating (Heavy Stormtrooper): +1 Block when attacker 4+ away, once', async () => {
    const combat = await attackInto('Heavy Stormtrooper (Regular)', { type: 'range', dist: 5, defSq: 'f1' });
    assert.equal(combat.bonusBlock, 1, 'Composite Plating must apply +1 Block once (attacker 4+ away)');
  });

  it('Composite Plating: no Block when attacker adjacent', async () => {
    const combat = await attackInto('Heavy Stormtrooper (Regular)', { type: 'melee', dist: 1 });
    assert.equal(combat.bonusBlock || 0, 0, 'Composite Plating must NOT apply when attacker is close');
  });

  it('Disposable (Hired Gun): -1 Evade applied once via the mods window', async () => {
    const combat = await attackInto('Hired Gun (Regular)');
    assert.equal(combat.bonusEvade, -1, 'Disposable must apply -1 Evade exactly once');
  });

  it('Cortosis Weave (Echo Base Trooper Elite): -2 Pierce applied once', async () => {
    const combat = await attackInto('Echo Base Trooper (Elite)');
    assert.equal(combat.bonusPierce, -2, 'Cortosis Weave must reduce Pierce by 2 exactly once');
  });

  it('Conclusion (HK-47 attacker): sets conclusionDodgeCancel via the mods window', async () => {
    const combat = await attackInto('Rebel Trooper', { attackerDc: 'HK-47' });
    assert.equal(combat.conclusionDodgeCancel, true, 'Conclusion must set the Dodge-cancel flag');
  });

  it('Cunning (Nexu defender): hasCunning flag set via the mods window', async () => {
    const combat = await attackInto('Nexu (Elite)');
    assert.equal(combat.hasCunning, true, 'Cunning must set the hasCunning flag once');
  });

  it('Find Weakness (Scout Trooper Elite attacker): -1 Evade via the mods window', async () => {
    const combat = await attackInto('Rebel Trooper', { attackerDc: 'Scout Trooper (Elite)' });
    assert.equal(combat.bonusEvade, -1, 'Find Weakness must apply -1 Evade exactly once');
  });

  it('Scattergun (Trandoshan Hunter): +1 Hit when adjacent, once', async () => {
    const combat = await attackInto('Rebel Trooper', { attackerDc: 'Trandoshan Hunter (Regular)', type: 'melee', dist: 1 });
    assert.equal(combat.bonusHits, 1, 'Scattergun must apply +1 Hit once when adjacent');
  });

  it('Forest Fighters (Ewok Warrior Elite): +1 Hit on a melee attack while Hidden, once', async () => {
    const combat = await attackInto('Rebel Trooper', {
      attackerDc: 'Ewok Warrior (Elite)', type: 'melee', dist: 1, attackerConditions: ['Hide'],
    });
    assert.equal(combat.bonusHits, 1, 'Forest Fighters must apply +1 Hit once (melee + Hidden)');
  });

  it('Forest Fighters: no Hit when not Hidden', async () => {
    const combat = await attackInto('Rebel Trooper', { attackerDc: 'Ewok Warrior (Elite)', type: 'melee', dist: 1 });
    assert.equal(combat.bonusHits || 0, 0, 'Forest Fighters must NOT apply when not Hidden');
  });
});
