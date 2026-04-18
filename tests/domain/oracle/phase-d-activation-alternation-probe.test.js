/**
 * Phase-D probe: activation phase opens with initiative and alternates.
 *
 * PROBE-PD-APH-004: During a skirmish, players alternate activating groups,
 *   starting with the player with initiative each round. (CRR ACTIVATION PHASE)
 *
 * Implementation:
 *   - At the start of each Activation Phase, `game.currentActivationTurnPlayerId`
 *     is set to `game.initiativePlayerId` (round.js:1468, phase-gate.js:405,
 *     setup-bridge.js:367, misc-helpers.js:592 — 4 independent entry points).
 *   - After an activation ends (activation.js:696) or a pass (activation.js:256),
 *     the turn flips to `otherPlayerId` — no same-player double-activation path
 *     exists outside the pass-when-opponent-has-more-activations case.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '../../..');
const ROUND_SRC = readFileSync(resolve(ROOT, 'src/handlers/round.js'), 'utf8');
const ACTIVATION_SRC = readFileSync(resolve(ROOT, 'src/handlers/activation.js'), 'utf8');
const PHASE_GATE_SRC = readFileSync(resolve(ROOT, 'src/handlers/phase-gate.js'), 'utf8');
const SETUP_BRIDGE_SRC = readFileSync(resolve(ROOT, 'src/engine/setup-bridge.js'), 'utf8');
const MISC_HELPERS_SRC = readFileSync(resolve(ROOT, 'src/engine/misc-helpers.js'), 'utf8');

describe('PROBE-PD-APH-004: activation phase opens with initiative and alternates each turn', () => {
  it('004a: source — Activation Phase opens with currentActivationTurnPlayerId set to initiativePlayerId (round.js)', () => {
    assert.match(ROUND_SRC, /game\.currentActivationTurnPlayerId = game\.initiativePlayerId;/,
      'round.js must seed activation turn with initiativePlayerId — CRR-APH-004');
  });

  it('004b: source — three additional entry points seed the activation turn from initiative (phase-gate, setup-bridge, misc-helpers)', () => {
    const pat = /game\.currentActivationTurnPlayerId = game\.initiativePlayerId;/;
    assert.match(PHASE_GATE_SRC, pat,
      'phase-gate.js must seed activation turn with initiativePlayerId — CRR-APH-004');
    assert.match(SETUP_BRIDGE_SRC, pat,
      'setup-bridge.js must seed activation turn with initiativePlayerId — CRR-APH-004');
    assert.match(MISC_HELPERS_SRC, pat,
      'misc-helpers.js must seed activation turn with initiativePlayerId — CRR-APH-004');
  });

  it('004c: source — after an activation ends, the turn flips to the other player (alternation pin)', () => {
    // activation.js:696 — end-of-activation flip
    assert.match(ACTIVATION_SRC, /game\.currentActivationTurnPlayerId = otherPlayerId;/,
      'activation.js must flip turn to otherPlayerId after activation ends — CRR-APH-004');
  });

  it('004d: source — pass action also flips turn to the other player (alternation pin)', () => {
    // activation.js:256 — pass-turn flip
    const pat = /game\.currentActivationTurnPlayerId = otherPlayerId;/g;
    const matches = ACTIVATION_SRC.match(pat) || [];
    assert.ok(matches.length >= 2,
      `activation.js must flip on both activation-end and pass-turn — matched ${matches.length} — CRR-APH-004`);
  });

  it('004e: source — no branch assigns the turn back to the same player (no double-activation shortcut)', () => {
    // Negative invariant: no line assigns currentActivationTurnPlayerId from itself,
    // nor from turnPlayerId (the player whose turn just ended).
    assert.ok(!/currentActivationTurnPlayerId\s*=\s*game\.currentActivationTurnPlayerId/.test(ACTIVATION_SRC),
      'no self-assignment of activation turn — CRR-APH-004');
    assert.ok(!/currentActivationTurnPlayerId\s*=\s*turnPlayerId/.test(ACTIVATION_SRC),
      'activation.js must not re-assign turn to the same player — CRR-APH-004');
  });

  it('004f: source — initiative passes each round; next round opens with the new initiative player', () => {
    // round.js:853 — prevInitiative flips at start of status phase.
    assert.match(ROUND_SRC, /game\.initiativePlayerId = prevInitiative === game\.player1Id \? game\.player2Id : game\.player1Id;/,
      'initiative must flip each round before the next activation phase — CRR-APH-004');
  });
});
