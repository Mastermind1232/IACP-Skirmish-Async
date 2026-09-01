/**
 * There Is No Try — the "within 4 spaces" clause.
 *
 * The card reads "Use when a friendly REBEL FORCE USER **within 4 spaces** rolls
 * any number of dice." That range clause was not enforced anywhere: any friendly
 * REBEL FORCE USER qualified from anywhere on the board. alexanbv 2026-08-31:
 * "you must enforce ALL range limits."
 */
import { test, describe } from 'node:test';
import assert from 'node:assert';
import {
  THERE_IS_NO_TRY_MAX_DISTANCE,
  thereIsNoTryInRange,
  thereIsNoTryRollerEligible,
  resolveThereIsNoTrySourceFigure,
} from './there-is-no-try-helpers.js';

describe('There Is No Try range clause', () => {
  test('the printed range is 4 spaces', () => {
    assert.strictEqual(THERE_IS_NO_TRY_MAX_DISTANCE, 4);
  });

  test('0 through 4 spaces are in range, 5 is not', () => {
    for (const d of [0, 1, 2, 3, 4]) {
      assert.ok(thereIsNoTryInRange(d), `${d} spaces should be in range`);
    }
    assert.ok(!thereIsNoTryInRange(5), '5 spaces is out of range');
    assert.ok(!thereIsNoTryInRange(50), 'far away is out of range');
  });

  test('an UNKNOWN distance is out of range, not in', () => {
    // countSpaces returns Infinity when there is no path or no map. Treating
    // that as "in range" is how a range clause silently stops existing.
    assert.ok(!thereIsNoTryInRange(Infinity), 'no path is not in range');
    assert.ok(!thereIsNoTryInRange(NaN), 'NaN is not in range');
    assert.ok(!thereIsNoTryInRange(undefined), 'undefined is not in range');
    assert.ok(!thereIsNoTryInRange(null), 'null is not in range');
    assert.ok(!thereIsNoTryInRange('2'), 'a string is not in range');
  });
});

describe('There Is No Try roller eligibility', () => {
  test('needs BOTH Rebel and Force User', () => {
    assert.ok(thereIsNoTryRollerEligible(['REBEL', 'FORCE USER']));
    assert.ok(thereIsNoTryRollerEligible(['LEADER', 'rebel', 'force user']), 'case-insensitive');
    assert.ok(!thereIsNoTryRollerEligible(['REBEL']), 'Rebel alone is not enough');
    assert.ok(!thereIsNoTryRollerEligible(['FORCE USER']), 'Force User alone is not enough');
    assert.ok(!thereIsNoTryRollerEligible(['IMPERIAL', 'FORCE USER']), 'an Imperial Force User does not qualify');
    assert.ok(!thereIsNoTryRollerEligible([]), 'no keywords');
    assert.ok(!thereIsNoTryRollerEligible(null), 'missing keywords');
  });
});

describe('There Is No Try source figure', () => {
  const dcNameFromFigureKey = (fk) => String(fk).replace(/-\d+-\d+$/, '');

  test('prefers the figure recorded when the card was played', () => {
    const game = {
      thereIsNoTrySourceFigureKey: 'Yoda-1-0',
      figurePositions: { 1: { 'Yoda-1-0': 'c3', 'Luke Skywalker-2-0': 'd4' } },
    };
    assert.strictEqual(resolveThereIsNoTrySourceFigure(game, 1, dcNameFromFigureKey), 'Yoda-1-0');
  });

  test('falls back to finding Yoda when nothing was recorded', () => {
    // Covers a game saved before the key was recorded: losing the range check
    // would be bad, but losing the whole ability would be worse.
    const game = { figurePositions: { 1: { 'Luke Skywalker-2-0': 'd4', 'Yoda-1-0': 'c3' } } };
    assert.strictEqual(resolveThereIsNoTrySourceFigure(game, 1, dcNameFromFigureKey), 'Yoda-1-0');
  });

  test('ignores a recorded figure that has left the board', () => {
    const game = {
      thereIsNoTrySourceFigureKey: 'Yoda-1-0',
      figurePositions: { 1: { 'Luke Skywalker-2-0': 'd4' } },
    };
    assert.strictEqual(resolveThereIsNoTrySourceFigure(game, 1, dcNameFromFigureKey), null,
      'a defeated Yoda gives no anchor to measure from');
  });

  test('returns null when Yoda is not in play at all', () => {
    const game = { figurePositions: { 1: { 'Luke Skywalker-2-0': 'd4' } } };
    assert.strictEqual(resolveThereIsNoTrySourceFigure(game, 1, dcNameFromFigureKey), null);
  });

  test('does not mistake another figure for Yoda', () => {
    const game = { figurePositions: { 1: { 'Yodas Apprentice-1-0': 'c3' } } };
    assert.strictEqual(
      resolveThereIsNoTrySourceFigure(game, 1, dcNameFromFigureKey), null,
      'the match is anchored on a word boundary, not a prefix',
    );
  });
});

describe('the range clause is actually WIRED, not merely available', () => {
  // A helper nobody calls is exactly how this clause went missing in the first
  // place: the card said "within 4 spaces" and no code anywhere measured it.
  test('handlers/combat.js gates the There Is No Try offer on the range check', async () => {
    const { readFileSync } = await import('node:fs');
    const { fileURLToPath } = await import('node:url');
    const src = readFileSync(fileURLToPath(new URL('../handlers/combat.js', import.meta.url)), 'utf8');
    assert.ok(src.includes('thereIsNoTryInRange('), 'the offer site measures the distance');
    assert.ok(src.includes('resolveThereIsNoTrySourceFigure('), 'and measures it from the Yoda that played the card');
  });

  test('the resolver records which Yoda played the card', async () => {
    const { readFileSync } = await import('node:fs');
    const { fileURLToPath } = await import('node:url');
    const src = readFileSync(fileURLToPath(new URL('./abilities.js', import.meta.url)), 'utf8');
    assert.ok(
      /thereIsNoTrySourceFigureKey\s*=\s*_tintSrc/.test(src),
      'setsTherIsNoTry stores the declared figure while ccPlayedByFigureKey still exists',
    );
  });

  test('the recorded figure is round-scoped like the rest of the card', async () => {
    const { readFileSync } = await import('node:fs');
    const { fileURLToPath } = await import('node:url');
    const src = readFileSync(fileURLToPath(new URL('./activation-state.js', import.meta.url)), 'utf8');
    assert.ok(src.includes("'thereIsNoTrySourceFigureKey'"),
      'otherwise the anchor outlives the card that set it');
  });
});
