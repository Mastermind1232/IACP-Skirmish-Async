// Two-timing model — pending-modifier mechanism + Hondo/HK-47 routing + a
// same-timing card (Parry) is unaffected (alexanbv 2026-06-18).
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  stashPendingModifier,
  hasPendingModifiers,
  drainPendingModifiers,
  applyPendingEffect,
} from './combat-pending-modifiers.js';
import { getCcEffect, getCcEffectTiming } from '../data-loader.js';
import { COMBAT_RESOLVERS } from '../handlers/combat.js';

describe('pending-modifier mechanism (general)', () => {
  it('stash → has → drain is keyed per window and self-cleans', () => {
    const combat = {};
    assert.equal(hasPendingModifiers(combat, 'mods'), false);
    stashPendingModifier(combat, 'mods', { source: 'A', effect: { bonusHits: 1 } });
    stashPendingModifier(combat, 'mods', { source: 'B', effect: { bonusBlock: 2 } });
    stashPendingModifier(combat, 'after_resolve', { source: 'C', effect: { bonusHits: 9 } });
    assert.equal(hasPendingModifiers(combat, 'mods'), true);
    const drained = drainPendingModifiers(combat, 'mods');
    assert.equal(drained.length, 2);
    assert.equal(hasPendingModifiers(combat, 'mods'), false);
    // other windows untouched
    assert.equal(hasPendingModifiers(combat, 'after_resolve'), true);
    // draining the last window removes the container entirely
    drainPendingModifiers(combat, 'after_resolve');
    assert.equal(combat.pendingModifiers, undefined);
  });

  it('drain on an empty/unknown-but-valid window returns [] (no throw)', () => {
    assert.deepEqual(drainPendingModifiers({}, 'mods'), []);
  });

  it('rejects unknown windows and malformed modifiers', () => {
    assert.throws(() => stashPendingModifier({}, 'nope', { effect: {} }));
    assert.throws(() => stashPendingModifier({}, 'mods', { source: 'x' })); // no effect
    assert.throws(() => drainPendingModifiers({}, 'nope'));
  });

  it('applyPendingEffect sums each delta onto the matching combat counter', () => {
    const combat = { bonusHits: 1 };
    applyPendingEffect(combat, { bonusHits: 2, bonusBlock: 3, bonusAccuracy: -1 });
    assert.equal(combat.bonusHits, 3);
    assert.equal(combat.bonusBlock, 3);
    assert.equal(combat.bonusAccuracy, -1);
    // unknown fields ignored; zero deltas no-op
    applyPendingEffect(combat, { bogus: 5, bonusHits: 0 });
    assert.equal(combat.bonusHits, 3);
  });

  it('drain → apply lands the effect in the (later) window', () => {
    const combat = {};
    stashPendingModifier(combat, 'mods', { source: 'Negotiate (Hondo)', effect: { bonusHits: 2 } });
    // mods window runs: drain + apply
    for (const { effect } of drainPendingModifiers(combat, 'mods')) applyPendingEffect(combat, effect);
    assert.equal(combat.bonusHits, 2);
  });
});

describe('data model: effectTiming defaults to play timing', () => {
  it('Parry is the same-timing case (effectTiming === play timing)', () => {
    // Parry: play=whileDefending, effect=whileDefending (no effectTiming field).
    const parry = getCcEffect('Parry');
    assert.ok(parry, 'Parry exists in cc-effects');
    assert.equal(parry.effectTiming, undefined); // no override
    assert.equal(getCcEffectTiming('Parry'), parry.timing); // defaults to play timing
  });

  it('unknown card → null timing', () => {
    assert.equal(getCcEffectTiming('Not A Real Card'), null);
  });
});

describe('two-timing routing: Hondo Negotiate', () => {
  const thread = { send: async () => ({}) };
  const args = (combat, game = {}) => ({ game, combat, thread, ctx: { checkWinConditions: async () => {}, client: {} }, side: 'attacker', gameId: '1' });

  it('opponent PAYS VP → applies immediately (−2 VP now, no pending modifier)', async () => {
    const game = { player1VP: { total: 0, kills: 0, objectives: 0 }, player2VP: { total: 5, kills: 0, objectives: 0 } };
    const combat = { attackerPlayerNum: 1, defenderPlayerNum: 2 };
    await COMBAT_RESOLVERS.negotiate.apply('pay', args(combat, game));
    assert.equal(game.player2VP.total, 3); // immediate: defender lost 2 VP
    assert.equal(combat.pendingModifiers, undefined); // nothing deferred
    assert.equal(combat.bonusHits, undefined); // no damage
    assert.equal(combat.negotiateResolved, true);
  });

  it('opponent TAKES DAMAGE → +2 lands in the mods window (deferred, not immediate)', async () => {
    const combat = { attackerPlayerNum: 1, defenderPlayerNum: 2 };
    await COMBAT_RESOLVERS.negotiate.apply('accept', args(combat));
    assert.equal(combat.bonusHits, undefined); // NOT applied at on_declare
    assert.equal(hasPendingModifiers(combat, 'mods'), true);
    // Now the mods window runs and drains it:
    for (const { effect } of drainPendingModifiers(combat, 'mods')) applyPendingEffect(combat, effect);
    assert.equal(combat.bonusHits, 2); // applied in the mods window
  });
});

describe('two-timing routing: HK-47 Query', () => {
  const thread = { send: async () => ({}) };
  const args = (combat, game = {}) => ({ game, combat, thread, ctx: {}, side: 'attacker', gameId: '1' });

  it('Bleed branch applies immediately; accept branch defers +1 Damage to mods', async () => {
    const gBleed = { figureConditions: {} };
    const cBleed = { target: { figureKey: 'D-1-0' } };
    await COMBAT_RESOLVERS.query.apply('bleed', args(cBleed, gBleed));
    assert.ok((gBleed.figureConditions['D-1-0'] || []).includes('Bleed'));
    assert.equal(cBleed.pendingModifiers, undefined); // immediate

    const cAcc = { target: { figureKey: 'D-1-0' } };
    await COMBAT_RESOLVERS.query.apply('accept', args(cAcc));
    assert.equal(cAcc.bonusHits, undefined);
    for (const { effect } of drainPendingModifiers(cAcc, 'mods')) applyPendingEffect(cAcc, effect);
    assert.equal(cAcc.bonusHits, 1); // deferred to mods
  });
});
