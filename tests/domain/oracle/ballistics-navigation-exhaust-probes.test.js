/**
 * Oracle probes for two reusable exhaust-based CC attachments:
 *
 *   - Ballistics Matrix (CSV rows 540-541): "Place this card on your Deployment
 *     card as an Attachment. Exhaust this card before you declare an attack;
 *     figures do not block line of sight during this attack." — reusable
 *     attachment, once per attack, re-arms at the start of each round.
 *
 *   - Navigation Upgrade (CSV rows 749-750): "Take 1 Strain and place this card
 *     in your Play Area. Exhaust this card during a friendly DROID's activation;
 *     that figure gains 1 movement point." — recurring exhaustable attachment,
 *     per-round ready.
 *
 * Both reuse the existing `game.exhaustedSkirmishUpgrades[msgId]` mechanism
 * (helpers in card-state-helpers.js). The start-of-round READY half is FREE:
 * round.js clears that map at the start of each round. These probes simulate
 * the ready by deleting the map entry and assert the effect re-arms.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { resolveAbility } from '../../../src/game/abilities.js';
import { _registerDcMessageMeta } from '../../../src/game/activation-state.js';
import { isAttachmentExhausted, exhaustAttachment } from '../../../src/game/card-state-helpers.js';
import { getDcActionButtons } from '../../../src/discord/components.js';
import { getDcStats } from '../../../src/data-loader.js';
import { handleExhaustBallistics, handleExhaustNavUpgrade } from '../../../src/handlers/interrupts.js';

/** Flatten ActionRow components to their button labels. */
function _collectLabels(rows) {
  const labels = [];
  for (const row of rows || []) {
    for (const comp of row?.components || []) {
      const data = comp?.data || comp;
      if (data?.label != null) labels.push(String(data.label));
    }
  }
  return labels;
}

// ── Ballistics Matrix ───────────────────────────────────────────────────────

function buildBallisticsGame() {
  const msgId = 'm-ballistics';
  const dcMessageMeta = new Map([
    [msgId, { gameId: 'g-ballistics', playerNum: 1, dcName: 'BT-1', displayName: 'BT-1 [Group 1]' }],
  ]);
  const game = {
    gameId: 'g-ballistics',
    dcActionsData: { [msgId]: { selectedFigure: 0 } },
    figurePositions: { 1: { 'BT-1-1-0': 'D4' }, 2: {} },
    // Attachment placed on the BT-1 DC.
    p1CcAttachments: { [msgId]: ['Ballistics Matrix'] },
  };
  _registerDcMessageMeta(dcMessageMeta);
  return { game, dcMessageMeta, msgId };
}

describe('ORACLE-BALLISTICS-001: reusable exhaust-based LOS attachment', () => {
  it('001: first fire sets the LOS flag AND exhausts the attachment', () => {
    const { game, dcMessageMeta, msgId } = buildBallisticsGame();

    const res = resolveAbility('Ballistics Matrix', { game, playerNum: 1, dcMessageMeta });

    assert.equal(res.applied, true, 'first fire applies');
    assert.equal(game.nextAttackIgnoreFigureLOS?.['BT-1-1-0'], true, 'LOS flag set for the activating figure');
    assert.equal(isAttachmentExhausted(game, msgId, 'Ballistics Matrix'), true, 'attachment exhausted after firing');
  });

  it('002: while exhausted it cannot fire again (same round)', () => {
    const { game, dcMessageMeta, msgId } = buildBallisticsGame();
    resolveAbility('Ballistics Matrix', { game, playerNum: 1, dcMessageMeta });
    // Simulate the flag already consumed by the prior attack.
    delete game.nextAttackIgnoreFigureLOS['BT-1-1-0'];

    const res2 = resolveAbility('Ballistics Matrix', { game, playerNum: 1, dcMessageMeta });

    assert.equal(res2.applied, false, 'exhausted attachment does not re-fire');
    assert.equal(game.nextAttackIgnoreFigureLOS?.['BT-1-1-0'], undefined, 'LOS flag NOT re-set while exhausted');
    assert.equal(isAttachmentExhausted(game, msgId, 'Ballistics Matrix'), true, 'still exhausted');
  });

  it('003: re-arms after start-of-round ready (exhausted map cleared)', () => {
    const { game, dcMessageMeta, msgId } = buildBallisticsGame();
    resolveAbility('Ballistics Matrix', { game, playerNum: 1, dcMessageMeta });
    delete game.nextAttackIgnoreFigureLOS['BT-1-1-0'];

    // Simulate round.js start-of-round READY: clears exhaustedSkirmishUpgrades.
    delete game.exhaustedSkirmishUpgrades[msgId];

    const res3 = resolveAbility('Ballistics Matrix', { game, playerNum: 1, dcMessageMeta });

    assert.equal(res3.applied, true, 'fires again after ready');
    assert.equal(game.nextAttackIgnoreFigureLOS?.['BT-1-1-0'], true, 'LOS flag re-set after ready');
    assert.equal(isAttachmentExhausted(game, msgId, 'Ballistics Matrix'), true, 're-exhausted after re-fire');
  });
});

