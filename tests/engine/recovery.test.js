/**
 * Tests for the recovery system: needsRecovery() and getRecoveryReason().
 * Verifies that needsRecovery correctly identifies stuck games
 * across all major pending state categories, and that getRecoveryReason
 * returns meaningful diagnostics for each.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert';
import { needsRecovery, getRecoveryReason } from '../../src/engine/recovery.js';

describe('needsRecovery()', () => {
  it('returns false for null/ended games', () => {
    assert.strictEqual(needsRecovery(null), false);
    assert.strictEqual(needsRecovery({ ended: true }), false);
  });

  it('returns false for a clean active game with no pending state', () => {
    assert.strictEqual(needsRecovery({ phase: 'round_active' }), false);
  });

  // Original 4 checks
  it('detects phaseGate', () => {
    assert.strictEqual(needsRecovery({ phaseGate: { phase: 'status' } }), true);
  });

  it('detects setupAttachmentPhase', () => {
    assert.strictEqual(needsRecovery({ setupAttachmentPhase: true }), true);
    assert.strictEqual(needsRecovery({ setupAttachmentPhase: false }), false);
  });

  it('detects pendingCombat', () => {
    assert.strictEqual(needsRecovery({ pendingCombat: { attackerMsgId: 'x' } }), true);
  });

  it('detects moveInProgress', () => {
    assert.strictEqual(needsRecovery({ moveInProgress: { 'key1': { mpRemaining: 3 } } }), true);
    // Empty object should not trigger
    assert.strictEqual(needsRecovery({ moveInProgress: {} }), false);
  });

  it('detects currentActivationTurnPlayerId', () => {
    assert.strictEqual(needsRecovery({ currentActivationTurnPlayerId: '123' }), true);
  });

  it('detects endOfRoundWhoseTurn', () => {
    assert.strictEqual(needsRecovery({ endOfRoundWhoseTurn: '123' }), true);
  });

  it('detects pendingEndTurn (non-empty object)', () => {
    assert.strictEqual(needsRecovery({ pendingEndTurn: { 'ch1': 'msg1' } }), true);
    assert.strictEqual(needsRecovery({ pendingEndTurn: {} }), false);
  });

  // New blocking pending sub-states
  it('detects pendingNegation', () => {
    assert.strictEqual(needsRecovery({ pendingNegation: { playedBy: 1 } }), true);
  });

  it('detects pendingCoverFire', () => {
    assert.strictEqual(needsRecovery({ pendingCoverFire: { figureKey: 'Trooper-0-0' } }), true);
  });

  it('detects pendingStrainChoice (non-empty object)', () => {
    assert.strictEqual(needsRecovery({ pendingStrainChoice: { 'msg1': { playerNum: 1 } } }), true);
    assert.strictEqual(needsRecovery({ pendingStrainChoice: {} }), false);
  });

  it('detects pendingCcConfirmation', () => {
    assert.strictEqual(needsRecovery({ pendingCcConfirmation: { playerNum: 1, card: 'Parting Blow' } }), true);
  });

  it('detects pendingCcChoice', () => {
    assert.strictEqual(needsRecovery({ pendingCcChoice: { gameId: 'g1' } }), true);
    assert.strictEqual(needsRecovery({ pendingCcChoice: {} }), false);
  });

  it('detects pendingCcSpaceChoice', () => {
    assert.strictEqual(needsRecovery({ pendingCcSpaceChoice: { gameId: 'g1' } }), true);
    assert.strictEqual(needsRecovery({ pendingCcSpaceChoice: {} }), false);
  });

  it('detects pendingStillFaster', () => {
    assert.strictEqual(needsRecovery({ pendingStillFaster: { sftPlayerNum: 2 } }), true);
  });

  it('detects pendingPowerTokenGrant', () => {
    assert.strictEqual(needsRecovery({ pendingPowerTokenGrant: { grants: [] } }), true);
  });

  it('detects pendingCelebration', () => {
    assert.strictEqual(needsRecovery({ pendingCelebration: { vp: 2 } }), true);
  });

  it('detects pendingDcAbilityChoice (non-empty object)', () => {
    assert.strictEqual(needsRecovery({ pendingDcAbilityChoice: { 'msg1': { choices: [] } } }), true);
    assert.strictEqual(needsRecovery({ pendingDcAbilityChoice: {} }), false);
  });

  it('detects pendingRushPush', () => {
    assert.strictEqual(needsRecovery({ pendingRushPush: { figureKey: 'Onar-0-0' } }), true);
  });

  it('does NOT detect pendingBleeding (headless-only, never set in production)', () => {
    assert.strictEqual(needsRecovery({ pendingBleeding: { playerNum: 1, figureKey: 'Trooper-0-0' } }), false);
  });

  it('detects pendingLastResort', () => {
    assert.strictEqual(needsRecovery({ pendingLastResort: { figureKey: 'Probe-0-0' } }), true);
  });

  it('detects pendingFalseOrders', () => {
    assert.strictEqual(needsRecovery({ pendingFalseOrders: { playerNum: 2 } }), true);
  });

  it('detects forceVisionPending', () => {
    assert.strictEqual(needsRecovery({ forceVisionPending: 1 }), true);
  });

  it('detects cc_draw phase with undrawn hands', () => {
    assert.strictEqual(needsRecovery({ phase: 'cc_draw', player1CcDrawn: false, player2CcDrawn: false }), true);
    assert.strictEqual(needsRecovery({ phase: 'cc_draw', player1CcDrawn: true, player2CcDrawn: false }), true);
    assert.strictEqual(needsRecovery({ phase: 'cc_draw', player1CcDrawn: true, player2CcDrawn: true }), false);
  });
});

describe('getRecoveryReason()', () => {
  it('returns null for null/ended games', () => {
    assert.strictEqual(getRecoveryReason(null), null);
    assert.strictEqual(getRecoveryReason({ ended: true }), null);
  });

  it('returns null for a clean active game', () => {
    assert.strictEqual(getRecoveryReason({ phase: 'round_active' }), null);
  });

  it('returns descriptive string for phaseGate', () => {
    assert.strictEqual(getRecoveryReason({ phaseGate: { phase: 'status' } }), 'phaseGate(status)');
    assert.strictEqual(getRecoveryReason({ phaseGate: {} }), 'phaseGate(?)');
  });

  it('returns descriptive string for pendingCombat', () => {
    assert.match(getRecoveryReason({ pendingCombat: { rerollPhase: 'attacker' } }), /pendingCombat.*reroll=true/);
    assert.match(getRecoveryReason({ pendingCombat: {} }), /pendingCombat.*reroll=false/);
  });

  it('returns reason for moveInProgress', () => {
    assert.strictEqual(getRecoveryReason({ moveInProgress: { k: {} } }), 'moveInProgress');
    assert.strictEqual(getRecoveryReason({ moveInProgress: {} }), null);
  });

  it('returns reason for pendingCcConfirmation with card name', () => {
    assert.strictEqual(getRecoveryReason({ pendingCcConfirmation: { card: 'Parting Blow' } }), 'pendingCcConfirmation(Parting Blow)');
    assert.strictEqual(getRecoveryReason({ pendingCcConfirmation: {} }), 'pendingCcConfirmation(?)');
  });

  it('returns reason for setupAttachmentPhase', () => {
    assert.strictEqual(getRecoveryReason({ setupAttachmentPhase: true }), 'setupAttachmentPhase');
    assert.strictEqual(getRecoveryReason({ setupAttachmentPhase: false }), null);
  });

  it('returns reason for endOfRoundWhoseTurn', () => {
    assert.strictEqual(getRecoveryReason({ endOfRoundWhoseTurn: '123' }), 'endOfRoundWhoseTurn');
  });

  it('returns reason for pendingEndTurn (non-empty object)', () => {
    assert.strictEqual(getRecoveryReason({ pendingEndTurn: { 'ch1': 'msg1' } }), 'pendingEndTurn');
    assert.strictEqual(getRecoveryReason({ pendingEndTurn: {} }), null);
  });

  it('returns reason for all simple boolean-like states', () => {
    assert.strictEqual(getRecoveryReason({ currentActivationTurnPlayerId: '123' }), 'currentActivationTurn');
    assert.strictEqual(getRecoveryReason({ pendingNegation: {} }), 'pendingNegation');
    assert.strictEqual(getRecoveryReason({ pendingCoverFire: {} }), 'pendingCoverFire');
    assert.strictEqual(getRecoveryReason({ pendingStillFaster: {} }), 'pendingStillFaster');
    assert.strictEqual(getRecoveryReason({ pendingPowerTokenGrant: {} }), 'pendingPowerTokenGrant');
    assert.strictEqual(getRecoveryReason({ pendingCelebration: {} }), 'pendingCelebration');
    assert.strictEqual(getRecoveryReason({ pendingRushPush: {} }), 'pendingRushPush');
    assert.strictEqual(getRecoveryReason({ pendingLastResort: {} }), 'pendingLastResort');
    assert.strictEqual(getRecoveryReason({ pendingFalseOrders: {} }), 'pendingFalseOrders');
    assert.strictEqual(getRecoveryReason({ forceVisionPending: 1 }), 'forceVisionPending');
  });

  it('does NOT return reason for pendingBleeding (headless-only)', () => {
    assert.strictEqual(getRecoveryReason({ pendingBleeding: { playerNum: 1 } }), null);
  });

  it('returns reason for CC choice/space choice', () => {
    assert.strictEqual(getRecoveryReason({ pendingCcChoice: { gameId: 'g1' } }), 'pendingCcChoice');
    assert.strictEqual(getRecoveryReason({ pendingCcChoice: {} }), null);
    assert.strictEqual(getRecoveryReason({ pendingCcSpaceChoice: { gameId: 'g1' } }), 'pendingCcSpaceChoice');
    assert.strictEqual(getRecoveryReason({ pendingCcSpaceChoice: {} }), null);
  });

  it('returns reason for object-guarded states', () => {
    assert.strictEqual(getRecoveryReason({ pendingStrainChoice: { k: {} } }), 'pendingStrainChoice');
    assert.strictEqual(getRecoveryReason({ pendingStrainChoice: {} }), null);
    assert.strictEqual(getRecoveryReason({ pendingDcAbilityChoice: { k: {} } }), 'pendingDcAbilityChoice');
    assert.strictEqual(getRecoveryReason({ pendingDcAbilityChoice: {} }), null);
  });

  it('returns reason for cc_draw phase', () => {
    assert.strictEqual(getRecoveryReason({ phase: 'cc_draw', player1CcDrawn: false }), 'ccDrawPending');
    assert.strictEqual(getRecoveryReason({ phase: 'cc_draw', player1CcDrawn: true, player2CcDrawn: true }), null);
  });

  it('returns first matching reason (priority order)', () => {
    // phaseGate takes priority over pendingCombat
    const reason = getRecoveryReason({ phaseGate: { phase: 'deploy' }, pendingCombat: {} });
    assert.strictEqual(reason, 'phaseGate(deploy)');
  });
});
