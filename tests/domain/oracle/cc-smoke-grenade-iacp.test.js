/**
 * Smoke Grenade (Trooper or Technician CC) — the IACP card reads:
 *
 *   Special Action: Choose a space within 3 spaces and mark it. A friendly
 *   figure within 2 spaces of the chosen space gains 2 movement points and
 *   becomes HIDDEN. Until the start of the next round, the marked space blocks
 *   line of sight.
 *
 * Until 2026-08-21 the engine held what appears to be the superseded text and
 * was wrong in three separate ways: the space had to be within 2 rather than 3,
 * the recipient never became Hidden at all, and the smoke was booked to expire
 * at the END of the next round, leaving it on the board for a full extra round.
 *
 * These three are the regression guards. The range and the duration are data
 * (ability-library `spaceRange` / the expiry stamp), the Hidden grant is the
 * resolver.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { resolveAbility } from '../../../src/game/abilities.js';
import { countGameSpaces } from '../../../src/game/board-helpers.js';
import { cleanupRoundStart } from '../../../src/game/activation-state.js';

const MAP = 'mos-eisley-outskirts';
const MSG = 'msg-sg';
const SELF = 'Rebel Trooper-1-0';

function fixture(round = 3) {
  return {
    gameId: 'g-sg',
    currentRound: round,
    selectedMap: { id: MAP },
    dcActionsData: { [MSG]: { selectedFigure: 0 } },
    figurePositions: { 1: { [SELF]: 'e19' } },
  };
}
const meta = () => new Map([[MSG, {
  gameId: 'g-sg', playerNum: 1, dcName: 'Rebel Trooper', displayName: 'Rebel Trooper [Group 1]',
}]]);

describe('Smoke Grenade — the marked space is chosen within 3', () => {
  it('offers spaces out to 3, not 2', () => {
    const game = fixture();
    const r = resolveAbility('Smoke Grenade', { game, playerNum: 1, dcMessageMeta: meta() });
    assert.equal(r.requiresSpaceChoice, true);
    assert.ok(r.validSpaces?.length > 0, 'expected some valid spaces');

    const dists = r.validSpaces.map((sp) => countGameSpaces(game, 'e19', sp));
    const reach = Math.max(...dists.filter((d) => typeof d === 'number' && d >= 0));
    assert.equal(reach, 3,
      `the card reads "within 3 spaces"; furthest offered space was ${reach} away`);
    assert.ok(dists.some((d) => d === 3), 'at least one space exactly 3 away must be offered');
  });
});

describe('Smoke Grenade — the recipient becomes Hidden', () => {
  it('grants Hidden alongside the movement points', () => {
    const game = fixture();
    const r = resolveAbility('Smoke Grenade', {
      game, playerNum: 1, dcMessageMeta: meta(), chosenSpace: 'e20',
    });
    assert.equal(r.applied, true);
    assert.deepEqual(game.figureConditions?.[SELF], ['Hide'],
      'the card says the figure "gains 2 movement points and becomes HIDDEN"');
    assert.match(r.logMessage, /Hidden/, 'the log should say so');
  });
});

describe('Smoke Grenade — the smoke lifts at the START of the next round', () => {
  it('books the token to expire in the round it was placed', () => {
    const game = fixture(3);
    resolveAbility('Smoke Grenade', { game, playerNum: 1, dcMessageMeta: meta(), chosenSpace: 'e20' });
    assert.deepEqual(game.ancillaryTokens.smoke, ['e20']);
    assert.equal(game.ancillaryTokens.smokeExpiry.e20, 3,
      'placed in round 3, so round 3 is its last live round');
  });

  it('is swept the moment the next round starts', () => {
    const game = fixture(3);
    resolveAbility('Smoke Grenade', { game, playerNum: 1, dcMessageMeta: meta(), chosenSpace: 'e20' });
    // cleanupRoundStart runs after currentRound is incremented.
    game.currentRound = 4;
    cleanupRoundStart(game);
    assert.deepEqual(game.ancillaryTokens.smoke, [],
      'the card blocks LOS only UNTIL the start of the next round');
  });
});
