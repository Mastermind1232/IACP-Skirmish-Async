/**
 * PROBE-CHOOSE-A-SIDE: Choose a Side Command Card behavioral oracle.
 *
 * CSV (Choose a Side, part 2, always): "During this round OTHER friendly Mobile
 * figures gain Personal Combat Shield (SCUM) or Gar Saxon's Flamethrower
 * (IMPERIAL), based on your army affiliation."
 *
 * Granted card texts (data/dc-effects.json):
 *  - Personal Combat Shield: "Whenever you spend a Block while defending, apply
 *    +1 Evade to the defense results." (NOT a flat +1 Block.)
 *  - Gar Saxon's Flamethrower: Special Action — choose space within 2; each other
 *    figure on/adjacent suffers 1 Damage + 1 Strain and discards 1 Power Token.
 *
 * Fixes pinned here:
 *  (a) SCUM grants the correct Personal Combat Shield mechanic (round flag read by
 *      handlers/combat.js applyPersonalCombatShieldOnBlockSpend), not +1 Block.
 *  (b) IMPERIAL no longer grants the WRONG generic free attack
 *      (freeAttackBonusPending); it now grants the real per-figure Gar Saxon's
 *      Flamethrower Special Action (1 action) to OTHER friendly Mobile figures
 *      this round, surfaced via the round flag roundMobileGarSaxonFlamethrower
 *      and the shared hasChooseASideFlamethrower eligibility helper (read by the
 *      render path, the dispatch path, and the AI enumeration).
 *  (c) Self-exclusion: the Choose a Side figure itself is excluded ("OTHER").
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { resolveAbility } from '../../../src/game/abilities.js';
import { applyPersonalCombatShieldOnBlockSpend } from '../../../src/handlers/combat.js';
import { getDcEffects, hasChooseASideFlamethrower, getDcStats } from '../../../src/data-loader.js';
import { getDcActionButtons } from '../../../src/discord/components.js';
import { _registerDcMessageMeta } from '../../../src/game/activation-state.js';

/** Flatten ActionRow components to their button labels. */
function collectLabels(rows) {
  const labels = [];
  for (const row of rows || []) {
    for (const comp of row?.components || []) {
      const data = comp?.data || comp;
      if (data?.label != null) labels.push(String(data.label));
    }
  }
  return labels;
}

function buildGame() {
  const dcMessageMeta = new Map();
  // Boba Fett + Cad Bane are MOBILE; the activating figure is Boba Fett.
  dcMessageMeta.set('mBoba', { gameId: 'gcs', playerNum: 1, dcName: 'Boba Fett', displayName: 'Boba Fett [DG 1]' });
  dcMessageMeta.set('mCad', { gameId: 'gcs', playerNum: 1, dcName: 'Cad Bane', displayName: 'Cad Bane [DG 1]' });
  const game = {
    gameId: 'gcs', player1Id: 'p1', player2Id: 'p2',
    figurePositions: { 1: { 'Boba Fett-1-0': 'a1', 'Cad Bane-1-0': 'b2' }, 2: {} },
    dcActionsData: { mBoba: { selectedFigure: 0 } },
    activeActivationMsgId: 'mBoba',
    p1DcMessageIds: ['mBoba', 'mCad'],
    p1DcList: [{ dcName: 'Boba Fett' }, { dcName: 'Cad Bane' }],
  };
  // figureKeyForActivation resolves the source figure from the module-global
  // meta registry (registered at startup in production via game-state.js).
  _registerDcMessageMeta(dcMessageMeta);
  return { game, dcMessageMeta };
}

describe('PROBE-CHOOSE-A-SIDE-001: SCUM grants Personal Combat Shield (+1 Evade per Block spent), self-excluded', () => {
  it('registers a per-figure Personal Combat Shield modifier (MOBILE, self-excluded); no flat +1 Block', () => {
    const { game, dcMessageMeta } = buildGame();
    const r = resolveAbility('Choose a Side', { game, playerNum: 1, dcMessageMeta, choiceIndex: 0 });
    assert.equal(r.applied, true);
    // Per-figure registry (alexanbv 2026-06-20): a defense descriptor that grants
    // personalCombatShield to OTHER friendly MOBILE figures.
    const d = (game.activeRoundModifiers || []).find(
      (m) => m.card === 'Choose a Side (SCUM)' && m.effect?.personalCombatShield
    );
    assert.ok(d, 'Choose a Side SCUM shield descriptor registered');
    assert.equal(d.ownerPlayerNum, 1);
    assert.equal(d.side, 'defense');
    assert.equal(d.conditions.selfKeyword, 'MOBILE');
    assert.equal(d.conditions.excludeSourceFigure, true);
    assert.equal(d.sourceFigureKey, 'Boba Fett-1-0', 'card-player is the source (excluded)');
    // No flat +1 Block proxy.
    assert.equal(game.roundMobileDefenseBonusBlock, undefined, 'no flat +1 Block proxy');
  });

  it('+1 Evade applies when a granted Mobile figure spends a Block while defending', () => {
    const { game, dcMessageMeta } = buildGame();
    resolveAbility('Choose a Side', { game, playerNum: 1, dcMessageMeta, choiceIndex: 0 });
    const ctx = { getDcEffects: () => getDcEffects() };
    // Cad Bane (granted, Mobile, not excluded) defending and spending a Block.
    const combat = { attackerPlayerNum: 2, defenderPlayerNum: 1, target: { figureKey: 'Cad Bane-1-0' }, bonusEvade: 0 };
    const note = applyPersonalCombatShieldOnBlockSpend(game, combat, ctx);
    assert.ok(note, 'PCS note emitted for granted Mobile figure');
    assert.equal(combat.bonusEvade, 1, '+1 Evade applied');
  });

  it('the excluded Choose a Side figure gets NO Personal Combat Shield', () => {
    const { game, dcMessageMeta } = buildGame();
    resolveAbility('Choose a Side', { game, playerNum: 1, dcMessageMeta, choiceIndex: 0 });
    const ctx = { getDcEffects: () => getDcEffects() };
    const combat = { attackerPlayerNum: 2, defenderPlayerNum: 1, target: { figureKey: 'Boba Fett-1-0' }, bonusEvade: 0 };
    const note = applyPersonalCombatShieldOnBlockSpend(game, combat, ctx);
    assert.equal(note, '', 'no PCS for the excluded card-playing figure');
    assert.equal(combat.bonusEvade, 0);
  });
});

