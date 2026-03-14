/**
 * Live verification tests — exercise the EXACT runtime code paths
 * that Discord interactions hit, with mock Discord client.
 *
 * These tests call the real exported functions from setup.js and
 * validation.js, not reimplemented copies.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { _sendAttachmentDropdown } from '../../src/handlers/setup.js';
import { validateArmyAffiliation } from '../../src/game/validation.js';
import { grantPowerTokens } from '../../src/game/game-helpers.js';
import { getDcEffects } from '../../src/data-loader.js';

// ── Mock Discord client ─────────────────────────────────────────────────────

function mockClient() {
  const sent = [];
  return {
    channels: {
      fetch: async () => ({
        send: async (payload) => { sent.push(payload); return { id: 'msg1' }; },
      }),
    },
    sent,
  };
}

function buildGame(dcNames, playerNum = 1) {
  const effects = getDcEffects();
  const dcList = dcNames.map(name => {
    const stats = effects[name] || effects[`[${name}]`] || {};
    return { dcName: name, displayName: name, ...stats };
  });
  const dcMsgIds = dcNames.map((_, i) => `msgId_${i}`);
  const pn = playerNum;
  const game = {
    gameId: 'test1',
    [`p${pn}DcList`]: dcList,
    [`p${pn}DcMessageIds`]: dcMsgIds,
    [`p${pn}HandId`]: 'hand1',
    setupAttachmentPending: { [pn]: [] },
    setupAttachmentApplied: { [pn]: [] },
  };
  return game;
}

// ── Scenario 1: Flame Trooper → Heavy Stormtrooper (Elite) ──────────────

describe('live verification: attachment restrictions', () => {
  it('Scenario 1: [Flame Trooper] offers Heavy Stormtrooper (Elite) as valid target', async () => {
    const game = buildGame(['Heavy Stormtrooper (Elite)', 'Luke Skywalker', 'Stormtrooper (Elite)']);
    game.setupAttachmentPending[1] = ['[Flame Trooper]'];
    const client = mockClient();

    await _sendAttachmentDropdown(game, 'test1', 1, '[Flame Trooper]', client);

    assert.strictEqual(client.sent.length, 1);
    const payload = client.sent[0];
    // Should have components (select menu), not the "no valid targets" skip message
    assert.ok(payload.components, 'should have components (not skipped)');
    assert.ok(!payload.content?.includes('no valid Deployment Card targets'), 'should NOT skip');

    // Extract options from the select menu
    const select = payload.components[0].components[0];
    const optionLabels = select.options.map(o => o.data.label);
    assert.ok(optionLabels.includes('Heavy Stormtrooper (Elite)'),
      `options should include Heavy Stormtrooper (Elite), got: ${optionLabels}`);
    assert.ok(!optionLabels.includes('Luke Skywalker'),
      'should NOT include Luke Skywalker (unique, Rebel)');
    assert.ok(!optionLabels.includes('Stormtrooper (Elite)'),
      'should NOT include Stormtrooper (Elite) (3 figures, not 2)');
  });

  it('Scenario 2: [Mortar Trooper] offers only Shoretrooper as target', async () => {
    const game = buildGame(['Shoretrooper (Elite)', 'Stormtrooper (Elite)', 'Imperial Officer (Elite)']);
    game.setupAttachmentPending[1] = ['[Mortar Trooper]'];
    const client = mockClient();

    await _sendAttachmentDropdown(game, 'test1', 1, '[Mortar Trooper]', client);

    assert.strictEqual(client.sent.length, 1);
    const payload = client.sent[0];
    assert.ok(payload.components, 'should have components (not skipped)');

    const select = payload.components[0].components[0];
    const optionLabels = select.options.map(o => o.data.label);
    assert.ok(optionLabels.includes('Shoretrooper (Elite)'),
      `should include Shoretrooper (Elite), got: ${optionLabels}`);
    assert.ok(!optionLabels.includes('Stormtrooper (Elite)'),
      'should NOT include Stormtrooper (Elite)');
    assert.ok(!optionLabels.includes('Imperial Officer (Elite)'),
      'should NOT include Imperial Officer (Elite)');
  });

  it('Scenario 3: [Clan of Two] only offers unique guardians', async () => {
    const effects = getDcEffects();
    // Find a unique guardian in the data
    const guardianEntry = Object.entries(effects).find(([, s]) =>
      s.unique && (s.keywords || []).some(k => String(k).toUpperCase() === 'GUARDIAN')
      && !s.attachment
    );
    const guardianName = guardianEntry ? guardianEntry[0] : null;
    assert.ok(guardianName, 'should find at least one unique GUARDIAN in dc-effects.json');

    // Build game with guardian + non-guardian + non-unique
    const game = buildGame([guardianName, 'Stormtrooper (Elite)', 'Luke Skywalker']);
    game.setupAttachmentPending[1] = ['[Clan of Two]'];
    const client = mockClient();

    await _sendAttachmentDropdown(game, 'test1', 1, '[Clan of Two]', client);

    const payload = client.sent[0];
    assert.ok(payload.components, 'should have components (not skipped)');

    const select = payload.components[0].components[0];
    const optionLabels = select.options.map(o => o.data.label);
    assert.ok(optionLabels.includes(guardianName),
      `should include unique guardian ${guardianName}, got: ${optionLabels}`);
    assert.ok(!optionLabels.includes('Stormtrooper (Elite)'),
      'should NOT include non-unique non-guardian');
    // Luke Skywalker: unique but not GUARDIAN (unless he has the keyword)
    const lukeKw = (effects['Luke Skywalker']?.keywords || []).map(k => String(k).toUpperCase());
    if (!lukeKw.includes('GUARDIAN')) {
      assert.ok(!optionLabels.includes('Luke Skywalker'),
        'should NOT include unique non-GUARDIAN');
    }
  });
});

// ── Scenario 4: TA affiliation warnings ─────────────────────────────────

describe('live verification: TA affiliation warnings', () => {
  it('Scenario 4: Scum army with [Temporary Alliance] — no mismatch warning for TA itself', () => {
    // Build a Scum-primary army with unqualified TA
    const squad = {
      dcList: [
        'Bossk', 'Greedo', 'HK Assassin Droid (Elite)',
        '[Temporary Alliance]', 'AT-DP',
      ],
    };
    const result = validateArmyAffiliation(squad);

    // TA should auto-detect as Mercenary (Scum army)
    const taAutoWarning = result.warnings.find(w => w.includes('resolved as TA (Mercenary)'));
    assert.ok(taAutoWarning, 'should show TA auto-detection message');

    // TA card itself should NOT produce an affiliation mismatch warning
    const taMismatch = result.warnings.find(w =>
      w.includes('"[Temporary Alliance]"') && w.includes('but army primary affiliation')
    );
    assert.ok(!taMismatch,
      `TA card should not produce affiliation mismatch, got warnings: ${JSON.stringify(result.warnings)}`);

    // AT-DP is Imperial — should still warn (not excused by TA for Rebel DCs)
    // Actually AT-DP is Imperial in a Scum army, TA(M) allows Rebel not Imperial,
    // so AT-DP should still warn
    const atdpWarn = result.warnings.find(w => w.includes('AT-DP'));
    assert.ok(atdpWarn, 'AT-DP (Imperial) should still warn in Scum army');
  });
});

// ── Scenario 5: Into the Fray token overflow ────────────────────────────

describe('live verification: token cap enforcement', () => {
  it('Scenario 5: Into the Fray — 4 hostiles with LOS — grants all 4 but queues overflow', () => {
    const game = {};

    // Simulate the exact code path from activation.js (now uses grantPowerTokens)
    const selfFk = 'Baze Malbus-1-0';
    const surgeCount = 4; // 4 hostiles with LOS

    // This is exactly what the handler now does:
    grantPowerTokens(game, selfFk, 'Surge', surgeCount);

    // All 4 tokens granted (grantPowerTokens always grants, then queues overflow)
    assert.strictEqual(game.figurePowerTokens[selfFk].length, 4);
    assert.deepStrictEqual(game.figurePowerTokens[selfFk], ['Surge', 'Surge', 'Surge', 'Surge']);

    // Overflow queued: 4 tokens, max 2, so player must discard 2
    assert.ok(game.pendingPowerTokenOverflow, 'should have pending overflow');
    assert.strictEqual(game.pendingPowerTokenOverflow.length, 1);
    assert.strictEqual(game.pendingPowerTokenOverflow[0].figureKey, selfFk);
    assert.strictEqual(game.pendingPowerTokenOverflow[0].discardCount, 2);
  });

  it('Beskar Armor — 2 Block tokens exactly at cap — no overflow', () => {
    const game = {};
    grantPowerTokens(game, 'Din Djarin-1-0', 'Block', 2);
    assert.strictEqual(game.figurePowerTokens['Din Djarin-1-0'].length, 2);
    assert.strictEqual(game.pendingPowerTokenOverflow, undefined);
  });

  it('Security Detail + another grant — overflow triggers on 3rd token', () => {
    const game = {};
    // Security Detail auto-resolve
    grantPowerTokens(game, 'General Weiss-1-0', 'Block', 1);
    assert.strictEqual(game.pendingPowerTokenOverflow, undefined);
    // Another ability grants a second token
    grantPowerTokens(game, 'General Weiss-1-0', 'Hit', 1);
    assert.strictEqual(game.pendingPowerTokenOverflow, undefined);
    // Third token pushes over cap
    grantPowerTokens(game, 'General Weiss-1-0', 'Surge', 1);
    assert.ok(game.pendingPowerTokenOverflow);
    assert.strictEqual(game.pendingPowerTokenOverflow[0].discardCount, 1);
  });
});
