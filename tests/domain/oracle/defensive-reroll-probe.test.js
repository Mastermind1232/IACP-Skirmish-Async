/**
 * PROBE-DEF-REROLL: **Foresight** (Darth Vader) and **Defensive
 * Stance** (Diala Passil) shared defender +1 reroll.
 *
 * Card text (Foresight): "While defending, you may reroll 1 defense die."
 * Card text (Defensive Stance): "While defending, you may reroll 1
 *  defense die. If you do, convert each Dodge result to 2 Block and
 *  1 Evade."
 *
 * Pure helpers cover only the reroll-budget bump (combat.js:2692 &
 * :2694). Defensive Stance's Dodge-conversion step is a later-phase
 * dice-mutation (combat.js:4400) and is intentionally not in scope.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  hasForesightAbility,
  hasDefensiveStanceAbility,
  applyDefensiveReroll,
  FORESIGHT_ABILITY_ID,
  DEFENSIVE_STANCE_ABILITY_ID,
  DEFENSIVE_REROLL,
} from '../../../src/game/defensive-reroll-helpers.js';

describe('PROBE-DEF-REROLL-001: constants', () => {
  it('ids', () => {
    assert.equal(FORESIGHT_ABILITY_ID, 'foresight');
    assert.equal(DEFENSIVE_STANCE_ABILITY_ID, 'defensive_stance');
  });
  it('reroll = 1', () => {
    assert.equal(DEFENSIVE_REROLL, 1);
  });
});

describe('PROBE-DEF-REROLL-002: predicates', () => {
  it('foresight slug → has Foresight only', () => {
    assert.equal(hasForesightAbility(['foresight']), true);
    assert.equal(hasDefensiveStanceAbility(['foresight']), false);
  });
  it('defensive_stance slug → has Defensive Stance only', () => {
    assert.equal(hasDefensiveStanceAbility(['defensive_stance']), true);
    assert.equal(hasForesightAbility(['defensive_stance']), false);
  });
  it('non-array / missing → false', () => {
    assert.equal(hasForesightAbility([]), false);
    assert.equal(hasForesightAbility(null), false);
    assert.equal(hasDefensiveStanceAbility('defensive_stance'), false);
  });
});

describe('PROBE-DEF-REROLL-003: reroll application', () => {
  it('zero existing → 1', () => {
    assert.equal(applyDefensiveReroll(0), 1);
  });
  it('stacks on existing', () => {
    assert.equal(applyDefensiveReroll(3), 4);
  });
  it('null / undefined → treated as 0', () => {
    assert.equal(applyDefensiveReroll(null), 1);
    assert.equal(applyDefensiveReroll(), 1);
  });
});

describe('PROBE-DEF-REROLL-004: library + dc-effects wiring', () => {
  it('foresight library entry wired', async () => {
    const { readFile } = await import('node:fs/promises');
    const lib = JSON.parse(
      await readFile(new URL('../../../data/ability-library.json', import.meta.url), 'utf8'),
    );
    const e = lib.abilities?.foresight;
    assert.ok(e);
    assert.equal(e.wiredStatus, 'wired');
    assert.match(e.label || '', /Foresight/i);
  });
  it('defensive_stance library entry wired', async () => {
    const { readFile } = await import('node:fs/promises');
    const lib = JSON.parse(
      await readFile(new URL('../../../data/ability-library.json', import.meta.url), 'utf8'),
    );
    const e = lib.abilities?.defensive_stance;
    assert.ok(e);
    assert.equal(e.wiredStatus, 'wired');
  });
  it('Darth Vader references foresight', async () => {
    const { readFile } = await import('node:fs/promises');
    const effects = JSON.parse(
      await readFile(new URL('../../../data/dc-effects.json', import.meta.url), 'utf8'),
    );
    const dc = effects.cards?.['Darth Vader'];
    assert.ok(dc);
    assert.ok((dc.specialAbilityIds || []).includes('foresight'));
  });
  it('Diala Passil references defensive_stance', async () => {
    const { readFile } = await import('node:fs/promises');
    const effects = JSON.parse(
      await readFile(new URL('../../../data/dc-effects.json', import.meta.url), 'utf8'),
    );
    const dc = effects.cards?.['Diala Passil'];
    assert.ok(dc);
    assert.ok((dc.specialAbilityIds || []).includes('defensive_stance'));
  });
});
