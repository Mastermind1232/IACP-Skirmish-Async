/**
 * EXHAUSTIVE Squad Upgrade (SU) figure model tests (alexanbv 2026-06-22, critical).
 *
 * Each SU figure (Z-6 Trooper / Mortar Trooper / Flame Trooper) is its OWN figure
 * with its own deployment card: own stats (HP, speed, defense), own attack dice +
 * surges, own innate/abilities/keywords, own figure cost (= the attachment's cost).
 * NONE of it is shared group-wide, and it never inherits group-mates' abilities.
 *
 * The SU figure has a HOST figureKey (e.g. 'Stormtrooper-1-2') and is identified
 * by its nickname in game.figureNicknames. Base group figures (no nickname) must
 * keep the HOST stats.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { effectiveDcNameForFigure, figureHasPriorityTarget, getDcEffect } from '../../../src/game/dc-helpers.js';
import { getEffectiveSpeed } from '../../../src/game/board-helpers.js';
import { getMovementProfile } from '../../../src/game/movement.js';
import { getAttackerSurgeAbilities } from '../../../src/game/combat.js';
import { getDcStats } from '../../../src/data-loader.js';

// Canonical printed values (data/dc-effects.json) for each SU card.
const SU = {
  'Z-6 Trooper':    { cost: 5, health: 8, speed: 4, dice: ['yellow', 'green'], surges: ['damage 2', 'accuracy 2, pierce 1'], priorityTarget: false, bleed: false },
  'Mortar Trooper': { cost: 4, health: 7, speed: 3, dice: ['blue', 'blue', 'green'], surges: ['accuracy 2', 'damage 2'], priorityTarget: false, bleed: false },
  'Flame Trooper':  { cost: 5, health: 8, speed: 4, dice: ['red', 'green'], surges: ['damage 2', 'blast 1'], priorityTarget: true, bleed: true },
};

const HOST = 'Stormtrooper'; // host group the SU attaches to (speed 4, no Priority Target)

// A game where 'Stormtrooper-1-2' is the SU figure and 'Stormtrooper-1-0' a base figure.
function gameWithSu(suCard) {
  return {
    figureNicknames: { 'Stormtrooper-1-2': suCard },
    figurePositions: { 1: { 'Stormtrooper-1-0': 'a1', 'Stormtrooper-1-1': 'a2', 'Stormtrooper-1-2': 'a3' } },
  };
}

describe('SU figure model — effectiveDcNameForFigure', () => {
  for (const suCard of Object.keys(SU)) {
    it(`${suCard}: SU figure resolves to its own card, base figure to the host`, () => {
      const game = gameWithSu(suCard);
      assert.equal(effectiveDcNameForFigure(game, 'Stormtrooper-1-2'), `[${suCard}]`);
      assert.equal(effectiveDcNameForFigure(game, 'Stormtrooper-1-0'), HOST);
    });
  }
});

describe('SU figure model — own STATS (HP / speed / defense / figure cost)', () => {
  for (const [suCard, s] of Object.entries(SU)) {
    it(`${suCard}: HP / speed / defense / figure cost come from the SU card`, () => {
      const game = gameWithSu(suCard);
      const suStats = getDcStats(effectiveDcNameForFigure(game, 'Stormtrooper-1-2'));
      assert.equal(suStats.health, s.health, 'own HP');
      assert.deepEqual(suStats.defense, ['black'], 'own defense dice');
      // Speed via the SU-aware getEffectiveSpeed (host passed in, but figureKey is the SU figure).
      assert.equal(getEffectiveSpeed(HOST, 'Stormtrooper-1-2', game, 1), s.speed, 'own speed');
      // Figure cost = the attachment's cost (SU cards are single-figure → cost).
      const figCost = suStats.subCost ?? suStats.cost;
      assert.equal(figCost, s.cost, 'figure cost = attachment cost');
    });
  }

  it('a base group figure does NOT get the SU figure speed', () => {
    const game = gameWithSu('Mortar Trooper'); // Mortar speed 3
    assert.equal(getEffectiveSpeed(HOST, 'Stormtrooper-1-2', game, 1), 3, 'SU figure = Mortar speed 3');
    assert.notEqual(getEffectiveSpeed(HOST, 'Stormtrooper-1-0', game, 1), 3, 'base figure must NOT inherit the SU speed');
  });
});

describe('SU figure model — own ATTACK SURGES (not the host group)', () => {
  for (const [suCard, s] of Object.entries(SU)) {
    it(`${suCard}: getAttackerSurgeAbilities uses the SU card's surges`, () => {
      const surges = getAttackerSurgeAbilities({ attackerDcName: HOST, suAttackerCard: suCard });
      for (const k of s.surges) assert.ok(surges.includes(k), `${suCard} surge ${k}`);
    });
  }
  it('Flame Trooper gets Surge: Bleed (from its abilities); others do not', () => {
    assert.ok(getAttackerSurgeAbilities({ attackerDcName: HOST, suAttackerCard: 'Flame Trooper' }).includes('bleed'));
    assert.ok(!getAttackerSurgeAbilities({ attackerDcName: HOST, suAttackerCard: 'Z-6 Trooper' }).includes('bleed'));
    assert.ok(!getAttackerSurgeAbilities({ attackerDcName: HOST, suAttackerCard: 'Mortar Trooper' }).includes('bleed'));
  });
});

describe('SU figure model — own KEYWORDS / passives (Priority Target scoped to the SU figure)', () => {
  it('Flame Trooper SU figure HAS Priority Target; base figure + other SU do NOT', () => {
    const ft = gameWithSu('Flame Trooper');
    assert.ok(figureHasPriorityTarget(ft, 'Stormtrooper-1-2'), 'Flame Trooper figure has Priority Target');
    assert.ok(!figureHasPriorityTarget(ft, 'Stormtrooper-1-0'), 'base group figure does not');
    const z6 = gameWithSu('Z-6 Trooper');
    assert.ok(!figureHasPriorityTarget(z6, 'Stormtrooper-1-2'), 'Z-6 figure has no Priority Target');
  });

  it('every SU figure carries the SU card keywords (TROOPER / HEAVY WEAPON / SQUAD UPGRADE)', () => {
    for (const suCard of Object.keys(SU)) {
      const eff = getDcEffect(`[${suCard}]`);
      const kws = (eff.keywords || []).map((k) => String(k).toUpperCase());
      assert.ok(kws.includes('HEAVY WEAPON') && kws.includes('SQUAD UPGRADE'), `${suCard} keywords`);
    }
  });
});

describe('SU figure model — movement profile from the SU card', () => {
  it("the SU figure's movement keywords come from its own card (not the host)", () => {
    // None of the SU cards are Massive/Mobile, so the profile must reflect that
    // regardless of the host passed in.
    const game = gameWithSu('Flame Trooper');
    const prof = getMovementProfile(HOST, 'Stormtrooper-1-2', game);
    assert.equal(prof.isMassive, false);
    assert.equal(prof.isMobile, false);
  });
});
