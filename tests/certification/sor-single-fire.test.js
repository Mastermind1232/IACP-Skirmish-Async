/**
 * Start-of-round abilities must fire exactly ONCE per round.
 *
 * handlers/round.js carried two byte-identical start-of-round ability blocks:
 *
 *   runStartOfRoundDcEffects   reached every round via
 *                              _runInitiativeSwapAndContinue ->
 *                              _continueAfterMissionSor
 *   handleEndStartOfRound      reached when the SECOND player closes their
 *                              start-of-round window (the initiative player's
 *                              Done hands over and returns early)
 *
 * Both iterated BOTH players and neither carried a once-per-round guard, so
 * Brash, Excavation, Force Slow and Shift each resolved TWICE every round —
 * Ezra got two 4-space move pickers. Removed 2026-08-13.
 *
 * The duplicate is easy to reintroduce, because the natural instinct when an
 * ability "does not fire" is to add a second call site rather than fix the
 * first. This asserts each SoR ability dispatches from exactly one place.
 */
import { test, describe } from 'node:test';
import assert from 'node:assert';
import { readFileSync } from 'node:fs';

const SRC = readFileSync(new URL('../../src/handlers/round.js', import.meta.url).pathname, 'utf8');

// Every ability the start-of-round enumerator knows about.
const SOR_ABILITY_IDS = [
  'brash_ezra',
  'force_slow_cal',
  'excavation_aphra',
  'programming_override_4lom',
  'shift_clawdite_elite',
  'shift_clawdite_reg',
  'last_wielder_darksaber_bokatan',
];

describe('start-of-round abilities fire once per round', () => {
  for (const id of SOR_ABILITY_IDS) {
    test(`${id} dispatches from exactly one place in round.js`, () => {
      const hits = (SRC.match(new RegExp(`sIds\\.includes\\('${id}'\\)`, 'g')) || []).length;
      assert.strictEqual(hits, 1,
        `${id} is dispatched from ${hits} sites in round.js. Two sites means it resolves twice `
        + 'every round — the bug removed on 2026-08-13, where Brash granted two 4-space moves. '
        + 'If an ability is not firing, fix the single call site rather than adding a second.');
    });
  }

  test('the ability loop itself exists only once', () => {
    const loops = (SRC.match(/Start-of-round DC passive hooks/g) || []).length;
    assert.strictEqual(loops, 1,
      `found ${loops} start-of-round ability loops in round.js; there must be exactly one`);
  });
});
