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

  it('Heir to the Jedi: +1 Hit only on a Ranged attack', async () => {
    const ab = getCombatAbility('heir_to_the_jedi_hit');
    const game = { p1DcAttachments: { m1: ['Heir to the Jedi'] } };
    assert.equal(ab.applies(game, { attackerMsgId: 'm1', isRanged: true }), true);
    assert.equal(ab.applies(game, { attackerMsgId: 'm1', isRanged: false }), false, 'melee → no');
    const c = { bonusHits: 0 };
    await _fireModsPassive('attacker', 'heir_to_the_jedi_hit', thread, game, c, {});
    assert.equal(c.bonusHits, 1);
  });

  it('Prey on the Weak: +1 Pierce +1 Acc only when attacker costs more than target', async () => {
    const ab = getCombatAbility('prey_on_the_weak');
    const game = { p1DcAttachments: { m2: ['Prey on the Weak'] } };
    const deps = { getDcEffects: () => ({ Bossk: { cost: 10 } }) };
    assert.equal(ab.applies(game, { attackerMsgId: 'm2', attackerDcName: 'Bossk', targetStats: { cost: 5 } }, 'attacker', deps), true);
    assert.equal(ab.applies(game, { attackerMsgId: 'm2', attackerDcName: 'Bossk', targetStats: { cost: 15 } }, 'attacker', deps), false, 'pricier target → no');
    const c = { bonusPierce: 0, bonusAccuracy: 0 };
    await _fireModsPassive('attacker', 'prey_on_the_weak', thread, game, c, {});
    assert.equal(c.bonusPierce, 1);
    assert.equal(c.bonusAccuracy, 1);
  });

  it('Explosive Armaments / Feeding Frenzy grant surge abilities (FF adjacent-only)', async () => {
    const ff = getCombatAbility('feeding_frenzy_surge');
    const game = { p1DcAttachments: { m1: ['Feeding Frenzy'] } };
    assert.equal(ff.applies(game, { attackerMsgId: 'm1', distanceToTarget: 1 }), true, 'adjacent → granted');
    assert.equal(ff.applies(game, { attackerMsgId: 'm1', distanceToTarget: 3 }), false, 'ranged → not granted');
    const c = { bonusSurgeAbilities: [] };
    await _fireModsPassive('attacker', 'explosive_armaments_surge', thread, {}, c, {});
    assert.deepEqual(c.bonusSurgeAbilities, ['damage 1, blast 1']);
    await _fireModsPassive('attacker', 'feeding_frenzy_surge', thread, {}, c, {});
    assert.deepEqual(c.bonusSurgeAbilities, ['damage 1, blast 1', 'recover 2']);
  });

  it('Defender flags: Wookiee Avenger Dodge→Evade and Rogue Smuggler lose-Distracting', async () => {
    const wa = getCombatAbility('wookiee_avenger_defend');
    assert.equal(wa.side, 'defender');
    const game = { p2DcAttachments: { d1: ['Wookiee Avenger', 'Rogue Smuggler'] } };
    assert.equal(wa.applies(game, { target: { msgId: 'd1' } }), true);
    const c = {};
    await _fireModsPassive('defender', 'wookiee_avenger_defend', thread, game, c, {});
    await _fireModsPassive('defender', 'rogue_smuggler_distracting', thread, game, c, {});
    assert.equal(c.wookieeAvengerDefend, true);
    assert.equal(c.rougeSmuggler_loseDistracting, true);
  });
});
