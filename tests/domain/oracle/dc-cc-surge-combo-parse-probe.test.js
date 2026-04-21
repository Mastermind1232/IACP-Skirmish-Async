/**
 * Oracle: parseSurgeEffect correctly composes the three multi-effect surge
 * library keys that are data-driven only (library entries carry label but no
 * structured fields — all composition happens at runtime).
 *
 * Covers DC-CC ledger atoms:
 *   - SURGE-ACCURACY-2-DAMAGE-2  → "accuracy 2, damage 2"
 *   - SURGE-DAMAGE-1-ACCURACY-1  → "damage 1, accuracy 1"
 *   - SURGE-PIERCE-1-HIDE        → "pierce 1, hide"
 *
 * Implementation site: src/game/combat.js parseSurgeEffect — comma-splits the
 * key then applies each primitive (damage / accuracy / pierce / self-hide)
 * additively. Library key is parsed, never dispatched by literal match.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { parseSurgeEffect } from '../../../src/game/combat.js';

describe('parseSurgeEffect — comma-composed surge library keys', () => {
  it('accuracy 2, damage 2 → +2 accuracy AND +2 damage (additive)', () => {
    const r = parseSurgeEffect('accuracy 2, damage 2');
    assert.equal(r.accuracy, 2);
    assert.equal(r.damage, 2);
    assert.equal(r.pierce, 0);
  });

  it('damage 1, accuracy 1 → +1 damage AND +1 accuracy', () => {
    const r = parseSurgeEffect('damage 1, accuracy 1');
    assert.equal(r.damage, 1);
    assert.equal(r.accuracy, 1);
    assert.equal(r.pierce, 0);
  });

  it('pierce 1, hide → +1 pierce AND attacker gains Hide (surgeSelfHide)', () => {
    const r = parseSurgeEffect('pierce 1, hide');
    assert.equal(r.pierce, 1);
    assert.equal(r.surgeSelfHide, true);
    assert.equal(r.damage, 0);
  });

  it('order-insensitive: same key with parts reversed gives same result', () => {
    const a = parseSurgeEffect('accuracy 2, damage 2');
    const b = parseSurgeEffect('damage 2, accuracy 2');
    assert.equal(a.accuracy, b.accuracy);
    assert.equal(a.damage, b.damage);
  });
});
