/**
 * A Lure-controlled figure is not friendly to anyone.
 *
 * alexanbv 2026-08-24: "No other figures are considered friendly to the figure
 * that is being controlled", "Friendly figures within 3 spaces of you would
 * indeed find no one", and "for CC, an example would be Battlefield Awareness,
 * as the controlled figure is NOT friendly".
 *
 * Note where each half already lived. Combat-time friendly gates (Purge
 * Commander's Coordinated Hunt, Shared Calculations, Get Behind Me, Sentinel …)
 * have consulted combat.noFriendliesActive since destruct 2026-05-07, and the
 * Lure attack sets it. What had no cover was a Command card resolved OUTSIDE
 * that system: Battlefield Awareness enumerates its owner's figures directly,
 * and the controlled figure is still sitting in its owner's figurePositions
 * while it is borrowed.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { resolveAbility } from '../../../src/game/abilities.js';
import { isLureControlled, countsAsFriendly, friendlyFigureKeys } from '../../../src/game/lure-isolation.js';

const LEADER = 'Cassian Andor-1-0';
const OTHER = 'Rebel Trooper (Regular)-2-0';
const TAKEN = 'Rebel Trooper (Regular)-2-1'; // this one is being controlled
const MSG_L = 'm-lead';
const MSG_T = 'm-troop';

const meta = () => new Map([
  [MSG_L, { gameId: 'g', playerNum: 1, dcName: 'Cassian Andor', displayName: 'Cassian Andor [Group 1]' }],
  [MSG_T, { gameId: 'g', playerNum: 1, dcName: 'Rebel Trooper (Regular)', displayName: 'Rebel Trooper (Regular) [Group 2]' }],
]);

function game({ lured = false } = {}) {
  const g = {
    gameId: 'g', currentRound: 2, selectedMap: { id: 'mos-eisley-outskirts' },
    figurePositions: { 1: { [LEADER]: 'e19', [OTHER]: 'e20', [TAKEN]: 'e21' } },
    p1DcList: [{ dcName: 'Cassian Andor' }, { dcName: 'Rebel Trooper (Regular)' }],
    p1DcMessageIds: [MSG_L, MSG_T],
    dcActionsData: { [MSG_L]: { selectedFigure: 0, perFigureRemaining: { 0: 2 } } },
    figureConditions: {},
  };
  if (lured) {
    g.pendingLure = {
      controllerPlayerNum: 2,      // the OPPONENT has borrowed our trooper
      controlledFigureKey: TAKEN,
      controlledPlayerNum: 1,
    };
  }
  return g;
}

describe('Battlefield Awareness cannot be played off a borrowed figure', () => {
  it('offers the borrowed figure normally when no Lure is running', () => {
    const r = resolveAbility('Battlefield Awareness', {
      game: game(), playerNum: 1, dcMessageMeta: meta(),
    });
    assert.equal(r.requiresChoice, true);
    assert.ok(r.choiceValues.includes(TAKEN), 'ordinarily it is one of ours');
  });

  it('withholds it while it is controlled by the opponent', () => {
    const r = resolveAbility('Battlefield Awareness', {
      game: game({ lured: true }), playerNum: 1, dcMessageMeta: meta(),
    });
    assert.ok(!(r.choiceValues || []).includes(TAKEN),
      'the controlled figure is not friendly to its own side while borrowed');
    assert.ok((r.choiceValues || []).includes(OTHER),
      'our other figures are unaffected');
  });
});

describe('the isolation predicate', () => {
  it('knows which figure is controlled', () => {
    assert.equal(isLureControlled(game({ lured: true }), TAKEN), true);
    assert.equal(isLureControlled(game({ lured: true }), OTHER), false);
    assert.equal(isLureControlled(game(), TAKEN), false);
  });

  it('cuts both ways', () => {
    const g = game({ lured: true });
    // nothing is friendly TO it...
    assert.equal(countsAsFriendly(g, TAKEN, OTHER), false);
    // ...and it is friendly to nobody
    assert.equal(countsAsFriendly(g, OTHER, TAKEN), false);
    // unrelated pairs are untouched
    assert.equal(countsAsFriendly(g, LEADER, OTHER), true);
  });

  it('empties the friendly list for the controlled figure', () => {
    const g = game({ lured: true });
    assert.deepEqual(friendlyFigureKeys(g, TAKEN, [LEADER, OTHER]), [],
      '"friendly figures within 3 spaces of you" finds no one');
    assert.deepEqual(friendlyFigureKeys(g, LEADER, [OTHER, TAKEN]), [OTHER],
      'and everyone else simply cannot see it');
  });

  it('is inert with no Lure running', () => {
    const g = game();
    assert.deepEqual(friendlyFigureKeys(g, LEADER, [OTHER, TAKEN]), [OTHER, TAKEN]);
  });
});
