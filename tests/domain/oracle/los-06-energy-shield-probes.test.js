/**
 * LOS-06 Energy Shield Direct Oracle Probes.
 *
 * The IACP CRR (p.28) carves out three rules for energy-shield LOS:
 *
 *   1. A space containing an energy shield blocks LOS (in general).
 *   2. "Line of sight can be traced TO a figure or object occupying a space
 *      containing an energy shield."  → target-on-shield still visible.
 *   3. "Line of sight can be drawn OUT of a space containing an energy shield."
 *      → attacker-on-shield can still shoot out.
 *
 * `src/game/spatial.js:141-143` implements the self-exclusion that makes
 * rules 2 and 3 work: the source and destination cells are skipped during
 * the path-blocking loop, so a shield on either endpoint does not block its
 * own sightline. Rule 1 is enforced by the generic blocking-terrain path
 * (shield spaces are merged into `effectiveMs.blocking` by the handler).
 *
 * These probes test `hasLineOfSight()` as a pure function — no game state,
 * no handler plumbing. If the self-exclusion geometry or blocking-set check
 * breaks for any of these base cases, the probes hard-fail on the exact
 * CRR-violating input.
 *
 * Parity drift between the engine (shield-blind: never reads
 * `ancillaryTokens.energyShield`) and the handler (merges shields into
 * `effectiveMs.blocking`) is covered by the handler-parity-reporting
 * scoreboard, not here.
 *
 * Deferred (NOT covered by this lane):
 *   - Diagonal corner-intersection rule (p.28/p.40): "LOS cannot be traced
 *     through a corner where any combination of walls, doors, blocking
 *     terrain, or Energy Shield intersect." Tracked as a separate follow-up.
 *
 * PROBE-LOS-06-001: LOS drawn OUT of shield (attacker ON shield)
 * PROBE-LOS-06-002: LOS drawn INTO shield (target ON shield)
 * PROBE-LOS-06-003: LOS NOT drawn through shield (shield between)
 * PROBE-LOS-06-004: Multi-cell attacker — any cell (including the shield
 *                   cell, via self-exclusion) has LOS
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { hasLineOfSight } from '../../../src/game/spatial.js';
import { getFootprintCells } from '../../../src/game/coords.js';

// ── PROBE-LOS-06-001: LOS drawn OUT of shield ──────────────────────────────

describe('PROBE-LOS-06-001: attacker ON shield — LOS out is allowed', () => {
  it('b3 → e3 with shield on b3 (source) returns true', () => {
    // Attacker stands on the shield space. CRR: "Line of sight can be drawn
    // out of a space containing an energy shield." The spatial.js self-
    // exclusion at line 142 skips the source cell in the blocking-set check,
    // so the shield on b3 must not block b3's own sightline out.
    const mapSpaces = {
      blocking: ['b3'],
      impassableEdges: [],
    };
    const los = hasLineOfSight('b3', 'e3', mapSpaces, null);
    assert.strictEqual(los, true,
      'Attacker on shield space b3 must still have LOS out to e3.');
  });
});

// ── PROBE-LOS-06-002: LOS drawn INTO shield ────────────────────────────────

describe('PROBE-LOS-06-002: target ON shield — LOS in is allowed', () => {
  it('b3 → e3 with shield on e3 (target) returns true', () => {
    // Target stands on the shield space. CRR: "Line of sight can be traced
    // to a figure or object occupying a space containing an energy shield."
    // The spatial.js self-exclusion at line 143 skips the destination cell
    // in the blocking-set check.
    const mapSpaces = {
      blocking: ['e3'],
      impassableEdges: [],
    };
    const los = hasLineOfSight('b3', 'e3', mapSpaces, null);
    assert.strictEqual(los, true,
      'Target on shield space e3 must still be visible from b3.');
  });
});

// ── PROBE-LOS-06-003: LOS NOT drawn through shield ─────────────────────────

describe('PROBE-LOS-06-003: shield between — LOS through is blocked', () => {
  it('b3 → e3 with shield on c3 (between) returns false', () => {
    // Shield is on the straight sightline between attacker and target, and
    // is neither endpoint. CRR: "Line of sight cannot be traced through a
    // space containing an energy shield." Generic blocking-set check at
    // spatial.js:144 must flag the shield cell.
    const mapSpaces = {
      blocking: ['c3'],
      impassableEdges: [],
    };
    const los = hasLineOfSight('b3', 'e3', mapSpaces, null);
    assert.strictEqual(los, false,
      'Shield on c3 between attacker b3 and target e3 must block LOS.');
  });

  it('b3 → e3 with shield on d3 (also between) returns false', () => {
    // Positive control: a different between-cell shield. Same rule applies.
    const mapSpaces = {
      blocking: ['d3'],
      impassableEdges: [],
    };
    const los = hasLineOfSight('b3', 'e3', mapSpaces, null);
    assert.strictEqual(los, false,
      'Shield on d3 between attacker b3 and target e3 must block LOS.');
  });
});

// ── PROBE-LOS-06-004: Multi-cell attacker + shield self-exclusion ──────────

describe('PROBE-LOS-06-004: 2x2 attacker — shield on one cell does not kill LOS', () => {
  it('2x2 attacker at a3 with shield on b3 — at least one cell has LOS to f3', () => {
    // 2x2 attacker occupies {a3, b3, a4, b4}. Shield is on b3 (one of the
    // attacker's own footprint cells). From a3 as source, b3 is a path cell
    // (not self-excluded) and is in blocking → that call returns false.
    // From b3 as source, b3 IS self-excluded → LOS out is clear → true.
    // The handler iterates attacker footprint × target footprint and
    // accepts if any cell has LOS. Combines the Slice 2 multi-cell rule
    // with the LOS-06 self-exclusion rule.
    const mapSpaces = { blocking: ['b3'], impassableEdges: [] };
    const attackerCells = getFootprintCells('a3', '2x2');
    assert.strictEqual(attackerCells.length, 4,
      `2x2 footprint must expand to 4 cells. Got: ${JSON.stringify(attackerCells)}`);

    let anyHasLos = false;
    const losPerCell = {};
    for (const cell of attackerCells) {
      const seen = hasLineOfSight(cell, 'f3', mapSpaces, null);
      losPerCell[cell] = seen;
      if (seen) anyHasLos = true;
    }

    assert.strictEqual(anyHasLos, true,
      `2x2 attacker at a3 with shield on b3 must have LOS to f3 from at ` +
      `least one footprint cell. Per-cell LOS: ${JSON.stringify(losPerCell)}`);
    assert.strictEqual(losPerCell['b3'], true,
      `LOS from b3 (the shield cell itself) must be allowed by self-exclusion. ` +
      `Per-cell LOS: ${JSON.stringify(losPerCell)}`);
  });
});
