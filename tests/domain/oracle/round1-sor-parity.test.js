/**
 * BEHAVIORAL oracle tests for Round 1 start-of-round parity with Round 2+.
 *
 * Regression: before the shared SOR continuation helper was wired into the
 * round-1 entry paths (phase-gate cc_drawn + setup-bridge runDraftRandom),
 * mission-level start-of-round rules (e.g. Sabacc setTokenCountFromInitiativeHand,
 * Devaron A placeTokensOnCrates) silently skipped round 1. DC passive effects
 * still fired because they were called directly, but CC passive redraws,
 * mission-specific prompts, hand refresh, and phase gate were all missing.
 *
 * These probes verify:
 *   R1SOR-001: runStartOfRoundContinuation is exported from handlers/round.js
 *   R1SOR-002: phase-gate.js cc_drawn calls runStartOfRoundRules (mission SOR)
 *   R1SOR-003: phase-gate.js cc_drawn calls runStartOfRoundContinuation
 *   R1SOR-004: setup-bridge runDraftRandom calls runStartOfRoundRules
 *   R1SOR-005: setup-bridge runDraftRandom calls runStartOfRoundContinuation
 *   R1SOR-006: Sabacc setTokenCountFromInitiativeHand emits a visible log message
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import * as roundHandlers from '../../../src/handlers/round.js';
import { runStartOfRoundRules } from '../../../src/game/mission-rules.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(__dirname, '..', '..', '..');

function readSrc(relPath) {
  return readFileSync(join(repoRoot, relPath), 'utf8');
}

describe('Round 1 SOR parity (shared-helper unification)', () => {
  it('R1SOR-001: handlers/round.js exports runStartOfRoundContinuation', () => {
    assert.equal(typeof roundHandlers.runStartOfRoundContinuation, 'function',
      'runStartOfRoundContinuation must be exported so phase-gate + setup-bridge can reuse it');
  });

  it('R1SOR-002: advanceFromCcDraw invokes runStartOfRoundRules', () => {
    // Per user 2026-05-09: cc_drawn ready check removed; round 1 SOR
    // body extracted into advanceFromCcDraw() and called directly when
    // both players finish drawing. Same body, different entry point.
    const src = readSrc('src/handlers/phase-gate.js');
    const fnIdx = src.indexOf('export async function advanceFromCcDraw');
    assert.ok(fnIdx > 0, 'advanceFromCcDraw must exist in phase-gate.js');
    const block = src.slice(fnIdx);
    assert.match(block, /runStartOfRoundRules\s*\(/,
      'advanceFromCcDraw must call runStartOfRoundRules to fire mission SOR rules on round 1');
  });

  it('R1SOR-003: advanceFromCcDraw invokes runStartOfRoundContinuation', () => {
    const src = readSrc('src/handlers/phase-gate.js');
    const fnIdx = src.indexOf('export async function advanceFromCcDraw');
    const block = src.slice(fnIdx);
    assert.match(block, /runStartOfRoundContinuation\s*\(/,
      'advanceFromCcDraw must call runStartOfRoundContinuation (CC passives, DC SOR, phase gate, mission prompts)');
  });

  it('R1SOR-004: setup-bridge.js runDraftRandom invokes runStartOfRoundRules', () => {
    const src = readSrc('src/engine/setup-bridge.js');
    const fnIdx = src.indexOf('export async function runDraftRandom');
    assert.ok(fnIdx > 0, 'runDraftRandom must exist in setup-bridge');
    const block = src.slice(fnIdx);
    assert.match(block, /runStartOfRoundRules/,
      'runDraftRandom must call runStartOfRoundRules so mission SOR rules fire on Draft Random round 1');
  });

  it('R1SOR-005: setup-bridge.js runDraftRandom invokes runStartOfRoundContinuation', () => {
    const src = readSrc('src/engine/setup-bridge.js');
    const fnIdx = src.indexOf('export async function runDraftRandom');
    const block = src.slice(fnIdx);
    assert.match(block, /runStartOfRoundContinuation/,
      'runDraftRandom must call runStartOfRoundContinuation for parity with Round 2+');
  });

  it('R1SOR-006: setTokenCountFromInitiativeHand emits a visible log message', async () => {
    const game = {
      player1Id: 'p1', player2Id: 'p2',
      initiativePlayerId: 'p1',
      player1CcHand: ['Take Initiative', 'Tactical Movement', 'On the Lookout'],
      player2CcHand: [],
      selectedMission: { name: 'Sabacc Standoff', variant: 'b' },
    };
    const logs = [];
    const fakeLog = async (_game, _client, message, _meta) => { logs.push(message); };
    await runStartOfRoundRules(
      game,
      'corellian-underground',
      'b',
      { setTokenCountFromInitiativeHand: { gameKey: 'sabaccTokenCount' } },
      { logGameAction: fakeLog, client: {} },
    );
    assert.equal(game.sabaccTokenCount, 3, 'sabaccTokenCount should equal initiative player hand size');
    assert.equal(logs.length, 1, 'exactly one log message should be emitted');
    assert.match(logs[0], /Sabacc Standoff/, 'log message should reference mission name');
    assert.match(logs[0], /3/, 'log message should reference the actual token count');
  });
});
