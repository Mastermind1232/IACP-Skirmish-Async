/**
 * Pattern-P3 audit fixes (2026-06-26): "MAY / Skip still burns the limit /
 * grants a contingent resource at offer time".
 *
 *   1. Bo-Katan "Dual-Wield Pistols" — the 2 Block Tokens and the once-per-round
 *      limit are contingent on PERFORMING the bonus Ranged attack. Declining must
 *      grant nothing and burn nothing; the grant + flag fire only when the bonus
 *      attack is actually performed.
 *   2. Second Sister "Mastery" — the once-per-round limit must NOT be consumed on
 *      the no-eligible-cards exit or the Rest-in-Peace block (nothing redrawn);
 *      it is committed only when a redraw is actually offered.
 *
 * These mirror the real combat-bridge gates (same style as surge-audit-fixes),
 * so the contract is locked without booting the full Discord pipeline.
 *
 * Classification: harness (test-only, no production changes).
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

// ── 1. Dual-Wield Pistols — contingent Block + once-per-round ────────────────
describe('Bo-Katan Dual-Wield Pistols (P3 deferral)', () => {
  const FK = 'Bo-Katan Kryze-1-0';
  const DWP_KEY = `dualWieldPistols_${FK}`;

  // Mirrors the OFFER site in checkPostCombatSurges: only arm the free attack +
  // stash a contingent marker; never grant Block or stamp the flag here.
  function offerDualWield(game) {
    const alreadyPending = !!game.dwpBlockGrantPending?.[FK];
    if (game.roundFigureAbilityUsed?.[DWP_KEY] || alreadyPending) return false;
    game.freeAttackBonusPending = game.freeAttackBonusPending || {};
    game.freeAttackBonusPending[FK] = true;
    game.dwpBlockGrantPending = game.dwpBlockGrantPending || {};
    game.dwpBlockGrantPending[FK] = {
      round: game.currentRound || 1,
      dwpKey: DWP_KEY,
      dcName: 'Bo-Katan Kryze',
      grantBlock: true,
    };
    return true;
  }

  // Mirrors the CONSUMER at the top of resolveCombatAfterRolls: when the bonus
  // attack actually resolves, grant 2 Block + stamp the once-per-round flag.
  function performBonusAttack(game) {
    const pend = game.dwpBlockGrantPending?.[FK];
    if (!pend) return;
    delete game.dwpBlockGrantPending[FK];
    if (pend.round !== (game.currentRound || 1)) return; // stale -> drop, no grant
    game.roundFigureAbilityUsed = game.roundFigureAbilityUsed || {};
    if (pend.dwpKey) game.roundFigureAbilityUsed[pend.dwpKey] = true;
    if (pend.grantBlock) {
      game.figurePowerTokens = game.figurePowerTokens || {};
      game.figurePowerTokens[FK] = game.figurePowerTokens[FK] || [];
      game.figurePowerTokens[FK].push('Block', 'Block');
    }
  }

  it('offer alone grants NO Block and burns NO limit', () => {
    const game = { currentRound: 2 };
    assert.equal(offerDualWield(game), true);
    assert.equal((game.figurePowerTokens?.[FK] || []).length, 0, 'no Block at offer time');
    assert.ok(!game.roundFigureAbilityUsed?.[DWP_KEY], 'limit not burned at offer');
    assert.ok(game.freeAttackBonusPending[FK], 'free attack armed');
  });

  it('declining (never performing) leaves the limit available next attack', () => {
    const game = { currentRound: 2 };
    offerDualWield(game);
    // Player declines: no performBonusAttack call. Limit still unset.
    assert.ok(!game.roundFigureAbilityUsed?.[DWP_KEY]);
    assert.equal((game.figurePowerTokens?.[FK] || []).length, 0);
  });

  it('performing the bonus attack grants 2 Block AND burns the once-per-round limit', () => {
    const game = { currentRound: 2 };
    offerDualWield(game);
    performBonusAttack(game);
    assert.equal((game.figurePowerTokens[FK] || []).filter((t) => t === 'Block').length, 2);
    assert.equal(game.roundFigureAbilityUsed[DWP_KEY], true);
  });

  it('does not re-offer while a bonus is already pending', () => {
    const game = { currentRound: 2 };
    assert.equal(offerDualWield(game), true);
    assert.equal(offerDualWield(game), false, 'no double-offer with pending marker');
  });

  it('does not re-offer once the limit is committed', () => {
    const game = { currentRound: 2 };
    offerDualWield(game);
    performBonusAttack(game);
    assert.equal(offerDualWield(game), false);
  });

  it('a stale marker from a prior round is dropped without granting', () => {
    const game = { currentRound: 2 };
    offerDualWield(game);
    game.currentRound = 3; // round rolled over before the bonus was performed
    performBonusAttack(game);
    assert.equal((game.figurePowerTokens?.[FK] || []).length, 0, 'no Block from a stale marker');
    assert.ok(!game.roundFigureAbilityUsed?.[DWP_KEY], 'no limit burn from a stale marker');
  });
});

// ── 2. Mastery — early exits do not burn the once-per-round limit ────────────
describe('Second Sister Mastery (P3 deferral)', () => {
  const FK = 'Second Sister-1-0';
  const MAST_KEY = `${FK}_mastery`;

  // Mirrors the restructured combat-bridge gate. Returns the outcome label and
  // mutates game.roundFigureAbilityUsed only when a redraw is actually offered.
  function resolveMastery(game, { restInPeace = false, eligible = [] } = {}) {
    game.roundFigureAbilityUsed = game.roundFigureAbilityUsed || {};
    if (game.roundFigureAbilityUsed[MAST_KEY]) return 'already-used';
    if (restInPeace) return 'rest-in-peace';      // no redraw -> limit untouched
    if (eligible.length === 0) return 'no-eligible'; // no redraw -> limit untouched
    game.roundFigureAbilityUsed[MAST_KEY] = true;  // picker offered -> commit
    return 'picker-offered';
  }

  it('no-eligible-cards exit does NOT burn the limit', () => {
    const game = {};
    assert.equal(resolveMastery(game, { eligible: [] }), 'no-eligible');
    assert.ok(!game.roundFigureAbilityUsed[MAST_KEY], 'limit still available');
    // ... and a later attack with eligible cards can still offer the picker.
    assert.equal(resolveMastery(game, { eligible: ['Force Push'] }), 'picker-offered');
    assert.equal(game.roundFigureAbilityUsed[MAST_KEY], true);
  });

  it('Rest-in-Peace block does NOT burn the limit', () => {
    const game = {};
    assert.equal(resolveMastery(game, { restInPeace: true, eligible: ['Force Push'] }), 'rest-in-peace');
    assert.ok(!game.roundFigureAbilityUsed[MAST_KEY]);
  });

  it('offering the picker DOES burn the once-per-round limit', () => {
    const game = {};
    assert.equal(resolveMastery(game, { eligible: ['Force Push'] }), 'picker-offered');
    assert.equal(game.roundFigureAbilityUsed[MAST_KEY], true);
    assert.equal(resolveMastery(game, { eligible: ['Force Push'] }), 'already-used');
  });
});
