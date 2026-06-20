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
 *      (freeAttackBonusPending); the real per-figure Flamethrower-special grant is
 *      DEFERRED (flagged via roundMobileGarSaxonFlamethrower + manual note).
 *  (c) Self-exclusion: the Choose a Side figure itself is excluded ("OTHER").
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { resolveAbility } from '../../../src/game/abilities.js';
import { applyPersonalCombatShieldOnBlockSpend } from '../../../src/handlers/combat.js';
import { getDcEffects } from '../../../src/data-loader.js';

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
  return { game, dcMessageMeta };
}

describe('PROBE-CHOOSE-A-SIDE-001: SCUM grants Personal Combat Shield (+1 Evade per Block spent), self-excluded', () => {
  it('sets roundMobilePersonalCombatShield with the activating figure excluded; no flat +1 Block', () => {
    const { game, dcMessageMeta } = buildGame();
    const r = resolveAbility('Choose a Side', { game, playerNum: 1, dcMessageMeta, choiceIndex: 0 });
    assert.equal(r.applied, true);
    assert.ok(game.roundMobilePersonalCombatShield?.[1], 'PCS round flag set for player 1');
    assert.equal(game.roundMobilePersonalCombatShield[1].excludeFigureKey, 'Boba Fett-1-0', 'card-player excluded');
    // The old WRONG proxy must NOT be set.
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

describe('PROBE-CHOOSE-A-SIDE-002: IMPERIAL stops the wrong generic free attack; Flamethrower grant deferred', () => {
  it('does NOT set freeAttackBonusPending; sets the deferred Flamethrower marker', () => {
    const { game, dcMessageMeta } = buildGame();
    const r = resolveAbility('Choose a Side', { game, playerNum: 1, dcMessageMeta, choiceIndex: 1 });
    assert.equal(r.applied, true);
    assert.equal(game.freeAttackBonusPending, undefined, 'the WRONG generic free attack is no longer granted');
    assert.ok(game.roundMobileGarSaxonFlamethrower?.[1], 'deferred Flamethrower round marker set');
    assert.equal(game.roundMobileGarSaxonFlamethrower[1].excludeFigureKey, 'Boba Fett-1-0', 'card-player excluded');
    assert.match(r.logMessage, /manual/i, 'log flags manual resolution for the deferred special');
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
