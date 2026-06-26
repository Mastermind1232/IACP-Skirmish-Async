/**
 * Designer rulings (alexanbv 2026-06-26):
 *  1. Mounted — AUTO-GRANT 3 MP at start of activation (no Apply/Skip prompt).
 *  2. Madness (Taron Malicos) — mandatory, player-triggered, NO Skip button.
 *  3. Iden Versio Droid Kit — restore 4-way token picker (Damage/Surge/Block/
 *     Evade); the handler grants the chosen token type.
 *
 * These exercise the soa-handler pick path (Mounted/Madness) and the
 * activation.js droidkit fire handler (token grants).
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { handleSoaPick } from '../../src/handlers/soa-handler.js';
import { handleActPassive } from '../../src/handlers/activation.js';

// --- Minimal interaction/ctx mocks -----------------------------------------

function makeInteraction(customId) {
  const sent = [];
  const edits = [];
  const followUps = [];
  const interaction = {
    customId,
    user: { id: 'u1' },
    channelId: 'chan1',
    deferUpdate: async () => {},
    followUp: async (p) => { followUps.push(p); },
    message: {
      channel: { send: async (p) => { sent.push(p); return { edit: async () => {} }; } },
      edit: async (p) => { edits.push(p); },
    },
  };
  return { interaction, sent, edits, followUps };
}

function rowButtons(payload) {
  // payload.components -> ActionRowBuilder[] -> .components -> ButtonBuilder[]
  const rows = payload?.components || [];
  return rows.flatMap((r) => (r.components || []).map((b) => ({
    customId: b.data?.custom_id ?? b.data?.customId,
    label: b.data?.label,
  })));
}

function baseCtx(game) {
  return {
    getGame: () => game,
    canActAsPlayer: () => true,
    saveGames: () => {},
    client: {},
    logGameAction: async () => {},
    dcMessageMeta: new Map([['msgMount', { displayName: 'Captain Terro [Group 1]', dcName: 'Captain Terro', playerNum: 1 }],
                            ['msgMad', { displayName: 'Taron Malicos [Group 1]', dcName: 'Taron Malicos', playerNum: 1 }]]),
  };
}

function soaGame(descriptor) {
  return {
    gameId: 'g1',
    pendingSoaResolution: {
      buckets: [{ ownerPlayerNum: 1, descriptors: [descriptor] }],
      currentBucketIdx: 0,
      activationContext: { activatorPlayerNum: 1, activatorMsgId: descriptor.sourceMsgId },
    },
  };
}

// --- 1. Mounted auto-grant --------------------------------------------------

describe('Mounted — auto-grant 3 MP (no Apply/Skip prompt)', () => {
  it('grants 3 MP into the bank and consumes the descriptor with no buttons', async () => {
    const desc = { id: 'mounted:msgMount', ownerPlayerNum: 1, sourceMsgId: 'msgMount', sourceLabel: 'Mounted', subPromptKey: 'mounted', extras: { dcName: 'Captain Terro' } };
    const game = soaGame(desc);
    const { interaction, sent } = makeInteraction('soa_pick_g1_mounted:msgMount');
    await handleSoaPick(interaction, baseCtx(game));

    // 3 MP banked under the same msgId the Apply path used.
    const banked = game.movementBank?.msgMount?.perFig?.[0]?.remaining;
    assert.equal(banked, 3, 'Mounted banks exactly 3 MP');

    // No interactive buttons posted (auto-grant); informational send only.
    const buttons = sent.flatMap((p) => rowButtons(p));
    assert.equal(buttons.length, 0, 'no Apply/Skip buttons posted for Mounted');

    // Descriptor consumed → resolution exhausted (bucket emptied).
    assert.equal(game.pendingSoaResolution, undefined, 'Mounted descriptor consumed');
  });
});

// --- 2. Madness mandatory, no Skip -----------------------------------------

describe('Madness — mandatory, single "Resolve Madness" button (no Skip)', () => {
  it('posts exactly one button and no Skip/decline option', async () => {
    const desc = { id: 'madness:msgMad', ownerPlayerNum: 1, sourceMsgId: 'msgMad', sourceLabel: 'Madness', subPromptKey: 'madness', extras: { dcName: 'Taron Malicos' } };
    const game = soaGame(desc);
    const { interaction, sent } = makeInteraction('soa_pick_g1_madness:msgMad');
    await handleSoaPick(interaction, baseCtx(game));

    const buttons = sent.flatMap((p) => rowButtons(p));
    assert.equal(buttons.length, 1, 'exactly one Madness button');
    assert.match(buttons[0].label, /Resolve Madness/i, 'button is the mandatory resolve');
    assert.ok(buttons[0].customId.endsWith('_apply'), 'only the apply choiceKey exists');
    assert.ok(!buttons.some((b) => /skip/i.test(b.customId) || /skip/i.test(b.label || '')), 'no Skip button');

    // Descriptor stays pending until resolved (not consumed by pick).
    assert.ok(game.pendingSoaResolution, 'Madness still pending after pick');
  });
});

// --- 3. Droid Kit 4-way token grant ----------------------------------------

describe('Iden Versio Droid Kit — grants the chosen token type (all 4)', () => {
  for (const [choice, expected] of [['damage', 'Damage'], ['surge', 'Surge'], ['block', 'Block'], ['evade', 'Evade']]) {
    it(`choice "${choice}" grants 1 ${expected} token`, async () => {
      const game = { gameId: 'g1' };
      const ctx = {
        getGame: () => game,
        dcMessageMeta: new Map([['mIden', { displayName: 'Iden Versio [Group 1]', dcName: 'Iden Versio', playerNum: 1 }]]),
        saveGames: () => {},
        logGameAction: async () => {},
        client: {},
      };
      const { interaction } = makeInteraction(`act_passive_g1_mIden_droidkit_${choice}`);
      await handleActPassive(interaction, ctx);
      const tokens = game.figurePowerTokens?.['Iden Versio-1-0'] || [];
      assert.deepEqual(tokens, [expected], `granted exactly one ${expected} token`);
    });
  }
});
