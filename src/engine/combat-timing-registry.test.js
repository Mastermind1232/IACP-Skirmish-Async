import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import {
  TIMING_WINDOWS,
  registerCombatAbility,
  abilitiesForWindow,
  clearCombatAbilityRegistry,
  registeredAbilityCount,
  getCombatAbility,
} from './combat-timing-registry.js';

beforeEach(() => clearCombatAbilityRegistry());

describe('combat-timing-registry: canonical windows', () => {
  it('windows are the sequential set destruct specified', () => {
    assert.deepEqual(TIMING_WINDOWS, ['on_declare', 'rerolls', 'mods', 'special', 'after_resolve']);
  });
});

describe('combat-timing-registry: registration validation', () => {
  it('rejects bad window / side / kind / missing applies', () => {
    assert.throws(() => registerCombatAbility({ id: 'a', name: 'A', windows: ['nope'], side: 'attacker', kind: 'passive', applies: () => true }));
    assert.throws(() => registerCombatAbility({ id: 'a', name: 'A', windows: ['mods'], side: 'nope', kind: 'passive', applies: () => true }));
    assert.throws(() => registerCombatAbility({ id: 'a', name: 'A', windows: ['mods'], side: 'attacker', kind: 'bogus', applies: () => true }));
    assert.throws(() => registerCombatAbility({ id: 'a', name: 'A', windows: ['mods'], side: 'attacker', kind: 'passive' }));
    assert.throws(() => registerCombatAbility({ id: 'a', name: 'A', windows: [], side: 'attacker', kind: 'passive', applies: () => true }));
  });
});

describe('combat-timing-registry: the pipeline references windows, not abilities', () => {
  beforeEach(() => {
    registerCombatAbility({ id: 'atk-mod', name: 'Atk Mod', windows: ['mods'], side: 'attacker', kind: 'interactive', applies: () => true });
    registerCombatAbility({ id: 'def-mod', name: 'Def Mod', windows: ['mods'], side: 'defender', kind: 'interactive', applies: () => true });
    registerCombatAbility({ id: 'either-passive', name: 'Either Passive', windows: ['mods'], side: 'either', kind: 'passive', applies: () => true });
    registerCombatAbility({ id: 'reroll-only', name: 'Reroll', windows: ['rerolls'], side: 'attacker', kind: 'interactive', applies: () => true });
    registerCombatAbility({ id: 'conditional', name: 'Cond', windows: ['mods'], side: 'attacker', kind: 'interactive', applies: (g, c) => c.flag === true });
  });

  it('filters by window + side; either matches both sides', () => {
    const atk = abilitiesForWindow('mods', 'attacker', {}, {}).map((a) => a.id);
    assert.deepEqual(atk.sort(), ['atk-mod', 'either-passive'].sort()); // conditional excluded (flag false), reroll-only wrong window
    const def = abilitiesForWindow('mods', 'defender', {}, {}).map((a) => a.id);
    assert.deepEqual(def.sort(), ['def-mod', 'either-passive'].sort());
    assert.deepEqual(abilitiesForWindow('rerolls', 'attacker', {}, {}).map((a) => a.id), ['reroll-only']);
  });

  it('applies predicate gates eligibility by live state', () => {
    assert.equal(abilitiesForWindow('mods', 'attacker', {}, { flag: false }).find((a) => a.id === 'conditional'), undefined);
    assert.ok(abilitiesForWindow('mods', 'attacker', {}, { flag: true }).find((a) => a.id === 'conditional'));
  });
});

describe('combat-timing-registry: state-dependent kind', () => {
  it('kind function is evaluated against combat state', () => {
    registerCombatAbility({
      id: 'negotiate', name: 'Negotiate', windows: ['mods'], side: 'attacker',
      kind: (g, c) => (c.defenderVp < 2 ? 'passive' : 'interactive'),
      applies: () => true,
    });
    assert.equal(abilitiesForWindow('mods', 'attacker', {}, { defenderVp: 1 })[0].kind, 'passive');
    assert.equal(abilitiesForWindow('mods', 'attacker', {}, { defenderVp: 5 })[0].kind, 'interactive');
  });
});

describe('combat-timing-registry: bookkeeping', () => {
  it('count + lookup + clear', () => {
    registerCombatAbility({ id: 'x', name: 'X', windows: ['special'], side: 'attacker', kind: 'interactive', applies: () => true, special: 'rapid_recal' });
    assert.equal(registeredAbilityCount(), 1);
    assert.equal(getCombatAbility('x').special, 'rapid_recal');
    clearCombatAbilityRegistry();
    assert.equal(registeredAbilityCount(), 0);
  });
});
