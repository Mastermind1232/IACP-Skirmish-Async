import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  enqueueAfterAttackEffect,
  getAfterAttackEffects,
  consumeAfterAttackEffect,
  hasPendingAfterAttackEffects,
  clearAfterAttackEffects,
} from './after-attack-queue.js';

function _combat() { return { gameId: 'g1' }; }

describe('after-attack-queue: data shape + mutators', () => {
  it('enqueue assigns a stable id and persists side/type/label', () => {
    const c = _combat();
    const id = enqueueAfterAttackEffect(c, {
      side: 'attacker', type: 'blast', label: 'Apply Blast 2',
    });
    assert.match(id, /^aaq_g1_/);
    assert.equal(c.afterAttackEffects.length, 1);
    const e = c.afterAttackEffects[0];
    assert.equal(e.id, id);
    assert.equal(e.side, 'attacker');
    assert.equal(e.type, 'blast');
    assert.equal(e.label, 'Apply Blast 2');
  });

  it('rejects invalid side', () => {
    const c = _combat();
    assert.throws(() => enqueueAfterAttackEffect(c, { side: 'neutral', type: 'x', label: 'l' }));
  });

  it('rejects missing required fields', () => {
    const c = _combat();
    assert.throws(() => enqueueAfterAttackEffect(c, { side: 'attacker', type: 'blast' }));
    assert.throws(() => enqueueAfterAttackEffect(c, { side: 'attacker', label: 'x' }));
    assert.throws(() => enqueueAfterAttackEffect(c, { type: 'blast', label: 'x' }));
  });

  it('getAfterAttackEffects partitions by side, preserves insertion order', () => {
    const c = _combat();
    enqueueAfterAttackEffect(c, { side: 'attacker', type: 'blast', label: 'B' });
    enqueueAfterAttackEffect(c, { side: 'defender', type: 'slippery', label: 'S' });
    enqueueAfterAttackEffect(c, { side: 'attacker', type: 'recover', label: 'R' });
    const atk = getAfterAttackEffects(c, 'attacker');
    assert.equal(atk.length, 2);
    assert.deepEqual(atk.map(e => e.type), ['blast', 'recover']);
    const def = getAfterAttackEffects(c, 'defender');
    assert.equal(def.length, 1);
    assert.equal(def[0].type, 'slippery');
  });

  it('consume removes by id and returns the entry', () => {
    const c = _combat();
    const id1 = enqueueAfterAttackEffect(c, { side: 'attacker', type: 'blast', label: 'B' });
    const id2 = enqueueAfterAttackEffect(c, { side: 'attacker', type: 'cleave', label: 'C' });
    const removed = consumeAfterAttackEffect(c, id1);
    assert.equal(removed.id, id1);
    assert.equal(c.afterAttackEffects.length, 1);
    assert.equal(c.afterAttackEffects[0].id, id2);
  });

  it('consume returns null for unknown id', () => {
    const c = _combat();
    enqueueAfterAttackEffect(c, { side: 'attacker', type: 'blast', label: 'B' });
    assert.equal(consumeAfterAttackEffect(c, 'aaq_nope'), null);
  });

  it('hasPending returns false on empty queue and true once enqueued', () => {
    const c = _combat();
    assert.equal(hasPendingAfterAttackEffects(c, 'attacker'), false);
    enqueueAfterAttackEffect(c, { side: 'attacker', type: 'blast', label: 'B' });
    assert.equal(hasPendingAfterAttackEffects(c, 'attacker'), true);
    assert.equal(hasPendingAfterAttackEffects(c, 'defender'), false);
  });

  it('clear drains the queue entirely', () => {
    const c = _combat();
    enqueueAfterAttackEffect(c, { side: 'attacker', type: 'blast', label: 'B' });
    enqueueAfterAttackEffect(c, { side: 'defender', type: 'slippery', label: 'S' });
    clearAfterAttackEffects(c);
    assert.equal(c.afterAttackEffects.length, 0);
  });

  it('respects caller-provided id (allows deterministic correlation)', () => {
    const c = _combat();
    const id = enqueueAfterAttackEffect(c, {
      id: 'caller_blast_1', side: 'attacker', type: 'blast', label: 'B',
    });
    assert.equal(id, 'caller_blast_1');
    assert.equal(c.afterAttackEffects[0].id, 'caller_blast_1');
  });
});
