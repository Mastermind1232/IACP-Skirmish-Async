/**
 * Auto-select re-audit fixes (alexanbv 2026-06-21): every figure selection is a
 * player pick — the engine must not silently auto-pick the first eligible figure.
 *
 * Covered here:
 *   - Paid in Beskar: the resolver anchors the within-3 range + the 2 Block
 *     tokens on the HUNTER the player CHOSE (context.chosenFigureKey), not the
 *     first live HUNTER. (The defeat-CC picker offers each eligible HUNTER when
 *     2+ are within range — see src/handlers/defeat-cc-prompts.js.)
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { resolveAbility } from '../../../src/game/abilities.js';

describe('Paid in Beskar — player-chosen HUNTER anchors the effect', () => {
  function gameWithTwoHunters() {
    // Two friendly figures; the defeated hostile sits next to the SECOND one.
    return {
      selectedMap: { id: 'mos-eisley-outskirts' },
      figurePositions: { 1: { 'HunterA-1-0': 'a1', 'HunterB-1-0': 'g9' }, 2: {} },
      figurePowerTokens: {},
    };
  }

  it('grants the Block tokens to the CHOSEN HUNTER, not the first one', () => {
    const game = gameWithTwoHunters();
    const r = resolveAbility('Paid in Beskar', {
      game, playerNum: 1, cardName: 'Paid in Beskar',
      defeatedPos: 'g10', chosenFigureKey: 'HunterB-1-0',
    });
    assert.equal(r.applied, true);
    // HunterB (g9) is within 3 of the kill (g10); the tokens go to HunterB.
    assert.ok(/HunterB/.test(r.logMessage), `chosen HUNTER should receive the tokens: ${r.logMessage}`);
    assert.equal((game.figurePowerTokens['HunterB-1-0'] || []).length, 2, 'chosen HUNTER got 2 Block');
    assert.ok(!game.figurePowerTokens['HunterA-1-0'], 'the non-chosen HUNTER got nothing');
  });

  it('respects the within-3 gate measured from the chosen HUNTER', () => {
    const game = gameWithTwoHunters();
    // Choose HunterA (a1), far from the kill at g10 → no tokens (out of range).
    const r = resolveAbility('Paid in Beskar', {
      game, playerNum: 1, cardName: 'Paid in Beskar',
      defeatedPos: 'g10', chosenFigureKey: 'HunterA-1-0',
    });
    assert.equal(r.applied, true);
    assert.match(r.logMessage, /not within 3/i);
    assert.ok(!game.figurePowerTokens['HunterA-1-0'], 'no tokens when the chosen HUNTER is out of range');
  });
});
