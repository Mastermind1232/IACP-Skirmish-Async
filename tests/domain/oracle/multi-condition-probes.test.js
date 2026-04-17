/**
 * Tier 3 Legality-Oracle Probes: Multi-Condition Interaction (B5 / D4)
 *
 * Phase-2 B5 closure pass. src/game/conditions.js stores conditions as a
 * per-figure array (game.figureConditions[figureKey] = string[]) and
 * exposes three mutators:
 *
 *   applyCondition(game, figureKey, cond)     — dedup-push; returns
 *                                                true iff newly added
 *   filterCondition(game, figureKey, cond)    — remove by name; skip
 *                                                Weaken if Disarm lock
 *   resetCondition(game, figureKey, cond)     — filter-then-push; leaves
 *                                                exactly one instance
 *
 * Existing tests apply each condition individually. No test has pinned:
 *   - that applying multiple different conditions to the same figure
 *     leaves an array of all of them (co-existence),
 *   - that removing one has no side effect on the others,
 *   - that per-figure state is isolated,
 *   - that emptying the array deletes the key (memory hygiene),
 *   - the Disarm-permanent-Weaken cross-condition interaction at
 *     filterCondition line 19, which is the single non-independent rule
 *     in this module.
 *
 * PROBE-COND-001: 3 distinct conditions coexist in the array
 * PROBE-COND-002: dedup — applyCondition twice returns false, length unchanged
 * PROBE-COND-003: independent removal — filterCondition(X) keeps others
 * PROBE-COND-004: per-figure isolation — applying to X does not touch Y
 * PROBE-COND-005: empty-array cleanup — last removal deletes the key
 * PROBE-COND-006: Disarm-permanent-Weaken interaction (only cross-condition rule)
 * PROBE-COND-007: resetCondition — dedup-then-push leaves exactly one
 * PROBE-COND-008: source pin — independence shape + Disarm guard line
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { applyCondition, filterCondition, resetCondition, HARMFUL_CONDITIONS } from '../../../src/game/conditions.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

function newGame() {
  return { figureConditions: {} };
}

// ── PROBE-COND-001: co-existence ───────────────────────────────────────────

describe('PROBE-COND-001: 3 distinct conditions coexist on one figure', () => {
  it('Focus + Bleed + Stun all persist in the array in application order', () => {
    const game = newGame();
    assert.equal(applyCondition(game, 'F-0-0', 'Focus'), true);
    assert.equal(applyCondition(game, 'F-0-0', 'Bleed'), true);
    assert.equal(applyCondition(game, 'F-0-0', 'Stun'), true);
    assert.deepEqual(game.figureConditions['F-0-0'], ['Focus', 'Bleed', 'Stun']);
  });
  it('each harmful condition in HARMFUL_CONDITIONS can coexist with every other', () => {
    const game = newGame();
    for (const cond of HARMFUL_CONDITIONS) applyCondition(game, 'F-0-0', cond);
    assert.equal(game.figureConditions['F-0-0'].length, HARMFUL_CONDITIONS.length);
    for (const cond of HARMFUL_CONDITIONS) {
      assert.ok(game.figureConditions['F-0-0'].includes(cond), `${cond} present`);
    }
  });
});

// ── PROBE-COND-002: dedup ──────────────────────────────────────────────────

describe('PROBE-COND-002: dedup — applyCondition twice is a no-op on state', () => {
  it('second apply returns false; array length unchanged; no duplicate stored', () => {
    const game = newGame();
    assert.equal(applyCondition(game, 'F-0-0', 'Focus'), true);
    assert.equal(applyCondition(game, 'F-0-0', 'Focus'), false);
    assert.deepEqual(game.figureConditions['F-0-0'], ['Focus']);
  });
  it('dedup is per-condition, not per-figure — other conditions still apply after a dedup', () => {
    const game = newGame();
    applyCondition(game, 'F-0-0', 'Focus');
    applyCondition(game, 'F-0-0', 'Focus'); // dedup
    assert.equal(applyCondition(game, 'F-0-0', 'Bleed'), true);
    assert.deepEqual(game.figureConditions['F-0-0'], ['Focus', 'Bleed']);
  });
});

// ── PROBE-COND-003: independent removal ────────────────────────────────────

describe('PROBE-COND-003: independent removal — each filterCondition targets one name', () => {
  it('removing Focus keeps Bleed and Stun intact', () => {
    const game = newGame();
    applyCondition(game, 'F-0-0', 'Focus');
    applyCondition(game, 'F-0-0', 'Bleed');
    applyCondition(game, 'F-0-0', 'Stun');
    filterCondition(game, 'F-0-0', 'Focus');
    assert.deepEqual(game.figureConditions['F-0-0'], ['Bleed', 'Stun']);
  });
  it('removing a non-present condition is a no-op', () => {
    const game = newGame();
    applyCondition(game, 'F-0-0', 'Bleed');
    filterCondition(game, 'F-0-0', 'Focus');
    assert.deepEqual(game.figureConditions['F-0-0'], ['Bleed']);
  });
});

// ── PROBE-COND-004: per-figure isolation ───────────────────────────────────

describe('PROBE-COND-004: per-figure isolation — conditions on X do not touch Y', () => {
  it('applyCondition to X does not create or populate Y', () => {
    const game = newGame();
    applyCondition(game, 'X-0-0', 'Focus');
    applyCondition(game, 'X-0-0', 'Stun');
    assert.deepEqual(game.figureConditions['X-0-0'], ['Focus', 'Stun']);
    assert.equal(game.figureConditions['Y-0-0'], undefined);
  });
  it('filterCondition on X does not affect Y with the same condition', () => {
    const game = newGame();
    applyCondition(game, 'X-0-0', 'Focus');
    applyCondition(game, 'Y-0-0', 'Focus');
    filterCondition(game, 'X-0-0', 'Focus');
    assert.equal(game.figureConditions['X-0-0'], undefined);
    assert.deepEqual(game.figureConditions['Y-0-0'], ['Focus']);
  });
});

// ── PROBE-COND-005: empty-array cleanup ────────────────────────────────────

describe('PROBE-COND-005: empty-array cleanup — last removal deletes the key', () => {
  it('removing the only condition on a figure deletes the figureConditions key', () => {
    const game = newGame();
    applyCondition(game, 'F-0-0', 'Focus');
    filterCondition(game, 'F-0-0', 'Focus');
    assert.equal(game.figureConditions['F-0-0'], undefined);
    assert.ok(!('F-0-0' in game.figureConditions),
      'key must be deleted, not left as empty array — prevents stale-state false positives');
  });
  it('removing one of two conditions does NOT delete the key', () => {
    const game = newGame();
    applyCondition(game, 'F-0-0', 'Focus');
    applyCondition(game, 'F-0-0', 'Bleed');
    filterCondition(game, 'F-0-0', 'Focus');
    assert.deepEqual(game.figureConditions['F-0-0'], ['Bleed']);
  });
});

// ── PROBE-COND-006: Disarm-permanent-Weaken ────────────────────────────────

describe('PROBE-COND-006: Disarm permanent Weakened — the one cross-condition rule', () => {
  it('filterCondition(Weaken) is a no-op while disarmPermanentWeakened is set', () => {
    const game = newGame();
    game.disarmPermanentWeakened = { 'F-0-0': true };
    applyCondition(game, 'F-0-0', 'Weaken');
    applyCondition(game, 'F-0-0', 'Stun');
    filterCondition(game, 'F-0-0', 'Weaken');
    assert.ok(game.figureConditions['F-0-0'].includes('Weaken'),
      'Weaken must remain while Disarm lock is active');
    assert.ok(game.figureConditions['F-0-0'].includes('Stun'),
      'Stun is unaffected by the Disarm guard');
  });
  it('Disarm lock is per-figure: lock on X does not protect Weaken on Y', () => {
    const game = newGame();
    game.disarmPermanentWeakened = { 'X-0-0': true };
    applyCondition(game, 'Y-0-0', 'Weaken');
    filterCondition(game, 'Y-0-0', 'Weaken');
    assert.equal(game.figureConditions['Y-0-0'], undefined,
      'Y has no lock so Weaken is removed as normal');
  });
  it('Disarm lock does NOT block removal of OTHER harmful conditions on the same figure', () => {
    const game = newGame();
    game.disarmPermanentWeakened = { 'F-0-0': true };
    applyCondition(game, 'F-0-0', 'Weaken');
    applyCondition(game, 'F-0-0', 'Bleed');
    filterCondition(game, 'F-0-0', 'Bleed');
    assert.ok(game.figureConditions['F-0-0'].includes('Weaken'), 'Weaken still held by lock');
    assert.ok(!game.figureConditions['F-0-0'].includes('Bleed'), 'Bleed removable despite lock');
  });
});

// ── PROBE-COND-007: resetCondition ─────────────────────────────────────────

describe('PROBE-COND-007: resetCondition — idempotent single-instance guarantee', () => {
  it('resetCondition on a figure without the condition adds it once', () => {
    const game = newGame();
    resetCondition(game, 'F-0-0', 'Focus');
    assert.deepEqual(game.figureConditions['F-0-0'], ['Focus']);
  });
  it('resetCondition on a figure already holding the condition leaves exactly one', () => {
    const game = newGame();
    applyCondition(game, 'F-0-0', 'Focus');
    resetCondition(game, 'F-0-0', 'Focus');
    assert.deepEqual(game.figureConditions['F-0-0'], ['Focus']);
  });
  it('resetCondition does not disturb other conditions', () => {
    const game = newGame();
    applyCondition(game, 'F-0-0', 'Bleed');
    applyCondition(game, 'F-0-0', 'Focus');
    resetCondition(game, 'F-0-0', 'Focus');
    assert.ok(game.figureConditions['F-0-0'].includes('Bleed'));
    assert.ok(game.figureConditions['F-0-0'].includes('Focus'));
    assert.equal(game.figureConditions['F-0-0'].length, 2,
      'existing Bleed preserved + Focus reset to single instance');
  });
});

// ── PROBE-COND-008: source pin ─────────────────────────────────────────────

describe('PROBE-COND-008: source pin — independence shape + Disarm guard', () => {
  it('pins the array-of-strings storage shape and the Disarm cross-condition guard', () => {
    const src = readFileSync(resolve(__dirname, '../../../src/game/conditions.js'), 'utf8');
    // applyCondition dedup — return false if already present
    assert.match(src, /if\s*\(game\.figureConditions\[figureKey\]\.includes\(cond\)\)\s*return\s+false/,
      'applyCondition dedups by name (returns false) — independence precondition');
    // applyCondition push — add to array
    assert.match(src, /game\.figureConditions\[figureKey\]\.push\(cond\)/,
      'applyCondition appends to per-figure array — the storage shape that enables independence');
    // filterCondition — Disarm guard at the top
    assert.match(src, /cond\s*===\s*'Weaken'\s*&&\s*game\.disarmPermanentWeakened\?\.\[figureKey\]/,
      'filterCondition carries the Disarm permanent-Weaken guard — the single cross-condition rule');
    // filterCondition — remove + empty-array cleanup
    assert.match(src, /game\.figureConditions\[figureKey\]\s*=\s*game\.figureConditions\[figureKey\]\.filter/,
      'filterCondition removes by name via Array.filter');
    assert.match(src, /if\s*\(game\.figureConditions\[figureKey\]\.length\s*===\s*0\)\s*delete\s+game\.figureConditions\[figureKey\]/,
      'empty-array cleanup deletes the key');
  });
});
