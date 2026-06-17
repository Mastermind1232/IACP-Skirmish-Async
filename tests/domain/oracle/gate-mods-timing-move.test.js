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
  const { game, deps, dcMessageMeta, dcHealthState } = built;
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
  if (opts.defenderConditions) {
    game.figureConditions = game.figureConditions || {};
    game.figureConditions[d] = opts.defenderConditions;
  }
  if (opts.attackerDcAdd) (game.p1DcList = game.p1DcList || []).push({ dcName: opts.attackerDcAdd });
  if (opts.defenderDcAdd) (game.p2DcList = game.p2DcList || []).push({ dcName: opts.defenderDcAdd });
  const A = metaFor(dcMessageMeta, game.gameId, 1);
  const D = metaFor(dcMessageMeta, game.gameId, 2);
  if (opts.attackerSuffered) {
    const hs = dcHealthState.get(A.msgId) || [[10, 10]];
    const [cur, max] = hs[0] || [10, 10];
    hs[0] = [Math.max(0, (max ?? cur) - opts.attackerSuffered), max ?? cur];
    dcHealthState.set(A.msgId, hs);
  }
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
  if (opts.spentToken) combat.attackerSpentPowerToken = true;
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

  it('Dead Precise −1 Dodge (Ko-Tun): mods rider fires when a Power Token was spent', async () => {
    const spent = await attackInto('Stormtrooper', { attackerDc: 'Ko-Tun Feralo', spentToken: true });
    assert.equal(spent.bonusDodge, -1, 'Dead Precise −1 Dodge must apply once when a token was spent');
  });

  it('Dead Precise −1 Dodge: no rider when no Power Token was spent', async () => {
    const noToken = await attackInto('Stormtrooper', { attackerDc: 'Ko-Tun Feralo' });
    assert.equal(noToken.bonusDodge || 0, 0, 'Dead Precise −1 Dodge must NOT apply without a spent token');
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

  it('Exploit Weakness (Scout Trooper Elite): +1 Surge when defender has a harmful condition', async () => {
    const combat = await attackInto('Rebel Trooper', { attackerDc: 'Scout Trooper (Elite)', defenderConditions: ['Bleed'] });
    assert.equal(combat.surgeBonus, 1, 'Exploit Weakness must apply +1 Surge once (defender harmful condition)');
  });

  it('Exploit Weakness: no Surge when defender has no harmful condition', async () => {
    const combat = await attackInto('Rebel Trooper', { attackerDc: 'Scout Trooper (Elite)' });
    assert.equal(combat.surgeBonus || 0, 0, 'Exploit Weakness must NOT apply without a harmful condition');
  });

  // Aim (Rebel Trooper Elite) is a CARD PENDING IACP CHANGE — intentionally not
  // wired (see cards-pending-change.js). No test until the new text lands.
});

// on_declare auto-Focus abilities fire in the on_declare window (BEFORE the
// roll) and add a bonus die to the attack pool exactly once.
describe('GATE on_declare timing move: auto-Focus fires before the roll, once', () => {
  it('Battle Meditation (Diala Passil): adds +1 green die at on_declare', async () => {
    const combat = await attackInto('Stormtrooper', { attackerDc: 'Diala Passil' });
    // attackInfo.dice started as ['blue','green']; Battle Meditation adds one green.
    assert.equal(combat.attackInfo.dice.length, 3,
      `Battle Meditation must add exactly one die (got ${JSON.stringify(combat.attackInfo.dice)})`);
    assert.equal(combat.attackInfo.dice.filter((d) => d === 'green').length, 2,
      'the added die must be green');
  });

  it('control: a non-Battle-Meditation attacker gets no extra die', async () => {
    const combat = await attackInto('Stormtrooper', { attackerDc: 'Stormtrooper' });
    assert.equal(combat.attackInfo.dice.length, 2, 'no auto-Focus → pool unchanged');
  });

  it('Sharpshooter (Fennec Shand): +1 green die at on_declare when target 5+ away', async () => {
    const combat = await attackInto('Stormtrooper', { attackerDc: 'Fennec Shand', type: 'range', dist: 5, defSq: 'f1' });
    assert.equal(combat.attackInfo.dice.length, 3, 'Sharpshooter must add one die at long range');
    assert.equal(combat.attackInfo.dice.filter((d) => d === 'green').length, 2, 'the added die must be green');
  });

  it('Sharpshooter: no extra die when target is close', async () => {
    const combat = await attackInto('Stormtrooper', { attackerDc: 'Fennec Shand', type: 'melee', dist: 1 });
    assert.equal(combat.attackInfo.dice.length, 2, 'Sharpshooter must NOT fire at short range');
  });

  it('Mystic Hunter (Zuckuss): +1 green die at on_declare (always)', async () => {
    const combat = await attackInto('Stormtrooper', { attackerDc: 'Zuckuss' });
    assert.equal(combat.attackInfo.dice.length, 3, 'Mystic Hunter must add one die on declare');
    assert.equal(combat.attackInfo.dice.filter((d) => d === 'green').length, 2, 'the added die must be green');
  });

  it('Full of Rage (Krrsantan): +1 green die only when 3+ damage suffered', async () => {
    const damaged = await attackInto('Stormtrooper', { attackerDc: 'Krrsantan', attackerSuffered: 3 });
    assert.equal(damaged.attackInfo.dice.length, 3, 'Full of Rage must fire with 3+ damage suffered');

    const healthy = await attackInto('Stormtrooper', { attackerDc: 'Krrsantan' });
    assert.equal(healthy.attackInfo.dice.length, 2, 'Full of Rage must NOT fire at full health');
  });

  it('Fly-By (Jet Trooper Elite): +1 blue die when target within 2', async () => {
    const close = await attackInto('Stormtrooper', { attackerDc: 'Jet Trooper (Elite)', type: 'melee', dist: 1 });
    assert.equal(close.attackInfo.dice.length, 3, 'Fly-By must add a die when target is within 2');
    assert.equal(close.attackInfo.dice.filter((d) => d === 'blue').length, 2, 'the added die must be blue');

    const far = await attackInto('Stormtrooper', { attackerDc: 'Jet Trooper (Elite)', type: 'range', dist: 4, defSq: 'f1' });
    assert.equal(far.attackInfo.dice.length, 2, 'Fly-By must NOT fire when target is 3+ away');
  });
});
