/**
 * Behavioral oracle for the named-CC per-timing-instance tracker.
 *
 * Per destruct 2026-05-07: "Only one copy of a named Command Card can be
 * played per timing instance." Generalizes the previous ad-hoc flags
 * (jundlandTerrorPlayedThisEor, reinforcementsPlayedThisSor) to all
 * named CCs across SOR / EOR / status / activation / attack buckets.
 *
 * The Aphra Excavation rule ("can excavate and play a SOR card only if
 * not played by the Aphra player in that same SOR phase") is the
 * canonical use case.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  markNamedCcPlayed,
  isNamedCcAlreadyPlayed,
  clearNamedCcBucket,
  timingToBucket,
} from '../../../src/game/named-cc-tracker.js';

test('timingToBucket: maps canonical timings to buckets', () => {
  assert.equal(timingToBucket('startOfRound'), 'sor');
  assert.equal(timingToBucket('startOfStatusPhase'), 'sor');
  assert.equal(timingToBucket('endOfRound'), 'eor');
  assert.equal(timingToBucket('duringActivation'), 'activation');
  assert.equal(timingToBucket('startOfActivation'), 'activation');
  assert.equal(timingToBucket('endOfActivation'), 'activation');
  assert.equal(timingToBucket('duringAttack'), 'attack');
  assert.equal(timingToBucket('whenAttacked'), 'attack');
});

test('timingToBucket: returns null for un-tracked event timings', () => {
  // Event-bound interrupts (PB exit, SoTR, etc.) are not tracked here.
  assert.equal(timingToBucket('whenHostileExitsAdjacentSpace'), null);
  assert.equal(timingToBucket(''), null);
  assert.equal(timingToBucket(null), null);
});

test('mark + isAlreadyPlayed: same player same card same timing → true', () => {
  const game = {};
  assert.equal(isNamedCcAlreadyPlayed(game, 1, 'Take Cover', 'startOfRound'), false);
  markNamedCcPlayed(game, 1, 'Take Cover', 'startOfRound');
  assert.equal(isNamedCcAlreadyPlayed(game, 1, 'Take Cover', 'startOfRound'), true);
});

test('mark: per-player isolation', () => {
  const game = {};
  markNamedCcPlayed(game, 1, 'Take Cover', 'startOfRound');
  // P2 hasn't played it → still legal
  assert.equal(isNamedCcAlreadyPlayed(game, 2, 'Take Cover', 'startOfRound'), false);
});

test('mark: per-bucket isolation', () => {
  const game = {};
  // Same card name played in two different timings: both legal independently
  markNamedCcPlayed(game, 1, 'Provoke', 'startOfRound');
  assert.equal(isNamedCcAlreadyPlayed(game, 1, 'Provoke', 'startOfRound'), true);
  // EOR bucket is distinct
  assert.equal(isNamedCcAlreadyPlayed(game, 1, 'Provoke', 'endOfRound'), false);
});

test('clearNamedCcBucket: resets only the named bucket', () => {
  const game = {};
  markNamedCcPlayed(game, 1, 'Take Cover', 'startOfRound');
  markNamedCcPlayed(game, 1, 'Brace', 'duringAttack');
  clearNamedCcBucket(game, 'sor');
  // SOR cleared
  assert.equal(isNamedCcAlreadyPlayed(game, 1, 'Take Cover', 'startOfRound'), false);
  // attack bucket survives
  assert.equal(isNamedCcAlreadyPlayed(game, 1, 'Brace', 'duringAttack'), true);
});

test('Aphra Excavation rule: replay of same-SOR card blocked', () => {
  // Aphra's player plays Take Cover at SOR.
  const game = {};
  markNamedCcPlayed(game, 1, 'Take Cover', 'startOfRound');
  // Aphra retrieves Take Cover from discard via Excavation.
  // Now the player tries to play Take Cover again this SOR — must reject.
  assert.equal(isNamedCcAlreadyPlayed(game, 1, 'Take Cover', 'startOfRound'), true,
    'Aphra cannot replay a card she just played this SOR');
});

test('Round-start cleanup: namedCcsPlayedPerTiming reset to {} via ROUND_OBJECT_FLAGS', async () => {
  // Via activation-state.js ROUND_OBJECT_FLAGS, the field resets to {} at
  // round start. Verify the field is registered in that list.
  const { ROUND_OBJECT_FLAGS } = await import('../../../src/game/activation-state.js');
  assert.ok(ROUND_OBJECT_FLAGS.includes('namedCcsPlayedPerTiming'),
    'namedCcsPlayedPerTiming registered in ROUND_OBJECT_FLAGS');
});

test('mark: no-op for unknown timing string', () => {
  const game = {};
  markNamedCcPlayed(game, 1, 'Foo', 'whenSomethingObscure');
  // No bucket → field not even initialized
  assert.equal(game.namedCcsPlayedPerTiming, undefined);
});
