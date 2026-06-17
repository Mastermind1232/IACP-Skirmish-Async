/**
 * Exhaust attacker-attachment bonus abilities (Scavenged Weaponry, Explosive
 * Armaments, Feeding Frenzy) — alexanbv 2026-06-17. Previously DOUBLE-handled
 * (eager auto-apply at declaration + a no-op `unwired` gate button). Now a single
 * executable gate ability per window: offered only while READY, applied on use,
 * exhausting the card (params.exhaustOnUse). The eager handlers were removed.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import '../../../src/engine/combat-mods-gate.js';
import { getCombatAbility } from '../../../src/engine/combat-timing-registry.js';

function combat() {
  return { attackerPlayerNum: 1, attackerFigureKey: 'Bossk-1-0', attackerMsgId: 'm1' };
}

describe('Exhaust bonus abilities overwrite the unwired no-op and gate on readiness', () => {
  it('Scavenged Weaponry (on_declare) is a real exhaust_bonus, offered only while ready', () => {
    const ab = getCombatAbility('csv:scavenged_weaponry:on_declare:attacker');
    assert.ok(ab, 'registered');
    assert.equal(ab.params.kind, 'exhaust_bonus', 'overwrote the unwired no-op');
    assert.equal(ab.params.exhaustOnUse, 'Scavenged Weaponry');
    assert.equal(ab.timingOnly, false, 'executable');
    const game = { p1DcAttachments: { m1: ['Scavenged Weaponry'] }, exhaustedSkirmishUpgrades: {} };
    assert.equal(ab.applies(game, combat(), 'attacker', {}), true, 'ready → offered');
    game.exhaustedSkirmishUpgrades.m1 = ['Scavenged Weaponry'];
    assert.equal(ab.applies(game, combat(), 'attacker', {}), false, 'exhausted → not offered');
  });

  it('Explosive Armaments (mods) is a real exhaust_bonus', () => {
    const ab = getCombatAbility('csv:explosive_armaments:mods:attacker');
    assert.equal(ab.params.kind, 'exhaust_bonus');
    assert.equal(ab.params.effect, 'blast');
  });

  it('Feeding Frenzy (mods) requires a damaged target', () => {
    const ab = getCombatAbility('csv:feeding_frenzy:mods:attacker');
    assert.equal(ab.params.kind, 'exhaust_bonus');
    const game = { p1DcAttachments: { m1: ['Feeding Frenzy'] }, exhaustedSkirmishUpgrades: {} };
    const c = { ...combat(), target: { msgId: 'd1', figureKey: 'Stormtrooper-2-0' } };
    // No health state → target not known-damaged → not offered.
    assert.equal(ab.applies(game, c, 'attacker', { dcHealthState: new Map() }), false, 'undamaged target → not offered');
    // Damaged target (current < max) → offered.
    const deps = { dcHealthState: new Map([['d1', [[3, 5]]]]) };
    assert.equal(ab.applies(game, c, 'attacker', deps), true, 'damaged target → offered');
  });
});
