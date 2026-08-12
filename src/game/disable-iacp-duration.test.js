/**
 * Disable (IACP), not Disable (FFG).
 *
 * alexanbv 2026-08-12: "you are reading FFG disable which costs 2. You should
 * be reading IACP disable which costs 0 and has different text."
 *
 * The repo carried the FFG card:
 *
 *   FFG   cost 2, "Until the end of the ROUND, that figure cannot use Surge
 *         abilities or Special actions."
 *   IACP  cost 0, "Until the end of that figure's NEXT ACTIVATION, that figure
 *         cannot use action or surge abilities."
 *
 * The IACP card image is in the repo as
 * vassal_extracted/images/cc/Disable (IACP).png and is the ground truth used
 * to correct the data.
 *
 * The duration is the part with teeth: "next activation" means an activation
 * already underway when Disable lands must not consume it. Hence the two-step
 * pending -> armed -> cleared lifecycle these tests pin.
 */
import { test, describe } from 'node:test';
import assert from 'node:assert';
import { getCcEffect } from '../data-loader.js';
import { cleanupActivation } from './activation-state.js';

const DISPLAY = 'Stormtrooper [Group 1]';

/** Minimal game with a Disable already applied to DISPLAY. */
const makeGame = () => ({
  gameId: 'g-dis',
  disabledFigures: [DISPLAY],
  disabledFiguresPending: { [DISPLAY]: true },
  dcMessageMeta: new Map([['m-st', { gameId: 'g-dis', playerNum: 2, dcName: 'Stormtrooper', displayName: DISPLAY }]]),
});

/** What activation-setup.js does at B7c when that card begins activating. */
function armOnActivationStart(game, displayName) {
  if (!game.disabledFiguresPending?.[displayName]) return;
  delete game.disabledFiguresPending[displayName];
  game.disabledFiguresArmed = game.disabledFiguresArmed || {};
  game.disabledFiguresArmed[displayName] = true;
  if (Object.keys(game.disabledFiguresPending).length === 0) delete game.disabledFiguresPending;
}

describe('Disable is the IACP card', () => {
  test('card data is IACP, not FFG', () => {
    const e = getCcEffect('Disable');
    assert.strictEqual(e.cost, 0, 'IACP Disable costs 0; FFG costs 2');
    assert.match(e.effect, /next activation/i, 'IACP duration, not "end of the round"');
    assert.doesNotMatch(e.effect, /end of the round/i, 'the FFG duration must not come back');
    assert.match(e.effect, /action or surge abilities/i);
  });

  test('an activation already underway does NOT consume the Disable', () => {
    // Disable landed mid-activation. That activation is not the target's
    // "next" one, so ending it must leave the figure Disabled.
    const game = makeGame();
    cleanupActivation(game, 'm-st', 2, ['Stormtrooper-1-0']);

    assert.deepStrictEqual(game.disabledFigures, [DISPLAY], 'still Disabled');
    assert.ok(game.disabledFiguresPending?.[DISPLAY], 'still waiting for the NEXT activation');
  });

  test('the end of the next activation clears it', () => {
    const game = makeGame();
    armOnActivationStart(game, DISPLAY);
    assert.ok(game.disabledFiguresArmed?.[DISPLAY], 'armed when that card began activating');

    cleanupActivation(game, 'm-st', 2, ['Stormtrooper-1-0']);

    assert.deepStrictEqual(game.disabledFigures, [], 'Disable expired');
    assert.strictEqual(game.disabledFiguresArmed, undefined, 'lifecycle state cleaned up');
  });

  test('some other card ending its activation does not clear it', () => {
    const game = makeGame();
    armOnActivationStart(game, DISPLAY);
    game.dcMessageMeta.set('m-other', { gameId: 'g-dis', playerNum: 2, dcName: 'Rebel Trooper', displayName: 'Rebel Trooper [Group 1]' });

    cleanupActivation(game, 'm-other', 2, ['Rebel Trooper-1-0']);

    assert.deepStrictEqual(game.disabledFigures, [DISPLAY], 'only the Disabled card ends it');
  });
});
