/**
 * Tier 3 Legality-Oracle Probes: CC Timing Legality (D6)
 *
 * PROBE-CC-001: Start-of-Round card playable in SoR window, not during activation
 *   a) SoR window open → startOfRound card playable
 *   b) Activation phase (no SoR) → startOfRound card not playable
 *
 * PROBE-CC-002: During-attack card requires combat state
 *   a) No combat → duringAttack card not playable
 *   b) pendingCombat exists → duringAttack card playable
 *   c) Combat with ccLockedOut (Assassinate) → duringAttack card blocked
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { isCcPlayableNow, getCcPlayContext } from '../../../src/game/cc-timing.js';

/** Mock getCcEffect that returns a fixed timing for any card name. */
const mockGetEffect = (timing) => () => ({ timing });

/** Build minimal game state for CC timing tests. */
function buildCcGame(overrides = {}) {
  return {
    player1Id: 'player1',
    player2Id: 'player2',
    currentRound: 1,
    startOfRoundWhoseTurn: null,
    currentActivationTurnPlayerId: null,
    endOfRoundWhoseTurn: null,
    combat: null,
    pendingCombat: null,
    ...overrides,
  };
}

// ── PROBE-CC-001: SoR window exclusion ──────────────────────────────────────

describe('PROBE-CC-001: Start-of-Round CC playable in SoR window, not during activation', () => {
  it('001a: SoR window open → startOfRound card IS playable', () => {
    const game = buildCcGame({
      startOfRoundWhoseTurn: 'player1',
    });
    const playable = isCcPlayableNow(game, 1, 'TestSoRCard', mockGetEffect('startofround'));
    assert.equal(playable, true, 'startOfRound card should be playable during SoR window');
  });

  it('001b: activation phase (SoR window closed) → startOfRound card NOT playable', () => {
    const game = buildCcGame({
      startOfRoundWhoseTurn: null, // SoR window closed
      currentActivationTurnPlayerId: 'player1', // In activation
    });
    const playable = isCcPlayableNow(game, 1, 'TestSoRCard', mockGetEffect('startofround'));
    assert.equal(playable, false, 'startOfRound card should NOT be playable during activation');

    // Verify context flags to confirm the exclusion mechanism
    const ctx = getCcPlayContext(game, 1);
    assert.equal(ctx.startOfRound, false, 'startOfRound context flag should be false');
    assert.equal(ctx.duringActivation, true, 'duringActivation context flag should be true');
  });
});

// ── PROBE-CC-002: During-attack card requires combat state ──────────────────

describe('PROBE-CC-002: During-attack CC requires combat; ccLockedOut blocks it', () => {
  it('002a: no combat → duringAttack card NOT playable', () => {
    const game = buildCcGame({
      currentActivationTurnPlayerId: 'player1',
    });
    const playable = isCcPlayableNow(game, 1, 'TestAttackCard', mockGetEffect('duringattack'));
    assert.equal(playable, false, 'duringAttack card should NOT be playable without combat');
  });

  it('002b: pendingCombat exists → duringAttack card IS playable', () => {
    const game = buildCcGame({
      currentActivationTurnPlayerId: 'player1',
      pendingCombat: { attackerPlayerNum: 1, defenderPlayerNum: 2 },
    });
    const playable = isCcPlayableNow(game, 1, 'TestAttackCard', mockGetEffect('duringattack'));
    assert.equal(playable, true, 'duringAttack card should be playable with pendingCombat');
  });

  it('002c: combat with ccLockedOut (Assassinate) → duringAttack card blocked', () => {
    const game = buildCcGame({
      currentActivationTurnPlayerId: 'player1',
      pendingCombat: { attackerPlayerNum: 1, defenderPlayerNum: 2, ccLockedOut: true },
    });
    const playable = isCcPlayableNow(game, 1, 'TestAttackCard', mockGetEffect('duringattack'));
    assert.equal(playable, false, 'duringAttack card should be BLOCKED when ccLockedOut is set (Assassinate)');
  });
});
