// Command-Card detection in the attack gate windows (alexanbv 2026-06-16):
// a CC gets a button iff it is IN HAND for that side's player AND the attacking
// (resp. defending) figure satisfies the card's playableBy restriction. Third-
// party-figure CCs (Guardian Stance, Concentrated Fire, …) are excluded here.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import './combat-mods-gate.js';
import { abilitiesForWindow, getCombatAbility } from './combat-timing-registry.js';

const namesAt = (window, side, game, combat) =>
  abilitiesForWindow(window, side, game, combat, {}).map((a) => a.name);

describe('CC detection in the on_declare/mods gate', () => {
  it('offers in-hand attacker CCs whose playableBy matches the attacking figure', () => {
    const game = {
      player1CcHand: ['Wild Attack', 'Tools for the Job', 'Marksman', 'Heightened Reflexes'],
      figurePositions: { 1: { 'HK Assassin Droid (Elite)-1-0': 'a1' } },
    };
    const combat = { attackerPlayerNum: 1, attackerFigureKey: 'HK Assassin Droid (Elite)-1-0', attackerDcName: 'HK Assassin Droid (Elite)' };
    const names = namesAt('on_declare', 'attacker', game, combat);
    assert.ok(names.includes('Wild Attack'), 'Wild Attack (Any Figure) offered');
    assert.ok(names.includes('Tools for the Job'), 'Tools for the Job (HUNTER — HK is a HUNTER) offered');
    assert.ok(names.includes('Marksman'), 'Marksman (Any Figure) offered');
    assert.ok(!names.includes('Heightened Reflexes'), 'Heightened Reflexes is a mods card, not on_declare');
  });

  it('does NOT offer a CC that is not in hand', () => {
    const game = { player1CcHand: ['Marksman'], figurePositions: { 1: { 'HK Assassin Droid (Elite)-1-0': 'a1' } } };
    const combat = { attackerPlayerNum: 1, attackerFigureKey: 'HK Assassin Droid (Elite)-1-0', attackerDcName: 'HK Assassin Droid (Elite)' };
    assert.ok(!namesAt('on_declare', 'attacker', game, combat).includes('Wild Attack'));
  });

  it('does NOT offer a trait-restricted CC the attacking figure fails (Stormtrooper is not a HUNTER)', () => {
    const game = { player1CcHand: ['Tools for the Job'], figurePositions: { 1: { 'Stormtrooper-1-0': 'a1' } } };
    const combat = { attackerPlayerNum: 1, attackerFigureKey: 'Stormtrooper-1-0', attackerDcName: 'Stormtrooper' };
    assert.ok(!namesAt('on_declare', 'attacker', game, combat).includes('Tools for the Job'));
  });

  it('defender pool-add CCs are offered on the defender side at on_declare (Stealth Tactics needs a small defender)', () => {
    const game = { player2CcHand: ['Stealth Tactics'], figurePositions: { 2: { 'Darth Vader-2-0': 'b1' } } };
    const combat = { attackerPlayerNum: 1, defenderPlayerNum: 2, target: { figureKey: 'Darth Vader-2-0' }, defenderDcName: 'Darth Vader' };
    // Vader is 1x1 (small) → Stealth Tactics (Any Small Figure) offered.
    assert.ok(namesAt('on_declare', 'defender', game, combat).includes('Stealth Tactics'));
  });

  it('a small-only CC is NOT offered when the defending figure is large', () => {
    const game = { player2CcHand: ['Stealth Tactics'], figurePositions: { 2: { 'Nexu (Elite)-2-0': 'b1' } } };
    const combat = { attackerPlayerNum: 1, defenderPlayerNum: 2, target: { figureKey: 'Nexu (Elite)-2-0' }, defenderDcName: 'Nexu (Elite)' };
    assert.ok(!namesAt('on_declare', 'defender', game, combat).includes('Stealth Tactics'));
  });

  it('third-party-figure CCs (Concentrated Fire) are NOT wired as executable attacker/defender CCs', () => {
    // The exception skip prevents an executable CC entry; only a timing-only
    // catalog entry may remain (never offered as a playable button).
    const cf = getCombatAbility('csv:concentrated_fire:on_declare:attacker');
    assert.ok(!cf || (cf.timingOnly === true && cf.params?.kind !== 'cc'), 'Concentrated Fire must not be an executable CC');
  });
});
