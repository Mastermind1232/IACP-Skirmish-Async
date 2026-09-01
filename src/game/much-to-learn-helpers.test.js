/**
 * Much to Learn (Ezra Bridger) — which of the two outcomes is legal.
 *
 * Card: "While attacking, if there is another friendly unique figure within 3
 * spaces, you may reroll 1 attack die. If that figure is a FORCE USER, you may
 * turn that attack die to any side instead."
 *
 * The two outcomes are not interchangeable — a reroll is random, turning a die
 * is chosen — so picking the wrong one silently changes the card's strength.
 * alexanbv 2026-08-31: "For Ezra make sure there is a logic path to detect which
 * option is legal."
 */
import { test, describe } from 'node:test';
import assert from 'node:assert';
import { resolveMuchToLearnMode, MUCH_TO_LEARN_MAX_DISTANCE } from './much-to-learn-helpers.js';

const eff = ({ unique = true, forceUser = false } = {}) => ({
  unique,
  keywords: forceUser ? ['REBEL', 'FORCE USER'] : ['REBEL'],
});
const cand = (figureKey, distance, opts) => ({
  figureKey, dcName: figureKey.replace(/-\d+-\d+$/, ''), effect: eff(opts), distance,
});
const SELF = 'Ezra Bridger-1-0';

describe('Much to Learn mode selection', () => {
  test('the printed range is 3 spaces', () => {
    assert.strictEqual(MUCH_TO_LEARN_MAX_DISTANCE, 3);
  });

  test('a friendly unique in range gives a reroll', () => {
    const r = resolveMuchToLearnMode([cand('Hera Syndulla-2-0', 3)], SELF);
    assert.strictEqual(r.mode, 'reroll');
    assert.strictEqual(r.sourceName, 'Hera Syndulla');
  });

  test('a FORCE USER in range upgrades it to a die turn', () => {
    const r = resolveMuchToLearnMode([cand('Kanan Jarrus-2-0', 2, { forceUser: true })], SELF);
    assert.strictEqual(r.mode, 'turn');
  });

  test('a FORCE USER wins even when a plain unique is found first', () => {
    // 'turn' is strictly better, so scan order must not decide the outcome.
    const r = resolveMuchToLearnMode([
      cand('Hera Syndulla-2-0', 1),
      cand('Kanan Jarrus-3-0', 3, { forceUser: true }),
    ], SELF);
    assert.strictEqual(r.mode, 'turn');
    assert.strictEqual(r.sourceName, 'Kanan Jarrus');
  });

  test('a FORCE USER OUT of range does not upgrade anything', () => {
    const r = resolveMuchToLearnMode([
      cand('Hera Syndulla-2-0', 2),
      cand('Kanan Jarrus-3-0', 4, { forceUser: true }),
    ], SELF);
    assert.strictEqual(r.mode, 'reroll', 'the out-of-range Force User is ignored');
  });

  test('4 spaces is out of range', () => {
    assert.strictEqual(resolveMuchToLearnMode([cand('Kanan Jarrus-2-0', 4, { forceUser: true })], SELF), null);
  });

  test('a non-unique friendly does not trigger it', () => {
    assert.strictEqual(resolveMuchToLearnMode([cand('Rebel Trooper-2-0', 1, { unique: false })], SELF), null);
  });

  test('Ezra cannot trigger off himself', () => {
    // "ANOTHER friendly unique figure" — self is excluded even at distance 0.
    assert.strictEqual(resolveMuchToLearnMode([cand(SELF, 0, { forceUser: true })], SELF), null);
  });

  test('an unknown distance never qualifies', () => {
    assert.strictEqual(resolveMuchToLearnMode([cand('Kanan Jarrus-2-0', Infinity, { forceUser: true })], SELF), null);
  });

  test('nothing nearby, and malformed input, both yield no ability', () => {
    assert.strictEqual(resolveMuchToLearnMode([], SELF), null);
    assert.strictEqual(resolveMuchToLearnMode(null, SELF), null);
    assert.strictEqual(resolveMuchToLearnMode([null, undefined], SELF), null);
  });

  test('the handler actually uses this helper', async () => {
    const { readFileSync } = await import('node:fs');
    const { fileURLToPath } = await import('node:url');
    const src = readFileSync(fileURLToPath(new URL('../handlers/combat.js', import.meta.url)), 'utf8');
    assert.ok(src.includes('resolveMuchToLearnMode('), 'combat.js decides the mode via the helper');
  });
});
