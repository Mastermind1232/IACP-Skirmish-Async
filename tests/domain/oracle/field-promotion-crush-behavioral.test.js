/**
 * Behavioral tests for two alexanbv directives:
 *
 *  FIX 1 — Field Promotion increases the PLAYING figure's cost (per-figure,
 *          game-persistent game.figureCostModifier[figureKey]) and that bump is
 *          read by DEFEAT-VP scoring: when that figure is later defeated, the
 *          opponent scores base cost + the Field Promotion bump.
 *
 *  FIX 2 — Crush resolves inside the MASSIVE end-of-move pipeline (before the
 *          push, Stampede timing): a SMALL enemy in the MASSIVE figure's ending
 *          footprint suffers 4 Damage and the card is consumed from hand.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { resolveAbility } from '../../../src/game/abilities.js';
import { processFigureDefeat } from '../../../src/engine/defeat-handler.js';
import { awardKillVp } from '../../../src/game/vp-helpers.js';
import { _registerDcMessageMeta } from '../../../src/game/activation-state.js';
import { _applyCrushBeforePush } from '../../../src/handlers/move-x-handler.js';

// ── FIX 1: Field Promotion → figureCostModifier → defeat VP ──────────────────
describe('Field Promotion: per-figure cost bump is read by defeat VP', () => {
  it('a figure that played Field Promotion yields +2 VP over base cost when defeated', async () => {
    // Agent Blaise is an IMPERIAL DC (so the affiliation gate passes). The
    // activating/attacking figure plays Field Promotion after defeating a hostile.
    const actMsgId = 'msg-fp-act';
    const dcMessageMeta = new Map([
      [actMsgId, { gameId: 'g-fp', playerNum: 1, dcName: 'Agent Blaise', displayName: 'Agent Blaise [DG 1]' }],
    ]);
    _registerDcMessageMeta(dcMessageMeta);
    const game = {
      gameId: 'g-fp',
      selectedMap: { id: 'mos-eisley-outskirts' },
      figurePositions: { 1: { 'Agent Blaise-1-0': 'a1' } },
      dcActionsData: { [actMsgId]: { selectedFigure: 0 } },
      p1DcMessageIds: [actMsgId],
      p1DcList: [{ dcName: 'Agent Blaise' }],
      // lastDefeatInfo present → defenderDefeated derived true (production path).
      lastDefeatInfo: { playerNum: 2, figureKey: 'Stormtrooper-1-0', dcName: 'Stormtrooper' },
      activatingPlayerNum: 1,
      activatingDcMsgId: actMsgId,
    };

    const r = resolveAbility('Field Promotion', { game, playerNum: 1, dcMessageMeta });
    assert.strictEqual(r.applied, true, r.manualMessage || 'Field Promotion should apply');
    // Per-figure modifier stored on the PLAYING figure.
    assert.strictEqual(game.figureCostModifier?.['Agent Blaise-1-0'], 2,
      'figureCostModifier should be +2 on the playing figure');

    // Now defeat that figure and confirm defeat VP = base cost + 2.
    let baseCost;
    const deps = {
      removeFigurePosition: (g, pn, fk) => { delete g.figurePositions[pn][fk]; },
      calculateKillVp: () => { baseCost = 7; return 7; }, // arbitrary base cost
      awardKillVp,
      dcNameFromFigureKey: (fk) => fk.replace(/-\d+-\d+$/, ''),
      logGameAction: async () => {},
      client: {},
      checkWinConditions: () => {},
    };
    await processFigureDefeat(game, {
      defeatedPlayerNum: 1,
      figureKey: 'Agent Blaise-1-0',
      attackerPlayerNum: 2,
      skipWinConditions: true,
    }, deps);

    const p2vp = game.player2VP;
    assert.ok(p2vp, 'player2 VP bucket should exist');
    assert.strictEqual(p2vp.total, baseCost + 2,
      `defeat VP should be base ${baseCost} + Field Promotion 2 = ${baseCost + 2}`);
  });

  it('a figure WITHOUT Field Promotion yields only base cost', async () => {
    const game = {
      gameId: 'g-fp2',
      figurePositions: { 1: { 'Agent Blaise-1-0': 'a1' } },
    };
    const deps = {
      removeFigurePosition: (g, pn, fk) => { delete g.figurePositions[pn][fk]; },
      calculateKillVp: () => 7,
      awardKillVp,
      dcNameFromFigureKey: (fk) => fk.replace(/-\d+-\d+$/, ''),
      logGameAction: async () => {},
      client: {},
      checkWinConditions: () => {},
    };
    await processFigureDefeat(game, {
      defeatedPlayerNum: 1,
      figureKey: 'Agent Blaise-1-0',
      attackerPlayerNum: 2,
      skipWinConditions: true,
    }, deps);
    assert.strictEqual(game.player2VP.total, 7, 'no bump → base VP only');
  });
});

// ── FIX 2: Crush resolves in the massive end-of-move pipeline (pre-push) ──────
describe('Crush: massive end-of-move pipeline (Stampede timing, before push)', () => {
  function buildCrushGame() {
    const massiveMsgId = 'msg-cr-massive';
    const smallMsgId = 'msg-cr-small';
    const dcMessageMeta = new Map([
      // AT-ST is MASSIVE; controlled by P1 (the Crush holder).
      [massiveMsgId, { gameId: 'g-cr', playerNum: 1, dcName: 'AT-ST', displayName: 'AT-ST [DG 1]' }],
      // Stormtrooper is SMALL; controlled by P2 (the target in the footprint).
      [smallMsgId, { gameId: 'g-cr', playerNum: 2, dcName: 'Stormtrooper', displayName: 'Stormtrooper [DG 1]' }],
    ]);
    const dcHealthState = new Map([
      [massiveMsgId, [[11, 11]]],
      [smallMsgId, [[3, 3]]],
    ]);
    const game = {
      gameId: 'g-cr',
      player1CcHand: ['Crush'],
      figurePositions: {
        1: { 'AT-ST-1-0': 'a1' },
        2: { 'Stormtrooper-1-0': 'a1' },
      },
      p2DcMessageIds: [smallMsgId],
      p2DcList: [{ dcName: 'Stormtrooper', healthState: [3, 3] }],
    };
    const ctx = { client: {}, logGameAction: async () => {}, dcMessageMeta, dcHealthState };
    const pending = { playerNum: 1, figureKey: 'AT-ST-1-0', dcName: 'AT-ST' };
    const dispPending = {
      movingPlayerNum: 1,
      movingFigureKey: 'AT-ST-1-0',
      enemyQueue: [{ playerNum: 2, figureKey: 'Stormtrooper-1-0', dcName: 'Stormtrooper' }],
    };
    return { game, ctx, pending, dispPending, dcHealthState, smallMsgId };
  }

  it('applies 4 Damage to a SMALL enemy in the footprint and discards the card', async () => {
    const { game, ctx, pending, dispPending, dcHealthState, smallMsgId } = buildCrushGame();
    await _applyCrushBeforePush(game, ctx, pending, dispPending);
    // 3 HP - 4 Damage → 0 (clamped).
    assert.deepStrictEqual(dcHealthState.get(smallMsgId), [[0, 3]],
      'SMALL target should take 4 Damage before the push');
    assert.ok(!game.player1CcHand.includes('Crush'), 'Crush should be consumed from hand');
    assert.deepStrictEqual(game.player1CcDiscard, ['Crush'], 'Crush should go to discard');
  });

  it('no-op when controller does not hold Crush', async () => {
    const { game, ctx, pending, dispPending, dcHealthState, smallMsgId } = buildCrushGame();
    game.player1CcHand = []; // no Crush in hand
    await _applyCrushBeforePush(game, ctx, pending, dispPending);
    assert.deepStrictEqual(dcHealthState.get(smallMsgId), [[3, 3]], 'no damage without Crush');
    assert.ok(!game.player1CcDiscard, 'no card consumed');
  });

  it('no-op when the moving figure is not MASSIVE', async () => {
    const { game, ctx, pending, dispPending, dcHealthState, smallMsgId } = buildCrushGame();
    // Reassign moving figure to a non-massive DC.
    ctx.dcMessageMeta.set('msg-cr-massive', { gameId: 'g-cr', playerNum: 1, dcName: 'Royal Guard', displayName: 'Royal Guard [DG 1]' });
    pending.figureKey = 'Royal Guard-1-0';
    pending.dcName = 'Royal Guard';
    game.figurePositions[1] = { 'Royal Guard-1-0': 'a1' };
    await _applyCrushBeforePush(game, ctx, pending, dispPending);
    assert.deepStrictEqual(dcHealthState.get(smallMsgId), [[3, 3]], 'non-MASSIVE mover → no Crush');
    assert.ok(game.player1CcHand.includes('Crush'), 'card not consumed');
  });

  it('no-op when no SMALL enemy is in the footprint', async () => {
    const { game, ctx, pending, dispPending } = buildCrushGame();
    // Replace the queued enemy with a MASSIVE one (ineligible).
    ctx.dcMessageMeta.set('msg-cr-small', { gameId: 'g-cr', playerNum: 2, dcName: 'AT-ST', displayName: 'AT-ST [DG 1]' });
    dispPending.enemyQueue = [{ playerNum: 2, figureKey: 'AT-ST-1-0', dcName: 'AT-ST' }];
    await _applyCrushBeforePush(game, ctx, pending, dispPending);
    assert.ok(game.player1CcHand.includes('Crush'), 'card not consumed when no SMALL target');
  });
});
