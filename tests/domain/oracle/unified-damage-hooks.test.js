/**
 * Regression: ability/CC damage (out of combat) must fire the SAME
 * WHEN_DAMAGED / WHEN_DEFEATED hooks that combat damage fires, now that
 * ALL damage routes through the one applyDamage pipeline
 * (alexanbv 2026-06-23 — "ALL damage must go through the same pipeline.
 * Absolutely no exceptions"). These tests drain queued ability damage
 * through applyDeferredAbilityEffects (combat:false) and assert the hooks
 * ran — proving the unified path is not a lesser one.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { applyDeferredAbilityEffects, _ensureHooksLoaded } from '../../../src/game/damage-pipeline.js';

describe('Unified pipeline: ability damage fires when-damaged / when-defeated hooks', () => {
  it('Self-Preservation (Hired Gun Elite) Focus fires on NON-combat ability damage', async () => {
    await _ensureHooksLoaded();
    const msgId = 'msg_hg';
    const figureKey = 'Hired Gun (Elite)-1-0';
    const dcHealthState = new Map([[msgId, [[6, 6]]]]);
    const game = {
      gameId: 'g-hooks',
      figurePositions: { 1: {}, 2: { [figureKey]: 'b2' } },
      figureConditions: {},
      p2DcMessageIds: [msgId],
      p2DcList: [{ dcName: 'Hired Gun (Elite)', healthState: [[6, 6]] }],
      // Queue 2 ability damage (out of combat) onto the figure.
      _pendingDamage: [{
        figureKey, msgId, figIndex: 0, amount: 2,
        controllerPlayerNum: 2, attackerPlayerNum: 1, source: 'test ability',
      }],
    };

    await applyDeferredAbilityEffects(game, { dcHealthState });

    // Damage applied through the unified pipeline...
    assert.deepStrictEqual(dcHealthState.get(msgId)[0], [4, 6], 'HP 6 → 4 via applyDamage');
    // ...and the WHEN_DAMAGED hook (Self-Preservation) fired even though
    // this was ability damage, not a combat attack.
    assert.ok(game.figureConditions[figureKey]?.includes('Focus'),
      'Self-Preservation Focus must fire on non-combat ability damage (unified pipeline)');
  });

  it('lethal ability damage finalizes the defeat via ctx.processFigureDefeat', async () => {
    await _ensureHooksLoaded();
    const msgId = 'msg_t';
    const figureKey = 'Stormtrooper-1-0';
    const dcHealthState = new Map([[msgId, [[2, 6]]]]);
    const game = {
      gameId: 'g-hooks2',
      figurePositions: { 1: {}, 2: { [figureKey]: 'b2' } },
      figureConditions: {},
      p2DcMessageIds: [msgId],
      p2DcList: [{ dcName: 'Stormtrooper', healthState: [[2, 6]] }],
      _pendingDamage: [{
        figureKey, msgId, figIndex: 0, amount: 3,
        controllerPlayerNum: 2, attackerPlayerNum: 1, source: 'test lethal ability',
      }],
    };
    const defeats = [];
    await applyDeferredAbilityEffects(game, {
      dcHealthState,
      processFigureDefeat: (_g, rec) => { defeats.push(rec.figureKey); },
    });

    assert.deepStrictEqual(dcHealthState.get(msgId)[0], [0, 6], 'HP 2 → 0');
    assert.ok(defeats.includes(figureKey), 'lethal ability damage finalizes the defeat via the pipeline');
  });
});
