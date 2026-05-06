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

test('per-frame state on pendingCombat is preserved by push/pop', () => {
  // Slice 7.8: perFrameLimits + attackCcCount + bonusPierce etc. live on
  // the combat object. Push/pop must round-trip them losslessly so an
  // outer frame's once-per-attack consumption is restored after a
  // nested attack completes.
  const outer = {
    attackerFigureKey: 'p1_jediKnight_0',
    attackCcCount: 2,
    bonusPierce: 3,
    perFrameLimits: { tools_for_the_job_used: true },
  };
  const game = { pendingCombat: outer };
  pushNestedCombat(game);
  // Nested attack init — completely fresh frame
  game.pendingCombat = {
    attackerFigureKey: 'p2_hiredGun_0',
    attackCcCount: 0,
    bonusPierce: 0,
    perFrameLimits: {},
  };
  // Nested frame consumes Tools for the Job — must NOT pollute outer
  game.pendingCombat.perFrameLimits.tools_for_the_job_used = true;
  // Resolve nested
  game.pendingCombat = null;
  popNestedCombat(game);
  assert.equal(game.pendingCombat.attackerFigureKey, 'p1_jediKnight_0');
  assert.equal(game.pendingCombat.attackCcCount, 2);
  assert.equal(game.pendingCombat.bonusPierce, 3);
  assert.equal(game.pendingCombat.perFrameLimits.tools_for_the_job_used, true);
});

test('global figurePowerTokens propagate across nested frames', () => {
  // Slice 7.9: figurePowerTokens is on `game`, not pendingCombat — so a
  // power token gained at the parent's Step 5 stays available in the
  // nested attack's Step 1+2.
  const outer = { attackerFigureKey: 'p1_a' };
  const game = {
    pendingCombat: outer,
    figurePowerTokens: { p1_a: ['Damage', 'Surge'] },
  };
  pushNestedCombat(game);
  game.pendingCombat = { attackerFigureKey: 'p2_b' };
  // Nested frame can read the parent's figure's tokens
  assert.deepEqual(game.figurePowerTokens.p1_a, ['Damage', 'Surge']);
  // And spend them
  game.figurePowerTokens.p1_a.pop();
  popNestedCombat(game);
  // After pop, outer sees the consumption
  assert.deepEqual(game.figurePowerTokens.p1_a, ['Damage']);
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
