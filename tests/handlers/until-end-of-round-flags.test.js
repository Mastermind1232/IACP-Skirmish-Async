/**
 * "Until the end of the round" clear-timing regression.
 *
 * Per alexanbv (2026-06-20): effects worded "until the end of the round" turn
 * off at the START of the EOR (status) phase — they fall off BEFORE EOR
 * scoring/triggers resolve. This is distinct from "during this round" effects,
 * which persist THROUGH the EOR phase and only clear at the round boundary.
 *
 * clearUntilEndOfRoundFlags() is the consolidated "until end of round" bucket
 * invoked at the very top of the status-phase logic. This test asserts the
 * flags moved into that bucket (2026-06-20) are gone after it runs:
 *   - roundDefenderCannotBeTargetedUnlessWithinSpaces  (I Must Go Alone)
 *   - roundProgrammingOverrideTrait                    (4-LOM Programming Override)
 * plus the pre-existing members (In the Shadows, Disarm) for regression safety.
 *
 * It also asserts that "during this round" / shared-mixed flags are LEFT intact
 * by this helper (they clear at the round boundary instead).
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { clearUntilEndOfRoundFlags } from '../../src/handlers/round.js';

describe('clearUntilEndOfRoundFlags (start-of-EOR-phase clearing)', () => {
  it('clears "until the end of the round" effects before EOR effects resolve', () => {
    const game = {
      // until-end-of-round effects (should be cleared)
      roundInTheShadows: { playerNum: 1, figureKey: 'Obi-Wan-1' },
      disarmPermanentWeakened: { 'Trooper-1': true },
      roundDefenderCannotBeTargetedUnlessWithinSpaces: { playerNum: 1, spaces: 3, figureKey: 'Obi-Wan-1' },
      roundProgrammingOverrideTrait: { 1: 'TROOPER', 2: 'HUNTER' },
    };

    clearUntilEndOfRoundFlags(game);

    // In the Shadows + Disarm (pre-existing members)
    assert.equal(game.roundInTheShadows, null, 'In the Shadows should fall off at EOR-phase start');
    assert.deepEqual(game.disarmPermanentWeakened, {}, 'Disarm Weakened lock should clear at EOR-phase start');

    // I Must Go Alone — targeting/defense buff, "until the end of the round"
    assert.equal(
      game.roundDefenderCannotBeTargetedUnlessWithinSpaces,
      null,
      'I Must Go Alone targeting protection should fall off at EOR-phase start',
    );

    // Programming Override — TRAIT grant "until the end of the round"; must be
    // gone before EOR scoring/triggers (which can check traits) evaluate.
    assert.deepEqual(
      game.roundProgrammingOverrideTrait,
      {},
      'Programming Override TRAIT grant should fall off at EOR-phase start',
    );
  });

  it('leaves "during this round" / shared-mixed flags untouched', () => {
    const game = {
      // shared additive defense counters (mixed during-round / until-EOR feeders)
      roundDefenseBonusBlock: { 1: 2 },
      roundDefenseBonusEvade: { 1: 1 },
      roundDefenseAccuracyPenalty: { 1: 2 },
      // attack-surge shared counter (Smuggled Supplies + Payback/Reverse Engineer)
      roundAttackSurgeBonus: { 1: 1 },
      // movement-only "until end of round" (cannot matter during EOR)
      roundEfficientTravel: { 1: true },
      // pure "during this round" effects
      roundTrooperSurgeStun: { 1: true },
      roundUtinniJawaBuffs: true,
      roundPushImmuneUnlessMassive: { 'Tank-1': true },
    };

    clearUntilEndOfRoundFlags(game);

    assert.deepEqual(game.roundDefenseBonusBlock, { 1: 2 });
    assert.deepEqual(game.roundDefenseBonusEvade, { 1: 1 });
    assert.deepEqual(game.roundDefenseAccuracyPenalty, { 1: 2 });
    assert.deepEqual(game.roundAttackSurgeBonus, { 1: 1 });
    assert.deepEqual(game.roundEfficientTravel, { 1: true });
    assert.deepEqual(game.roundTrooperSurgeStun, { 1: true });
    assert.equal(game.roundUtinniJawaBuffs, true);
    assert.deepEqual(game.roundPushImmuneUnlessMassive, { 'Tank-1': true });
  });
});
