/**
 * Reaction Command cards played out of a move-interrupt window declare
 * themselves.
 *
 * Self-Defense ("Use when a hostile figure enters a space adjacent to you") has
 * NO restriction box, so the declaration step has nothing to offer and the
 * resolver fell back on "whoever is activating". During the opponent's move that
 * is nobody, so the card bailed with "no activation in progress" — in the only
 * window it is playable. Found 2026-08-24 sweeping for that bug class.
 *
 * The information was always there: the move-interrupt opportunity records which
 * of your figures the hostile moved next to (triggerFigureKey). Slippery Target
 * had been special-cased to read it (alexanbv 2026-06-19); cc-hand now sets the
 * declaration from it for every interrupt card, so the generic resolution picks
 * it up.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { resolveAbility } from '../../../src/game/abilities.js';
import { INTERRUPT_CARD_BY_TYPE } from '../../../src/handlers/move-interrupts-handler.js';

const MINE = 'Gamorrean Guard (Elite)-1-0';
const FOE = 'Stormtrooper (Regular)-1-0';
const M_MINE = 'm-mine';
const M_FOE = 'm-foe';

const meta = () => new Map([
  [M_MINE, { gameId: 'g', playerNum: 1, dcName: 'Gamorrean Guard (Elite)', displayName: 'Gamorrean Guard (Elite) [Group 1]' }],
  [M_FOE, { gameId: 'g', playerNum: 2, dcName: 'Stormtrooper (Regular)', displayName: 'Stormtrooper (Regular) [Group 1]' }],
]);
const health = () => new Map([[M_MINE, [[6, 6]]], [M_FOE, [[3, 3]]]]);

function game(declared) {
  const g = {
    gameId: 'g', currentRound: 2, selectedMap: { id: 'mos-eisley-outskirts' },
    figurePositions: { 1: { [MINE]: 'e19' }, 2: { [FOE]: 'e20' } },
    p1DcList: [{ dcName: 'Gamorrean Guard (Elite)' }], p1DcMessageIds: [M_MINE],
    p2DcList: [{ dcName: 'Stormtrooper (Regular)' }], p2DcMessageIds: [M_FOE],
    dcActionsData: {}, figureConditions: {},
  };
  if (declared) g.ccPlayedByFigureKey = declared;
  return g;
}
const play = (g) => resolveAbility('Self-Defense', {
  game: g, playerNum: 1, dcMessageMeta: meta(), dcHealthState: health(), cardName: 'Self-Defense',
});

describe('Self-Defense resolves during the opponent move it reacts to', () => {
  it('works when the interrupt window declares the reacting figure', () => {
    // No activation of ours exists — this is the opponent's turn, which is the
    // card's only real window.
    const g = game(MINE);
    const r = play(g);
    assert.equal(r.applied, true, r.manualMessage);
    assert.match(r.logMessage, /1 Damage/);
  });

  it('without the declaration it still bails — the declaration is what fixes it', () => {
    const r = play(game(null));
    assert.equal(r.applied, false);
    assert.match(r.manualMessage, /no activation in progress/);
  });
});

describe('every move-interrupt card can supply a declaration', () => {
  it('the interrupt map names the cards cc-hand reads', () => {
    // cc-hand matches the played card against this map to find the opportunity,
    // so a new interrupt type gets the behaviour for free — the point of doing
    // it there rather than special-casing a resolver again.
    const cards = Object.values(INTERRUPT_CARD_BY_TYPE);
    assert.ok(cards.includes('Self-Defense'));
    assert.ok(cards.includes('Slippery Target'));
    assert.ok(cards.includes('Parting Blow'));
    assert.ok(cards.includes('Dirty Trick'));
  });
});
