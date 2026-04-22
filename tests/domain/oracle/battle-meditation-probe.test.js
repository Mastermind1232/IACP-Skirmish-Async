/**
 * PROBE-BATTLE-MEDITATION: **Battle Meditation** (Diala Passil) /
 *  **Assassin** (BT-1).
 *
 * Card text: "While attacking, become Focused."
 *
 * Helper owns slug id, Focus + green-die parameters, and the
 * label selector (Assassin for BT-1, else Battle Meditation).
 * applyConditionWithDie call stays handler-owned.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  hasBattleMeditationAbility,
  battleMeditationLabel,
  BATTLE_MEDITATION_ABILITY_ID,
  BATTLE_MEDITATION_CONDITION,
  BATTLE_MEDITATION_BONUS_DIE,
  BATTLE_MEDITATION_ASSASSIN_DC_NAMES,
} from '../../../src/game/battle-meditation-helpers.js';

describe('PROBE-BATTLE-MEDITATION-001: constants', () => {
  it('ability id', () => {
    assert.equal(BATTLE_MEDITATION_ABILITY_ID, 'battle_meditation');
  });
  it('condition = Focus', () => {
    assert.equal(BATTLE_MEDITATION_CONDITION, 'Focus');
  });
  it('bonus die = green', () => {
    assert.equal(BATTLE_MEDITATION_BONUS_DIE, 'green');
  });
  it('assassin-label DCs list frozen and contains BT-1', () => {
    assert.ok(Object.isFrozen(BATTLE_MEDITATION_ASSASSIN_DC_NAMES));
    assert.deepStrictEqual([...BATTLE_MEDITATION_ASSASSIN_DC_NAMES], ['BT-1']);
  });
});

describe('PROBE-BATTLE-MEDITATION-002: hasBattleMeditationAbility', () => {
  it('slug present → true', () => {
    assert.equal(hasBattleMeditationAbility(['battle_meditation']), true);
  });
  it('missing / non-array → false', () => {
    assert.equal(hasBattleMeditationAbility([]), false);
    assert.equal(hasBattleMeditationAbility(null), false);
    assert.equal(hasBattleMeditationAbility('battle_meditation'), false);
  });
});

describe('PROBE-BATTLE-MEDITATION-003: battleMeditationLabel', () => {
  it('BT-1 → "Assassin"', () => {
    assert.equal(battleMeditationLabel('BT-1'), 'Assassin');
  });
  it('Diala Passil → "Battle Meditation"', () => {
    assert.equal(battleMeditationLabel('Diala Passil'), 'Battle Meditation');
  });
  it('unknown DC → "Battle Meditation" (default)', () => {
    assert.equal(battleMeditationLabel('Unknown'), 'Battle Meditation');
    assert.equal(battleMeditationLabel(undefined), 'Battle Meditation');
    assert.equal(battleMeditationLabel(null), 'Battle Meditation');
  });
});

describe('PROBE-BATTLE-MEDITATION-004: library + DC wiring', () => {
  it('library entry wired', async () => {
    const { readFile } = await import('node:fs/promises');
    const lib = JSON.parse(
      await readFile(new URL('../../../data/ability-library.json', import.meta.url), 'utf8'),
    );
    const e = lib.abilities?.battle_meditation;
    assert.ok(e);
    assert.equal(e.wiredStatus, 'wired');
  });
  it('at least two DCs reference battle_meditation (Diala + BT-1)', async () => {
    const { readFile } = await import('node:fs/promises');
    const effects = JSON.parse(
      await readFile(new URL('../../../data/dc-effects.json', import.meta.url), 'utf8'),
    );
    const refs = Object.entries(effects.cards || {}).filter(([, dc]) =>
      (dc.specialAbilityIds || []).includes('battle_meditation'),
    );
    assert.ok(refs.length >= 2, `expected ≥2 DC refs, got ${refs.length}`);
    const names = refs.map(([n]) => n);
    assert.ok(names.includes('BT-1'), 'BT-1 must reference battle_meditation');
  });
});
