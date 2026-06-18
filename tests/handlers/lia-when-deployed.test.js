import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { fireLieInAmbushWhenDeployed } from '../../src/handlers/activation.js';

// fireLieInAmbushWhenDeployed fires ONLY the "when deployed" subset of a
// group's abilities for a group deployed mid-round via Lie in Ambush. It must
// fire In The Shadows (→ Hidden) but must NOT fire any "after deployment"
// ability (Ambush, Cross Training, Smooth Landing, etc.).

function makeGame(playerNum, dcName, figureKey, pos) {
  return {
    gameId: 'lia-test',
    figurePositions: { 1: {}, 2: {}, [playerNum]: { [figureKey]: pos } },
    figureConditions: {},
  };
}

// Stub ctx — no Discord, no save side effects we care about. logGameAction is a
// no-op; saveGames is a no-op spy.
function makeCtx() {
  return {
    logGameAction: async () => {},
    saveGames: () => {},
  };
}

describe('fireLieInAmbushWhenDeployed', () => {
  it('makes a LiA-deployed ISB Infiltrator (Elite) become Hidden (In The Shadows)', async () => {
    const dcName = 'ISB Infiltrator (Elite)';
    const fk = `${dcName}-1-0`;
    const game = makeGame(1, dcName, fk, 'a1');
    const ctx = makeCtx();

    await fireLieInAmbushWhenDeployed(game, 1, dcName, [fk], ctx, /* client */ null);

    assert.ok(
      (game.figureConditions[fk] || []).includes('Hide'),
      'In The Shadows: LiA-deployed ISB Infiltrator should become Hidden',
    );
  });

  it('does NOT apply an after-deployment-only effect (e.g. Ambush → Hidden) for a non-when-deployed group', async () => {
    // Ewok Warrior (Elite) has the "Ambush" passive — it becomes Hidden AFTER
    // deployment, which is NOT a when-deployed ability. The LiA method must NOT
    // fire it (only the normal round-1 post-deploy phase does).
    const dcName = 'Ewok Warrior (Elite)';
    const fk = `${dcName}-1-0`;
    const game = makeGame(2, dcName, fk, 'b2');
    const ctx = makeCtx();

    await fireLieInAmbushWhenDeployed(game, 2, dcName, [fk], ctx, /* client */ null);

    assert.ok(
      !(game.figureConditions[fk] || []).includes('Hide'),
      'After-deployment Ambush must NOT fire for a LiA-deployed group',
    );
  });

  it('does nothing for figures that were not actually placed on the board', async () => {
    const dcName = 'ISB Infiltrator (Elite)';
    const fk = `${dcName}-1-0`;
    // Figure key passed in but NOT present in figurePositions → no-op.
    const game = { gameId: 'lia-test', figurePositions: { 1: {}, 2: {} }, figureConditions: {} };
    const ctx = makeCtx();

    await fireLieInAmbushWhenDeployed(game, 1, dcName, [fk], ctx, null);

    assert.ok(
      !(game.figureConditions[fk] || []).includes('Hide'),
      'Unplaced figure should not receive any when-deployed effect',
    );
  });
});
