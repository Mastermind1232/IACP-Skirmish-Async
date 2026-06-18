import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { fireLieInAmbushWhenDeployed } from '../../src/handlers/activation.js';

// fireLieInAmbushWhenDeployed fires ONLY the "when deployed" subset of a group's
// abilities for a group deployed mid-round via Lie in Ambush. The distinction is
// the card TEXT, not the CSV timing tag: "after/when YOU are deployed" (per-figure
// — In The Shadows, Ewok Ambush, Clawdite Shape, Imperial Loadout) DOES fire on
// LiA; phase-level "after deployment" (E-Web Forward Emplacement, Smooth Landing,
// Beskar Armor, …) does NOT.

function makeGame(playerNum, dcName, figureKey, pos) {
  return {
    gameId: 'lia-test',
    figurePositions: { 1: {}, 2: {}, [playerNum]: { [figureKey]: pos } },
    figureConditions: {},
  };
}

// Stub ctx — no Discord. logGameAction / saveGames are no-ops.
function makeCtx() {
  return {
    logGameAction: async () => {},
    saveGames: () => {},
  };
}

describe('fireLieInAmbushWhenDeployed', () => {
  it('makes a LiA-deployed ISB Infiltrator (Elite) become Hidden (In The Shadows — "when you are deployed")', async () => {
    const dcName = 'ISB Infiltrator (Elite)';
    const fk = `${dcName}-1-0`;
    const game = makeGame(1, dcName, fk, 'a1');
    await fireLieInAmbushWhenDeployed(game, 1, dcName, [fk], makeCtx(), null);
    assert.ok(
      (game.figureConditions[fk] || []).includes('Hide'),
      'In The Shadows: LiA-deployed ISB Infiltrator should become Hidden',
    );
  });

  it('makes a LiA-deployed Ewok Warrior (Elite) become Hidden (Ambush — "after YOU are deployed")', async () => {
    // Ambush text is "After YOU are deployed, you become Hidden" — a per-figure
    // when-deployed trigger, so it MUST fire on LiA (alexanbv 2026-06-18),
    // despite the CSV tagging it after_deployment.
    const dcName = 'Ewok Warrior (Elite)';
    const fk = `${dcName}-1-0`;
    const game = makeGame(2, dcName, fk, 'b2');
    await fireLieInAmbushWhenDeployed(game, 2, dcName, [fk], makeCtx(), null);
    assert.ok(
      (game.figureConditions[fk] || []).includes('Hide'),
      'Ambush ("after you are deployed") should fire on a LiA-deployed Ewok Warrior',
    );
  });

  it('does NOT fire a phase-level "after deployment" ability (E-Web Forward Emplacement)', async () => {
    // "Forward Emplacement: After deployment, you gain MP equal to your speed" is
    // phase-level ("after deployment", not "after YOU are deployed"), so LiA must
    // NOT fire it — no MP banked, no condition applied.
    const dcName = 'E-Web Engineer (Elite)';
    const fk = `${dcName}-1-0`;
    const game = makeGame(1, dcName, fk, 'a1');
    await fireLieInAmbushWhenDeployed(game, 1, dcName, [fk], makeCtx(), null);
    assert.ok(
      !game.movementBank || Object.keys(game.movementBank).length === 0,
      'Forward Emplacement (phase-level) must NOT grant MP on a LiA deploy',
    );
    assert.ok(!(game.figureConditions[fk] || []).includes('Hide'), 'no Hidden either');
  });

  it('does nothing for figures that were not actually placed on the board', async () => {
    const dcName = 'ISB Infiltrator (Elite)';
    const fk = `${dcName}-1-0`;
    const game = { gameId: 'lia-test', figurePositions: { 1: {}, 2: {} }, figureConditions: {} };
    await fireLieInAmbushWhenDeployed(game, 1, dcName, [fk], makeCtx(), null);
    assert.ok(
      !(game.figureConditions[fk] || []).includes('Hide'),
      'Unplaced figure should not receive any when-deployed effect',
    );
  });
});
