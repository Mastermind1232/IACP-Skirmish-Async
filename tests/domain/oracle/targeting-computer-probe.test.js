/**
 * PROBE-TARGETING-COMPUTER: family +1 attacker reroll.
 *
 * Covers seven atoms:
 *   - targeting_computer_hk_elite (HK Assassin Droid Elite)
 *   - targeting_computer_ig11 (IG-11)
 *   - targeting_computer_probe_elite (Probe Droid Elite)
 *   - targeting_computer_sentry_elite (Sentry Droid Elite)
 *   - targeting_computer_sentry_reg (Sentry Droid Regular)
 *   - targeting_computer_atst (AT-ST)
 *   - adv_targeting_computer_dark_trooper (Dark Trooper Mk III)
 *
 * Pure helpers extracted from src/handlers/combat.js:2691. Scope is
 * the +1 reroll bump only. ATC's Focused + defender-reroll extras
 * live at combat.js:1755 and :3373 and are not in scope here.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  hasTargetingComputerAbility,
  applyTargetingComputerReroll,
  TARGETING_COMPUTER_ABILITY_IDS,
  TARGETING_COMPUTER_REROLL,
} from '../../../src/game/targeting-computer-helpers.js';

const EXPECTED_IDS = [
  'targeting_computer_hk_elite',
  'targeting_computer_hk_reg',
  'targeting_computer_ig11',
  'targeting_computer_probe_elite',
  'targeting_computer_sentry_elite',
  'targeting_computer_sentry_reg',
  'targeting_computer_atst',
  'adv_targeting_computer_dark_trooper',
];

const EXPECTED_DCS = [
  ['targeting_computer_hk_elite', 'HK Assassin Droid (Elite)'],
  ['targeting_computer_ig11', 'IG-11'],
  ['targeting_computer_probe_elite', 'Probe Droid (Elite)'],
  ['targeting_computer_sentry_elite', 'Sentry Droid (Elite)'],
  ['targeting_computer_sentry_reg', 'Sentry Droid (Regular)'],
  ['targeting_computer_atst', 'AT-ST'],
  ['adv_targeting_computer_dark_trooper', 'Dark Trooper Mk III'],
];

describe('PROBE-TC-001: constants', () => {
  it('id set is frozen and covers all 8 members', () => {
    assert.deepStrictEqual([...TARGETING_COMPUTER_ABILITY_IDS].sort(), [...EXPECTED_IDS].sort());
    assert.ok(Object.isFrozen(TARGETING_COMPUTER_ABILITY_IDS));
  });
  it('reroll = 1', () => {
    assert.equal(TARGETING_COMPUTER_REROLL, 1);
  });
});

describe('PROBE-TC-002: hasTargetingComputerAbility', () => {
  for (const id of EXPECTED_IDS) {
    it(`${id} → true`, () => {
      assert.equal(hasTargetingComputerAbility([id]), true);
    });
  }
  it('mixed with unrelated → still true', () => {
    assert.equal(hasTargetingComputerAbility(['focus', 'targeting_computer_ig11']), true);
  });
  it('unrelated → false', () => {
    assert.equal(hasTargetingComputerAbility(['focus']), false);
    assert.equal(hasTargetingComputerAbility([]), false);
  });
  it('non-array → false', () => {
    assert.equal(hasTargetingComputerAbility(null), false);
    assert.equal(hasTargetingComputerAbility('targeting_computer_ig11'), false);
  });
});

describe('PROBE-TC-003: applyTargetingComputerReroll', () => {
  it('zero existing → 1', () => {
    assert.equal(applyTargetingComputerReroll(0), 1);
  });
  it('stacks on existing (e.g. other reroll-granting ability)', () => {
    assert.equal(applyTargetingComputerReroll(3), 4);
  });
  it('null / undefined → treated as 0', () => {
    assert.equal(applyTargetingComputerReroll(null), 1);
    assert.equal(applyTargetingComputerReroll(), 1);
  });
});

describe('PROBE-TC-004: library + dc-effects wiring', () => {
  for (const id of EXPECTED_IDS) {
    it(`${id} library entry wired`, async () => {
      const { readFile } = await import('node:fs/promises');
      const lib = JSON.parse(
        await readFile(new URL('../../../data/ability-library.json', import.meta.url), 'utf8'),
      );
      const e = lib.abilities?.[id];
      assert.ok(e, `${id} library entry must exist`);
      assert.equal(e.wiredStatus, 'wired');
      assert.match(e.label || '', /Targeting Computer/i);
    });
  }
  for (const [id, dcName] of EXPECTED_DCS) {
    it(`${dcName} references ${id}`, async () => {
      const { readFile } = await import('node:fs/promises');
      const effects = JSON.parse(
        await readFile(new URL('../../../data/dc-effects.json', import.meta.url), 'utf8'),
      );
      const dc = effects.cards?.[dcName];
      assert.ok(dc, `${dcName} DC must exist`);
      assert.ok((dc.specialAbilityIds || []).includes(id));
    });
  }
});
