/**
 * Gauntlet Blade (Bo-Katan Kryze CC) — after an attack targeting you resolves,
 * choose an adjacent hostile figure and roll 1 green die. That figure suffers
 * Damage equal to the Hit results. Then, if you rolled a Surge, gain a BLOCK
 * Token.
 *
 * The token is a Block token specifically. The 12.0 Playtest card prints the
 * Block face (the trefoil, the same glyph Mandalorian Steel uses for "spent a
 * Block"), not the black-badge-with-question-mark that means "gain a Power
 * Token, choose its face". Until 2026-08-21 this resolver stashed a
 * pendingPowerTokenGrant and let the player pick, so they could take Evade or
 * Hit instead. Audit 2026-08-21.
 *
 * The die is rolled with Math.random, so these tests drive every face of the
 * green die deterministically rather than hoping a surge comes up.
 */
import { describe, it, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { resolveAbility } from '../../../src/game/abilities.js';
import { getDiceData } from '../../../src/data-loader.js';

const SELF = 'Bo-Katan Kryze-1-0';
const FOE = 'Stormtrooper-1-0';

function fixture() {
  return {
    gameId: 'g1',
    selectedMap: { id: 'no-such-map' },
    figurePositions: { 1: { [SELF]: 'A1' }, 2: { [FOE]: 'A2' } },
    combat: { defenderPlayerNum: 1, defenderFigureKey: SELF },
  };
}

/** Resolve Gauntlet Blade with the green die pinned to one face. */
function rollFace(faceIdx, faceCount) {
  const real = Math.random;
  Math.random = () => faceIdx / faceCount;
  try {
    const game = fixture();
    const res = resolveAbility('Gauntlet Blade', { game, playerNum: 1, targetFigureKey: FOE });
    return { game, res };
  } finally {
    Math.random = real;
  }
}

describe('Gauntlet Blade — the surge token is a Block token', () => {
  const faces = getDiceData().attack?.green || [];

  it('the green die fixture is real', () => {
    assert.ok(faces.length > 0, 'expected green die faces from the dice data');
    assert.ok(faces.some((f) => (f.surge ?? 0) >= 1), 'expected at least one surge face to exercise');
  });

  it('grants exactly one Block token on a surge, and never opens a face picker', () => {
    let surgeFacesSeen = 0;
    for (let i = 0; i < faces.length; i++) {
      const { game, res } = rollFace(i, faces.length);
      assert.equal(res.requiresPowerTokenChoice, undefined,
        `face ${i}: the card prints Block, so no face may be chosen`);
      assert.equal(game.pendingPowerTokenGrant, undefined,
        `face ${i}: no pending Power Token picker may be stashed`);
      const held = game.figurePowerTokens?.[SELF] || [];
      if ((faces[i].surge ?? 0) >= 1) {
        surgeFacesSeen++;
        assert.deepEqual(held, ['Block'], `face ${i} rolled a surge, so exactly one Block token is owed`);
        assert.match(res.logMessage, /Block Token/, `face ${i}: the log should name the Block token`);
      } else {
        assert.deepEqual(held, [], `face ${i} rolled no surge, so no token is owed`);
      }
    }
    assert.ok(surgeFacesSeen > 0, 'the surge branch was never exercised');
  });
});
