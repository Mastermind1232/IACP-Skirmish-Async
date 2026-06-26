/**
 * "Reveal" ruling (alexanbv 2026-06-26):
 *   1. "reveal" abilities show the drawn/searched card to BOTH players (an
 *      exception to CC secrecy) — Sith Acolyte (searchDeckForCC) and Devotion
 *      (devotionEffect) must inline the card NAME into their public log.
 *   2. whenever a CC is DISCARDED it is REVEALED to both players — the central
 *      discardCc helper posts a public reveal AND fires when-discarded passives.
 *   3. a PLAYED gate CC is announced publicly (reveal style).
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { resolveAbility } from '../../../src/game/abilities.js';
import { discardCc } from '../../../src/handlers/cc-hand.js';
import { COMBAT_RESOLVERS } from '../../../src/handlers/combat.js';

const ccDeckKey = (pn) => (pn === 1 ? 'player1CcDeck' : 'player2CcDeck');
const ccHandKey = (pn) => (pn === 1 ? 'player1CcHand' : 'player2CcHand');
const ccDiscardKey = (pn) => (pn === 1 ? 'player1CcDiscard' : 'player2CcDiscard');

describe('reveal ruling — Sith Acolyte (searchDeckForCC)', () => {
  it('inlines the searched card NAME into the public log', () => {
    const game = { [ccDeckKey(1)]: ['Force Throw', 'Some Other Card'], [ccHandKey(1)]: [] };
    const r = resolveAbility('sith_acolyte', { game, playerNum: 1, chosenOption: 'Force Throw' });
    assert.equal(r.applied, true);
    assert.match(r.logMessage, /Force Throw/, 'searched card name appears publicly');
    assert.match(r.logMessage, /revealed/i, 'log states it was revealed');
    assert.ok(game[ccHandKey(1)].includes('Force Throw'), 'card moved to hand');
  });
});

describe('reveal ruling — Devotion (devotionEffect)', () => {
  it('multi-match draw inlines the drawn card NAME publicly', () => {
    const game = { [ccDeckKey(1)]: ['Devoted Card', 'Filler'], [ccHandKey(1)]: [] };
    const r = resolveAbility('Devotion', { game, playerNum: 1, dcMessageMeta: new Map(), chosenFigureKey: 'devotion_draw|Devoted Card' });
    assert.equal(r.applied, true);
    assert.match(r.logMessage, /Devoted Card/, 'drawn card name appears publicly');
    assert.match(r.logMessage, /revealed/i, 'log states it was revealed');
    assert.ok(game[ccHandKey(1)].includes('Devoted Card'), 'card moved to hand');
  });
});

describe('reveal ruling — discardCc central choke point', () => {
  it('moves the card hand→discard, posts a PUBLIC reveal, and returns moved:true', async () => {
    const game = { [ccHandKey(2)]: ['Zillo Cost Card', 'Keep Me'], [ccDiscardKey(2)]: [] };
    const logged = [];
    const logGameAction = async (_g, _c, content) => { logged.push(content); };
    const res = await discardCc(game, 2, 'Zillo Cost Card', { client: null, logGameAction });
    assert.equal(res.moved, true);
    assert.deepEqual(game[ccHandKey(2)], ['Keep Me'], 'card left hand');
    assert.deepEqual(game[ccDiscardKey(2)], ['Zillo Cost Card'], 'card entered discard');
    assert.equal(logged.length >= 1, true, 'a public log was posted');
    assert.match(logged[0], /Zillo Cost Card/, 'discarded card name is revealed publicly');
    assert.match(logged[0], /revealed/i);
  });

  it('returns moved:false (no log) when the card is not in hand', async () => {
    const game = { [ccHandKey(1)]: ['Other'], [ccDiscardKey(1)]: [] };
    const logged = [];
    const res = await discardCc(game, 1, 'Not Here', { client: null, logGameAction: async (_g, _c, m) => logged.push(m) });
    assert.equal(res.moved, false);
    assert.equal(logged.length, 0);
  });

  it('fires the when-discarded subroutine (Windfall self-VP) on discard', async () => {
    const game = { [ccHandKey(1)]: ['Windfall'], [ccDiscardKey(1)]: [], player1VP: { total: 0, kills: 0, objectives: 0 } };
    const res = await discardCc(game, 1, 'Windfall', { client: null, logGameAction: async () => {} });
    assert.equal(res.moved, true);
    assert.equal(res.windfallSelfVp, 1, 'Windfall when-discarded hook fired');
    assert.equal(game.player1VP.total, 1);
  });
});

describe('reveal ruling — Zillo-style cost discards route through discardCc', () => {
  const thread = { send: async () => ({}) };

  it('Zillo Technique discard → reveals the spent CC publicly AND +1 Block', async () => {
    const game = { [ccHandKey(2)]: ['Sacrificed Card'], [ccDiscardKey(2)]: [] };
    const combat = { attackerPlayerNum: 1, defenderPlayerNum: 2 };
    const logged = [];
    const ctx = { client: {}, logGameAction: async (_g, _c, m) => logged.push(m) };
    await COMBAT_RESOLVERS.zillo_technique_discard.apply('Sacrificed Card', { game, combat, thread, ctx, side: 'defender', gameId: '42' });
    assert.equal(combat.bonusBlock, 1, '+1 Block applied');
    assert.deepEqual(game[ccDiscardKey(2)], ['Sacrificed Card'], 'card discarded');
    assert.ok(logged.some((m) => /Sacrificed Card/.test(m) && /revealed/i.test(m)), 'cost CC revealed publicly');
  });

  it('Illicit Arms (Bib) discard → reveals the spent CC publicly AND +1 Damage', async () => {
    const game = { [ccHandKey(1)]: ['Bribe Card'], [ccDiscardKey(1)]: [] };
    const combat = { attackerPlayerNum: 1 };
    const logged = [];
    const ctx = { client: {}, logGameAction: async (_g, _c, m) => logged.push(m) };
    await COMBAT_RESOLVERS.illicit_arms.apply('Bribe Card', { game, combat, thread, ctx, side: 'attacker', gameId: '42' });
    assert.equal(combat.bonusHits, 1, '+1 Damage applied');
    assert.deepEqual(game[ccDiscardKey(1)], ['Bribe Card'], 'card discarded');
    assert.ok(logged.some((m) => /Bribe Card/.test(m) && /revealed/i.test(m)), 'cost CC revealed publicly');
  });
});
