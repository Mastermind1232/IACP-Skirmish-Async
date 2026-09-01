/**
 * Oracle tests for Emperor Palpatine — Tempt.
 *
 * Rule: At the start of your activation, a figure of your choice suffers
 *       1 Damage and gains 1 Damage Token (Damage power token).
 *
 * Confirmed-safe core:
 *   - Tempt applies 1 HP damage via dcHealthState (not just power token grant)
 *   - Tempt grants 1 Damage power token to the target
 *   - Tempt can target both friendly and hostile figures
 *   - When dcHealthState is available, HP is reduced programmatically (no manual button dependency)
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { resolveAbility } from '../../../src/game/abilities.js';

// ── Helper: build minimal game state for Tempt resolution ─────────────────────
// NOTE: These tests exercise the choice-resolution branch directly (choiceIndex +
// targetFigureKey provided), bypassing the enumeration step which requires real
// map data for countGameSpaces. The enumeration path is tested implicitly via
// integration tests and the headless self-play flow.
function buildTemptGame({ activatingPlayerNum = 1, targetPlayerNum = 2 } = {}) {
  const dcMessageMeta = new Map();
  const dcHealthState = new Map();

  const palpatineMsgId = 'msg_palpatine';
  dcMessageMeta.set(palpatineMsgId, {
    gameId: 'testgame', playerNum: activatingPlayerNum, dcName: 'Emperor Palpatine',
    displayName: 'Emperor Palpatine [DG 1]',
  });
  dcHealthState.set(palpatineMsgId, [[13, 13]]);

  const targetMsgId = 'msg_target';
  dcMessageMeta.set(targetMsgId, {
    gameId: 'testgame', playerNum: targetPlayerNum, dcName: 'Luke Skywalker',
    displayName: 'Luke Skywalker [DG 1]',
  });
  dcHealthState.set(targetMsgId, [[12, 12]]);

  const game = {
    gameId: 'testgame',
    figurePositions: {
      [activatingPlayerNum]: { 'Emperor Palpatine-1-0': 'D4' },
      [targetPlayerNum]: { 'Luke Skywalker-1-0': 'D6' },
    },
    dcActionsData: { [palpatineMsgId]: { selectedFigure: 0 } },
    p1DcList: activatingPlayerNum === 1
      ? [{ dcName: 'Emperor Palpatine', healthState: [13, 13] }]
      : [{ dcName: 'Luke Skywalker', healthState: [12, 12] }],
    p2DcList: activatingPlayerNum === 2
      ? [{ dcName: 'Emperor Palpatine', healthState: [13, 13] }]
      : [{ dcName: 'Luke Skywalker', healthState: [12, 12] }],
    p1DcMessageIds: activatingPlayerNum === 1 ? [palpatineMsgId] : [targetMsgId],
    p2DcMessageIds: activatingPlayerNum === 2 ? [palpatineMsgId] : [targetMsgId],
  };

  return { game, dcMessageMeta, dcHealthState, palpatineMsgId, targetMsgId, activatingPlayerNum, targetPlayerNum };
}

// ── ORACLE-TEMPT-001: Tempt applies 1 HP damage via dcHealthState ─────────────
describe('ORACLE-TEMPT-001: Tempt applies 1 HP damage programmatically', () => {
  it('001: hostile target HP is reduced by 1 when Tempt resolves', () => {
    const { game, dcMessageMeta, dcHealthState, palpatineMsgId, targetMsgId, activatingPlayerNum } = buildTemptGame();

    const result = resolveAbility('tempt', {
      game, playerNum: activatingPlayerNum,
      meta: dcMessageMeta.get(palpatineMsgId),
      msgId: palpatineMsgId,
      dcMessageMeta, dcHealthState,
      choiceIndex: 0,
      targetFigureKey: 'Luke Skywalker-1-0',
    });

    assert.equal(result.applied, true, 'Tempt should resolve successfully');

    // HP must be reduced by 1
    const targetHp = dcHealthState.get(targetMsgId);
    assert.deepStrictEqual(targetHp, [[11, 12]], 'Target HP should be 12 → 11');

    // Log must NOT contain "manually"
    assert.ok(
      !result.logMessage.includes('manually'),
      'Log should not mention manual HP buttons'
    );

    // Log should contain HP transition
    assert.ok(
      result.logMessage.includes('12 → 11'),
      'Log should show HP transition'
    );
  });
});

// ── ORACLE-TEMPT-002: Tempt also grants 1 Damage power token ─────────────────
describe('ORACLE-TEMPT-002: Tempt grants 1 Damage power token', () => {
  it('002: target receives 1 Damage power token', () => {
    const { game, dcMessageMeta, dcHealthState, palpatineMsgId, activatingPlayerNum } = buildTemptGame();

    resolveAbility('tempt', {
      game, playerNum: activatingPlayerNum,
      meta: dcMessageMeta.get(palpatineMsgId),
      msgId: palpatineMsgId,
      dcMessageMeta, dcHealthState,
      choiceIndex: 0,
      targetFigureKey: 'Luke Skywalker-1-0',
    });

    const tokens = game.figurePowerTokens?.['Luke Skywalker-1-0'];
    assert.ok(tokens, 'Target should have power tokens');
    const damageTokens = tokens.filter(t => t === 'Damage');
    assert.equal(damageTokens.length, 1, 'Target should have exactly 1 Damage token');
  });
});

// ── ORACLE-TEMPT-003: Tempt HP reduction works on friendly target ─────────────
describe('ORACLE-TEMPT-003: Tempt HP reduction works on friendly target', () => {
  it('003: friendly figure HP is reduced by 1', () => {
    const { game, dcMessageMeta, dcHealthState, palpatineMsgId, activatingPlayerNum } = buildTemptGame();

    // Add a friendly figure
    game.figurePositions[activatingPlayerNum]['Stormtrooper (Elite)-1-0'] = 'D5';
    const stormMsgId = 'msg_storm';
    dcMessageMeta.set(stormMsgId, {
      gameId: 'testgame', playerNum: activatingPlayerNum, dcName: 'Stormtrooper (Elite)',
      displayName: 'Stormtrooper (Elite) [DG 1]',
    });
    dcHealthState.set(stormMsgId, [[5, 5]]);
    if (activatingPlayerNum === 1) {
      game.p1DcList.push({ dcName: 'Stormtrooper (Elite)', healthState: [5, 5] });
      game.p1DcMessageIds.push(stormMsgId);
    } else {
      game.p2DcList.push({ dcName: 'Stormtrooper (Elite)', healthState: [5, 5] });
      game.p2DcMessageIds.push(stormMsgId);
    }

    const result = resolveAbility('tempt', {
      game, playerNum: activatingPlayerNum,
      meta: dcMessageMeta.get(palpatineMsgId),
      msgId: palpatineMsgId,
      dcMessageMeta, dcHealthState,
      choiceIndex: 0,
      targetFigureKey: 'Stormtrooper (Elite)-1-0',
    });

    assert.equal(result.applied, true);
    const stormHp = dcHealthState.get(stormMsgId);
    assert.deepStrictEqual(stormHp, [[4, 5]], 'Friendly Stormtrooper HP should be 5 → 4');
  });
});

// ── ORACLE-TEMPT-004: Tempt HP floors at 0 ───────────────────────────────────
describe('ORACLE-TEMPT-004: Tempt HP floors at 0', () => {
  it('004: target at 1 HP goes to 0, not negative', () => {
    const { game, dcMessageMeta, dcHealthState, palpatineMsgId, targetMsgId, activatingPlayerNum } = buildTemptGame();

    // Set target to 1 HP
    dcHealthState.set(targetMsgId, [[1, 12]]);

    const result = resolveAbility('tempt', {
      game, playerNum: activatingPlayerNum,
      meta: dcMessageMeta.get(palpatineMsgId),
      msgId: palpatineMsgId,
      dcMessageMeta, dcHealthState,
      choiceIndex: 0,
      targetFigureKey: 'Luke Skywalker-1-0',
    });

    assert.equal(result.applied, true);
    const targetHp = dcHealthState.get(targetMsgId);
    assert.deepStrictEqual(targetHp, [[0, 12]], 'HP should floor at 0');
  });
});

// ── ORACLE-TEMPT-005: Tempt defeats figure at 1 HP (canonical path) ─────────
describe('ORACLE-TEMPT-005: Tempt defeats figure and removes from board', () => {
  it('005a: figure at 1 HP is defeated — defeatedFigures returned for processFigureDefeat', () => {
    const { game, dcMessageMeta, dcHealthState, palpatineMsgId, targetMsgId, activatingPlayerNum, targetPlayerNum } = buildTemptGame();

    dcHealthState.set(targetMsgId, [[1, 12]]);

    const result = resolveAbility('tempt', {
      game, playerNum: activatingPlayerNum,
      meta: dcMessageMeta.get(palpatineMsgId),
      msgId: palpatineMsgId,
      dcMessageMeta, dcHealthState,
      choiceIndex: 0,
      targetFigureKey: 'Luke Skywalker-1-0',
    });

    assert.equal(result.applied, true);
    assert.equal(result.refreshBoard, true, 'Board should refresh after defeat');
    // Defeat is now routed through processFigureDefeat — result signals defeat via defeatedFigures
    assert.ok(result.defeatedFigures, 'Result should include defeatedFigures array');
    assert.equal(result.defeatedFigures.length, 1);
    assert.equal(result.defeatedFigures[0].figureKey, 'Luke Skywalker-1-0');
    assert.equal(result.defeatedFigures[0].defeatedPlayerNum, targetPlayerNum);
    assert.equal(result.defeatedFigures[0].attackerPlayerNum, activatingPlayerNum);
    // Figure is NOT yet removed — that's processFigureDefeat's job
    assert.ok(
      game.figurePositions[targetPlayerNum]['Luke Skywalker-1-0'],
      'Figure should still be in figurePositions (processFigureDefeat handles removal)'
    );
  });

  it('005b: defeated figure does not receive Damage token', () => {
    const { game, dcMessageMeta, dcHealthState, palpatineMsgId, activatingPlayerNum } = buildTemptGame();

    dcHealthState.set('msg_target', [[1, 12]]);

    resolveAbility('tempt', {
      game, playerNum: activatingPlayerNum,
      meta: dcMessageMeta.get(palpatineMsgId),
      msgId: palpatineMsgId,
      dcMessageMeta, dcHealthState,
      choiceIndex: 0,
      targetFigureKey: 'Luke Skywalker-1-0',
    });

    const tokens = game.figurePowerTokens?.['Luke Skywalker-1-0'] || [];
    assert.equal(tokens.length, 0, 'Defeated figure should not receive power tokens');
  });
});
