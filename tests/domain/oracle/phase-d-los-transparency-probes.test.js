/**
 * Phase-D probes: LOS-transparency of non-blocking map features.
 *
 * hasLineOfSight (src/game/spatial.js) only consults mapSpaces.blocking
 * (cell-level) and mapSpaces.impassableEdges (edge-level) when deciding
 * whether a ray is obstructed. Every other cell annotation — difficult
 * terrain, crate tokens, terminal tokens, and generic non-door "objects"
 * — is transparent to LOS by construction.
 *
 * PROBE-PD-DT-003: LOS can trace through difficult terrain
 *   (CRR DIFFICULT TERRAIN: "Line of sight can be traced through difficult
 *   terrain.")
 *
 * PROBE-PD-OBJ-002: Non-door objects do not block LOS
 *   (CRR OBJECTS: "Except for doors, objects do not restrict movement or
 *   block line of sight.")
 *
 * PROBE-PD-CRT-001: Crate tokens do not block LOS
 *   (CRR CRATES: "Crate tokens do not block line of sight or figure
 *   movement.")
 *
 * PROBE-PD-TRM-003: Terminal tokens do not block LOS
 *   (CRR TERMINALS: "Terminals do not block line of sight or movement.")
 *
 * All four share the same implementation surface: objects/terrain of these
 * kinds are absent from mapSpaces.blocking, so hasLineOfSight cannot
 * possibly consult them.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { hasLineOfSight } from '../../../src/game/spatial.js';

const OPEN_LINE_MAP = {
  blocking: [],
  impassableEdges: [],
  adjacency: {},
  difficult: ['c1'],
  crates: ['c1'],
  terminals: ['c1'],
};

describe('PROBE-PD-DT-003: LOS passes through difficult terrain', () => {
  it('003: hasLineOfSight a1→e1 with difficult terrain at c1 → true', () => {
    const los = hasLineOfSight('a1', 'e1', OPEN_LINE_MAP);
    assert.strictEqual(los, true,
      'difficult-terrain cell must not appear in blocking set; LOS passes through difficult terrain — CRR-DT-003');
  });
});

describe('PROBE-PD-OBJ-002: Non-door objects do not block LOS', () => {
  it('002: hasLineOfSight with a crate AND a terminal between the endpoints → true', () => {
    const map = {
      blocking: [],
      impassableEdges: [],
      adjacency: {},
      crates: ['b1'],
      terminals: ['c1'],
    };
    const los = hasLineOfSight('a1', 'e1', map);
    assert.strictEqual(los, true,
      'non-door objects (crates, terminals) must never enter the LOS blocking set — CRR-OBJ-002');
  });
});

describe('PROBE-PD-CRT-001: Crate tokens do not block LOS', () => {
  it('001: hasLineOfSight a1→c1 with crate at b1 → true', () => {
    const map = {
      blocking: [],
      impassableEdges: [],
      adjacency: {},
      crates: ['b1'],
    };
    const los = hasLineOfSight('a1', 'c1', map);
    assert.strictEqual(los, true,
      'crate tokens must not block LOS — CRR-CRT-001');
  });
});

describe('PROBE-PD-TRM-003: Terminal tokens do not block LOS', () => {
  it('003: hasLineOfSight a1→c1 with terminal at b1 → true', () => {
    const map = {
      blocking: [],
      impassableEdges: [],
      adjacency: {},
      terminals: ['b1'],
    };
    const los = hasLineOfSight('a1', 'c1', map);
    assert.strictEqual(los, true,
      'terminal tokens must not block LOS — CRR-TRM-003');
  });
});
