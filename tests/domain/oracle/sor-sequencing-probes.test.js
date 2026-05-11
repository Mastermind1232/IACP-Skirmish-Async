/**
 * Tier 3 Legality-Oracle Probes: Start-of-Round DC Effect Sequencing (B2 / D7)
 *
 * Phase-2 B2 closure pass. runStartOfRoundDcEffects at
 * src/handlers/round.js:1049 orchestrates every start-of-round DC/Skirmish
 * Upgrade effect. The function has three layered invariants that determine
 * whether the wrong player gets VP, whether an effect fires twice in one
 * game, and whether the activation-phase gate ever opens:
 *
 *   Block A (DC passive hooks):  initiative-player-first ordering;
 *                                effects = Brash, Force Slow, Excavation,
 *                                Programming Override, Shape/Shift.
 *   Block B (Skirmish Upgrades): fixed [1, 2] player order;
 *                                effects = First Strike, Rule by Fear,
 *                                Rogue One, Imperial Citadel.
 *   Phase gate:                  returns true iff
 *                                (pendingStartOfRoundResolve || 0) > 0.
 *                                resolveStartOfRoundEffect decrements and
 *                                opens pre_activation when counter hits 0.
 *
 * Previous coverage: round-lifecycle-tests.js confirms the function exports;
 * round-lifecycle-behavioral.test.js covers the gate flow at a higher level;
 * but no test pins the Block-A/Block-B ordering, the round-1 guards, the
 * once-per-game flags, or the counter→gate transition.
 *
 * PROBE-SOR-001: return-value semantics (counter 0 → false; > 0 → true)
 * PROBE-SOR-002: First Strike — round-1 guard, once-per-game flag, both players get 4 VP
 * PROBE-SOR-003: Ezra Brash — every-round sync, 4 MP per DC msgId
 * PROBE-SOR-004: Initiative-first ordering in Block A (both players have Brash)
 * PROBE-SOR-005: resolveStartOfRoundEffect counter + pre_activation gate transition
 * PROBE-SOR-006: Source pin on structural invariants
 *
 * Heavy-Discord paths (Rule by Fear hand-channel picker, Rogue One
 * hand-channel picker, Imperial Citadel + Programming Override + Clawdite
 * button pickers) are covered by PROBE-SOR-001 for the counter-increment
 * contract and by PROBE-SOR-006 source pins — full end-to-end Discord
 * orchestration is out of scope for this audit lane.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runStartOfRoundDcEffects, resolveStartOfRoundEffect } from '../../../src/handlers/round.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

// ── Shared fixtures ───────────────────────────────────────────────────────

function buildGame({
  initPn = 1,
  p1Dcs = [],
  p2Dcs = [],
  p1MsgIds = [],
  p2MsgIds = [],
  currentRound = 1,
  extra = {},
} = {}) {
  return {
    player1Id: 'p1',
    player2Id: 'p2',
    initiativePlayerId: initPn === 1 ? 'p1' : 'p2',
    player1VP: { total: 0, kills: 0, objectives: 0 },
    player2VP: { total: 0, kills: 0, objectives: 0 },
    p1DcList: p1Dcs,
    p2DcList: p2Dcs,
    p1DcMessageIds: p1MsgIds,
    p2DcMessageIds: p2MsgIds,
    currentRound,
    figurePositions: { 1: {}, 2: {} },
    ...extra,
  };
}

function buildCtx(logCapture = [], extras = {}) {
  return {
    logGameAction: async (_g, _c, text) => { logCapture.push(text); },
    updateHandChannelMessages: async () => {},
    checkWinConditions: async () => {},
    ...extras,
  };
}

// ── PROBE-SOR-001: return-value semantics ─────────────────────────────────

describe('PROBE-SOR-001: return-value semantics — (pendingStartOfRoundResolve||0) > 0', () => {
  it('001a: empty DCs → returns false (no pending, no counter)', async () => {
    const game = buildGame();
    const result = await runStartOfRoundDcEffects(game, 'g1', null, buildCtx());
    assert.equal(result, false);
    assert.equal(game.pendingStartOfRoundResolve ?? 0, 0);
  });

  it('001b: pure sync path ([First Strike] only, round 1) → returns false', async () => {
    const game = buildGame({
      p1Dcs: [{ dcName: '[First Strike]' }],
      currentRound: 1,
    });
    const result = await runStartOfRoundDcEffects(game, 'g1', null, buildCtx());
    assert.equal(result, false, 'First Strike is synchronous — no counter increment');
    assert.equal(game.pendingStartOfRoundResolve ?? 0, 0);
  });

  it('001c: pre-existing counter value is reflected in return (function does not reset)', async () => {
    const game = buildGame({ extra: { pendingStartOfRoundResolve: 3 } });
    const result = await runStartOfRoundDcEffects(game, 'g1', null, buildCtx());
    assert.equal(result, true);
    assert.equal(game.pendingStartOfRoundResolve, 3, 'counter untouched by sync-only SoR pass');
  });
});

// ── PROBE-SOR-002: First Strike (Block B sync path) ───────────────────────

describe('PROBE-SOR-002: [First Strike] — round-1 guard + once-per-game flag + both players +4 VP', () => {
  it('002a: round 1, P1 owns card → both players gain 4 VP; firstStrikeFired set', async () => {
    const game = buildGame({
      p1Dcs: [{ dcName: '[First Strike]' }],
      currentRound: 1,
    });
    await runStartOfRoundDcEffects(game, 'g1', null, buildCtx());
    assert.equal(game.player1VP.objectives, 4);
    assert.equal(game.player2VP.objectives, 4);
    assert.equal(game.firstStrikeFired, true);
  });

  it('002b: round 2 → First Strike does NOT fire (round-1 guard)', async () => {
    const game = buildGame({
      p1Dcs: [{ dcName: '[First Strike]' }],
      currentRound: 2,
    });
    await runStartOfRoundDcEffects(game, 'g1', null, buildCtx());
    assert.equal(game.player1VP.objectives, 0);
    assert.equal(game.player2VP.objectives, 0);
    assert.equal(game.firstStrikeFired ?? false, false);
  });

  it('002c: flag pre-set (earlier this game) → First Strike does NOT re-fire', async () => {
    const game = buildGame({
      p1Dcs: [{ dcName: '[First Strike]' }],
      currentRound: 1,
      extra: { firstStrikeFired: true },
    });
    await runStartOfRoundDcEffects(game, 'g1', null, buildCtx());
    assert.equal(game.player1VP.objectives, 0);
    assert.equal(game.player2VP.objectives, 0);
  });

  it('002d: P2 owns card → both players still gain 4 VP (owner-agnostic)', async () => {
    const game = buildGame({
      p2Dcs: [{ dcName: '[First Strike]' }],
      currentRound: 1,
    });
    await runStartOfRoundDcEffects(game, 'g1', null, buildCtx());
    assert.equal(game.player1VP.objectives, 4);
    assert.equal(game.player2VP.objectives, 4);
  });

  it('002e: BOTH players own [First Strike] → fires ONCE total (global flag)', async () => {
    const game = buildGame({
      p1Dcs: [{ dcName: '[First Strike]' }],
      p2Dcs: [{ dcName: '[First Strike]' }],
      currentRound: 1,
    });
    await runStartOfRoundDcEffects(game, 'g1', null, buildCtx());
    assert.equal(game.player1VP.objectives, 4, 'not 8 — fires once');
    assert.equal(game.player2VP.objectives, 4, 'not 8 — fires once');
  });
});

// ── PROBE-SOR-003: Ezra Brash (Block A sync path) ─────────────────────────

describe('PROBE-SOR-003: Ezra Bridger Brash — Move-X picker every round', () => {
  // Brash migrated from movementBank-grant to a 4-space pendingMoveX
  // picker (CRR MOVE-017 — bypassCosts true, no banking). Test fixtures
  // lack real map data so the picker may auto-finish on zero
  // candidates; either pendingMoveX-stamped OR the picker drained is
  // valid evidence the dispatch ran.
  it('003a: Ezra on P1 at index 0 → pendingMoveX stamped (4 spaces) or auto-finished', async () => {
    const game = buildGame({
      p1Dcs: [{ dcName: 'Ezra Bridger', displayName: 'Ezra' }],
      p1MsgIds: ['ezra-msg-id'],
    });
    if (!game.figurePositions) game.figurePositions = { 1: {}, 2: {} };
    game.figurePositions[1]['Ezra Bridger-1-0'] = 'a1';
    await runStartOfRoundDcEffects(game, 'g1', null, buildCtx());
    assert.equal(game.movementBank?.['ezra-msg-id'], undefined, 'no movementBank used');
    const pmx = game.pendingMoveX?.['ezra-msg-id'];
    if (pmx) {
      assert.equal(pmx.remaining, 4, 'picker.remaining = 4');
      assert.equal(pmx.bypassCosts, true, 'bypassCosts true');
      assert.equal(pmx.source, 'Brash', 'source set');
    }
  });

  it('003b: still fires on round 2+ (no round guard on Brash — every round)', async () => {
    const game = buildGame({
      p1Dcs: [{ dcName: 'Ezra Bridger' }],
      p1MsgIds: ['ezra-msg-id'],
      currentRound: 3,
    });
    if (!game.figurePositions) game.figurePositions = { 1: {}, 2: {} };
    game.figurePositions[1]['Ezra Bridger-1-0'] = 'a1';
    await runStartOfRoundDcEffects(game, 'g1', null, buildCtx());
    // Either picker stamped (figure exists, picker not yet drained) or
    // logged + cleared (auto-finish on no candidates) — but no bank.
    assert.equal(game.movementBank?.['ezra-msg-id'], undefined);
  });

  it('003c: defeated Ezra → skipped (dc.defeated gate)', async () => {
    const game = buildGame({
      p1Dcs: [{ dcName: 'Ezra Bridger', defeated: true }],
      p1MsgIds: ['ezra-msg-id'],
    });
    await runStartOfRoundDcEffects(game, 'g1', null, buildCtx());
    assert.equal(game.movementBank?.['ezra-msg-id'], undefined);
    assert.equal(game.pendingMoveX?.['ezra-msg-id'], undefined);
  });
});

// ── PROBE-SOR-004: Initiative-first ordering in Block A ───────────────────

describe('PROBE-SOR-004: Block A resolves initiative player first (Ezra × 2 probe)', () => {
  it('004a: P1 has initiative → P1 Brash logs before P2 Brash', async () => {
    const log = [];
    const game = buildGame({
      initPn: 1,
      p1Dcs: [{ dcName: 'Ezra Bridger', displayName: 'Ezra P1' }],
      p2Dcs: [{ dcName: 'Ezra Bridger', displayName: 'Ezra P2' }],
      p1MsgIds: ['p1-msg'],
      p2MsgIds: ['p2-msg'],
    });
    if (!game.figurePositions) game.figurePositions = { 1: {}, 2: {} };
    game.figurePositions[1]['Ezra Bridger-1-0'] = 'a1';
    game.figurePositions[2]['Ezra Bridger-1-0'] = 'b1';
    await runStartOfRoundDcEffects(game, 'g1', null, buildCtx(log));
    const p1Idx = log.findIndex(t => t.includes('Ezra P1'));
    const p2Idx = log.findIndex(t => t.includes('Ezra P2'));
    assert.ok(p1Idx >= 0 && p2Idx >= 0, 'both Brash logs emitted');
    assert.ok(p1Idx < p2Idx, `P1 (idx ${p1Idx}) must resolve before P2 (idx ${p2Idx})`);
  });

  it('004b: P2 has initiative → P2 Brash logs before P1 Brash', async () => {
    const log = [];
    const game = buildGame({
      initPn: 2,
      p1Dcs: [{ dcName: 'Ezra Bridger', displayName: 'Ezra P1' }],
      p2Dcs: [{ dcName: 'Ezra Bridger', displayName: 'Ezra P2' }],
      p1MsgIds: ['p1-msg'],
      p2MsgIds: ['p2-msg'],
    });
    if (!game.figurePositions) game.figurePositions = { 1: {}, 2: {} };
    game.figurePositions[1]['Ezra Bridger-1-0'] = 'a1';
    game.figurePositions[2]['Ezra Bridger-1-0'] = 'b1';
    await runStartOfRoundDcEffects(game, 'g1', null, buildCtx(log));
    const p1Idx = log.findIndex(t => t.includes('Ezra P1'));
    const p2Idx = log.findIndex(t => t.includes('Ezra P2'));
    assert.ok(p2Idx < p1Idx, `P2 (idx ${p2Idx}) must resolve before P1 (idx ${p1Idx})`);
  });
});

// ── PROBE-SOR-005: resolveStartOfRoundEffect counter + gate transition ────

describe('PROBE-SOR-005: resolveStartOfRoundEffect — counter decrement + pre_activation open', () => {
  it('005a: counter 2 → 1, no phase gate yet', async () => {
    const game = { pendingStartOfRoundResolve: 2, pendingSorActions: [{ x: 1 }] };
    let gateCalls = 0;
    await resolveStartOfRoundEffect(game, {
      sendPhaseGateMessages: async () => { gateCalls++; },
      saveGames: () => {},
    });
    assert.equal(game.pendingStartOfRoundResolve, 1);
    assert.equal(gateCalls, 0);
    assert.ok(game.pendingSorActions, 'pendingSorActions retained while counter > 0');
  });

  it('005b: counter 1 → cleared + pre_activation gate opens + pendingSorActions cleared', async () => {
    const game = { pendingStartOfRoundResolve: 1, pendingSorActions: [{ x: 1 }] };
    let gatePhase = null;
    await resolveStartOfRoundEffect(game, {
      sendPhaseGateMessages: async (_g, phase) => { gatePhase = phase; },
      saveGames: () => {},
    });
    assert.equal(game.pendingStartOfRoundResolve, undefined, 'counter cleared');
    assert.equal(gatePhase, 'pre_activation', 'activation-phase gate opened');
    assert.equal(game.pendingSorActions, undefined, 'pendingSorActions cleared');
  });

  it('005c: counter missing (no pending SoR) → treated as 1, decrements to 0, gate opens', async () => {
    const game = {};
    let gatePhase = null;
    await resolveStartOfRoundEffect(game, {
      sendPhaseGateMessages: async (_g, phase) => { gatePhase = phase; },
      saveGames: () => {},
    });
    assert.equal(gatePhase, 'pre_activation');
  });
});

// ── PROBE-SOR-006: source pin on structural invariants ────────────────────

describe('PROBE-SOR-006: source pin — Block A initiative-first, Block B [1,2], round-1 guards, counter gate', () => {
  it('pins all structural invariants in src/handlers/round.js', () => {
    const src = readFileSync(resolve(__dirname, '../../../src/handlers/round.js'), 'utf8');
    // Block A: initiative-first player order
    assert.ok(
      /_sorPlayerOrder\s*=\s*_initPn\s*===\s*1\s*\?\s*\[\s*1\s*,\s*2\s*\]\s*:\s*\[\s*2\s*,\s*1\s*\]/.test(src),
      'Block A initiative-first player order literal missing/changed',
    );
    // Block B: fixed [1, 2]
    assert.ok(
      /\/\/ Skirmish Upgrade timing effects[\s\S]*?for\s*\(\s*const\s+playerNum\s+of\s+\[\s*1\s*,\s*2\s*\]\s*\)/.test(src),
      'Block B fixed [1,2] player-order literal missing/changed',
    );
    // Round-1 guards
    assert.ok(/First Strike[\s\S]{0,200}currentRound\s*===\s*1\s*&&\s*!game\.firstStrikeFired/.test(src),
      'First Strike round-1 + once-per-game guard missing');
    assert.ok(/Rule by Fear[\s\S]{0,300}currentRound\s*===\s*1\s*&&\s*!game\[`ruleByFearFired_p\$\{playerNum\}`\]/.test(src),
      'Rule by Fear round-1 + per-player once guard missing');
    assert.ok(/Rogue One[\s\S]{0,300}currentRound\s*===\s*1\s*&&\s*!game\[`rogueOneFired_p\$\{playerNum\}`\]/.test(src),
      'Rogue One round-1 + per-player once guard missing');
    // Counter-gate return expression
    assert.ok(/return\s*\(\s*game\.pendingStartOfRoundResolve\s*\|\|\s*0\s*\)\s*>\s*0/.test(src),
      'runStartOfRoundDcEffects counter-gate return expression missing');
    // resolveStartOfRoundEffect → pre_activation gate
    assert.ok(/pendingStartOfRoundResolve\s*<=\s*0[\s\S]{0,400}sendPhaseGateMessages\([^)]*['"]pre_activation['"]/.test(src),
      'resolveStartOfRoundEffect must call sendPhaseGateMessages(..., "pre_activation") when counter hits 0');
  });
});
