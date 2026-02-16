/**
 * Tests for src/game/abilities.js (F1 ability library). Run: node --test src/game/abilities.test.js
 */
import test from 'node:test';
import assert from 'node:assert';
import { getAbility, resolveSurgeAbility, getSurgeAbilityLabel, resolveAbility } from './abilities.js';

test('getAbility returns library entry for known surge id', () => {
  const entry = getAbility('damage 1');
  assert.ok(entry);
  assert.strictEqual(entry.type, 'surge');
  assert.strictEqual(entry.surgeCost, 1);
  assert.strictEqual(entry.label, '+1 Hit');
  assert.strictEqual(getAbility('stun').label, 'Stun');
});

test('getAbility returns null for unknown id', () => {
  assert.strictEqual(getAbility('unknown_key'), null);
});

test('F13: getAbility supports surgeCost > 1 (multi-surge)', () => {
  const entry = getAbility('damage 4');
  assert.ok(entry);
  assert.strictEqual(entry.surgeCost, 2);
  assert.strictEqual(entry.label, '+4 Hits');
  assert.strictEqual(resolveSurgeAbility('damage 4').damage, 4);
});

test('resolveSurgeAbility returns same shape as parseSurgeEffect', () => {
  const r = resolveSurgeAbility('damage 2');
  assert.strictEqual(r.damage, 2);
  assert.strictEqual(r.pierce, 0);
  assert.strictEqual(r.accuracy, 0);
  assert.deepStrictEqual(r.conditions, []);
  const r2 = resolveSurgeAbility('damage 1, stun');
  assert.strictEqual(r2.damage, 1);
  assert.deepStrictEqual(r2.conditions, ['Stun']);
});

test('getSurgeAbilityLabel uses library when present', () => {
  assert.strictEqual(getSurgeAbilityLabel('damage 1'), '+1 Hit');
  assert.strictEqual(getSurgeAbilityLabel('pierce 2'), 'Pierce 2');
});

test('getSurgeAbilityLabel returns id for unknown (composite or not in library)', () => {
  const label = getSurgeAbilityLabel('some composite key');
  assert.strictEqual(label, 'some composite key');
});

test('resolveAbility draw 1 (There is Another): mutates game, returns applied and drewCards', () => {
  const game = { player1CcDeck: ['A', 'B', 'C'], player2CcDeck: [], player1CcHand: [], player2CcHand: [] };
  const result = resolveAbility('There is Another', { game, playerNum: 1 });
  assert.strictEqual(result.applied, true);
  assert.deepStrictEqual(result.drewCards, ['A']);
  assert.strictEqual(game.player1CcHand.length, 1);
  assert.strictEqual(game.player1CcHand[0], 'A');
  assert.strictEqual(game.player1CcDeck.length, 2);
});

test('resolveAbility draw 2 (Planning): draws two cards', () => {
  const game = { player1CcDeck: ['X', 'Y', 'Z'], player2CcDeck: [], player1CcHand: [], player2CcHand: [] };
  const result = resolveAbility('Planning', { game, playerNum: 1 });
  assert.strictEqual(result.applied, true);
  assert.deepStrictEqual(result.drewCards, ['X', 'Y']);
  assert.strictEqual(game.player1CcHand.length, 2);
  assert.strictEqual(game.player1CcDeck.length, 1);
});

test('resolveAbility draw with empty deck: draws what is available', () => {
  const game = { player1CcDeck: ['Only'], player2CcDeck: [], player1CcHand: [], player2CcHand: [] };
  const result = resolveAbility('Planning', { game, playerNum: 1 });
  assert.strictEqual(result.applied, true);
  assert.deepStrictEqual(result.drewCards, ['Only']);
  assert.strictEqual(game.player1CcDeck.length, 0);
});

test('resolveAbility returns manual for unimplemented ccEffect', () => {
  const result = resolveAbility('cc:adrenaline', { game: {}, playerNum: 1 });
  assert.strictEqual(result.applied, false);
  assert.ok(result.manualMessage);
});

test('resolveAbility Fleet Footed without activation returns manual', () => {
  const game = { gameId: 'g1', dcActionsData: {}, movementBank: {} };
  const dcMessageMeta = new Map();
  const result = resolveAbility('cc:fleet_footed', { game, playerNum: 1, dcMessageMeta });
  assert.strictEqual(result.applied, false);
  assert.ok(result.manualMessage?.includes('activation'));
});

test('resolveAbility Fleet Footed with active activation applies +1 MP', () => {
  const msgId = 'msg123';
  const game = {
    gameId: 'g1',
    dcActionsData: { [msgId]: { remaining: 1 } },
    movementBank: { [msgId]: { total: 4, remaining: 2 } },
  };
  const dcMessageMeta = new Map([[msgId, { gameId: 'g1', playerNum: 1, dcName: 'Test', displayName: 'Test [DG 1]' }]]);
  const result = resolveAbility('cc:fleet_footed', { game, playerNum: 1, dcMessageMeta });
  assert.strictEqual(result.applied, true);
  assert.strictEqual(result.logMessage, 'Gained 1 movement point.');
  assert.strictEqual(game.movementBank[msgId].remaining, 3);
  assert.strictEqual(game.movementBank[msgId].total, 5);
});
