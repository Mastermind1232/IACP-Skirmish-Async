/**
 * Defender-side unique-figure CCs must be played by the figure being attacked.
 *
 * The card says "an attack targeting YOU". But ctx.isDefender is only
 * player-level (combat.defenderPlayerNum === playerNum) and the restriction gate
 * is army/board-level, so a unique-figure CC used to be playable whenever ANY of
 * your figures was the defender — and the resolver then acted on that defender.
 *
 * Concretely, Furious Charge (Gaarkhan): a Rebel Trooper takes 3+ Damage while
 * Gaarkhan stands elsewhere, and the Rebel Trooper's Deployment card gets
 * readied. Found 2026-08-24 auditing alexanbv's note that "furious charge also is
 * out of activation".
 *
 * The gate asks getUniqueCcPlayerOptions who may legally play the card rather
 * than re-listing the enablers, so it stays in step with the picker cc-hand
 * shows — including alexanbv 2026-08-24: "debts repaid, like SoS, also has an
 * option to work with any figure if A New Hope is in this list".
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { isCcPlayableNow } from '../../../src/game/cc-timing.js';
import { getUniqueCcPlayerOptions } from '../../../src/game/unique-figure-ccs.js';

const GAAR = 'Gaarkhan-1-0';
const TROOP = 'Rebel Trooper-2-0';

function game(defFk, { aNewHope = false } = {}) {
  const dcs = [{ dcName: 'Gaarkhan' }, { dcName: 'Rebel Trooper' }];
  const mids = ['m-gaar', 'm-troop'];
  if (aNewHope) { dcs.push({ dcName: '[A New Hope]' }); mids.push('m-anh'); }
  return {
    gameId: 'g', currentRound: 2, player1Id: 'p1', player2Id: 'p2',
    currentActivationTurnPlayerId: 'p2',
    figurePositions: { 1: { [GAAR]: 'e19', [TROOP]: 'e20' } },
    p1DcList: dcs, p1DcMessageIds: mids,
    pendingCombat: { attackerPlayerNum: 2, defenderPlayerNum: 1, target: { figureKey: defFk } },
  };
}

describe('a unique-figure defender-side CC needs its own figure to be the defender', () => {
  it('Furious Charge is playable when Gaarkhan is the one being attacked', () => {
    assert.equal(isCcPlayableNow(game(GAAR), 1, 'Furious Charge'), true);
  });

  it('Furious Charge is NOT playable when someone else takes the hit', () => {
    assert.equal(isCcPlayableNow(game(TROOP), 1, 'Furious Charge'), false,
      'the card says "an attack targeting YOU" — you is Gaarkhan');
  });
});

describe('[A New Hope] still opens it to any friendly figure', () => {
  it('offers the defending Rebel Trooper as an a_new_hope option', () => {
    const opts = getUniqueCcPlayerOptions(game(TROOP, { aNewHope: true }), 1, 'Furious Charge');
    const trooper = opts.find((o) => o.figureKey === TROOP);
    assert.ok(trooper, `expected the Trooper to be offered, got ${JSON.stringify(opts)}`);
    assert.equal(trooper.kind, 'a_new_hope');
  });

  it('makes Furious Charge playable with the Trooper defending', () => {
    assert.equal(isCcPlayableNow(game(TROOP, { aNewHope: true }), 1, 'Furious Charge'), true,
      'A New Hope lets a friendly figure play a name-restricted CC');
  });
});

describe('the gate only narrows unique-figure cards', () => {
  it('a keyword-restricted defender-side CC is untouched', () => {
    // Counter Attack is BRAWLER, not a unique-figure CC. Whether the defender
    // must have the keyword is a separate question, deliberately not decided here.
    assert.equal(isCcPlayableNow(game(TROOP), 1, 'Counter Attack'), true);
    assert.equal(isCcPlayableNow(game(GAAR), 1, 'Counter Attack'), true);
  });

  it('does not block when the named figure is not in the army at all', () => {
    // Bo-Katan is absent, so getUniqueCcPlayerOptions is empty and this gate
    // abstains — the restriction gate is what rejects the play.
    assert.equal(isCcPlayableNow(game(TROOP), 1, 'Gauntlet Blade'), true);
  });

  it('does not block when there is no live attack', () => {
    const g = game(GAAR);
    delete g.pendingCombat;
    // No combat: other gates decide, this one abstains rather than hard-failing.
    assert.doesNotThrow(() => isCcPlayableNow(g, 1, 'Furious Charge'));
  });
});
