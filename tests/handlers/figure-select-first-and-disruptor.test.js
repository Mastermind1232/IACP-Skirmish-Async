/**
 * alexanbv 2026-06-26 directives:
 *  (A) Disruptor Rifle (Snowtrooper / Mando) must ONLY be OFFERED in the
 *      after-attack-resolves window when the target is at exactly 1 Health.
 *      Previously it was enqueued on every non-miss and silently no-op'd.
 *  (B) When a MULTI-FIGURE group activates, the player must pick which figure
 *      activates FIRST — no Command Card (Urgency etc.) may be surfaced before
 *      a figure is selected. Single-figure groups are unaffected.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { enqueueAttackerPerDcEffects } from '../../src/handlers/after-attack-resolve.js';
import { getAfterAttackEffects } from '../../src/engine/after-attack-queue.js';
import { getDcActionButtons } from '../../src/discord/components.js';
import { isCompanionOrderPending } from '../../src/game/activation-state.js';

function _disruptorCombat(targetHp) {
  const combat = {
    attackerFigureKey: 'Snowtrooper-1-0',
    attackerDcName: 'Snowtrooper',
    _step7Hit: true,
    target: { figureKey: 'Rebel Trooper-2-0', msgId: 'tgtmsg', label: 'Rebel Trooper 2A' },
  };
  const game = { disruptorRiflePending: { 'Snowtrooper-1-0': true } };
  const deps = {
    getDcEffects: () => ({}),
    dcHealthState: new Map([['tgtmsg', [[targetHp, 8]]]]),
  };
  return { combat, game, deps };
}

describe('(A) Disruptor Rifle only enqueued when target at exactly 1 HP', () => {
  it('target at 1 HP → disruptor_rifle effect IS offered', () => {
    const { combat, game, deps } = _disruptorCombat(1);
    enqueueAttackerPerDcEffects(combat, game, deps);
    const effs = getAfterAttackEffects(combat, 'attacker').filter((e) => e.type === 'disruptor_rifle');
    assert.equal(effs.length, 1, 'offered when target at 1 HP');
  });
  it('target at 2 HP → NOT offered', () => {
    const { combat, game, deps } = _disruptorCombat(2);
    enqueueAttackerPerDcEffects(combat, game, deps);
    const effs = getAfterAttackEffects(combat, 'attacker').filter((e) => e.type === 'disruptor_rifle');
    assert.equal(effs.length, 0, 'not offered above 1 HP');
  });
  it('target at 5 HP → NOT offered', () => {
    const { combat, game, deps } = _disruptorCombat(5);
    enqueueAttackerPerDcEffects(combat, game, deps);
    const effs = getAfterAttackEffects(combat, 'attacker').filter((e) => e.type === 'disruptor_rifle');
    assert.equal(effs.length, 0);
  });
});

// Render helper: a 2-figure group with one playable CC special (Urgency).
function _renderGroup(actionsData) {
  const helpers = {
    getDcStats: () => ({ figures: 2, specials: [], specialCosts: [], specialMpCosts: [], keywords: [] }),
    getPlayableCcSpecialsForDc: () => ['Urgency'],
    getPlayableCcDoubleActionsForDc: () => [],
    getPlayableCcEndOfActivationForDc: () => [],
  };
  const game = { gameId: 'g1', player1CcDrawn: true, player2CcDrawn: true };
  const rows = getDcActionButtons('m1', 'Stormtrooper', 'Stormtrooper', actionsData, game, helpers);
  const ids = rows.flatMap((r) => r.components.map((c) => c.data.custom_id || c.data.customId || ''));
  return ids;
}

describe('(B) multi-figure group must pick a figure before any CC is playable', () => {
  it('no figure selected → figure-pick buttons shown, NO CC-special button', () => {
    const ids = _renderGroup({ selectedFigure: null, perFigureRemaining: { 0: 2, 1: 2 } });
    assert.ok(ids.some((id) => id.startsWith('dc_fig_pick_m1_f')), 'figure-pick buttons present');
    assert.ok(!ids.some((id) => id.startsWith('dc_cc_special_')), 'CC-special button suppressed pre-select');
  });
  it('figure 0 selected → CC-special button NOW appears', () => {
    const ids = _renderGroup({ selectedFigure: 0, perFigureRemaining: { 0: 2, 1: 2 } });
    assert.ok(ids.some((id) => id.startsWith('dc_cc_special_m1_')), 'CC-special button appears once a figure is chosen');
  });
  it('End Group Activation stays available before figure-select (player can abort)', () => {
    const ids = _renderGroup({ selectedFigure: null, perFigureRemaining: { 0: 2, 1: 2 } });
    assert.ok(ids.some((id) => id === 'dc_end_activation_m1'), 'End Group Activation present');
  });
});

// ── (C) host+companion must choose activation order first ──────────────────
function _hostCompanionGame(orderSet) {
  const game = { gameId: 'g2', player1CcDrawn: true, player2CcDrawn: true,
    dcActionsData: {
      host1: { perFigureRemaining: { 0: 2 }, figureLocked: {} },
      comp1: { perFigureRemaining: { 0: 2 }, figureLocked: {}, isCompanion: true, hostMsgId: 'host1' },
    },
  };
  if (orderSet) game.companionActivatedBefore = { host1: 'before' };
  return game;
}
function _renderSingle(msgId, dcName, game) {
  const helpers = {
    getDcStats: () => ({ figures: 1, specials: [], specialCosts: [], specialMpCosts: [], keywords: [] }),
    getPlayableCcSpecialsForDc: () => ['Urgency'],
    getPlayableCcDoubleActionsForDc: () => [],
    getPlayableCcEndOfActivationForDc: () => [],
  };
  const rows = getDcActionButtons(msgId, dcName, dcName, game.dcActionsData[msgId], game, helpers);
  return rows.flatMap((r) => r.components.map((c) => c.data.custom_id || c.data.customId || ''));
}

describe('(C) host+companion must choose activation order before acting', () => {
  it('isCompanionOrderPending: true for host+live-companion with order unset, false once set', () => {
    assert.equal(isCompanionOrderPending(_hostCompanionGame(false), 'host1'), true, 'host pending');
    assert.equal(isCompanionOrderPending(_hostCompanionGame(false), 'comp1'), true, 'companion pending (keyed on host)');
    assert.equal(isCompanionOrderPending(_hostCompanionGame(true), 'host1'), false, 'host resolved');
    assert.equal(isCompanionOrderPending(_hostCompanionGame(true), 'comp1'), false, 'companion resolved');
  });
  it('non-companion DC is never order-pending', () => {
    const g = { dcActionsData: { solo: { perFigureRemaining: { 0: 2 } } } };
    assert.equal(isCompanionOrderPending(g, 'solo'), false);
  });
  it('order pending → host shows NO Move/Attack/CC, only End Activation', () => {
    const ids = _renderSingle('host1', 'Ugnaught Tinkerer', _hostCompanionGame(false));
    assert.ok(!ids.some((id) => id.startsWith('dc_move_') || id.startsWith('dc_attack_') || id.startsWith('dc_interact_')), 'action row suppressed');
    assert.ok(!ids.some((id) => id.startsWith('dc_cc_special_')), 'CC suppressed');
    assert.ok(ids.some((id) => id === 'dc_end_activation_host1'), 'End Activation still present');
  });
  it('order pending → companion message also suppresses its action row', () => {
    const ids = _renderSingle('comp1', 'Junk Droid', _hostCompanionGame(false));
    assert.ok(!ids.some((id) => id.startsWith('dc_move_') || id.startsWith('dc_attack_')), 'companion action row suppressed');
  });
  it('order chosen → host action buttons appear', () => {
    const ids = _renderSingle('host1', 'Ugnaught Tinkerer', _hostCompanionGame(true));
    assert.ok(ids.some((id) => id.startsWith('dc_move_host1')), 'Move appears once order chosen');
  });
});

describe('(B-guard) runtime defense-in-depth: handler refuses CC before figure-select', () => {
  it('the _playCcFromDcThread guard exists for multi-figure no-selection', async () => {
    const fs = await import('node:fs');
    const url = await import('node:url');
    const src = fs.readFileSync(url.fileURLToPath(new URL('../../src/handlers/dc-play-area.js', import.meta.url)), 'utf8');
    assert.ok(/_figCount > 1 && \(_ad\?\.selectedFigure == null/.test(src), 'guard condition present');
    assert.ok(/Select which figure is activating first/.test(src), 'guard message present');
  });
});
