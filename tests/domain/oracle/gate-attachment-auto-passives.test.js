/**
 * Automatic attachment mods passives migrated off the eager declaration path to
 * real gate passives (combat-abilities-attachment-auto.js + _fireModsPassive).
 * alexanbv 2026-06-17 step 2: "migrate the eager automatic abilities to gate
 * passives." Each is gated on the attachment being on the side's own figure and
 * applies its bonus when fired in the modifiers window.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import '../../../src/engine/combat-mods-gate.js';
import { getCombatAbility } from '../../../src/engine/combat-timing-registry.js';
import { _fireModsPassive } from '../../../src/handlers/combat.js';

const thread = { send: async () => ({}) };

describe('Automatic attachment mods passives (gate-fired, not eager)', () => {
  it('Driven by Hatred: passive, attacker-attachment-gated, +1 Hit', async () => {
    const ab = getCombatAbility('driven_by_hatred_hit');
    assert.ok(ab); assert.equal(ab.kind, 'passive'); assert.equal(ab.timingOnly, false);
    const game = { p1DcAttachments: { m1: ['Driven by Hatred'] } };
    const combat = { attackerMsgId: 'm1', attackerPlayerNum: 1 };
    assert.equal(ab.applies(game, combat), true, 'offered when attached');
    assert.equal(ab.applies({ p1DcAttachments: { m1: [] } }, combat), false, 'not when absent');
    const c = { bonusHits: 0 };
    await _fireModsPassive('attacker', 'driven_by_hatred_hit', thread, game, c, {});
    assert.equal(c.bonusHits, 1);
  });

  it('Wookiee Avenger: +1 Hit while attacking', async () => {
    const c = { bonusHits: 2 };
    await _fireModsPassive('attacker', 'wookiee_avenger_hit', thread, {}, c, {});
    assert.equal(c.bonusHits, 3);
  });

  it('Combat Suit: defender-attachment-gated, reduces Pierce by 1', async () => {
    const ab = getCombatAbility('combat_suit_reduce_pierce');
    assert.equal(ab.side, 'defender');
    const game = { p2DcAttachments: { d1: ['Combat Suit'] } };
    const combat = { target: { msgId: 'd1' } };
    assert.equal(ab.applies(game, combat), true);
    const c = { defenderReducePierce: 0 };
    await _fireModsPassive('defender', 'combat_suit_reduce_pierce', thread, game, c, {});
    assert.equal(c.defenderReducePierce, 1);
  });
});
