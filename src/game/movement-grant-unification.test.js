/**
 * Two movement-grant functions, and only two.
 *
 * alexanbv 2026-08-12: "Any immediate spending in ANY place must use pending
 * Move XP. There is no reason to have so many funcitions that add MP. You can
 * have one function that adds banked movement points. Everything else through
 * pending move X."
 *
 *   grantMovementBank    MP gained during the figure's OWN activation
 *   grantImmediateMoveX  everything else, via the normal move picker
 *
 * The two used to be three: abilities.js had a private addMovementPoints that
 * re-implemented banking inline. That duplicate was the whole reason the paths
 * diverged — only the copy tagged out-of-activation grants as
 * must-spend-immediately, so anything granted through grantMovementBank
 * outside an activation silently persisted.
 */
import { test, describe } from 'node:test';
import assert from 'node:assert';
import { readFileSync } from 'node:fs';
import { grantMovementBank, grantImmediateMoveX, expireImmediateMp } from './game-helpers.js';

const read = (rel) => readFileSync(new URL(`../../${rel}`, import.meta.url).pathname, 'utf8');

describe('movement grant unification', () => {
  test('banking is implemented in exactly one place', () => {
    // A second inline `fig.remaining = ... + n` is how this drifted before.
    const src = read('src/game/abilities.js');
    const idx = src.indexOf('function addMovementPoints(');
    assert.ok(idx > 0, 'addMovementPoints found');
    const body = src.slice(idx, idx + 1400);
    assert.match(body, /grantMovementBank\(game, msgId, n, figIdx\)/,
      'must delegate banking rather than re-implement it');
    assert.ok(!/fig\.remaining\s*=\s*\(fig\.remaining/.test(body),
      'must not carry its own copy of the banking arithmetic');
  });

  test('grantImmediateMoveX stages a picker and never touches the bank', () => {
    const game = { gameId: 'g', figurePositions: { 1: { 'Luke Skywalker-1-0': 'c5' } } };
    const ok = grantImmediateMoveX(game, {
      msgId: 'm1', playerNum: 1, figureKey: 'Luke Skywalker-1-0', amount: 2, source: 'Test',
    });

    assert.equal(ok, true);
    assert.equal(game.pendingMoveX.m1.remaining, 2);
    assert.equal(game.pendingMoveX.m1.figureKey, 'Luke Skywalker-1-0');
    assert.equal(game.movementBank, undefined, 'immediate MP must not bank');
  });

  test('MP grants pay terrain by default; spaces must opt in', () => {
    // alexanbv: Diplomatic Mission is MP and pays terrain, "Force Surge is move
    // spaces". Defaulting to MP means a caller cannot get free terrain by
    // forgetting a flag.
    const mp = {};
    grantImmediateMoveX(mp, { msgId: 'm', playerNum: 1, figureKey: 'f-1-0', amount: 2, source: 'MP' });
    assert.equal(mp.pendingMoveX.m.bypassCosts, false, 'MP pays terrain');

    const spaces = {};
    grantImmediateMoveX(spaces, { msgId: 'm', playerNum: 1, figureKey: 'f-1-0', amount: 1, source: 'Spaces', bypassCosts: true });
    assert.equal(spaces.pendingMoveX.m.bypassCosts, true);
  });

  test('it refuses an incomplete grant rather than staging a broken picker', () => {
    const game = {};
    assert.equal(grantImmediateMoveX(game, { msgId: 'm', playerNum: 1, amount: 2 }), false, 'no figureKey');
    assert.equal(grantImmediateMoveX(game, { msgId: 'm', figureKey: 'f-1-0', amount: 2 }), false, 'no playerNum');
    assert.equal(grantImmediateMoveX(game, { msgId: 'm', playerNum: 1, figureKey: 'f-1-0', amount: 0 }), false, 'no amount');
    assert.equal(game.pendingMoveX, undefined, 'nothing staged');
  });

  test('banked MP is untouched by the immediate expiry', () => {
    // The bank is for in-activation MP, which must survive expireImmediateMp.
    const game = { dcActionsData: { m1: {} } };
    grantMovementBank(game, 'm1', 3);
    assert.equal(expireImmediateMp(game, 'm1'), 0, 'nothing flagged, nothing lost');
    assert.equal(game.movementBank.m1.perFig[0].remaining, 3);
  });

  test('On a Diplomatic Mission grants immediately, not into the bank', () => {
    const src = read('src/handlers/interrupts.js');
    const idx = src.indexOf("_odmChoice === 'mp'");
    assert.ok(idx > 0, 'the MP branch was found');
    const branch = src.slice(idx, idx + 1200);
    assert.match(branch, /grantImmediateMoveX\(/,
      'end-of-activation MP is out-of-activation, so it must be immediate');
    assert.ok(!/grantMovementBank\(_odmGame/.test(branch),
      'must not use the untagged banking path');
  });
});
