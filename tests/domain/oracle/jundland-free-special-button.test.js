/**
 * ORACLE — Jundland Terror free Special Action button surfacing.
 *
 * CSV row 706 (Jundland Terror): "Chosen figure gains 2 movement points and may
 * interrupt to perform an attack or Special Action." Designer ruling: the player
 * chooses which figure plays it, then chooses Special Action OR Attack; if
 * Special Action is chosen, ALL of that figure's special actions are surfaced
 * for a single free (cost-0 / interrupt) use.
 *
 * This probe pins the RENDER + DISPATCH side of the "free special" half:
 *   - When game.freeSpecialActionPending[figureKey] is set, that figure's native
 *     special actions render at 0 action cost ("(free)" label) and are enabled
 *     even with 0 actions remaining.
 *   - The marker is one-shot (consumed on use — covered by the resolver tests in
 *     abilities.test.js; here we pin the UI contract).
 *
 * Reuses the Choose-a-Side Gar Saxon Flamethrower 0-cost injection pattern.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { getDcActionButtons } from '../../../src/discord/components.js';
import { getDcStats } from '../../../src/data-loader.js';
import { _registerDcMessageMeta } from '../../../src/game/activation-state.js';

function _labels(rows) {
  const out = [];
  for (const row of rows || []) {
    for (const comp of row?.components || []) {
      const data = comp?.data || comp;
      if (data?.label != null) out.push({ label: String(data.label), disabled: !!data.disabled });
    }
  }
  return out;
}

const _helpers = {
  getDcStats: (dcName) => getDcStats(dcName),
  getPlayerNumForMsgId: () => 1,
};

function buildBanthaGame() {
  const msgId = 'm-bantha';
  const dcMessageMeta = new Map([
    [msgId, { gameId: 'g-jt', playerNum: 1, dcName: 'Bantha Rider', displayName: 'Bantha Rider [Group 1]' }],
  ]);
  _registerDcMessageMeta(dcMessageMeta);
  const game = {
    gameId: 'g-jt',
    dcActionsData: { [msgId]: { selectedFigure: 0, remaining: 2 } },
    figurePositions: { 1: { 'Bantha Rider-1-0': 'D4' }, 2: {} },
  };
  return { game, msgId };
}

describe('ORACLE-JUNDLAND-FREE-SPECIAL: native specials surface at 0 cost', () => {
  it('without the marker, Trample renders at its normal (action) cost', () => {
    const { game, msgId } = buildBanthaGame();
    const rows = getDcActionButtons(msgId, 'Bantha Rider', 'Bantha Rider [Group 1]', { selectedFigure: 0, remaining: 2 }, game, _helpers);
    const tr = _labels(rows).find((b) => /Trample/.test(b.label));
    assert.ok(tr, 'Trample special is present');
    assert.ok(!/\(free\)/.test(tr.label), 'no "(free)" tag without the marker');
  });

  it('with the marker, Trample renders at 0 cost ("(free)") and stays enabled at 0 actions', () => {
    const { game, msgId } = buildBanthaGame();
    game.freeSpecialActionPending = { 'Bantha Rider-1-0': { from: 'Jundland Terror' } };
    // 0 actions remaining — a free special must still be enabled.
    const rows = getDcActionButtons(msgId, 'Bantha Rider', 'Bantha Rider [Group 1]', { selectedFigure: 0, remaining: 0 }, game, _helpers);
    const tr = _labels(rows).find((b) => /Trample/.test(b.label));
    assert.ok(tr, 'Trample special is present');
    assert.match(tr.label, /\(free\)/, 'free special is tagged "(free)"');
    assert.equal(tr.disabled, false, 'free special enabled even with 0 actions remaining');
  });
});
