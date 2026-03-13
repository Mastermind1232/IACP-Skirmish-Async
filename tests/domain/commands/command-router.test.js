import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { customIdToCommand, parsePayloadFromCustomId, PREFIX_TO_COMMAND } from '../../../src/domain/commands/command-router.js';

describe('command-router', () => {
  it('customIdToCommand maps phase gate via handlerKey', () => {
    const cmd = customIdToCommand('phase_gate_ready_12345_1', 'phase_gate_ready_', 'user1', 'g1');
    assert.equal(cmd.type, 'PhaseGateReady');
    assert.equal(cmd.payload.gameId, '12345');
    assert.equal(cmd.payload.playerNum, 1);
  });

  it('customIdToCommand maps combat prefixes', () => {
    const cmd = customIdToCommand('combat_ready_12345_2', 'combat_ready_', 'user1', 'g1');
    assert.equal(cmd.type, 'ReadyForCombat');
    assert.equal(cmd.payload.playerNum, 2);

    const cmd2 = customIdToCommand('combat_surge_12345_pierce_2', 'combat_surge_', 'user1', 'g1');
    assert.equal(cmd2.type, 'SpendSurge');
    assert.equal(cmd2.payload.surgeKey, 'pierce_2');
  });

  it('customIdToCommand maps activation prefixes', () => {
    const cmd = customIdToCommand('dc_activate_12345_msg1', 'dc_activate_', 'user1', 'g1');
    assert.equal(cmd.type, 'ActivateDc');

    const cmd2 = customIdToCommand('pass_activation_turn_12345_1', 'pass_activation_turn_', 'user1', 'g1');
    assert.equal(cmd2.type, 'PassActivationTurn');
  });

  it('customIdToCommand maps movement prefixes', () => {
    const cmd = customIdToCommand('move_mp_12345_msg1_4', 'move_mp_', 'user1', 'g1');
    assert.equal(cmd.type, 'StartMovement');
    assert.equal(cmd.payload.movementPoints, 4);

    const cmd2 = customIdToCommand('move_pick_12345_A3', 'move_pick_', 'user1', 'g1');
    assert.equal(cmd2.type, 'MoveToSpace');
    assert.equal(cmd2.payload.coord, 'A3');
  });

  it('customIdToCommand maps round transition prefixes', () => {
    const cmd = customIdToCommand('end_end_of_round_12345', 'end_end_of_round_', 'user1', 'g1');
    assert.equal(cmd.type, 'EndEndOfRound');

    const cmd2 = customIdToCommand('status_phase_12345', 'status_phase_', 'user1', 'g1');
    assert.equal(cmd2.type, 'StatusPhase');
  });

  it('customIdToCommand returns null for unknown prefix', () => {
    const cmd = customIdToCommand('unknown_prefix_123', 'unknown_prefix_', 'user1', 'g1');
    assert.equal(cmd, null);
  });

  it('PREFIX_TO_COMMAND covers all expected prefixes', () => {
    const expected = [
      'phase_gate_ready_', 'phase_gate_unready_',
      'end_end_of_round_', 'end_start_of_round_', 'status_phase_',
      'dc_activate_', 'end_turn_', 'dc_end_activation_', 'pass_activation_turn_',
      'confirm_activate_', 'cancel_activate_',
      'move_mp_', 'move_pick_', 'move_letter_', 'move_back_letters_', 'move_adjust_mp_',
      'attack_target_', 'combat_ready_', 'combat_roll_', 'combat_surge_',
      'combat_reroll_', 'combat_resolve_ready_', 'combat_passive_', 'combat_token_',
    ];
    for (const prefix of expected) {
      assert.ok(PREFIX_TO_COMMAND[prefix], `Missing prefix: ${prefix}`);
    }
  });

  it('parsePayloadFromCustomId handles combat_token_', () => {
    const payload = parsePayloadFromCustomId('combat_token_12345_Hit_Trooper-0-0', 'combat_token_');
    assert.equal(payload.gameId, '12345');
    assert.equal(payload.tokenType, 'Hit');
    assert.equal(payload.figureKey, 'Trooper-0-0');
  });

  it('parsePayloadFromCustomId handles combat_passive_', () => {
    const payload = parsePayloadFromCustomId('combat_passive_12345_defensible', 'combat_passive_');
    assert.equal(payload.gameId, '12345');
    assert.equal(payload.passiveName, 'defensible');
  });
});
