/**
 * Tier 3 Legality-Oracle Probes: Ability-Driven Control Exclusion (D8/ABILITY)
 *
 * Tests run through the REAL getSpaceController() from board-helpers.js — no mocking.
 * All distances verified: d1 ↔ a1 = 3 game-spaces on mos-eisley-outskirts.
 *
 * PROBE-ABILITY-001: Alter Mind (Obi-Wan Kenobi) excludes opponent cost≤9 figures from control
 *   a) No Alter Mind → P2 controls target (only P2 present)
 *   b) P1 Obi-Wan within 3 spaces → P2 Stormtrooper (cost 6) excluded → null
 *
 * PROBE-ABILITY-002: Powerful Influence excludes opponent figures near Rebel Force User
 *   a) No Powerful Influence → null (both players present = shared)
 *   b) powerfulInfluencePlayerNum set → P2 excluded → P1 controls
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { getSpaceController } from '../../../src/game/board-helpers.js';

const MAP_ID = 'mos-eisley-outskirts';

// a1 adjacency: [a2, b1, b2]
// d1 is 3 game-spaces from a1 — NOT adjacent to a1

function buildGame(p1Positions = {}, p2Positions = {}, extra = {}) {
  return {
    player1Id: 'p1',
    player2Id: 'p2',
    player1VP: { total: 0, kills: 0, objectives: 0 },
    player2VP: { total: 0, kills: 0, objectives: 0 },
    figurePositions: { 1: p1Positions, 2: p2Positions },
    selectedMap: { id: MAP_ID },
    ended: false,
    ...extra,
  };
}

// ── PROBE-ABILITY-001: Alter Mind control exclusion ───────────────────────

describe('PROBE-ABILITY-001: Alter Mind excludes opponent cost≤9 figures from space control', () => {
  it('001a: control — no Alter Mind DC present → P2 controls a1 normally', () => {
    // P2 has Stormtrooper (cost 6) ON a1
    // P1 has a non-Obi-Wan figure at d1 (3 spaces, NOT adjacent to a1)
    const game = buildGame(
      { 'Bossk-0-0': 'd1' },
      { 'Stormtrooper (Regular)-0-0': 'a1' },
    );

    const result = getSpaceController(game, MAP_ID, 'a1');
    assert.equal(result, 2, 'P2 should control a1 (only P2 on/adjacent, Bossk has no Alter Mind)');
  });

  it('001b: Alter Mind active — P2 cost≤9 figure within 3 spaces of Obi-Wan excluded → null', () => {
    // P1 has Obi-Wan Kenobi at d1 (has alter_mind_obiwan ability)
    // P2 has Stormtrooper (cost 6 ≤ 9) at a1 — 3 spaces from Obi-Wan
    // Alter Mind: P2's cost≤9 figures within 3 spaces of P1's Obi-Wan don't count for control
    // P2's Stormtrooper excluded → no P2 presence
    // P1's Obi-Wan at d1 is NOT adjacent to a1 → no P1 presence
    // Result: null (nobody controls)
    const game = buildGame(
      { 'Obi-Wan Kenobi-0-0': 'd1' },
      { 'Stormtrooper (Regular)-0-0': 'a1' },
    );

    const result = getSpaceController(game, MAP_ID, 'a1');
    assert.equal(result, null,
      'Alter Mind: P2 Stormtrooper (cost 6) within 3 spaces of Obi-Wan excluded → no controller');
  });
});

// ── PROBE-ABILITY-002: Powerful Influence control exclusion ───────────────

describe('PROBE-ABILITY-002: Powerful Influence excludes opponent figures near Rebel Force User', () => {
  it('002a: control — no Powerful Influence → both present → null (shared)', () => {
    // P1 has Luke Skywalker (FORCE USER, Rebel) at b1 — adjacent to a1
    // P2 has Stormtrooper at a1
    // No Powerful Influence active → both have presence → null
    const game = buildGame(
      { 'Luke Skywalker-0-0': 'b1' },
      { 'Stormtrooper (Regular)-0-0': 'a1' },
    );

    const result = getSpaceController(game, MAP_ID, 'a1');
    assert.equal(result, null, 'Both players present → null (shared, no exclusion)');
  });

  it('002b: Powerful Influence active — P2 excluded near P1 Force User → P1 controls', () => {
    // P1 has Luke Skywalker (FORCE USER, Rebel) at b1 — adjacent to a1
    // P2 has Stormtrooper at a1
    // powerfulInfluencePlayerNum = 1 → P2's figures within 3 spaces of P1's Force User excluded
    // b1 ↔ a1 = 1 space (within 3) → P2 Stormtrooper excluded
    // P1 Luke at b1 is adjacent to a1 → P1 has presence
    // P2 excluded → no P2 presence
    // Result: P1 controls
    const game = buildGame(
      { 'Luke Skywalker-0-0': 'b1' },
      { 'Stormtrooper (Regular)-0-0': 'a1' },
      { powerfulInfluencePlayerNum: 1 },
    );

    const result = getSpaceController(game, MAP_ID, 'a1');
    assert.equal(result, 1,
      'Powerful Influence: P2 Stormtrooper within 3 of P1 Force User excluded → P1 controls');
  });
});
