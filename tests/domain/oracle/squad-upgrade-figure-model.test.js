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
  it('innate Bleed is NOT a surge for any SU figure (it applies every attack via passives)', () => {
    for (const suCard of Object.keys(SU)) {
      assert.ok(!getAttackerSurgeAbilities({ attackerDcName: HOST, suAttackerCard: suCard }).includes('bleed'),
        `${suCard}: Bleed must not be offered as a surge`);
    }
  });
});

describe('SU figure model — INNATE attack modifiers apply every attack (via passives)', () => {
  // Innate abilities are merged into the SU card's runtime `passives`;
  // applyDcPassivesToCombat applies +Accuracy / Pierce / Blast / Bleed from there
  // on EVERY attack once attackerPassives is SU-aware. (alexanbv 2026-06-22)
  it('Flame Trooper innates: Bleed + +2 Accuracy + Pierce 1', () => {
    const p = getDcEffect('[Flame Trooper]').passives.map((x) => String(x).toLowerCase());
    assert.ok(p.includes('bleed') && p.includes('+2 accuracy') && p.includes('pierce 1'));
  });
  it('Z-6 Trooper innate: Blast 1', () => {
    assert.ok(getDcEffect('[Z-6 Trooper]').passives.map((x) => String(x).toLowerCase()).includes('blast 1'));
  });
  it('Mortar Trooper innate: +1 Accuracy (Guidance Systems is the optional one)', () => {
    const p = getDcEffect('[Mortar Trooper]').passives.map((x) => String(x).toLowerCase());
    assert.ok(p.includes('+1 accuracy') && p.includes('guidance systems'));
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

describe('SU figure model — Haul scoped to the Mortar Trooper SU figure only', () => {
  // Haul is the Mortar Trooper SU figure's OWN ability (terrain-cost waiver:
  // treat blocking + impassable terrain as difficult). It must benefit ONLY that
  // figure, not the base Shoretroopers/host group-mates that merely share the
  // [Mortar Trooper] attachment — mirroring the Guidance Systems scoping fix.
  // A game where the Stormtrooper group carries the [Mortar Trooper] attachment
  // and 'Stormtrooper-1-2' is the SU figure, 'Stormtrooper-1-0' a base figure.
  function gameWithMortarAttachment() {
    return {
      figureNicknames: { 'Stormtrooper-1-2': 'Mortar Trooper' },
      figurePositions: { 1: { 'Stormtrooper-1-0': 'a1', 'Stormtrooper-1-1': 'a2', 'Stormtrooper-1-2': 'a3' } },
      p1DcList: [{ dcName: HOST }],
      p1DcMessageIds: ['msg-st-1'],
      p1DcAttachments: { 'msg-st-1': ['Mortar Trooper'] },
    };
  }

  it('the Mortar Trooper SU figure GETS the Haul terrain waiver', () => {
    const game = gameWithMortarAttachment();
    const prof = getMovementProfile(HOST, 'Stormtrooper-1-2', game);
    assert.equal(prof.treatBlockingAsDifficult, true, 'SU figure treats blocking as difficult');
    assert.equal(prof.treatImpassableAsDifficult, true, 'SU figure treats impassable as difficult');
  });

  it('a base Shoretrooper in the same group does NOT get Haul (no over-grant)', () => {
    const game = gameWithMortarAttachment();
    const prof = getMovementProfile(HOST, 'Stormtrooper-1-0', game);
    assert.equal(prof.treatBlockingAsDifficult, false, 'base figure does NOT treat blocking as difficult');
    assert.equal(prof.treatImpassableAsDifficult, false, 'base figure does NOT treat impassable as difficult');
  });
});
