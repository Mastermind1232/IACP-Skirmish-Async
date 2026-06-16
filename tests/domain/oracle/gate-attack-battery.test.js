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
import { runAttackSequence, handleModsPick, handleCombatSurge } from '../../../src/handlers/combat.js';
import { handleThereIsNoTry } from '../../../src/handlers/combat-reactions.js';
import { activeSide } from '../../../src/engine/combat-ability-gate.js';
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

// False Orders / Lure of the Dark Side: P1 (controller) forces a P2 figure
// (controlled) to attack a P1 figure. falseOrdersControllerPlayerNum drives the
// attacker-side hand + attack roll; noFriendliesActive suppresses friendly gates.
describe('GATE-BATTERY: False Orders / Lure walks the gate', () => {
  it('controller-driven Lure attack reaches after_resolve', async () => {
    const built = createTestGame()
      .withMap('mos-eisley-outskirts')
      .withPlayer1Army([{ dcName: 'Rebel Trooper' }])
      .withPlayer2Army([{ dcName: 'Stormtrooper' }])
      .inRound(1)
      .build();
    const { game, deps, dcMessageMeta } = built;
    game.combatSequenceMode = true;
    game.selfPlay = true;

    const controlled = firstFigKey(game, 2); // P2 figure, controlled by P1
    const defFk = firstFigKey(game, 1); // attacked P1 figure
    game.figurePositions[2] = { [controlled]: 'b1' };
    game.figurePositions[1] = { [defFk]: 'c1' };
    const C = metaFor(dcMessageMeta, game.gameId, 2);
    const D = metaFor(dcMessageMeta, game.gameId, 1);
    const thread = createFakeChannel('lure-thread');

    const combat = {
      gameId: game.gameId,
      combatThreadId: 'lure-thread',
      attackerPlayerNum: 2,
      defenderPlayerNum: 1,
      falseOrdersControllerPlayerNum: 1,
      isLure: true,
      noFriendliesActive: true,
      lurePostAttackStrain: 0,
      attackerMsgId: C.msgId,
      attackerDcName: C.meta.dcName,
      attackerDisplayName: C.meta.dcName,
      attackerFigureIndex: 0,
      attackerFigureKey: controlled,
      attackerConds: [],
      defenderConds: [],
      target: { msgId: D.msgId, figureKey: defFk, label: D.meta.dcName },
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
    const r = await driveGateAttackToEnd(game, combat, deps, thread);
    assert.equal(r.threw, null, `Lure threw: ${r.threw && (r.threw.stack || r.threw.message)}`);
    assert.equal(r.finalStep, 'after_resolve', `Lure ended at "${r.finalStep}"`);
  });
});

// There Is No Try is a roll-time interrupt: it pauses the gate's roll step to
// let a REBEL FORCE USER defender set a defense die face. The resume must
// advance the gate (not the legacy reroll UI). Regression for the cutover.
describe('GATE-BATTERY: There Is No Try resumes the gate after the roll pause', () => {
  it('TINT pauses at roll, then resolving it walks the gate to after_resolve', async () => {
    const built = createTestGame()
      .withMap('mos-eisley-outskirts')
      .withPlayer1Army([{ dcName: 'Stormtrooper' }])
      .withPlayer2Army([{ dcName: 'Luke Skywalker' }])
      .inRound(1)
      .build();
    const { game, dcMessageMeta } = built;
    // Stub getDcStats so TINT's REBEL + FORCE USER keyword gate fires for Luke.
    const deps = { ...built.deps };
    const realStats = deps.getDcStats;
    deps.getDcStats = (n) => {
      const s = realStats ? realStats(n) : {};
      if (/luke/i.test(n || '')) return { ...(s || {}), keywords: ['REBEL', 'FORCE USER'] };
      return s;
    };
    game.combatSequenceMode = true;
    game.selfPlay = true;
    game.thereIsNoTryPlayerNum = 2; // defender has TINT pending

    const a = firstFigKey(game, 1);
    const d = firstFigKey(game, 2);
    game.figurePositions[1] = { [a]: 'b1' };
    game.figurePositions[2] = { [d]: 'c1' };
    const A = metaFor(dcMessageMeta, game.gameId, 1);
    const D = metaFor(dcMessageMeta, game.gameId, 2);
    const thread = createFakeChannel('tint-thread');
    const mk = (cid, uid) => ({
      customId: cid, client: deps.client, user: { id: uid },
      deferUpdate: async () => {}, update: async () => {}, followUp: async () => {},
      message: { components: [], edit: async () => ({}), delete: async () => ({}) },
    });

    const combat = {
      gameId: game.gameId, combatThreadId: 'tint-thread',
      attackerPlayerNum: 1, defenderPlayerNum: 2,
      attackerMsgId: A.msgId, attackerDcName: A.meta.dcName, attackerDisplayName: A.meta.dcName,
      attackerFigureIndex: 0, attackerFigureKey: a, attackerConds: [], defenderConds: [],
      target: { msgId: D.msgId, figureKey: d, label: D.meta.dcName },
      targetSquare: 'c1', targetStats: { defense: ['white'], cost: 5, figures: 1 },
      attackInfo: { dice: ['blue', 'green'], type: 'melee' }, isRanged: false, distanceToTarget: 1,
      bonusSurgeAbilities: [], bonusHits: 0, bonusPierce: 0, bonusAccuracy: 0, bonusBlock: 0, bonusEvade: 0,
      surgeConditions: [], bonusConditions: [], surgeDamage: 0, surgePierce: 0, surgeAccuracy: 0,
    };
    game.pendingCombat = combat;

    await runAttackSequence(thread, game, combat, deps);
    assert.equal(combat._seqStep, 'roll', 'gate must pause at the roll step for TINT');
    assert.ok(game.pendingThereIsNoTry, 'TINT picker must be pending');

    // Defender clicks Skip on the TINT picker.
    await handleThereIsNoTry(mk(`there_is_no_try_skip_${game.gameId}`, game.player2Id), deps);
    assert.notEqual(combat._seqStep, 'roll', 'resolving TINT must advance the gate past roll');

    // Finish driving the rest of the gate.
    const GATES = [
      ['onDeclareGate', 'combat_ondeclare_pick_'], ['rerollsGate', 'combat_rerolls_pick_'],
      ['specialGate', 'combat_special_pick_'], ['modsGate', 'combat_mods_pick_'],
      ['zilloGate', 'combat_zillo_pick_'], ['afterResolveGate', 'combat_afterresolve_pick_'],
    ];
    let guard = 0;
    while (guard++ < 100) {
      let g = null;
      for (const [f, p] of GATES) { if (combat[f] && activeSide(combat[f])) { g = { f, p }; break; } }
      if (g) { await handleModsPick(mk(`${g.p}${game.gameId}_done`, ''), deps); continue; }
      if (combat._seqActive && combat._seqStep === 'spend_surges') {
        await handleCombatSurge(mk(`combat_surge_${game.gameId}_done`, game.player1Id), deps);
        if (combat._seqStep === 'spend_surges') break;
        continue;
      }
      break;
    }
    assert.equal(combat._seqStep, 'after_resolve', `TINT gate attack ended at "${combat._seqStep}"`);
  });
});
