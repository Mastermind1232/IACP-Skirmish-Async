/**
 * PROBE-SNIPER: Alliance Ranger (Regular/Elite)'s **Sniper** /
 * **Elite Sniper**.
 *
 * Card text (Regular): "While attacking, if the target space is 5 or
 *  more spaces away, you reroll 1 attack die."
 * Card text (Elite): same gate, reroll 2 attack dice.
 *
 * Covers two atoms: sniper + elite_sniper. Pure helpers extracted
 * from src/handlers/combat.js:1893.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  hasSniperAbility,
  hasEliteSniperAbility,
  sniperGateOpen,
  applySniperRerolls,
  SNIPER_ABILITY_ID,
  ELITE_SNIPER_ABILITY_ID,
  SNIPER_MIN_DISTANCE,
  SNIPER_REROLLS,
  ELITE_SNIPER_REROLLS,
} from '../../../src/game/sniper-helpers.js';

describe('PROBE-SNIPER-001: constants', () => {
  it('ability ids', () => {
    assert.equal(SNIPER_ABILITY_ID, 'sniper');
    assert.equal(ELITE_SNIPER_ABILITY_ID, 'elite_sniper');
  });
  it('min distance = 5', () => {
    assert.equal(SNIPER_MIN_DISTANCE, 5);
  });
  it('reroll counts', () => {
    assert.equal(SNIPER_REROLLS, 1);
    assert.equal(ELITE_SNIPER_REROLLS, 2);
  });
});

describe('PROBE-SNIPER-002: predicates', () => {
  it('reg slug → has sniper, not elite', () => {
    assert.equal(hasSniperAbility(['sniper']), true);
    assert.equal(hasEliteSniperAbility(['sniper']), false);
  });
  it('elite slug → has elite, not reg', () => {
    assert.equal(hasEliteSniperAbility(['elite_sniper']), true);
    assert.equal(hasSniperAbility(['elite_sniper']), false);
  });
  it('non-array → false', () => {
    assert.equal(hasSniperAbility(null), false);
    assert.equal(hasEliteSniperAbility('elite_sniper'), false);
  });
});

describe('PROBE-SNIPER-003: sniperGateOpen (distance gate)', () => {
  it('<5 → closed', () => {
    assert.equal(sniperGateOpen(0), false);
    assert.equal(sniperGateOpen(4), false);
  });
  it('=5 → open', () => {
    assert.equal(sniperGateOpen(5), true);
  });
  it('>5 → open', () => {
    assert.equal(sniperGateOpen(99), true);
  });
  it('non-number → closed', () => {
    assert.equal(sniperGateOpen(null), false);
    assert.equal(sniperGateOpen('5'), false);
  });
});

describe('PROBE-SNIPER-004: applySniperRerolls math', () => {
  it('reg: zero existing → +1 reroll', () => {
    assert.deepStrictEqual(applySniperRerolls({ rerollOneAttackDie: 0 }, false), {
      applied: true,
      rerollOneAttackDie: 1,
    });
  });
  it('elite: zero existing → +2 rerolls', () => {
    assert.deepStrictEqual(applySniperRerolls({ rerollOneAttackDie: 0 }, true), {
      applied: true,
      rerollOneAttackDie: 2,
    });
  });
  it('stacks on existing reroll bonus', () => {
    assert.deepStrictEqual(applySniperRerolls({ rerollOneAttackDie: 3 }, false), {
      applied: true,
      rerollOneAttackDie: 4,
    });
    assert.deepStrictEqual(applySniperRerolls({ rerollOneAttackDie: 3 }, true), {
      applied: true,
      rerollOneAttackDie: 5,
    });
  });
  it('defaults / null → treated as 0', () => {
    assert.deepStrictEqual(applySniperRerolls(), { applied: true, rerollOneAttackDie: 1 });
    assert.deepStrictEqual(applySniperRerolls({ rerollOneAttackDie: null }, true), {
      applied: true,
      rerollOneAttackDie: 2,
    });
  });
  it('pure: no mutation', () => {
    const input = { rerollOneAttackDie: 7 };
    applySniperRerolls(input, true);
    assert.deepStrictEqual(input, { rerollOneAttackDie: 7 });
  });
});

describe('PROBE-SNIPER-005: library + dc-effects wiring', () => {
  it('sniper library entry wired', async () => {
    const { readFile } = await import('node:fs/promises');
    const lib = JSON.parse(
      await readFile(new URL('../../../data/ability-library.json', import.meta.url), 'utf8'),
    );
    const e = lib.abilities?.sniper;
    assert.ok(e);
    assert.equal(e.wiredStatus, 'wired');
    assert.match(e.label || '', /Sniper/i);
  });
  it('elite_sniper library entry wired', async () => {
    const { readFile } = await import('node:fs/promises');
    const lib = JSON.parse(
      await readFile(new URL('../../../data/ability-library.json', import.meta.url), 'utf8'),
    );
    const e = lib.abilities?.elite_sniper;
    assert.ok(e);
    assert.equal(e.wiredStatus, 'wired');
  });
  it('Alliance Ranger (Regular) references sniper', async () => {
    const { readFile } = await import('node:fs/promises');
    const effects = JSON.parse(
      await readFile(new URL('../../../data/dc-effects.json', import.meta.url), 'utf8'),
    );
    const dc = effects.cards?.['Alliance Ranger (Regular)'];
    assert.ok(dc);
    assert.ok((dc.specialAbilityIds || []).includes('sniper'));
  });
  it('Alliance Ranger (Elite) references elite_sniper', async () => {
    const { readFile } = await import('node:fs/promises');
    const effects = JSON.parse(
      await readFile(new URL('../../../data/dc-effects.json', import.meta.url), 'utf8'),
    );
    const dc = effects.cards?.['Alliance Ranger (Elite)'];
    assert.ok(dc);
    assert.ok((dc.specialAbilityIds || []).includes('elite_sniper'));
  });
});
