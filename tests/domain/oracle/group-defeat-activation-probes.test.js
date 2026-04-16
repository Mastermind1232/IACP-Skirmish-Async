/**
 * Tier B Legality-Oracle Probes: Multi-Figure Group Defeat Activation Count (CRR Risk #5→#2)
 *
 * Tests the activation count decrement logic when figures in a multi-figure
 * deployment group are defeated. Uses real processFigureDefeat through the
 * handler pipeline.
 *
 * Rule claims:
 *   When ALL figures in a deployment group are defeated, the group's activation
 *   is removed (p{N}ActivationsRemaining decremented).
 *   When only SOME figures are defeated, the activation persists.
 *
 * PROBE-GD-001: Defeat all 3 Stormtrooper (Elite) figures → activation removed
 * PROBE-GD-002: Defeat 1 of 3 figures → activation count unchanged
 * PROBE-GD-003: Defeat 2 of 3 → activation persists; defeat last → activation removed
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createTestGame } from '../../fixtures/game-builder.js';

/** Find a player's DC msgId from dcMessageMeta. */
function findMsgId(dcMessageMeta, gameId, playerNum, dcNamePrefix) {
  for (const [msgId, meta] of dcMessageMeta) {
    if (meta.gameId !== gameId) continue;
    if (meta.playerNum === playerNum && meta.dcName.startsWith(dcNamePrefix)) return msgId;
  }
  return null;
}

/** Find DC index in dcList. */
function findDcIdx(game, playerNum, dcNamePrefix) {
  const dcList = playerNum === 1 ? game.p1DcList : game.p2DcList;
  return dcList.findIndex(dc => (dc.dcName || dc).startsWith(dcNamePrefix));
}

/** Get all figure keys for a multi-figure group from figurePositions. */
function getGroupFigKeys(game, playerNum, dcNamePrefix) {
  const positions = game.figurePositions[playerNum] || {};
  return Object.keys(positions).filter(fk => fk.startsWith(dcNamePrefix + '-'));
}

// ── PROBE-GD-001: Full group wipe → activation removed ─────────────────────

describe('PROBE-GD-001: Defeat all figures in 3-figure group → activation removed', () => {
  it('001: all 3 Stormtrooper (Elite) defeated → P2 activations decremented', async () => {
    const { game, deps, dcMessageMeta } = createTestGame()
      .withPlayer1Army([{ dcName: 'Bossk' }])
      .withPlayer2Army([{ dcName: 'Stormtrooper (Elite)' }])
      .inRound(1)
      .build();

    const msgId = findMsgId(dcMessageMeta, game.gameId, 2, 'Stormtrooper (Elite)');
    const dcIdx = findDcIdx(game, 2, 'Stormtrooper (Elite)');
    const figKeys = getGroupFigKeys(game, 2, 'Stormtrooper (Elite)');

    assert.equal(figKeys.length, 3, 'Stormtrooper (Elite) should have 3 figures');

    const activsBefore = game.p2ActivationsRemaining;
    assert.ok(activsBefore >= 1, `P2 should have at least 1 activation. Got: ${activsBefore}`);

    // Defeat all 3 figures
    for (const figKey of figKeys) {
      await deps.processFigureDefeat(game, {
        defeatedPlayerNum: 2,
        figureKey: figKey,
        attackerPlayerNum: 1,
        msgId,
        dcIdx,
        source: 'Test',
      });
    }

    // Group fully defeated → activation should be removed
    assert.equal(game.p2ActivationsRemaining, activsBefore - 1,
      `Full group wipe: activations should decrement from ${activsBefore} to ${activsBefore - 1}. Got: ${game.p2ActivationsRemaining}`);

    // All figures should be gone from positions
    for (const figKey of figKeys) {
      assert.equal(game.figurePositions[2][figKey], undefined,
        `Figure ${figKey} should be removed from positions`);
    }
  });
});

// ── PROBE-GD-002: Partial defeat → activation persists ──────────────────────

describe('PROBE-GD-002: Defeat 1 of 3 figures → activation count unchanged', () => {
  it('002: 1 Stormtrooper (Elite) defeated, 2 remain → P2 activations unchanged', async () => {
    const { game, deps, dcMessageMeta } = createTestGame()
      .withPlayer1Army([{ dcName: 'Bossk' }])
      .withPlayer2Army([{ dcName: 'Stormtrooper (Elite)' }])
      .inRound(1)
      .build();

    const msgId = findMsgId(dcMessageMeta, game.gameId, 2, 'Stormtrooper (Elite)');
    const dcIdx = findDcIdx(game, 2, 'Stormtrooper (Elite)');
    const figKeys = getGroupFigKeys(game, 2, 'Stormtrooper (Elite)');

    const activsBefore = game.p2ActivationsRemaining;

    // Defeat only the first figure
    await deps.processFigureDefeat(game, {
      defeatedPlayerNum: 2,
      figureKey: figKeys[0],
      attackerPlayerNum: 1,
      msgId,
      dcIdx,
      source: 'Test',
    });

    // Group NOT fully defeated → activation should persist
    assert.equal(game.p2ActivationsRemaining, activsBefore,
      `Partial defeat: activations should stay at ${activsBefore}. Got: ${game.p2ActivationsRemaining}`);

    // First figure removed, others remain
    assert.equal(game.figurePositions[2][figKeys[0]], undefined, 'Defeated figure removed');
    assert.ok(game.figurePositions[2][figKeys[1]], 'Second figure still alive');
    assert.ok(game.figurePositions[2][figKeys[2]], 'Third figure still alive');
  });
});

// ── PROBE-GD-003: Progressive defeat → activation removed only on last figure ─

describe('PROBE-GD-003: Progressive defeat — activation removed only on last figure', () => {
  it('003: defeat 2 → persists; defeat 3rd → removed', async () => {
    const { game, deps, dcMessageMeta } = createTestGame()
      .withPlayer1Army([{ dcName: 'Bossk' }])
      .withPlayer2Army([{ dcName: 'Stormtrooper (Elite)' }])
      .inRound(1)
      .build();

    const msgId = findMsgId(dcMessageMeta, game.gameId, 2, 'Stormtrooper (Elite)');
    const dcIdx = findDcIdx(game, 2, 'Stormtrooper (Elite)');
    const figKeys = getGroupFigKeys(game, 2, 'Stormtrooper (Elite)');
    const activsBefore = game.p2ActivationsRemaining;

    // Defeat first figure
    await deps.processFigureDefeat(game, {
      defeatedPlayerNum: 2, figureKey: figKeys[0],
      attackerPlayerNum: 1, msgId, dcIdx, source: 'Test',
    });
    assert.equal(game.p2ActivationsRemaining, activsBefore,
      'After 1st defeat: activation persists');

    // Defeat second figure
    await deps.processFigureDefeat(game, {
      defeatedPlayerNum: 2, figureKey: figKeys[1],
      attackerPlayerNum: 1, msgId, dcIdx, source: 'Test',
    });
    assert.equal(game.p2ActivationsRemaining, activsBefore,
      'After 2nd defeat: activation still persists (1 figure remains)');

    // Defeat third (last) figure
    await deps.processFigureDefeat(game, {
      defeatedPlayerNum: 2, figureKey: figKeys[2],
      attackerPlayerNum: 1, msgId, dcIdx, source: 'Test',
    });
    assert.equal(game.p2ActivationsRemaining, activsBefore - 1,
      `After 3rd defeat: activation removed. Expected ${activsBefore - 1}, got ${game.p2ActivationsRemaining}`);
  });
});
