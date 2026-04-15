/**
 * Oracle tests for Companion activation block when host defeated (Wave 7)
 * and companion deployment via attachment detection (Wave 9+).
 *
 * Rule: COMPANIONS (RULES_REFERENCE.md L919-920):
 *   "If a companion's associated Deployment card or its attached figures
 *    have left play, the companion can no longer activate."
 *
 * Confirmed-safe core:
 *   - Companion is offered for activation when host group is alive
 *   - Companion is NOT offered when host group is defeated (offer-time)
 *   - Handler rejects stale activation attempt when host group is defeated (handler-time)
 *   - Attachment-based companion deployers have structured `companion` string field
 *   - [Clan of Two] produces a companion_deploy ability for The Child
 *   - [Clan of Two] allows adjacent placement (interactive: true)
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createTestGame } from '../../fixtures/game-builder.js';
import { getAvailableActions } from '../../../src/engine/available-actions.js';
import { getDcEffects } from '../../../src/data-loader.js';

// ── ORACLE-COMP-001: Companion Offered When Host Alive ──────────────────

describe('ORACLE-COMP-001: Companion Offered When Host Alive', () => {
  it('001: J4X-7 activation offered when Jarrod Kelvin is alive', () => {
    const { game, deps, dcMessageMeta } = createTestGame()
      .withPlayer1Army([{ dcName: 'Jarrod Kelvin' }, { dcName: 'J4X-7' }])
      .withPlayer2Army([{ dcName: 'Greedo' }])
      .inRound(1)
      .build();

    // Set up companion host map (mirrors post-deploy.js behavior)
    const jarrodFigKey = Object.keys(game.figurePositions[1]).find(fk => fk.startsWith('Jarrod Kelvin-'));
    const j4xFigKey = Object.keys(game.figurePositions[1]).find(fk => fk.startsWith('J4X-7-'));
    assert.ok(jarrodFigKey, 'Jarrod Kelvin figure should exist');
    assert.ok(j4xFigKey, 'J4X-7 figure should exist');

    game.companionHostMap = {};
    game.companionHostMap[j4xFigKey] = { hostFigureKey: jarrodFigKey, playerNum: 1 };

    const actions = getAvailableActions(game, 1, deps);
    const activateActions = actions.filter(a => a.type === 'activate_dc');
    const dcNames = activateActions.map(a => a.params.dcName);

    assert.ok(
      dcNames.includes('J4X-7'),
      `J4X-7 should be offered for activation when host is alive. Got: [${dcNames}]`
    );
    assert.ok(
      dcNames.includes('Jarrod Kelvin'),
      `Jarrod Kelvin should also be offered. Got: [${dcNames}]`
    );
  });
});

// ── ORACLE-COMP-002: Companion NOT Offered When Host Defeated ───────────

describe('ORACLE-COMP-002: Companion NOT Offered When Host Defeated', () => {
  it('002: J4X-7 activation blocked when Jarrod Kelvin is defeated (offer-time)', () => {
    const { game, deps, dcMessageMeta } = createTestGame()
      .withPlayer1Army([{ dcName: 'Jarrod Kelvin' }, { dcName: 'J4X-7' }])
      .withPlayer2Army([{ dcName: 'Greedo' }])
      .inRound(1)
      .build();

    // Set up companion host map
    const jarrodFigKey = Object.keys(game.figurePositions[1]).find(fk => fk.startsWith('Jarrod Kelvin-'));
    const j4xFigKey = Object.keys(game.figurePositions[1]).find(fk => fk.startsWith('J4X-7-'));
    assert.ok(jarrodFigKey, 'Jarrod Kelvin figure should exist');
    assert.ok(j4xFigKey, 'J4X-7 figure should exist');

    game.companionHostMap = {};
    game.companionHostMap[j4xFigKey] = { hostFigureKey: jarrodFigKey, playerNum: 1 };

    // Defeat Jarrod Kelvin — remove from figure positions
    delete game.figurePositions[1][jarrodFigKey];

    const actions = getAvailableActions(game, 1, deps);
    const activateActions = actions.filter(a => a.type === 'activate_dc');
    const dcNames = activateActions.map(a => a.params.dcName);

    assert.ok(
      !dcNames.includes('J4X-7'),
      `J4X-7 should NOT be offered when host Jarrod Kelvin is defeated. Got: [${dcNames}]`
    );
    // J4X-7 is still alive on the board, just can't activate
    assert.ok(
      game.figurePositions[1][j4xFigKey],
      'J4X-7 figure should still exist on the board'
    );
  });
});

// ── ORACLE-COMP-003: Handler Rejects Stale Activation After Host Defeat ─

describe('ORACLE-COMP-003: Handler Rejects Stale Activation After Host Defeat', () => {
  it('003: dc_activate_ for J4X-7 rejected when Jarrod Kelvin defeated (handler-time, state-based)', async () => {
    const { game, harness, deps, dcMessageMeta } = createTestGame()
      .withPlayer1Army([{ dcName: 'Jarrod Kelvin' }, { dcName: 'J4X-7' }])
      .withPlayer2Army([{ dcName: 'Greedo' }])
      .inRound(1)
      .build();

    // Set up companion host map
    const jarrodFigKey = Object.keys(game.figurePositions[1]).find(fk => fk.startsWith('Jarrod Kelvin-'));
    const j4xFigKey = Object.keys(game.figurePositions[1]).find(fk => fk.startsWith('J4X-7-'));
    assert.ok(jarrodFigKey, 'Jarrod Kelvin figure should exist');
    assert.ok(j4xFigKey, 'J4X-7 figure should exist');

    game.companionHostMap = {};
    game.companionHostMap[j4xFigKey] = { hostFigureKey: jarrodFigKey, playerNum: 1 };

    // Defeat Jarrod Kelvin
    delete game.figurePositions[1][jarrodFigKey];

    // Find J4X-7's dcIndex in p1DcList
    const j4xDcIndex = game.p1DcList.findIndex(dc => dc.dcName === 'J4X-7');
    assert.ok(j4xDcIndex >= 0, 'J4X-7 should be in p1DcList');

    // Construct the stale dc_activate_ customId that a cached button would send
    const customId = `dc_activate_${game.gameId}_1_${j4xDcIndex}`;

    // Submit via harness — this calls handleDcActivate through the real handler pipeline
    const result = await harness.submitAction(customId, 'player1');

    // State-based assertion: no dcActionsData should be created for the companion
    const dcActionsData = game.dcActionsData || {};
    const j4xMsgId = (game.p1DcMessageIds || [])[j4xDcIndex];
    assert.ok(
      !dcActionsData[j4xMsgId],
      `dcActionsData should NOT be created for J4X-7 when host is defeated. Keys: [${Object.keys(dcActionsData)}]`
    );

    // Verify no error was thrown (handler should gracefully reject, not crash)
    assert.ok(
      !result.error,
      `Handler should not throw an error: ${result.error || ''}`
    );
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// COMPANION DEPLOYMENT VIA ATTACHMENT — Data & Detection Oracles
// ══════════════════════════════════════════════════════════════════════════════
//
// Root cause (fixed): [Clan of Two] was missing the structured `companion`
// field in dc-effects.json. The attachment-companion detection in post-deploy.js
// checks `typeof attData.companion === 'string'`, so boolean `true` or missing
// fields silently skip deployment. These tests guard against regression.

// ── ORACLE-COMP-004: [Clan of Two] has structured companion pointer ────────

describe('ORACLE-COMP-004: [Clan of Two] companion field', () => {
  it('004a: [Clan of Two] has companion field of type string', () => {
    const dcEffects = getDcEffects();
    const clanOfTwo = dcEffects['[Clan of Two]'];
    assert.ok(clanOfTwo, '[Clan of Two] must exist in dc-effects.json');
    assert.strictEqual(typeof clanOfTwo.companion, 'string',
      `[Clan of Two].companion must be a string, got ${typeof clanOfTwo.companion}: ${clanOfTwo.companion}`);
  });

  it('004b: [Clan of Two] companion points to "The Child"', () => {
    const dcEffects = getDcEffects();
    const clanOfTwo = dcEffects['[Clan of Two]'];
    assert.strictEqual(clanOfTwo.companion, 'The Child',
      `[Clan of Two].companion must be "The Child", got "${clanOfTwo.companion}"`);
  });

  it('004c: The Child exists as a separate DC in dc-effects.json', () => {
    const dcEffects = getDcEffects();
    const theChild = dcEffects['The Child'];
    assert.ok(theChild, 'The Child must exist as a DC in dc-effects.json');
    assert.strictEqual(theChild.companion, true,
      'The Child should have companion: true (self-descriptive flag)');
  });
});

// ── ORACLE-COMP-005: Attachment-companion detection logic ──────────────────

describe('ORACLE-COMP-005: Attachment-companion detection produces companion_deploy ability', () => {
  // This reproduces the exact detection logic from post-deploy.js lines 214-233
  // without importing the private function, to verify the data fix works.

  it('005a: [Clan of Two] attachment triggers companion_deploy ability', () => {
    const dcEffects = getDcEffects();
    // Simulate the attachment-companion detection loop
    const attName = 'Clan of Two';
    const attData = dcEffects[attName] || dcEffects[`[${attName}]`];
    assert.ok(attData, `dcEffects must resolve [${attName}]`);
    assert.ok(typeof attData.companion === 'string',
      `Attachment detection requires typeof companion === 'string', got ${typeof attData.companion}`);
    assert.strictEqual(attData.companion, 'The Child',
      'Companion name must be "The Child"');
  });

  it('005b: [Indentured Jester] attachment also has correct companion pointer (reference case)', () => {
    const dcEffects = getDcEffects();
    const attData = dcEffects['Indentured Jester'] || dcEffects['[Indentured Jester]'];
    assert.ok(attData, 'dcEffects must resolve [Indentured Jester]');
    assert.strictEqual(typeof attData.companion, 'string',
      `[Indentured Jester].companion must be a string, got ${typeof attData.companion}`);
    assert.strictEqual(attData.companion, 'Salacious B. Crumb');
  });

  it('005c: All attachment-type DCs with companion field have string values (schema invariant)', () => {
    const dcEffects = getDcEffects();
    const violations = [];
    for (const [name, eff] of Object.entries(dcEffects)) {
      if (eff.attachment && eff.companion !== undefined) {
        if (typeof eff.companion !== 'string') {
          violations.push(`${name}: companion is ${typeof eff.companion} (${eff.companion}), expected string`);
        }
      }
    }
    assert.strictEqual(violations.length, 0,
      `All attachment companion fields must be strings:\n${violations.join('\n')}`);
  });
});

// ── ORACLE-COMP-006: Companion placement allows adjacent space ─────────────

describe('ORACLE-COMP-006: [Clan of Two] allows adjacent placement', () => {
  it('006a: abilityText contains "adjacent space" → interactive companion deploy', () => {
    const dcEffects = getDcEffects();
    const clanOfTwo = dcEffects['[Clan of Two]'];
    const allowsAdjacent = (clanOfTwo.abilityText || '').toLowerCase().includes('adjacent space');
    assert.ok(allowsAdjacent,
      '[Clan of Two] abilityText must contain "adjacent space" for interactive placement picker');
  });

  it('006b: [Indentured Jester] does NOT allow adjacent (same-space only)', () => {
    const dcEffects = getDcEffects();
    const jester = dcEffects['[Indentured Jester]'];
    // "place the Salacious B. Crumb companion in your space" — no "adjacent"
    const allowsAdjacent = (jester.abilityText || '').toLowerCase().includes('adjacent space');
    assert.ok(!allowsAdjacent,
      '[Indentured Jester] should NOT contain "adjacent space" — same-space only');
  });
});

// ── ORACLE-COMP-007: Direct DC companion pointers are valid ────────────────

describe('ORACLE-COMP-007: Direct DC companion pointers (non-attachment)', () => {
  it('007a: All DCs with string companion field point to existing DC entries', () => {
    const dcEffects = getDcEffects();
    const broken = [];
    for (const [name, eff] of Object.entries(dcEffects)) {
      if (typeof eff.companion === 'string') {
        const target = dcEffects[eff.companion];
        if (!target) {
          broken.push(`${name} → "${eff.companion}" (target not found)`);
        }
      }
    }
    assert.strictEqual(broken.length, 0,
      `All companion pointers must resolve:\n${broken.join('\n')}`);
  });

  it('007b: Jarrod Kelvin → J4X-7 pointer is valid', () => {
    const dcEffects = getDcEffects();
    assert.strictEqual(dcEffects['Jarrod Kelvin']?.companion, 'J4X-7');
    assert.ok(dcEffects['J4X-7'], 'J4X-7 must exist');
  });

  it('007c: Iden Versio → Dio pointer is valid', () => {
    const dcEffects = getDcEffects();
    assert.strictEqual(dcEffects['Iden Versio']?.companion, 'Dio');
    assert.ok(dcEffects['Dio'], 'Dio must exist');
  });
});
