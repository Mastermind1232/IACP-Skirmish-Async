/**
 * Tier A Legality-Oracle Probes: Surge Spending Legality (CRR Risk #1)
 *
 * Tests the pure-function and handler-level surge pipeline to verify:
 *   1) getAttackerSurgeAbilities returns correct abilities from DC data
 *   2) blockSurgeAbilities flag (Tusken Cycler) suppresses all surge abilities
 *   3) Double-surge abilities carry "double:" prefix and parse correctly
 *   4) Accumulated surge effects produce correct combat damage through the handler pipeline
 *
 * PROBE-SURGE-001: getAttackerSurgeAbilities returns correct DC surge chart (Bossk)
 * PROBE-SURGE-002: blockSurgeAbilities → empty surge list (negative gate)
 * PROBE-SURGE-003: Double-surge prefix detection + correct parsing (Hera Syndulla)
 * PROBE-SURGE-004: Legal surge accumulation → correct damage through handler pipeline
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { getAttackerSurgeAbilities, parseSurgeEffect, computeCombatResult } from '../../../src/game/combat.js';
import { createTestGame } from '../../fixtures/game-builder.js';

// ── PROBE-SURGE-001: getAttackerSurgeAbilities returns correct DC surge chart ─

describe('PROBE-SURGE-001: getAttackerSurgeAbilities returns correct DC surge chart', () => {
  it('001: Bossk → ["damage 2", "pierce 2"]', () => {
    // Bossk has surgeAbilities: ["damage 2", "pierce 2"], no doubles, no bonus
    const combat = { attackerDcName: 'Bossk' };
    const abilities = getAttackerSurgeAbilities(combat);

    assert.deepStrictEqual(abilities, ['damage 2', 'pierce 2'],
      `Bossk surge chart should be ["damage 2", "pierce 2"]. Got: ${JSON.stringify(abilities)}`);
  });
});

// ── PROBE-SURGE-002: blockSurgeAbilities suppresses all surge abilities ──────

describe('PROBE-SURGE-002: blockSurgeAbilities suppresses all surge abilities', () => {
  it('002: Bossk + blockSurgeAbilities → empty list', () => {
    // Tusken Cycler sets blockSurgeAbilities = true; no abilities should be returned
    const combat = { attackerDcName: 'Bossk', blockSurgeAbilities: true };
    const abilities = getAttackerSurgeAbilities(combat);

    assert.deepStrictEqual(abilities, [],
      `blockSurgeAbilities should suppress all surge abilities. Got: ${JSON.stringify(abilities)}`);
  });
});

// ── PROBE-SURGE-003: Double-surge prefix detection and parsing ──────────────

describe('PROBE-SURGE-003: Double-surge prefix detection and correct parsing', () => {
  it('003a: Hera Syndulla surge chart includes double: prefix', () => {
    // Hera has surgeAbilities: ["damage 1"], doubleSurgeAbilities: ["pierce 2"]
    const combat = { attackerDcName: 'Hera Syndulla' };
    const abilities = getAttackerSurgeAbilities(combat);

    assert.ok(abilities.includes('damage 1'),
      `Hera should have standard "damage 1". Got: ${JSON.stringify(abilities)}`);
    assert.ok(abilities.includes('double:pierce 2'),
      `Hera double surge should be prefixed "double:pierce 2". Got: ${JSON.stringify(abilities)}`);
  });

  it('003b: parseSurgeEffect strips double: prefix and parses correctly', () => {
    // "double:pierce 2" should parse as pierce 2 (cost is handled by caller, not parser)
    const effect = parseSurgeEffect('double:pierce 2');
    assert.equal(effect.pierce, 2, 'double:pierce 2 should parse as pierce=2');
    assert.equal(effect.damage, 0, 'no damage from pierce surge');
    assert.deepStrictEqual(effect.conditions, [], 'no conditions from pierce surge');
  });

  it('003c: Thrawn double surge +3 hits parses as damage 3', () => {
    // Thrawn has doubleSurgeAbilities: ["+3 hits"]
    const combat = { attackerDcName: 'Thrawn' };
    const abilities = getAttackerSurgeAbilities(combat);

    const doubleSurge = abilities.find(a => a.startsWith('double:'));
    assert.ok(doubleSurge, `Thrawn should have a double-surge ability. Got: ${JSON.stringify(abilities)}`);

    const effect = parseSurgeEffect(doubleSurge);
    assert.equal(effect.damage, 3, 'double:+3 hits should parse as damage=3');
  });
});

// ── PROBE-SURGE-004: Legal surge accumulation → correct combat damage ────────

describe('PROBE-SURGE-004: Legal surge accumulation produces correct combat damage through pipeline', () => {
  it('004a: Bossk spending both surges (damage 2 + pierce 2) → correct final damage', async () => {
    // Simulate: Bossk rolls 3 dmg, 1 surge; defender rolls 3 block.
    // Bossk spends surge on "damage 2" → surgeDamage = 2
    // Remaining surge = 0, can't also spend "pierce 2"
    // Final: (3 + 2) dmg - 3 block = 2 damage
    const { game, deps, dcMessageMeta, dcHealthState } = createTestGame()
      .withPlayer1Army([{ dcName: 'Bossk' }])
      .withPlayer2Army([{ dcName: 'Greedo' }])
      .inRound(1)
      .build();

    // Find defender info for HP check
    let defenderMsgId;
    for (const [msgId, meta] of dcMessageMeta) {
      if (meta.gameId === game.gameId && meta.playerNum === 2) {
        defenderMsgId = msgId;
        break;
      }
    }
    const initialHp = dcHealthState.get(defenderMsgId)?.[0]?.[0];

    // Build combat with pre-accumulated surge effects (handler pattern)
    const attackerPN = 1;
    const defenderPN = 2;
    let attackerMsgId, attackerMeta, defenderMeta;
    for (const [msgId, meta] of dcMessageMeta) {
      if (meta.gameId !== game.gameId) continue;
      if (meta.playerNum === attackerPN && !attackerMsgId) { attackerMsgId = msgId; attackerMeta = meta; }
      if (meta.playerNum === defenderPN && !defenderMeta) { defenderMeta = meta; }
    }
    const attackerFigKey = Object.keys(game.figurePositions[1])[0];
    const defenderFigKey = Object.keys(game.figurePositions[2])[0];

    const combat = {
      gameId: game.gameId,
      attackerPlayerNum: 1, defenderPlayerNum: 2,
      attackerMsgId,
      attackerDcName: 'Bossk', defenderDcName: 'Greedo',
      attackerDisplayName: 'Bossk',
      attackerFigureIndex: 0,
      attackerFigureKey: attackerFigKey,
      attackerConds: [], defenderConds: [],
      target: { msgId: defenderMsgId, figureKey: defenderFigKey, label: 'Greedo' },
      targetStats: { defense: ['white'], cost: 4, figures: 1 },
      attackInfo: { dice: ['red', 'red', 'green'], type: 'range' },
      isRanged: true, distanceToTarget: 1,
      combatThreadId: 'oracle-thread', combatDeclareMsgId: 'oracle-declare',
      combatPreMsgId: 'oracle-pre',
      attackRoll: { acc: 4, dmg: 3, surge: 1 },
      defenseRoll: { block: 3, evade: 0, dodge: false },
      // Legal surge spend: Bossk spent 1 surge on "damage 2"
      surgeDamage: 2,
      surgePierce: 0,
      surgeConditions: [],
      bonusConditions: [],
      surgeAccuracy: 0,
      bonusSurgeAbilities: [],
      bonusHits: 0, bonusPierce: 0, bonusAccuracy: 0,
      bonusBlock: 0, bonusEvade: 0,
      p1Ready: true, p2Ready: true,
      attackTargetMsgId: 'oracle-target',
    };

    await deps.resolveCombatAfterRolls(game, combat, deps.client);

    // (3 dmg + 2 surge dmg) - 3 block = 2 damage
    const finalHp = dcHealthState.get(defenderMsgId)?.[0]?.[0];
    assert.equal(initialHp - finalHp, 2,
      `Expected 2 damage (3+2 dmg - 3 block). HP: ${initialHp} → ${finalHp}`);
  });

  it('004b: Bossk spending pierce surge → pierce reduces effective block', async () => {
    const { game, deps, dcMessageMeta, dcHealthState } = createTestGame()
      .withPlayer1Army([{ dcName: 'Bossk' }])
      .withPlayer2Army([{ dcName: 'Greedo' }])
      .inRound(1)
      .build();

    let defenderMsgId, defenderMeta, attackerMsgId, attackerMeta;
    for (const [msgId, meta] of dcMessageMeta) {
      if (meta.gameId !== game.gameId) continue;
      if (meta.playerNum === 1 && !attackerMsgId) { attackerMsgId = msgId; attackerMeta = meta; }
      if (meta.playerNum === 2 && !defenderMsgId) { defenderMsgId = msgId; defenderMeta = meta; }
    }
    const initialHp = dcHealthState.get(defenderMsgId)?.[0]?.[0];
    const attackerFigKey = Object.keys(game.figurePositions[1])[0];
    const defenderFigKey = Object.keys(game.figurePositions[2])[0];

    const combat = {
      gameId: game.gameId,
      attackerPlayerNum: 1, defenderPlayerNum: 2,
      attackerMsgId,
      attackerDcName: 'Bossk', defenderDcName: 'Greedo',
      attackerDisplayName: 'Bossk',
      attackerFigureIndex: 0,
      attackerFigureKey: attackerFigKey,
      attackerConds: [], defenderConds: [],
      target: { msgId: defenderMsgId, figureKey: defenderFigKey, label: 'Greedo' },
      targetStats: { defense: ['white'], cost: 4, figures: 1 },
      attackInfo: { dice: ['red', 'red', 'green'], type: 'range' },
      isRanged: true, distanceToTarget: 1,
      combatThreadId: 'oracle-thread', combatDeclareMsgId: 'oracle-declare',
      combatPreMsgId: 'oracle-pre',
      // Roll: 4 dmg, defender 3 block. Without pierce: 4-3=1 damage
      attackRoll: { acc: 4, dmg: 4, surge: 1 },
      defenseRoll: { block: 3, evade: 0, dodge: false },
      // Legal surge spend: Bossk spent 1 surge on "pierce 2"
      surgeDamage: 0,
      surgePierce: 2,
      surgeConditions: [],
      bonusConditions: [],
      surgeAccuracy: 0,
      bonusSurgeAbilities: [],
      bonusHits: 0, bonusPierce: 0, bonusAccuracy: 0,
      bonusBlock: 0, bonusEvade: 0,
      p1Ready: true, p2Ready: true,
      attackTargetMsgId: 'oracle-target',
    };

    await deps.resolveCombatAfterRolls(game, combat, deps.client);

    // 4 dmg - max(0, 3 block - 2 pierce) = 4 - 1 = 3 damage
    const finalHp = dcHealthState.get(defenderMsgId)?.[0]?.[0];
    assert.equal(initialHp - finalHp, 3,
      `Expected 3 damage (4 dmg - (3 block - 2 pierce)). HP: ${initialHp} → ${finalHp}`);
  });
});
