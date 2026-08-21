/**
 * Support Specialist (Del Meeko CC) — "Special Action: Choose a friendly DROID,
 * TECHNICIAN, or TROOPER within 3 spaces. That figure interrupts to perform an
 * action."
 *
 * alexanbv 2026-08-21: "Support specialist is a special action. Should be the
 * same as any other special action. Of course, this is one of those that allows
 * a lot of options. There needs to be a menu to choose which figure is being
 * selected and then another menu for which action that figure is doing."
 *
 * So two menus. It used to be one flat list crossing every eligible figure with
 * every action, which grows as figures x actions. And the card was tagged
 * `duringActivation`, which in this engine means "played from hand" rather than
 * from the DC's Special Action button.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { resolveAbility } from '../../../src/game/abilities.js';
import { getCcEffect } from '../../../src/data-loader.js';
import { isCcPlayableByDc } from '../../../src/game/cc-timing.js';

const MSG = 'msg-ss';
const TROOP_MSG = 'msg-troop';
const DEL = 'Del Meeko-1-0';
const T1 = 'Stormtrooper (Regular)-1-0';
const T2 = 'Stormtrooper (Regular)-1-1';

function fixture() {
  return {
    gameId: 'g-ss',
    selectedMap: { id: 'mos-eisley-outskirts' },
    dcActionsData: { [MSG]: { selectedFigure: 0 } },
    // Real spaces on a real map: without one countGameSpaces returns Infinity
    // and the within-3 filter drops everybody. e19/e20/e21 are collinear and
    // within 3 of each other.
    figurePositions: { 1: { [DEL]: 'e19', [T1]: 'e20', [T2]: 'e21' } },
  };
}
const meta = () => new Map([
  [MSG, { gameId: 'g-ss', playerNum: 1, dcName: 'Del Meeko', displayName: 'Del Meeko [Group 1]' }],
  [TROOP_MSG, { gameId: 'g-ss', playerNum: 1, dcName: 'Stormtrooper (Regular)', displayName: 'Stormtrooper (Regular) [Group 1]' }],
]);

describe('Support Specialist is a Special Action', () => {
  it('is tagged specialAction, so it comes off the DC button', () => {
    assert.equal(getCcEffect('Support Specialist')?.timing, 'specialAction');
    assert.equal(isCcPlayableByDc('Support Specialist', 'Del Meeko', 'Del Meeko [Group 1]'), true);
  });

  it("Smuggler's Tricks, the other card printing the arrow, is tagged the same way", () => {
    assert.equal(getCcEffect("Smuggler's Tricks")?.timing, 'specialAction');
  });
});

describe('Support Specialist — figure menu, then action menu', () => {
  it('menu 1 lists figures only, one entry each, with no action in the value', () => {
    const r = resolveAbility('Support Specialist', {
      game: fixture(), playerNum: 1, dcMessageMeta: meta(),
    });
    assert.equal(r.requiresChoice, true);
    assert.deepEqual(r.choiceValues, [T1, T2], 'one entry per figure, bare figure keys');
    assert.ok(!r.choiceValues.some((v) => v.includes('|')),
      'the first menu must not pre-bind an action');
    assert.equal(r.choiceOptions.length, 2, 'no figure x action cross product');
  });

  it('menu 2 offers that one figure its actions', () => {
    const r = resolveAbility('Support Specialist', {
      game: fixture(), playerNum: 1, dcMessageMeta: meta(), chosenFigureKey: T1,
    });
    assert.equal(r.requiresChoice, true);
    assert.deepEqual(r.choiceValues, [`${T1}|move`, `${T1}|attack`]);
    assert.ok(r.choiceValues.every((v) => v.startsWith(T1)),
      'the action menu is scoped to the figure already chosen');
  });

  it('a bare figure key never resolves straight to a move', () => {
    // The old code defaulted a separator-less value to `move`, which would now
    // skip the action menu entirely.
    const game = fixture();
    const r = resolveAbility('Support Specialist', {
      game, playerNum: 1, dcMessageMeta: meta(), chosenFigureKey: T1,
    });
    assert.notEqual(r.applied, true, 'picking a figure is not yet a resolution');
    assert.equal(game.pendingMoveX, undefined);
  });

  it('the action choice still grants the interrupt', () => {
    const game = fixture();
    const r = resolveAbility('Support Specialist', {
      game, playerNum: 1, dcMessageMeta: meta(), chosenFigureKey: `${T1}|attack`,
    });
    assert.equal(r.applied, true);
    assert.ok(game.freeAttackBonusPending?.[T1], 'attack interrupt booked');
  });
});
