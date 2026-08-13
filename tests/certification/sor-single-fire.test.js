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

describe('initiative stolen mid start-of-round phase', () => {
  // alexanbv 2026-08-13: "if init switches during SoR phase due to take init or
  // other effect, the player that took init finishes their SoR, but it does NOT
  // go back to the other player, who had init before it was stolen and already
  // did their SoR."
  //
  // Take Initiative and I Make My Own Luck are both startOfRound timing, so
  // initiative genuinely can flip between the two Done clicks.
  //
  // The handover used to branch on `user === game.initiativePlayerId`, a moving
  // target. P1 goes, hands to P2, P2 steals initiative, and P2's Done then
  // matched the initiative branch a SECOND time — bouncing the window back to
  // P1 and re-running P1's abilities, which they had already resolved.
  test('the window tracks who has gone, not who currently holds initiative', () => {
    const idx = SRC.indexOf('export async function handleEndStartOfRound');
    assert.ok(idx > 0, 'handler found');
    const body = SRC.slice(idx, idx + 3000);

    assert.match(body, /sorWindowDone/,
      'must record which players have already taken their window');
    assert.match(body, /!game\.sorWindowDone\.includes\(_sorOtherNum\)/,
      'handover must be gated on the OTHER player not having gone yet');
    assert.ok(!/if \(interaction\.user\.id === initiativeId\)/.test(body),
      'must NOT branch on current initiative — that is the moving target that '
      + 'bounced the window back when Take Initiative flipped it mid-phase');
  });

  test('the end-of-round window uses the same shape', () => {
    // Nothing can flip initiative during EOR today, but the identity-vs-current
    // -initiative comparison is the wrong shape regardless.
    const idx = SRC.indexOf('export async function handleEndEndOfRound');
    assert.ok(idx > 0);
    const body = SRC.slice(idx, idx + 3000);
    assert.match(body, /eorWindowDone/);
    assert.match(body, /!game\.eorWindowDone\.includes\(_eorOtherNum\)/);
  });

  test('both window-done markers reset each round', () => {
    // A marker surviving into the next round would skip that player's window.
    const AS = readFileSync(new URL('../../src/game/activation-state.js', import.meta.url).pathname, 'utf8');
    const arrayBlock = AS.slice(AS.indexOf('const ROUND_ARRAY_FLAGS'), AS.indexOf('const ROUND_ARRAY_FLAGS') + 1200);
    assert.match(arrayBlock, /'sorWindowDone'/, 'sorWindowDone must reset at round start');
    assert.match(arrayBlock, /'eorWindowDone'/, 'eorWindowDone must reset at round start');
  });
});
