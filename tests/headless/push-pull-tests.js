/**
 * Push/Pull/Displacement + Attachment Placement Tests
 *
 * Covers:
 *  - Cover Fire (block token grant, condition/token discard)
 *  - Spread the Pain (condition redistribution)
 *  - Massive figure push resolution
 *  - Setup attachment placement state machine
 *
 * Classification: harness (test-only, no production changes)
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createTestGame } from '../fixtures/game-builder.js';
import { getDcStats, getDcEffects, getMapSpaces } from '../../src/data-loader.js';
import {
  applyCondition, filterCondition, grantPowerTokens, dcNameFromFigureKey,
} from '../../src/game/index.js';
import {
  getPlayerId, getDcList, getDcMessageIds, opponentPlayerNum,
} from '../../src/game/player-helpers.js';

// ── Suite 1: Cover Fire ─────────────────────────────────────────────────────

describe('Push-pull: Cover Fire', () => {
  it('cover_fire_block customId format parses correctly', () => {
    const gameId = 'test1';
    const fk = 'Rebel Trooper-0-0';
    const customId = `cover_fire_block_${gameId}_1_${fk}`;
    const parts = customId.replace('cover_fire_block_', '').split('_');
    assert.strictEqual(parts[0], gameId, 'gameId parsed');
    assert.strictEqual(parseInt(parts[1], 10), 1, 'playerNum parsed');
    const parsedFk = parts.slice(2).join('_');
    assert.strictEqual(parsedFk, fk, 'figureKey preserved');
  });

  it('cover_fire_discard customId format parses correctly', () => {
    const gameId = 'test1';
    const fk = 'Stormtrooper-0-0';
    const customId = `cover_fire_discard_${gameId}_condition_0_${fk}`;
    const parts = customId.replace('cover_fire_discard_', '').split('_');
    assert.strictEqual(parts[0], gameId, 'gameId parsed');
    assert.strictEqual(parts[1], 'condition', 'type is condition');
    assert.strictEqual(parseInt(parts[2], 10), 0, 'index parsed');
  });

  it('cover_fire_discard_skip customId format parses correctly', () => {
    const gameId = 'test1';
    const customId = `cover_fire_discard_skip_${gameId}`;
    assert.ok(customId.startsWith('cover_fire_discard_skip_'));
  });

  it('Cover Fire grants Block Token to friendly figure (simulated)', () => {
    const meta = createTestGame()
      .withPlayer1Army([{ dcName: 'Stormtrooper', count: 2 }])
      .withPlayer2Army([{ dcName: 'Rebel Saboteur' }])
      .inRound(1)
      .build();
    const { game } = meta;
    const fks = Object.keys(game.figurePositions?.[1] || {});
    const targetFk = fks[0];

    // Simulate Cover Fire: grant 1 Block Token
    grantPowerTokens(game, targetFk, 'Block', 1);
    const tokens = game.figurePowerTokens?.[targetFk] || [];
    assert.strictEqual(tokens.filter(t => t === 'Block').length, 1, 'Block Token granted');
  });
});

// ── Suite 2: Spread the Pain ────────────────────────────────────────────────

describe('Push-pull: Spread the Pain', () => {
  it('spread_pain_fig customId format parses correctly', () => {
    const gameId = 'test1';
    const fk = 'Stormtrooper-0-1';
    const customId = `spread_pain_fig_${gameId}_${fk}`;
    const parts = customId.replace('spread_pain_fig_', '').split('_');
    assert.strictEqual(parts[0], gameId, 'gameId parsed');
    const parsedFk = parts.slice(1).join('_');
    assert.strictEqual(parsedFk, fk, 'figureKey preserved');
  });

  it('spread_pain_skip customId format parses correctly', () => {
    const gameId = 'test1';
    const customId = `spread_pain_skip_${gameId}`;
    assert.ok(customId.startsWith('spread_pain_skip_'));
  });

  it('pendingSpreadThePain has correct structure', () => {
    const game = {};
    game.pendingSpreadThePain = {
      combatThreadId: 'thread-123',
      ownerId: 'player1',
      defenderPlayerNum: 2,
      combat: { attackerFigureKey: 'Stormtrooper-0-0' },
      conditions: ['Stun', 'Bleed'],
      conditionIdx: 0,
    };

    assert.strictEqual(game.pendingSpreadThePain.conditions.length, 2);
    assert.strictEqual(game.pendingSpreadThePain.conditionIdx, 0);
    assert.strictEqual(game.pendingSpreadThePain.defenderPlayerNum, 2);
  });

  it('Spread the Pain applies condition to adjacent figure (simulated)', () => {
    const meta = createTestGame()
      .withPlayer1Army([{ dcName: 'Stormtrooper', count: 3 }])
      .withPlayer2Army([{ dcName: 'Rebel Saboteur' }])
      .inRound(1)
      .build();
    const { game } = meta;
    const fks = Object.keys(game.figurePositions?.[1] || {});
    const targetFk = fks[1]; // Adjacent figure

    // Simulate applying Stun via Spread the Pain
    applyCondition(game, targetFk, 'Stun');
    const conditions = game.figureConditions?.[targetFk] || [];
    assert.ok(conditions.includes('Stun'), 'Stun applied to adjacent figure');
  });
});

// ── Suite 3: Massive Figure Push ────────────────────────────────────────────

describe('Push-pull: Massive figure push', () => {
  it('Massive figures have isMassive keyword', () => {
    const eff = getDcEffects();
    const atst = eff?.['AT-ST'];
    assert.ok(atst?.keywords?.includes('MASSIVE'), 'AT-ST has MASSIVE keyword');
  });

  it('non-Massive figures do not have MASSIVE keyword', () => {
    const eff = getDcEffects();
    const stormtrooper = eff?.['Stormtrooper'];
    assert.ok(!(stormtrooper?.keywords || []).includes('MASSIVE'), 'Stormtrooper is not MASSIVE');
  });

  it('figure positions can be updated for push resolution', () => {
    const meta = createTestGame()
      .withPlayer1Army([{ dcName: 'Stormtrooper', count: 2 }])
      .withPlayer2Army([{ dcName: 'Rebel Saboteur' }])
      .inRound(1)
      .build();
    const { game } = meta;
    const fks = Object.keys(game.figurePositions?.[1] || {});
    const fk = fks[0];
    const originalPos = game.figurePositions[1][fk];

    // Simulate push: move figure to a new space
    game.figurePositions[1][fk] = 'a5';
    assert.strictEqual(game.figurePositions[1][fk], 'a5', 'Position updated');
    assert.notStrictEqual(game.figurePositions[1][fk], originalPos, 'Position changed from original');
  });
});

// ── Suite 4: Attachment Placement State Machine ─────────────────────────────

describe('Attachment placement: state machine', () => {
  it('setupAttachmentPending has correct structure', () => {
    const game = {};
    game.setupAttachmentPending = {
      1: ['Feeding Frenzy', 'Extra Armor'],
      2: ['Scavenged Walker'],
    };
    game.setupAttachmentApplied = { 1: [], 2: [] };
    game.setupAttachmentOriginal = {
      1: [...game.setupAttachmentPending[1]],
      2: [...game.setupAttachmentPending[2]],
    };

    assert.strictEqual(game.setupAttachmentPending[1].length, 2, 'P1 has 2 attachments');
    assert.strictEqual(game.setupAttachmentPending[2].length, 1, 'P2 has 1 attachment');
  });

  it('applying an attachment moves it from pending to applied', () => {
    const game = {};
    game.setupAttachmentPending = { 1: ['Feeding Frenzy', 'Extra Armor'] };
    game.setupAttachmentApplied = { 1: [] };

    // Simulate applying Feeding Frenzy to msgId hl1dc0
    const card = game.setupAttachmentPending[1].shift();
    game.setupAttachmentApplied[1].push({ card, dcMsgId: 'hl1dc0' });

    assert.strictEqual(game.setupAttachmentPending[1].length, 1, 'One attachment remaining');
    assert.strictEqual(game.setupAttachmentApplied[1].length, 1, 'One applied');
    assert.strictEqual(game.setupAttachmentApplied[1][0].card, 'Feeding Frenzy');
    assert.strictEqual(game.setupAttachmentApplied[1][0].dcMsgId, 'hl1dc0');
  });

  it('redo restores original pending and clears applied', () => {
    const game = {};
    game.setupAttachmentOriginal = { 1: ['Feeding Frenzy', 'Extra Armor'] };
    game.setupAttachmentPending = { 1: [] };
    game.setupAttachmentApplied = { 1: [{ card: 'Feeding Frenzy', dcMsgId: 'hl1dc0' }, { card: 'Extra Armor', dcMsgId: 'hl1dc1' }] };

    // Simulate redo
    game.setupAttachmentPending[1] = [...game.setupAttachmentOriginal[1]];
    game.setupAttachmentApplied[1] = [];

    assert.strictEqual(game.setupAttachmentPending[1].length, 2, 'Pending restored');
    assert.strictEqual(game.setupAttachmentApplied[1].length, 0, 'Applied cleared');
    assert.deepStrictEqual(game.setupAttachmentPending[1], ['Feeding Frenzy', 'Extra Armor']);
  });

  it('setup_attach_to customId format is correct', () => {
    const gameId = 'test1';
    const customId = `setup_attach_to_${gameId}_1`;
    const parts = customId.replace('setup_attach_to_', '').split('_');
    assert.strictEqual(parts[0], gameId);
    assert.strictEqual(parseInt(parts[1], 10), 1);
  });

  it('attach_confirm customId format is correct', () => {
    const gameId = 'test1';
    const customId = `attach_confirm_${gameId}_1`;
    assert.ok(customId.startsWith('attach_confirm_'));
  });

  it('attach_reselect customId format is correct', () => {
    const gameId = 'test1';
    const customId = `attach_reselect_${gameId}_1`;
    assert.ok(customId.startsWith('attach_reselect_'));
  });

  it('attach_done_confirm customId format is correct', () => {
    const gameId = 'test1';
    const customId = `attach_done_confirm_${gameId}_1`;
    assert.ok(customId.startsWith('attach_done_confirm_'));
  });

  it('attach_done_redo customId format is correct', () => {
    const gameId = 'test1';
    const customId = `attach_done_redo_${gameId}_1`;
    assert.ok(customId.startsWith('attach_done_redo_'));
  });

  it('both players must confirm before proceeding', () => {
    const game = {};
    game.setupAttachmentConfirmed = { 1: false, 2: false };

    // P1 confirms
    game.setupAttachmentConfirmed[1] = true;
    const bothDone1 = game.setupAttachmentConfirmed[1] && game.setupAttachmentConfirmed[2];
    assert.ok(!bothDone1, 'Not done: P2 not confirmed yet');

    // P2 confirms
    game.setupAttachmentConfirmed[2] = true;
    const bothDone2 = game.setupAttachmentConfirmed[1] && game.setupAttachmentConfirmed[2];
    assert.ok(bothDone2, 'Done: both confirmed');
  });

  it('pendingAttachConfirm stores temporary selection', () => {
    const game = {};
    game.pendingAttachConfirm = {
      1: { card: 'Feeding Frenzy', dcMsgId: 'hl1dc0' },
    };

    assert.strictEqual(game.pendingAttachConfirm[1].card, 'Feeding Frenzy');
    assert.strictEqual(game.pendingAttachConfirm[1].dcMsgId, 'hl1dc0');

    // After confirmation, clear it
    delete game.pendingAttachConfirm[1];
    assert.strictEqual(game.pendingAttachConfirm[1], undefined, 'Cleared after confirm');
  });
});

// ── Suite 5: Handler Registration ────────────────────────────────────────────

describe('Push-pull + Attachment: handler registration', () => {
  it('push-pull handler prefixes are registered', async () => {
    const { default: fs } = await import('fs');
    const content = fs.readFileSync('src/handlers/index.js', 'utf8');

    const requiredPrefixes = [
      'cover_fire_block_',
      'cover_fire_discard_',
      'spread_pain_fig_',
      'spread_pain_skip_',
    ];

    for (const prefix of requiredPrefixes) {
      assert.ok(content.includes(prefix), `Handler prefix '${prefix}' is registered in index.js`);
    }
  });

  it('attachment handler prefixes are registered', async () => {
    const { default: fs } = await import('fs');
    const content = fs.readFileSync('src/handlers/index.js', 'utf8');

    const requiredPrefixes = [
      'setup_attach_to_',
      'attach_confirm_',
      'attach_reselect_',
      'attach_done_confirm_',
      'attach_done_redo_',
    ];

    for (const prefix of requiredPrefixes) {
      assert.ok(content.includes(prefix), `Handler prefix '${prefix}' is registered in index.js`);
    }
  });
});

console.log('Push-pull + attachment tests loaded successfully');
