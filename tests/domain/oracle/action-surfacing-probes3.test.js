/**
 * Tier 3 Legality-Oracle Probes: Action Surfacing Batch 3 (D1)
 *
 * PROBE-AS-009: DC Special blocked when remaining actions = 0
 *   a) remaining = 1 → dc_special offered
 *   b) remaining = 0 → dc_special NOT offered
 *
 * PROBE-AS-010: CC Special Action blocked when remaining actions = 0
 *   remaining = 0 → play_cc_special NOT offered (gate: data.remaining >= 1)
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createTestGame } from '../../fixtures/game-builder.js';
import { getAvailableActions } from '../../../src/engine/available-actions.js';

/** Find DC info from dcMessageMeta by player number and DC name. */
function getDcInfo(game, dcMessageMeta, playerNum, dcName) {
  for (const [msgId, meta] of dcMessageMeta) {
    if (meta.gameId !== game.gameId || meta.playerNum !== playerNum) continue;
    if (dcName && meta.dcName !== dcName) continue;
    return { msgId, meta };
  }
  return null;
}

// ── PROBE-AS-009: DC Special cost gate (remaining < cost → blocked) ──────

describe('PROBE-AS-009: DC Special blocked when remaining actions insufficient', () => {
  // Bossk has 1 special: "Indiscriminate Fire" (cost defaults to 1 via ?? 1)

  it('009a: remaining = 1 → dc_special offered for Bossk', () => {
    const { game, deps, dcMessageMeta } = createTestGame()
      .withPlayer1Army([{ dcName: 'Bossk' }])
      .withPlayer2Army([{ dcName: 'Greedo' }])
      .inRound(1)
      .build();

    const dc = getDcInfo(game, dcMessageMeta, 1, 'Bossk');
    game.dcActionsData = game.dcActionsData || {};
    game.dcActionsData[dc.msgId] = { perFigureRemaining: { 0: 1 }, figureLocked: {} };

    const actions = getAvailableActions(game, 1, deps);
    const specials = actions.filter(a => a.type === 'dc_special');

    assert.ok(specials.length > 0,
      `dc_special should be offered with remaining=1. Got types: [${actions.map(a => a.type)}]`);
    assert.ok(specials.some(a => a.params?.specialName === 'Indiscriminate Fire'),
      'Bossk Indiscriminate Fire should be available');
  });

  it('009b: remaining = 0 → dc_special NOT offered', () => {
    const { game, deps, dcMessageMeta } = createTestGame()
      .withPlayer1Army([{ dcName: 'Bossk' }])
      .withPlayer2Army([{ dcName: 'Greedo' }])
      .inRound(1)
      .build();

    const dc = getDcInfo(game, dcMessageMeta, 1, 'Bossk');
    game.dcActionsData = game.dcActionsData || {};
    game.dcActionsData[dc.msgId] = { perFigureRemaining: { 0: 0 }, figureLocked: { 0: true } };

    const actions = getAvailableActions(game, 1, deps);
    const specials = actions.filter(a => a.type === 'dc_special');

    assert.equal(specials.length, 0,
      `dc_special should be blocked with remaining=0. Got: [${specials.map(a => a.params?.specialName)}]`);
  });
});

// ── PROBE-AS-010: CC Special Action cost gate ────────────────────────────

describe('PROBE-AS-010: CC Special Action blocked when remaining = 0', () => {
  it('010: remaining = 0 → play_cc_special NOT offered', () => {
    const { game, deps, dcMessageMeta } = createTestGame()
      .withPlayer1Army([{ dcName: 'Bossk' }])
      .withPlayer2Army([{ dcName: 'Greedo' }])
      .inRound(1)
      .build();

    const dc = getDcInfo(game, dcMessageMeta, 1, 'Bossk');
    game.dcActionsData = game.dcActionsData || {};
    game.dcActionsData[dc.msgId] = { perFigureRemaining: { 0: 0 }, figureLocked: { 0: true } };

    // Mock CC special dep to return a card — but remaining=0 should block it
    const depsWithCcSpecial = {
      ...deps,
      getPlayableCcSpecialsForDc: () => ['Test Special Action Card'],
    };

    const actions = getAvailableActions(game, 1, depsWithCcSpecial);
    const ccSpecials = actions.filter(a => a.type === 'play_cc_special');

    assert.equal(ccSpecials.length, 0,
      `play_cc_special should be blocked with remaining=0 (gate: data.remaining >= 1). Got: [${actions.map(a => a.type)}]`);
  });
});
