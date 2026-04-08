/**
 * Oracle tests for power token grant centralization (Phase 1).
 *
 * Structural: all grant sites use grantPowerTokens(), no inline .push() bypasses.
 * Behavioral: grant-then-overflow semantics work correctly at and below cap.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..', '..', '..');

function readSrc(relPath) {
  return readFileSync(join(ROOT, relPath), 'utf8');
}

// ══════════════════════════════════════════════════════════════════════════════
// STRUCTURAL ORACLES
// ══════════════════════════════════════════════════════════════════════════════

// ── ORACLE-PTGRANT-001: No inline figurePowerTokens.push() bypasses remain ──
describe('ORACLE-PTGRANT-001: No inline figurePowerTokens.push() bypasses remain', () => {
  const files = [
    'src/handlers/activation.js',
    'src/handlers/interrupts.js',
    'src/handlers/movement.js',
    'src/game/abilities.js',
  ];

  for (const file of files) {
    it(`${file} has no inline .push() token grants`, () => {
      const src = readSrc(file);
      // Match: figurePowerTokens[...].push( — but NOT inside game-helpers.js itself
      const pushPattern = /figurePowerTokens\[.*?\]\.push\(/g;
      const matches = src.match(pushPattern) || [];
      assert.strictEqual(matches.length, 0,
        `${file} must not have inline figurePowerTokens[].push() — found ${matches.length}. Use grantPowerTokens() instead.`);
    });
  }
});

// ── ORACLE-PTGRANT-002: All migrated files import grantPowerTokens ──────────
describe('ORACLE-PTGRANT-002: All migrated files import grantPowerTokens', () => {
  const files = [
    'src/handlers/activation.js',
    'src/handlers/interrupts.js',
    'src/handlers/movement.js',
    'src/game/abilities.js',
  ];

  for (const file of files) {
    it(`${file} imports grantPowerTokens`, () => {
      const src = readSrc(file);
      assert.ok(src.includes('grantPowerTokens'), `${file} must import grantPowerTokens`);
    });
  }
});

// ── ORACLE-PTGRANT-003: grantPowerTokens uses grant-then-overflow semantics ─
describe('ORACLE-PTGRANT-003: grantPowerTokens uses grant-then-overflow (not refuse-at-cap)', () => {
  it('game-helpers.js always pushes tokens before checking overflow', () => {
    const src = readSrc('src/game/game-helpers.js');
    const fnIdx = src.indexOf('export function grantPowerTokens');
    assert.ok(fnIdx > 0, 'grantPowerTokens found');
    const fnBlock = src.slice(fnIdx, fnIdx + 600);
    // Token push comes before overflow check
    const pushIdx = fnBlock.indexOf('.push(tokenType)');
    const overflowIdx = fnBlock.indexOf('overflow > 0');
    assert.ok(pushIdx > 0, 'push exists in grantPowerTokens');
    assert.ok(overflowIdx > 0, 'overflow check exists in grantPowerTokens');
    assert.ok(pushIdx < overflowIdx, 'push must happen BEFORE overflow check (grant-then-overflow)');
  });

  it('game-helpers.js queues pendingPowerTokenOverflow on overflow', () => {
    const src = readSrc('src/game/game-helpers.js');
    const fnIdx = src.indexOf('export function grantPowerTokens');
    const fnEnd = src.indexOf('\nexport ', fnIdx + 1);
    const fnBlock = src.slice(fnIdx, fnEnd > fnIdx ? fnEnd : fnIdx + 1200);
    assert.ok(fnBlock.includes('pendingPowerTokenOverflow'), 'must queue overflow for Discord discard prompt');
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// BEHAVIORAL TESTS
// ══════════════════════════════════════════════════════════════════════════════

// ── B-PTGRANT-001: Normal grant below cap — no overflow ─────────────────────
describe('B-PTGRANT-001: Normal grant below cap produces no overflow', () => {
  it('granting 1 token to a figure with room does not trigger overflow', async () => {
    const { grantPowerTokens } = await import('../../../src/game/game-helpers.js');
    const game = { figurePowerTokens: { 'Riot Trooper (Elite)-1-0': ['Damage'] } };
    grantPowerTokens(game, 'Riot Trooper (Elite)-1-0', 'Block', 1);
    assert.deepStrictEqual(game.figurePowerTokens['Riot Trooper (Elite)-1-0'], ['Damage', 'Block']);
    assert.strictEqual(game.pendingPowerTokenOverflow, undefined, 'no overflow when below cap');
  });
});

// ── B-PTGRANT-002: Activation site at cap — overflow triggered ──────────────
describe('B-PTGRANT-002: Grant at cap triggers overflow (activation site pattern)', () => {
  it('Shield grant to figure already at cap queues overflow instead of refusing', async () => {
    const { grantPowerTokens } = await import('../../../src/game/game-helpers.js');
    // Simulate Riot Trooper at cap (2 tokens, default cap = 2)
    const game = { figurePowerTokens: { 'Riot Trooper (Elite)-1-0': ['Damage', 'Surge'] } };
    grantPowerTokens(game, 'Riot Trooper (Elite)-1-0', 'Block', 1);
    // Token IS granted (grant-then-overflow, not refuse-at-cap)
    assert.strictEqual(game.figurePowerTokens['Riot Trooper (Elite)-1-0'].length, 3,
      'token must be granted even at cap');
    assert.ok(game.figurePowerTokens['Riot Trooper (Elite)-1-0'].includes('Block'),
      'Block token must be present');
    // Overflow queued
    assert.ok(game.pendingPowerTokenOverflow, 'overflow must be queued');
    assert.strictEqual(game.pendingPowerTokenOverflow[0].figureKey, 'Riot Trooper (Elite)-1-0');
    assert.strictEqual(game.pendingPowerTokenOverflow[0].discardCount, 1,
      'must discard 1 token to return to cap');
  });
});

// ── B-PTGRANT-003: Non-activation site at cap — overflow triggered ──────────
describe('B-PTGRANT-003: Grant at cap triggers overflow (movement site pattern)', () => {
  it('Deference Protocol grant to figure at cap queues overflow', async () => {
    const { grantPowerTokens } = await import('../../../src/game/game-helpers.js');
    // Simulate figure at cap with 2 tokens
    const game = { figurePowerTokens: { 'Royal Guard-1-0': ['Block', 'Block'] } };
    grantPowerTokens(game, 'Royal Guard-1-0', 'Block', 1);
    assert.strictEqual(game.figurePowerTokens['Royal Guard-1-0'].length, 3,
      'token granted even at cap');
    assert.ok(game.pendingPowerTokenOverflow, 'overflow queued');
    assert.strictEqual(game.pendingPowerTokenOverflow[0].discardCount, 1);
  });
});

// ── B-PTGRANT-004: Multi-token grant at cap — correct overflow count ────────
describe('B-PTGRANT-004: Multi-token grant at cap queues correct overflow count', () => {
  it('Hold the Line granting 3 Block to figure at cap-1 overflows by 2', async () => {
    const { grantPowerTokens } = await import('../../../src/game/game-helpers.js');
    // Baze at cap-1 (1 token, cap=2)
    const game = { figurePowerTokens: { 'Baze Malbus-1-0': ['Damage'] } };
    grantPowerTokens(game, 'Baze Malbus-1-0', 'Block', 3);
    assert.strictEqual(game.figurePowerTokens['Baze Malbus-1-0'].length, 4,
      'all 3 tokens granted');
    assert.ok(game.pendingPowerTokenOverflow, 'overflow queued');
    assert.strictEqual(game.pendingPowerTokenOverflow[0].discardCount, 2,
      '4 tokens - cap 2 = overflow 2');
  });
});

// ── B-PTGRANT-005: Self-play auto-discards overflow (no pending) ────────────
describe('B-PTGRANT-005: Self-play auto-discards overflow instead of queuing', () => {
  it('selfPlay mode discards oldest tokens to stay at cap', async () => {
    const { grantPowerTokens } = await import('../../../src/game/game-helpers.js');
    const game = {
      selfPlay: true,
      figurePowerTokens: { 'K-2SO-1-0': ['Damage', 'Block'] },
    };
    grantPowerTokens(game, 'K-2SO-1-0', 'Surge', 1);
    // Auto-discard oldest (Damage) to stay at cap
    assert.strictEqual(game.figurePowerTokens['K-2SO-1-0'].length, 2, 'stays at cap');
    assert.ok(game.figurePowerTokens['K-2SO-1-0'].includes('Surge'), 'new token kept');
    assert.strictEqual(game.pendingPowerTokenOverflow, undefined, 'no overflow queued in selfPlay');
  });
});