describe('PROBE-CHOOSE-A-SIDE-002: IMPERIAL stops the wrong generic free attack; Flamethrower grant is functional', () => {
  it('does NOT set freeAttackBonusPending; sets the Flamethrower round flag with self excluded', () => {
    const { game, dcMessageMeta } = buildGame();
    const r = resolveAbility('Choose a Side', { game, playerNum: 1, dcMessageMeta, choiceIndex: 1 });
    assert.equal(r.applied, true);
    assert.equal(game.freeAttackBonusPending, undefined, 'the WRONG generic free attack is no longer granted');
    assert.ok(game.roundMobileGarSaxonFlamethrower?.[1], 'Flamethrower round flag set');
    assert.equal(game.roundMobileGarSaxonFlamethrower[1].excludeFigureKey, 'Boba Fett-1-0', 'card-player excluded');
    assert.match(r.logMessage, /Special Action/i, 'log describes the granted Special Action');
  });
});

describe('PROBE-CHOOSE-A-SIDE-004: IMPERIAL Flamethrower is granted as a Special Action to OTHER Mobile figures', () => {
  it('eligibility helper: granted to other Mobile figure, NOT to excluded figure, NOT to non-Mobile', () => {
    const { game, dcMessageMeta } = buildGame();
    resolveAbility('Choose a Side', { game, playerNum: 1, dcMessageMeta, choiceIndex: 1 });
    assert.equal(hasChooseASideFlamethrower(game, 1, 'Cad Bane-1-0'), true, 'other Mobile friendly: granted');
    assert.equal(hasChooseASideFlamethrower(game, 1, 'Boba Fett-1-0'), false, 'excluded card-player: not granted');
    // Stormtrooper has no Mobile keyword.
    assert.equal(hasChooseASideFlamethrower(game, 1, 'Stormtrooper-1-0'), false, 'non-Mobile figure: not granted');
    // Not granted to the enemy player.
    assert.equal(hasChooseASideFlamethrower(game, 2, 'Cad Bane-1-0'), false, 'enemy player: not granted');
  });

  it('render path injects the Gar Saxon\'s Flamethrower Special Action button (1 action) for the eligible Mobile figure', () => {
    const { game, dcMessageMeta } = buildGame();
    resolveAbility('Choose a Side', { game, playerNum: 1, dcMessageMeta, choiceIndex: 1 });
    const helpers = {
      getDcStats: (dcName) => getDcStats(dcName),
      getPlayerNumForMsgId: () => 1,
    };
    // Eligible: Cad Bane (Mobile, not the card-player).
    const rowsCad = getDcActionButtons('mCad', 'Cad Bane', 'Cad Bane [DG 1]', { selectedFigure: 0, remaining: 2 }, game, helpers);
    const labelsCad = collectLabels(rowsCad);
    assert.ok(labelsCad.some((l) => /Gar Saxon's Flamethrower/.test(l)), 'eligible Mobile figure gets the Flamethrower special button');

    // Excluded: Boba Fett (the card-player) — must NOT get the injected button.
    const rowsBoba = getDcActionButtons('mBoba', 'Boba Fett', 'Boba Fett [DG 1]', { selectedFigure: 0, remaining: 2 }, game, helpers);
    const labelsBoba = collectLabels(rowsBoba);
    assert.ok(!labelsBoba.some((l) => /Gar Saxon's Flamethrower/.test(l)), 'excluded card-player does NOT get the special');
  });
});

describe('PROBE-CHOOSE-A-SIDE-003: library-contract pinning', () => {
  it('library entry still declares chooseASideEffect', async () => {
    const { readFile } = await import('node:fs/promises');
    const lib = JSON.parse(await readFile(new URL('../../../data/ability-library.json', import.meta.url), 'utf8'));
    const entry = lib.abilities?.['Choose a Side'];
    assert.ok(entry, 'Choose a Side must exist');
    assert.equal(entry.type, 'ccEffect');
    assert.equal(entry.chooseASideEffect, true);
    assert.equal(entry.wiredStatus, 'wired');
  });
});
