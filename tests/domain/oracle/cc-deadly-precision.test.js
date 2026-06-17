/**
 * Deadly Precision (CC) — "Start of activation: this round, -1 Dodge to defense
 * when you attack." alexanbv 2026-06-17. Was mis-wired as +1 Accuracy; now a
 * per-player round flag + a gate mods passive that applies -1 Dodge on each of
 * that player's attacks this round.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { resolveAbility } from '../../../src/game/abilities.js';
import '../../../src/engine/combat-mods-gate.js';
import { getCombatAbility } from '../../../src/engine/combat-timing-registry.js';
import { _fireModsPassive } from '../../../src/handlers/combat.js';

const thread = { send: async () => ({}) };

describe('Deadly Precision', () => {
  it('sets a per-player round flag on play', () => {
    const game = {};
    const r = resolveAbility('Deadly Precision', { game, playerNum: 1 });
    assert.equal(r.applied, true);
    assert.deepEqual(game.deadlyPrecisionActive, { 1: true });
  });
  it('the mods passive applies only for the flagged player while attacking', () => {
    const ab = getCombatAbility('deadly_precision');
    assert.ok(ab); assert.equal(ab.side, 'attacker');
    const game = { deadlyPrecisionActive: { 1: true } };
    assert.equal(ab.applies(game, { attackerPlayerNum: 1 }), true);
    assert.equal(ab.applies(game, { attackerPlayerNum: 2 }), false, 'not the other player');
    assert.equal(ab.applies({ deadlyPrecisionActive: {} }, { attackerPlayerNum: 1 }), false, 'not when unset');
  });
  it('firing it applies -1 Dodge', async () => {
    const c = { bonusDodge: 0 };
    await _fireModsPassive('attacker', 'deadly_precision', thread, {}, c, {});
    assert.equal(c.bonusDodge, -1);
  });
});
