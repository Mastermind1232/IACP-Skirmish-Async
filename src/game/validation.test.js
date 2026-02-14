/**
 * Tests for src/game/validation.js. Uses data-loader (loads data/ at import). Run: node --test src/game/validation.test.js
 */
import test from 'node:test';
import assert from 'node:assert';
import {
  resolveDcName,
  validateDeckLegal,
  DC_POINTS_LEGAL,
  CC_CARDS_LEGAL,
  CC_COST_LEGAL,
} from './validation.js';

test('resolveDcName', () => {
  assert.strictEqual(resolveDcName('Darth Vader'), 'Darth Vader');
  assert.strictEqual(resolveDcName({ dcName: 'Nexu' }), 'Nexu');
  assert.strictEqual(resolveDcName({ displayName: 'Stormtrooper (Elite)' }), 'Stormtrooper (Elite)');
  assert.strictEqual(resolveDcName({ dcName: 'Luke', displayName: 'Luke [DG 1]' }), 'Luke');
});

test('constants', () => {
  assert.strictEqual(DC_POINTS_LEGAL, 40);
  assert.strictEqual(CC_CARDS_LEGAL, 15);
  assert.strictEqual(CC_COST_LEGAL, 15);
});

test('validateDeckLegal illegal DC total', () => {
  const result = validateDeckLegal({
    dcList: ['Darth Vader'], // 14 pts only
    ccList: [],
  });
  assert.strictEqual(result.legal, false);
  assert.ok(result.errors.some((e) => e.includes('Deployment total') || e.includes('40')));
  assert.strictEqual(result.dcTotal, 14);
});

test('validateDeckLegal unknown DC', () => {
  const result = validateDeckLegal({
    dcList: ['Not A Real Card'],
    ccList: [],
  });
  assert.strictEqual(result.legal, false);
  assert.ok(result.errors.some((e) => e.includes('Unknown') || e.includes('cost not found')));
});

test('validateDeckLegal wrong CC count', () => {
  const ccNames = ['Advance Warning', 'Against the Odds', 'Ambush', 'Arcing Shot', 'Adrenaline',
    'All in a Day\'s Work', 'Apex Predator', 'Another', 'Another2', 'Another3', 'Another4',
    'Another5', 'Another6', 'Another7', 'Another8']; // 15 names - we need to use real names that exist and sum to 15
  const result = validateDeckLegal({
    dcList: ['Darth Vader', 'Stormtrooper (Elite)', 'Stormtrooper (Regular)', 'Nexu (Regular)'], // 14+7+5+6 = 32, need 8 more
    ccList: ccNames.slice(0, 10), // 10 cards - wrong count
  });
  assert.strictEqual(result.legal, false);
  assert.ok(result.errors.some((e) => e.includes('Command deck') && e.includes('15')));
});

test('validateDeckLegal returns shape', () => {
  const result = validateDeckLegal({ dcList: [], ccList: [] });
  assert.ok('legal' in result);
  assert.ok(Array.isArray(result.errors));
  assert.ok(typeof result.dcTotal === 'number');
  assert.ok(typeof result.ccCount === 'number');
  assert.ok(typeof result.ccCost === 'number');
});
