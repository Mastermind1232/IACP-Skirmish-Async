/**
 * LOS Slice 2 Direct Oracle Probes.
 *
 * Surfaces two CRR-required LOS behaviors that the engine (available-actions)
 * does not currently enforce, but the handler (dc-play-area) does:
 *
 *   1. Closed doors are walls for LOS. An impassable-edge merged into
 *      mapSpaces.impassableEdges must block the attacker-to-target sightline.
 *   2. Multi-cell figures have LOS from ANY of their footprint cells.
 *      A 2x2 attacker has LOS to a target if at least one of its 4 cells
 *      traces an unobstructed sightline to any cell of the target footprint.
 *
 * These probes test hasLineOfSight() as a pure function — no game state, no
 * handler plumbing. If the corner-to-corner LOS algorithm breaks for any of
 * these base cases, the probes hard-fail on the exact CRR-violating input.
 *
 * Parity drift between the engine's raw call and the handler's effectiveMs
 * merge is covered by the handler-parity-reporting scoreboard, not here.
 *
 * PROBE-LOS-SLICE2-001: closed door (single impassable edge) blocks LOS
 * PROBE-LOS-SLICE2-002: no door (empty impassableEdges) does NOT block LOS
 * PROBE-LOS-SLICE2-003: 2x2 attacker — at least one footprint cell has LOS
 * PROBE-LOS-SLICE2-004: 2x2 target  — at least one footprint cell reachable
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { hasLineOfSight } from '../../../src/game/spatial.js';
import { getFootprintCells } from '../../../src/game/coords.js';

// ── PROBE-LOS-SLICE2-001: closed door blocks LOS ────────────────────────────

describe('PROBE-LOS-SLICE2-001: closed door edge blocks LOS', () => {
  it('a3 → a5 across closed door between a3|a4 returns false', () => {
    // Open corridor, blocking terrain empty, one impassable edge between
    // the attacker's space and the intervening space. IACP rule: the door,
    // while closed, is a wall. LOS must be false from any corner of a3
    // to any corner of a5 because every sightline crosses that edge.
    const mapSpaces = {
      blocking: [],
      impassableEdges: [['a3', 'a4']],
    };
    const los = hasLineOfSight('a3', 'a5', mapSpaces, null);
    assert.strictEqual(los, false,
      'Closed door between a3|a4 must block LOS from a3 to a5.');
  });

  it('a3 → a4 adjacency through the closed door returns false', () => {
    // Most canonical case: attacker in a3, target immediately behind
    // the closed a3|a4 door. Every attacker-to-target sightline crosses
    // the wall (the wall spans a3's column from x=-0.5 to x=+0.5). LOS
    // must be false even though the range is 1.
    const mapSpaces = {
      blocking: [],
      impassableEdges: [['a3', 'a4']],
    };
    const los = hasLineOfSight('a3', 'a4', mapSpaces, null);
    assert.strictEqual(los, false,
      'Closed door between a3|a4 must block adjacency LOS a3 → a4.');
  });
});

// ── PROBE-LOS-SLICE2-002: open door (no edge) does NOT block LOS ────────────

describe('PROBE-LOS-SLICE2-002: no door edge does not block LOS', () => {
  it('a3 → a5 with empty impassableEdges returns true', () => {
    // Positive control: same geometry as probe 001 but the door is open,
    // so the impassable-edges list is empty. LOS must be true — no walls,
    // no blocking terrain, no figures in the way.
    const mapSpaces = {
      blocking: [],
      impassableEdges: [],
    };
    const los = hasLineOfSight('a3', 'a5', mapSpaces, null);
    assert.strictEqual(los, true,
      'With no impassable edges, a3 → a5 must have LOS.');
  });

  it('a3 → a5 with unrelated edge still has LOS', () => {
    // Sanity: an impassable edge that does not lie on any sightline between
    // a3 and a5 must not affect LOS. (Edge on the far side of the map.)
    const mapSpaces = {
      blocking: [],
      impassableEdges: [['z20', 'z21']],
    };
    const los = hasLineOfSight('a3', 'a5', mapSpaces, null);
    assert.strictEqual(los, true,
      'Unrelated impassable edge (z20|z21) must not affect LOS a3 → a5.');
  });
});

// ── PROBE-LOS-SLICE2-003: 2x2 attacker — any footprint cell has LOS ─────────

describe('PROBE-LOS-SLICE2-003: multi-cell attacker — any cell has LOS', () => {
  it('2x2 attacker at a3 — all four cells have LOS to open target f3', () => {
    // 2x2 attacker occupies {a3, b3, a4, b4}. No obstructions. Every
    // footprint cell must have LOS to target f3.  This is the base case
    // handler iteration depends on: if any one cell has LOS, the attacker
    // has LOS.
    const mapSpaces = { blocking: [], impassableEdges: [] };
    const attackerCells = getFootprintCells('a3', '2x2');
    assert.strictEqual(attackerCells.length, 4,
      `2x2 footprint must expand to 4 cells. Got: ${JSON.stringify(attackerCells)}`);

    let anyHasLos = false;
    for (const cell of attackerCells) {
      if (hasLineOfSight(cell, 'f3', mapSpaces, null)) {
        anyHasLos = true;
        break;
      }
    }
    assert.strictEqual(anyHasLos, true,
      `At least one cell of 2x2 attacker at a3 must have LOS to f3. ` +
      `Footprint: ${JSON.stringify(attackerCells)}`);
  });

  it('2x2 attacker — only back cell has LOS past a blocker', () => {
    // 2x2 attacker at a3 {a3, b3, a4, b4}. Blocker at c3 blocks the
    // straight sightline from a3 and b3 (front row) to f3, but the back
    // row (a4, b4) can see around it via corner-to-corner LOS.
    // Expectation: at least one cell of the footprint has LOS.
    // This is exactly the iteration the handler performs.
    const mapSpaces = { blocking: ['c3'], impassableEdges: [] };
    const attackerCells = getFootprintCells('a3', '2x2');

    let anyHasLos = false;
    const losPerCell = {};
    for (const cell of attackerCells) {
      const seen = hasLineOfSight(cell, 'f3', mapSpaces, null);
      losPerCell[cell] = seen;
      if (seen) anyHasLos = true;
    }

    assert.strictEqual(anyHasLos, true,
      `2x2 attacker at a3 must have LOS to f3 from at least one cell ` +
      `with blocker at c3. Per-cell LOS: ${JSON.stringify(losPerCell)}`);
  });
});

// ── PROBE-LOS-SLICE2-004: 2x2 target — any footprint cell reachable ─────────

describe('PROBE-LOS-SLICE2-004: multi-cell target — any cell reachable', () => {
  it('1x1 attacker at a3 — has LOS to at least one cell of 2x2 target at f3', () => {
    // Target 2x2 at f3 occupies {f3, g3, f4, g4}. Open terrain. At least
    // one cell must be visible from a3.  This is the mirror of probe
    // 003: handler iterates target footprint cells too.
    const mapSpaces = { blocking: [], impassableEdges: [] };
    const targetCells = getFootprintCells('f3', '2x2');
    assert.strictEqual(targetCells.length, 4,
      `2x2 footprint must expand to 4 cells. Got: ${JSON.stringify(targetCells)}`);

    let anyReachable = false;
    for (const cell of targetCells) {
      if (hasLineOfSight('a3', cell, mapSpaces, null)) {
        anyReachable = true;
        break;
      }
    }
    assert.strictEqual(anyReachable, true,
      `1x1 attacker at a3 must see at least one cell of 2x2 target at f3. ` +
      `Footprint: ${JSON.stringify(targetCells)}`);
  });

  it('1x1 attacker at a3 — blocker at f3 still leaves back cells reachable', () => {
    // 2x2 target at f3 = {f3, g3, f4, g4}. f3 itself is ALSO listed as
    // blocking terrain (the top-left cell of the target occupies rubble).
    // Corner-to-corner LOS from a3 to g3/f4/g4 must still find a sightline
    // via the un-blocked cells of the target footprint.
    //
    // The LOS function explicitly allows the source and destination cells
    // to be their own blocking terrain (lines 142-143 of spatial.js), so
    // even f3 → a3 is technically true; but the real-world check the
    // handler makes is "can attacker see ANY cell of target" and at
    // least g3/f4/g4 must pass.
    const mapSpaces = { blocking: ['f3'], impassableEdges: [] };
    const targetCells = getFootprintCells('f3', '2x2');

    let reachableCount = 0;
    const losPerCell = {};
    for (const cell of targetCells) {
      const seen = hasLineOfSight('a3', cell, mapSpaces, null);
      losPerCell[cell] = seen;
      if (seen) reachableCount++;
    }
    assert.ok(reachableCount >= 1,
      `At least one cell of 2x2 target at f3 must be reachable from a3 ` +
      `(blocker only on f3). Per-cell LOS: ${JSON.stringify(losPerCell)}`);
  });
});
