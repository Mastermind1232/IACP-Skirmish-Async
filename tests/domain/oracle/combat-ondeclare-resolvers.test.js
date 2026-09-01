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

import { figureMpRemaining } from '../../../src/game/game-helpers.js';

describe('on_declare resolvers: Vanguard + EE-3 (die→red swaps)', () => {
  const t = { send: async () => ({}) };
  it('vanguard swaps the chosen non-red die to red; skip leaves it', async () => {
    const c = { attackInfo: { dice: ['blue', 'green'] } };
    await COMBAT_RESOLVERS.vanguard.apply('blue', { game: {}, combat: c, thread: t, ctx: {} });
    assert.deepEqual(c.attackInfo.dice, ['red', 'green']); assert.equal(c._vanguardOnDeclareDecided, true);
    const c2 = { attackInfo: { dice: ['blue'] } };
    await COMBAT_RESOLVERS.vanguard.apply('skip', { game: {}, combat: c2, thread: t, ctx: {} });
    assert.deepEqual(c2.attackInfo.dice, ['blue']); assert.equal(c2._vanguardOnDeclareDecided, true);
  });
  it('ee3 swaps a die to red AND spends 2 MP', async () => {
    const game = { movementBank: { mid: { perFig: { 0: { remaining: 2 } } } } };
    const c = { attackInfo: { dice: ['green'] }, attackerMsgId: 'mid', attackerFigureKey: 'Boba-1-0' };
    await COMBAT_RESOLVERS.ee3_carbine.apply('green', { game, combat: c, thread: t, ctx: {} });
    assert.deepEqual(c.attackInfo.dice, ['red']);
    assert.equal(figureMpRemaining(game, 'mid', 0), 0, '2 MP spent');
    assert.equal(c._ee3OnDeclareDecided, true);
  });
});

describe('zillo-step resolver: Zillo Technique (pierce cancel)', () => {
  const t = { send: async () => ({}) };
  // alexanbv 2026-06-26: no sub-prompt — picking the ability button directly
  // exhausts (apply ignores its choice arg); "Skip" is the zillo window's Done
  // (passModsSide), which never calls this resolver. So apply ALWAYS reduces
  // Pierce by 2 + marks resolved.
  it('apply directly exhausts → reduces pierce by 2', async () => {
    const c = {}; await COMBAT_RESOLVERS.zillo_technique_pierce_cancel.apply(null, { game: {}, combat: c, thread: t, ctx: {} });
    assert.equal(c.defenderReducePierce, 2); assert.equal(c.zilloPierceResolved, true);
  });
  it('has NO sub-prompt (the window itself is the Exhaust/Skip choice)', () => {
    assert.equal(COMBAT_RESOLVERS.zillo_technique_pierce_cancel.prompt, undefined);
  });
});

describe('special-step resolvers: Zeb + Rapid Recalibration (2-stage die turn)', () => {
  const t = { send: async () => ({}) };
  // These resolvers now take their faces from the SINGLE canonical source
  // (data/dice.json, via faceOptionsFor) rather than an injected getDiceData,
  // which is the point of the consolidation — alexanbv 2026-06-21 for There Is
  // No Try, extended to the whole die-turn family 2026-08-31. So the fixture
  // uses the blue die's REAL distinct faces; index 4 is "2 Damage / 3 Acc".
  const getDiceData = () => ({ attack: { blue: [{ acc: 1, dmg: 0, surge: 0 }, { acc: 0, dmg: 2, surge: 0 }] } });
  const BLUE_2DMG_IDX = '4';
  it('Zeb: pick die (stage 1, followUp) → pick face (stage 2) turns the die', async () => {
    const c = { attackDiceResults: [{ color: 'blue', dmg: 1, surge: 0, acc: 0 }], attackRoll: { acc: 0, dmg: 1, surge: 0 }, lasatHonorGuardPhase: true };
    const r1 = await COMBAT_RESOLVERS.lasat_honor_guard.apply('0', { game: {}, combat: c, thread: t, ctx: { getDiceData }, gameId: '42', id: 'lasat_honor_guard' });
    assert.equal(r1.followUp, true); assert.equal(c._lasatStage, 'face'); assert.equal(c._lasatDie, 0);
    await COMBAT_RESOLVERS.lasat_honor_guard.apply(BLUE_2DMG_IDX, { game: {}, combat: c, thread: t, ctx: { getDiceData }, gameId: '42', id: 'lasat_honor_guard' });
    assert.equal(c.attackDiceResults[0].dmg, 2); // turned to the 2-damage face
    assert.equal(c.attackDiceResults[0].acc, 3); // ...which carries 3 accuracy
    assert.equal(c.attackRoll.dmg, 2);
    assert.equal(c._lasatStage, undefined); assert.equal(c.lasatHonorGuardPhase, false);
  });
  it('Rapid Recalibration: any attack die eligible; 2-stage turn', async () => {
    const c = { attackDiceResults: [{ color: 'blue', dmg: 0, surge: 0, acc: 1 }], attackRoll: { acc: 1, dmg: 0, surge: 0 } };
    const r1 = await COMBAT_RESOLVERS.rapid_recalibration.apply('0', { game: {}, combat: c, thread: t, ctx: { getDiceData }, gameId: '42', id: 'rapid_recalibration' });
    assert.equal(r1.followUp, true);
    await COMBAT_RESOLVERS.rapid_recalibration.apply(BLUE_2DMG_IDX, { game: {}, combat: c, thread: t, ctx: { getDiceData }, gameId: '42', id: 'rapid_recalibration' });
    assert.equal(c.attackDiceResults[0].dmg, 2);
    assert.equal(c.attackRoll.dmg, 2);
    // Totals are re-summed from the pool, so the turned die's accuracy replaces
    // the old one rather than both being clamped independently.
    assert.equal(c.attackRoll.acc, 3);
  });
});
