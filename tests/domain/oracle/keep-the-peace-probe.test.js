/**
 * PROBE-KEEP-THE-PEACE: Imperial Royal Guard (Elite/Regular).
 *
 * Card text:
 *   Elite: "When a hostile figure attacks a space adjacent to you,
 *    the attacker suffers 1 Strain." (auto, 1/round)
 *   Regular: "...you may suffer 1 Strain. If you do, the attacker
 *    suffers 1 Strain." (opt-in reminder)
 *
 * Helper owns predicate + round-scoped usage key.
 *
 * LATENT: the handler's Regular branch suppresses the reminder
 * when the target figure has the GUARDIAN keyword; the card text
 * has no such restriction. Tracked via LATENT-KTP-REG-GUARDIAN.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  hasKtpEliteAbility,
  hasKtpRegularAbility,
  buildKtpRoundKey,
  isKtpAlreadyUsed,
  KTP_ELITE_ABILITY_ID,
  KTP_REGULAR_ABILITY_ID,
  KTP_STRAIN_AMOUNT,
} from '../../../src/game/keep-the-peace-helpers.js';

describe('PROBE-KTP-001: constants', () => {
  it('ability ids', () => {
    assert.equal(KTP_ELITE_ABILITY_ID, 'keep_the_peace_elite');
    assert.equal(KTP_REGULAR_ABILITY_ID, 'keep_the_peace_regular');
  });
  it('strain = 1', () => {
    assert.equal(KTP_STRAIN_AMOUNT, 1);
  });
});

describe('PROBE-KTP-002: predicates', () => {
  it('elite slug → elite-only', () => {
    assert.equal(hasKtpEliteAbility(['keep_the_peace_elite']), true);
    assert.equal(hasKtpRegularAbility(['keep_the_peace_elite']), false);
  });
  it('regular slug → regular-only', () => {
    assert.equal(hasKtpRegularAbility(['keep_the_peace_regular']), true);
    assert.equal(hasKtpEliteAbility(['keep_the_peace_regular']), false);
  });
  it('missing / non-array → false', () => {
    assert.equal(hasKtpEliteAbility([]), false);
    assert.equal(hasKtpRegularAbility(null), false);
    assert.equal(hasKtpEliteAbility('keep_the_peace_elite'), false);
  });
});

describe('PROBE-KTP-003: round key + usage gate', () => {
  it('key format DCNAME_ktp_ROUND', () => {
    assert.equal(buildKtpRoundKey('Royal Guard (Elite)', 3), 'Royal Guard (Elite)_ktp_3');
  });
  it('defaults round 0 when falsy', () => {
    assert.equal(buildKtpRoundKey('X', 0), 'X_ktp_0');
    assert.equal(buildKtpRoundKey('X', null), 'X_ktp_0');
    assert.equal(buildKtpRoundKey('X', undefined), 'X_ktp_0');
  });
  it('isKtpAlreadyUsed: returns false when map empty / missing', () => {
    assert.equal(isKtpAlreadyUsed({}, 'RG', 1), false);
    assert.equal(isKtpAlreadyUsed(null, 'RG', 1), false);
  });
  it('isKtpAlreadyUsed: true when flag set', () => {
    const used = { 'RG_ktp_2': true };
    assert.equal(isKtpAlreadyUsed(used, 'RG', 2), true);
    assert.equal(isKtpAlreadyUsed(used, 'RG', 3), false);
  });
});

describe('PROBE-KTP-004: library + dc-effects wiring', () => {
  for (const slug of ['keep_the_peace_elite', 'keep_the_peace_regular']) {
    it(`${slug} library entry wired`, async () => {
      const { readFile } = await import('node:fs/promises');
      const lib = JSON.parse(
        await readFile(new URL('../../../data/ability-library.json', import.meta.url), 'utf8'),
      );
      const e = lib.abilities?.[slug];
      assert.ok(e);
      assert.equal(e.wiredStatus, 'wired');
      assert.match(e.label || '', /Keep the Peace/i);
    });
  }
  it('each slug has at least one DC owner', async () => {
    const { readFile } = await import('node:fs/promises');
    const effects = JSON.parse(
      await readFile(new URL('../../../data/dc-effects.json', import.meta.url), 'utf8'),
    );
    for (const slug of ['keep_the_peace_elite', 'keep_the_peace_regular']) {
      const refs = Object.entries(effects.cards || {}).filter(([, dc]) =>
        (dc.specialAbilityIds || []).includes(slug),
      );
      assert.ok(refs.length > 0, `expected DC owner for ${slug}`);
    }
  });
  it('LATENT-KTP-REG-GUARDIAN: handler gates Regular reminder on !GUARDIAN target — no card-text basis', async () => {
    const { readFile } = await import('node:fs/promises');
    const lib = JSON.parse(
      await readFile(new URL('../../../data/ability-library.json', import.meta.url), 'utf8'),
    );
    // Pin that the library description makes no mention of GUARDIAN.
    // If this ever changes (rule clarified), the tripwire forces
    // re-evaluation of the handler gate at combat.js:2083.
    const desc = lib.abilities?.keep_the_peace_regular?.description || '';
    assert.doesNotMatch(desc, /GUARDIAN/i);
  });
});
