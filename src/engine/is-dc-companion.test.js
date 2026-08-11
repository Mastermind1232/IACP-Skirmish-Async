/**
 * isDcCompanion() — guards an OVERLOADED data field.
 *
 * In data/dc-effects.json the `companion` key means two different things:
 *   - on a companion's own card:              companion: true
 *   - on a HOST card or granting attachment:  companion: "<companion name>"
 *
 * A truthy check therefore matched hosts as well as companions. That made
 * Iden Versio (7pt) and Jarrod Kelvin (5pt) register as companion figures,
 * which awarded 0 VP on defeat (calculateKillVp), let them share spaces
 * (movement.js occupancy), and refused them on the interact/retrieve path.
 *
 * These tests pin the `=== true` semantics against the real card data so the
 * trap cannot be reintroduced.
 */
import { test, describe } from 'node:test';
import assert from 'node:assert';
import { isDcCompanion, getDcEffects } from '../data-loader.js';

describe('isDcCompanion', () => {
  test('real companion figures are companions', () => {
    for (const name of [
      'The Child', 'BD-1', 'Dio', 'J4X-7', 'Junk Droid',
      '88-Z', 'Cam Droid', 'Pit Droid', 'Salacious B. Crumb',
    ]) {
      assert.equal(isDcCompanion(name), true, `${name} should be a companion`);
    }
  });

  test('HOSTS that merely bring a companion are NOT companions', () => {
    // Regression: these carry `companion: "<name>"` and were matched by the
    // old truthy check. Both are ordinary figures that score VP, block
    // spaces, and may interact.
    for (const name of ['Iden Versio', 'Jarrod Kelvin']) {
      const raw = getDcEffects()?.[name]?.companion;
      assert.equal(typeof raw, 'string', `${name} should carry a string companion field`);
      assert.equal(isDcCompanion(name), false, `${name} is a HOST, not a companion`);
    }
  });

  test('attachments that grant a companion are NOT companions', () => {
    for (const name of ['[Clan of Two]', '[Indentured Jester]']) {
      assert.equal(isDcCompanion(name), false, `${name} grants a companion but is not one`);
    }
  });

  test('ordinary figures are not companions', () => {
    for (const name of ['Baze Malbus', 'Director Krennic', 'Leia Organa']) {
      assert.equal(isDcCompanion(name), false);
    }
  });

  test('every truthy companion field is either true or a known card name', () => {
    // Data-integrity guard: a third shape (e.g. an array) would silently break
    // the === true contract above.
    const cards = getDcEffects() || {};
    for (const [name, card] of Object.entries(cards)) {
      if (card?.companion === undefined) continue;
      const v = card.companion;
      assert.ok(
        v === true || (typeof v === 'string' && v.length > 0),
        `${name} has an unexpected companion field shape: ${JSON.stringify(v)}`,
      );
    }
  });

  test('handles bad input without throwing', () => {
    for (const bad of [null, undefined, '', 42, {}, []]) {
      assert.equal(isDcCompanion(bad), false);
    }
  });
});
