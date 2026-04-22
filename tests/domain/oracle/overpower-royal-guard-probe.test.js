/**
 * PROBE-OVERPOWER: Royal Guard Champion's **Overpower**.
 *
 * Card text: "While attacking, you may reroll 1 red die. While
 *  defending, you may reroll 1 black die."
 *
 * Implementation in combat.js is non-die-color-specific: +1 to the
 * attacker reroll budget on offense, +1 to the defender reroll budget
 * on defense. Pure helpers extracted from combat.js:2684.
 *
 * LATENT: the library description specifies RED (atk) and BLACK (def)
 * die colors, but the handler applies a generic-reroll bump. A future
 * IACP ruling change could require color-scoped rerolls — tripwire
 * below ensures the mismatch stays documented.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  hasOverpowerAbility,
  applyOverpowerAttackerReroll,
  applyOverpowerDefenderReroll,
  OVERPOWER_ABILITY_ID,
  OVERPOWER_REROLL,
} from '../../../src/game/overpower-helpers.js';

describe('PROBE-OVERPOWER-001: constants', () => {
  it('ability id', () => {
    assert.equal(OVERPOWER_ABILITY_ID, 'overpower');
  });
  it('reroll = 1', () => {
    assert.equal(OVERPOWER_REROLL, 1);
  });
});

describe('PROBE-OVERPOWER-002: hasOverpowerAbility', () => {
  it('slug present → true', () => {
    assert.equal(hasOverpowerAbility(['overpower']), true);
  });
  it('missing / non-array → false', () => {
    assert.equal(hasOverpowerAbility([]), false);
    assert.equal(hasOverpowerAbility(null), false);
    assert.equal(hasOverpowerAbility('overpower'), false);
  });
});

describe('PROBE-OVERPOWER-003: reroll application', () => {
  it('attacker: zero → 1', () => {
    assert.equal(applyOverpowerAttackerReroll(0), 1);
  });
  it('attacker: stacks on existing', () => {
    assert.equal(applyOverpowerAttackerReroll(2), 3);
  });
  it('defender: zero → 1', () => {
    assert.equal(applyOverpowerDefenderReroll(0), 1);
  });
  it('defender: stacks on existing', () => {
    assert.equal(applyOverpowerDefenderReroll(4), 5);
  });
  it('null / undefined → treated as 0', () => {
    assert.equal(applyOverpowerAttackerReroll(null), 1);
    assert.equal(applyOverpowerDefenderReroll(undefined), 1);
    assert.equal(applyOverpowerAttackerReroll(), 1);
  });
});

describe('PROBE-OVERPOWER-004: library + dc-effects wiring', () => {
  it('library entry wired', async () => {
    const { readFile } = await import('node:fs/promises');
    const lib = JSON.parse(
      await readFile(new URL('../../../data/ability-library.json', import.meta.url), 'utf8'),
    );
    const e = lib.abilities?.overpower;
    assert.ok(e);
    assert.equal(e.wiredStatus, 'wired');
    assert.match(e.label || '', /Overpower/i);
  });
  it('Royal Guard Champion references overpower', async () => {
    const { readFile } = await import('node:fs/promises');
    const effects = JSON.parse(
      await readFile(new URL('../../../data/dc-effects.json', import.meta.url), 'utf8'),
    );
    const dc = effects.cards?.['Royal Guard Champion'];
    assert.ok(dc);
    assert.ok((dc.specialAbilityIds || []).includes('overpower'));
  });
});

describe('LATENT-OVERPOWER: die-color not enforced', () => {
  it('LATENT: library says red/black, handler adds generic reroll — mismatch documented', async () => {
    const { readFile } = await import('node:fs/promises');
    const lib = JSON.parse(
      await readFile(new URL('../../../data/ability-library.json', import.meta.url), 'utf8'),
    );
    const desc = (lib.abilities?.overpower?.description || '').toLowerCase();
    // Tripwire: if the library text is ever rewritten to drop die-color scoping
    // (aligning with current handler behavior), this assertion fails and the
    // mismatch can be closed.
    assert.match(desc, /red die/);
    assert.match(desc, /black die/);
  });
});
