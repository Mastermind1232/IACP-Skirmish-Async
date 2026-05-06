import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  pushNestedCombat,
  popNestedCombat,
  peekNestedCombat,
  nestedCombatDepth,
} from './combat-stack.js';

test('pushNestedCombat moves pendingCombat onto combatStack', () => {
  const outer = { attackerPlayerNum: 1, target: { figureKey: 'p2_dc0_0' }, attackCcCount: 1 };
  const game = { pendingCombat: outer };
  assert.equal(pushNestedCombat(game), true);
  assert.equal(game.pendingCombat, undefined);
  assert.equal(game.combatStack.length, 1);
  assert.equal(game.combatStack[0], outer);
});

test('pushNestedCombat is a no-op when no pendingCombat', () => {
  const game = {};
  assert.equal(pushNestedCombat(game), false);
  assert.equal(game.combatStack, undefined);
});

test('popNestedCombat restores top frame onto pendingCombat', () => {
  const outer = { attackerPlayerNum: 1 };
  const game = { combatStack: [outer] };
  assert.equal(popNestedCombat(game), true);
  assert.equal(game.pendingCombat, outer);
  assert.equal(game.combatStack, undefined);
});

test('popNestedCombat is a no-op when stack is empty', () => {
  const game = {};
  assert.equal(popNestedCombat(game), false);
  assert.equal(game.pendingCombat, undefined);
});

test('push/pop preserves frame contents identity', () => {
  const outer = { attackerPlayerNum: 1, ccPlayStack: [{ ccName: 'Brace for Impact', playerNum: 2 }] };
  const game = { pendingCombat: outer };
  pushNestedCombat(game);
  // simulate inner attack init
  game.pendingCombat = { attackerPlayerNum: 2, ccPlayStack: [] };
  // resolve inner
  game.pendingCombat = null;
  popNestedCombat(game);
  assert.deepEqual(game.pendingCombat, outer);
  assert.equal(game.pendingCombat.ccPlayStack[0].ccName, 'Brace for Impact');
});

test('depth and peek track stack correctly', () => {
  const game = { pendingCombat: { tag: 'a' } };
  assert.equal(nestedCombatDepth(game), 0);
  assert.equal(peekNestedCombat(game), null);
  pushNestedCombat(game);
  assert.equal(nestedCombatDepth(game), 1);
  assert.deepEqual(peekNestedCombat(game), { tag: 'a' });
  game.pendingCombat = { tag: 'b' };
  pushNestedCombat(game);
  assert.equal(nestedCombatDepth(game), 2);
  assert.deepEqual(peekNestedCombat(game), { tag: 'b' });
});

test('multiple pop respects LIFO order', () => {
  const a = { tag: 'a' };
  const b = { tag: 'b' };
  const game = { pendingCombat: a };
  pushNestedCombat(game);
  game.pendingCombat = b;
  pushNestedCombat(game);
  popNestedCombat(game);
  assert.equal(game.pendingCombat, b);
  popNestedCombat(game);
  assert.equal(game.pendingCombat, a);
  assert.equal(nestedCombatDepth(game), 0);
});
