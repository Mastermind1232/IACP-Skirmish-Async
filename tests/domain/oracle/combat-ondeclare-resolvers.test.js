/**
 * Validation of on_declare gate resolvers (alexanbv 2026-06-14: "continue
 * building resolvers and validate"). First execution of the on-declare gate
 * resolver path. Merciless routes its 1 damage through the shared damage
 * pipeline (_applyDamage), matching the legacy handleMerciless.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { COMBAT_RESOLVERS } from '../../../src/handlers/combat.js';

const thread = { send: async () => ({}) };

describe('on_declare resolver: Merciless', () => {
  it('use → 1 Damage to a HARMFUL-conditioned target via the shared pipeline', async () => {
    const game = { figureConditions: { 'D-1-0': ['Bleed'] } };
    const dcHealthState = new Map([['mid', [[5, 5]]]]);
    const combat = { mercilessAvailable: { targetFigureKey: 'D-1-0', targetMsgId: 'mid', defenderPlayerNum: 2, attackerPlayerNum: 1, targetLabel: 'Def' } };
    await COMBAT_RESOLVERS.merciless.apply('use', { game, combat, thread, ctx: { dcHealthState, logGameAction: async () => {}, client: {} } });
    assert.equal(dcHealthState.get('mid')[0][0], 4, 'target took 1 damage');
    assert.equal(combat.mercilessUsed, true);
    assert.equal(combat.mercilessAvailable, undefined);
  });

  it('use with no HARMFUL condition → no damage (re-check at resolve time)', async () => {
    const game = { figureConditions: { 'D-1-0': [] } };
    const dcHealthState = new Map([['mid', [[5, 5]]]]);
    const combat = { mercilessAvailable: { targetFigureKey: 'D-1-0', targetMsgId: 'mid', defenderPlayerNum: 2, attackerPlayerNum: 1, targetLabel: 'Def' } };
    await COMBAT_RESOLVERS.merciless.apply('use', { game, combat, thread, ctx: { dcHealthState, logGameAction: async () => {}, client: {} } });
    assert.equal(dcHealthState.get('mid')[0][0], 5, 'no damage — condition gone');
    assert.equal(combat.mercilessUsed, true);
  });

  it('skip → no damage, resolved', async () => {
    const combat = { mercilessAvailable: { targetFigureKey: 'D-1-0', targetLabel: 'Def' } };
    await COMBAT_RESOLVERS.merciless.apply('skip', { game: {}, combat, thread, ctx: {} });
    assert.equal(combat.mercilessUsed, true);
    assert.equal(combat.mercilessAvailable, undefined);
  });
});

describe('on_declare resolver: Front Line', () => {
  const thread2 = { send: async () => ({}) };
  it('swap → +2 Accuracy and one blue die becomes red', async () => {
    const c = { attackInfo: { dice: ['blue', 'red', 'green'] } };
    await COMBAT_RESOLVERS.front_line.apply('swap', { game: {}, combat: c, thread: thread2, ctx: {} });
    assert.equal(c.bonusAccuracy, 2);
    assert.deepEqual(c.attackInfo.dice, ['red', 'red', 'green']);
    assert.equal(c._frontLineSwapDecided, true);
  });
  it('noswap → +2 Accuracy only, dice unchanged', async () => {
    const c = { attackInfo: { dice: ['blue', 'green'] } };
    await COMBAT_RESOLVERS.front_line.apply('noswap', { game: {}, combat: c, thread: thread2, ctx: {} });
    assert.equal(c.bonusAccuracy, 2);
    assert.deepEqual(c.attackInfo.dice, ['blue', 'green']);
  });
});
