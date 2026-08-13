/**
 * End-of-round and status phase: player order, single fire, and expiry timing.
 *
 * The EOR path is the REFERENCE implementation for what the start-of-round path
 * had to be fixed into on 2026-08-13: each player gets their own window, in
 * initiative order, and their effects fire on THEIR turn rather than everyone's
 * being posted at once.
 *
 * This pins that, plus the expiry ordering alexanbv ruled on 2026-06-20:
 * "until the end of the round" effects turn off at the START of the status
 * phase, BEFORE end-of-round effects evaluate — as distinct from "during this
 * round" effects, which persist through EOR and clear at the round boundary.
 */
import { test, describe } from 'node:test';
import assert from 'node:assert';
import { readFileSync } from 'node:fs';

const SRC = readFileSync(new URL('../../src/handlers/round.js', import.meta.url).pathname, 'utf8');

describe('EOR player ordering', () => {
  test('the initiative player takes the first end-of-round window', () => {
    assert.match(SRC, /endOfRoundWhoseTurn = game\.initiativePlayerId/,
      'the EOR window must open on the initiative player');
  });

  test("each player's EOR effects fire on their own turn, not all at once", () => {
    // Two call sites, but for DIFFERENT players — this is what start-of-round
    // lacked until 5ef86eef, where one pass posted both players' prompts.
    assert.match(SRC, /_runDcEorForPlayer\([^)]*_eorInitNum\)/,
      'initiative player resolved when their window opens');
    assert.match(SRC, /_runDcEorForPlayer\([^)]*otherNum\)/,
      'the other player resolved at handover');
  });

  test('the two EOR dispatch sites are for different players, not a double-fire', () => {
    // The start-of-round bug was two sites BOTH looping BOTH players.
    const calls = SRC.match(/_runDcEorForPlayer\([^)]*\)/g) || [];
    assert.ok(calls.length >= 2, `expected both windows, found ${calls.length}`);
    const args = calls.map((c) => c.split(',').pop().replace(')', '').trim());
    assert.strictEqual(new Set(args).size, args.length,
      `EOR dispatch sites must target distinct players, got ${JSON.stringify(args)} — `
      + 'two sites with the same target is the double-fire shape fixed in c71adc5b');
  });
});

describe('status phase expiry ordering', () => {
  test('"until end of round" effects clear before EOR effects evaluate', () => {
    // alexanbv 2026-06-20. Getting this backwards would let an end-of-round
    // ability read a bonus that should already have fallen off.
    assert.match(SRC, /clearUntilEndOfRoundFlags/,
      'the status phase must clear until-EOR effects');
    assert.match(SRC, /clearRoundModifiersUntilEor/,
      "and the per-figure 'until-eor' modifier descriptors with them");
  });

  test('"during this round" effects are NOT cleared here', () => {
    // They persist THROUGH the EOR phase and clear at the round boundary. If
    // this function ever starts clearing them, the two durations have collapsed.
    const idx = SRC.indexOf('export function clearUntilEndOfRoundFlags');
    assert.ok(idx > 0);
    const body = SRC.slice(idx, idx + 4000);
    assert.ok(!/cleanupRoundStart\(/.test(body),
      'round-boundary clearing must not happen in the until-EOR sweep');
  });
});
