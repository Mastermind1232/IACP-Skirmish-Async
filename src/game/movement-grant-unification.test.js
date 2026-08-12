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

describe('special-action MP is always immediate', () => {
  test('a special-action grant bypasses banking even mid-activation', async () => {
    // alexanbv 2026-08-12: "any MP grants that are part of a SPECIAL ACTION are
    // always spend immediate and not to the bank, no matter who is activating.
    // This rule is overriding. For example, Urgency."
    //
    // A special action happens during your own activation, so the runtime check
    // would otherwise bank it.
    const { grantMovementPoints } = await import('./game-helpers.js');
    const game = { dcActionsData: { m1: {} } };   // mid-activation

    const mode = grantMovementPoints(game, {
      msgId: 'm1', amount: 4, playerNum: 1, figureKey: 'Chewbacca-1-0',
      source: 'Urgency', isSpecialAction: true,
    });

    assert.equal(mode, 'immediate', 'the override beats the runtime check');
    assert.equal(game.movementBank, undefined, 'nothing banked');
    assert.equal(game.pendingMoveX.m1.remaining, 4);
  });

  test('without the flag the same grant banks mid-activation', async () => {
    const { grantMovementPoints } = await import('./game-helpers.js');
    const game = { dcActionsData: { m1: {} } };

    const mode = grantMovementPoints(game, {
      msgId: 'm1', amount: 4, playerNum: 1, figureKey: 'Chewbacca-1-0', source: 'Not special',
    });

    assert.equal(mode, 'banked');
    assert.equal(game.pendingMoveX, undefined);
  });

  test('the dead deploy-bonus banking block is gone', () => {
    // It read game.deployBonusMp, which nothing ever wrote, and banked a
    // deferred group-wide amount. Deploy is out of activation and per-figure.
    const src = read('src/engine/activation-setup.js');
    const code = src.split('\n').filter((l) => !l.trim().startsWith('//')).join('\n');
    assert.ok(!code.includes('game.deployBonusMp'),
      'the dead deploy-bonus read must stay deleted');
  });
});

describe('granted MP goes to the CHOSEN figure, not a same-named one', () => {
  // alexanbv 2026-08-12: "Granted MP are often to non-unique figures. They need
  // to be granted to the chosen figure, NOT any figure with the same name."
  //
  // The failure mode is a lookup that matches a card by dcName + playerNum and
  // returns the first hit. With two groups of the same card in an army that
  // resolves to the wrong group's card, and the MP lands on the wrong figures.
  test('findDcMessageIdForFigure distinguishes two groups of the same card', async () => {
    const { findDcMessageIdForFigure } = await import('../engine/game-readers.js');
    const meta = new Map([
      ['m-g1', { gameId: 'g', playerNum: 1, dcName: 'Stormtrooper', displayName: 'Stormtrooper [Group 1]' }],
      ['m-g2', { gameId: 'g', playerNum: 1, dcName: 'Stormtrooper', displayName: 'Stormtrooper [Group 2]' }],
    ]);

    assert.equal(findDcMessageIdForFigure('g', 1, 'Stormtrooper-2-1', meta), 'm-g2',
      'group 2 figure resolves to group 2 card');
    assert.equal(findDcMessageIdForFigure('g', 1, 'Stormtrooper-1-0', meta), 'm-g1');
  });

  test('post-deploy resolves grantees by figure, not by card name', () => {
    const src = read('src/handlers/post-deploy.js');
    // Smooth Landing ("each adjacent friendly figure") and Strike Team ("an
    // adjacent friendly figure") both pick a figure the player chose, which is
    // frequently a non-unique trooper.
    assert.ok(!/if \(meta\.dcName === dcName && meta\.playerNum === playerNum\) \{ msgId = mid; break; \}/.test(src),
      'Smooth Landing must not resolve its grantee by card name');
    assert.ok(!/const cassianMid = findMid\(cassianName\)/.test(src),
      'Strike Team must not resolve its grantees by card name');
    assert.match(src, /findDcMessageIdForFigure\(game\.gameId, playerNum, figureKey, dcMessageMeta\)/,
      'Smooth Landing uses the group-aware lookup');
  });
});