// ── Navigation Upgrade ──────────────────────────────────────────────────────

function buildNavigationGame() {
  const msgId = 'm-nav';
  const dcMessageMeta = new Map([
    [msgId, { gameId: 'g-nav', playerNum: 1, dcName: 'IG-88', displayName: 'IG-88 [Group 1]' }],
  ]);
  const game = {
    gameId: 'g-nav',
    dcActionsData: { [msgId]: { selectedFigure: 0 } },
    figurePositions: { 1: { 'IG-88-1-0': 'D4' }, 2: {} },
    p1CcAttachments: { [msgId]: ['Navigation Upgrade'] },
  };
  _registerDcMessageMeta(dcMessageMeta);
  return { game, dcMessageMeta, msgId };
}

describe('ORACLE-NAVUPGRADE-001: reusable exhaust-based +1 MP DROID attachment', () => {
  it('001: granting +1 MP exhausts the attachment', () => {
    const { game, dcMessageMeta, msgId } = buildNavigationGame();

    const res = resolveAbility('Navigation Upgrade', {
      game, playerNum: 1, dcMessageMeta,
      choiceIndex: 0, chosenFigureKey: 'IG-88-1-0',
    });

    assert.equal(res.applied, true, 'grant applies');
    assert.equal(game.movementBank?.[msgId]?.perFig?.[0]?.remaining, 1, '+1 MP granted to the DROID');
    assert.equal(isAttachmentExhausted(game, msgId, 'Navigation Upgrade'), true, 'attachment exhausted after granting MP');
  });

  it('002: while exhausted it cannot grant again (same round)', () => {
    const { game, dcMessageMeta, msgId } = buildNavigationGame();
    resolveAbility('Navigation Upgrade', {
      game, playerNum: 1, dcMessageMeta, choiceIndex: 0, chosenFigureKey: 'IG-88-1-0',
    });

    const res2 = resolveAbility('Navigation Upgrade', {
      game, playerNum: 1, dcMessageMeta, choiceIndex: 0, chosenFigureKey: 'IG-88-1-0',
    });

    assert.equal(res2.applied, false, 'exhausted attachment does not grant again');
    assert.equal(game.movementBank?.[msgId]?.perFig?.[0]?.remaining, 1, 'MP not stacked while exhausted');
  });

  it('003: re-arms after start-of-round ready (exhausted map cleared)', () => {
    const { game, dcMessageMeta, msgId } = buildNavigationGame();
    resolveAbility('Navigation Upgrade', {
      game, playerNum: 1, dcMessageMeta, choiceIndex: 0, chosenFigureKey: 'IG-88-1-0',
    });

    // Simulate round.js start-of-round READY.
    delete game.exhaustedSkirmishUpgrades[msgId];

    const res3 = resolveAbility('Navigation Upgrade', {
      game, playerNum: 1, dcMessageMeta, choiceIndex: 0, chosenFigureKey: 'IG-88-1-0',
    });

    assert.equal(res3.applied, true, 'grants again after ready');
    assert.equal(game.movementBank?.[msgId]?.perFig?.[0]?.remaining, 2, 'second +1 MP granted after ready');
    assert.equal(isAttachmentExhausted(game, msgId, 'Navigation Upgrade'), true, 're-exhausted after re-grant');
  });
});

// ── In-activation exhaust BUTTON (alexanbv 2026-06-20) ──────────────────────

const _renderHelpers = {
  getDcStats: (dcName) => getDcStats(dcName),
  getPlayerNumForMsgId: () => 1,
};

