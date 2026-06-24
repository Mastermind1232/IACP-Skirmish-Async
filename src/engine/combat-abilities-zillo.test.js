import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import './combat-mods-gate.js'; // self-registers the executable zillo-window pierce-cancel
import { abilitiesForWindow } from './combat-timing-registry.js';

// MIGRATED from the deleted tests/domain/oracle/combat-zillo-discard-step4-timing.test.js
// and the trimmed combat-zillo-pierce-timing.test.js (the maybePromptZilloPierceCancel
// source-pin). Those asserted source structure inside the now-deleted gate cluster.
// Here the SAME behaviors are re-expressed against the NEW gate surface:
//   abilitiesForWindow('zillo', 'defender', …) — the executable query the
//   sequence's zillo gate (after spend_surges, before damage) feeds.
//
// Behaviors preserved:
//   1. Zillo Technique EXHAUST (-2 Pierce) is a DEFENDER 'zillo'-window ability,
//      DISTINCT from the mods-window discard-CC (+1 Block) — they have different
//      ids/windows and different gating.
//   2. It is offered only when total Pierce > 0, computed across ALL sources
//      (bonusPierce + surgePierce + attackInfo.pierce) minus prior reductions
//      (defenderReducePierce). No prompt on a 0-Pierce attack — the defender
//      must not waste the exhaust.
//   3. Suppressed once prompted/resolved this attack, on an NPC target, and when
//      the [Zillo Technique] card is exhausted or depleted.

const zilloAt = (game, combat) => abilitiesForWindow('zillo', 'defender', game, combat, {}).map((a) => a.id);

// Defender = player 2 holding a ready, non-depleted [Zillo Technique].
function game(o = {}) {
  return {
    gameId: 'g1',
    p2DcList: [{ dcName: '[Zillo Technique]' }],
    p2DcMessageIds: ['zt-msg'],
    exhaustedSkirmishUpgrades: {},
    p1DepletedDcMessageIds: [],
    p2DepletedDcMessageIds: [],
    figurePositions: { 1: {}, 2: {} },
    ...o,
  };
}
function combat(o = {}) {
  return {
    attackerPlayerNum: 1,
    defenderPlayerNum: 2,
    target: { figureKey: 'Def-2-0' },
    bonusPierce: 0,
    surgePierce: 0,
    attackInfo: { pierce: 0 },
    defenderReducePierce: 0,
    ...o,
  };
}

describe('Zillo Technique pierce-cancel — zillo window (after spend_surges)', () => {
  it('IS offered to the defender when total Pierce > 0 (from bonusPierce)', () => {
    assert.ok(zilloAt(game(), combat({ bonusPierce: 1 })).includes('zillo_technique_pierce_cancel'));
  });

  it('IS offered when Pierce comes from surgePierce (post step-5 contribution)', () => {
    assert.ok(zilloAt(game(), combat({ surgePierce: 2 })).includes('zillo_technique_pierce_cancel'));
  });

  it('IS offered when Pierce comes from attackInfo.pierce (override-dice contribution)', () => {
    assert.ok(zilloAt(game(), combat({ attackInfo: { pierce: 3 } })).includes('zillo_technique_pierce_cancel'));
  });

  it('is NOT offered when total Pierce is 0 (defender should not waste the exhaust)', () => {
    assert.ok(!zilloAt(game(), combat()).includes('zillo_technique_pierce_cancel'));
  });

  it('is NOT offered when prior reductions cancel all the Pierce (net 0)', () => {
    // bonusPierce 2 - defenderReducePierce 2 = 0 → no prompt.
    assert.ok(!zilloAt(game(), combat({ bonusPierce: 2, defenderReducePierce: 2 })).includes('zillo_technique_pierce_cancel'));
  });

  it('is NOT offered once already prompted this attack', () => {
    assert.ok(!zilloAt(game(), combat({ bonusPierce: 1, zilloPierceCancelPrompted: true })).includes('zillo_technique_pierce_cancel'));
  });

  it('is NOT offered once already resolved this attack', () => {
    assert.ok(!zilloAt(game(), combat({ bonusPierce: 1, zilloPierceResolved: true })).includes('zillo_technique_pierce_cancel'));
  });

  it('is NOT offered against an NPC target', () => {
    assert.ok(!zilloAt(game(), combat({ bonusPierce: 1, target: { figureKey: 'Def-2-0', isNpc: true } })).includes('zillo_technique_pierce_cancel'));
  });

  it('is NOT offered when the [Zillo Technique] card is exhausted', () => {
    const g = game({ exhaustedSkirmishUpgrades: { 'zt-msg': ['Zillo Technique'] } });
    assert.ok(!zilloAt(g, combat({ bonusPierce: 1 })).includes('zillo_technique_pierce_cancel'));
  });

  it('is NOT offered when the [Zillo Technique] card is depleted', () => {
    const g = game({ p2DepletedDcMessageIds: ['zt-msg'] });
    assert.ok(!zilloAt(g, combat({ bonusPierce: 1 })).includes('zillo_technique_pierce_cancel'));
  });

  it('is NOT offered when the defender does not hold [Zillo Technique]', () => {
    const g = game({ p2DcList: [], p2DcMessageIds: [] });
    assert.ok(!zilloAt(g, combat({ bonusPierce: 1 })).includes('zillo_technique_pierce_cancel'));
  });

  it('the pierce-cancel exhaust is DISTINCT from the mods-window discard-CC (different window + id)', () => {
    // The exhaust lives in the 'zillo' window; the +1 Block discard-CC lives in
    // 'mods'. They never collide: the zillo query must not surface the discard id,
    // and the mods query must not surface the pierce-cancel id.
    const g = game({ player2CcHand: ['Tough Luck'] });
    const c = combat({ bonusPierce: 1 });
    const zilloIds = abilitiesForWindow('zillo', 'defender', g, c, {}).map((a) => a.id);
    const modsIds = abilitiesForWindow('mods', 'defender', g, c, { getDcEffects: () => ({}) }).map((a) => a.id);
    assert.ok(zilloIds.includes('zillo_technique_pierce_cancel'), 'exhaust is in the zillo window');
    assert.ok(!zilloIds.includes('zillo_technique_discard'), 'discard-CC is NOT in the zillo window');
    assert.ok(!modsIds.includes('zillo_technique_pierce_cancel'), 'exhaust is NOT in the mods window');
  });
});
