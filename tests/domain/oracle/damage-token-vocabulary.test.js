/**
 * "Hit token" is now "Damage token", everywhere.
 *
 * alexanbv 2026-09-02: "jarrod should be damage token, and likewise all
 * instances of hit token should be changed to damage token and unified".
 *
 * The token itself was already granted as 'Damage' — grantPowerTokens has said
 * so for months. Only the vocabulary lagged, and it lagged inconsistently: the
 * spec sheet called the same badge a "Hit token" on Ahsoka and CT-1701 and a
 * "Damage token" on Bodhi and Cassian, which is what let Jarrod's badge get
 * booked as a generic power token in the first place.
 *
 * The OLD spellings still parse. A game saved mid-attack can already have
 * 'hit token' sitting on combat.bonusSurgeAbilities, and a rename that dropped
 * it would silently eat that attack's token grant.
 */
import { test, describe } from 'node:test';
import assert from 'node:assert';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseSurgeEffect } from '../../../src/game/combat.js';
import { abilitiesForCard } from '../../../src/engine/combat-ability-db.js';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../../../');
const dc = (() => {
  const d = JSON.parse(readFileSync(resolve(root, 'data/dc-effects.json'), 'utf8'));
  return d.cards || d;
})();

const TOKEN_CARDS = ['Ahsoka Tano', 'Bodhi Rook', 'CT-1701', 'Jarrod Kelvin', 'Cassian Andor'];

describe('the card data speaks one dialect', () => {
  test('no card is left on a "hit token" value', () => {
    const stale = Object.entries(dc)
      .filter(([, v]) => v && typeof v === 'object' && (v.surgeAbilities || []).some((s) => /hit token/i.test(String(s))))
      .map(([k]) => k);
    assert.deepEqual(stale, []);
  });

  test('the five Damage-token cards all say so', () => {
    for (const c of TOKEN_CARDS) {
      const has = (dc[c].surgeAbilities || []).some((s) => /^damage token/.test(String(s)));
      assert.ok(has, `${c}: ${JSON.stringify(dc[c].surgeAbilities)}`);
    }
    assert.ok(dc['Cassian Andor'].surgeAbilities.includes('damage token 2'), 'and the count survives');
  });

  test('the spec sheet no longer names the same badge two ways', () => {
    for (const c of TOKEN_CARDS) {
      const row = (abilitiesForCard(c) || []).find((r) => /token/i.test(r.ability) && /surge/i.test(r.ability));
      assert.ok(row, `${c} has a token surge row`);
      assert.match(row.ability, /Damage token/, `${c}: ${row.ability}`);
      assert.ok(!/Hit token/i.test(row.ability + row.effect), `${c} still says Hit token`);
    }
  });

  test('the whole spec sheet is clean', () => {
    const csv = readFileSync(resolve(root, 'docs/combat-spec.csv'), 'utf8');
    assert.ok(!/Hit token/i.test(csv), 'a stray "Hit token" remains in combat-spec.csv');
  });
});

describe('the parser', () => {
  test('the new spellings grant a Damage token', () => {
    assert.equal(parseSurgeEffect('damage token').surgeGrantDamageToken, 1);
    assert.equal(parseSurgeEffect('damage token 2').surgeGrantDamageToken, 2);
  });

  test('the old spellings still resolve, to the SAME field', () => {
    // Back-compat for an attack already in flight, not a second dialect.
    assert.equal(parseSurgeEffect('hit token').surgeGrantDamageToken, 1);
    assert.equal(parseSurgeEffect('hit token 2').surgeGrantDamageToken, 2);
    assert.ok(!('surgeGrantHitToken' in parseSurgeEffect('hit token')),
      'the old FIELD name is gone even when the old key is read');
  });

  test('combo surges route both spellings too', () => {
    // Royal Guard is "stun, evade token"; the combo splitter is a separate
    // code path from the single-key lookup and was missed once already.
    const combo = parseSurgeEffect('pierce 1, hit token');
    assert.equal(combo.surgeGrantDamageToken, 1, 'the legacy key inside a combo');
    assert.equal(parseSurgeEffect('pierce 1, damage token').surgeGrantDamageToken, 1);
  });

  test('the other token types are untouched', () => {
    assert.equal(parseSurgeEffect('block token').surgeGrantBlockToken, 1);
    assert.equal(parseSurgeEffect('evade token').surgeGrantEvade, 1);
    assert.equal(parseSurgeEffect('power token').surgeGrantPowerToken, 1);
  });
});

describe('the consumer', () => {
  test('reads the new field and falls back to the old one', () => {
    const src = readFileSync(resolve(root, 'src/handlers/combat.js'), 'utf8');
    assert.match(src, /mod\.surgeGrantDamageToken \?\? mod\.surgeGrantHitToken/);
    assert.match(src, /grantPowerTokens\(game, combat\.attackerFigureKey, 'Damage', _grantDmgTok\)/,
      "and still grants a token of type 'Damage'");
  });

  test('both surge-bucket maps know the new keys', async () => {
    const { SURGE_TIMING } = await import('../../../src/game/surge-buckets.js');
    assert.equal(SURGE_TIMING['damage token'], 'immediate');
    assert.equal(SURGE_TIMING['damage token 2'], 'immediate');
    assert.equal(SURGE_TIMING['hit token'], 'immediate', 'and still the old ones');
  });
});
