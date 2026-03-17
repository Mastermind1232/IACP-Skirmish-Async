import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { computeDeckHash } from '../../src/game/deck-hash.js';

describe('computeDeckHash', () => {
  const squad1 = {
    dcList: ['Darth Vader', 'Stormtrooper', 'Stormtrooper'],
    ccList: ['Force Lightning', 'Burst Fire'],
  };

  it('returns a hex string', () => {
    const hash = computeDeckHash(squad1);
    assert.match(hash, /^[0-9a-f]{64}$/);
  });

  it('is deterministic for the same input', () => {
    assert.equal(computeDeckHash(squad1), computeDeckHash(squad1));
  });

  it('is order-invariant for dcList', () => {
    const reordered = {
      dcList: ['Stormtrooper', 'Darth Vader', 'Stormtrooper'],
      ccList: ['Force Lightning', 'Burst Fire'],
    };
    assert.equal(computeDeckHash(squad1), computeDeckHash(reordered));
  });

  it('is order-invariant for ccList', () => {
    const reordered = {
      dcList: ['Darth Vader', 'Stormtrooper', 'Stormtrooper'],
      ccList: ['Burst Fire', 'Force Lightning'],
    };
    assert.equal(computeDeckHash(squad1), computeDeckHash(reordered));
  });

  it('produces different hash for different cards', () => {
    const different = {
      dcList: ['Luke Skywalker'],
      ccList: ['Son of Skywalker'],
    };
    assert.notEqual(computeDeckHash(squad1), computeDeckHash(different));
  });

  it('produces different hash when a card is added', () => {
    const extra = {
      dcList: ['Darth Vader', 'Stormtrooper', 'Stormtrooper', 'Royal Guard'],
      ccList: ['Force Lightning', 'Burst Fire'],
    };
    assert.notEqual(computeDeckHash(squad1), computeDeckHash(extra));
  });

  it('handles empty lists', () => {
    const empty = { dcList: [], ccList: [] };
    const hash = computeDeckHash(empty);
    assert.match(hash, /^[0-9a-f]{64}$/);
  });

  it('handles missing lists', () => {
    const missing = {};
    const hash = computeDeckHash(missing);
    assert.match(hash, /^[0-9a-f]{64}$/);
    assert.equal(hash, computeDeckHash({ dcList: [], ccList: [] }));
  });
});
