import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import {
  applyDamage,
  WHEN_DAMAGED_HOOKS,
  BEFORE_DEFEATED_HOOKS,
  WHEN_DEFEATED_HOOKS,
  _clearRegistries,
} from './damage-pipeline.js';

function _makeCtx(overrides = {}) {
  // Minimal in-memory dcHealthState mock: Map<msgId, Array<[hp, ...]>>
  const dcHealthState = new Map();
  dcHealthState.set('m1', [[5, 0]]); // 5 HP at figIndex 0
  return {
    dcHealthState,
    logGameAction: async () => {},
    client: null,
    ...overrides,
  };
}

function _opts(overrides = {}) {
  return {
    figureKey: 'fig-1',
    msgId: 'm1',
    figIndex: 0,
    amount: 2,
    controllerPlayerNum: 1,
    source: 'Test',
    ...overrides,
  };
}

describe('damage-pipeline: applyDamage', () => {
  beforeEach(() => _clearRegistries());

  it('zero amount short-circuits without touching dcHealthState', async () => {
    const ctx = _makeCtx();
    const result = await applyDamage({}, ctx, _opts({ amount: 0 }));
    assert.equal(result.amount, 0);
    assert.equal(result.wasDefeated, false);
    // HP unchanged
    assert.equal(ctx.dcHealthState.get('m1')[0][0], 5);
  });

  it('non-defeating damage applies and returns wasDefeated=false', async () => {
    const ctx = _makeCtx();
    const result = await applyDamage({}, ctx, _opts({ amount: 2 }));
    assert.equal(result.amount, 2);
    assert.equal(result.prevHp, 5);
    assert.equal(result.newHp, 3);
    assert.equal(result.wasDefeated, false);
  });

  it('defeating damage applies and returns wasDefeated=true', async () => {
    const ctx = _makeCtx();
    const result = await applyDamage({}, ctx, _opts({ amount: 5 }));
    assert.equal(result.wasDefeated, true);
    assert.equal(result.newHp, 0);
  });

  it('overkill damage applies and returns wasDefeated=true', async () => {
    const ctx = _makeCtx();
    const result = await applyDamage({}, ctx, _opts({ amount: 99 }));
    assert.equal(result.wasDefeated, true);
    assert.equal(result.newHp, 0);
  });

  it('WHEN_DAMAGED hook can modify amount', async () => {
    WHEN_DAMAGED_HOOKS.push({
      id: 'halve-damage',
      probe: () => true,
      apply: async (_g, opts) => ({ amount: Math.floor(opts.amount / 2) }),
    });
    const ctx = _makeCtx();
    const result = await applyDamage({}, ctx, _opts({ amount: 4 }));
    assert.equal(result.amount, 2);
    assert.equal(result.newHp, 3);
  });

  it('WHEN_DAMAGED hook reducing to 0 short-circuits damage application', async () => {
    WHEN_DAMAGED_HOOKS.push({
      id: 'nullify',
      probe: () => true,
      apply: async () => ({ amount: 0 }),
    });
    const ctx = _makeCtx();
    const result = await applyDamage({}, ctx, _opts({ amount: 5 }));
    assert.equal(result.amount, 0);
    assert.equal(result.wasDefeated, false);
    assert.equal(ctx.dcHealthState.get('m1')[0][0], 5);
  });

  it('BEFORE_DEFEATED hook fires only when would-be HP is 0', async () => {
    let fired = false;
    BEFORE_DEFEATED_HOOKS.push({
      id: 'spy',
      probe: () => true,
      apply: async () => { fired = true; },
    });
    const ctx = _makeCtx();
    // Non-defeating damage — hook should NOT fire
    await applyDamage({}, ctx, _opts({ amount: 2 }));
    assert.equal(fired, false);
    // Defeating damage — hook fires
    await applyDamage({}, ctx, _opts({ amount: 5 }));
    assert.equal(fired, true);
  });

  it('BEFORE_DEFEATED hook can prevent defeat', async () => {
    BEFORE_DEFEATED_HOOKS.push({
      id: 'second-chance',
      probe: () => true,
      apply: async () => ({ preventDefeat: true }),
    });
    const ctx = _makeCtx();
    const result = await applyDamage({}, ctx, _opts({ amount: 5 }));
    assert.equal(result.wasDefeated, false);
    assert.equal(result.preventDefeat, true);
    // HP unchanged because reduceHp was skipped
    assert.equal(ctx.dcHealthState.get('m1')[0][0], 5);
  });

  it('WHEN_DEFEATED hook fires only on actual defeat', async () => {
    let firedCount = 0;
    WHEN_DEFEATED_HOOKS.push({
      id: 'celebration',
      probe: () => true,
      apply: async () => { firedCount += 1; },
    });
    const ctx = _makeCtx();
    // Non-defeating
    await applyDamage({}, ctx, _opts({ amount: 2 }));
    assert.equal(firedCount, 0);
    // Defeating
    await applyDamage({}, ctx, _opts({ amount: 5 }));
    assert.equal(firedCount, 1);
  });

  it('WHEN_DEFEATED hook does NOT fire when defeat is prevented by BEFORE_DEFEATED', async () => {
    let whenDefeatedFired = false;
    BEFORE_DEFEATED_HOOKS.push({
      id: 'deny',
      probe: () => true,
      apply: async () => ({ preventDefeat: true }),
    });
    WHEN_DEFEATED_HOOKS.push({
      id: 'celebration',
      probe: () => true,
      apply: async () => { whenDefeatedFired = true; },
    });
    const ctx = _makeCtx();
    await applyDamage({}, ctx, _opts({ amount: 5 }));
    assert.equal(whenDefeatedFired, false);
  });

  it('hook ordering preserves registration order', async () => {
    const calls = [];
    WHEN_DAMAGED_HOOKS.push({ id: 'a', probe: () => true, apply: async () => { calls.push('a'); } });
    WHEN_DAMAGED_HOOKS.push({ id: 'b', probe: () => true, apply: async () => { calls.push('b'); } });
    const ctx = _makeCtx();
    await applyDamage({}, ctx, _opts({ amount: 1 }));
    assert.deepEqual(calls, ['a', 'b']);
  });

  it('throwing WHEN_DEFEATED hook does not break the pipeline', async () => {
    WHEN_DEFEATED_HOOKS.push({
      id: 'bad',
      probe: () => true,
      apply: async () => { throw new Error('boom'); },
    });
    const ctx = _makeCtx();
    const result = await applyDamage({}, ctx, _opts({ amount: 5 }));
    assert.equal(result.wasDefeated, true);
  });

  it('viaStrain flag is propagated to hooks', async () => {
    let seenViaStrain = null;
    WHEN_DAMAGED_HOOKS.push({
      id: 'observe',
      probe: () => true,
      apply: async (_g, opts) => { seenViaStrain = opts.viaStrain; },
    });
    const ctx = _makeCtx();
    await applyDamage({}, ctx, _opts({ amount: 1, viaStrain: true }));
    assert.equal(seenViaStrain, true);
  });

  it('rejects opts missing figureKey or msgId', async () => {
    const ctx = _makeCtx();
    await assert.rejects(applyDamage({}, ctx, { figureKey: '', msgId: 'm', figIndex: 0, amount: 1 }));
    await assert.rejects(applyDamage({}, ctx, { figureKey: 'f', msgId: '', figIndex: 0, amount: 1 }));
  });
});