describe('ORACLE-BALLISTICS-BUTTON: in-activation Exhaust button', () => {
  it('button appears when readied; absent when exhausted', () => {
    const { game, msgId } = buildBallisticsGame();
    const rows = getDcActionButtons(msgId, 'BT-1', 'BT-1 [Group 1]', { selectedFigure: 0, remaining: 2 }, game, _renderHelpers);
    assert.ok(_collectLabels(rows).some((l) => /Exhaust Ballistics Matrix/.test(l)), 'button shown when readied');

    exhaustAttachment(game, msgId, 'Ballistics Matrix');
    const rows2 = getDcActionButtons(msgId, 'BT-1', 'BT-1 [Group 1]', { selectedFigure: 0, remaining: 2 }, game, _renderHelpers);
    assert.ok(!_collectLabels(rows2).some((l) => /Exhaust Ballistics Matrix/.test(l)), 'button absent when exhausted');
  });

  it('handler exhausts + sets nextAttackIgnoreFigureLOS', async () => {
    const { game, msgId } = buildBallisticsGame();
    const ctx = _stubCtx(game);
    await handleExhaustBallistics({ customId: `dc_exhaust_ballistics_${msgId}`, ...ctx.interaction }, ctx);
    assert.equal(game.nextAttackIgnoreFigureLOS?.['BT-1-1-0'], true, 'LOS flag set');
    assert.equal(isAttachmentExhausted(game, msgId, 'Ballistics Matrix'), true, 'exhausted');
  });
});

describe('ORACLE-NAVUPGRADE-BUTTON: in-activation Exhaust button', () => {
  it('button appears on a DROID activation while readied; absent when exhausted', () => {
    const { game, msgId } = buildNavigationGame();
    const rows = getDcActionButtons(msgId, 'IG-88', 'IG-88 [Group 1]', { selectedFigure: 0, remaining: 2 }, game, _renderHelpers);
    assert.ok(_collectLabels(rows).some((l) => /Exhaust Navigation Upgrade/.test(l)), 'button shown on DROID activation when readied');

    exhaustAttachment(game, msgId, 'Navigation Upgrade');
    const rows2 = getDcActionButtons(msgId, 'IG-88', 'IG-88 [Group 1]', { selectedFigure: 0, remaining: 2 }, game, _renderHelpers);
    assert.ok(!_collectLabels(rows2).some((l) => /Exhaust Navigation Upgrade/.test(l)), 'button absent when exhausted');
  });

  it('handler grants +1 MP to the activating DROID + exhausts the attachment (cross-DC)', async () => {
    // Attachment on the placer DC (m-nav / IG-88); a SECOND friendly DROID
    // (4-LOM) activates and should receive the +1 MP, exhausting the attachment
    // that lives on the first DC.
    const placerMsgId = 'm-nav';
    const activeMsgId = 'm-nav2';
    const dcMessageMeta = new Map([
      [placerMsgId, { gameId: 'g-nav', playerNum: 1, dcName: 'IG-88', displayName: 'IG-88 [Group 1]' }],
      [activeMsgId, { gameId: 'g-nav', playerNum: 1, dcName: '4-LOM', displayName: '4-LOM [Group 1]' }],
    ]);
    _registerDcMessageMeta(dcMessageMeta);
    const game = {
      gameId: 'g-nav',
      dcActionsData: { [activeMsgId]: { selectedFigure: 0 } },
      figurePositions: { 1: { 'IG-88-1-0': 'D4', '4-LOM-1-0': 'E5' }, 2: {} },
      p1CcAttachments: { [placerMsgId]: ['Navigation Upgrade'] },
    };
    const ctx = _stubCtx(game, dcMessageMeta);
    await handleExhaustNavUpgrade({ customId: `dc_exhaust_navupgrade_${activeMsgId}`, ...ctx.interaction }, ctx);
    assert.equal(game.movementBank?.[activeMsgId]?.perFig?.[0]?.remaining, 1, '+1 MP to the ACTIVATING DROID (4-LOM)');
    assert.equal(isAttachmentExhausted(game, placerMsgId, 'Navigation Upgrade'), true, 'attachment on the placer DC exhausted');
  });
});

/** Minimal handler ctx stub (no Discord I/O). */
function _stubCtx(game, dcMessageMeta) {
  const meta = dcMessageMeta || new Map([
    ['m-ballistics', { gameId: 'g-ballistics', playerNum: 1, dcName: 'BT-1', displayName: 'BT-1 [Group 1]' }],
    ['m-nav', { gameId: 'g-nav', playerNum: 1, dcName: 'IG-88', displayName: 'IG-88 [Group 1]' }],
  ]);
  _registerDcMessageMeta(meta);
  return {
    interaction: {
      user: { id: 'p1' },
      client: {},
      followUp: async () => {},
    },
    getGame: () => game,
    canActAsPlayer: () => true,
    saveGames: () => {},
    client: {},
    dcMessageMeta: meta,
    logGameAction: async () => {},
    updateDcActionsMessage: async () => {},
  };
}
