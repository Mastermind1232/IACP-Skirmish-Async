/**
 * Tier 3 Legality-Oracle Probes: Interact Legality (D1)
 *
 * Tests the pre-filter gates in available-actions.js that block interact for
 * Non-Sentient and companion figures, plus the Beast Tamer override and
 * Alter Mind interact blocking through real board computation.
 *
 * Map: mos-eisley-outskirts. Terminal at h21. h21 adjacency: h20,h22,i21,g20,g22,i20,i22.
 * Verified: e21 is exactly 3 game-spaces from h21.
 *
 * PROBE-INT-001: Non-Sentient figure → no interact even at terminal
 * PROBE-INT-002: Companion figure → no interact even at terminal
 * PROBE-INT-003: Normal figure at terminal → interact offered (Use Terminal)
 * PROBE-INT-004: beastTamerInteractOverride on Non-Sentient → interact offered
 * PROBE-INT-005: Alter Mind blocks interact for cost≤9 figure at terminal
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createTestGame } from '../../fixtures/game-builder.js';
import { getAvailableActions } from '../../../src/engine/available-actions.js';

// Terminal h21 on mos-eisley-outskirts

/** Find DC info from dcMessageMeta by player number and DC name. */
function getDcInfo(game, dcMessageMeta, playerNum, dcName) {
  for (const [msgId, meta] of dcMessageMeta) {
    if (meta.gameId !== game.gameId || meta.playerNum !== playerNum) continue;
    if (dcName && meta.dcName !== dcName) continue;
    const figKey = Object.keys(game.figurePositions[playerNum] || {})
      .find(fk => fk.startsWith(meta.dcName + '-'));
    return { msgId, meta, figKey };
  }
  return null;
}

/**
 * Build a game with P1's DC figure placed ON the h21 terminal, mid-activation.
 * P2 is placed far away so they don't interfere with control/adjacency.
 */
function buildInteractScenario(p1DcName) {
  const { game, deps, dcMessageMeta } = createTestGame()
    .withPlayer1Army([{ dcName: p1DcName }])
    .withPlayer2Army([{ dcName: 'Greedo' }])
    .inRound(1)
    .build();

  const dc = getDcInfo(game, dcMessageMeta, 1, p1DcName);
  const p2FigKey = Object.keys(game.figurePositions[2])[0];

  // Place P1 figure ON the terminal, P2 far away
  game.figurePositions[1][dc.figKey] = 'h21';
  game.figurePositions[2][p2FigKey] = 'a1';

  // Mid-activation: 2 actions remaining (interact costs 1)
  game.dcActionsData = game.dcActionsData || {};
  game.dcActionsData[dc.msgId] = { remaining: 2, total: 2, specialsUsed: [] };

  return { game, deps, dcMessageMeta, dc };
}

// ── PROBE-INT-001: Non-Sentient → no interact ────────────────────────────

describe('PROBE-INT-001: Non-Sentient figure cannot interact', () => {
  it('001: Nexu (Non-Sentient) at terminal h21 → no interact offered', () => {
    const { game, deps } = buildInteractScenario('Nexu (Regular)');

    const actions = getAvailableActions(game, 1, deps);
    const interacts = actions.filter(a => a.type === 'interact');

    assert.equal(interacts.length, 0,
      `Non-Sentient Nexu should not get interact. Got: [${actions.map(a => a.type)}]`);
  });
});

// ── PROBE-INT-002: Companion → no interact ───────────────────────────────

describe('PROBE-INT-002: Companion figure cannot interact', () => {
  it('002: Salacious B. Crumb (companion) at terminal h21 → no interact offered', () => {
    const { game, deps } = buildInteractScenario('Salacious B. Crumb');

    const actions = getAvailableActions(game, 1, deps);
    const interacts = actions.filter(a => a.type === 'interact');

    assert.equal(interacts.length, 0,
      `Companion Salacious B. Crumb should not get interact. Got: [${actions.map(a => a.type)}]`);
  });
});

// ── PROBE-INT-003: Normal figure at terminal → interact offered ──────────

describe('PROBE-INT-003: Normal figure at terminal gets interact', () => {
  it('003: Bossk (normal) at terminal h21 → interact offered', () => {
    const { game, deps } = buildInteractScenario('Bossk');

    const actions = getAvailableActions(game, 1, deps);
    const interacts = actions.filter(a => a.type === 'interact');

    assert.ok(interacts.length > 0,
      `Normal Bossk at terminal should get interact. Got types: [${actions.map(a => a.type)}]`);

    // Should include "Use Terminal" option
    const terminalInteract = interacts.find(a => a.params?.optionLabel === 'Use Terminal');
    assert.ok(terminalInteract, 'Should include Use Terminal option');
  });
});

// ── PROBE-INT-004: Beast Tamer override on Non-Sentient ──────────────────

describe('PROBE-INT-004: beastTamerInteractOverride allows Non-Sentient to interact', () => {
  it('004: Nexu + beastTamerInteractOverride → interact offered', () => {
    const { game, deps, dc } = buildInteractScenario('Nexu (Regular)');

    // Set Beast Tamer override for this DC
    game.beastTamerInteractOverride = { [dc.msgId]: true };

    const actions = getAvailableActions(game, 1, deps);
    const interacts = actions.filter(a => a.type === 'interact');

    assert.ok(interacts.length > 0,
      `beastTamerInteractOverride should let Non-Sentient Nexu interact. Got types: [${actions.map(a => a.type)}]`);
  });
});

// ── PROBE-INT-005: Alter Mind blocks interact at terminal ────────────────

describe('PROBE-INT-005: Alter Mind blocks interact for cost≤9 figure at terminal', () => {
  it('005: P1 Stormtrooper (cost 6) at terminal, P2 Obi-Wan 3 spaces away → no interact', () => {
    // Use Stormtrooper (cost 6 ≤ 9) to avoid Non-Sentient/companion gates
    const { game, deps, dcMessageMeta } = createTestGame()
      .withPlayer1Army([{ dcName: 'Stormtrooper (Regular)' }])
      .withPlayer2Army([{ dcName: 'Obi-Wan Kenobi' }])
      .inRound(1)
      .build();

    const dc = getDcInfo(game, dcMessageMeta, 1, 'Stormtrooper (Regular)');
    const p2FigKey = Object.keys(game.figurePositions[2])[0];

    // P1 Stormtrooper ON terminal h21
    game.figurePositions[1][dc.figKey] = 'h21';
    // P2 Obi-Wan at e21 (exactly 3 spaces from h21 — verified via BFS)
    game.figurePositions[2][p2FigKey] = 'e21';

    game.dcActionsData = game.dcActionsData || {};
    game.dcActionsData[dc.msgId] = { remaining: 2, total: 2, specialsUsed: [] };

    const actions = getAvailableActions(game, 1, deps);
    const interacts = actions.filter(a => a.type === 'interact');

    assert.equal(interacts.length, 0,
      'Alter Mind: cost≤9 figure within 3 spaces of Obi-Wan should NOT get interact');
  });
});
